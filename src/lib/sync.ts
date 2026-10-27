import pb from './pocketbase';
import type { LocalNote, NoteColor } from './types';
import {
  getAllNotes,
  deleteNoteLocal,
  addRevision,
  markNoteSynced,
  putRemoteNote,
} from './db';

interface RemoteNote {
  id: string;
  client_id: string;
  title: string;
  body: string;
  color: string;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  updated_at: number;
  created_at: number;
}

function toLocalNote(r: RemoteNote, ownerId: string): LocalNote {
  return {
    id: r.client_id,
    ownerId,
    remoteId: r.id,
    title: r.title ?? '',
    body: r.body ?? '',
    color: (r.color as NoteColor) ?? 'default',
    pinned: r.pinned ?? false,
    archived: r.archived ?? false,
    deleted: r.deleted ?? false,
    updatedAt: r.updated_at ?? 0,
    createdAt: r.created_at ?? 0,
    localRevision: 0,
    dirty: false,
  };
}

function toRemoteData(note: LocalNote, userId: string) {
  return {
    client_id: note.id,
    title: note.title,
    body: note.body,
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
    deleted: note.deleted,
    updated_at: note.updatedAt,
    created_at: note.createdAt,
    user: userId,
  };
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
}

async function performSync(userId: string): Promise<SyncResult> {
  const localNotes = await getAllNotes(userId);
  const remoteNotes = await pb.collection('notes').getFullList<RemoteNote>({
    filter: `user = "${userId}"`,
  });

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;
  let failedPushes = 0;
  const pushedNoteIds = new Set<string>();

  // Push dirty local notes unless the fetched remote version is newer
  for (const localNote of localNotes) {
    if (!localNote.dirty) continue;
    const existing = remoteNotes.find((r) => r.client_id === localNote.id);
    if (existing && existing.updated_at > localNote.updatedAt) continue;
    const data = toRemoteData(localNote, userId);
    try {
      let remoteId = localNote.remoteId;
      if (remoteId) {
        await pb.collection('notes').update(remoteId, data);
      } else {
        if (existing) {
          remoteId = existing.id;
          await pb.collection('notes').update(remoteId, data);
        } else {
          const created = await pb.collection('notes').create(data);
          remoteId = created.id;
        }
      }
      await markNoteSynced(
        userId,
        localNote.id,
        remoteId,
        localNote.localRevision,
      );
      pushedNoteIds.add(localNote.id);
      pushed++;
    } catch (err) {
      failedPushes++;
      console.error('Sync: failed to push note', localNote.id, err);
    }
  }

  // Pull and reconcile remote notes, excluding freshly pushed snapshots
  for (const remote of remoteNotes) {
    if (pushedNoteIds.has(remote.client_id)) continue;
    const local = localNotes.find((n) => n.id === remote.client_id);

    if (!local) {
      if (!remote.deleted) {
        const written = await putRemoteNote(toLocalNote(remote, userId));
        if (written) pulled++;
      }
    } else if (local.dirty) {
      if (remote.updated_at > local.updatedAt) {
        if (local.title || local.body) {
          await addRevision({
            ownerId: userId,
            noteId: local.id,
            title: local.title,
            body: local.body,
            savedAt: Date.now(),
          });
        }
        const written = await putRemoteNote(
          toLocalNote(remote, userId),
          local.localRevision,
        );
        if (written) conflicts++;
      }
    } else {
      if (remote.updated_at > local.updatedAt || local.remoteId !== remote.id) {
        const written = await putRemoteNote(
          toLocalNote(remote, userId),
          local.localRevision,
        );
        if (written) pulled++;
      }
      if (remote.deleted && !local.deleted) {
        await deleteNoteLocal(userId, local.id, local.localRevision);
        pulled++;
      }
    }
  }

  // Cleanup: hard-delete local notes that are deleted and synced
  for (const localNote of localNotes) {
    if (localNote.deleted && (!localNote.dirty || pushedNoteIds.has(localNote.id))) {
      await deleteNoteLocal(userId, localNote.id, localNote.localRevision);
    }
  }

  if (failedPushes > 0) {
    throw new Error(
      `Sync: ${failedPushes} note${failedPushes === 1 ? '' : 's'} failed to push`,
    );
  }

  return { pushed, pulled, conflicts };
}

const syncQueues = new Map<string, Promise<void>>();

export async function syncNotes(userId: string): Promise<SyncResult> {
  const previous = syncQueues.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  syncQueues.set(userId, current);

  await previous;
  try {
    return await performSync(userId);
  } finally {
    release();
    if (syncQueues.get(userId) === current) syncQueues.delete(userId);
  }
}

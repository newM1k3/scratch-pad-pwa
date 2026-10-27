import pb from './pocketbase';
import type { LocalNote, NoteColor } from './types';
import { getAllNotes, putNote, deleteNoteLocal, addRevision } from './db';

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

function toLocalNote(r: RemoteNote): LocalNote {
  return {
    id: r.client_id,
    remoteId: r.id,
    title: r.title ?? '',
    body: r.body ?? '',
    color: (r.color as NoteColor) ?? 'default',
    pinned: r.pinned ?? false,
    archived: r.archived ?? false,
    deleted: r.deleted ?? false,
    updatedAt: r.updated_at ?? 0,
    createdAt: r.created_at ?? 0,
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

export async function syncNotes(userId: string): Promise<SyncResult> {
  const localNotes = await getAllNotes();
  const remoteNotes = await pb.collection('notes').getFullList<RemoteNote>({
    filter: `user = "${userId}"`,
  });

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  // Push dirty local notes
  for (const localNote of localNotes) {
    if (!localNote.dirty) continue;
    const data = toRemoteData(localNote, userId);
    try {
      if (localNote.remoteId) {
        await pb.collection('notes').update(localNote.remoteId, data);
      } else {
        const existing = remoteNotes.find((r) => r.client_id === localNote.id);
        if (existing) {
          await pb.collection('notes').update(existing.id, data);
          localNote.remoteId = existing.id;
        } else {
          const created = await pb.collection('notes').create(data);
          localNote.remoteId = created.id;
        }
      }
      localNote.dirty = false;
      await putNote(localNote);
      pushed++;
    } catch (err) {
      console.error('Sync: failed to push note', localNote.id, err);
    }
  }

  // Pull and reconcile remote notes
  for (const remote of remoteNotes) {
    const local = localNotes.find((n) => n.id === remote.client_id);

    if (!local) {
      if (!remote.deleted) {
        await putNote(toLocalNote(remote));
        pulled++;
      }
    } else if (local.dirty) {
      if (remote.updated_at > local.updatedAt) {
        if (local.title || local.body) {
          await addRevision({
            noteId: local.id,
            title: local.title,
            body: local.body,
            savedAt: Date.now(),
          });
        }
        await putNote({ ...toLocalNote(remote), remoteId: remote.id });
        conflicts++;
      }
    } else {
      if (remote.updated_at > local.updatedAt || local.remoteId !== remote.id) {
        await putNote({ ...toLocalNote(remote), remoteId: remote.id });
        pulled++;
      }
      if (remote.deleted && !local.deleted) {
        await deleteNoteLocal(local.id);
        pulled++;
      }
    }
  }

  // Cleanup: hard-delete local notes that are deleted and synced
  for (const localNote of localNotes) {
    if (localNote.deleted && !localNote.dirty) {
      await deleteNoteLocal(localNote.id);
    }
  }

  return { pushed, pulled, conflicts };
}

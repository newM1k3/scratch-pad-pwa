import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalNote } from './types';

const pocketbase = vi.hoisted(() => ({
  getFullList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  collection: vi.fn(),
}));

vi.mock('./pocketbase', () => ({
  default: { collection: pocketbase.collection },
}));

function createTestNote(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    ownerId: 'user-a',
    remoteId: 'remote-1',
    title: 'Title',
    body: 'Body',
    color: 'default',
    pinned: false,
    archived: false,
    deleted: false,
    updatedAt: 100,
    createdAt: 50,
    localRevision: 1,
    dirty: false,
    ...overrides,
  };
}

function remoteFor(note: LocalNote) {
  return {
    id: note.remoteId ?? 'remote-1',
    client_id: note.id,
    title: note.title,
    body: note.body,
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
    deleted: note.deleted,
    updated_at: note.updatedAt,
    created_at: note.createdAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function loadModules() {
  const db = await import('./db');
  const { syncNotes } = await import('./sync');
  return { ...db, syncNotes };
}

describe('account isolation and sync races', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
    pocketbase.collection.mockReturnValue({
      getFullList: pocketbase.getFullList,
      create: pocketbase.create,
      update: pocketbase.update,
    });
    pocketbase.getFullList.mockResolvedValue([]);
    pocketbase.create.mockImplementation(async (data) => ({
      id: `remote-${data.client_id}`,
    }));
    pocketbase.update.mockResolvedValue({});
  });

  it('does not read or push another owner notes', async () => {
    const { putNote, getAllNotes, syncNotes } = await loadModules();
    await putNote(createTestNote({ id: 'a', ownerId: 'user-a', remoteId: null, dirty: true }));
    await putNote(createTestNote({ id: 'b', ownerId: 'user-b', remoteId: null, dirty: true }));

    await syncNotes('user-a');

    expect(pocketbase.create).toHaveBeenCalledTimes(1);
    expect(pocketbase.create.mock.calls[0][0]).toMatchObject({
      client_id: 'a',
      user: 'user-a',
    });
    expect((await getAllNotes('user-a')).map((note) => note.id)).toEqual(['a']);
    expect((await getAllNotes('user-b')).map((note) => note.id)).toEqual(['b']);
  });

  it('scopes revisions to their owner', async () => {
    const { addRevision, getRevisions } = await loadModules();
    await addRevision({
      ownerId: 'user-a',
      noteId: 'note-1',
      title: 'Private',
      body: 'Owner A only',
      savedAt: 100,
    });

    expect(await getRevisions('user-a', 'note-1')).toHaveLength(1);
    expect(await getRevisions('user-b', 'note-1')).toEqual([]);
  });

  it('keeps legacy unowned records hidden from every account', async () => {
    const { putNote, getAllNotes } = await loadModules();
    const legacy = createTestNote();
    delete (legacy as Partial<LocalNote>).ownerId;
    await putNote(legacy);

    expect(await getAllNotes('user-a')).toEqual([]);
    expect(await getAllNotes('user-b')).toEqual([]);
  });

  it('keeps an edit made while its push is pending', async () => {
    const { putNote, getAllNotes, syncNotes } = await loadModules();
    const original = createTestNote({ dirty: true });
    const push = deferred<Record<string, never>>();
    pocketbase.update.mockReturnValueOnce(push.promise);
    await putNote(original);

    const syncing = syncNotes(original.ownerId);
    await vi.waitFor(() => expect(pocketbase.update).toHaveBeenCalledOnce());
    await putNote({
      ...original,
      body: 'new edit',
      dirty: true,
      localRevision: 2,
      updatedAt: 200,
    });
    push.resolve({});
    await syncing;

    expect((await getAllNotes(original.ownerId))[0]).toMatchObject({
      body: 'new edit',
      dirty: true,
      localRevision: 2,
      remoteId: original.remoteId,
    });
  });

  it('does not overwrite an edit made while remote notes are loading', async () => {
    const { putNote, getAllNotes, syncNotes } = await loadModules();
    const original = createTestNote();
    const pull = deferred<ReturnType<typeof remoteFor>[]>();
    pocketbase.getFullList.mockReturnValueOnce(pull.promise);
    await putNote(original);

    const syncing = syncNotes(original.ownerId);
    await vi.waitFor(() => expect(pocketbase.getFullList).toHaveBeenCalledOnce());
    await putNote({
      ...original,
      body: 'new edit',
      dirty: true,
      localRevision: 2,
      updatedAt: 200,
    });
    pull.resolve([
      {
        ...remoteFor(original),
        body: 'stale remote body',
        updated_at: original.updatedAt + 50,
      },
    ]);
    await syncing;

    expect((await getAllNotes(original.ownerId))[0]).toMatchObject({
      body: 'new edit',
      dirty: true,
      localRevision: 2,
    });
  });

  it('lets a newer remote version win before an older dirty note is pushed', async () => {
    const { putNote, getAllNotes, getRevisions, syncNotes } = await loadModules();
    const local = createTestNote({
      body: 'older local edit',
      dirty: true,
      updatedAt: 100,
    });
    const remote = {
      ...remoteFor(local),
      body: 'newer remote edit',
      updated_at: 200,
    };
    let serverBody = remote.body;
    pocketbase.getFullList.mockImplementation(async () => [
      { ...remote, body: serverBody },
    ]);
    pocketbase.update.mockImplementation(async (_id, data) => {
      serverBody = data.body;
      return {};
    });
    await putNote(local);

    const result = await syncNotes(local.ownerId);

    expect(pocketbase.update).not.toHaveBeenCalled();
    expect(serverBody).toBe('newer remote edit');
    expect(result).toMatchObject({ pushed: 0, conflicts: 1 });
    expect((await getAllNotes(local.ownerId))[0]).toMatchObject({
      body: 'newer remote edit',
      dirty: false,
    });
    expect(await getRevisions(local.ownerId, local.id)).toHaveLength(1);

    await syncNotes(local.ownerId);
    expect((await getAllNotes(local.ownerId))[0].body).toBe('newer remote edit');
  });

  it('does not delete a newer revision during guarded cleanup', async () => {
    const { putNote, getAllNotes, deleteNoteLocal } = await loadModules();
    const current = createTestNote({ localRevision: 2 });
    await putNote(current);

    await deleteNoteLocal(current.ownerId, current.id, 1);

    expect((await getAllNotes(current.ownerId))[0]).toMatchObject({
      id: current.id,
      localRevision: 2,
    });
  });

  it('reports partial push failure and keeps the failed note dirty', async () => {
    const { putNote, getAllNotes, syncNotes } = await loadModules();
    const successful = createTestNote({
      id: 'successful',
      remoteId: 'remote-successful',
      dirty: true,
    });
    const failed = createTestNote({
      id: 'failed',
      remoteId: 'remote-failed',
      dirty: true,
    });
    await putNote(successful);
    await putNote(failed);
    pocketbase.update.mockImplementation(async (remoteId) => {
      if (remoteId === failed.remoteId) throw new Error('network unavailable');
      return {};
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(syncNotes(successful.ownerId)).rejects.toThrow(
      '1 note failed to push',
    );

    const notes = await getAllNotes(successful.ownerId);
    expect(notes.find((note) => note.id === successful.id)?.dirty).toBe(false);
    expect(notes.find((note) => note.id === failed.id)?.dirty).toBe(true);
  });

  it('serializes concurrent sync calls for the same owner', async () => {
    const { syncNotes } = await loadModules();
    let active = 0;
    let maximumActive = 0;
    pocketbase.getFullList.mockImplementation(async () => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return [];
    });

    await Promise.all([syncNotes('user-a'), syncNotes('user-a')]);

    expect(maximumActive).toBe(1);
    expect(pocketbase.getFullList).toHaveBeenCalledTimes(2);
  });
});

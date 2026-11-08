import { describe, expect, it } from 'vitest';
import type { LocalNote } from './types';
import * as utils from './utils';

function createTestNote(overrides: Partial<LocalNote> = {}): LocalNote {
  return {
    id: 'note-1',
    ownerId: 'user-a',
    remoteId: null,
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

describe('applyNoteUpdates', () => {
  it('increments the local revision and preserves ownership', () => {
    const original = createTestNote({ localRevision: 3 });

    const updated = utils.applyNoteUpdates(original, { title: 'next' }, 1234);

    expect(updated).toMatchObject({
      ownerId: 'user-a',
      localRevision: 4,
      title: 'next',
      updatedAt: 1234,
      dirty: true,
    });
  });

  it('does not allow an update to change the owner or revision', () => {
    const original = createTestNote({ localRevision: 3 });

    const updated = utils.applyNoteUpdates(original, {
      ownerId: 'user-b',
      localRevision: 99,
    });

    expect(updated.ownerId).toBe('user-a');
    expect(updated.localRevision).toBe(4);
  });
});

describe('restoreDeletedNote', () => {
  it('revives a tombstone as a dirty edit with a fresh revision', () => {
    const tombstone = createTestNote({
      deleted: true,
      dirty: true,
      localRevision: 5,
    });

    const restored = utils.restoreDeletedNote(tombstone, 1234);

    expect(restored).toMatchObject({
      id: 'note-1',
      ownerId: 'user-a',
      deleted: false,
      dirty: true,
      localRevision: 6,
      updatedAt: 1234,
    });
  });
});

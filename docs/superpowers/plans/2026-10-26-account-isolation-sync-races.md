# Account Isolation and Sync Races Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prevent cross-account local data access and stop in-flight sync operations from overwriting newer local edits, with regression coverage.

**Architecture:** Add owner and local-revision metadata to local records. Scope every IndexedDB operation by owner, queue sync runs per owner, and use transactional revision checks when sync writes back local state.

**Tech Stack:** React 18, TypeScript, IndexedDB, PocketBase, Vitest, fake-indexeddb

## Global Constraints

- Do not change the PocketBase collection schema or existing remote timestamp conflict policy.
- Existing unowned records remain preserved but hidden; never auto-assign them to the next signed-in user.
- Local revisions are local-only and must not be sent to PocketBase.
- The workspace copy has no Git metadata, so commit steps are not executable in this environment.

---

### Task 1: Regression-test infrastructure and reproductions

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/lib/sync.test.ts`
- Create: `src/lib/utils.test.ts`

**Interfaces:**
- Produces: `npm test` running Vitest; `createTestNote(overrides?: Partial<LocalNote>): LocalNote` local to the test file; deferred PocketBase responses for race reproductions.

- [x] **Step 1: Add test dependencies and scripts**

Run:

```bash
npm install --save-dev vitest fake-indexeddb
```

Set these scripts in `package.json`:

```json
"test": "vitest run",
"check": "npm run typecheck && npm run test && npm run build"
```

- [x] **Step 2: Configure Vitest through the existing Vite config**

Add the alias-compatible test defaults without changing the React plugin:

```ts
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: { exclude: ['lucide-react'] },
  test: { environment: 'node', restoreMocks: true },
});
```

Use `defineConfig` from `vitest/config` so the `test` property is typed.

- [x] **Step 3: Write failing account-isolation and sync-race tests**

In `src/lib/sync.test.ts`, import `fake-indexeddb/auto`, mock `./pocketbase`, reset IndexedDB before each test, and cover:

```ts
it('does not read or push another owner notes', async () => {
  await putNote(createTestNote({ ownerId: 'user-a', id: 'a', dirty: true }));
  await putNote(createTestNote({ ownerId: 'user-b', id: 'b', dirty: true }));
  await syncNotes('user-a');
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0][0]).toMatchObject({ client_id: 'a', user: 'user-a' });
  expect(await getAllNotes('user-b')).toHaveLength(1);
});

it('keeps an edit made while its push is pending', async () => {
  const original = createTestNote({ dirty: true, localRevision: 1 });
  await putNote(original);
  update.mockReturnValueOnce(push.promise);
  const syncing = syncNotes(original.ownerId);
  await putNote({ ...original, body: 'new edit', dirty: true, localRevision: 2 });
  push.resolve({});
  await syncing;
  expect((await getAllNotes(original.ownerId))[0]).toMatchObject({
    body: 'new edit', dirty: true, localRevision: 2,
  });
});

it('does not overwrite an edit made while remote notes are loading', async () => {
  const original = createTestNote({ remoteId: 'remote-1', dirty: false, localRevision: 1 });
  await putNote(original);
  getFullList.mockReturnValueOnce(pull.promise);
  const syncing = syncNotes(original.ownerId);
  await putNote({ ...original, body: 'new edit', dirty: true, localRevision: 2 });
  pull.resolve([{ ...remoteNote, updated_at: original.updatedAt + 1000 }]);
  await syncing;
  expect((await getAllNotes(original.ownerId))[0].body).toBe('new edit');
});
```

Add a concurrency test whose PocketBase `getFullList` implementation tracks active calls and asserts a maximum of one for two simultaneous `syncNotes('user-a')` calls.

- [x] **Step 4: Write the failing local-mutation test**

In `src/lib/utils.test.ts` verify the pure mutation helper:

```ts
const updated = applyNoteUpdates(createTestNote({ localRevision: 3 }), { title: 'next' }, 1234);
expect(updated).toMatchObject({
  ownerId: 'user-a', localRevision: 4, title: 'next', updatedAt: 1234, dirty: true,
});
```

- [x] **Step 5: Run tests and confirm the intended failures**

Run: `npm test`

Expected: FAIL because owner-scoped database APIs, revision guards, sync serialization, and `applyNoteUpdates` do not exist yet.

### Task 2: Owner-scoped local storage and mutations

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/db.ts`
- Modify: `src/lib/utils.ts`
- Modify: `src/hooks/useNotes.ts`
- Test: `src/lib/sync.test.ts`
- Test: `src/lib/utils.test.ts`

**Interfaces:**
- Produces: `getAllNotes(ownerId: string): Promise<LocalNote[]>`
- Produces: `deleteNoteLocal(ownerId: string, id: string, expectedRevision?: number): Promise<void>`
- Produces: `getRevisions(ownerId: string, noteId: string): Promise<Revision[]>`
- Produces: `applyNoteUpdates(note: LocalNote, updates: Partial<LocalNote>, now?: number): LocalNote`

- [x] **Step 1: Add local metadata to the types**

```ts
export interface LocalNote extends Note {
  ownerId: string;
  localRevision: number;
  dirty: boolean;
}

export interface Revision {
  id?: number;
  ownerId: string;
  noteId: string;
  title: string;
  body: string;
  savedAt: number;
}
```

- [x] **Step 2: Scope local reads and deletion**

Filter `getAll()` results with `note.ownerId === ownerId`. Filter revision results by both owner and note. In deletion, re-read the record and delete only when its owner matches and, when supplied, its `localRevision` equals `expectedRevision`.

- [x] **Step 3: Centralize revision-incrementing local mutation**

Add to `src/lib/utils.ts`:

```ts
export function applyNoteUpdates(
  note: LocalNote,
  updates: Partial<LocalNote>,
  now = Date.now(),
): LocalNote {
  return {
    ...note,
    ...updates,
    ownerId: note.ownerId,
    localRevision: note.localRevision + 1,
    updatedAt: now,
    dirty: true,
  };
}
```

- [x] **Step 4: Scope the notes hook to the authenticated owner**

Pass `userId` to every local read, include it in `loadNotes` dependencies, clear notes and active selection when it changes, and require it for note creation. Initialize new notes with `ownerId: userId` and `localRevision: 1`. Route title/body/color/pin/archive/delete mutations through `applyNoteUpdates`.

- [x] **Step 5: Run owner and mutation tests**

Run: `npm test -- src/lib/sync.test.ts src/lib/utils.test.ts`

Expected: owner-isolation and mutation tests PASS; stale-write and concurrency tests still FAIL.

### Task 3: Guarded, per-owner serialized sync

**Files:**
- Modify: `src/lib/db.ts`
- Modify: `src/lib/sync.ts`
- Test: `src/lib/sync.test.ts`

**Interfaces:**
- Produces: `markNoteSynced(ownerId: string, id: string, remoteId: string, expectedRevision: number): Promise<void>`
- Produces: `putRemoteNote(note: LocalNote, expectedRevision?: number): Promise<boolean>`
- Produces: serialized `syncNotes(userId: string): Promise<SyncResult>`

- [x] **Step 1: Add transactional sync-write guards**

`markNoteSynced` re-reads the current note in one readwrite transaction. It always preserves a newer revision; when the revision matches it writes `remoteId` and `dirty: false`. When the revision differs it may merge only `remoteId`, retaining current content and `dirty: true`.

`putRemoteNote` re-reads the current record and refuses to write when ownership differs or `expectedRevision` is supplied and differs. Return `true` only when a write occurred.

- [x] **Step 2: Use guarded writes throughout reconciliation**

Convert remote records with `toLocalNote(remote, userId)` and `localRevision: 0` for newly pulled records. For existing records, pass the snapshot revision to `putRemoteNote`; preserve the current local revision when replacing a snapshot. Add conflict revisions with `ownerId`. Pass owner and expected revision to cleanup deletion.

After a successful push, call:

```ts
await markNoteSynced(userId, localNote.id, remoteId, localNote.localRevision);
```

Do not write the stale `localNote` object back to IndexedDB.

- [x] **Step 3: Serialize sync per owner**

Rename the current implementation to `performSync`. Wrap it with a per-owner promise queue so each call starts after the previous call for that owner finishes, releases its queue slot in `finally`, and still returns its own `SyncResult`.

- [x] **Step 4: Run the complete regression suite**

Run: `npm test`

Expected: all account-isolation, stale-write, revision-mutation, and concurrency tests PASS.

### Task 4: Full verification

**Files:**
- Verify all modified files; no additional production scope.

**Interfaces:**
- Consumes the completed implementation and regression suite.

- [x] **Step 1: Run static checks and tests**

Run: `npm run typecheck && npm test && npm run lint`

Expected: all commands exit 0. Remove the pre-existing unused `setColor` and `deleteNoteLocal` bindings if they remain unused after the focused changes.

- [x] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite exits 0 and emits `dist/`.

- [x] **Step 3: Audit the final diff scope**

Use `git diff` only if Git metadata becomes available; otherwise inspect the modified files directly. Confirm there are no PocketBase schema changes, no remote `localRevision` field, and no unrelated refactors.

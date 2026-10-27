# Account isolation and sync-race design

## Scope

Fix two reviewed defects without changing the remote PocketBase schema or conflict-resolution policy:

1. IndexedDB notes and revisions are shared across accounts on the same browser origin.
2. Sync writes stale whole-note snapshots and can overwrite edits made while network requests are in flight; concurrent syncs for one account are also uncoordinated.

Failed-push status reporting and the separate pre-push conflict-snapshot defect are outside this change.

## Approaches considered

- **Scoped records and guarded writes (selected):** Add ownership and local revision metadata, filter every local read by owner, serialize sync per owner, and make sync's local writes conditional on the snapshot revision. This preserves the current architecture and limits the change to the data and sync layers.
- **One IndexedDB database per account:** Provides physical separation but requires a database lifecycle and migration strategy, and does not by itself prevent stale sync writes.
- **Operation-log synchronization:** Could provide stronger guarantees but would replace the current synchronization design and is disproportionate to these two fixes.

## Local data model

`LocalNote` gains `ownerId: string` and `localRevision: number`. `Revision` gains `ownerId: string`. New notes start at revision 1; every local mutation increments the revision and marks the note dirty.

All note reads require an owner ID. Revision reads require both owner and note IDs. Local deletion and sync cleanup verify ownership. Existing records without ownership metadata remain in IndexedDB but are not returned for any account; automatically claiming them for the next signed-in account would be unsafe.

## Sync concurrency and stale-write protection

Sync calls are queued per owner so only one synchronization for that account reads and reconciles local state at a time. Different owners remain independent.

A sync run retains the `localRevision` of each snapshot it pushes or pulls. Local completion writes execute in readwrite transactions that re-read the current record:

- Marking a pushed note clean updates `remoteId` and clears `dirty` only when the current revision still equals the pushed revision. A newer edit remains dirty with its contents intact.
- Applying a pulled remote note requires the current local revision to match the snapshot revision. If the user edited meanwhile, the pull is skipped.
- Conflict replacement uses the same revision guard after saving the snapshot as a revision.
- Cleanup deletes only the snapshot revision that was confirmed deleted and clean.

Remote data continues to use PocketBase timestamps and the existing last-write-wins policy. Local revisions are never sent to PocketBase.

## UI state on authentication changes

The notes hook loads only the current owner's records. When the owner changes or signs out, note selection and visible note state are reset before records for the newly selected owner are loaded. New and updated notes retain the current owner and increment local revisions.

## Regression tests

Use Vitest and `fake-indexeddb` to test the real local database and sync modules with PocketBase mocked:

1. One account cannot read or sync another account's notes or revisions.
2. Legacy unowned records remain hidden.
3. An edit made while a push is pending survives and remains dirty.
4. An edit made while a pull is pending is not overwritten by the pulled snapshot.
5. Two sync calls for one account do not execute concurrently.
6. Local mutations increment `localRevision` and preserve ownership.

Verification also runs TypeScript, ESLint, and the production build.

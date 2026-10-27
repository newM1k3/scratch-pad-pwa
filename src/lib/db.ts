import type { LocalNote, Revision } from './types';

const DB_NAME = 'scratchpad';
const DB_VERSION = 1;
const NOTES_STORE = 'notes';
const REVISIONS_STORE = 'revisions';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(NOTES_STORE)) {
        db.createObjectStore(NOTES_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(REVISIONS_STORE)) {
        const store = db.createObjectStore(REVISIONS_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('noteId', 'noteId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function getAllNotes(ownerId: string): Promise<LocalNote[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readonly');
    const req = tx.objectStore(NOTES_STORE).getAll();
    req.onsuccess = () => {
      const notes = (req.result as LocalNote[]).filter(
        (note) => note.ownerId === ownerId,
      );
      resolve(notes);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function putNote(note: LocalNote): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    tx.objectStore(NOTES_STORE).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function markNoteSynced(
  ownerId: string,
  id: string,
  remoteId: string,
  expectedRevision: number,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    const store = tx.objectStore(NOTES_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const current = req.result as LocalNote | undefined;
      if (!current || current.ownerId !== ownerId) return;
      store.put({
        ...current,
        remoteId,
        dirty: current.localRevision === expectedRevision ? false : current.dirty,
      });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function putRemoteNote(
  note: LocalNote,
  expectedRevision?: number,
): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let written = false;
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    const store = tx.objectStore(NOTES_STORE);
    const req = store.get(note.id);
    req.onsuccess = () => {
      const current = req.result as LocalNote | undefined;
      if (current && current.ownerId !== note.ownerId) return;
      if (current && expectedRevision === undefined) return;
      if (
        current &&
        expectedRevision !== undefined &&
        current.localRevision !== expectedRevision
      ) {
        return;
      }
      store.put({
        ...note,
        localRevision: current?.localRevision ?? note.localRevision,
      });
      written = true;
    };
    tx.oncomplete = () => resolve(written);
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteNoteLocal(
  ownerId: string,
  id: string,
  expectedRevision?: number,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    const store = tx.objectStore(NOTES_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const note = req.result as LocalNote | undefined;
      if (note?.ownerId !== ownerId) return;
      if (
        expectedRevision !== undefined &&
        note.localRevision !== expectedRevision
      ) {
        return;
      }
      store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function addRevision(rev: Omit<Revision, 'id'>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REVISIONS_STORE, 'readwrite');
    tx.objectStore(REVISIONS_STORE).add(rev);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getRevisions(ownerId: string, noteId: string): Promise<Revision[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REVISIONS_STORE, 'readonly');
    const index = tx.objectStore(REVISIONS_STORE).index('noteId');
    const req = index.getAll(noteId);
    req.onsuccess = () => {
      const revisions = (req.result as Revision[]).filter(
        (revision) => revision.ownerId === ownerId,
      );
      resolve(revisions);
    };
    req.onerror = () => reject(req.error);
  });
}

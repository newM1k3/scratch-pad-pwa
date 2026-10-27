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

export async function getAllNotes(): Promise<LocalNote[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readonly');
    const req = tx.objectStore(NOTES_STORE).getAll();
    req.onsuccess = () => resolve(req.result as LocalNote[]);
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

export async function deleteNoteLocal(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTES_STORE, 'readwrite');
    tx.objectStore(NOTES_STORE).delete(id);
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

export async function getRevisions(noteId: string): Promise<Revision[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REVISIONS_STORE, 'readonly');
    const index = tx.objectStore(REVISIONS_STORE).index('noteId');
    const req = index.getAll(noteId);
    req.onsuccess = () => resolve(req.result as Revision[]);
    req.onerror = () => reject(req.error);
  });
}

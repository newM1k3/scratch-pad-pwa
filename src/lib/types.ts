export type NoteColor = 'default' | 'yellow' | 'pink' | 'green' | 'blue' | 'orange';

export interface Note {
  id: string;
  remoteId: string | null;
  title: string;
  body: string;
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  deleted: boolean;
  updatedAt: number;
  createdAt: number;
}

export interface LocalNote extends Note {
  ownerId: string;
  localRevision: number;
  dirty: boolean;
}

export type SyncStatus = 'synced' | 'offline' | 'syncing' | 'error';

export type FilterType = 'all' | 'pinned' | 'archived';

export interface Revision {
  id?: number;
  ownerId: string;
  noteId: string;
  title: string;
  body: string;
  savedAt: number;
}

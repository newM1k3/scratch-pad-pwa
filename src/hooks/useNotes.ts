import { useState, useEffect, useCallback, useRef } from 'react';
import type { LocalNote, NoteColor, FilterType, SyncStatus } from '@/lib/types';
import { getAllNotes, putNote } from '@/lib/db';
import { syncNotes } from '@/lib/sync';
import { applyNoteUpdates, generateId } from '@/lib/utils';

export function useNotes(userId: string | undefined, isOnline: boolean) {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGeneration = useRef(0);
  const ownerRef = useRef(userId);
  ownerRef.current = userId;

  const loadNotes = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!userId) {
      setNotes([]);
      setActiveId(null);
      return;
    }
    const all = await getAllNotes(userId);
    if (generation !== loadGeneration.current) return;
    const visible = all.filter((n) => !n.deleted);
    visible.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    setNotes(visible);
    if (!activeId && visible.length > 0) {
      setActiveId(visible[0].id);
    }
  }, [activeId, userId]);

  useEffect(() => {
    setNotes([]);
    setActiveId(null);
  }, [userId]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [userId]);

  const runSync = useCallback(async () => {
    if (!userId || !isOnline) {
      setSyncStatus(isOnline ? 'synced' : 'offline');
      return;
    }
    setSyncStatus('syncing');
    try {
      await syncNotes(userId);
      await loadNotes();
      setSyncStatus('synced');
    } catch (err) {
      console.error('Sync failed', err);
      setSyncStatus('error');
    }
  }, [userId, isOnline, loadNotes]);

  useEffect(() => {
    if (isOnline && userId) {
      runSync();
    } else {
      setSyncStatus('offline');
    }
  }, [isOnline, userId, runSync]);

  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      if (isOnline && userId) runSync();
    }, 3000);
  }, [isOnline, userId, runSync]);

  const createNote = useCallback(async () => {
    if (!userId) throw new Error('Cannot create a note without an authenticated user');
    const now = Date.now();
    const note: LocalNote = {
      id: generateId(),
      ownerId: userId,
      remoteId: null,
      title: '',
      body: '',
      color: 'default',
      pinned: false,
      archived: false,
      deleted: false,
      updatedAt: now,
      createdAt: now,
      localRevision: 1,
      dirty: true,
    };
    await putNote(note);
    if (ownerRef.current !== userId) return note;
    setNotes((prev) => [note, ...prev]);
    setActiveId(note.id);
    return note;
  }, [userId]);

  const updateNote = useCallback(
    async (id: string, updates: Partial<LocalNote>) => {
      setNotes((prev) => {
        const next = prev.map((n) =>
          n.id === id ? applyNoteUpdates(n, updates) : n
        );
        const updated = next.find((n) => n.id === id);
        if (updated) putNote(updated);
        return next;
      });
      scheduleSync();
    },
    [scheduleSync]
  );

  const togglePin = useCallback(
    (id: string) => {
      setNotes((prev) => {
        const note = prev.find((n) => n.id === id);
        if (!note) return prev;
        const updated = applyNoteUpdates(note, { pinned: !note.pinned });
        putNote(updated);
        return prev.map((n) => (n.id === id ? updated : n));
      });
      scheduleSync();
    },
    [scheduleSync]
  );

  const archiveNote = useCallback(
    (id: string) => {
      setNotes((prev) => {
        const note = prev.find((n) => n.id === id);
        if (!note) return prev;
        const updated = applyNoteUpdates(note, { archived: !note.archived });
        putNote(updated);
        return prev.map((n) => (n.id === id ? updated : n));
      });
      scheduleSync();
    },
    [scheduleSync]
  );

  const setColor = useCallback(
    (id: string, color: NoteColor) => {
      updateNote(id, { color });
    },
    [updateNote]
  );

  const deleteNote = useCallback(
    async (id: string) => {
      setNotes((prev) => {
        const note = prev.find((n) => n.id === id);
        if (!note) return prev;
        const updated = applyNoteUpdates(note, { deleted: true });
        putNote(updated);
        return prev.filter((n) => n.id !== id);
      });
      if (activeId === id) {
        const remaining = notes.filter((n) => n.id !== id);
        setActiveId(remaining.length > 0 ? remaining[0].id : null);
      }
      scheduleSync();
    },
    [activeId, notes, scheduleSync]
  );

  const filteredNotes = notes.filter((n) => {
    if (n.ownerId !== userId) return false;
    if (filter === 'pinned' && !n.pinned) return false;
    if (filter === 'archived' && !n.archived) return false;
    if (filter === 'all' && n.archived) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeNote = notes.find((n) => n.id === activeId && n.ownerId === userId) ?? null;

  return {
    notes: filteredNotes,
    activeNote,
    activeId,
    setActiveId,
    syncStatus,
    filter,
    setFilter,
    search,
    setSearch,
    createNote,
    updateNote,
    togglePin,
    archiveNote,
    setColor,
    deleteNote,
    runSync,
  };
}

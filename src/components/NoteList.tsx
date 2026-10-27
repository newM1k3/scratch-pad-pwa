import { Pin, Archive, Trash2, Plus, Search, NotebookPen } from 'lucide-react';
import type { LocalNote, FilterType } from '@/lib/types';
import { getColorClasses } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/utils';

interface NoteListProps {
  notes: LocalNote[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onTogglePin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  filter: FilterType;
  setFilter: (f: FilterType) => void;
  search: string;
  setSearch: (s: string) => void;
}

export function NoteList({
  notes,
  activeId,
  onSelect,
  onCreate,
  onTogglePin,
  onArchive,
  onDelete,
  filter,
  setFilter,
  search,
  setSearch,
}: NoteListProps) {
  const filters: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pinned', label: 'Pinned' },
    { id: 'archived', label: 'Archived' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-10 pr-3 py-2 text-sm bg-stone-100 border border-transparent rounded-lg focus:outline-none focus:bg-white focus:border-stone-300 focus:ring-2 focus:ring-stone-900/5 transition-all"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-all ${
              filter === f.id
                ? 'bg-stone-900 text-white'
                : 'text-stone-500 hover:bg-stone-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* New note button */}
      <div className="px-4 py-2">
        <button
          onClick={onCreate}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-stone-700 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 hover:border-stone-300 transition-all"
        >
          <Plus className="w-4 h-4" />
          New Note
        </button>
      </div>

      {/* Note list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-stone-400 py-12">
            <NotebookPen className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm">No notes yet</p>
            <p className="text-xs mt-1">Create one to get started</p>
          </div>
        ) : (
          notes.map((note) => {
            const colors = getColorClasses(note.color);
            const isActive = note.id === activeId;
            return (
              <div
                key={note.id}
                onClick={() => onSelect(note.id)}
                className={`group relative cursor-pointer rounded-xl border p-3 transition-all ${
                  isActive
                    ? `${colors.card} ${colors.border} ring-2 ${colors.ring} ring-opacity-30 shadow-sm`
                    : `${colors.card} ${colors.border} hover:shadow-sm hover:border-stone-300`
                }`}
              >
                {note.pinned && (
                  <Pin className="absolute top-2.5 right-2.5 w-3.5 h-3.5 text-stone-400 fill-stone-400" />
                )}
                <h3 className="text-sm font-medium text-stone-800 truncate pr-6 mb-1">
                  {note.title || 'Untitled'}
                </h3>
                <p className="text-xs text-stone-500 line-clamp-2 mb-2">
                  {note.body || 'No additional text'}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-stone-400">
                    {formatRelativeTime(note.updatedAt)}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(note.id);
                      }}
                      className="p-1 rounded hover:bg-stone-200/50 text-stone-500"
                      title={note.pinned ? 'Unpin' : 'Pin'}
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onArchive(note.id);
                      }}
                      className="p-1 rounded hover:bg-stone-200/50 text-stone-500"
                      title="Archive"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(note.id);
                      }}
                      className="p-1 rounded hover:bg-rose-100 text-stone-500 hover:text-rose-600"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

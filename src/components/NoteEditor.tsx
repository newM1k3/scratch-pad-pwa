import { useState, useRef, useEffect } from 'react';
import { Pin, Archive, Trash2, Palette, ChevronLeft, Check } from 'lucide-react';
import type { LocalNote, NoteColor } from '@/lib/types';
import { NOTE_COLORS, getColorClasses } from '@/lib/constants';
import { formatRelativeTime } from '@/lib/utils';

interface NoteEditorProps {
  note: LocalNote | null;
  onUpdate: (id: string, updates: Partial<LocalNote>) => void;
  onTogglePin: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

export function NoteEditor({
  note,
  onUpdate,
  onTogglePin,
  onArchive,
  onDelete,
  onBack,
}: NoteEditorProps) {
  const [showColors, setShowColors] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textareas
  useEffect(() => {
    if (titleRef.current) {
      titleRef.current.style.height = 'auto';
      titleRef.current.style.height = titleRef.current.scrollHeight + 'px';
    }
  }, [note?.title]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto';
      bodyRef.current.style.height = bodyRef.current.scrollHeight + 'px';
    }
  }, [note?.body]);

  if (!note) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-stone-400">
        <div className="w-16 h-16 rounded-2xl bg-stone-100 flex items-center justify-center mb-4">
          <Pin className="w-8 h-8 opacity-30" />
        </div>
        <p className="text-sm font-medium text-stone-500">No note selected</p>
        <p className="text-xs mt-1">Choose a note from the list or create a new one</p>
      </div>
    );
  }

  const colors = getColorClasses(note.color);

  return (
    <div className={`flex flex-col h-full ${colors.card} transition-colors duration-300`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/50">
        <div className="flex items-center gap-1">
          <button
            onClick={onBack}
            className="md:hidden p-2 rounded-lg hover:bg-stone-200/50 text-stone-600"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xs text-stone-400 ml-2">
            Edited {formatRelativeTime(note.updatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1 relative">
          {/* Color picker */}
          <div className="relative">
            <button
              onClick={() => setShowColors(!showColors)}
              className="p-2 rounded-lg hover:bg-stone-200/50 text-stone-600"
              title="Color"
            >
              <Palette className="w-4 h-4" />
            </button>
            {showColors && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg p-2 flex gap-1.5 z-10">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      onUpdate(note.id, { color: c.id as NoteColor });
                      setShowColors(false);
                    }}
                    className={`w-7 h-7 rounded-full ${c.dot} flex items-center justify-center hover:scale-110 transition-transform ${
                      note.color === c.id ? 'ring-2 ring-stone-900 ring-offset-1' : ''
                    }`}
                    title={c.label}
                  >
                    {note.color === c.id && (
                      <Check className="w-3.5 h-3.5 text-stone-700" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => onTogglePin(note.id)}
            className={`p-2 rounded-lg hover:bg-stone-200/50 transition-colors ${
              note.pinned ? 'text-stone-900' : 'text-stone-600'
            }`}
            title={note.pinned ? 'Unpin' : 'Pin'}
          >
            <Pin className={`w-4 h-4 ${note.pinned ? 'fill-stone-900' : ''}`} />
          </button>
          <button
            onClick={() => onArchive(note.id)}
            className="p-2 rounded-lg hover:bg-stone-200/50 text-stone-600"
            title="Archive"
          >
            <Archive className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(note.id)}
            className="p-2 rounded-lg hover:bg-rose-100 text-stone-600 hover:text-rose-600"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <textarea
          ref={titleRef}
          value={note.title}
          onChange={(e) => onUpdate(note.id, { title: e.target.value })}
          placeholder="Title"
          className="w-full bg-transparent text-xl font-semibold text-stone-900 placeholder-stone-300 resize-none focus:outline-none mb-3 leading-tight"
          rows={1}
        />
        <textarea
          ref={bodyRef}
          value={note.body}
          onChange={(e) => onUpdate(note.id, { body: e.target.value })}
          placeholder="Start writing..."
          className="w-full bg-transparent text-sm text-stone-700 placeholder-stone-300 resize-none focus:outline-none leading-relaxed"
          rows={1}
        />
      </div>
    </div>
  );
}

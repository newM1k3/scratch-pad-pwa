import type { NoteColor } from './types';

export interface ColorOption {
  id: NoteColor;
  label: string;
  dot: string;
  card: string;
  border: string;
  ring: string;
}

export const NOTE_COLORS: ColorOption[] = [
  { id: 'default', label: 'Default', dot: 'bg-white border border-stone-300', card: 'bg-white', border: 'border-stone-200', ring: 'ring-stone-400' },
  { id: 'yellow', label: 'Yellow', dot: 'bg-amber-200', card: 'bg-amber-50', border: 'border-amber-200/60', ring: 'ring-amber-400' },
  { id: 'pink', label: 'Pink', dot: 'bg-rose-200', card: 'bg-rose-50', border: 'border-rose-200/60', ring: 'ring-rose-400' },
  { id: 'green', label: 'Green', dot: 'bg-emerald-200', card: 'bg-emerald-50', border: 'border-emerald-200/60', ring: 'ring-emerald-400' },
  { id: 'blue', label: 'Blue', dot: 'bg-sky-200', card: 'bg-sky-50', border: 'border-sky-200/60', ring: 'ring-sky-400' },
  { id: 'orange', label: 'Orange', dot: 'bg-orange-200', card: 'bg-orange-50', border: 'border-orange-200/60', ring: 'ring-orange-400' },
];

export function getColorClasses(color: NoteColor): ColorOption {
  return NOTE_COLORS.find((c) => c.id === color) ?? NOTE_COLORS[0];
}

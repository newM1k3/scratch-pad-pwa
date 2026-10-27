import { Cloud, CloudOff, RefreshCw, AlertCircle } from 'lucide-react';
import type { SyncStatus } from '@/lib/types';

interface SyncBadgeProps {
  status: SyncStatus;
  onRetry: () => void;
}

export function SyncBadge({ status, onRetry }: SyncBadgeProps) {
  const config: Record<SyncStatus, { icon: typeof Cloud; label: string; className: string; spin?: boolean }> = {
    synced: { icon: Cloud, label: 'Synced', className: 'text-emerald-600 bg-emerald-50' },
    offline: { icon: CloudOff, label: 'Offline', className: 'text-stone-500 bg-stone-100' },
    syncing: { icon: RefreshCw, label: 'Syncing', className: 'text-sky-600 bg-sky-50', spin: true },
    error: { icon: AlertCircle, label: 'Sync error', className: 'text-rose-600 bg-rose-50' },
  };

  const c = config[status];
  const Icon = c.icon;

  return (
    <button
      onClick={onRetry}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all hover:opacity-80 ${c.className}`}
      title={status === 'error' ? 'Click to retry sync' : c.label}
    >
      <Icon className={`w-3.5 h-3.5 ${c.spin ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{c.label}</span>
    </button>
  );
}

import { useState, useEffect } from 'react';
import { NotebookPen, LogOut, Loader2 } from 'lucide-react';
import pb from '@/lib/pocketbase';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useNotes } from '@/hooks/useNotes';
import { AuthScreen } from '@/components/AuthScreen';
import { SyncBadge } from '@/components/SyncBadge';
import { NoteList } from '@/components/NoteList';
import { NoteEditor } from '@/components/NoteEditor';

function App() {
  const { user, loading, signIn, signUp, signOut } = useAuth();
  const isOnline = useOnlineStatus();
  const {
    notes,
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
    deleteNote,
    runSync,
  } = useNotes(user?.id, isOnline);

  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list');

  // On mobile, switch to editor when a note is selected
  useEffect(() => {
    if (activeId && window.innerWidth < 768) {
      setMobileView('editor');
    }
  }, [activeId]);

  // Handle dashboard handoff: ?source=mjw-apps-dash&token=...&uid=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get('source');
    const token = params.get('token');
    const uid = params.get('uid');
    if (source === 'mjw-apps-dash' && token && uid) {
      pb.collection('users')
        .authRefresh()
        .then(() => {
          if (pb.authStore.model?.id === uid) {
            params.delete('source');
            params.delete('token');
            params.delete('uid');
            const remaining = params.toString();
            const newUrl =
              window.location.pathname + (remaining ? `?${remaining}` : '');
            history.replaceState(null, '', newUrl);
          } else {
            pb.authStore.clear();
          }
        })
        .catch(() => pb.authStore.clear());
    }
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-stone-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} />;
  }

  const handleBack = () => setMobileView('list');
  const handleSelect = (id: string) => {
    setActiveId(id);
    if (window.innerWidth < 768) setMobileView('editor');
  };

  return (
    <div className="h-screen flex flex-col bg-stone-100 overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-stone-900 flex items-center justify-center">
            <NotebookPen className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-stone-900 leading-none">Scratchpad</h1>
            <p className="text-[10px] text-stone-400 mt-0.5">{user.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SyncBadge status={syncStatus} onRetry={runSync} />
          <button
            onClick={signOut}
            className="p-2 rounded-lg hover:bg-stone-100 text-stone-500 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Note list — left pane on desktop, toggle on mobile */}
        <div
          className={`${
            mobileView === 'list' ? 'flex' : 'hidden'
          } md:flex w-full md:w-80 lg:w-96 border-r border-stone-200 bg-stone-50 flex-col shrink-0`}
        >
          <NoteList
            notes={notes}
            activeId={activeId}
            onSelect={handleSelect}
            onCreate={createNote}
            onTogglePin={togglePin}
            onArchive={archiveNote}
            onDelete={deleteNote}
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
          />
        </div>

        {/* Editor — right pane on desktop, full screen on mobile */}
        <div
          className={`${
            mobileView === 'editor' ? 'flex' : 'hidden'
          } md:flex flex-1 flex-col overflow-hidden`}
        >
          <NoteEditor
            note={activeNote}
            onUpdate={updateNote}
            onTogglePin={togglePin}
            onArchive={archiveNote}
            onDelete={deleteNote}
            onBack={handleBack}
          />
        </div>
      </div>
    </div>
  );
}

export default App;

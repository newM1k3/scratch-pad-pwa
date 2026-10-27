# Scratchpad

A fast, installable notes app where notes open in a two-pane layout instead of popping over the page. Notes sync across devices via PocketBase and keep working offline.

## What it does

- Two-pane UI: note list on the left, live editor on the right (desktop). On mobile, it stacks — tap a note to open the full editor, back returns to the list.
- Create, edit, delete notes with autosave. No modals, ever.
- Pin, archive, and color-label notes (6 colors).
- Search and filter across all notes.
- Multi-device sync via PocketBase (email/password login required).
- Offline-first: keep working while disconnected. Changes queue in the browser and auto-sync when you reconnect.
- Installable to your home screen (PWA).
- Sync status indicator so you always know if your data is saved.
- Conflict resolution: last-write-wins per note, with the overwritten version saved as a recoverable revision so nothing is silently lost.

## Tech

- React 18 + Vite + TypeScript + Tailwind CSS + Lucide React
- PocketBase (data + email/password auth)
- IndexedDB (offline cache + write queue)
- Netlify (static hosting)

## Development

Use **Node.js 24** for local development and CI; Netlify is configured to use the same runtime.

```bash
npm ci
npm run check
```

`npm run check` runs TypeScript, the regression test suite, and the production build. Run `npm run lint` separately for ESLint.

See `docs/setup.md` for environment variables, PocketBase collection schema, API rules, and deploy steps.

## Unfinished / Stubbed

- Revisions are saved to IndexedDB but there is no UI to view or restore them yet.
- Cross-app token handoff from `mjw-apps-dash` is partially implemented but not fully tested.
- Rich text, checklists, image attachments, reminders, push notifications, and shared/collaborative notes are all v2 candidates.

# Scratchpad

A fast, installable notes app with a two-pane layout (note list on the left, live editor on the right). Notes sync across devices via PocketBase and keep working offline.

## Features

- **Two-pane UI**: note list on the left, inline editor on the right (desktop); stacks to single-pane on mobile with a back button
- **Create, edit, delete** notes with title + body, autosave, no modals
- **Pin, archive, and color-label** notes (6 colors)
- **Search and filter** across all notes (All / Pinned / Archived)
- **Multi-device sync** via PocketBase (email/password auth required)
- **Offline-first**: read and write while disconnected; changes queue in IndexedDB and auto-sync when back online
- **Installable** to home screen (PWA manifest + service worker)
- **Sync status indicator**: Synced / Offline / Syncing / Error
- **Conflict resolution**: last-write-wins per note, with the overwritten version saved as a recoverable revision in IndexedDB

## Tech Stack

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + Lucide React
- **Backend / Auth**: PocketBase (data + email/password auth)
- **Local store**: IndexedDB (offline cache + write queue)
- **Hosting**: Netlify (static frontend)
- **Runtime**: Node.js 24 for development, CI, and Netlify builds

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `VITE_POCKETBASE_URL` | `.env` (browser) | PocketBase instance URL |

Server-only credentials (if needed for Netlify Functions) live in Netlify environment variables.

## PocketBase Setup

### Collections

#### `scratch_notes`

| Field | Type | Options |
|---|---|---|
| `title` | text | required: false |
| `body` | text | required: false |
| `color` | text | required: false, default: `"default"` |
| `pinned` | bool | required: false, default: `false` |
| `archived` | bool | required: false, default: `false` |
| `deleted` | bool | required: false, default: `false` |
| `client_id` | text | required: true |
| `updated_at` | number | required: false |
| `created_at` | number | required: false |
| `user` | relation → `users` | required: true |

### API Rules

**Collection: `scratch_notes`**

- **List/Search**: `user = @request.auth.id`
- **View**: `user = @request.auth.id`
- **Create**: `user = @request.auth.id`
- **Update**: `user = @request.auth.id`
- **Delete**: `user = @request.auth.id`

This ensures every user can only access their own notes.

## Deploy Steps

1. **PocketBase**: Ensure the PocketBase instance is running at the URL specified in `VITE_POCKETBASE_URL`. Create the `scratch_notes` collection (prefixed because the PocketBase instance is shared with other apps; a bare `notes` collection there belongs to something else) with the fields and API rules above.
2. **Frontend**: Push to your repository connected to Netlify, or deploy manually. The `netlify.toml` configures the build (`npm run check`), publish directory (`dist`), and SPA redirects.
3. **Verify**: After deploy, open the app, sign up, and create a note. It should sync to PocketBase and persist across devices.

## Dashboard Handoff

Launches from the MJW Apps Dashboard arrive as `?source=mjw-apps-dash&token=<pb auth token>&uid=<record id>`. The token is validated against PocketBase (`authRefresh`) and the session is only adopted if the refreshed record id matches `uid`. Handoff params are stripped from the URL immediately in every branch, and a failed handoff restores any previous session instead of signing the user out (with no previous session, the normal login screen shows). See `src/lib/handoff.ts`.

## Known Limitations / Deferred

- **Revisions** are saved to IndexedDB (on conflicts and deletes) but there is no UI to view/restore them yet; deletes offer a short in-app Undo window instead.
- **Tombstones accumulate on PocketBase**: deleted notes sync as `deleted=true` records that other devices need in order to learn about the delete, so they are never hard-deleted server-side. Negligible at notes-app scale.
- **Rich text, checklists, image attachments, reminders, push notifications, shared notes** — all v2 candidates.

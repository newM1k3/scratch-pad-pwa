/**
 * Cross-app token handoff from the MJW Apps Dashboard.
 *
 * A dashboard launch arrives as:
 *   /?source=mjw-apps-dash&token=<pb auth token>&uid=<expected record id>
 *
 * The token is never trusted directly: it is saved into the auth store and
 * then validated with authRefresh() against PocketBase, and the session is
 * only accepted if the refreshed record id exactly matches the `uid` param.
 * The handoff params are stripped from the address bar before anything else
 * so the token never lingers in the URL or browser history.
 *
 * On failure the previous session (if any) is restored rather than cleared,
 * so a malformed or stale handoff link can never silently sign a signed-in
 * user out; with no previous session the store is cleared and the user sees
 * the normal login screen.
 */
import pb from './pocketbase';

/** Canonical cross-app launch param stamped by the MJW Apps Dashboard. */
export const HANDOFF_SOURCE = 'mjw-apps-dash';

export interface HandoffParams {
  isHandoff: boolean;
  token: string | null;
  uid: string | null;
  /** Query string with the handoff params removed (other params preserved). */
  rest: string;
}

/**
 * Pure extraction of the dashboard-handoff params from a query string, with
 * the handoff params stripped out. Any URL stamped with source=mjw-apps-dash
 * is treated as a handoff attempt even when token/uid are missing (a
 * malformed link) — those params are still stripped, and the caller falls
 * back to the normal login UI without touching any existing session.
 */
export function extractHandoff(search: string): HandoffParams {
  const params = new URLSearchParams(search);
  if (params.get('source') !== HANDOFF_SOURCE) {
    return { isHandoff: false, token: null, uid: null, rest: search };
  }
  const token = params.get('token');
  const uid = params.get('uid');
  params.delete('source');
  params.delete('token');
  params.delete('uid');
  return { isHandoff: true, token, uid, rest: params.toString() };
}

/**
 * Consumes a dashboard handoff if one is present. Returns true only when a
 * handoff was detected and the session was adopted.
 */
export async function attemptDashHandoff(): Promise<boolean> {
  const { isHandoff, token, uid, rest } = extractHandoff(window.location.search);
  if (!isHandoff) return false;

  // Strip the params first — success or failure, the token must never stay
  // in the URL (or be replayed by a refresh).
  const qs = rest;
  window.history.replaceState(
    null,
    '',
    window.location.pathname + (qs ? `?${qs}` : ''),
  );
  if (!token || !uid) return false;

  const prevToken = pb.authStore.token;
  const prevModel = pb.authStore.model;
  // Stub record — authRefresh() below replaces it with the authoritative
  // users record; only the id is relied on for the uid check.
  pb.authStore.save(token, { id: uid, email: '' });
  try {
    const auth = await pb.collection('users').authRefresh();
    if (auth.record.id !== uid) throw new Error('uid mismatch');
    return true;
  } catch {
    if (prevToken && prevModel) {
      pb.authStore.save(prevToken, prevModel);
    } else {
      pb.authStore.clear();
    }
    return false;
  }
}

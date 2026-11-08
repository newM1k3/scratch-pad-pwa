import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pocketbase = vi.hoisted(() => ({
  authStore: {
    token: '',
    model: null as Record<string, unknown> | null,
    save: vi.fn(),
    clear: vi.fn(),
  },
  collection: vi.fn(),
}));

vi.mock('./pocketbase', () => ({ default: pocketbase }));

const historyReplace = vi.hoisted(() => vi.fn());

function stubWindow(search: string) {
  vi.stubGlobal('window', {
    location: { search, pathname: '/' },
    history: { replaceState: historyReplace },
  });
}

function lastReplacedUrl(): string {
  expect(historyReplace).toHaveBeenCalled();
  const [state, title, url] = historyReplace.mock.lastCall as [
    unknown,
    unknown,
    string,
  ];
  expect(state).toBeNull();
  expect(title).toBe('');
  return url;
}

async function loadModules() {
  return await import('./handoff');
}

beforeEach(() => {
  vi.clearAllMocks();
  pocketbase.authStore.token = '';
  pocketbase.authStore.model = null;
  pocketbase.collection.mockReturnValue({ authRefresh: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractHandoff', () => {
  it('extracts and strips a canonical handoff, preserving other params', async () => {
    const { extractHandoff } = await loadModules();
    const result = extractHandoff(
      '?source=mjw-apps-dash&token=abc.def.ghi&uid=ybnklmnoqrstuvw&keep=yes',
    );
    expect(result.isHandoff).toBe(true);
    expect(result.token).toBe('abc.def.ghi');
    expect(result.uid).toBe('ybnklmnoqrstuvw');
    expect(result.rest).toBe('keep=yes');
  });

  it('ignores URLs without the dashboard source stamp', async () => {
    const { extractHandoff } = await loadModules();
    const result = extractHandoff('?token=abc&uid=xyz&source=other-app');
    expect(result.isHandoff).toBe(false);
    expect(result.rest).toBe('?token=abc&uid=xyz&source=other-app');
  });

  it('flags a malformed handoff (missing token/uid) for stripping anyway', async () => {
    const { extractHandoff } = await loadModules();
    const result = extractHandoff('?source=mjw-apps-dash');
    expect(result.isHandoff).toBe(true);
    expect(result.token).toBeNull();
    expect(result.uid).toBeNull();
    expect(result.rest).toBe('');
  });
});

describe('attemptDashHandoff', () => {
  it('does nothing for a plain URL', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?utm_source=newsletter');

    expect(await attemptDashHandoff()).toBe(false);
    expect(historyReplace).not.toHaveBeenCalled();
    expect(pocketbase.authStore.save).not.toHaveBeenCalled();
    expect(pocketbase.authStore.clear).not.toHaveBeenCalled();
  });

  it('adopts the session when the token validates against the uid', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?source=mjw-apps-dash&token=tok123&uid=ybnklmnoqrstuvw');
    const refresh = vi.fn().mockResolvedValue({ record: { id: 'ybnklmnoqrstuvw' } });
    pocketbase.collection.mockReturnValue({ authRefresh: refresh });

    expect(await attemptDashHandoff()).toBe(true);

    expect(pocketbase.authStore.save).toHaveBeenCalledWith('tok123', {
      id: 'ybnklmnoqrstuvw',
      email: '',
    });
    expect(lastReplacedUrl()).toBe('/');
  });

  it('strips the handoff params from the URL even on success', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?source=mjw-apps-dash&token=tok123&uid=ybnklmnoqrstuvw&tab=archived');
    pocketbase.collection.mockReturnValue({
      authRefresh: vi.fn().mockResolvedValue({ record: { id: 'ybnklmnoqrstuvw' } }),
    });

    expect(await attemptDashHandoff()).toBe(true);
    expect(lastReplacedUrl()).toBe('/?tab=archived');
  });

  it('restores the previous session instead of signing out on a stale token', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?source=mjw-apps-dash&token=stale&uid=ybnklmnoqrstuvw');
    const prevModel = { id: 'prevuser0000000', email: 'me@example.com' };
    pocketbase.authStore.token = 'prev-token';
    pocketbase.authStore.model = prevModel;
    pocketbase.collection.mockReturnValue({
      authRefresh: vi.fn().mockRejectedValue(new Error('401')),
    });

    expect(await attemptDashHandoff()).toBe(false);

    expect(pocketbase.authStore.clear).not.toHaveBeenCalled();
    expect(pocketbase.authStore.save).toHaveBeenNthCalledWith(2, 'prev-token', prevModel);
  });

  it('clears the store on failure only when there was no previous session', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?source=mjw-apps-dash&token=tok123&uid=ybnklmnoqrstuvw');
    pocketbase.collection.mockReturnValue({
      authRefresh: vi.fn().mockRejectedValue(new Error('401')),
    });

    expect(await attemptDashHandoff()).toBe(false);

    expect(pocketbase.authStore.clear).toHaveBeenCalledOnce();
  });

  it('rejects a valid token whose record id does not match the uid', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?source=mjw-apps-dash&token=tok123&uid=ybnklmnoqrstuvw');
    pocketbase.collection.mockReturnValue({
      authRefresh: vi.fn().mockResolvedValue({ record: { id: 'otheruser000000' } }),
    });

    expect(await attemptDashHandoff()).toBe(false);

    expect(pocketbase.authStore.clear).toHaveBeenCalledOnce();
    // The tampered link must still be cleaned from the address bar.
    expect(lastReplacedUrl()).toBe('/');
  });

  it('strips a malformed handoff link without touching the auth store', async () => {
    const { attemptDashHandoff } = await loadModules();
    stubWindow('?source=mjw-apps-dash');

    expect(await attemptDashHandoff()).toBe(false);

    expect(lastReplacedUrl()).toBe('/');
    expect(pocketbase.authStore.save).not.toHaveBeenCalled();
    expect(pocketbase.authStore.clear).not.toHaveBeenCalled();
  });
});

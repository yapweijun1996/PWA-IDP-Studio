export type UpdatePhase = 'starting' | 'ready' | 'checking' | 'available' | 'updating' | 'failed' | 'unsupported';
export interface UpdateState { phase: UpdatePhase; lastChecked: number | null; message: string }

export interface RegisterOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string | undefined, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}
export type RegisterFn = (options: RegisterOptions) => (reloadPage?: boolean) => Promise<void>;

/** Minimum gap between automatic update checks (pwa:sw-install-integrity rule 3). */
export const AUTO_CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** Explicit, user-controlled Service Worker update lifecycle. Nothing activates without `apply()`. */
export const ACTIVATION_TIMEOUT_MS = 15_000;

export function createUpdateController(register: RegisterFn, now: () => number = Date.now, reload: () => void = () => window.location.reload()) {
  let state: UpdateState = { phase: 'starting', lastChecked: null, message: 'Starting…' };
  let registration: ServiceWorkerRegistration | undefined;
  let activate: ((reload?: boolean) => Promise<void>) | undefined;
  let started = false;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
  const waiting = () => state.phase === 'available' || state.phase === 'updating';

  const markAvailable = () => set({ phase: 'available', message: 'A new version is ready to install.' });

  function start() {
    if (started) return;
    started = true;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) { set({ phase: 'unsupported', message: 'Updates are not supported in this browser.' }); return; }
    activate = register({
      immediate: true,
      onNeedRefresh: markAvailable,
      onRegisteredSW: (_url, reg) => {
        registration = reg;
        if (!waiting()) set({ phase: 'ready', message: 'You are on the latest known version.' });
        if (reg?.waiting) markAvailable();
      },
      onRegisterError: e => set({ phase: 'failed', message: `Service worker registration failed: ${String((e as Error)?.message ?? e)}` }),
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (state.lastChecked === null || now() - state.lastChecked >= AUTO_CHECK_INTERVAL_MS)) void check({ silent: true });
    });
  }

  async function check({ silent = false }: { silent?: boolean } = {}) {
    if (state.phase === 'checking' || state.phase === 'updating') return;
    if (state.phase === 'unsupported') return;
    if (!registration) { if (!silent) set({ phase: 'failed', message: 'The service worker is not registered yet. Reload the page and try again.' }); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { if (!silent) set({ phase: 'failed', message: 'You are offline. Connect to the internet to check for updates.' }); return; }
    const previous = state;
    if (!silent) set({ phase: 'checking', message: 'Checking for updates…' });
    try {
      await registration.update();
      const installing = registration.installing;
      if (installing) {
        set({ phase: 'checking', message: 'Downloading the update…' });
        await new Promise<void>(resolve => installing.addEventListener('statechange', () => { if (installing.state === 'installed' || installing.state === 'redundant' || installing.state === 'activated') resolve(); }));
      }
      if (registration.waiting || state.phase === 'available') markAvailable();
      else set({ phase: 'ready', lastChecked: now(), message: 'You are on the latest version.' });
      set({ lastChecked: now() });
    } catch (e) {
      if (silent) set({ phase: previous.phase === 'checking' ? 'ready' : previous.phase, message: previous.message });
      else set({ phase: 'failed', message: `Could not check for updates: ${String((e as Error)?.message ?? e)}` });
    }
  }

  async function apply() {
    if (state.phase === 'updating' || !activate) return;
    set({ phase: 'updating', message: 'Installing the latest version…' });
    // Reload exactly once, only after the new worker has taken control.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controlled = new Promise<void>((resolve, reject) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      timer = setTimeout(() => reject(new Error('the new version did not activate in time')), ACTIVATION_TIMEOUT_MS);
    });
    try {
      await activate(false); // asks the waiting worker to take over; we own the reload
      await controlled;
      clearTimeout(timer);
      reload();
    } catch (e) {
      clearTimeout(timer);
      set({ phase: 'failed', message: `Update failed: ${String((e as Error)?.message ?? e)}` });
    }
  }

  return {
    start, check, apply,
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

import { describe, expect, it, vi } from 'vitest';
import { ACTIVATION_TIMEOUT_MS, AUTO_CHECK_INTERVAL_MS, createUpdateController, type RegisterOptions } from './updateController';

function setup({ updateImpl = async () => {}, waiting = false } = {}) {
  const sw = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  const reload = vi.fn();
  let options!: RegisterOptions;
  const activate = vi.fn(async () => {});
  const registration = { update: vi.fn(updateImpl), waiting: waiting ? ({} as ServiceWorker) : null, installing: null } as unknown as ServiceWorkerRegistration;
  let t = 1_000_000;
  const controller = createUpdateController(o => { options = o; return activate; }, () => t, reload);
  controller.start();
  return { controller, registration, activate, sw, reload, options: () => options, tick: (ms: number) => { t += ms; } };
}

describe('update controller', () => {
  it('reports ready after registration and up to date after a check', async () => {
    const s = setup();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    expect(s.controller.getState().phase).toBe('ready');
    await s.controller.check();
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    expect(s.controller.getState()).toMatchObject({ phase: 'ready', message: 'You are on the latest version.' });
    expect(s.controller.getState().lastChecked).not.toBeNull();
  });
  it('shows an available update only when the user can choose; never activates on its own', async () => {
    const s = setup();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    s.options().onNeedRefresh?.();
    expect(s.controller.getState().phase).toBe('available');
    expect(s.activate).not.toHaveBeenCalled();
    const applying = s.controller.apply();
    await Promise.resolve();
    expect(s.controller.getState().phase).toBe('updating');
    expect(s.reload).not.toHaveBeenCalled();
    s.sw.dispatchEvent(new Event('controllerchange'));
    await applying;
    expect(s.activate).toHaveBeenCalledWith(false);
    expect(s.reload).toHaveBeenCalledTimes(1);
  });
  it('detects an already waiting worker at registration', () => {
    const s = setup({ waiting: true });
    s.options().onRegisteredSW?.('sw.js', s.registration);
    expect(s.controller.getState().phase).toBe('available');
  });
  it('turns a failed check into a visible failed state with a reason', async () => {
    const s = setup({ updateImpl: async () => { throw new Error('boom'); } });
    s.options().onRegisteredSW?.('sw.js', s.registration);
    await s.controller.check();
    expect(s.controller.getState()).toMatchObject({ phase: 'failed' });
    expect(s.controller.getState().message).toContain('boom');
  });
  it('reports a failed activation instead of a dead button', async () => {
    const s = setup();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    s.options().onNeedRefresh?.();
    s.activate.mockRejectedValueOnce(new Error('no controller'));
    await s.controller.apply();
    expect(s.controller.getState().phase).toBe('failed');
    expect(s.controller.getState().message).toContain('Update failed');
  });
  it('ignores a second apply while updating and does not double-check', async () => {
    const s = setup();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    s.options().onNeedRefresh?.();
    const first = s.controller.apply(); const second = s.controller.apply();
    await Promise.resolve(); s.sw.dispatchEvent(new Event('controllerchange'));
    await Promise.all([first, second]);
    expect(s.activate).toHaveBeenCalledTimes(1);
  });
  it('fails visibly if the new worker never takes control', async () => {
    vi.useFakeTimers();
    try {
      const s = setup();
      s.options().onRegisteredSW?.('sw.js', s.registration);
      s.options().onNeedRefresh?.();
      const applying = s.controller.apply();
      await vi.advanceTimersByTimeAsync(ACTIVATION_TIMEOUT_MS + 1);
      await applying;
      expect(s.controller.getState().phase).toBe('failed');
      expect(s.reload).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('throttles automatic visibility checks', async () => {
    const s = setup();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    await s.controller.check();
    s.tick(AUTO_CHECK_INTERVAL_MS - 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    s.tick(2000);
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(r => setTimeout(r, 0));
    expect(s.registration.update).toHaveBeenCalledTimes(2);
  });
  it('queues an unknown-route check until registration, without activating', async () => {
    const s = setup({ waiting: true });
    await s.controller.check({ silent: true });
    expect(s.registration.update).not.toHaveBeenCalled();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    await Promise.resolve(); await Promise.resolve();
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    expect(s.controller.getState().phase).toBe('available');
    expect(s.activate).not.toHaveBeenCalled();
  });
  it('performs the startup check and allows a route check inside the visibility throttle', async () => {
    const s = setup();
    s.options().onRegisteredSW?.('sw.js', s.registration);
    await Promise.resolve(); await Promise.resolve();
    expect(s.registration.update).toHaveBeenCalledTimes(1);
    await s.controller.check({ silent: true });
    expect(s.registration.update).toHaveBeenCalledTimes(2);
    expect(s.activate).not.toHaveBeenCalled();
  });
});

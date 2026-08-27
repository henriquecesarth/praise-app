import { describe, expect, it, vi } from 'vitest';
import { PWA_OFFLINE_READY_EVENT, PWA_UPDATE_EVENT, registerPraiseServiceWorker } from './pwa';

describe('service worker registration lifecycle', () => {
  it('publishes update and offline-ready events without auto-reloading forms', async () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    let callbacks: { onNeedRefresh?: () => void; onOfflineReady?: () => void } = {};
    const registerSW = vi.fn((options) => {
      callbacks = options;
      return updateSW;
    });
    const updateListener = vi.fn();
    const offlineListener = vi.fn();
    window.addEventListener(PWA_UPDATE_EVENT, updateListener);
    window.addEventListener(PWA_OFFLINE_READY_EVENT, offlineListener);

    const returnedUpdate = registerPraiseServiceWorker(registerSW);
    callbacks.onNeedRefresh?.();
    callbacks.onOfflineReady?.();

    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
    expect(returnedUpdate).toBe(updateSW);
    expect(updateListener).toHaveBeenCalledOnce();
    expect(offlineListener).toHaveBeenCalledOnce();
    expect(updateSW).not.toHaveBeenCalled();

    window.removeEventListener(PWA_UPDATE_EVENT, updateListener);
    window.removeEventListener(PWA_OFFLINE_READY_EVENT, offlineListener);
  });
});

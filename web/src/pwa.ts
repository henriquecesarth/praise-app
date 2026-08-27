export const PWA_UPDATE_EVENT = 'praise:pwa-update';
export const PWA_OFFLINE_READY_EVENT = 'praise:pwa-offline-ready';

interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}

export type RegisterSW = (options: RegisterSWOptions) => (reloadPage?: boolean) => Promise<void>;

export function registerPraiseServiceWorker(registerSW: RegisterSW) {
  let updateSW: (reloadPage?: boolean) => Promise<void> = async () => undefined;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => {
      window.dispatchEvent(new CustomEvent(PWA_UPDATE_EVENT, { detail: { updateSW } }));
    },
    onOfflineReady: () => {
      window.dispatchEvent(new CustomEvent(PWA_OFFLINE_READY_EVENT));
    },
  });
  return updateSW;
}

export async function initializePWA() {
  if (!('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  registerPraiseServiceWorker(registerSW);
}

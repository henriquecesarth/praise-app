/**
 * Meta / Facebook JavaScript SDK Integration Helper for WhatsApp Embedded Signup.
 *
 * Requirements (Phase 7E-F2):
 * - Script loaded once;
 * - Repeated component mounts do not duplicate SDK initialization;
 * - SDK-unavailable state fails visibly and safely;
 * - Popup cancellation is handled cleanly;
 * - Incomplete Meta result is rejected locally before calling completion API;
 * - Authorization code, wabaId, and phoneNumberId are returned to the caller;
 * - No OAuth credentials exchanged in the browser;
 * - No Meta Graph API called from the browser;
 * - No secrets written to localStorage or sessionStorage.
 */

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

export interface LaunchMetaSignupOptions {
  fbAppId: string;
  configId: string;
  stateNonce?: string;
  sessionId?: string;
  signal?: AbortSignal;
  sourceWindow?: MessageEventSource | null;
}

export interface MetaSignupAuthResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

// Module-level singleton state
let sdkLoadingPromise: Promise<any> | null = null;
let initializedAppId: string | null = null;

interface ActiveMetaAttempt {
  attemptId: number;
  cleanup: () => void;
  reject: (err: any) => void;
}

let activeMetaAttempt: ActiveMetaAttempt | null = null;
let attemptIdSequence = 0;

/**
 * Validates that a message event origin is an authentic Meta / Facebook origin.
 * Enforces HTTPS and strictly matches facebook.com or meta.com hostnames.
 */
export function isValidMetaOrigin(origin: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return (
      host === 'facebook.com' ||
      host.endsWith('.facebook.com') ||
      host === 'meta.com' ||
      host.endsWith('.meta.com')
    );
  } catch {
    return false;
  }
}

/**
 * Resets the Meta SDK loader state. Used exclusively in unit tests.
 */
export function resetMetaSdkStateForTests(): void {
  sdkLoadingPromise = null;
  initializedAppId = null;
  if (activeMetaAttempt) {
    activeMetaAttempt.cleanup();
    activeMetaAttempt = null;
  }
  if (typeof window !== 'undefined') {
    delete (window as any).fbAsyncInit;
    const existing = document.getElementById('facebook-jssdk');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }
}

/**
 * Loads and initializes the Meta/Facebook JavaScript SDK once.
 */
export function loadMetaSdk(fbAppId: string): Promise<any> {
  if (!fbAppId) {
    return Promise.reject(new Error('fbAppId é obrigatório para inicializar o SDK da Meta.'));
  }

  // If window.FB is already present in window
  if (typeof window !== 'undefined' && window.FB) {
    if (initializedAppId !== fbAppId) {
      try {
        window.FB.init({
          appId: fbAppId,
          cookie: true,
          xfbml: false,
          version: 'v21.0',
        });
        initializedAppId = fbAppId;
      } catch (err: any) {
        return Promise.reject(
          new Error(`Falha ao inicializar o SDK da Meta: ${err?.message || 'erro desconhecido'}`)
        );
      }
    }
    return Promise.resolve(window.FB);
  }

  // If script is already in-flight, return the existing singleton promise
  if (sdkLoadingPromise) {
    return sdkLoadingPromise;
  }

  sdkLoadingPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return reject(new Error('Ambiente de navegador indisponível para o SDK da Meta.'));
    }

    // Set fbAsyncInit callback before injecting script
    window.fbAsyncInit = function () {
      try {
        window.FB.init({
          appId: fbAppId,
          cookie: true,
          xfbml: false,
          version: 'v21.0',
        });
        initializedAppId = fbAppId;
        resolve(window.FB);
      } catch (err: any) {
        reject(
          new Error(`Falha ao inicializar o SDK da Meta após carregamento: ${err?.message || 'erro desconhecido'}`)
        );
      }
    };

    // Check if script tag already exists in DOM
    let script = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = 'https://connect.facebook.net/pt_BR/sdk.js';
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        sdkLoadingPromise = null;
        reject(
          new Error(
            'Falha ao carregar o SDK da Meta. Verifique sua conexão com a internet ou bloqueador de anúncios.'
          )
        );
      };
      const firstScript = document.getElementsByTagName('script')[0];
      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(script, firstScript);
      } else {
        document.head.appendChild(script);
      }
    }
  });

  return sdkLoadingPromise;
}

/**
 * Launches the Meta Embedded Signup popup and awaits user authorization and message events.
 * Scopes each launch to an isolated attempt lifecycle with strictly bounded message listeners.
 */
export async function launchMetaEmbeddedSignup(
  options: LaunchMetaSignupOptions
): Promise<MetaSignupAuthResult> {
  const { fbAppId, configId, signal, sourceWindow } = options;

  if (!fbAppId || !configId) {
    throw new Error('fbAppId e configId são obrigatórios para iniciar o Meta Embedded Signup.');
  }

  if (signal?.aborted) {
    const err = new Error('Operação de login cancelada antes do início.');
    (err as any).cancelled = true;
    throw err;
  }

  // Teardown any prior active attempt listener and fail the prior promise cleanly
  if (activeMetaAttempt) {
    const prior = activeMetaAttempt;
    activeMetaAttempt = null;
    const abortErr = new Error('Nova tentativa de onboarding iniciada; tentativa anterior cancelada.');
    (abortErr as any).cancelled = true;
    prior.reject(abortErr);
    prior.cleanup();
  }

  const FB = await loadMetaSdk(fbAppId);

  if (signal?.aborted) {
    const err = new Error('Operação de login cancelada antes do início.');
    (err as any).cancelled = true;
    throw err;
  }

  const currentAttemptId = ++attemptIdSequence;

  return new Promise<MetaSignupAuthResult>((resolve, reject) => {
    // Attempt-scoped state: fresh per attempt, never shared across attempts
    let capturedWabaId: string | null = null;
    let capturedPhoneNumberId: string | null = null;
    let finishEventReceived = false;
    let isTerminated = false;
    let activeAttemptSource: MessageEventSource | null = sourceWindow || null;
    let originalWindowOpen: typeof window.open | null = null;
    let abortHandler: (() => void) | null = null;

    const finishAttempt = (outcome: { success: true; data: MetaSignupAuthResult } | { success: false; error: any }) => {
      if (isTerminated) return;
      isTerminated = true;

      // 1. Remove message listener immediately
      if (typeof window !== 'undefined') {
        window.removeEventListener('message', messageHandler);
      }

      // 2. Remove abort listener if registered
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }

      // 3. Clear captured identifiers and source reference
      capturedWabaId = null;
      capturedPhoneNumberId = null;
      activeAttemptSource = null;

      // 4. Invalidate module-level attempt tracker
      if (activeMetaAttempt?.attemptId === currentAttemptId) {
        activeMetaAttempt = null;
      }

      // 5. Settle promise exactly once
      if (outcome.success) {
        resolve(outcome.data);
      } else {
        reject(outcome.error);
      }
    };

    activeMetaAttempt = {
      attemptId: currentAttemptId,
      cleanup: () => {
        const err = new Error('Tentativa de onboarding cancelada.');
        (err as any).cancelled = true;
        finishAttempt({ success: false, error: err });
      },
      reject: (err) => {
        finishAttempt({ success: false, error: err });
      },
    };

    if (signal) {
      abortHandler = () => {
        const err = new Error('Operação cancelada pelo chamador.');
        (err as any).cancelled = true;
        finishAttempt({ success: false, error: err });
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const messageHandler = (event: MessageEvent) => {
      if (isTerminated) return;

      // 1. Origin validation: Meta Embedded Signup emits messages from facebook.com / meta.com via HTTPS
      if (!isValidMetaOrigin(event.origin)) {
        return;
      }

      // 2. Source window binding: if activeAttemptSource is established,
      // strictly reject any event from other sources or stale popups.
      if (activeAttemptSource && event.source !== activeAttemptSource) {
        return;
      }

      try {
        let payload = event.data;
        if (typeof payload === 'string') {
          try {
            payload = JSON.parse(payload);
          } catch {
            return;
          }
        }

        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
          return;
        }

        // Require expected Embedded Signup discriminator
        if (payload.type !== 'WA_EMBEDDED_SIGNUP') {
          return;
        }

        // CANCEL postMessage: terminate attempt immediately and clean resources
        if (payload.event === 'CANCEL') {
          const err = new Error('Operação de login cancelada pelo usuário no popup do WhatsApp.');
          (err as any).cancelled = true;
          finishAttempt({ success: false, error: err });
          return;
        }

        // ERROR postMessage: terminate attempt immediately and clean resources
        if (payload.event === 'ERROR') {
          const errMsg = payload.data?.error_message || 'Erro durante o cadastro no WhatsApp.';
          const err = new Error(errMsg);
          (err as any).metaError = true;
          finishAttempt({ success: false, error: err });
          return;
        }

        if (payload.event === 'FINISH') {
          // Double-event guard: ignore duplicate FINISH within the same attempt
          if (finishEventReceived) {
            return;
          }

          const eventData = payload.data;
          if (eventData && typeof eventData === 'object' && !Array.isArray(eventData)) {
            const waba = eventData.waba_id || eventData.wabaId;
            const phone = eventData.phone_number_id || eventData.phoneNumberId;

            if (typeof waba === 'string' && waba.trim().length > 0) {
              capturedWabaId = waba.trim();
            }
            if (typeof phone === 'string' && phone.trim().length > 0) {
              capturedPhoneNumberId = phone.trim();
            }

            if (capturedWabaId && capturedPhoneNumberId) {
              finishEventReceived = true;
            }
          }
        }
      } catch {
        // Non-JSON or malformed message, safe to ignore
      }
    };

    window.addEventListener('message', messageHandler);

    // If sourceWindow was not provided explicitly, wrap window.open synchronously around FB.login
    // to automatically capture the popup WindowProxy opened by Facebook's JS SDK
    if (!activeAttemptSource && typeof window !== 'undefined' && typeof window.open === 'function') {
      originalWindowOpen = window.open;
      window.open = function (...args: any[]) {
        const popup = originalWindowOpen!.apply(this, args as any);
        if (popup) {
          activeAttemptSource = popup;
        }
        return popup;
      };
    }

    try {
      FB.login(
        (response: any) => {
          if (isTerminated) return;

          if (!response || !response.authResponse) {
            const err = new Error('Operação de login cancelada pelo usuário no popup do WhatsApp.');
            (err as any).cancelled = true;
            finishAttempt({ success: false, error: err });
            return;
          }

          const code = response.authResponse.code;
          const wabaId =
            capturedWabaId ||
            (typeof response.authResponse.waba_id === 'string' ? response.authResponse.waba_id : null) ||
            (typeof response.authResponse.wabaId === 'string' ? response.authResponse.wabaId : null) ||
            (typeof response.authResponse.sessionInfo?.waba_id === 'string' ? response.authResponse.sessionInfo.waba_id : null) ||
            (typeof response.authResponse.sessionInfo?.wabaId === 'string' ? response.authResponse.sessionInfo.wabaId : null);

          const phoneNumberId =
            capturedPhoneNumberId ||
            (typeof response.authResponse.phone_number_id === 'string' ? response.authResponse.phone_number_id : null) ||
            (typeof response.authResponse.phoneNumberId === 'string' ? response.authResponse.phoneNumberId : null) ||
            (typeof response.authResponse.sessionInfo?.phone_number_id === 'string' ? response.authResponse.sessionInfo.phone_number_id : null) ||
            (typeof response.authResponse.sessionInfo?.phoneNumberId === 'string' ? response.authResponse.sessionInfo.phoneNumberId : null);

          if (!code || typeof code !== 'string' || code.trim().length === 0) {
            const err = new Error('Operação cancelada: código de autorização ausente.');
            (err as any).cancelled = true;
            finishAttempt({ success: false, error: err });
            return;
          }

          if (!wabaId || !phoneNumberId) {
            const err = new Error(
              'Resultado incompleto retornado pelo Meta. Não foi possível identificar a WABA ou o número de telefone.'
            );
            (err as any).incomplete = true;
            finishAttempt({ success: false, error: err });
            return;
          }

          finishAttempt({
            success: true,
            data: {
              code: code.trim(),
              wabaId: wabaId.trim(),
              phoneNumberId: phoneNumberId.trim(),
            },
          });
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            sessionInfoVersion: '2',
          },
        }
      );
    } catch (err: any) {
      finishAttempt({ success: false, error: err });
    } finally {
      if (originalWindowOpen && typeof window !== 'undefined') {
        window.open = originalWindowOpen;
      }
    }
  });
}

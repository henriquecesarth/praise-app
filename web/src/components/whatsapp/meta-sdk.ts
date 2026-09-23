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
}

export interface MetaSignupAuthResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

// Module-level singleton state
let sdkLoadingPromise: Promise<any> | null = null;
let initializedAppId: string | null = null;

/**
 * Resets the Meta SDK loader state. Used exclusively in unit tests.
 */
export function resetMetaSdkStateForTests(): void {
  sdkLoadingPromise = null;
  initializedAppId = null;
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
 */
export async function launchMetaEmbeddedSignup(
  options: LaunchMetaSignupOptions
): Promise<MetaSignupAuthResult> {
  const { fbAppId, configId } = options;

  if (!fbAppId || !configId) {
    throw new Error('fbAppId e configId são obrigatórios para iniciar o Meta Embedded Signup.');
  }

  const FB = await loadMetaSdk(fbAppId);

  return new Promise<MetaSignupAuthResult>((resolve, reject) => {
    let capturedWabaId: string | null = null;
    let capturedPhoneNumberId: string | null = null;
    let userCancelled = false;

    const messageHandler = (event: MessageEvent) => {
      // Validate origin loosely to support facebook.com and web.facebook.com
      if (
        event.origin &&
        !event.origin.includes('facebook.com') &&
        !event.origin.includes('meta.com')
      ) {
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

        if (payload && typeof payload === 'object') {
          if (payload.type === 'WA_EMBEDDED_SIGNUP') {
            if (payload.event === 'FINISH' && payload.data) {
              capturedWabaId =
                payload.data.waba_id || payload.data.wabaId || capturedWabaId;
              capturedPhoneNumberId =
                payload.data.phone_number_id ||
                payload.data.phoneNumberId ||
                capturedPhoneNumberId;
            } else if (payload.event === 'CANCEL') {
              userCancelled = true;
            }
          }

          if (payload.waba_id || payload.wabaId) {
            capturedWabaId = payload.waba_id || payload.wabaId;
          }
          if (payload.phone_number_id || payload.phoneNumberId) {
            capturedPhoneNumberId = payload.phone_number_id || payload.phoneNumberId;
          }
        }
      } catch {
        // Non-JSON message, safe to ignore
      }
    };

    window.addEventListener('message', messageHandler);

    try {
      FB.login(
        (response: any) => {
          window.removeEventListener('message', messageHandler);

          if (userCancelled || !response || !response.authResponse) {
            const err = new Error('Operação de login cancelada pelo usuário no popup do WhatsApp.');
            (err as any).cancelled = true;
            return reject(err);
          }

          const code = response.authResponse.code;
          const wabaId =
            capturedWabaId ||
            response.authResponse.waba_id ||
            response.authResponse.wabaId ||
            response.authResponse.sessionInfo?.waba_id ||
            response.authResponse.sessionInfo?.wabaId;
          const phoneNumberId =
            capturedPhoneNumberId ||
            response.authResponse.phone_number_id ||
            response.authResponse.phoneNumberId ||
            response.authResponse.sessionInfo?.phone_number_id ||
            response.authResponse.sessionInfo?.phoneNumberId;

          if (!code) {
            const err = new Error('Operação cancelada: código de autorização ausente.');
            (err as any).cancelled = true;
            return reject(err);
          }

          if (!wabaId || !phoneNumberId) {
            const err = new Error(
              'Resultado incompleto retornado pelo Meta. Não foi possível identificar a WABA ou o número de telefone.'
            );
            (err as any).incomplete = true;
            return reject(err);
          }

          resolve({
            code,
            wabaId,
            phoneNumberId,
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
      window.removeEventListener('message', messageHandler);
      reject(err);
    }
  });
}

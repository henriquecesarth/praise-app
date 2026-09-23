export type WhatsAppErrorCategory =
  | 'COMMERCIAL_RESTRICTION'
  | 'RESUME_ONBOARDING'
  | 'REFRESH_STATE'
  | 'VALIDATION'
  | 'TERMINAL'
  | 'PROVIDER_PENDING'
  | 'UNKNOWN';

export const WHATSAPP_ERROR_CATEGORY_MAP: Record<string, WhatsAppErrorCategory> = {
  WHATSAPP_SUBSCRIPTION_SUSPENDED: 'COMMERCIAL_RESTRICTION',
  WHATSAPP_CAPACITY_LIMIT_REACHED: 'COMMERCIAL_RESTRICTION',
  ONBOARDING_SESSION_EXPIRED: 'RESUME_ONBOARDING',
  ONBOARDING_SESSION_SUPERSEDED: 'RESUME_ONBOARDING',
  CONNECTION_RESERVATION_EXPIRED: 'RESUME_ONBOARDING',
  ONBOARDING_SESSION_ALREADY_CONSUMED: 'REFRESH_STATE',
  CONNECTION_ALREADY_CONNECTED: 'REFRESH_STATE',
  CONNECTION_DISCONNECTED: 'TERMINAL',
  PROVIDER_PHONE_ALREADY_REGISTERED: 'TERMINAL',
  PROVIDER_IDENTITY_CONFLICT: 'TERMINAL',
  WABA_SUBSCRIBE_OUTCOME_UNRESOLVED: 'PROVIDER_PENDING',
  INVALID_ONBOARDING_STATE: 'VALIDATION',
  MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION: 'VALIDATION',
  INVALID_CURSOR: 'VALIDATION',
};

export const WHATSAPP_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_SUBSCRIPTION_SUSPENDED:
    'A integração com WhatsApp está suspensa devido ao plano da organização.',
  WHATSAPP_CAPACITY_LIMIT_REACHED:
    'O limite de conexões do WhatsApp foi atingido para sua organização.',
  ONBOARDING_SESSION_EXPIRED:
    'A sessão de conexão expirou. Inicie novamente o processo.',
  ONBOARDING_SESSION_ALREADY_CONSUMED:
    'Esta sessão de conexão já foi finalizada.',
  ONBOARDING_SESSION_SUPERSEDED:
    'Uma nova sessão de conexão foi iniciada. Atualize a página.',
  CONNECTION_RESERVATION_EXPIRED:
    'A reserva da conexão expirou. Inicie uma nova conexão.',
  CONNECTION_DISCONNECTED:
    'A conexão foi desconectada.',
  CONNECTION_ALREADY_CONNECTED:
    'Esta linha já se encontra conectada.',
  PROVIDER_PHONE_ALREADY_REGISTERED:
    'Este número já está registrado em outra conexão.',
  PROVIDER_IDENTITY_CONFLICT:
    'Conflito de identidade com o provedor WhatsApp.',
  WABA_SUBSCRIBE_OUTCOME_UNRESOLVED:
    'A ativação com a plataforma está em andamento. Aguarde alguns instantes.',
  INVALID_ONBOARDING_STATE:
    'O estado atual da conexão não permite esta operação.',
  MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION:
    'Este ministério já possui uma conexão exclusiva atribuída.',
  INVALID_CURSOR:
    'Parâmetro de paginação inválido.',
};

export interface ClassifiedWhatsAppError {
  code: string;
  category: WhatsAppErrorCategory;
  message: string;
  userMessage: string;
  retryable: boolean;
}

export function classifyWhatsAppErrorCode(code?: string | null): WhatsAppErrorCategory {
  if (!code) return 'UNKNOWN';
  return WHATSAPP_ERROR_CATEGORY_MAP[code] || 'UNKNOWN';
}

export function getWhatsAppErrorMessage(code?: string | null): string {
  if (!code) return 'Ocorreu um erro na integração com WhatsApp.';
  return WHATSAPP_ERROR_MESSAGES[code] || 'Ocorreu um erro na integração com WhatsApp.';
}

export function isRetryableWhatsAppCategory(category: WhatsAppErrorCategory): boolean {
  switch (category) {
    case 'RESUME_ONBOARDING':
    case 'REFRESH_STATE':
    case 'PROVIDER_PENDING':
      return true;
    case 'COMMERCIAL_RESTRICTION':
    case 'TERMINAL':
    case 'VALIDATION':
    case 'UNKNOWN':
    default:
      return false;
  }
}

export function extractErrorCode(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === 'object') {
    const anyErr = err as any;
    if (typeof anyErr.details?.code === 'string') return anyErr.details.code;
    if (typeof anyErr.details === 'string') return anyErr.details;
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.message === 'string') {
      for (const knownCode of Object.keys(WHATSAPP_ERROR_CATEGORY_MAP)) {
        if (anyErr.message.includes(knownCode)) return knownCode;
      }
    }
  }
  return null;
}

export function classifyWhatsAppError(err: unknown): ClassifiedWhatsAppError {
  const code = extractErrorCode(err) || 'UNKNOWN';
  const category = classifyWhatsAppErrorCode(code);
  const rawMessage = (err as any)?.message || 'Erro na operação do WhatsApp.';
  const userMessage = WHATSAPP_ERROR_MESSAGES[code] || rawMessage;
  const retryable = isRetryableWhatsAppCategory(category);

  return {
    code,
    category,
    message: rawMessage,
    userMessage,
    retryable,
  };
}

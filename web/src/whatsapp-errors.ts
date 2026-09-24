export type WhatsAppErrorCategory =
  | 'COMMERCIAL_RESTRICTION'
  | 'RESUME_ONBOARDING'
  | 'REFRESH_STATE'
  | 'VALIDATION'
  | 'TERMINAL'
  | 'PROVIDER_PENDING'
  | 'UNKNOWN';

export const WHATSAPP_ERROR_CATEGORY_MAP: Record<string, WhatsAppErrorCategory> = {
  // Commercial restrictions
  WHATSAPP_SUBSCRIPTION_SUSPENDED: 'COMMERCIAL_RESTRICTION',
  WHATSAPP_CAPACITY_LIMIT_REACHED: 'COMMERCIAL_RESTRICTION',

  // Resumable onboarding (ephemeral 15m session boundary before reservation expiration)
  ONBOARDING_SESSION_EXPIRED: 'RESUME_ONBOARDING',

  // Refresh state required
  ONBOARDING_SESSION_ALREADY_CONSUMED: 'REFRESH_STATE',
  ONBOARDING_SESSION_SUPERSEDED: 'REFRESH_STATE',
  CONNECTION_DISCONNECTED: 'REFRESH_STATE',
  CONNECTION_ALREADY_CONNECTED: 'REFRESH_STATE',
  WABA_LIFECYCLE_LEASE_LOST: 'REFRESH_STATE',
  WABA_LIFECYCLE_CONTENTION: 'REFRESH_STATE',

  // Provider pending / background convergence
  WABA_SUBSCRIBE_OUTCOME_UNRESOLVED: 'PROVIDER_PENDING',

  // Terminal failures (cannot be resumed/retried in-place; 24h expiration, conflict, invalid CSRF)
  CONNECTION_RESERVATION_EXPIRED: 'TERMINAL',
  PROVIDER_PHONE_ALREADY_REGISTERED: 'TERMINAL',
  PROVIDER_IDENTITY_CONFLICT: 'TERMINAL',
  INVALID_ONBOARDING_STATE: 'TERMINAL',
  ONBOARDING_SESSION_FAILED: 'TERMINAL',
  UNAUTHORIZED_WABA_ACCESS: 'TERMINAL',
  PHONE_NOT_IN_WABA: 'TERMINAL',
  WHATSAPP_OAUTH_EXCHANGE_FAILED: 'TERMINAL',
  PROVIDER_REGISTRATION_FAILED: 'TERMINAL',
  PROVIDER_SUBSCRIPTION_FAILED: 'TERMINAL',

  // Validation errors
  MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION: 'VALIDATION',
  INVALID_CURSOR: 'VALIDATION',
  CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT: 'VALIDATION',
  INVALID_PHONE_E164: 'VALIDATION',
};

export const WHATSAPP_ERROR_MESSAGES: Record<string, string> = {
  WHATSAPP_SUBSCRIPTION_SUSPENDED:
    'A integração com WhatsApp está suspensa devido ao plano da organização.',
  WHATSAPP_CAPACITY_LIMIT_REACHED:
    'O limite de conexões do WhatsApp foi atingido para sua organização.',
  ONBOARDING_SESSION_EXPIRED:
    'A sessão de conexão expirou. É possível retomar o processo.',
  ONBOARDING_SESSION_ALREADY_CONSUMED:
    'Esta sessão de conexão já foi finalizada.',
  ONBOARDING_SESSION_SUPERSEDED:
    'Uma nova sessão de conexão foi iniciada. Atualize a página.',
  CONNECTION_RESERVATION_EXPIRED:
    'A reserva da conexão expirou após 24 horas. Inicie uma nova conexão.',
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
    'O estado da conexão é inválido ou a validação de segurança falhou.',
  MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION:
    'Este ministério já possui uma conexão exclusiva atribuída.',
  INVALID_CURSOR:
    'Parâmetro de paginação inválido.',
  CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT:
    'Não é possível definir a conexão como padrão da organização e atribuí-la a um ministério simultaneamente.',
  INVALID_PHONE_E164:
    'Número de telefone deve estar no formato canônico internacional E.164.',
  ONBOARDING_SESSION_FAILED:
    'A sessão de conexão falhou. Inicie uma nova conexão.',
  UNAUTHORIZED_WABA_ACCESS:
    'Acesso não autorizado à conta do WhatsApp.',
  PHONE_NOT_IN_WABA:
    'O número de telefone informado não pertence à conta WhatsApp.',
  WHATSAPP_OAUTH_EXCHANGE_FAILED:
    'Falha na autorização com o provedor WhatsApp.',
  PROVIDER_REGISTRATION_FAILED:
    'Falha no registro do número com PIN no provedor.',
  PROVIDER_SUBSCRIPTION_FAILED:
    'Falha na assinatura de eventos no provedor.',
  WABA_LIFECYCLE_LEASE_LOST:
    'A sincronização de ciclo de vida expirou. Atualize a página e tente novamente.',
  WABA_LIFECYCLE_CONTENTION:
    'Outra operação do WhatsApp está em processamento para esta conta. Aguarde alguns instantes.',
};

export const RESTRICTION_REASON_MESSAGES: Record<string, string> = {
  SUBSCRIPTION_RESTRICTED: 'Acesso restrito devido a pendência na assinatura.',
  PLAN_EXCLUDED: 'O plano atual da organização não inclui a integração com WhatsApp.',
  CAPACITY_EXCEEDED: 'Limite de conexões do WhatsApp atingido para o plano atual.',
  ADMINISTRATIVELY_SUSPENDED: 'Acesso suspenso administrativamente pela plataforma.',
  INTEGRITY_CHECK_FAILED: 'Inconsistência temporária na validação de assinatura.',
  CONNECTION_RESERVATION_EXPIRED: 'A reserva desta conexão expirou após 24 horas.',
  ONBOARDING_SESSION_EXPIRED: 'A sessão de configuração expirou.',
  POST_GRACE_SUSPENDED: 'Assinatura suspensa por término do período de carência.',
};

export function formatRestrictionReason(reason?: string | null): string {
  if (!reason || typeof reason !== 'string') {
    return 'Ação não permitida pelas condições comerciais do plano.';
  }
  if (RESTRICTION_REASON_MESSAGES[reason]) {
    return RESTRICTION_REASON_MESSAGES[reason];
  }
  if (reason.includes(' ')) {
    return reason;
  }
  return 'Ação não permitida pelas condições comerciais do plano.';
}

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

export function getWhatsAppErrorMessage(codeOrErr?: unknown): string {
  if (!codeOrErr) return 'Ocorreu um erro na integração com WhatsApp.';
  const code = typeof codeOrErr === 'string' ? extractErrorCode(codeOrErr) || codeOrErr : extractErrorCode(codeOrErr);
  if (code && WHATSAPP_ERROR_MESSAGES[code]) {
    return WHATSAPP_ERROR_MESSAGES[code];
  }
  if (typeof codeOrErr === 'object' && (codeOrErr as any)?.message) {
    return (codeOrErr as any).message;
  }
  return 'Ocorreu um erro na integração com WhatsApp.';
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
  if (typeof err === 'string') {
    if (WHATSAPP_ERROR_CATEGORY_MAP[err]) return err;
    for (const knownCode of Object.keys(WHATSAPP_ERROR_CATEGORY_MAP)) {
      if (err.includes(knownCode)) return knownCode;
    }
    return err;
  }
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

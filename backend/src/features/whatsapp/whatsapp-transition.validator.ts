import { AppError } from '../../middleware/error-handler';
import {
  WhatsAppConnectionRecord,
  WhatsAppConnectionStatus,
  isProviderIdentityMaterialized,
} from './whatsapp.types';

export function validateConnectionTransition(
  current: WhatsAppConnectionRecord,
  target: WhatsAppConnectionStatus
): void {
  if (current.status === target) {
    return; // No-op transition
  }

  // Disconnected is strictly terminal
  if (current.status === 'disconnected') {
    throw new AppError(400, 'INVALID_WHATSAPP_CONNECTION_TRANSITION: Conexão desconectada não permite novas transições de status.', {
      code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
    });
  }

  switch (current.status) {
    case 'pending':
      if (target !== 'connecting' && target !== 'disconnected') {
        throw new AppError(400, `INVALID_WHATSAPP_CONNECTION_TRANSITION: Transição de ${current.status} para ${target} não é permitida.`, {
          code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
        });
      }
      break;

    case 'connecting':
      if (target !== 'connected' && target !== 'error' && target !== 'disconnected') {
        throw new AppError(400, `INVALID_WHATSAPP_CONNECTION_TRANSITION: Transição de ${current.status} para ${target} não é permitida.`, {
          code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
        });
      }
      if (target === 'connected') {
        if (!isProviderIdentityMaterialized(current)) {
          throw new AppError(400, 'CONNECTION_NOT_MATERIALIZED: Conexão deve ter identidade de provedor materializada para conectar.', {
            code: 'CONNECTION_NOT_MATERIALIZED',
          });
        }
      }
      break;

    case 'connected':
      if (target !== 'error' && target !== 'disabled_by_user' && target !== 'disconnected') {
        throw new AppError(400, `INVALID_WHATSAPP_CONNECTION_TRANSITION: Transição de ${current.status} para ${target} não é permitida.`, {
          code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
        });
      }
      break;

    case 'error':
      if (
        target !== 'connecting' &&
        target !== 'connected' &&
        target !== 'disabled_by_user' &&
        target !== 'disconnected'
      ) {
        throw new AppError(400, `INVALID_WHATSAPP_CONNECTION_TRANSITION: Transição de ${current.status} para ${target} não é permitida.`, {
          code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
        });
      }

      if (target === 'connected') {
        if (!isProviderIdentityMaterialized(current)) {
          throw new AppError(400, 'CONNECTION_NOT_MATERIALIZED: Conexão deve ter identidade de provedor materializada para conectar.', {
            code: 'CONNECTION_NOT_MATERIALIZED',
          });
        }
      }

      if (target === 'disabled_by_user') {
        // DEC-7C-04 / DEC-7C-13 / DEC-7C-15:
        // ALLOWED ONLY IF PREVIOUSLY CONNECTED (last_connected_at !== null and materialized)
        if (current.last_connected_at === null || !isProviderIdentityMaterialized(current)) {
          throw new AppError(
            400,
            'INVALID_WHATSAPP_CONNECTION_TRANSITION: Conexões que nunca foram conectadas com sucesso não podem ser desativadas pelo usuário.',
            { code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION' }
          );
        }
      }
      break;

    case 'disabled_by_user':
      if (target !== 'connected' && target !== 'disconnected') {
        throw new AppError(400, `INVALID_WHATSAPP_CONNECTION_TRANSITION: Transição de ${current.status} para ${target} não é permitida.`, {
          code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
        });
      }
      if (target === 'connected') {
        if (!isProviderIdentityMaterialized(current)) {
          throw new AppError(400, 'CONNECTION_NOT_MATERIALIZED: Conexão deve ter identidade de provedor materializada para conectar.', {
            code: 'CONNECTION_NOT_MATERIALIZED',
          });
        }
      }
      break;

    default:
      throw new AppError(400, `INVALID_WHATSAPP_CONNECTION_TRANSITION: Status de conexão desconhecido: ${current.status}`, {
        code: 'INVALID_WHATSAPP_CONNECTION_TRANSITION',
      });
  }
}

import crypto from 'crypto';
import { AppError } from '../../middleware/error-handler';
import { config } from '../../config/unifiedConfig';
import { WhatsAppConnectionSecretRecord } from './whatsapp.types';

export class WhatsAppEncryptionService {
  private readonly configuredKey?: string;

  constructor(overrideKey?: string) {
    this.configuredKey = overrideKey;
  }

  private getValidatedKey(): Buffer {
    const rawKey = this.configuredKey || config.whatsappTokenEncryptionKey || process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;

    if (!rawKey || typeof rawKey !== 'string') {
      throw new AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING: Chave de criptografia do WhatsApp ausente ou inválida.', {
        code: 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING',
      });
    }

    const trimmed = rawKey.trim();
    if (!trimmed) {
      throw new AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING: Chave de criptografia do WhatsApp ausente ou inválida.', {
        code: 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING',
      });
    }

    // Strict Base64 validation
    const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
    if (!base64Regex.test(trimmed)) {
      throw new AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING: Chave de criptografia do WhatsApp ausente ou inválida.', {
        code: 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING',
      });
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(trimmed, 'base64');
    } catch {
      throw new AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING: Chave de criptografia do WhatsApp ausente ou inválida.', {
        code: 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING',
      });
    }

    // Must be exactly 32 bytes (256 bits)
    if (buffer.length !== 32) {
      throw new AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING: Chave de criptografia do WhatsApp deve ter exatamente 32 bytes decodificados.', {
        code: 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING',
      });
    }

    return buffer;
  }

  encryptToken(
    token: string,
    orgId: string,
    connectionId: string
  ): {
    encryptedAccessToken: string;
    iv: string;
    authTag: string;
    keyVersion: number;
  } {
    const key = this.getValidatedKey();

    // 12 bytes IV standard for AES-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    // Bind AAD to organization and connection identity
    const aad = Buffer.from(`${orgId}:${connectionId}`, 'utf8');
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      encryptedAccessToken: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: 1,
    };
  }

  decryptToken(
    record: WhatsAppConnectionSecretRecord,
    expectedOrgId?: string,
    expectedConnectionId?: string
  ): string {
    const key = this.getValidatedKey();

    // Cumulative tenancy verification
    if (expectedOrgId && record.organization_id !== expectedOrgId) {
      throw new AppError(500, 'SECRET_DECRYPTION_FAILED: Falha na descriptografia do token: organização incorreta.', {
        code: 'SECRET_DECRYPTION_FAILED',
      });
    }

    if (expectedConnectionId && record.connection_id !== expectedConnectionId) {
      throw new AppError(500, 'SECRET_DECRYPTION_FAILED: Falha na descriptografia do token: conexão incorreta.', {
        code: 'SECRET_DECRYPTION_FAILED',
      });
    }

    try {
      const iv = Buffer.from(record.iv, 'base64');
      if (iv.length !== 12) {
        throw new Error('Invalid IV length');
      }

      const authTag = Buffer.from(record.auth_tag, 'base64');
      if (authTag.length !== 16) {
        throw new Error('Invalid auth tag length');
      }

      const ciphertext = Buffer.from(record.encrypted_access_token, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      const aad = Buffer.from(`${record.organization_id}:${record.connection_id}`, 'utf8');
      decipher.setAAD(aad);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      throw new AppError(500, 'SECRET_DECRYPTION_FAILED: Falha na descriptografia do token.', {
        code: 'SECRET_DECRYPTION_FAILED',
      });
    }
  }
}

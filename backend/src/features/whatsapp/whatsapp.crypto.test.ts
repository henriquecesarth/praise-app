import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { WhatsAppConnectionSecretRecord } from './whatsapp.types';

describe('WhatsApp Encryption Service Suite (Phase 7C)', () => {
  const validKey = crypto.randomBytes(32).toString('base64');
  const encryptionService = new WhatsAppEncryptionService(validKey);

  it('1. Encrypt and decrypt round trip produces identical plaintext', () => {
    const rawToken = 'EAAGm0PX4ZB74BA...valid_test_meta_token...12345';
    const orgId = 'org-test-1';
    const connId = 'wac-test-1';

    const encrypted = encryptionService.encryptToken(rawToken, orgId, connId);
    expect(encrypted.encryptedAccessToken).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.keyVersion).toBe(1);

    const secretRecord: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: orgId,
      key_version: encrypted.keyVersion,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const decrypted = encryptionService.decryptToken(secretRecord, orgId, connId);
    expect(decrypted).toBe(rawToken);
  });

  it('2. Same plaintext produces different ciphertext and IV on subsequent encryptions', () => {
    const rawToken = 'EAAGm0PX4ZB74BA...same_plaintext';
    const orgId = 'org-test-1';
    const connId = 'wac-test-1';

    const enc1 = encryptionService.encryptToken(rawToken, orgId, connId);
    const enc2 = encryptionService.encryptToken(rawToken, orgId, connId);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.encryptedAccessToken).not.toBe(enc2.encryptedAccessToken);
  });

  it('3. Decryption with incorrect organization_id (AAD mismatch) fails with SECRET_DECRYPTION_FAILED', () => {
    const rawToken = 'EAAGm0PX4ZB74BA...test_token';
    const orgId = 'org-test-1';
    const connId = 'wac-test-1';

    const encrypted = encryptionService.encryptToken(rawToken, orgId, connId);
    const secretRecord: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: 'org-test-wrong', // Wrong org
      key_version: encrypted.keyVersion,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => encryptionService.decryptToken(secretRecord, 'org-test-wrong', connId)).toThrow(
      /SECRET_DECRYPTION_FAILED/
    );
  });

  it('4. Decryption with incorrect connection_id (AAD mismatch) fails with SECRET_DECRYPTION_FAILED', () => {
    const rawToken = 'EAAGm0PX4ZB74BA...test_token';
    const orgId = 'org-test-1';
    const connId = 'wac-test-1';

    const encrypted = encryptionService.encryptToken(rawToken, orgId, connId);
    const secretRecord: WhatsAppConnectionSecretRecord = {
      id: 'wac-test-wrong',
      connection_id: 'wac-test-wrong', // Wrong connection ID
      organization_id: orgId,
      key_version: encrypted.keyVersion,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => encryptionService.decryptToken(secretRecord, orgId, 'wac-test-wrong')).toThrow(
      /SECRET_DECRYPTION_FAILED/
    );
  });

  it('5. Tampered ciphertext bytes cause fail-closed decryption failure', () => {
    const rawToken = 'EAAGm0PX4ZB74BA...test_token';
    const orgId = 'org-test-1';
    const connId = 'wac-test-1';

    const encrypted = encryptionService.encryptToken(rawToken, orgId, connId);
    const rawCipher = Buffer.from(encrypted.encryptedAccessToken, 'base64');
    rawCipher[0] ^= 0xff; // Corrupt first byte

    const secretRecord: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: orgId,
      key_version: encrypted.keyVersion,
      encrypted_access_token: rawCipher.toString('base64'),
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => encryptionService.decryptToken(secretRecord, orgId, connId)).toThrow(
      /SECRET_DECRYPTION_FAILED/
    );
  });

  it('6. Tampered auth tag causes fail-closed decryption failure', () => {
    const rawToken = 'EAAGm0PX4ZB74BA...test_token';
    const orgId = 'org-test-1';
    const connId = 'wac-test-1';

    const encrypted = encryptionService.encryptToken(rawToken, orgId, connId);
    const rawTag = Buffer.from(encrypted.authTag, 'base64');
    rawTag[0] ^= 0xff; // Corrupt first byte of tag

    const secretRecord: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: orgId,
      key_version: encrypted.keyVersion,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: rawTag.toString('base64'),
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(() => encryptionService.decryptToken(secretRecord, orgId, connId)).toThrow(
      /SECRET_DECRYPTION_FAILED/
    );
  });

  it('7. Invalid Base64 key fails with WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING', () => {
    const badService = new WhatsAppEncryptionService('not-valid-base64@@@!!');
    expect(() => badService.encryptToken('test', 'org1', 'conn1')).toThrow(
      /WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING/
    );
  });

  it('8. Key with decoded length != 32 bytes fails with WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING', () => {
    // 16 bytes key (AES-128)
    const key16 = crypto.randomBytes(16).toString('base64');
    const badService16 = new WhatsAppEncryptionService(key16);
    expect(() => badService16.encryptToken('test', 'org1', 'conn1')).toThrow(
      /WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING/
    );

    // 24 bytes key
    const key24 = crypto.randomBytes(24).toString('base64');
    const badService24 = new WhatsAppEncryptionService(key24);
    expect(() => badService24.encryptToken('test', 'org1', 'conn1')).toThrow(
      /WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING/
    );
  });

  it('9. Missing key throws on crypto use but not server bootstrap', () => {
    const emptyService = new WhatsAppEncryptionService('');
    expect(() => emptyService.encryptToken('test', 'org1', 'conn1')).toThrow(
      /WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING/
    );
  });

  it('10. Secret record contains no plaintext tokens', () => {
    const rawToken = 'super-secret-token-12345';
    const encrypted = encryptionService.encryptToken(rawToken, 'org1', 'conn1');

    expect(encrypted.encryptedAccessToken).not.toContain(rawToken);
    expect(encrypted.iv).not.toContain(rawToken);
    expect(encrypted.authTag).not.toContain(rawToken);
  });
});

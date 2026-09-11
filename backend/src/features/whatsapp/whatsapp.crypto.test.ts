import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { WhatsAppConnectionSecretRecord } from './whatsapp.types';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { db } from '../../lib/firebase';

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

describe('WhatsApp Connection Secret Repository Suite (Phase 7C / F5 remediation)', () => {
  let secretsStore: Map<string, WhatsAppConnectionSecretRecord>;
  let secretRepo: WhatsAppConnectionSecretRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    secretsStore = new Map();

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      if (colName === 'whatsapp_connection_secrets') {
        return {
          doc: (id: string) => ({
            id,
            get: vi.fn().mockImplementation(async () => {
              const data = secretsStore.get(id);
              return {
                exists: Boolean(data),
                id,
                data: () => data,
              };
            }),
            set: vi.fn().mockImplementation(async (data: any) => {
              secretsStore.set(id, { id, ...data });
            }),
            delete: vi.fn().mockImplementation(async () => {
              secretsStore.delete(id);
            }),
          }),
        };
      }
      return {
        doc: (id: string) => ({
          get: vi.fn().mockResolvedValue({ exists: false }),
        }),
      };
    });

    vi.spyOn(db, 'runTransaction').mockImplementation(async (updateFn: any) => {
      const tx: any = {
        get: async (docRef: any) => {
          return await docRef.get();
        },
        set: (docRef: any, data: any) => {
          secretsStore.set(docRef.id, { id: docRef.id, ...data });
        },
        delete: (docRef: any) => {
          secretsStore.delete(docRef.id);
        },
      };
      return await updateFn(tx);
    });

    secretRepo = new WhatsAppConnectionSecretRepository();
  });

  it('11. Deleting secret with mismatched tenant (orgB deleting orgA secret) rejects with 404 and leaves secret intact (F5 remediation)', async () => {
    const orgA = 'org-tenant-a';
    const orgB = 'org-tenant-b';
    const connId = 'conn-secret-1';

    const secret: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: orgA,
      key_version: 1,
      encrypted_access_token: 'enc-blob',
      iv: 'iv-blob',
      auth_tag: 'tag-blob',
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    secretsStore.set(connId, secret);

    // Call deleteSecret with orgB (cross-tenant attack)
    await expect(secretRepo.deleteSecret(orgB, connId)).rejects.toMatchObject({
      statusCode: 404,
      message: 'Secret não encontrado nesta organização.',
    });

    // Verify secret remains untouched
    expect(secretsStore.get(connId)).toBeDefined();
    expect(secretsStore.get(connId)?.organization_id).toBe(orgA);
  });

  it('12. Deleting secret with matching tenant succeeds and removes secret (F5 remediation)', async () => {
    const orgA = 'org-tenant-a';
    const connId = 'conn-secret-2';

    const secret: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: orgA,
      key_version: 1,
      encrypted_access_token: 'enc-blob-2',
      iv: 'iv-blob-2',
      auth_tag: 'tag-blob-2',
      token_type: 'system_user',
      expires_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    secretsStore.set(connId, secret);

    await secretRepo.deleteSecret(orgA, connId);

    expect(secretsStore.get(connId)).toBeUndefined();
  });

  it('13. Deleting non-existent secret is safe and idempotent (returns without error)', async () => {
    await expect(secretRepo.deleteSecret('org-test', 'non-existent')).resolves.not.toThrow();
  });

  it('14. Secret record with token_type business_token encrypts and decrypts correctly (Phase 7D1)', () => {
    const rawToken = 'EAAGm0PX4ZB74BA_business_token_12345';
    const orgId = 'org-test-biz';
    const connId = 'wac-test-biz';

    const encService = new WhatsAppEncryptionService(crypto.randomBytes(32).toString('base64'));
    const encrypted = encService.encryptToken(rawToken, orgId, connId);
    const secretRecord: WhatsAppConnectionSecretRecord = {
      id: connId,
      connection_id: connId,
      organization_id: orgId,
      key_version: encrypted.keyVersion,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      token_type: 'business_token',
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const decrypted = encService.decryptToken(secretRecord, orgId, connId);
    expect(decrypted).toBe(rawToken);
    expect(secretRecord.token_type).toBe('business_token');
  });
});

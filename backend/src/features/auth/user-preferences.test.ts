import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { config } from '../../config/unifiedConfig';
import * as unifiedConfig from '../../config/unifiedConfig';
import { authAdmin, db } from '../../lib/firebase';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { AppError } from '../../middleware/error-handler';
import {
  SUPPORTED_CHORD_FONTS,
  DEFAULT_CHORD_FONT,
  DEFAULT_CHORD_LINE_SPACING_PX,
  updatePreferencesSchema,
} from './auth.types';

describe('Universal Chord Font — Backend Preferences Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  const userDocs = new Map<string, any>();

  const testUserA = {
    id: 'usr-font-alice-001',
    email: 'alice@louvaio.com',
    name: 'Alice Chordist',
    createdAt: '2026-01-01T10:00:00.000Z',
  };

  const testUserB = {
    id: 'usr-font-bob-002',
    email: 'bob@louvaio.com',
    name: 'Bob Bassist',
    createdAt: '2026-01-02T10:00:00.000Z',
    preferences: {
      chord_font_family: 'Georgia',
      theme_mode: 'dark',
    },
  };

  const tokenUserA = jwt.sign(
    { uid: testUserA.id, email: testUserA.email },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  const tokenUserB = jwt.sign(
    { uid: testUserB.id, email: testUserB.email },
    config.jwtSecret,
    { expiresIn: '1h' }
  );

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = 'http://127.0.0.1:' + addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(false);

    userDocs.clear();
    userDocs.set(testUserA.id, { ...testUserA });
    userDocs.set(testUserB.id, {
      ...testUserB,
      preferences: { ...testUserB.preferences },
    });

    vi.spyOn(UserRepository.prototype, 'findById').mockImplementation(async (uid: string) => {
      const doc = userDocs.get(uid);
      if (!doc) return null;
      return {
        id: doc.id,
        email: doc.email,
        name: doc.name,
        createdAt: doc.createdAt,
        preferences: doc.preferences,
      };
    });

    vi.spyOn(UserRepository.prototype, 'updatePreferences').mockImplementation(async (userId: string, patch: any) => {
      const existing = userDocs.get(userId);
      if (!existing) {
        throw new AppError(404, 'Perfil de usuário não encontrado.');
      }
      const currentPreferences = (existing.preferences && typeof existing.preferences === 'object')
        ? existing.preferences
        : {};
      const updatedPreferences = {
        ...currentPreferences,
        ...patch,
      };
      userDocs.set(userId, {
        ...existing,
        preferences: updatedPreferences,
      });
      return updatedPreferences;
    });
  });

  describe('1. Zod Schema Validation', () => {
    it('accepts all 6 officially supported font identifiers', () => {
      for (const font of SUPPORTED_CHORD_FONTS) {
        const parsed = updatePreferencesSchema.safeParse({ chord_font_family: font });
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          expect(parsed.data.chord_font_family).toBe(font);
        }
      }
    });

    it('rejects unsupported font identifier (e.g. Comic Sans)', () => {
      const parsed = updatePreferencesSchema.safeParse({ chord_font_family: 'Comic Sans' });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].message).toBe('Fonte de acordes não suportada.');
      }
    });

    it('rejects unknown preference fields (.strict enforcement)', () => {
      const parsed = updatePreferencesSchema.safeParse({
        chord_font_family: 'Arial',
        unknown_field: 'malicious_override',
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].code).toBe('unrecognized_keys');
      }
    });

    it('rejects empty payload or missing chord_font_family', () => {
      const parsed = updatePreferencesSchema.safeParse({});
      expect(parsed.success).toBe(false);
    });

    it('accepts only even line spacing values from 0 through 24', () => {
      for (const spacing of [0, 2, 8, 24]) {
        expect(updatePreferencesSchema.safeParse({ chord_line_spacing_px: spacing }).success).toBe(true);
      }
      for (const spacing of [-2, 1, 25, 8.5, '8']) {
        expect(updatePreferencesSchema.safeParse({ chord_line_spacing_px: spacing }).success).toBe(false);
      }
    });
  });

  describe('2. Read Contract: GET /api/v1/auth/me', () => {
    it('Scenario 1: Existing user without preferences gets monospace fallback without DB writes', async () => {
      const response = await fetch(baseUrl + '/api/v1/auth/me', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + tokenUserA,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.id).toBe(testUserA.id);
      expect(data.email).toBe(testUserA.email);
      expect(data.name).toBe(testUserA.name);
      expect(data.preferences).toEqual({
        chord_font_family: 'monospace',
        chord_line_spacing_px: DEFAULT_CHORD_LINE_SPACING_PX,
      });

      expect(userDocs.get(testUserA.id).preferences).toBeUndefined();
    });

    it('Scenario 2: Existing user with saved preference gets the correct stored value', async () => {
      const response = await fetch(baseUrl + '/api/v1/auth/me', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + tokenUserB,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.id).toBe(testUserB.id);
      expect(data.preferences).toEqual({
        chord_font_family: 'Georgia',
        chord_line_spacing_px: DEFAULT_CHORD_LINE_SPACING_PX,
        theme_mode: 'dark',
      });
    });

    it('Scenario 3: Corrupted or invalid stored font safely falls back to monospace', async () => {
      userDocs.set('usr-corrupt', {
        id: 'usr-corrupt',
        email: 'corrupt@louvaio.com',
        name: 'Corrupt Profile',
        preferences: {
          chord_font_family: 'NonExistentFontFamily',
        },
      });

      const tokenCorrupt = jwt.sign(
        { uid: 'usr-corrupt', email: 'corrupt@louvaio.com' },
        config.jwtSecret,
        { expiresIn: '1h' }
      );

      const response = await fetch(baseUrl + '/api/v1/auth/me', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + tokenCorrupt,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.preferences.chord_font_family).toBe('monospace');
      expect(data.preferences.chord_line_spacing_px).toBe(DEFAULT_CHORD_LINE_SPACING_PX);
    });
  });

  describe('3. Mutation Contract: PATCH /api/v1/auth/me/preferences', () => {
    it('returns the repository authorization failure without creating or changing a preference', async () => {
      const initial = JSON.stringify(userDocs.get(testUserA.id));
      vi.spyOn(UserRepository.prototype, 'updatePreferences')
        .mockRejectedValueOnce(new AppError(403, 'Acesso restrito no ambiente de Preview.'));
      const response = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenUserA },
        body: JSON.stringify({ chord_line_spacing_px: 12 }),
      });
      expect(response.status).toBe(403);
      expect(JSON.stringify(userDocs.get(testUserA.id))).toBe(initial);
    });

    it('Scenario 4: Authenticated update persists the selected font and subsequent read returns it', async () => {
      const patchRes = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenUserA,
        },
        body: JSON.stringify({
          chord_font_family: 'Verdana',
        }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = (await patchRes.json()) as any;
      expect(patchData.preferences).toEqual({
        chord_font_family: 'Verdana',
        chord_line_spacing_px: DEFAULT_CHORD_LINE_SPACING_PX,
      });

      const stored = userDocs.get(testUserA.id);
      expect(stored.preferences.chord_font_family).toBe('Verdana');

      const getRes = await fetch(baseUrl + '/api/v1/auth/me', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ' + tokenUserA,
        },
      });

      expect(getRes.status).toBe(200);
      const getData = (await getRes.json()) as any;
      expect(getData.preferences.chord_font_family).toBe('Verdana');
      expect(getData.preferences.chord_line_spacing_px).toBe(DEFAULT_CHORD_LINE_SPACING_PX);
    });

    it('updates only line spacing and preserves the existing font and other preferences', async () => {
      const response = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tokenUserB },
        body: JSON.stringify({ chord_line_spacing_px: 24 }),
      });
      expect(response.status).toBe(200);
      expect((await response.json() as any).preferences).toEqual({
        chord_font_family: 'Georgia',
        chord_line_spacing_px: 24,
        theme_mode: 'dark',
      });
      expect(userDocs.get(testUserA.id).preferences).toBeUndefined();
      expect(userDocs.get(testUserB.id).preferences).toEqual({
        chord_font_family: 'Georgia',
        chord_line_spacing_px: 24,
        theme_mode: 'dark',
      });
    });

    it('Scenario 5: Updating chord font does NOT overwrite other user identity fields', async () => {
      await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenUserA,
        },
        body: JSON.stringify({
          chord_font_family: 'Times New Roman',
        }),
      });

      const stored = userDocs.get(testUserA.id);
      expect(stored.id).toBe(testUserA.id);
      expect(stored.email).toBe(testUserA.email);
      expect(stored.name).toBe(testUserA.name);
      expect(stored.createdAt).toBe(testUserA.createdAt);
      expect(stored.preferences.chord_font_family).toBe('Times New Roman');
    });

    it('Scenario 6: Updating chord font does NOT delete unrelated preferences', async () => {
      const patchRes = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenUserB,
        },
        body: JSON.stringify({
          chord_font_family: 'Courier New',
        }),
      });

      expect(patchRes.status).toBe(200);
      const patchData = (await patchRes.json()) as any;
      expect(patchData.preferences).toEqual({
        chord_font_family: 'Courier New',
        chord_line_spacing_px: DEFAULT_CHORD_LINE_SPACING_PX,
        theme_mode: 'dark',
      });

      const stored = userDocs.get(testUserB.id);
      expect(stored.preferences.theme_mode).toBe('dark');
      expect(stored.preferences.chord_font_family).toBe('Courier New');
    });

    it('Scenario 7: Unknown font or unknown preference field is rejected with 400 without writes', async () => {
      const initialDocB = JSON.stringify(userDocs.get(testUserB.id));

      const resInvalidFont = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenUserB,
        },
        body: JSON.stringify({
          chord_font_family: 'Papyrus',
        }),
      });
      expect(resInvalidFont.status).toBe(400);

      const resExtraField = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenUserB,
        },
        body: JSON.stringify({
          chord_font_family: 'Arial',
          isAdmin: true,
        }),
      });
      expect(resExtraField.status).toBe(400);

      expect(JSON.stringify(userDocs.get(testUserB.id))).toBe(initialDocB);
    });

    it('Scenario 8: User isolation — User A cannot alter User B preference even if trying client overrides', async () => {
      const initialDocB = JSON.stringify(userDocs.get(testUserB.id));

      const attackRes = await fetch(baseUrl + '/api/v1/auth/me/preferences?userId=' + testUserB.id, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenUserA,
        },
        body: JSON.stringify({
          chord_font_family: 'Arial',
        }),
      });

      expect(attackRes.status).toBe(200);
      expect(userDocs.get(testUserA.id).preferences.chord_font_family).toBe('Arial');
      expect(JSON.stringify(userDocs.get(testUserB.id))).toBe(initialDocB);
    });

    it('Scenario 9: Missing or invalid authentication is rejected with 401', async () => {
      const resNoAuth = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chord_font_family: 'Arial',
        }),
      });
      expect(resNoAuth.status).toBe(401);

      const resBadToken = await fetch(baseUrl + '/api/v1/auth/me/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid.token',
        },
        body: JSON.stringify({
          chord_font_family: 'Arial',
        }),
      });
      expect(resBadToken.status).toBe(401);
    });
  });

  describe('4. Unit: UserRepository persistence logic', () => {
    it('UserRepository.updatePreferences merges preferences and preserves existing fields', async () => {
      vi.restoreAllMocks();

      const memoryStore = new Map<string, any>();
      memoryStore.set('usr-unit-1', {
        id: 'usr-unit-1',
        email: 'unit@louvaio.com',
        name: 'Unit Tester',
        createdAt: '2026-01-01T00:00:00.000Z',
        preferences: {
          existing_key: 'preserved_value',
        },
      });

      const repo = new UserRepository();

      vi.spyOn((repo as any).usersCollection, 'doc').mockImplementation((...args: any[]) => {
        const docId = args[0] as string;
        return {
          get: async () => {
            const exists = memoryStore.has(docId);
            return {
              exists,
              id: docId,
              data: () => (exists ? JSON.parse(JSON.stringify(memoryStore.get(docId))) : undefined),
            };
          },
          update: async (fields: Record<string, unknown>) => {
            if (!memoryStore.has(docId)) throw Object.assign(new Error('missing'), { code: 5 });
            const existing = memoryStore.get(docId)!;
            for (const [path, value] of Object.entries(fields)) {
              const [, key] = path.split('.');
              existing.preferences ??= {};
              existing.preferences[key] = value;
            }
            memoryStore.set(docId, existing);
          },
          create: async (data: any) => {
            if (memoryStore.has(docId)) throw Object.assign(new Error('exists'), { code: 6 });
            memoryStore.set(docId, JSON.parse(JSON.stringify(data)));
          },
        } as any;
      });

      const updated = await repo.updatePreferences('usr-unit-1', {
        chord_font_family: 'Verdana',
      });

      expect(updated).toEqual({
        existing_key: 'preserved_value',
        chord_font_family: 'Verdana',
      });

      const user = await repo.findById('usr-unit-1');
      expect(user?.id).toBe('usr-unit-1');
      expect(user?.email).toBe('unit@louvaio.com');
      expect(user?.name).toBe('Unit Tester');
      expect(user?.preferences).toEqual({
        existing_key: 'preserved_value',
        chord_font_family: 'Verdana',
      });

      await Promise.all([
        repo.updatePreferences('usr-unit-1', { chord_font_family: 'Arial' }),
        repo.updatePreferences('usr-unit-1', { chord_line_spacing_px: 24 }),
      ]);
      const concurrent = await repo.findById('usr-unit-1');
      expect(concurrent?.preferences).toEqual({
        existing_key: 'preserved_value',
        chord_font_family: 'Arial',
        chord_line_spacing_px: 24,
      });
    });

    it('creates a safe profile from an enabled Firebase identity when the Firestore document is absent', async () => {
      vi.restoreAllMocks();

      const repo = new UserRepository();
      const memoryStore = new Map<string, any>();
      vi.spyOn((repo as any).usersCollection, 'doc').mockReturnValue({
        update: async () => { throw Object.assign(new Error('missing'), { code: 5 }); },
        create: async (data: any) => { memoryStore.set(data.id, data); },
        get: async () => ({
          exists: memoryStore.has('usr-new'),
          id: 'usr-new',
          data: () => memoryStore.get('usr-new'),
        }),
      } as any);
      vi.spyOn(authAdmin, 'getUser').mockResolvedValue({
        uid: 'usr-new', email: 'new@louvaio.com', displayName: 'New User', disabled: false,
      } as any);

      const result = await repo.updatePreferences('usr-new', { chord_line_spacing_px: 12 });
      expect(result).toEqual({ chord_line_spacing_px: 12 });
      expect(memoryStore.get('usr-new')).toMatchObject({
        id: 'usr-new', email: 'new@louvaio.com', name: 'New User',
        preferences: { chord_line_spacing_px: 12 },
      });
    });

    it('does not create a profile when Firebase identity is missing, mismatched, or disabled', async () => {
      vi.restoreAllMocks();
      const repo = new UserRepository();
      const create = vi.fn();
      vi.spyOn((repo as any).usersCollection, 'doc').mockReturnValue({
        update: async () => { throw Object.assign(new Error('missing'), { code: 5 }); },
        create,
      } as any);
      const getUser = vi.spyOn(authAdmin, 'getUser');

      getUser.mockRejectedValueOnce(Object.assign(new Error('missing auth user'), { code: 'auth/user-not-found' }));
      await expect(repo.updatePreferences('missing-user', { chord_font_family: 'Arial' }))
        .rejects.toThrow('Perfil de usuário não encontrado.');
      getUser.mockResolvedValueOnce({ uid: 'different-user', disabled: false } as any);
      await expect(repo.updatePreferences('requested-user', { chord_font_family: 'Arial' }))
        .rejects.toThrow('Identidade do usuário inválida.');
      getUser.mockResolvedValueOnce({ uid: 'disabled-user', disabled: true } as any);
      await expect(repo.updatePreferences('disabled-user', { chord_font_family: 'Arial' }))
        .rejects.toThrow('Conta de usuário desabilitada.');
      expect(create).not.toHaveBeenCalled();
    });

    it('propagates Firebase identity lookup infrastructure errors without writing', async () => {
      vi.restoreAllMocks();
      const repo = new UserRepository();
      const create = vi.fn();
      vi.spyOn((repo as any).usersCollection, 'doc').mockReturnValue({
        update: async () => { throw Object.assign(new Error('missing'), { code: 5 }); },
        create,
      } as any);
      const infrastructureError = Object.assign(new Error('Firebase unavailable'), { code: 'auth/internal-error' });
      vi.spyOn(authAdmin, 'getUser').mockRejectedValue(infrastructureError);

      await expect(repo.updatePreferences('user-during-outage', { chord_font_family: 'Arial' }))
        .rejects.toBe(infrastructureError);
      expect(create).not.toHaveBeenCalled();
    });

    it('rejects a Preview UID before Firestore or Firebase Auth access', async () => {
      vi.restoreAllMocks();
      const repo = new UserRepository();
      const doc = vi.fn();
      vi.spyOn((repo as any).usersCollection, 'doc').mockImplementation(doc);
      vi.spyOn(unifiedConfig, 'assertPreviewUidAllowed').mockImplementation((uid: string) => {
        if (uid === 'blocked-preview-user') throw new AppError(403, 'Acesso restrito no ambiente de Preview.');
      });
      const getUser = vi.spyOn(authAdmin, 'getUser');

      await expect(repo.updatePreferences('blocked-preview-user', { chord_font_family: 'Arial' }))
        .rejects.toThrow('Acesso restrito no ambiente de Preview.');
      expect(doc).not.toHaveBeenCalled();
      expect(getUser).not.toHaveBeenCalled();
    });

    it('keeps a concurrently created profile and atomically applies only the requested preference', async () => {
      vi.restoreAllMocks();
      const profile: any = { id: 'usr-race', email: 'winner@louvaio.com', name: 'Winner', preferences: { theme_mode: 'dark' } };
      const update = vi.fn(async (fields: Record<string, unknown>) => {
        for (const [path, value] of Object.entries(fields)) {
          const [, key] = path.split('.');
          profile.preferences[key] = value;
        }
      });
      const repo = new UserRepository();
      vi.spyOn((repo as any).usersCollection, 'doc').mockReturnValue({
        update: vi.fn()
          .mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 5 }))
          .mockImplementationOnce(update),
        create: async () => { throw Object.assign(new Error('exists'), { code: 6 }); },
        get: async () => ({ exists: true, id: profile.id, data: () => profile }),
      } as any);
      vi.spyOn(authAdmin, 'getUser').mockResolvedValue({ uid: 'usr-race', disabled: false } as any);

      const result = await repo.updatePreferences('usr-race', { chord_line_spacing_px: 6 });
      expect(update).toHaveBeenCalledWith({ 'preferences.chord_line_spacing_px': 6 });
      expect(profile).toEqual({ id: 'usr-race', email: 'winner@louvaio.com', name: 'Winner', preferences: { theme_mode: 'dark', chord_line_spacing_px: 6 } });
      expect(result).toEqual(profile.preferences);
    });
  });
});

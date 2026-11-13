import { describe, it, expect, vi, afterEach } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import classificationRouter from './classification.routes';
import { ClassificationRepository } from '../../repositories/ClassificationRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { errorHandler } from '../../middleware/error-handler';

describe('Classification Router Commercial Enforcement (H14)', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      servers.splice(0).map((s) => {
        s.closeAllConnections?.();
        return new Promise<void>((resolve) => s.close(() => resolve()));
      })
    );
  });

  async function startServer() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/classifications', classificationRouter);
    app.use('/api/v1/groups/:groupId/classifications', classificationRouter);
    app.use(errorHandler);
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(server.address() as any).port}`;
  }

  function mockAdminContext(accessMode: 'suspended' | 'restricted_over_limit') {
    vi.spyOn(UserRepository.prototype, 'verifyToken').mockResolvedValue({
      uid: 'user-admin-1',
      email: 'admin@test.dev',
    } as any);
    vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(false);
    vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
      id: 'min-1',
      role: 'admin',
    } as any);
    vi.spyOn(SubscriptionService.prototype, 'getSubscriptionSummary').mockResolvedValue({
      subscription: {
        accessMode,
        administrativelySuspended: accessMode === 'suspended',
      },
      overLimitDetails: [],
      quotas: { members: 10, songs: 50 },
      usage: { membersCount: 12, songsCount: 60 },
    } as any);
  }

  it('blocks POST, PUT and DELETE with 403 SUBSCRIPTION_SUSPENDED without executing repository writes', async () => {
    mockAdminContext('suspended');
    const createSpy = vi
      .spyOn(ClassificationRepository.prototype, 'createClassification')
      .mockResolvedValue({ id: 'cls-created' } as any);
    const updateSpy = vi
      .spyOn(ClassificationRepository.prototype, 'updateClassification')
      .mockResolvedValue({ id: 'cls-1' } as any);
    const deleteSpy = vi
      .spyOn(ClassificationRepository.prototype, 'deleteClassification')
      .mockResolvedValue(undefined);
    const base = await startServer();
    const headers = { authorization: 'Bearer tok', 'content-type': 'application/json', connection: 'close' };

    const postRes = await fetch(`${base}/api/v1/ministries/min-1/classifications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Júbilo' }),
    });
    const putRes = await fetch(`${base}/api/v1/groups/min-1/classifications/cls-1`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ name: 'Adoração' }),
    });
    const delRes = await fetch(`${base}/api/v1/ministries/min-1/classifications/cls-1`, {
      method: 'DELETE',
      headers,
    });

    expect(postRes.status).toBe(403);
    expect(putRes.status).toBe(403);
    expect(delRes.status).toBe(403);
    expect((await postRes.json() as any).error.details.code).toBe('SUBSCRIPTION_SUSPENDED');
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('blocks POST, PUT and DELETE with 403 SUBSCRIPTION_RESTRICTED when restricted_over_limit', async () => {
    mockAdminContext('restricted_over_limit');
    const createSpy = vi
      .spyOn(ClassificationRepository.prototype, 'createClassification')
      .mockResolvedValue({ id: 'cls-created' } as any);
    const base = await startServer();
    const headers = { authorization: 'Bearer tok', 'content-type': 'application/json', connection: 'close' };

    const postRes = await fetch(`${base}/api/v1/ministries/min-1/classifications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Ceia' }),
    });

    expect(postRes.status).toBe(403);
    expect((await postRes.json() as any).error.details.code).toBe('SUBSCRIPTION_RESTRICTED');
    expect(createSpy).not.toHaveBeenCalled();
  });
});

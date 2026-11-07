import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
vi.mock('../../lib/firebase', () => ({ db: { collection: vi.fn(() => ({})) }, messagingAdmin: {} }));
import { MinistryRepository } from '../../repositories/MinistryRepository';
import router from './schedule.routes';

afterEach(() => vi.restoreAllMocks());

// Exercise the actual first route handler (RBAC), without invoking controllers or Firestore.
async function authorize(method: string, path: string, role: 'admin' | 'member') {
  const lookup = vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({ role } as never);
  const layer = router.stack.find((entry: any) => entry.route?.path === path && entry.route.methods[method]);
  expect(layer).toBeDefined();
  const next = vi.fn();
  await layer!.route!.stack[0].handle(
    { user: { id: 'user-a' }, params: { ministryId: 'min-a' } } as unknown as Request,
    {} as Response,
    next as NextFunction,
  );
  expect(lookup).toHaveBeenCalledWith('min-a', 'user-a');
  return next;
}

describe('P1 actual schedule route permission guards', () => {
  it.each([['post', '/'], ['put', '/:scheduleId'], ['delete', '/:scheduleId']])('denies member %s %s', async (method, path) => {
    const next = await authorize(method, path, 'member');
    expect(next).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ statusCode: 403 }));
  });
  it.each([['post', '/'], ['put', '/:scheduleId'], ['delete', '/:scheduleId']])('allows admin %s %s', async (method, path) => {
    const next = await authorize(method, path, 'admin');
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
  it.each(['/', '/:scheduleId'])('allows member reading %s', async path => {
    const next = await authorize('get', path, 'member');
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { bootstrapAuth } from './auth-bootstrap';

describe('bootstrapAuth', () => {
  it('does not make authenticated requests without a token', async () => {
    const getMe = vi.fn();
    const getMyGroups = vi.fn();

    await expect(bootstrapAuth(null, { getMe, getMyGroups })).resolves.toEqual({
      user: null,
      groups: [],
      tokenValid: false,
    });
    expect(getMe).not.toHaveBeenCalled();
    expect(getMyGroups).not.toHaveBeenCalled();
  });

  it('loads ministries only after the token was validated', async () => {
    const order: string[] = [];
    const getMe = vi.fn(async () => {
      order.push('user');
      return { id: 'user-1', email: 'user@example.test', name: 'User' };
    });
    const getMyGroups = vi.fn(async () => {
      order.push('groups');
      return [];
    });

    const result = await bootstrapAuth('valid-token', { getMe, getMyGroups });

    expect(result.tokenValid).toBe(true);
    expect(order).toEqual(['user', 'groups']);
  });

  it('does not load ministries when token validation fails', async () => {
    const getMe = vi.fn().mockRejectedValue(new Error('invalid token'));
    const getMyGroups = vi.fn();

    const result = await bootstrapAuth('expired-token', { getMe, getMyGroups });

    expect(result.tokenValid).toBe(false);
    expect(getMyGroups).not.toHaveBeenCalled();
  });
});

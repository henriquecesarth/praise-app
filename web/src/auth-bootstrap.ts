import type { Group } from './types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthBootstrapResult {
  user: AuthenticatedUser | null;
  groups: Group[];
  tokenValid: boolean;
}

interface AuthBootstrapClient {
  getMe: () => Promise<AuthenticatedUser>;
  getMyGroups: () => Promise<Group[]>;
}

export async function bootstrapAuth(
  token: string | null,
  client: AuthBootstrapClient,
): Promise<AuthBootstrapResult> {
  if (!token?.trim()) {
    return { user: null, groups: [], tokenValid: false };
  }

  try {
    const user = await client.getMe();
    const groups = await client.getMyGroups();
    return { user, groups, tokenValid: true };
  } catch {
    return { user: null, groups: [], tokenValid: false };
  }
}

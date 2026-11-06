import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthModal } from './AuthModal';
import { LoginPage } from './LoginPage';
import { api } from '../api';

vi.mock('../api', () => ({
  api: {
    login: vi.fn(),
    signUp: vi.fn(),
  },
}));

const setDeploymentEnvironment = (environment: string) => {
  Object.defineProperty(globalThis, '__LOUVAIO_VERCEL_ENV__', {
    configurable: true,
    value: environment,
  });
};

describe('signup availability by deployment environment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDeploymentEnvironment('preview');
  });

  it('hides signup on the LoginPage in Preview and still permits login', async () => {
    const user = userEvent.setup();
    vi.mocked(api.login).mockResolvedValue({ user: { id: 'user-1', email: 'person@example.test', name: 'Person' }, token: 'token' });
    render(<LoginPage onLoginSuccess={vi.fn()} />);

    expect(screen.queryByRole('tab', { name: /criar conta/i })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/e-mail/i), 'person@example.test');
    await user.type(screen.getByLabelText('Senha'), 'password');
    await user.click(screen.getByRole('button', { name: /entrar no louvaio/i }));

    expect(api.login).toHaveBeenCalledWith('person@example.test', 'password');
    expect(api.signUp).not.toHaveBeenCalled();
  });

  it('hides signup on AuthModal in Preview', () => {
    render(<AuthModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar Conta' })).not.toBeInTheDocument();
  });

  it('keeps signup available in production in both login UIs', () => {
    setDeploymentEnvironment('production');
    const { rerender } = render(<LoginPage onLoginSuccess={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /criar conta/i })).toBeInTheDocument();

    rerender(<AuthModal isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Criar Conta' })).toBeInTheDocument();
  });
});

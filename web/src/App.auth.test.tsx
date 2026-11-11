import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const { auth } = vi.hoisted(() => ({ auth: { getMe: vi.fn(), getMyGroups: vi.fn() } }));
vi.mock('./api', () => ({ api: auth }));
vi.mock('./components/VocalExercisePlayer', () => ({ VocalExercisePlayer: () => <div>Authenticated vocal player</div> }));
vi.mock('./components/LoginPage', () => ({
  LoginPage: ({ onLoginSuccess }: { onLoginSuccess: (user: { id: string; email: string; name: string }) => void }) => (
    <button onClick={() => onLoginSuccess({ id: 'user-1', email: 'user@example.test', name: 'Pessoa' })}>Test login</button>
  ),
}));

function AuthTestApp() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate('/')}>Open home</button><button onClick={() => navigate('/exercicios-vocais')}>Open exercises</button><App /></>;
}

function renderVocalRoute() {
  return render(<MemoryRouter initialEntries={['/exercicios-vocais']}><AuthTestApp /></MemoryRouter>);
}

describe('vocal route authentication', () => {
  beforeEach(() => {
    localStorage.clear();
    auth.getMe.mockReset();
    auth.getMyGroups.mockReset().mockResolvedValue([]);
  });

  it('requires a validated session on direct access and keeps the player available after login', async () => {
    auth.getMe.mockRejectedValueOnce(new Error('session missing'));
    renderVocalRoute();
    expect(await screen.findByRole('button', { name: 'Test login' })).toBeInTheDocument();
    expect(screen.queryByText('Authenticated vocal player')).not.toBeInTheDocument();

    auth.getMe.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.test', name: 'Pessoa' });
    fireEvent.click(screen.getByRole('button', { name: 'Test login' }));
    expect(await screen.findByText('Authenticated vocal player')).toBeInTheDocument();
    const validatedSessionChecks = auth.getMe.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Open home' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open exercises' }));
    expect(await screen.findByText('Authenticated vocal player')).toBeInTheDocument();
    expect(auth.getMe).toHaveBeenCalledTimes(validatedSessionChecks);
  });

  it('fails closed for an invalid session and logout returns to login', async () => {
    localStorage.setItem('praise_auth_token', 'expired-session');
    auth.getMe.mockRejectedValueOnce(new Error('expired'));
    renderVocalRoute();
    expect(await screen.findByRole('button', { name: 'Test login' })).toBeInTheDocument();
    expect(localStorage.getItem('praise_auth_token')).toBeNull();

    auth.getMe.mockResolvedValueOnce({ id: 'user-1', email: 'user@example.test', name: 'Pessoa' });
    fireEvent.click(screen.getByRole('button', { name: 'Test login' }));
    expect(await screen.findByText('Authenticated vocal player')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open home' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sair da Conta' }));
    expect(await screen.findByRole('button', { name: 'Test login' })).toBeInTheDocument();
    expect(localStorage.getItem('praise_auth_token')).toBeNull();
  });
});

import React, { useState } from 'react';
import { LogIn, UserPlus, Mail, Lock, User, Eye, EyeOff, AlertCircle, Sparkles, Music, BookOpen, Layers } from 'lucide-react';
import { api } from '../api';

interface LoginPageProps {
  onLoginSuccess: (user: { id: string; email: string; name: string }) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        const res = await api.signUp(name, email, password);
        if (res.token) {
          localStorage.setItem('praise_auth_token', res.token);
        }
        onLoginSuccess(res.user);
      } else {
        const res = await api.login(email, password);
        if (res.token) {
          localStorage.setItem('praise_auth_token', res.token);
        }
        onLoginSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao realizar autenticação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      {/* Background Ambient Glows */}
      <div className="login-bg-glow-1" />
      <div className="login-bg-glow-2" />

      {/* Top Navbar */}
      <header className="login-header">
        <div className="login-brand">
          <div className="login-brand-icon">🎵</div>
          <span className="login-brand-title">Praise App</span>
        </div>
        <div className="login-header-badge">
          Plataforma de Louvor & Liturgias
        </div>
      </header>

      {/* Main Content Area */}
      <main className="login-main">
        <div className="login-grid">
          {/* Left Column: Hero & Value Proposition */}
          <div className="login-hero">
            <div className="login-tag">
              <Sparkles size={14} />
              Gestão inteligente para igrejas
            </div>

            <h1 className="login-title">
              Organize seu <br />
              <span className="login-title-highlight">Ministério de Louvor</span>
            </h1>

            <p className="login-desc">
              Tudo o que sua equipe precisa em um só lugar: repertórios completos, transposição de cifras em tempo real, agendamento de liturgias do domingo e acesso simplificado para os músicos via código de convite.
            </p>

            {/* Feature Cards Grid */}
            <div className="login-features-grid">
              <div className="login-feature-card">
                <div className="login-feature-icon" style={{ backgroundColor: 'rgba(134, 163, 143, 0.15)', color: 'var(--primary-light)' }}>
                  <Music size={18} />
                </div>
                <div className="login-feature-title">Repertórios & Pastas</div>
                <div className="login-feature-desc">Organize músicas por tom, BPM, artista e momentos do culto.</div>
              </div>

              <div className="login-feature-card">
                <div className="login-feature-icon" style={{ backgroundColor: 'rgba(6, 182, 212, 0.15)', color: 'var(--secondary-light)' }}>
                  <BookOpen size={18} />
                </div>
                <div className="login-feature-title">Ordens do Culto</div>
                <div className="login-feature-desc">Monte escalas e sequências da liturgia semanal.</div>
              </div>

              <div className="login-feature-card">
                <div className="login-feature-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--success-color)' }}>
                  <Layers size={18} />
                </div>
                <div className="login-feature-title">Cifras Inteligentes</div>
                <div className="login-feature-desc">Transposição automática de tons para toda a equipe.</div>
              </div>
            </div>
          </div>

          {/* Right Column: Glassmorphic Auth Box */}
          <div className="login-card-container">
            <div className="login-card">
              {/* Card Title */}
              <div className="login-card-title">
                {mode === 'login' ? 'Acesse sua conta' : 'Criar nova conta'}
              </div>
              <div className="login-card-subtitle">
                {mode === 'login'
                  ? 'Digite suas credenciais para entrar no painel'
                  : 'Cadastre-se como líder para gerenciar seu ministério'}
              </div>

              {/* Mode Toggle */}
              <div className="login-tabs">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className={`login-tab-btn ${mode === 'login' ? 'active' : ''}`}
                >
                  <LogIn size={16} />
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                  className={`login-tab-btn ${mode === 'signup' ? 'active' : ''}`}
                >
                  <UserPlus size={16} />
                  Criar Conta
                </button>
              </div>

              {error && (
                <div className="login-error-box animate-shake">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {/* Auth Form */}
              <form onSubmit={handleSubmit} className="login-form">
                {mode === 'signup' && (
                  <div className="form-group">
                    <label>Seu Nome ou Nome do Ministério</label>
                    <div className="login-input-wrapper">
                      <User size={16} className="login-input-icon" />
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Pr. Gabriel Santos"
                        className="login-input"
                        required
                      />
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Endereço de E-mail</label>
                  <div className="login-input-wrapper">
                    <Mail size={16} className="login-input-icon" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="lider@igreja.com"
                      className="login-input"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Senha</label>
                  <div className="login-input-wrapper">
                    <Lock size={16} className="login-input-icon" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="login-input"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="login-input-toggle"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="login-submit-btn"
                >
                  {loading ? (
                    <span>Autenticando...</span>
                  ) : mode === 'login' ? (
                    <>
                      <LogIn size={16} />
                      <span>Entrar no Praise App</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={16} />
                      <span>Cadastrar Meu Ministério</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="login-footer">
        &copy; {new Date().getFullYear()} Praise App. Gestão de Ministérios de Louvor.
      </footer>
    </div>
  );
};

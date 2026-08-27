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
    <div className="login-page-container" style={{ paddingTop: 'max(16px, var(--safe-area-top))', paddingBottom: 'max(24px, var(--safe-area-bottom))' }}>
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
                <div className="login-feature-icon" style={{ backgroundColor: 'rgba(134, 163, 143, 0.15)', color: 'var(--primary-light)', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Music size={20} />
                </div>
                <div className="login-feature-title">Repertórios & Pastas</div>
                <div className="login-feature-desc">Organize músicas por tom, BPM, artista e momentos do culto.</div>
              </div>

              <div className="login-feature-card">
                <div className="login-feature-icon" style={{ backgroundColor: 'rgba(6, 182, 212, 0.15)', color: 'var(--secondary-light)', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <BookOpen size={20} />
                </div>
                <div className="login-feature-title">Ordens do Culto</div>
                <div className="login-feature-desc">Monte escalas e sequências da liturgia semanal.</div>
              </div>

              <div className="login-feature-card">
                <div className="login-feature-icon" style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--success-color)', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Layers size={20} />
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

              {/* Mode Toggle com Touch Targets de 44px */}
              <div className="login-tabs" role="tablist" aria-label="Modo de autenticação" style={{ display: 'flex', gap: '6px', background: 'var(--surface-variant)', padding: '4px', borderRadius: '12px', minHeight: '44px' }}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'login'}
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className={`login-tab-btn ${mode === 'login' ? 'active' : ''}`}
                  style={{ flex: 1, minHeight: '44px', padding: '10px 16px', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
                >
                  <LogIn size={18} />
                  <span>Entrar</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'signup'}
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                  className={`login-tab-btn ${mode === 'signup' ? 'active' : ''}`}
                  style={{ flex: 1, minHeight: '44px', padding: '10px 16px', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}
                >
                  <UserPlus size={18} />
                  <span>Criar Conta</span>
                </button>
              </div>

              {error && (
                <div className="login-error-box animate-shake" style={{ minHeight: '44px', display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', borderRadius: '10px' }}>
                  <AlertCircle size={20} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: '0.88rem' }}>{error}</span>
                </div>
              )}

              {/* Auth Form com Touch Targets de 44px */}
              <form onSubmit={handleSubmit} className="login-form">
                {mode === 'signup' && (
                  <div className="form-group">
                    <label htmlFor="signup-name" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Seu Nome ou Nome do Ministério</label>
                    <div className="login-input-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <User size={18} className="login-input-icon" style={{ position: 'absolute', left: '14px', color: 'var(--text-tertiary)' }} />
                      <input
                        id="signup-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ex: Pr. Gabriel Santos"
                        className="login-input"
                        style={{ width: '100%', minHeight: '44px', paddingLeft: '44px', paddingRight: '14px', fontSize: '0.95rem', borderRadius: '10px' }}
                        required
                      />
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="login-email" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Endereço de E-mail</label>
                  <div className="login-input-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Mail size={18} className="login-input-icon" style={{ position: 'absolute', left: '14px', color: 'var(--text-tertiary)' }} />
                    <input
                      id="login-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="lider@igreja.com"
                      className="login-input"
                      style={{ width: '100%', minHeight: '44px', paddingLeft: '44px', paddingRight: '14px', fontSize: '0.95rem', borderRadius: '10px' }}
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="login-password" style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Senha</label>
                  <div className="login-input-wrapper" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <Lock size={18} className="login-input-icon" style={{ position: 'absolute', left: '14px', color: 'var(--text-tertiary)' }} />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="login-input"
                      style={{ width: '100%', minHeight: '44px', paddingLeft: '44px', paddingRight: '48px', fontSize: '0.95rem', borderRadius: '10px' }}
                      required
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                      onClick={() => setShowPassword(!showPassword)}
                      className="login-input-toggle"
                      style={{ position: 'absolute', right: '2px', width: '44px', height: '44px', minWidth: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="login-submit-btn"
                  style={{ width: '100%', minHeight: '44px', padding: '12px 24px', fontSize: '0.95rem', fontWeight: 700, borderRadius: '10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer', marginTop: '8px' }}
                >
                  {loading ? (
                    <span>Autenticando...</span>
                  ) : mode === 'login' ? (
                    <>
                      <LogIn size={18} />
                      <span>Entrar no Praise App</span>
                    </>
                  ) : (
                    <>
                      <UserPlus size={18} />
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


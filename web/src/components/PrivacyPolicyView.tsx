import React from 'react';
import { ArrowLeft, Shield, Lock, Trash2, Mail, ExternalLink, Server, CheckCircle2 } from 'lucide-react';
import { louvaioTheme } from '../theme/louvaioTheme';
import { COMPLIANCE_CONFIG } from '../config/compliance.config';

interface PrivacyPolicyViewProps {
  onNavigateHome?: () => void;
  onNavigateDeletion?: () => void;
}

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({
  onNavigateHome,
  onNavigateDeletion,
}) => {
  const supportEmail = COMPLIANCE_CONFIG.publicSupportEmail;
  const privacyEmail = COMPLIANCE_CONFIG.privacyContactEmail;
  const controllerName = COMPLIANCE_CONFIG.controllerDisplayName;

  const handleBack = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else {
      window.location.assign('/');
    }
  };

  const handleGoToDeletion = () => {
    if (onNavigateDeletion) {
      onNavigateDeletion();
    } else {
      window.location.assign('/exclusao-conta');
    }
  };

  return (
    <div
      className="privacy-page-container min-h-screen text-[var(--text-primary)]"
      style={{
        backgroundColor: 'var(--bg-color)',
        paddingTop: 'max(20px, var(--safe-area-top))',
        paddingBottom: 'max(32px, var(--safe-area-bottom))',
      }}
    >
      {/* Top Navbar */}
      <header
        className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between border-b border-[var(--border-color)]"
        style={{ minHeight: '64px' }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="action-icon-btn flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            style={{ width: '44px', height: '44px' }}
            aria-label="Voltar para a página inicial"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2 cursor-pointer" onClick={handleBack}>
            <img
              src={louvaioTheme.assets.logoPrimary}
              alt="LouvAIO"
              className="light-only h-8 w-auto object-contain"
            />
            <img
              src={louvaioTheme.assets.logoInverse}
              alt="LouvAIO"
              className="dark-only h-8 w-auto object-contain"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleGoToDeletion}
          className="btn btn-secondary min-h-[44px] px-4 py-2 text-sm font-semibold rounded-lg inline-flex items-center gap-2"
        >
          <Trash2 size={16} />
          <span>Exclusão de Conta</span>
        </button>
      </header>

      {/* Main Content Area */}
      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <article className="space-y-8">
          {/* Header Title */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-[rgba(15,42,31,0.12)] text-[var(--louvaio-green)] dark:bg-[rgba(30,126,85,0.2)] dark:text-emerald-400">
              <Shield size={14} />
              <span>Transparência e Privacidade</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-[var(--text-primary)]">
              Política de Privacidade
            </h1>
            <p className="text-sm sm:text-base text-[var(--text-secondary)] leading-relaxed">
              Esta política descreve como o <strong className="text-[var(--text-primary)]">{controllerName}</strong>{' '}
              trata e protege as informações de usuários, integrantes e líderes no aplicativo e plataforma web LouvAIO.
            </p>
          </div>

          {/* Section 1: Dados Pessoais Coletados */}
          <section className="p-6 rounded-2xl bg-[var(--surface-color)] border border-[var(--border-color)] shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <CheckCircle2 size={20} className="text-[var(--louvaio-terracotta)]" />
              1. Informações Coletadas e Processadas
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              O LouvAIO processa exclusivamente as informações necessárias para viabilizar a organização de equipes musicais, cultos e liturgias:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)]">
              <li>
                <strong className="text-[var(--text-primary)]">Dados de cadastro e identificação:</strong> Nome de exibição, endereço de e-mail e identificador de usuário exclusivo (Firebase UID).
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Associações e vínculos:</strong> Papel de atuação no ministério (administrador ou integrante), funções ministeriais e musicais atribuídas (ex.: vocal, instrumentos), e vinculação a organizações.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Escalas e confirmações:</strong> Histórico de participação em eventos, confirmações e recusas de presença em escalas de louvor.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Comentários de escalas:</strong> Mensagens e observações operacionais registradas entre os integrantes em escalas específicas.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Indisponibilidade autodeclarada:</strong> Períodos informados em que o integrante não pode ser escalado (data/hora de início e término, indicação de dia inteiro e justificativa informada pelo usuário).
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Repertório e conteúdo do ministério:</strong> Músicas cadastradas, versões, tonalidades, andamento (BPM), durações, letras, links de referência externa (como YouTube e plataformas de áudio/partituras), pastas temáticas, artistas, ordens de culto (liturgias) e cifras inteligentes criadas ou editadas.
              </li>
            </ul>
          </section>

          {/* Section 2: Infraestrutura e Serviços de Terceiros */}
          <section className="p-6 rounded-2xl bg-[var(--surface-color)] border border-[var(--border-color)] shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Server size={20} className="text-[var(--louvaio-terracotta)]" />
              2. Infraestrutura e Compartilhamento Operacional
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              O LouvAIO não comercializa nem vende dados pessoais. Para operar com confiabilidade, a plataforma utiliza serviços de tecnologia consolidados:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-xl bg-[var(--surface-variant,#1e293b)]/40 border border-[var(--border-color)]">
                <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Firebase & Google Cloud</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Autenticação criptográfica de usuários (Firebase Authentication) e armazenamento persistente dos dados da plataforma (Cloud Firestore).
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[var(--surface-variant,#1e293b)]/40 border border-[var(--border-color)]">
                <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Hospedagem & Execução Web</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Infraestrutura de nuvem segura (Vercel) para entrega da aplicação web, Progressive Web App (PWA) e rotas da API REST.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[var(--surface-variant,#1e293b)]/40 border border-[var(--border-color)]">
                <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Processamento de Faturamento (Asaas)</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Para ministérios assinantes de planos pagos, transações, cobranças e notas são processadas pelo gateway financeiro Asaas sob padrões bancários seguros.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[var(--surface-variant,#1e293b)]/40 border border-[var(--border-color)]">
                <h3 className="font-semibold text-sm text-[var(--text-primary)] mb-1">Mensageria WhatsApp (Meta / Zernio)</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Quando configurado pela organização, o envio de avisos e escalas via WhatsApp utiliza a API oficial Cloud da Meta Platforms / Zernio.
                </p>
              </div>
            </div>
          </section>

          {/* Section 3: Segurança */}
          <section className="p-6 rounded-2xl bg-[var(--surface-color)] border border-[var(--border-color)] shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Lock size={20} className="text-[var(--louvaio-terracotta)]" />
              3. Práticas de Segurança e Proteção
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Adotamos medidas rigorosas para manter suas informações protegidas:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)]">
              <li>Tráfego de rede 100% criptografado através de conexões HTTPS / TLS.</li>
              <li>Isolamento estrito entre ministérios (multi-tenant boundary), impedindo que dados de uma igreja sejam acessados por outra.</li>
              <li>Controle de acesso por permissões (administradores e integrantes) e validação server-side com bloqueio preventivo a requisições indevidas.</li>
              <li>Criptografia de ponta (AES-256-GCM) para segredos de conexão de mensageria externa.</li>
            </ul>
          </section>

          {/* Section 4: Exclusão de Conta */}
          <section className="p-6 rounded-2xl bg-[var(--surface-color)] border border-[var(--border-color)] shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Trash2 size={20} className="text-[var(--louvaio-terracotta)]" />
              4. Exclusão de Conta e Direitos do Titular
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Você tem total autonomia para encerrar seu vínculo e solicitar a exclusão definitiva da sua conta LouvAIO a qualquer momento.
            </p>
            <div className="p-4 rounded-xl bg-[rgba(184,90,60,0.08)] border border-[rgba(184,90,60,0.25)] space-y-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Como solicitar a exclusão:
              </p>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Acesse nossa página dedicada de exclusão em{' '}
                <a
                  href="/exclusao-conta"
                  onClick={(e) => {
                    e.preventDefault();
                    handleGoToDeletion();
                  }}
                  className="font-semibold text-[var(--louvaio-terracotta)] underline inline-flex items-center gap-1"
                >
                  louvaio.com/exclusao-conta
                  <ExternalLink size={14} />
                </a>
                . Após a autenticação segura e resolução de eventuais pendências de liderança ou faturamento, a exclusão da sua conta e dos seus dados pessoais é executada de forma definitiva.
              </p>
            </div>
          </section>

          {/* Section 5: Retenção e Anonimização */}
          <section className="p-6 rounded-2xl bg-[var(--surface-color)] border border-[var(--border-color)] shadow-sm space-y-4">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Shield size={20} className="text-[var(--louvaio-terracotta)]" />
              5. Ressalvas de Retenção e Anonimização
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Ao concluir a exclusão de uma conta:
            </p>
            <ul className="list-disc pl-5 space-y-2 text-sm text-[var(--text-secondary)]">
              <li>
                <strong className="text-[var(--text-primary)]">Dados pessoais:</strong> Seu perfil, credenciais de acesso, dados de contato e preferências são permanentemente eliminados.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Conteúdo compartilhado da igreja:</strong> Músicas, cifras, liturgias e escalas cadastradas em benefício do ministério permanecem na comunidade para não prejudicar o culto, mas sua autoria é totalmente anonimizada.
              </li>
              <li>
                <strong className="text-[var(--text-primary)]">Registros financeiros e operacionais:</strong> Transações fiscais, faturas e registros contábeis no provedor de pagamento (Asaas) podem ser retidos nos termos e prazos estritamente exigidos pela legislação contábil e fiscal aplicável.
              </li>
            </ul>
          </section>

          {/* Section 6: Contato */}
          <section className="p-6 rounded-2xl bg-[var(--surface-color)] border border-[var(--border-color)] shadow-sm space-y-3">
            <h2 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
              <Mail size={20} className="text-[var(--louvaio-terracotta)]" />
              6. Canal de Atendimento e Privacidade
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
              Dúvidas sobre o tratamento dos seus dados ou sobre esta política podem ser enviadas diretamente para a equipe LouvAIO:
            </p>
            <div className="pt-2 flex flex-wrap gap-3">
              <a
                href={`mailto:${privacyEmail}`}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--surface-variant,#1e293b)] border border-[var(--border-color)] text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition-colors min-h-[44px]"
              >
                <Mail size={16} className="text-[var(--louvaio-terracotta)]" />
                <span>Privacidade: {privacyEmail}</span>
              </a>
              {supportEmail !== privacyEmail && (
                <a
                  href={`mailto:${supportEmail}`}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--surface-variant,#1e293b)] border border-[var(--border-color)] text-sm font-semibold text-[var(--text-primary)] hover:border-[var(--primary-color)] transition-colors min-h-[44px]"
                >
                  <Mail size={16} className="text-[var(--louvaio-terracotta)]" />
                  <span>Suporte: {supportEmail}</span>
                </a>
              )}
            </div>
          </section>
        </article>
      </main>

      {/* Footer */}
      <footer className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-8 border-t border-[var(--border-color)] text-center text-xs text-[var(--text-tertiary,#64748b)]">
        &copy; {new Date().getFullYear()} {controllerName}. Todos os direitos reservados.
      </footer>
    </div>
  );
};

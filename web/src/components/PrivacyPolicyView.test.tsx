import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PrivacyPolicyView } from './PrivacyPolicyView';
import { COMPLIANCE_CONFIG } from '../config/compliance.config';

describe('PrivacyPolicyView', () => {
  it('renders publicly without authentication and displays core privacy sections', () => {
    render(<PrivacyPolicyView />);

    expect(screen.getByText('Política de Privacidade')).toBeInTheDocument();
    expect(screen.getByText(/1\. Informações Coletadas e Processadas/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Infraestrutura e Compartilhamento Operacional/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Práticas de Segurança e Proteção/i)).toBeInTheDocument();
    expect(screen.getByText(/4\. Exclusão de Conta e Direitos do Titular/i)).toBeInTheDocument();
    expect(screen.getByText(/5\. Ressalvas de Retenção e Anonimização/i)).toBeInTheDocument();
    expect(screen.getByText(/6\. Canal de Atendimento e Privacidade/i)).toBeInTheDocument();
  });

  it('displays factual providers and conditional architecture components', () => {
    render(<PrivacyPolicyView />);

    expect(screen.getByText(/Firebase & Google Cloud/i)).toBeInTheDocument();
    expect(screen.getByText(/Processamento de Faturamento \(Asaas\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Mensageria WhatsApp \(Integração Condicional: Meta \/ Zernio\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Hospedagem & Execução Web/i)).toBeInTheDocument();
    expect(
      screen.getByText(/O envio de notificações operacionais via WhatsApp é um recurso estritamente condicional/i)
    ).toBeInTheDocument();
  });

  it('describes comments as deleted and shared resources as anonymized', () => {
    render(<PrivacyPolicyView />);

    // Comments must be described as permanently deleted
    expect(
      screen.getByText(/todos os comentários de escalas de louvor de sua autoria são permanentemente excluídos/i)
    ).toBeInTheDocument();

    // Shared resources are anonymized
    expect(
      screen.getByText(/tendo a autoria pessoal desassociada do seu nome e anonimizada/i)
    ).toBeInTheDocument();
  });

  it('contains no unsupported audit-log claims', () => {
    const { container } = render(<PrivacyPolicyView />);
    const text = container.textContent || '';

    expect(text).not.toMatch(/audit log/i);
    expect(text).not.toMatch(/logs? de auditoria/i);
  });

  it('describes security practices factually without absolute cleartext token claims', () => {
    const { container } = render(<PrivacyPolicyView />);
    const text = container.textContent || '';

    // Factual security measures
    expect(screen.getByText(/Tráfego de rede com o backend em produção protegido por conexões criptografadas HTTPS \/ TLS/i)).toBeInTheDocument();
    expect(screen.getByText(/Firebase Authentication com verificação criptográfica de identidade/i)).toBeInTheDocument();
    expect(screen.getByText(/No aplicativo móvel, tokens de acesso não são persistidos intencionalmente no armazenamento de preferências/i)).toBeInTheDocument();

    // Must NOT make universal "zero cleartext token persistence" claim
    expect(text).not.toMatch(/zero cleartext token persistence/i);
    expect(text).not.toMatch(/persistência zero de tokens em texto claro/i);
  });

  it('does not expose fake legal entity, fabricated defaults, or placeholder values', () => {
    const { container } = render(<PrivacyPolicyView />);
    const html = container.innerHTML;

    expect(html).not.toContain('00.000.000/0001');
    expect(html).not.toContain('CNPJ:');
    expect(html).not.toContain('DPO: Fulano');
    expect(html).not.toContain('placeholder');
    expect(html).not.toContain('suporte@louvaio.com.br');
    expect(html).not.toContain('privacidade@louvaio.com.br');
    expect(html).not.toContain('LouvAIO Tecnologia');
  });

  it('displays configured support and privacy contact information', () => {
    render(<PrivacyPolicyView />);

    expect(screen.getByText(new RegExp(COMPLIANCE_CONFIG.privacyContactEmail, 'i'))).toBeInTheDocument();
    expect(
      screen.getAllByText(new RegExp(COMPLIANCE_CONFIG.controllerDisplayName, 'i')).length
    ).toBeGreaterThan(0);
  });

  it('navigates home and to deletion route via callbacks', async () => {
    const onNavigateHome = vi.fn();
    const onNavigateDeletion = vi.fn();
    const user = userEvent.setup();

    render(
      <PrivacyPolicyView
        onNavigateHome={onNavigateHome}
        onNavigateDeletion={onNavigateDeletion}
      />
    );

    const backBtn = screen.getByRole('button', { name: /Voltar para a página inicial/i });
    await user.click(backBtn);
    expect(onNavigateHome).toHaveBeenCalledTimes(1);

    const deletionBtn = screen.getByRole('button', { name: /Exclusão de Conta/i });
    await user.click(deletionBtn);
    expect(onNavigateDeletion).toHaveBeenCalledTimes(1);

    const deletionLink = screen.getByText(/louvaio\.com\/exclusao-conta/i);
    await user.click(deletionLink);
    expect(onNavigateDeletion).toHaveBeenCalledTimes(2);
  });
});

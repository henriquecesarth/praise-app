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

  it('displays factual providers and architecture components', () => {
    render(<PrivacyPolicyView />);

    expect(screen.getByText(/Firebase & Google Cloud/i)).toBeInTheDocument();
    expect(screen.getByText(/Processamento de Faturamento \(Asaas\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Mensageria WhatsApp \(Meta \/ Zernio\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Hospedagem & Execução Web/i)).toBeInTheDocument();
  });

  it('does not expose fake legal entity or placeholder values', () => {
    const { container } = render(<PrivacyPolicyView />);
    const html = container.innerHTML;

    expect(html).not.toContain('00.000.000/0001');
    expect(html).not.toContain('CNPJ:');
    expect(html).not.toContain('DPO: Fulano');
    expect(html).not.toContain('placeholder');
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

# ExecPlan: LouvAIO — Billing Asaas: Hardening, Complimentary Plans & Sandbox Homologation Gate

- **Status**: `IMPLEMENTATION READY (SANDBOX HOMOLOGATION BLOCKED BY CREDENTIALS)`
- **Production Ready**: `NO`
- **Data de Atualização**: 2026-08-29
- **Fase**: `Billing Asaas: Hardening & Sandbox Homologation Gate`
- **Escopo**: Implementação completa e endurecida do SaaS Billing com Asaas (idempotência atômica, double checkout guard, 1 assinatura ativa, complimentary plans isolados do gateway, amount validation rigorosa, out-of-order guards e CLI seguro). A homologação física ponta a ponta contra a API real do Asaas Sandbox aguarda a injeção das credenciais `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` de Sandbox.

---

## 1. Princípios e Regras Fundamentais

1. **Separação Estrita de Autoridade**:
   - Asaas é autoridade sobre estado financeiro (`payment state`).
   - LouvAIO é autoridade sobre direito de uso e quotas (`product entitlement`).
   - O frontend nunca define preço, moeda, status, quotas ou planos de cortesia.
2. **Idempotência Atômica de Webhooks (P0)**:
   - Registro transacional com lock de documento e verificação de concorrência (`processing_status`). 10 webhooks simultâneos resultam em exatamente 1 execução de negócio e 9 respostas idempotentes sem duplicação de transação ou plano.
3. **Proteção contra Double Checkout (P0)**:
   - Reutilização de checkout pendente existente para a mesma intenção de compra recente (< 15 min), impedindo criação acidental de múltiplas assinaturas/customers no gateway.
4. **Invariante de 1 Assinatura Financeira Ativa**:
   - `ministry + provider = no máximo 1 assinatura financeira ativa/principal`.
5. **Concessões Gratuitas de Plano (`Complimentary`)**:
   - `subscription_mode: 'free' | 'paid' | 'complimentary'`.
   - Concedidas exclusivamente por autoridade da plataforma (administrador LouvAIO via endpoint seguro/script administrativo).
   - Não criam dados no Asaas (zero faturas, zero cobranças, sem inadimplência).
   - Preservam dados na revogação (aplicam carência/restrição caso o uso exceda a capacidade do plano de fallback).
   - Suporte a expiração com prazo (`expires_at`) ou sem prazo (`expires_at = null`).
6. **Validação de Valor e Moeda (Amount Validation)**:
   - Pagamento de R$ 14,90 não pode ativar plano Premium de R$ 214,90. Rejeição de mutação e log de anomalia se houver divergência.
7. **Proteção contra Eventos Fora de Ordem**:
   - Eventos antigos de atraso (`PAYMENT_OVERDUE`) não sobrescrevem faturamentos confirmados mais recentes.

---

## 2. Fases de Execução

### Fase 1: Hardening de Idempotência Atômica e Concorrência de Webhooks
- [x] Corrigir `BillingService.handleWebhook` para verificar se `isDuplicate === true` independente do status (`processing` ou `processed`), impedindo que execuções concorrentes atravessem o lock.
- [x] Adicionar comparação segura em tempo constante (`crypto.timingSafeEqual`) para o token de webhook.
- [x] Testar concorrência de 10 webhooks simultâneos no mesmo evento (`billing.concurrency.test.ts`).

### Fase 2: Proteção contra Double Checkout e Invariante de Assinatura Única
- [x] Implementar deduplicação em `BillingService.createCheckout` para intenções idênticas recentes (< 15 min).
- [x] Garantir substituição/cancelamento limpo de assinaturas financeiras anteriores em caso de upgrade/downgrade.
- [x] Testar submissões duplicadas e concorrência no checkout.

### Fase 3: Validação de Valor (Amount & Currency) e Resolução Segura de Tenant
- [x] Validar `amount_cents` recebido contra o valor esperado pelo plano + ciclo + add-ons no webhook.
- [x] Rejeitar mutações anômalas com log de segurança.
- [x] Resolver tenant exclusivamente através dos IDs vinculados no banco de dados.

### Fase 4: Proteção contra Eventos Fora de Ordem
- [x] Implementar guarda de timestamps/status para ignorar `PAYMENT_OVERDUE` se o ciclo atual já estiver pago/ativo com data posterior.

### Fase 5: Concessões Manuais de Plano (`Complimentary Plans`)
- [x] Atualizar tipos e schemas: adicionar `subscription_mode`, `granted_by`, `granted_at`, `grant_reason`, `expires_at` em `MinistrySubscriptionRecord` e summaries.
- [x] Atualizar `SubscriptionService` para avaliar `subscription_mode === 'complimentary'`, respeitando `expires_at` com transição segura para carência se expirado.
- [x] Criar endpoint/serviço administrativo restrito (`/api/v1/admin/ministries/:ministryId/complimentary/grant` e `/complimentary-revoke`) com autenticação por chave de plataforma `PLATFORM_ADMIN_SECRET`.
- [x] Garantir que `Complimentary` não faça chamadas ao Asaas nem crie transações fake.
- [x] Implementar transições seguras `complimentary -> paid` e `paid -> complimentary`.

### Fase 6: Reconciliação com Asaas
- [x] Implementar `reconcileBillingSubscription(ministryId)` no `BillingService`.
- [x] Testar divergências de estado entre Firestore e Asaas.

### Fase 7: Ajustes no Frontend Web
- [x] Atualizar `SubscriptionPlanView.tsx` para apresentar adequadamente assinaturas `complimentary` ("Cortesia da Plataforma", sem valor a pagar, sem CTA de faturas/regularização).
- [x] Atualizar `SubscriptionPlanView.test.tsx` com teste de cortesia.

### Fase 8: Homologação Asaas Sandbox e Documentação
- [x] Criar guia `docs/operations/asaas-sandbox-homologation.md`.
- [x] Criar script operacional CLI `backend/scripts/grant-complimentary.ts`.
- [x] Atualizar `docs/operations/billing-architecture.md`.

### Fase 9: Suíte de Testes Automatizados e Production Gate
- [x] Criar suíte completa de testes cobrindo concorrência, double checkout, complimentary, out-of-order, amount validation (`billing.concurrency.test.ts` e `complimentary.service.test.ts`).
- [x] Executar builds e testes completos (backend vitest: 103/103 passed; web vitest: 26/26 passed; web playwright: 61/61 passed; builds backend & web: 0 erros).
- [x] Preencher tabela do Production Gate no relatório final.

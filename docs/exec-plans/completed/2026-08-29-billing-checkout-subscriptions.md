# ExecPlan: LouvAIO — Billing, Checkout & Subscription Automation

- **Status**: `COMPLETED`
- **Data de Início**: 2026-08-29
- **Data de Conclusão**: 2026-08-29
- **Fase**: `Billing, Checkout & Subscription Automation (Asaas SaaS Integration)`
- **Escopo**: Transformação do sistema de planos do LouvAIO em um sistema real de assinatura SaaS integrado ao gateway Asaas, com abstração de provedores (`BillingProvider`), checkout hospedado, controle de ciclo mensal/anual com desconto de 10%, add-ons de integrantes, webhooks transacionais e idempotentes, histórico financeiro, cancelamento agendado (`cancel_at_period_end`), reativação, mitigação de IDOR e autoridade estrita do backend.

---

## 1. Princípios e Regras Fundamentais Atendidos

1. **Autoridade Dividida**:
   - O **Gateway (Asaas)** é a autoridade sobre o **estado financeiro** (`payment state`).
   - O **LouvAIO** é a autoridade sobre o **entitlement de produto** (`plan_id`, quotas, `accessMode`).
   - O frontend nunca define preço, status de assinatura ou quotas diretamente.
2. **Desacoplamento do Provedor**:
   - A camada de domínio e o `SubscriptionService` não conhecem eventos ou payloads específicos do Asaas.
   - Criada a interface `BillingProvider` implementada por `AsaasBillingProvider`.
3. **Idempotência Estrita (P0)**:
   - Todo webhook é registrado em `billing_webhook_events` com chave única `provider + provider_event_id` e verificação transacional antes do processamento.
4. **Não Destrutivo**:
   - Downgrades, cancelamentos e inadimplência nunca apagam dados de ministérios, músicas ou membros. Aplicam estritamente as regras de `AccessMode` (`normal`, `grace`, `restricted_over_limit`).
5. **Cálculo Determinístico de Preços**:
   - Fonte única da verdade em `plans.config.ts`.
   - Preços operam em centavos inteiros (`cents`).
   - Desconto anual exato de 10% para todos os planos pagos.

---

## 2. Matriz de Catálogo e Precificação Oficial

| Plano | Preço Mensal | Preço Anual (10% desc) | Membros Base | Músicas Base | Add-on Integrantes (+10 membros) | Teto de Add-on |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Free** | R$ 0,00 (0¢) | R$ 0,00 (0¢) | 10 | 50 | Não permitido | 0 blocos |
| **Lite** | R$ 14,90 (1490¢) | R$ 160,92 (16092¢) | 20 | 100 | Não permitido | 0 blocos |
| **Lite+** | R$ 24,90 (2490¢) | R$ 268,92 (26892¢) | 30 | 150 | Não permitido | 0 blocos |
| **Essential** | R$ 34,90 (3490¢) | R$ 376,92 (37692¢) | 40 | 200 | R$ 9,90/mês (990¢) \| R$ 106,92/ano (10692¢) | 4 blocos (80 membros máx) |
| **Pro** | R$ 89,90 (8990¢) | R$ 970,92 (97092¢) | 100 | 500 | R$ 6,90/mês (690¢) \| R$ 74,52/ano (7452¢) | 10 blocos (200 membros máx) |
| **Premium** | R$ 214,90 (21490¢) | R$ 2.320,92 (232092¢) | 300 | 1.500 | Não permitido | 0 blocos |

---

## 3. Estrutura de Coleções Firestore para Billing

- `ministry_subscriptions`: Entitlement de produto do LouvAIO (doc ID `${ministry_id}`).
- `billing_customers`: Associação `ministry_id <-> provider_customer_id` (doc ID `${ministry_id}_${provider}`).
- `billing_subscriptions`: Registro da assinatura no gateway (`provider_subscription_id`, `plan_id`, `interval`, `amount_cents`, `status`, `current_period_end`, `cancel_at_period_end`) (doc ID `${ministry_id}_${provider}`).
- `billing_transactions`: Histórico de faturas/cobranças (`provider_payment_id`, `amount_cents`, `status`, `paid_at`, `due_date`) sem dados sensíveis de cartão (doc ID `${provider}_${provider_payment_id}`).
- `billing_webhook_events`: Idempotência e auditoria de webhooks (`provider_event_id`, `event_type`, `processing_status`, `payload_hash`) (doc ID `${provider}_${provider_event_id}`).

---

## 4. Fases de Execução Concluídas

### Fase 1: Catálogo e Cálculo de Preços (`plans.config.ts`) `[COMPLETED]`
- [x] Adicionar precificação em centavos (mensal e anual) e regras de add-ons em `plans.config.ts`.
- [x] Adicionar funções utilitárias `calculatePlanPriceCents(planId, interval, addonBlocks)`.
- [x] Testar determinismo dos cálculos.

### Fase 2: Modelagem e Repositório de Billing `[COMPLETED]`
- [x] Criar `backend/src/features/billing/billing.types.ts`.
- [x] Criar `backend/src/repositories/BillingRepository.ts` com suporte transacional a customers, subscriptions, transactions e webhook events.

### Fase 3: Abstração de BillingProvider e Implementação Asaas `[COMPLETED]`
- [x] Criar `backend/src/features/billing/providers/billing-provider.interface.ts`.
- [x] Criar `backend/src/features/billing/providers/asaas/asaas.provider.ts` com suporte a Sandbox/Produção, links de pagamento/assinaturas e parsing de webhooks.
- [x] Atualizar `backend/src/config/unifiedConfig.ts` com variáveis de ambiente do Asaas (`ASAAS_API_URL`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_ENVIRONMENT`).

### Fase 4: Serviço, Controlador e Rotas de Billing `[COMPLETED]`
- [x] Criar `backend/src/features/billing/billing.service.ts`:
  - `getCheckoutPreview`
  - `createCheckout`
  - `handleWebhook` (idempotente com validação de assinatura)
  - `cancelSubscription` (`cancel_at_period_end`)
  - `reactivateSubscription`
  - `getBillingHistory`
- [x] Criar `backend/src/features/billing/billing.controller.ts` e `backend/src/features/billing/billing.routes.ts`.
- [x] Montar rotas em `backend/src/app.ts`.

### Fase 5: Integração e Interface no Frontend `[COMPLETED]`
- [x] Atualizar `web/src/api.ts` com chamadas de catálogo, preview, checkout, cancelamento, reativação e histórico.
- [x] Atualizar `web/src/components/SubscriptionPlanView.tsx` com toggle mensal/anual, seletor de add-ons, preview detalhado, botão de checkout e gerenciamento de cancelamento/reativação.
- [x] Atualizar `web/src/components/RestrictedBanner.tsx` e seus testes.

### Fase 6: Documentação de Operações `[COMPLETED]`
- [x] Criar `docs/operations/billing-architecture.md`.

### Fase 7: Suíte de Testes e Validação Completa `[COMPLETED]`
- [x] Criar testes unitários em `backend/src/features/billing/billing.service.test.ts` e `billing.controller.test.ts`.
- [x] Executar builds do backend e web (`npm run build` ambos com 0 erros).
- [x] Executar testes unitários do backend (94 testes passando em 11 arquivos) e web (25 testes passando em 11 arquivos).
- [x] Executar validação E2E com Playwright.

# ExecPlan: LouvAIO — Phase 3C.6 Early Activation End-to-End Sandbox Homologation

- **Status**: `COMPLETE & SANDBOX HOMOLOGATED`
- **Production Ready**: `SANDBOX VERIFIED (Production Configuration Pending)`
- **Data de Execução**: 2026-09-04
- **Canonical Checkpoint**: `9fcbfb5` (`feat(billing): harden early activation checkout lifecycle`)
- **Ambiente**: Asaas Sandbox API v3 (`https://api-sandbox.asaas.com/v3`)
- **Operação em Produção**: `NENHUMA (PRODUÇÃO PROIBIDA / ZERO OPERAÇÕES REAIS)`

---

## 1. Objetivo

Executar a homologação de ponta a ponta limpa e definitiva da **Phase 3C Early Activation** contra o ambiente oficial do **Asaas Sandbox**, cobrindo o fluxo feliz de antecipação com pagamento avulso (Scenario A2 Clean), a expiração natural com decurso de prazo de 10 minutos (Scenario B), a reconciliação assíncrona com dados reais do provedor, a retenção de invariantes contábeis e de quotas e o alinhamento da disciplina de higiene pós-teste sem deleção de dados.

---

## 2. Environment Proof & Safety Isolation (Redacted)

- **Gateway URL**: `https://api-sandbox.asaas.com/v3`
- **Environment**: `sandbox`
- **Webhook Channel**: Cloudflare Quick Tunnel efêmero apontando exclusivamente para o backend local LouvAIO em porta de desenvolvimento.
- **Production Safety**:
  - Chaves de produção: não utilizadas.
  - Banco de dados de produção: não utilizado.
  - Endpoints de produção: não utilizados.
  - Zero chamadas externas fora do domínio Sandbox oficial do Asaas.

---

## 3. Scenario A1 Contamination Disclosure & Slot Authority Audit

- **Incidente no Ciclo A1**:
  - No ciclo inicial (Scenario A1), a autoridade financeira, o pagamento hosted real, a liquidação contábil e a promoção de quotas foram validados com sucesso no Sandbox.
  - No entanto, antes da reconciliação ocorreu uma intervenção manual no Firestore para corrigir o slot ID: a fixture de teste havia gerado o slot com o separador simples `_` em vez do duplo `__`.
  - O Scenario A1 foi devidamente registrado como **fixture-contaminated** e não foi considerado a prova E2E definitiva.
- **Root Cause & Auditoria do Código de Produção**:
  - Auditoria profunda confirmou que o erro pertencia **exclusivamente ao scratch script de teste**.
  - O código de produção em `BillingRepository.ts` utiliza de forma 100% uniforme a autoridade canônica `buildActiveTransitionSlotId(ministryId, provider)` (`slot_${encodeURIComponent(ministryId)}__${provider}`).
  - Nenhum bug de contrato ou de implementação foi encontrado no código de produção.
- **Regra de Homologação**:
  - Qualquer fixture futura de teste deve obrigatoriamente chamar o helper oficial `buildActiveTransitionSlotId(ministryId, provider)`.

---

## 4. Scenario A2 Result (Clean Happy Path — Zero Manual Data Repair)

- **Fixture Isolada**: `PHASE_3C6_A2_CLEAN_*` (tenant, transição, customer, assinaturas, pagamentos e slot totalmente novos e desacoplados de testes anteriores).
- **Slot Precondition Proof**:
  - `canonicalSlotId = buildActiveTransitionSlotId(ministryId, 'asaas')` gerado e verificado como existente antes de qualquer operação.
  - Status inicial: `held`.
  - Provedor: `asaas`.
  - Transição associada: `tr_***`.
  - Zero slots secundários ou duplicados.
- **Real Clock & Proration Proof**:
  - Operação executada sob relógio real de sistema (sem datas manipuladas ou artificiais).
  - Cotação: `quot_***`.
  - Saldo proporcional exato: $\text{round-half-up}\left(\frac{(3490 - 1490) \times 19}{30}\right) = 1267\text{ centavos}$ (R$ 12,67).
  - Correspondência exata de centavos inteiros entre o cálculo teórico e a quote persistida.
- **Detached Hosted Checkout**:
  - Exatamente 1 checkout gerado: `chk_***` (`early_activation`).
  - Cardinalidade de tentativas no Firestore: 1 (`att_***`).
  - Assinatura de origem (`sub_source_***`) e assinatura alvo futura (`sub_target_***`) preservadas intactas.
- **Real Sandbox Payment & Settlement Authority**:
  - Hosted checkout pago via interface oficial do Sandbox com dados de cartão de teste.
  - Evento intermediário `CHECKOUT_PAID` recebido (marcou terminalidade da sessão, mas não promoveu quotas e não atuou como autoridade de liquidação financeira).
  - Evento definitivo `PAYMENT_CONFIRMED` recebido e processado: autoridade soberana de liquidação contábil.
  - Exatamente 1 `BillingTransaction` canônica criada no ledger: `asaas_pay_***` (valor: 1267 centavos, tipo: `prorated_early_activation_adjustment`).
- **Entitlement Promotion & Lifecycle Invariants**:
  - `SubscriptionService` promoveu imediatamente as cotas de Lite (20 membros / 100 músicas) para Essential (40 membros / 200 músicas).
  - `current_period_end` do ministério mantido rigorosamente inalterado no ciclo original.
  - Transição global permaneceu com status `scheduled`.
  - Slot canônico ativo permaneceu `held` e idêntico (`BEFORE == AFTER`).
  - Recorrência futura e recorrência anterior permaneceram intactas.
- **Reconciler Idempotency**:
  - Execução secundária do worker `reconcilePaidToPaidEarlyActivationAdjustment` sob relógio real resultou em `already_activated` / NO-OP benigno.
  - Contagem de transações no ledger: rigorosamente 1.
  - Contagem de checkouts: rigorosamente 1.
  - Zero duplicações de cotas.

---

## 5. Scenario B Result (Natural Expiry & Post-Expiry Safe Retry — Homologated)

- **Configuração de TTL**:
  - Checkout avulso criado com TTL mínimo permitido pelo provedor Asaas no Sandbox: 10 minutos (`minutesToExpire = 10`).
- **Local TTL & Pre-Webhook Discipline**:
  - Ao transcorrer o prazo local (`now >= expires_at`), a rotina canônica avaliou o checkout como `local_expiry_awaiting_provider_webhook`.
  - Zero chamadas a `POST /v3/checkouts/{id}/cancel` pós-TTL (expiração natural comprovadamente não depende de cancelamento explícito).
  - Slot de transição permaneceu `held`.
- **Official Terminal Webhook**:
  - Webhook oficial `CHECKOUT_EXPIRED` emitido pelo gateway Asaas após 10 minutos e recebido pelo LouvAIO.
  - Payment Safety Gate: consulta de pagamentos da sessão (`listPaymentsByCheckoutSession`) retornou exatamente 0 pagamentos.
  - Tentativa transicionou deterministicamente para `status = 'expired'`, `provider_session_terminal = true`, `expiry_confirmed_at` preenchido.
  - Campos de cancelamento explícito mantidos como `undefined` (`EXPIRED != CANCELED`).
  - Zero `BillingTransaction` gerada.
- **Post-Expiry Safe Retry**:
  - Transição permaneceu `scheduled` e slot permaneceu `held`.
  - Nova cotação solicitada e emitida com sucesso (`quot_retry_***`), com pró-rata atualizada e preservação integral do histórico contábil anterior.

---

## 6. Post-Test Sandbox Hygiene Correction

- **Auditoria do Contrato do Provedor**:
  - `DELETE /v3/subscriptions/{id}`: remove o recurso de assinatura e cancela faturas pendentes de forma destrutiva no gateway.
  - `PUT /v3/subscriptions/{id}` com `{ status: 'INACTIVE' }`: inativação não destrutiva canônica recomendada, preservando auditoria financeira.
- **Correção da Disciplina**:
  - O primeiro ciclo de testes utilizou `DELETE` sobre assinaturas de teste descartáveis.
  - O Scenario A2 adotou estritamente o método `provider.inactivateSubscription` (`PUT` status `INACTIVE`), sem nenhum uso de `DELETE`.
  - Todas as transações, tentativas, webhooks e histórico de auditoria permanecem preservados.

---

## 7. Homologation Limitations & Non-Applicable Flows

- **LOST WEBHOOK FULL SANDBOX SIMULATION: `NOT_VERIFIED`**:
  - A reconciliação de checkout conhecido sem depender do webhook de pagamento foi validada com sucesso (`known checkout -> listPaymentsByCheckoutSession -> settled payment -> reconciler idempotency`).
  - No entanto, a simulação física de supressão intencional e permanente da entrega de webhook a partir dos servidores do Asaas não foi reproduzida no Sandbox.
- **EXPLICIT CANCELLATION E2E: `NOT_APPLICABLE`**:
  - A infraestrutura de cancelamento explícito via gateway (`provider.cancelCheckout` e rotinas de cleanup) está implementada, testada e pronta, mas não existe atualmente nenhum gatilho automático de produto que invoque cancelamento explícito pré-expiração em checkouts de antecipação (o ciclo segue expiração natural).

---

## 8. Final Checklist & Verification

| Item | Status | Evidência |
| :--- | :--- | :--- |
| Harness Checkpoint `9fcbfb5` | PASS | Confirmado via `git log -5 --oneline` e `git status` |
| Scenario A1 Contamination Disclosed | PASS | Registrado como contaminado por slot manual no scratch |
| Production Slot Authority Verified | PASS | `BillingRepository` usa uniformemente `buildActiveTransitionSlotId` |
| Scenario A2 Clean (Zero Manual Repair) | PASS | Executado com relógio real, slot canônico inicial e zero edits manuais |
| Exact Proration in Cents | PASS | 1267 centavos (R$ 12,67) calculado e validado |
| Detached Checkout & Cardinality = 1 | PASS | 1 tentativa, 1 checkout hospedado Asaas |
| Settlement Authority Separation | PASS | `PAYMENT_CONFIRMED` efetuou a liquidação; `CHECKOUT_PAID` foi intermediário |
| Ledger & BillingTransaction = 1 | PASS | Exatamente 1 transação contábil criada |
| Immediate Entitlement Promotion | PASS | Promovido de Lite (20/100) para Essential (40/200) no runtime |
| Commercial Period Preserved | PASS | `current_period_end` inalterado |
| Transition Scheduled & Slot HELD | PASS | Transição permanece `scheduled`, slot canônico mantido `held` |
| Reconciler Idempotency | PASS | Segunda passada resultou em `already_activated` / NO-OP |
| Scenario B Natural Expiry Homologated | PASS | Webhook `CHECKOUT_EXPIRED` oficial verificado, 0 pagamentos, retry limpo |
| Post-Test Hygiene Without DELETE | PASS | Apenas `PUT` status `INACTIVE` utilizado |
| Zero Production Operations | PASS | Isolamento estrito no ambiente Sandbox |
| Documentation-Only Change | PASS | Código de produto em `backend/` e `web/` 100% inalterado |

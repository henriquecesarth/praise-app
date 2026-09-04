# ExecPlan: LouvAIO — Phase 3C.6 Early Activation End-to-End Sandbox Homologation

- **Status**: `COMPLETE & SANDBOX HOMOLOGATED`
- **Production Ready**: `SANDBOX VERIFIED (Production Configuration Pending)`
- **Data de Execução**: 2026-09-04
- **Canonical Checkpoint**: `9fcbfb5` (`feat(billing): harden early activation checkout lifecycle`)
- **Ambiente**: Asaas Sandbox API v3 (`https://api-sandbox.asaas.com/v3`)
- **Operação em Produção**: `NENHUMA (PRODUÇÃO PROIBIDA / ZERO OPERAÇÕES REAIS)`

---

## 1. Objetivo

Registrar a homologação definitiva de ponta a ponta da **Phase 3C Early Activation** contra o ambiente oficial do **Asaas Sandbox**, distinguindo com transparência a evolução e o papel de cada cenário:
- **Scenario A1**: validou fluxo de pagamento, liquidação e ledger, mas foi contaminado por geração incorreta de slot ID no script de teste (`_` vs `__`).
- **Scenario A2**: validou o fluxo financeiro de checkout avulso, pagamento no Sandbox, liquidação por `PAYMENT_CONFIRMED`, unicidade de ledger e idempotência sem nenhum reparo manual no Firestore com slot canônico; contudo, a fixture de teste utilizou cotas manuais copiadas de mocks de testes unitários (`5/50 -> 15/200`), não constituindo a prova das cotas do catálogo.
- **Scenario A3 (Authoritative Canonical Entitlement E2E Proof)**: prova canônica definitiva que utilizou a autoridade de produção mais alta (`buildTransitionCommercialSnapshot`, `buildBillingTransitionV1Record`, `createTransitionAndClaimSlot`) sem crafting manual de snapshots, validando as cotas reais do catálogo `PLANS_CATALOG` (`Lite 20/100 -> Essential 40/200`) e a persistência de cotas bloqueadas em `ministry_subscriptions` (`locked_member_quota = 40, locked_song_quota = 200`).
- **Scenario B (Authoritative Natural Expiry E2E Proof)**: prova canônica de expiração natural por decurso de TTL de 10 minutos com recebimento assíncrono do webhook `CHECKOUT_EXPIRED`, conferência de zero pagamentos, terminalidade limpa e re-cotação tardia segura.

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

## 4. Scenario A2 Result (Mechanism Homologation & Quota Fixture Contamination Disclosure)

- **Papel na Homologação**:
  - O Scenario A2 foi fundamental para validar o fluxo financeiro completo com slot canônico, eliminando 100% dos reparos manuais de dados que haviam ocorrido no A1.
  - Provou a cotação com relógio real, cálculo exato de pró-rata em centavos inteiros (1267 centavos / R$ 12,67), criação de checkout avulso único, liquidação oficial via `PAYMENT_CONFIRMED`, gravação de exatamente 1 `BillingTransaction`, preservação do `current_period_end`, retenção do slot canônico em `held` e idempotência do reconciliador sob relógio real (`already_activated` / NO-OP).
- **Contaminação de Fixture (Quotas Manuais de Testes Unitários)**:
  - Apesar do mecanismo financeiro 100% válido, o scratch script de teste do A2 instanciou a transição manualmente copiando valores arbitrários de testes unitários:
    - `source_entitlement_snapshot`: `Lite 5/50`
    - `target_entitlement_snapshot`: `Essential 15/200`
  - Portanto, **o Scenario A2 NÃO representa a prova canônica das quotas do catálogo de produtos**.
- **Causa-Raiz & Auditoria**:
  - Testes unitários de Early Activation utilizam propositalmente cotas reduzidas (5/50 e 15/200) para isolamento de teste. O harness do A2 copiou inadvertidamente essa fixture mockada em vez de acionar a factory de domínio de produção.
  - Não se trata de bug de código de produção: o catálogo canônico `PLANS_CATALOG` define estritamente `Lite (20/100)` e `Essential (40/200)`, e o `SubscriptionService` aplicou fielmente o snapshot que constava na transição.
- **Regra de Harness Estabelecida**:
  - *SANDBOX HOMOLOGATION FIXTURES MUST NOT COPY UNIT-TEST SNAPSHOTS; ALWAYS USE PRODUCTION DOMAIN AUTHORITIES*.

---

## 5. Scenario A3 Result (Authoritative Canonical Entitlement E2E Proof)

- **Autoridade Canônica de Produção**:
  - Criado e executado sob o namespace isolado `PHASE_3C6_A3_CANONICAL_*`.
  - Zero snapshots manuais e zero cópia de mocks de teste.
  - A transição foi construída integralmente pela cadeia de produção:
    - `buildTransitionCommercialSnapshot(...)`
    - `buildBillingTransitionV1Record(...)`
    - `billingRepo.createTransitionAndClaimSlot(...)`
- **Verificação Pré-Pagamento dos Snapshots do Catálogo (PLANS_CATALOG)**:
  - `source_entitlement_snapshot`: `plan_id = 'lite'`, `addon_blocks = 0`, `effective_member_quota = 20`, `effective_song_quota = 100`.
  - `target_entitlement_snapshot`: `plan_id = 'essential'`, `addon_blocks = 0`, `effective_member_quota = 40`, `effective_song_quota = 200`.
  - Preços comerciais: R$ 14,90 (1490 centavos) -> R$ 34,90 (3490 centavos).
  - Estado prévio no `SubscriptionService.getSubscriptionSummary`: `Lite (20 membros / 100 músicas)`.
- **Cotação Pró-Rata & Checkout Desacoplado**:
  - Emitida com relógio real do sistema: `quot_***`.
  - Pró-rata exata em centavos inteiros: $\text{round-half-up}\left(\frac{(3490 - 1490) \times 19}{30}\right) = 1267\text{ centavos}$ (R$ 12,67).
  - Detached checkout criado no Asaas Sandbox: `chk_***` (`early_activation`, cardinalidade = 1).
- **Liquidação Real no Asaas Sandbox**:
  - Pagamento hosted efetuado via cartão de teste do Sandbox.
  - Cobrança detectada no gateway: `pay_***` com status `CONFIRMED` no valor de R$ 12,67.
  - Evento de liquidação: `PAYMENT_CONFIRMED` operou como a autoridade de liquidação contábil.
- **Evidência Contábil (Ledger)**:
  - Exatamente 1 `BillingTransaction` canônica gravada: `asaas_pay_***` (1267 centavos, tipo `prorated_early_activation_adjustment`). Zero duplicação no ministério.
- **Promoção Canônica de Entitlement & Quotas Bloqueadas**:
  - `processEarlyActivationAdjustmentSettlement` invocou `applyLockedEntitlementSnapshot`, gravando no documento `ministry_subscriptions`:
    - `locked_member_quota = 40`
    - `locked_song_quota = 200`
  - `SubscriptionService.getSubscriptionSummary(ministryId)` pós-liquidação retornou efetivamente:
    - `plan = 'essential'`
    - `quotas.members = 40`
    - `quotas.songs = 200`
- **Invariantes de Ciclo, Slot e Recorrência**:
  - `current_period_end`: mantido rigorosamente em `2026-09-24T00:00:00.000Z` (preservado).
  - `effective_billing_date`: mantido em `2026-09-24` (preservado).
  - `transition_status`: permaneceu `scheduled`.
  - `early_activation_status`: transitou para `activated`.
  - Slot canônico ativo: `slot_min_***__asaas` permaneceu `held` associado à mesma transição A3.
  - Recorrência de origem (`sub_source_***`) e recorrência futura (`sub_target_***`): 100% inalteradas, zero novas assinaturas criadas.
- **Idempotência do Reconciliador**:
  - Segunda execução de `reconcilePaidToPaidEarlyActivationAdjustment` sob relógio real retornou `already_activated` / NO-OP.
  - Total de `BillingTransaction`: estritamente 1. Cotas: estáveis em 40/200.

---

## 6. Snapshot Authority Chain

A comprovação ponta a ponta da autoridade de cotas no Scenario A3 seguiu rigorosamente a seguinte cadeia factual:

```
PLANS_CATALOG (Lite: 20/100, Essential: 40/200)
       │
       ▼
buildTransitionCommercialSnapshot(...)
       │
       ▼
target_entitlement_snapshot (members: 40, songs: 200)
       │
       ▼
PAYMENT_CONFIRMED (Asaas Sandbox: pay_***, R$ 12,67)
       │
       ▼
processEarlyActivationAdjustmentSettlement(...)
       │
       ▼
applyLockedEntitlementSnapshot(...)
       │
       ▼
ministry_subscriptions.locked_member_quota = 40 / locked_song_quota = 200
       │
       ▼
SubscriptionService.getSubscriptionSummary(...)
       │
       ▼
Effective Quotas: Essential (members: 40, songs: 200)
```

---

## 7. Scenario B Result (Natural Expiry & Post-Expiry Safe Retry — Homologated Evidence Retained)

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

## 8. Post-Test Sandbox Hygiene Correction & Discipline

- **Auditoria do Contrato do Provedor**:
  - `DELETE /v3/subscriptions/{id}`: remove o recurso de assinatura e cancela faturas pendentes de forma destrutiva no gateway.
  - `PUT /v3/subscriptions/{id}` com `{ status: 'INACTIVE' }`: inativação não destrutiva canônica recomendada, preservando auditoria financeira.
- **Correção da Disciplina**:
  - O primeiro ciclo de testes utilizou `DELETE` sobre assinaturas de teste descartáveis.
  - Os Scenarios A2 e A3 adotaram estritamente o método `provider.inactivateSubscription` (`PUT` status `INACTIVE`), com zero uso de `DELETE`.
  - Todas as transações, tentativas, webhooks e histórico de auditoria permanecem preservados.

---

## 9. Homologation Limitations & Non-Applicable Flows

- **LOST WEBHOOK FULL SANDBOX SIMULATION: `NOT_VERIFIED`**:
  - A reconciliação de checkout conhecido sem depender do webhook de pagamento foi validada com sucesso (`known checkout -> listPaymentsByCheckoutSession -> settled payment -> reconciler idempotency`).
  - No entanto, a simulação física de supressão intencional e permanente da entrega de webhook a partir dos servidores do Asaas não foi reproduzida no Sandbox.
- **EXPLICIT CANCELLATION E2E: `NOT_APPLICABLE`**:
  - A infraestrutura de cancelamento explícito via gateway (`provider.cancelCheckout` e rotinas de cleanup) está implementada, testada e pronta, mas não existe atualmente nenhum gatilho automático de produto que invoque cancelamento explícito pré-expiração em checkouts de antecipação (o ciclo segue expiração natural).

---

## 10. Final Checklist & Verification

| Item | Status | Evidência |
| :--- | :--- | :--- |
| Harness Checkpoint `9fcbfb5` | PASS | Confirmado via `git log -5 --oneline` e `git status` |
| Scenario A1 Contamination Disclosed | PASS | Registrado como contaminado por slot manual no scratch |
| Production Slot Authority Verified | PASS | `BillingRepository` usa uniformemente `buildActiveTransitionSlotId` |
| Scenario A2 Quota Contamination Disclosed | PASS | Registrado como contaminado por cotas 5/50 -> 15/200 copiadas de mocks unitários |
| Scenario A2 Financial Flow Homologated | PASS | Checkout avulso, pagamento real, liquidação, ledger e idempotência validados |
| Scenario A3 Authoritative Quota Proof | PASS | Homologação canônica ponta a ponta via helpers de produção |
| Canonical Catalog Lite 20/100 Verified | PASS | `PLANS_CATALOG.lite` validado em runtime antes e durante transição |
| Canonical Catalog Essential 40/200 Verified | PASS | `PLANS_CATALOG.essential` validado em runtime e persistido no snapshot |
| Exact Proration in Cents | PASS | 1267 centavos (R$ 12,67) calculado e validado sob relógio real |
| Detached Checkout Cardinality = 1 | PASS | 1 tentativa, 1 checkout hospedado Asaas |
| Settlement Authority Separation | PASS | `PAYMENT_CONFIRMED` efetuou a liquidação; `CHECKOUT_PAID` foi intermediário |
| Ledger & BillingTransaction = 1 | PASS | Exatamente 1 transação contábil criada no ajuste |
| Locked Entitlement Persisted (40/200) | PASS | `locked_member_quota = 40`, `locked_song_quota = 200` em `ministry_subscriptions` |
| Immediate Entitlement Promotion (40/200) | PASS | `SubscriptionService.getSubscriptionSummary` retornou Essential 40/200 |
| Commercial Period Preserved | PASS | `current_period_end` inalterado |
| Transition Scheduled & Slot HELD | PASS | Transição permanece `scheduled`, slot canônico mantido `held` |
| Reconciler Idempotency | PASS | Segunda passada resultou em `already_activated` / NO-OP |
| Scenario B Natural Expiry Homologated | PASS | Webhook `CHECKOUT_EXPIRED` oficial verificado, 0 pagamentos, retry limpo |
| Post-Test Hygiene Without DELETE | PASS | Apenas `PUT` status `INACTIVE` utilizado (zero `DELETE`) |
| Zero Production Operations | PASS | Isolamento estrito no ambiente Sandbox |
| Documentation-Only Change | PASS | Código de produto em `backend/` e `web/` 100% inalterado |

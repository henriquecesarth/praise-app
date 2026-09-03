# Project Memory

## Project Identity

- Nome: LouvAIO (anteriormente Praise App).
- Propósito: gestão web e PWA de ministérios de louvor, seus integrantes, repertório, escalas, cifras inteligentes, planos, quotas e faturamento recorrente.
- Identidade Visual Oficial: Verde escuro `#0F2A1F`, Terracota `#B85A3C`, Creme `#F5EFE6`, Preto `#121212`. Tokens centralizados em `web/src/styles/louvaio-brand.css`, `web/src/theme/louvaioTheme.ts` e `web/src/index.css`.
- Stack: React 18 + TypeScript + Vite/PWA + TailwindCSS v4; Node.js + TypeScript + Express 5; Firebase Authentication + Cloud Firestore; Asaas SaaS Gateway.
- Entry points: web/src/main.tsx, web/src/App.tsx, backend/src/server.ts e backend/src/app.ts.

## Architecture

Monorepo com dois pacotes npm independentes (`backend` e `web`). A SPA usa web/src/api.ts para consumir a API REST. O backend segue predominantemente route → middleware → controller → service → repository → Firestore. Não há workspace/package raiz.

## Important Components

- App.tsx: sessão, ministério ativo, navegação, sidebar institucional LouvAIO e estado principal da SPA.
- api.ts: URL base, JWT em localStorage, fetch e mapeamento de contratos.
- app.ts: middleware e montagem das rotas Express.
- server.ts: inicialização do servidor Express e ciclo de vida do BillingReconcilerWorker.
- unifiedConfig.ts: leitura/validação Zod de ambiente e defaults.
- firebase.ts: Firebase Admin, Firestore e Auth.
- middleware/auth.ts, rbac.ts, platform-admin.ts e quota-enforcement.ts: segurança, papéis, autoridade da plataforma e quotas operacionais.
- repositories/: fonte dos nomes de coleções e comportamento de persistência Firestore.
- theme/louvaioTheme.ts: mapeamento de cores e caminhos de assets oficiais de branding.

## Important Domain Concepts

Ministry é a fronteira principal de tenant. Usuários podem ser admin ou member; também há funções musicais separadas. Recursos incluem membros, convites PR-*, equipes, funções, classificações, artistas, músicas/versões, pastas, escalas, comentários, modelos de roteiro, liturgias, cifras, assinaturas, quotas e transações de faturamento.

### Commercial Structure & Plans

- 6 planos definidos em `backend/src/config/plans.config.ts`:
  - `free`: 10 membros / 50 músicas (R$ 0,00)
  - `lite`: 20 membros / 100 músicas (R$ 14,90/mês, 10% OFF anual)
  - `lite_plus`: 30 membros / 150 músicas, apresentado como Lite+ (R$ 24,90/mês, 10% OFF anual)
  - `essential`: 40 membros / 200 músicas (R$ 34,90/mês, 10% OFF anual), suporta add-on (+10 membros por bloco, máx 4 blocos = 80 membros)
  - `pro`: 100 membros / 500 músicas (R$ 89,90/mês, 10% OFF anual), suporta add-on (+10 membros por bloco, máx 10 blocos = 200 membros)
  - `premium`: 300 membros / 1.500 músicas (R$ 214,90/mês, 10% OFF anual)
- Preços operam deterministamente em centavos inteiros (`BRL`). Desconto anual de 10% calculado via fórmula padronizada. Detalhes em `docs/product/plans-and-limits.md`.

## Integrations

- Firebase Admin SDK: Auth e Firestore.
- Firebase Identity Toolkit REST: login por e-mail/senha quando FIREBASE_WEB_API_KEY existe.
- Asaas Payment Gateway: integração desacoplada via `AsaasBillingProvider` para assinaturas recorrentes no cartão, checkouts hospedados e webhooks.
- Vercel: manifests independentes para frontend e backend.
- Google Fonts e html2pdf.js: carregados por CDN no HTML.
- Supabase: dependência/stub legado, não é persistência ativa.

## Persistence

Cloud Firestore é a fonte persistente ativa. Nomes de coleções e relações estão documentados em `docs/architecture/integrations.md`. Não há migrations ou schema SQL versionado.

## Configuration

Variáveis de ambiente reconhecidas pelo backend via `unifiedConfig.ts`:
- Servidor e Segurança: `PORT`, `NODE_ENV`, `JWT_SECRET`, `CORS_ORIGIN`, `DEFAULT_MINISTRY_ID`, `PLATFORM_ADMIN_SECRET`
- Firebase: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_DATABASE_URL`, `FIREBASE_WEB_API_KEY`
- Faturamento e Gateway: `BILLING_TIMEZONE`, `BILLING_RECONCILIATION_ENABLED`, `BILLING_RECONCILIATION_INTERVAL_MINUTES`, `WEB_APP_URL`, `BILLING_PUBLIC_API_URL`, `ASAAS_API_URL`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_ENVIRONMENT`
- Frontend: `VITE_API_URL`

Nunca registrar valores secretos no repositório.

## Testing

O backend usa Vitest para testes unitários e de integração cobrindo motor de quotas, serviços de assinatura, concessões cortesia (complimentary), isolamento de tenant, segurança contra IDOR, RBAC, autenticação/tokens, otimização de consultas/repositórios com cursor/agregação, controllers e serviços de billing/checkout com concorrência e idempotência atômica. O web usa Vitest/Testing Library para testes unitários/componentes e Playwright para jornadas E2E móveis com matriz de viewports e temas light/dark via canal Chrome nativo (jornadas E2E interceptam a API e usam fixtures locais sem escrita persistente). Ambos os pacotes são validados por build TypeScript (`tsc`). O lint backend está declarado, mas não operacional.

## Operational Commands

    cd backend && npm ci
    cd backend && npm run dev
    cd backend && npm run build
    cd backend && npm test
    cd backend && npm start

    cd web && npm ci
    cd web && npm run dev
    cd web && npm run build
    cd web && npm test
    cd web && npm run test:e2e
    cd web && npm run preview

## Important Decisions

- Código atual prevalece sobre documentação histórica.
- Identidade visual oficial LouvAIO adotada com paleta Verde/Terracota/Creme/Preto e tokens centralizados (`docs/decisions/2026-08-28-louvaio-visual-identity.md`).
- Contenção responsiva sem uso de `overflow-x: hidden` global.
- Sistema de planos, quotas e entitlements operado com autoridade no backend (`backend/src/config/plans.config.ts`) e consumido dinamicamente pelo frontend.
- Separação estrita entre `BillingStatus` (financeiro) e `administratively_suspended` (administrativo/fraude).
- Resolução dinâmica de `accessMode` (`normal`, `grace`, `restricted_over_limit`, `suspended`) sem dependência de jobs ou escrita prévia.
- Pre-Launch Cost & Scalability Optimization: Consultas de repertório operam com paginação estável por cursor (`startAfter(updated_at, doc_id)`), ordenação composta (`updated_at DESC, __name__ DESC`), DTO enxuto `SongSummary` (-90% egress de listagem), agregação de contagem (`count().get()`), eliminação de $N+1$ em integrantes e pastas através de batch lookup único via `db.getAll()`, suporte a `olderCursor` em comentários e índices declarados em `backend/firestore.indexes.json`.
- Authentication & Authorization Security Hardening: Validação de login obrigatória no Identity Toolkit; suporte dual assíncrono de tokens (JWT assinado + Firebase ID Token); rotas e repositórios protegidos com isolamento multitenant estrito e checagem anti-IDOR; proteção das rotas de cifras inteligentes (`smart_chords`) com filtro por `user_id`; mitigação de account takeover em integrantes e aplicação da regra do último administrador ("Last Admin Rule").
- Billing, Checkout & Subscription Automation: Gateway Asaas integrado através de interface desacoplada `BillingProvider`; separação estrita de autoridade (gateway controla estado financeiro, LouvAIO controla direito de uso e quotas); transições de plano isoladas na coleção `billing_plan_changes` para não sobrescrever a assinatura ativa antes da confirmação do pagamento; webhooks transacionais com idempotência atômica garantida por Firestore Transaction na coleção `billing_webhook_events`; validação de valor pago (Amount Validation); proteção contra eventos fora de ordem (Out-of-order sequence guards); suporte integral a planos cortesia (`subscription_mode = 'complimentary'`) concedidos por autoridade da plataforma (`PLATFORM_ADMIN_SECRET`) com zero chamadas ao Asaas; rotina de limpeza de cobranças futuras PENDING da assinatura anterior (`cleanupFuturePaymentsFromPreviousSubscription`) com cutoff date comercial e flag `financial_attention_required` para mitigação de race condition; preservação absoluta de dados em downgrades/cancelamentos aplicando período de adaptação (`grace`).
- Webhook Event Lifecycle Semantics (Phase 3B.3 Hardening — 2026-09-03, CORRIGIDO 2026-09-03): `BillingWebhookEvent` lifecycle != `BillingTransition` lifecycle. Um webhook event representa UMA entrega do provider; uma BillingTransition representa a saga financeira longa. O `processing_status = 'processing'` é estritamente transitório — somente durante execução ativa do handler. Todo caminho de retorno de `processScheduledPaidRenewalSettlement` que representa uma avaliação terminal do domínio deve chamar `markWebhookEventProcessed` antes de retornar, independentemente de `processed: false`. **Não existe lease interno de webhook; não existe stale-reclaim automático; a única forma de re-executar um webhook é via provider redelivery.** Classificação canônica dos caminhos: (A) Consumido, sem mudança de estado → `markWebhookEventProcessed('processed')` [renewal_payment_not_settled, strategy_mismatch, SECOND_CYCLE_PAYMENT, scheduled_event_acknowledged]; (B) Transitoriamente incompleto, saga pertence ao reconciler → `markWebhookEventProcessed('processed')` + transition permanece live [PAYMENT_NOT_FOUND: reconciler usa `future_provider_payment_id` para poll autônomo; SOURCE_CUTOVER_NOT_COMPLETED: reconciler executa cutover→settlement; ACTIVATION_COMPLETION_GATE_FAILED: reconciler re-executa gate com state fresco]; (C) Financial attention persistida na transition → `markWebhookEventProcessed('processed')` [SOURCE_SUBSCRIPTION_STILL_ACTIVE: grava `financial_attention_required=true` antes de finalizar; todos os mismatches que setam `financial_attention_required=true` — o bloqueio vem do campo da transition, não do status do evento]; (D) Webhook de recurso errado → `markWebhookEventProcessed('ignored')` [WRONG_PAYMENT_ID, WRONG_TARGET_SUBSCRIPTION]. `claimTransitionForReconciliation` bloqueia somente transitions com `financial_safety_status = 'attention_required'` (mismatch real), não initial purchases com resultado de checkout incerto (`financial_attention_required=true` mas `financial_safety_status` ausente ou `live`). HTTP 5xx somente para falhas reais de processamento da delivery; HTTP 2xx nunca deixa o evento permanentemente em processing.
- Firebase/Firestore é a implementação ativa; referências antigas a Supabase/Flutter não descrevem este checkout.
- Não existe contrato HTTP uniformizado; mudanças devem preservar respostas locais.
- Inconsistências confirmadas ficam catalogadas em docs/system-status.md e exigem tarefas próprias.

## Known Constraints

- Testes de concorrência física de transações sob Firestore Emulator: NOT YET VERIFIED (validado com mocks unitários). Sem CI/CD, Docker, migrations, formatter ou esquema Firestore versionado.
- Componentes web e o cliente api.ts concentram muito comportamento.
- Alias groups/ministry e campos snake_case/camelCase coexistem por compatibilidade.
- Versão mínima suportada de Node/npm: Unknown / Not yet verified.

- Política de Transições de Assinatura V1 (ADR 2026-09-01 Revisado): Period-Paid Principle & Separação de Estados (`Asaas subscription != LouvAIO entitlement`). Todo período pago pertence ao cliente até `current_period_end`. Upgrades de plano utilizam a arquitetura `RECURRENCE_FIRST` (autorização da renovação futura do plano alvo em `current_period_end` + oferta opcional de compra de acesso antecipado via ajuste proporcional). Downgrades, reduções de add-ons e trocas de periodicidade (mensal/anual) permanecem agendados para `current_period_end` sem perda antecipada de entitlement nem cobrança sobreposta. Price lock na solicitação.
- Slot Lifetime Invariant: O active transition slot permanece HELD em `pending_future_authorization`, `future_target_prepared` e `scheduled` enquanto existir obrigação financeira futura viva. A Phase 3B.2 não libera o slot após o old cutover. Liberação de slot ocorre estritamente em condição terminal comprovadamente segura (`completed + safe_terminal` ou cancelamento/falha compensado).
- Billing Transition V1 Status:
  - Phase 1 (Modelo de Persistência, Slot Ativo Determinístico, Invariantes e Attempts): COMPLETE.
  - Phase 2 (Domain Services, Validações Pré-Checkout, Quotas e Quotes V1): COMPLETE.
  - Phase 3A (Free -> Paid V1 Initial Purchase): CLOSED AND SANDBOX HOMOLOGATED (Saga completa ponta a ponta homologada no Asaas Sandbox com checkout hospedado, webhooks reais, dupla camada de idempotência de evento e transação financeira, proveniência temporal exata com `paid_billing_date`, liberação determinística do slot ativo e persistência de `safe_terminal`).
  - Billing Sandbox Bootstrap: READY (Versão 1.1 com isolamento de ambiente, ciclo de vida de processos filhos, supervisão contínua do Quick Tunnel e sincronização idempotente de webhooks).
  - Phase 3B.1 (Paid -> Paid Target Recurrence Preparation): COMPLETE, HARDENED & PROVIDER CONTRACT ALIGNED (Cadeia canônica attempt -> known provider checkout ID -> GET /v3/payments?checkoutSession -> target subscription -> first payment; sem dependência de endpoints não documentados do Asaas; sem assunção de externalReference na assinatura; recovery authorities documentadas; detecção de ambiguidade fail-closed; Target Ready Gate desacoplado de nextDueDate; conversão monetária determinística; slot retido; zero mutações na assinatura de origem e zero ativações de entitlement).
  - Phase 3B.2 (Paid -> Paid Source Recurrence Cutover & Scheduling): COMPLETE & CLEAN END-TO-END SANDBOX HOMOLOGATED (Transição da recorrência de origem: future_target_prepared -> awaiting_old_inactivation -> scheduled; datas comerciais persistidas na criação da transição sem reparos manuais; inativação da source via PUT status INACTIVE; sobrevivência de cobrança pendente comprovada em Sandbox e limpa cirurgicamente pelo LouvAIO com verificação all-status; target payment permanece intacto e PENDING; transição avança para scheduled via BillingReconcilerWorker; runtime entitlement LouvAIO retido estritamente na source Lite até renewal-boundary; slot de transição HELD em scheduled; cancelamento explícito seguro de checkout transita para status canceled com safe_terminal e liberação de slot; idempotência e proteção contra eventos atrasados; target PENDING não gera receita de BillingTransaction).
  - Phase 3B.3A (Scheduled Renewal Settlement, Immutable Snapshot Activation & Crash-Safety Hardening): COMPLETE & CLEAN END-TO-END SANDBOX HOMOLOGATED (Scenario A homologado de ponta a ponta no Asaas Sandbox com Hosted Checkout real, webhooks reais e reconciliador assíncrono. Two-Gate Model cumulativo validado; snapshot de cotas imutável; ordem canônica estrita target prepared -> source cutover -> source INACTIVE + pending cleanup -> supersede completed -> scheduled -> renewal settlement -> fresh source safety check -> target quota promotion -> BillingTransaction -> BillingSubscription canônica min_x_asaas -> local activation completion gate -> completed safe_terminal -> slot release; mitigação comprovada contra webhook race condition e concorrência com o worker; slot retido até a convergência total; 45 testes dedicados e 493 testes no backend passando).
  - Phase 3B.3B (Renewal Failure, 7-Day Civil Grace & Delinquency Recovery): COMPLETE, AUTOMATED TEST SUITE PASSING & PROVIDER UNPAID BEHAVIOR SANDBOX VALIDATED (Modelo civil estrito de 7 dias [grace_start_billing_date, grace_end_billing_date) em America/Sao_Paulo derivado deterministicamente de effective_billing_date via addCommercialDays; cálculo sem 168h/ms/UTC; entrada write-once grava grace_started_at, datas de carência e grace_entitlement_snapshot capturando o runtime entitlement pre-boundary real de ministry_subscriptions; plano alvo não quitado nunca concede direitos durante carência; quitação dentro da carência destrava ativação target reutilizando o pipeline hardened 3B.3A com novo ciclo iniciando na fronteira original e paid_billing_date preservando a data real do evento do provedor; expiração da carência comuta status para expired e resolveAccessMode para restricted_over_limit com preservação absoluta de dados [zero deletions]; transição permanece scheduled e slot permanece HELD; quitação na/após expiração não auto-ativa e sinaliza RENEWAL_SETTLED_AFTER_GRACE_REQUIRES_POLICY com slot retido documentando gap de delinquency recovery; reconciliador assíncrono e webhook compartilham a mesma máquina de estados determinística; Scenario B Sandbox: PAYMENT_OVERDUE recebido, evaluated corretamente como pre-boundary, domínio confirmado, grace não iniciada por clock real real limitado; civil grace E2E limitado por clock real sem IClock abstraction — classificado como limitação legítima; 29 testes dedicados + 29 testes de 3B.3A + 493 testes backend passando. Webhook Lifecycle Hardening: COMPLETE — ver decisão de Webhook Event Lifecycle no Important Decisions.).
  - Phase 3C (Early Activation): NOT STARTED.
  - Paid -> Free Transitions: NOT STARTED.

## Known Issues and Implementation Gaps

Itens duráveis e priorizados catalogados em docs/system-status.md:
- Asaas Customer Reuse (GAP-011): CLOSED — SANDBOX REVALIDATED (1 Ministry + provider vincula-se a 1 customer canônico em `billing_customers` com reutilização estrita em checkouts subsequentes, lock atômico de criação, fallback por externalReference e preservação de customers históricos).
- Same-Plan Interval Change (GAP-012): UI / interval recognition validado em Sandbox; execução financeira segue a Política V1 de agendamento em `current_period_end` (APPROVED DOMAIN POLICY REVISED — IMPLEMENTATION PENDING).
- Aliases de rota legados (`features/groups`) e rota de cifra por música (`/smart-chords/song/:songId`).

## Current State

- Sistema completo de Planos, Quotas, Entitlements e Assinatura por Ministério implementado no backend e web.
- Integração de SaaS Billing com Asaas implementada no backend e web (fluxos principais homologados em ambiente Sandbox; gaps conhecidos permanecem abertos; deploy/configuração de produção não devem ser presumidos).
- O web possui rotas estáveis, navegação mobile e desktop coerente, bootstrap autenticado, tela `/ministerio/plano` com checkout e controle de ciclo anual/mensal, testes E2E com cobertura de viewports (light/dark) e PWA com manifest LouvAIO atualizado.
- O repositório contém `backend` e `web`; não contém mobile ou supabase.

## Completed Milestones

- Estrutura inicial backend/web e migração para Firebase.
- Gestão de ministérios, repertório, escalas e PWA presentes no código.
- Reestilização integral da identidade visual e PWA LouvAIO.
- Implementação do Sistema de Planos, Quotas e Entitlements por Ministério.
- Formalização da Estratégia de Precificação Comercial v1 e Benchmark LouveApp.
- Otimização Pré-Lançamento de Custos, Consultas e Escalabilidade.
- Hardening de Segurança em Autenticação, Autorização, RBAC e Anti-IDOR.
- Integração de SaaS Billing, Checkout Hospedado, Webhooks Idempotentes, Future Payment Cleanup e Worker de Reconciliação com Asaas (fluxos principais homologados em Sandbox; gaps de customer reuse e troca de ciclo no mesmo plano permanecem catalogados).

## Current Work

Consulte docs/exec-plans/active/; planos concluídos ficam em docs/exec-plans/completed/.

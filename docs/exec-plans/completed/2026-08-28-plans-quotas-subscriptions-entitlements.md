# ExecPlan: Sistema de Planos, Quotas, Entitlements e Assinatura por Ministério no LouvAIO (Concluído)

- **Data de Criação**: 2026-08-28
- **Data de Conclusão**: 2026-08-28
- **Status**: Concluído e Auditado
- **Área**: Backend (Express / Firestore) & Web SPA (React / Vite)
- **Implementação Funcional**: Concluída (Backend + Web SPA)
- **Testes Unitários**: Concluídos (44 testes backend, 23 testes web — 100% verde)
- **Testes E2E / Auditoria Responsiva**: Concluídos (61 testes Playwright em 6 viewports light/dark — 100% verde)
- **Concorrência Real Firestore Emulator**: NOT YET VERIFIED (ambiente de execução local com cache npx corrompido para firebase-tools; lógica transacional e atomicidade unitária validadas com mocks)
- **Gateway de Pagamento / Cobrança Financeira**: Não implementado nesta fase (controles de planos e cotas funcionam internamente no produto)

---

## 1. Objetivo

Projetar e implementar no **LouvAIO** um sistema robusto, atômico e seguro de planos comerciais, quotas quantitativas, entitlements, gestão de assinaturas por ministério (tenant), suporte a add-ons de capacidade de membros, controle de downgrade sem deleção de dados, período de carência (*grace period*) não-renovável e modo restrito por excesso de uso (*restricted_over_limit*), com usage materializado e controle de concorrência transacional no Firestore, mantendo pureza em leituras e infraestrutura de testes no backend.

---

## 2. Diagnóstico da Arquitetura Atual e Mapeamento do Legado

### 2.1. Estado Atual no Banco e Middleware
- **Coleção `ministries`**:
  - Armazena `subscription_status: string` (preenchido com `'active'` por padrão no método `createMinistry`) e `subscription_expires_at?: string`.
  - Não possui `plan_id`, `member_addon_blocks`, `access_mode` ou `grace_period_expires_at`.
- **Middleware Legado `requireActiveSubscription` ([backend/src/middleware/rbac.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/middleware/rbac.ts#L48-L80))**:
  - Executava apenas `if (!['active', 'trialing'].includes(ministry.subscription_status)) throw new AppError(402, ...);`.
  - **Problema de Incompatibilidade**: Se um plano Pro for cancelado e rebaixado para Free com uso normal, um `billing_status: 'canceled'` bloquearia indevidamente o ministério caso fosse mapeado diretamente para o `subscription_status` legado.
  - **Mapeamento das Rotas com `requireActiveSubscription`**:
    - [backend/src/features/repertoire/repertoire.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/repertoire/repertoire.routes.ts): `POST/PUT/DELETE /songs`, `POST/PUT/DELETE /artists`, `POST/PUT/DELETE /classifications`, `POST/PUT/DELETE /folders`, `POST/DELETE /folders/:id/songs`.
    - [backend/src/features/liturgies/liturgy.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/liturgies/liturgy.routes.ts): `POST/PUT/DELETE /liturgies`.
    - [backend/src/features/ministries/ministry.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/ministries/ministry.routes.ts): `POST /:ministryId/invites`.
  - **Vulnerabilidades Corrigidas**: Rotas que criam membros ([POST /ministries/:ministryId/members](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/ministries/ministry.routes.ts#L41-L46) e [POST /ministries/join](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/ministries/ministry.routes.ts#L22)) foram envolvidas em transações atômicas de quota.

### 2.2. Tratamento Definitivo do Legado `subscription_status`
- O campo `subscription_status` em `ministries` foi formalmente marcado como **DEPRECATED / COMPATIBILITY-ONLY**.
- **Não recebe novos significados** nem valores desconhecidos por clientes legados (como `'restricted'`).
- O middleware legado `requireActiveSubscription` foi **completamente substituído** pelos novos middlewares granulares (`enforceOperationalAccess`, `enforceMemberQuota`, `enforceSongQuota`).
- O código novo opera exclusivamente com `billingStatus` e `accessMode` de maneira independente.

---

## 3. Decisões Arquiteturais e Correções Incorporadas

### 3.1. Fonte Única de Verdade para o Catálogo de Planos
- O **BACKEND** é a autoridade única de catálogo (`backend/src/config/plans.config.ts`).
- O frontend consome a rota pública `GET /api/v1/plans` e mantém apenas tipos TypeScript e helpers puramente visuais, eliminando qualquer risco de divergência (*drift*).

### 3.2. Proibição de Upgrade Arbitrário pelo Frontend
- Não existe endpoint público (`PUT /subscription/plan` ou `PUT /subscription/addons`) para administradores comuns se auto-concederem planos pagos.
- Transições de planos residem no domínio interno (`SubscriptionService`), preparadas para receber futuramente webhooks seguros de gateways de pagamento ou ações do super-administrador da plataforma.

### 3.3. Separação Estrita entre BillingStatus e Suspensão Administrativa
- **`BillingStatus`** representa exclusivamente o estado financeiro da assinatura:
  - `'active' | 'trialing' | 'past_due' | 'canceled'`
- **Suspensão Administrativa** é uma dimensão separada registrada no documento de assinatura:
  - `administratively_suspended: boolean`
  - `suspended_at: string | null`
  - `suspension_reason: string | null`
- A função `resolveAccessMode()` retorna `'suspended'` quando `administratively_suspended === true`, sem inferir suspensão a partir de um status financeiro como `canceled`.

### 3.4. Prevenção de Carência (*Grace Period*) Infinita ou Implícita
- A função pura `resolveAccessMode(subscription, plan, usage, now)` **NÃO inicia carência implicitamente**.
- A carência com `grace_period_expires_at = now + DEFAULT_GRACE_PERIOD_DAYS` só é registrada no banco no momento de uma **transição explícita de redução de capacidade**:
  - Downgrade de plano;
  - Redução ou remoção de blocos de add-ons de membros;
  - Término de assinatura paga com transição automática para o plano Free.
- Comportamento de `resolveAccessMode()`:
  - Se `usage > quota` e `grace_period_expires_at != null`:
    - Se `now <= grace_period_expires_at` -> `'grace'`
    - Se `now > grace_period_expires_at` -> `'restricted_over_limit'`
  - Se `usage > quota` e `grace_period_expires_at == null` -> **Fail-safe: `'restricted_over_limit'`** (não concede 7 dias novos sem justificativa de transição).
  - Se `usage <= quota` -> `'normal'` (regularização imediata).

### 3.5. Usage Materializado (`ministry_usage`) e Enforcement Atômico
- Para eliminar leituras completas de coleções a cada requisição e prover autoridade serializada contra race conditions, é criada a coleção:
  `ministry_usage/{ministryId}`:
  ```json
  {
    "ministry_id": "ministry-id",
    "members_count": 9,
    "songs_count": 45,
    "created_at": "2026-08-28T...",
    "updated_at": "2026-08-28T..."
  }
  ```
- **Concorrência Atômica via Firestore Transactions**:
  Toda operação que adiciona membro ou música executa em uma transação Firestore:
  1. Lê `ministry_subscriptions/{ministryId}`;
  2. Lê `ministry_usage/{ministryId}`;
  3. Resolve quota efetiva do plano;
  4. Valida capacidade (`usage.members_count + 1 <= effectiveMemberQuota`);
  5. Cria o documento (`ministry_members` ou `songs`);
  6. Incrementa `usage.members_count` ou `usage.songs_count`;
  7. Atualiza `ministry_usage/{ministryId}`;
  8. Commit.

### 3.6. Mapeamento Completo de Consistência de Usage
Todas as operações que alteram contagens atualizam o recurso e o `ministry_usage` na mesma transação atômica:

| Operação | Rota HTTP / Método | Ação em `ministry_members` / `songs` | Ação em `ministry_usage` |
| :--- | :--- | :--- | :--- |
| **Criação de Ministério** | `POST /ministries` | Cria `ministry` e adiciona owner em `ministry_members` | Inicializa `members_count: 1`, `songs_count: 0` |
| **Inclusão Manual de Membro**| `POST /ministries/:id/members` | Cria doc em `ministry_members` | Valida quota e incrementa `members_count += 1` |
| **Ingresso por Código (Join)**| `POST /ministries/join` | Cria doc em `ministry_members` e atualiza `ministry_invites` | Valida quota e incrementa `members_count += 1` |
| **Remoção de Membro** | `DELETE /ministries/:id/members/:id`| Deleta doc de `ministry_members` | Decrementa `members_count = max(0, count - 1)` |
| **Saída de Membro (Leave)** | `DELETE /ministries/:id/leave` | Deleta doc de `ministry_members` | Decrementa `members_count = max(0, count - 1)` |
| **Criação de Música** | `POST /repertoire/songs` | Cria doc em `songs` | Valida quota e incrementa `songs_count += 1` |
| **Exclusão de Música** | `DELETE /repertoire/songs/:id`| Deleta doc em `songs` | Decrementa `songs_count = max(0, count - 1)` |

*Nota sobre convites*: `POST /ministries/:ministryId/invites` **não altera `members_count`**, pois convites pendentes não são membros.

### 3.7. Bootstrap e Reconciliação de Usage sem Side-Effects em GET
- **Criação de Novo Ministério**: Cria `ministry_subscriptions` (plano `free`) e `ministry_usage` (`members_count: 1`, `songs_count: 0`) explicitamente no momento da criação.
- **Ministérios Legados**:
  - Em leituras (`GET`), caso o ministério não possua `ministry_subscriptions` ou `ministry_usage`, o serviço retorna em memória um objeto de fallback seguro (`free`, `normal`), **sem executar escritas colaterais no banco**.
  - A materialização do registro ocorre apenas em operações de escrita controlada (`ensureSubscriptionAndUsage`) ou através do método administrativo de reconciliação:
    `SubscriptionService.reconcileMinistryUsage(ministryId)`.
  - A reconciliação conta os documentos reais existentes em `ministry_members` e `songs` e corrige qualquer eventual divergência no contador de forma síncrona e testável (sem workers ou filas de background).

### 3.8. Enforcement Semântico em `restricted_over_limit` (Sem Liberação Genérica de DELETE)
- Em modo restrito, apenas ações voltadas para **reduzir uso e recuperar conformidade** ou consultar/exportar são liberadas:
  - `GET *`: leitura de ministério, dados próprios, repertório, escalas, cifras, exportação PDF;
  - `DELETE /ministries/:ministryId/members/:memberId`: remoção de membro para redução de quota;
  - `DELETE /repertoire/songs/:songId`: remoção de música para redução de quota;
  - `DELETE /ministries/:ministryId`: encerramento do ministério pelo proprietário;
  - `DELETE /repertoire/folders/:id`, `DELETE /teams/:id`: exclusões organizacionais permitidas para admin.
- Bloqueados com `403 FORBIDDEN_OVER_LIMIT`:
  - `POST /schedules`: criação de novas escalas (continuidade operacional);
  - `POST /repertoire/songs`: criação de músicas;
  - `POST /ministries/:ministryId/members`, `POST /ministries/:ministryId/invites`, `POST /ministries/join`: entrada de membros;
  - `POST /teams`, `POST /templates`, `POST /liturgies`: criação de novos recursos operacionais.

---

## 4. Catálogo Oficial e Quotas Comerciais Confirmadas

Catálogo centralizado em `backend/src/config/plans.config.ts`:

| Plano | `plan_id` | Nome Exibição | Membros Base | Músicas Base | Suporta Add-on de Membros | Máximo de Blocos | Teto Máximo de Membros |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Free** | `free` | Free | 10 | 50 | Não | 0 | 10 |
| **Lite** | `lite` | Lite | 20 | 100 | Não | 0 | 20 |
| **Lite+** | `lite_plus` | Lite+ | 30 | 150 | Não | 0 | 30 |
| **Essential**| `essential` | Essential | 40 | 200 | Sim (+10/bloco) | 4 | 80 (40 + 4×10) |
| **Pro** | `pro` | Pro | 100 | 500 | Sim (+10/bloco) | 10 | 200 (100 + 10×10) |
| **Premium** | `premium` | Premium | `unlimited` | `unlimited` | Não | 0 | `unlimited` |

- `MEMBER_ADDON_BLOCK_SIZE = 10`
- `DEFAULT_GRACE_PERIOD_DAYS = 7`
- `DEFAULT_PLAN_ID: PlanId = 'free'`

---

## 5. Modelos de Dados no Firestore

### 5.1. Coleção `ministry_subscriptions/{ministryId}`

```typescript
export type PlanId = 'free' | 'lite' | 'lite_plus' | 'essential' | 'pro' | 'premium';
export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled';
export type AccessMode = 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
export type QuotaLimit = number | 'unlimited';

export interface MinistrySubscriptionRecord {
  id: string; // ministry_id
  ministry_id: string;
  plan_id: PlanId;
  member_addon_blocks: number;
  billing_status: BillingStatus;
  administratively_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  grace_period_expires_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}
```

### 5.2. Coleção `ministry_usage/{ministryId}`

```typescript
export interface MinistryUsageRecord {
  id: string; // ministry_id
  ministry_id: string;
  members_count: number;
  songs_count: number;
  created_at: string;
  updated_at: string;
}
```

---

## 6. Algoritmo de Resolução de Estado e State Machine

### 6.1. Algoritmo Funcional Puro

```typescript
export function getEffectiveMemberQuota(plan: PlanDefinition, addonBlocks: number): QuotaLimit {
  if (plan.baseMembers === 'unlimited') return 'unlimited';
  const validBlocks = Math.min(Math.max(0, addonBlocks), plan.maxMemberAddonBlocks);
  return plan.baseMembers + (validBlocks * MEMBER_ADDON_BLOCK_SIZE);
}

export function isUsageOverLimit(usage: MinistryUsageRecord, quotas: EffectiveQuotas): boolean {
  const membersOver = quotas.members !== 'unlimited' && usage.members_count > quotas.members;
  const songsOver = quotas.songs !== 'unlimited' && usage.songs_count > quotas.songs;
  return membersOver || songsOver;
}

export function resolveAccessMode(
  subscription: MinistrySubscriptionRecord,
  plan: PlanDefinition,
  usage: MinistryUsageRecord,
  now: Date = new Date()
): { accessMode: AccessMode; isOverLimit: boolean; graceDaysRemaining: number | null } {
  // 1. Suspensão administrativa tem prioridade máxima
  if (subscription.administratively_suspended) {
    return { accessMode: 'suspended', isOverLimit: true, graceDaysRemaining: null };
  }

  const effectiveQuotas: EffectiveQuotas = {
    members: getEffectiveMemberQuota(plan, subscription.member_addon_blocks),
    songs: plan.baseSongs,
  };

  const overLimit = isUsageOverLimit(usage, effectiveQuotas);

  // 2. Se o uso está dentro das quotas, o acesso é normal
  if (!overLimit) {
    return { accessMode: 'normal', isOverLimit: false, graceDaysRemaining: null };
  }

  // 3. Está acima da quota: avaliar existência e validade do grace period registrado
  if (subscription.grace_period_expires_at) {
    const expiresAt = new Date(subscription.grace_period_expires_at);
    if (now <= expiresAt) {
      const diffMs = expiresAt.getTime() - now.getTime();
      const graceDaysRemaining = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      return { accessMode: 'grace', isOverLimit: true, graceDaysRemaining };
    }
  }

  // 4. Fail-safe: Se está acima da quota e não há carência ativa válida, entra em restricted_over_limit
  return { accessMode: 'restricted_over_limit', isOverLimit: true, graceDaysRemaining: 0 };
}
```

---

## 7. Endpoints da API REST

1. **`GET /api/v1/plans`** *(Público/Autenticado)*:
   - Retorna o catálogo oficial dos 6 planos com quotas base, tetos de add-ons e metadados de exibição.
2. **`GET /api/v1/ministries/:ministryId/subscription`** *(Admin/Member do ministério)*:
   - Retorna o resumo completo resolvido para o ministério:
     - `plan`: dados do plano atual;
     - `quotas`: quotas base e efetivas;
     - `usage`: contagem materializada atual (`members_count`, `songs_count`);
     - `memberAddonBlocks`: blocos adicionais contratados;
     - `billingStatus`: situação financeira (`active`, `past_due`, `canceled`, `trialing`);
     - `accessMode`: modo de operação resolvido (`normal`, `grace`, `restricted_over_limit`, `suspended`);
     - `isOverLimit`: boolean de conformidade;
     - `graceDaysRemaining`: dias restantes se em carência.

---

## 8. Mapeamento de Arquivos Implementados

### Backend
- `[NEW]` [backend/src/config/plans.config.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/config/plans.config.ts): Catálogo oficial de planos e parâmetros.
- `[NEW]` [backend/src/features/subscriptions/subscription.types.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/subscriptions/subscription.types.ts): Tipos TypeScript e schemas Zod.
- `[NEW]` [backend/src/features/subscriptions/subscription.service.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/subscriptions/subscription.service.ts): Lógica pura de quotas, resolução de `access_mode` e reconciliação.
- `[NEW]` [backend/src/features/subscriptions/subscription.controller.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/subscriptions/subscription.controller.ts): Handlers REST.
- `[NEW]` [backend/src/features/subscriptions/subscription.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/subscriptions/subscription.routes.ts): Rotas `/api/v1/plans` e `/api/v1/ministries/:id/subscription`.
- `[NEW]` [backend/src/repositories/SubscriptionRepository.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/repositories/SubscriptionRepository.ts): Acesso transacional às coleções `ministry_subscriptions` e `ministry_usage`.
- `[NEW]` [backend/src/middleware/quota-enforcement.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/middleware/quota-enforcement.ts): Middlewares `enforceOperationalAccess`, `enforceMemberQuota` e `enforceSongQuota`.
- `[NEW]` [backend/vitest.config.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/vitest.config.ts) & `backend/src/features/subscriptions/subscription.service.test.ts`: Testes unitários do motor de assinaturas.
- `[MODIFY]` [backend/package.json](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/package.json): Adição de Vitest e script `npm test`.
- `[MODIFY]` [backend/src/app.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/app.ts): Montagem das rotas de planos e assinaturas.
- `[MODIFY]` [backend/src/repositories/MinistryRepository.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/repositories/MinistryRepository.ts): Inicialização de `ministry_usage` e transações atômicas de membros.
- `[MODIFY]` [backend/src/repositories/RepertoireRepository.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/repositories/RepertoireRepository.ts): Transações atômicas de músicas em `ministry_usage`.
- `[MODIFY]` [backend/src/features/ministries/ministry.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/ministries/ministry.routes.ts): Proteção transacional de quotas e substituição do middleware legado.
- `[MODIFY]` [backend/src/features/repertoire/repertoire.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/repertoire/repertoire.routes.ts): Proteção transacional de quotas e substituição do middleware legado.
- `[MODIFY]` [backend/src/features/schedules/schedule.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/schedules/schedule.routes.ts): Proteção de continuidade operacional em modo restrito.
- `[MODIFY]` [backend/src/features/liturgies/liturgy.routes.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/backend/src/features/liturgies/liturgy.routes.ts): Substituição do middleware legado.

### Web SPA
- `[NEW]` [web/src/components/SubscriptionPlanView.tsx](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/components/SubscriptionPlanView.tsx): Sub-página `/ministerio/plano` completa com visualização de quotas, uso, add-ons e comparativo dos 6 planos.
- `[NEW]` [web/src/components/SubscriptionPlanView.test.tsx](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/components/SubscriptionPlanView.test.tsx): Testes unitários para SubscriptionPlanView (renderização, quotas, add-ons, ilimitado e retry).
- `[NEW]` [web/src/components/RestrictedBanner.tsx](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/components/RestrictedBanner.tsx): Banner informativo e de alerta para estados `grace`, `restricted_over_limit` e `suspended`.
- `[NEW]` [web/src/components/RestrictedBanner.test.tsx](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/components/RestrictedBanner.test.tsx): Testes unitários para RestrictedBanner.
- `[NEW]` [web/src/api.test.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/api.test.ts): Testes unitários para classe `ApiError`, `getFriendlyErrorMessage`, `getPlans` e `getMinistrySubscription`.
- `[MODIFY]` [web/src/types.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/types.ts): Tipos de planos, quotas e status de assinatura.
- `[MODIFY]` [web/src/api.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/api.ts): Métodos de chamada a `GET /plans` e `GET /ministries/:id/subscription`, `ApiError` e `getFriendlyErrorMessage`.
- `[MODIFY]` [web/src/App.tsx](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/App.tsx): Carregamento dinâmico de `subscriptionSummary`, renderização do `RestrictedBanner` e tratamento de bootstrap para ministérios suspensos.
- `[MODIFY]` [web/src/components/MinistryView.tsx](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/components/MinistryView.tsx): Seção e botão de acesso a `/ministerio/plano`.
- `[MODIFY]` [web/src/routing.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/src/routing.ts): Roteamento de deep link para `/ministerio/plano`.
- `[MODIFY]` [web/e2e/mock-api.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/e2e/mock-api.ts): Mocks de `/plans` e `/subscription` para suíte Playwright.
- `[MODIFY]` [web/e2e/mobile-audit.spec.ts](file:///c:/Users/henrique.hermogenes/Documents/p/praise/praise-app/web/e2e/mobile-audit.spec.ts): Teste E2E de auditoria responsiva sem overflow em `/ministerio/plano`.

---

## 9. Checklist de Implementação e Conclusão

- [x] **Etapa 1: Infraestrutura de Testes Backend** (Vitest no backend — 44 testes unitários).
- [x] **Etapa 2: Catálogo Oficial e Schemas de Tipos** (6 planos comerciais confirmados e Zod schemas).
- [x] **Etapa 3: Subscription Repository e Transações Atômicas de Usage** (Coleções `ministry_subscriptions` e `ministry_usage`).
- [x] **Etapa 4: Subscription Service e Resolução Funcional de Estado** (Resolução pura de accessMode, fail-safe e reconciliação).
- [x] **Etapa 5: Middlewares de Enforcement Granular** (`enforceOperationalAccess`, remediações explícitas, eliminação de `requireActiveSubscription`).
- [x] **Etapa 6: Controllers e Rotas REST da API** (`GET /plans` e `GET /ministries/:id/subscription`).
- [x] **Etapa 7: Adaptação no Frontend (Web SPA)** (`SubscriptionPlanView`, `RestrictedBanner`, `getFriendlyErrorMessage`, testes Vitest).
- [x] **Etapa 8: Auditoria Integrada e Validação** (Unit tests, Playwright E2E em 6 viewports, `git diff --check`).

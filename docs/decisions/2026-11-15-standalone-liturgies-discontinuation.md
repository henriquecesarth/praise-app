# ADR: Descontinuação do Módulo Independente de Liturgias e Preservação de Dados no Firestore

- **Data:** 2026-11-15
- **Status:** Aceito (Homologação R2)
- **Branch:** `fix/louvaio-audit-remediation-20261113`
- **Substitutos Canônicos:** `Escalas > Roteiro` (`/escalas`) e `Modelos de Roteiro` (`/schedule-templates`)

## Contexto

O produto possuía dois fluxos sobrepostos para ordenação de cultos:

1. O módulo independente **Liturgias & Ordem de Culto** (`/liturgias` na Web, telas `LiturgiesScreen` / `LiturgyDetailScreen` / `LiturgyFormScreen` no Mobile e endpoints `/api/v1/ministries/:ministryId/liturgies` + alias `/groups/:groupId/liturgies`).
2. O fluxo integrado de **Roteiro dentro de Escalas** (`schedule_timeline_items`) e **Modelos de Roteiro** (`schedule_templates`), já integrado às músicas escolhidas, versões escaladas e participantes do culto.

Para eliminar duplicidade de UX e consolidar o planejamento de cultos em `Escalas`, decidiu-se descontinuar o módulo independente de Liturgias sem destruir ou alterar os registros históricos armazenados no Firestore.

## Decisão

### 1. API Backend (`410 Gone`, Fail-Closed e Zero Exclusão)

- As rotas `/api/v1/ministries/:ministryId/liturgies` e `/api/v1/groups/:groupId/liturgies` permanecem montadas em `backend/src/app.ts` exclusivamente para responder HTTP `410 Gone` (`code: 'STANDALONE_LITURGY_MODULE_DISCONTINUED'`) após passar integralmente por:
  1. `authenticate` (`401 Unauthorized` para requisições anônimas ou tokens inválidos);
  2. `requireMinistryRole('member' | 'admin')` (`403`/`404` para usuários fora do ministério ou membros sem papel administrativo em mutações).
- Os handlers em `backend/src/features/liturgies/liturgy.controller.ts` não executam leituras, escritas ou exclusões em `liturgies` nem em `liturgy_items`.
- O fallback Express 5 (`router.use(...)` sem wildcard de path-to-regexp) garante resposta `410 Gone` também em subpaths ou verbos HTTP alternativos.

### 2. Web PWA (`/liturgias` -> `/escalas`)

- Removidos o item `Liturgias` da sidebar lateral (`web/src/App.tsx`), a entrada `Liturgias & Ordem de Culto` de `MinistryView` (`web/src/components/MinistryView.tsx`), o componente exclusivo `LiturgiesView` e os métodos cliente correspondentes de `web/src/api.ts`.
- Deep links legados (`/liturgias` e `/liturgias/*`) são resolvidos em `web/src/routing.ts` com `redirectTo: '/escalas'` e redirecionados automaticamente por `useEffect` com `{ replace: true }` em `web/src/App.tsx`.
- Mantidos intactos `Escalas`, `Roteiro`, `Modelos de Roteiro` e divulgações legais sobre dados históricos compartilhados em `PrivacyPolicyView.tsx` e `AccountDeletionView.tsx`.

### 3. Mobile Flutter (`mobile/`)

- Removidos o atalho `dashboard_liturgies_button` em `mobile/lib/features/dashboard/presentation/dashboard_view.dart`, o item `profile_liturgies_tile` em `mobile/lib/app/shell/app_shell.dart`, os exports/invalidações de `liturgy_*` em `mobile/lib/app/providers.dart` e a pasta exclusiva `mobile/lib/features/liturgies/`.
- Mantidos integralmente o editor e visualizador de `Roteiro` em `ScheduleFormScreen` e `ScheduleDetailView`.

## Plano de Preservação e Migração no Firestore

- **Zero exclusão destrutiva:** Nenhuma operação de `delete`, `drop` ou migração em massa é executada nas coleções Firestore `liturgies` e `liturgy_items`. Todos os documentos legados permanecem congelados e íntegros no banco de dados.
- **Conformidade LGPD preservada:** `AccountDeletionRepository.anonymizeHistoricalSharedContent` (`backend/src/repositories/AccountDeletionRepository.ts`) continua anonimizando `created_by` (`DELETED_USER`) em documentos legados da coleção `liturgies` quando um usuário exclui sua conta, sem expor autoria pessoal em dados históricos.
- **Preservação do módulo de repositório legado:** `LiturgyRepository` permanece somente em nível de repositório/auditoria para testes unitários de regressão histórica e segurança multi-tenant, sem exposição HTTP.
- **Eventual exportação/migração futura (opcional):** Caso seja necessário migrar liturgias antigas de algum tenant específico para modelos ou roteiros de escala, o schema persistido em `liturgies` (`id`, `group_id`/`ministry_id`, `title`, `date Greogrian YYYY-MM-DD`, `description`, `created_by`) e `liturgy_items` (`liturgy_id`, `song_id`, `type`, `title`, `notes`, `position`) mapeia 1:1 para os slots de `Roteiro` em `schedule_templates` ou `schedules`. Qualquer script futuro deverá rodar fora da rota HTTP, por ministério, de forma idempotente e sem apagar os originais antes da conferência.

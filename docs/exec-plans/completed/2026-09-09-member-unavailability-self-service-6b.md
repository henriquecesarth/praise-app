# ExecPlan: LouvAIO — Member Unavailability Self-Service Foundation (Phase 6B)

- **Status**: `COMPLETED`
- **Data de Início**: 2026-09-09
- **Data de Conclusão**: 2026-09-09
- **Fase**: `Phase 6B (Member Unavailability Self-Service Foundation)`
- **Escopo**: Implementação completa de ponta a ponta do CRUD self-service de indisponibilidade de membros no LouvAIO. Cobre persistência no Cloud Firestore (`member_unavailabilities`), API REST Express autoritativa, middleware RBAC, validação temporal de relógio civil (wall-clock sem UTC/Z), isolamento multi-tenant, proteção anti-IDOR, limite de 90 dias contínuos, paginação estável por cursor determinístico, índice Firestore declarado, cliente API frontend e interface do usuário responsiva e acessível com proteção contra race condition de troca de ministério.

---

## 1. Contexto e Objetivos

O LouvAIO gerencia escalas de ministérios de louvor. Atualmente, os membros são presumidos como disponíveis por padrão. Na Phase 6B, o membro autenticado ganha a capacidade self-service de cadastrar, editar, listar e remover seus próprios períodos de indisponibilidade (bloqueios).

### Decisões de Domínio Aprovadas:
1. **Disponibilidade padrão**: Integrantes são disponíveis por padrão; apenas bloqueios (indisponibilidades) são registrados.
2. **Escopo por Ministério**: Cada indisponibilidade é estritamente vinculada a um `ministry_id`. Um mesmo usuário Firebase pode ter agendas diferentes em ministérios distintos.
3. **Identidade Canônica**:
   - `user_id`: Firebase Auth UID do usuário autenticado.
   - `member_id`: Document ID em `ministry_members` para o ministério ativo.
   - O backend deriva ambas as identidades; o frontend nunca controla nem fornece identidades autoritativas no payload.
4. **Semântica Temporal Civil (Wall-Clock)**:
   - `starts_at` e `ends_at` usam o formato `YYYY-MM-DDTHH:mm:ss` (sem `Z`, sem conversão UTC de fuso).
   - Intervalos são semi-abertos: `[starts_at, ends_at)`.
   - Para "Dia Inteiro" (`all_day: true`), `ends_at` é normalizado para a meia-noite do dia seguinte ao `endDate` inclusivo.
5. **Limite Máximo Contínuo**: 90 dias por registro contínuo.
6. **Desacoplamento Estrito da Phase 6C**: Zero alterações em Schedule, zero endpoints de conflito, zero índices de conflito.

---

## 2. Pacotes de Trabalho (Work Packages)

- [x] **WP1: Normalização e Validação Temporal Civil (`availability-time.ts`)**
  - Implementar validação calendárica real (dias no mês, anos bissextos, formatos `YYYY-MM-DD` e `HH:mm`).
  - Normalizar intervalos semi-abertos `[starts_at, ends_at)`.
  - Validar regra `ends_at > starts_at` e cap de 90 dias contínuos.
  - Suíte de testes unitários cobrindo todos os casos de borda e rejeição de timestamps com `Z` (`availability-time.test.ts`: 19/19 passing).

- [x] **WP2: Persistência e Repositório (`AvailabilityRepository.ts`)**
  - Coleção Firestore `member_unavailabilities`.
  - Operações: `create`, `getById`, `listByMember`, `update`, `delete`.
  - Paginação por cursor estável determinístico (`starts_at DESC`, `__name__ DESC`).
  - Declarar composite index em `backend/firestore.indexes.json`.

- [x] **WP3: Domínio, Serviço e Anti-IDOR (`availability.service.ts` e types)**
  - Resolução segura de membership (`ministry_members.user_id == req.user.id`).
  - Validação completa no create e no merge de patch.
  - Proteção cumulativa anti-IDOR: `record.ministry_id === tenant && record.user_id === caller && record.member_id === callerMemberId`.
  - Rejeição fail-closed com 404 indistinguível para não vazar existência.

- [x] **WP4: Controller, Rotas e Montagem Express (`availability.controller.ts`, `availability.routes.ts`, `app.ts`)**
  - Rotas canônicas: `GET`, `POST`, `PATCH`, `DELETE` sob `/api/v1/ministries/:ministryId/availability/my`.
  - Alias `/groups/:groupId/availability/my`.
  - Integração com `authenticate` e `requireMinistryRole('member')`.

- [x] **WP5: Cliente API e Tipagem Frontend (`web/src/types.ts`, `web/src/api.ts`)**
  - Tipos `MemberUnavailability`, payloads de criação/edição e resposta paginada.
  - Métodos `getMyUnavailabilities`, `createMyUnavailability`, `updateMyUnavailability`, `deleteMyUnavailability`.

- [x] **WP6: Interface do Usuário e Navegação (`MemberAvailabilityView.tsx`, `MinistryView.tsx`, `routing.ts`)**
  - Visualização "Minha Disponibilidade" com estados: loading, error com retry, empty state e listagem.
  - Modais acessíveis para cadastro/edição (inputs de data/hora, toggle dia inteiro, motivo opcional) e confirmação de exclusão.
  - Touch targets >= 44px; responsividade sem `overflow-x: hidden` global.
  - Proteção contra race condition na troca de ministério (cleanup/cancellation pattern).
  - Ponto de entrada na navegação de `MinistryView`.

- [x] **WP7: Testes Automatizados e Validação Final**
  - Testes de backend: temporal helper, service, controller, anti-IDOR, tenancy, paginação, patch merge (`availability.feature.test.ts`: 28/28 passing).
  - Testes de frontend: renderização de estados, criação, edição, exclusão, troca de ministério (`MemberAvailabilityView.test.tsx`: 12/12 passing).
  - Backend test suite completa: 40 test files passed, 1480 tests passed.
  - Web test suite completa: 16 test files passed, 196 tests passed.
  - Builds TypeScript: `npm --prefix backend run build` (tsc clean) e `npm --prefix web run build` (tsc && vite build clean).
  - Verificação de diff e integridade do repositório: `git diff --check` clean.

---

## 3. Validação e Resultados

- **Backend Availability Tests**: 47/47 passing (19 time helper + 28 feature/service/controller/anti-IDOR tests).
- **Backend Full Suite**: 40/40 test files passed, 1480/1480 tests passed.
- **Web Component Tests**: 12/12 passing (`MemberAvailabilityView.test.tsx`).
- **Web Full Suite**: 16/16 test files passed, 196/196 tests passed.
- **Backend Build**: `npm --prefix backend run build` (exit code 0).
- **Web Build**: `npm --prefix web run build` (exit code 0, 1547 modules transformed, dist generated).
- **Firestore Indexes**: Definido composite index em `backend/firestore.indexes.json` (`member_unavailabilities`: `ministry_id` ASC, `member_id` ASC, `starts_at` DESC, `__name__` DESC).
- **Deployment Status**: DEPLOYMENT_REQUIRED = YES (declarado localmente; sem push e sem deploy automático).

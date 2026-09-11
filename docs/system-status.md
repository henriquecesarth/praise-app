# System Status and Evidence Matrix

Snapshot do estado operacional e técnico do LouvAIO. Este documento separa fatos de lacunas e não autoriza correções incidentais.

## Classification Rules

- **Confirmed behavior**: fluxo diretamente sustentado pelo código/configuração atual.
- **Confirmed inconsistency**: dois trechos ativos possuem contratos, identificadores ou expectativas incompatíveis.
- **Incomplete implementation**: código ou configuração existe, mas não completa o fluxo declarado.
- **Outdated documentation**: afirmação documental contradita pelo checkout.
- **Unknown / Not yet verified**: não há evidência local suficiente.

## Confirmed Behavior

| Area | Behavior | Evidence |
| --- | --- | --- |
| Runtime | Há dois pacotes npm independentes: backend e web. | backend/package.json, web/package.json |
| Frontend | React Router sincroniza módulos, detalhes de músicas/pastas/escalas e subseções do ministério com URLs estáveis. | web/src/main.tsx, web/src/App.tsx, web/src/routing.ts |
| Plans & Quotas | Sistema de planos e quotas por ministério (Free, Lite, Lite+, Essential, Pro, Premium), com resolução funcional de accessMode (normal, grace, restricted_over_limit, suspended), coleções transacionais `ministry_subscriptions` e `ministry_usage`, middlewares `enforceOperationalAccess` e interface em `/ministerio/plano`. | backend/src/config/plans.config.ts, backend/src/features/subscriptions/, backend/src/middleware/quota-enforcement.ts, web/src/components/SubscriptionPlanView.tsx |
| Billing & Payments | Integração com Asaas implementada no backend (`AsaasBillingProvider`, `BillingService`, `BillingReconcilerWorker`) e frontend (`SubscriptionPlanView`), com suporte a checkouts hospedados v3, webhooks idempotentes, amount validation, transições isoladas em `billing_plan_changes` e future payment cleanup. | backend/src/features/billing/, backend/src/repositories/BillingRepository.ts, web/src/components/SubscriptionPlanView.tsx |
| Backend testing | O backend possui suíte de testes com Vitest cobrindo o motor de quotas, services, controllers, concorrência, idempotência e repositórios. | backend/vitest.config.ts, backend/src/**/*.test.ts |
| Mobile navigation | A barra inferior oferece Início, Escalas, Repertório, Cifras e Ministério; o header expõe troca/criação/entrada no ministério e logout. | BottomNav.tsx, MobileAccountMenu.tsx |
| Authentication bootstrap | Chamadas autenticadas iniciais aguardam authReady e token local válido. | web/src/auth-bootstrap.ts, web/src/App.tsx |
| PWA | Vite gera service worker versionado com precache apenas de shell/assets estáticos; navegações usam NetworkOnly com fallback offline genérico e não são armazenadas. Atualizações dependem de confirmação; não há runtime cache de API. | web/vite.config.ts, web/src/pwa.ts, web/public/offline.html |
| Web testing | Vitest/Testing Library cobrem helpers/componentes e Playwright cobre jornadas móveis com API mockada em seis combinações de viewport/tema. | web/vitest.config.ts, web/src/**/*.test.*, web/playwright.config.ts, web/e2e/ |
| API | Express aplica CORS e JSON globalmente, expõe health/diag e monta rotas em /api/v1. | backend/src/app.ts |
| Authentication | Signup cria usuário em Firebase Auth e perfil users; login emite JWT próprio com duração de sete dias. | AuthService, UserRepository |
| Session | O frontend guarda o JWT na chave localStorage praise_auth_token e o envia como Bearer. | web/src/api.ts |
| Tenancy & IDOR Protection | Repositórios e rotas aplicam isolamento multitenant estrito por ministry_id/group_id, com validação de ownership em todas as operações por ID (repertório, escalas, pastas, artistas, classificações, liturgias). | RepertoireRepository, ScheduleRepository, LiturgyRepository, rbac.ts |
| Smart Chords Security | Rotas de cifras inteligentes exigem autenticação obrigatória e filtram/validam estritamente por user_id. | smart_chord.routes.ts, smart_chord.controller.ts, SmartChordRepository.ts |
| Authentication & Tokens | Login exige verificação criptográfica estrita via Identity Toolkit (sem bypass). Tokens suportam validação dual assíncrona (JWT + Firebase ID Token). | UserRepository.ts, auth.ts |
| Diagnostic Sanitization | /api/diag é sanitizado em produção para não expor Project ID ou identificadores internos. Headers de segurança HTTP e CORS configurável ativos. | backend/src/app.ts |
| Member Unavailability Self-Service | Gestão de indisponibilidade self-service (Phase 6B) com persistência Firestore (`member_unavailabilities`), derivação autoritativa de identidade (`user_id`/`member_id`), modelo civil wall-clock sem Z [starts_at, ends_at), anti-IDOR fail-closed (404), RBAC (member), paginação estável por cursor e UI responsiva. | backend/src/features/availability/, backend/src/repositories/AvailabilityRepository.ts, web/src/components/MemberAvailabilityView.tsx |
| Schedule Availability Conflicts | Detecção de conflitos entre escalas e indisponibilidades (Phase 6C) com duração de escala (15..1440 min, default 120 min), motor puro civil [starts_at, ends_at), busca de candidatos Firestore paginada com lookback de 90 dias, normalização de IDs de participantes, endpoint POST /api/v1/ministries/:ministryId/availability/check-conflicts (admin), omissão estrita de reason, avisos informativos não-bloqueantes e proteção de concorrência com token de geração na UI. | backend/src/features/availability/, backend/src/features/schedules/, backend/src/repositories/AvailabilityRepository.ts, web/src/components/CreateScheduleModal.tsx |
| Administrative Consolidated Availability | Visualização consolidada administrativa de indisponibilidade de integrantes (Phase 6D-1) com escopo restrito de leitura (admin-only), validação rigorosa de período civil até 90 dias, lookback de 90 dias, varredura contínua contra páginas falsamente vazias pós-filtro residual de overlap, limite de segurança de 1000 candidatos (`AVAILABILITY_QUERY_TOO_LARGE`), enriquecimento em lote de nomes dos integrantes sem vazamento cross-tenant, omissão absoluta do motivo (`reason`), cliente web centralizado em `api.ts` e componente responsivo `AdminAvailabilityView.tsx` com presets temporais e imunidade a race conditions. | backend/src/features/availability/, backend/src/repositories/AvailabilityRepository.ts, web/src/components/AdminAvailabilityView.tsx, web/src/components/MinistryView.tsx |
| Manual Member Availability Management | Gestão administrativa delegada de indisponibilidade para integrantes manuais (Phase 6D-2) exclusivamente para membros com `is_manual === true` e `user_id == null`. Separação estrita de Actor (`req.user.id`) e Subject (`member_id`), persistência de `user_id: null`, `management_source: 'admin_manual'`, metadados de auditoria (`created_by_user_id`, `updated_by_user_id`), bloqueio anti-takeover para membros autenticados (`403 AUTHENTICATED_MEMBER_MUTATION_PROHIBITED`), rotas REST canônicas `/members/:memberId` (admin-only), motivo (`reason`) preservado no contexto manual operacional e omitido estritamente em conflitos (6C) e consolidação (6D-1), componente acessível `ManualMemberAvailabilityModal.tsx` integrado ao menu de membros em `MinistryView.tsx` e reuso integral dos índices existentes. | backend/src/features/availability/, backend/src/repositories/AvailabilityRepository.ts, web/src/components/ManualMemberAvailabilityModal.tsx, web/src/components/MinistryView.tsx |
| Organization Foundation & WhatsApp Entitlements | Fundação de Organizações e capacidade comercial WhatsApp (Phase 7B). Agregado `organizations`, governança `organization_members` (owner/admin), vínculo estrito multi-ministério com invariante `organization_id === null`, provisionamento transacional restrito ao proprietário do ministério (`ministry.owner_user_id`), proteção anti-IDOR fail-closed (404), bloqueio de desassociação do ministério âncora (`400 CANNOT_DETACH_BILLING_ANCHOR`) e cálculo de capacidade comercial WhatsApp derivado do catálogo de planos declarativo (Free=0, Pagos=1). | backend/src/features/organizations/, backend/src/repositories/OrganizationRepository.ts, backend/src/features/subscriptions/subscription.service.ts, organization.feature.test.ts |
| WhatsApp Connection Domain & Secret Encryption | Domínio de conexões WhatsApp (Phase 7C). Persistência Firestore (`whatsapp_connections`, `whatsapp_connection_secrets`, `whatsapp_provider_identity_claims`), máquina de estados estrita com matriz 6x6, criptografia AES-256-GCM com AAD vinculada `${orgId}:${connectionId}`, fail-closed para chave inválida/ausente, claims de identidade com lock transacional anti-colisão, gerenciamento de default da organização e atribuição exclusiva de ministério com gating de conexão ativa (DEC-7C-15), preservação de configuração em transitórios, desconexão terminal atômica com purge de segredo e claim, composição de capacidade comercial e restrição over-limit funcional sem side-effects no banco, paginação por cursor lookahead estável (`pageSize + 1`), rotas REST `/organizations/:organizationId/whatsapp/connections` e `/ministries/:ministryId/whatsapp/status`, omissão absoluta de credenciais/segredos e índices declarados em `firestore.indexes.json`. | backend/src/features/whatsapp/, backend/src/repositories/WhatsAppConnection*, whatsapp.feature.test.ts, firestore.indexes.json |

## Confirmed Inconsistencies

| ID | Area | Inconsistency and impact | Evidence |
| --- | --- | --- | --- |
| INC-001 | Route aliases | O diretório features/groups implementa GroupRepository e group routes, mas app.ts não monta groupRoutes. /api/v1/groups monta ministryRoutes, portanto o módulo groups dedicado fica inalcançável e o alias usa coleções ministry_*. | backend/src/app.ts, features/groups/, MinistryRepository.ts |
| INC-005 | Smart Chords endpoints | RESOLVIDO (Fase 5B): Rotas canônicas unificadas em /api/v1/smart-chords, GET /song/:songId com precedência estrita sobre /:id, eliminação de endpoints fabricados (/smart-chords/song/:songId para mutação) e alinhamento de contratos. | web/src/api.ts, smart_chord.routes.ts, smart_chord.controller.ts |

INC-002 e INC-003 foram corrigidos na implementação do sistema de planos. INC-004, INC-006, INC-007, INC-008, INC-009, INC-010, INC-011 e INC-012 foram integralmente resolvidos na fase de Authentication & Authorization Security Hardening (2026-08-29). GAP-011 (Asaas Customer Reuse) foi integralmente implementado, protegido contra concorrência e revalidado com sucesso em Sandbox (2026-09-01). GAP-004 (Liturgies navigation) foi resolvido na Fase 5A (2026-09-09), expondo LiturgiesView via rota canônica /liturgias, sidebar desktop e Ministério no mobile. INC-005 (Smart Chords endpoints) e GAP-003 (Smart Chords persistence & list) foram resolvidos na Fase 5B (2026-09-09), integrando frontend ao backend real com isolamento estrito por usuário, anti-IDOR e validação de vínculo com repertório. GAP-005 (Dashboard announcements) foi resolvido na Fase 5C (2026-09-09), substituindo mocks locais por persistência Firestore multi-tenant, RBAC (membro leitura, admin CRUD), anti-IDOR fail-closed e UX responsiva.

## Incomplete Implementation / Known Gaps

| ID | Area | Current state | Evidence |
| --- | --- | --- | --- |
| GAP-002 | Lint | Backend declara eslint src/, mas não possui ESLint em dependencies/devDependencies nem arquivo de configuração. Web não declara lint. | backend/package.json, inventário |
| GAP-003 | Smart Chords list | RESOLVIDO (Fase 5B): api.getSmartChords integrado a GET /api/v1/smart-chords com persistência real Firestore, isolamento por user_id, mapeamento de campos e correção de colisão empty/error. | web/src/api.ts, SmartChordRepository.ts, SmartChordsWorkspace.tsx |
| GAP-004 | Liturgies navigation | RESOLVIDO (Fase 5A): LiturgiesView exposto na rota /liturgias, sidebar desktop e card Ministério no mobile; RBAC e isolamento de tenant preservados. | App.tsx, LiturgiesView.tsx, routing.ts |
| GAP-005 | Dashboard announcements | RESOLVIDO (Fase 5C): MOCK_ANNOUNCEMENTS substituído por persistência Firestore (`ministry_announcements`), rota canônica `/api/v1/ministries/:ministryId/announcements`, RBAC estrito (membro read-only, admin CRUD), anti-IDOR fail-closed, queries ordenadas/limitadas e modais acessíveis. | DashboardView.tsx, announcement.routes.ts, AnnouncementRepository.ts |
| GAP-006 | Supabase migration residue | @supabase/supabase-js permanece como dependência; env.ts expõe campos vazios e lib/supabase.ts retorna null. | backend/package.json, config/env.ts, lib/supabase.ts |
| GAP-008 | Infrastructure | Não há CI/CD, Docker, migrations ou schema Firestore versionado. | inventário |
| GAP-009 | Formatting | Não há formatter ou script format configurado. | package.json, inventário |
| GAP-010 | Dependency advisories | A instalação das dependências web reportou vulnerabilidades em dependências indiretas. | saída de npm install; Unknown / Not yet verified |
| GAP-012 | Same-Plan Interval Change & Transition Policy | Reconhecimento de ciclo e UI validados em Sandbox; execução financeira requer reengenharia para agendamento em `current_period_end` sem sobreposição de cobranças integrais conforme Política V1 (ADR 2026-09-01; APPROVED DOMAIN POLICY — IMPLEMENTATION PENDING). | `SubscriptionPlanView.tsx`, `BillingService.ts` |

## Outdated Documentation

| Previous claim | Current evidence |
| --- | --- |
| O produto atual inclui mobile/ Flutter. | Não existe diretório mobile/ no checkout. |
| A persistência ativa é Supabase/PostgreSQL. | Repositories importam Firestore; lib/supabase.ts está marcado deprecated e retorna null. |
| Existem migrations SQL sob supabase/migrations/. | Não existe diretório supabase/. |
| O repositório contém somente backend/mobile. | O cliente ativo está em web/ com React/Vite/PWA. |
| O backend não tem testes. | Backend possui suíte de testes Vitest em `backend/src/`. |
| Não há provedor de pagamento ou worker de background. | Integração Asaas e `BillingReconcilerWorker` implementados. |

README.md, AGENTS.md e GEMINI.md foram alinhados para não perpetuar essas afirmações.

## Unknown / Not yet verified

- Produção ativa, URLs publicadas e saúde dos deployments.
- Regras de segurança, índices, TTLs, backups e políticas de retenção do Firestore.
- Existência/estado das coleções em qualquer projeto Firebase real de produção.
- Metas de disponibilidade, tráfego, volume de dados ou desempenho.
- Responsável operacional, processo de release e estratégia de rollback.
- Versão mínima oficialmente suportada de Node.js e npm.
- Concorrência de transações sob Firestore Emulator: NOT YET VERIFIED (atomicidade e isolamento validados em testes unitários com mocks via Vitest; emulador físico do Firestore indisponível no host).
- Integração Asaas: A integração foi implementada com os fluxos principais homologados em ambiente Sandbox do Asaas (GAP-011 revalidado; Política V1 de transições agendadas aprovada com implementação pendente). Configurações, credenciais e deploy de produção não devem ser presumidos.

## Use in Future Work

Ao tocar uma área listada:

1. confirme novamente a evidência, pois o código pode ter mudado;
2. crie um ExecPlan para correções não triviais;
3. trate segurança/autorização como mudança de contrato;
4. adicione testes deliberadamente como parte do escopo da correção;
5. mova o item para comportamento confirmado somente depois de validar a solução.

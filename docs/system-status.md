# System Status and Evidence Matrix

Snapshot baseado no checkout de 2026-08-27. Este documento separa fatos de lacunas e não autoriza correções incidentais.

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
| Backend testing | O backend possui suíte de testes com Vitest cobrindo o motor de quotas, services, controllers e isolamento transacional (44 testes). | backend/vitest.config.ts, backend/src/**/*.test.ts |
| Mobile navigation | A barra inferior oferece Início, Escalas, Repertório, Cifras e Ministério; o header expõe troca/criação/entrada no ministério e logout. | BottomNav.tsx, MobileAccountMenu.tsx |
| Authentication bootstrap | Chamadas autenticadas iniciais aguardam authReady e token local válido. | web/src/auth-bootstrap.ts, web/src/App.tsx |
| PWA | Vite gera service worker versionado com precache apenas de shell/assets estáticos; navegações usam NetworkOnly com fallback offline genérico e não são armazenadas. Atualizações dependem de confirmação; não há runtime cache de API. | web/vite.config.ts, web/src/pwa.ts, web/public/offline.html |
| Web testing | Vitest/Testing Library cobrem helpers/componentes e Playwright cobre jornadas móveis com API mockada em seis combinações de viewport/tema. | web/vitest.config.ts, web/src/**/*.test.*, web/playwright.config.ts, web/e2e/ |
| API | Express aplica CORS e JSON globalmente, expõe health/diag e monta rotas em /api/v1. | backend/src/app.ts |
| Authentication | Signup cria usuário em Firebase Auth e perfil users; login emite JWT próprio com duração de sete dias. | AuthService, UserRepository |
| Session | O frontend guarda o JWT na chave localStorage praise_auth_token e o envia como Bearer. | web/src/api.ts |
| Tenancy | Ministry é a fronteira principal usada pela UI e pelas rotas, com isolamento estrito de membership verificado contra acesso indevido. | ministries feature, rbac.ts, quota-enforcement.ts |
| Persistence | Repositories leem/escrevem diretamente no Cloud Firestore. | backend/src/repositories/, lib/firebase.ts |
| Validation | Várias entradas HTTP passam por schemas Zod. | feature.types.ts, middleware/validate.ts |
| Errors | AppError representa erros esperados; o middleware global devolve error.message/details. | middleware/error-handler.ts |
| Observability | Logs são console.log/warn/error. Não há ferramenta estruturada de observabilidade. | backend/src/ |
| Deployment config | web e backend possuem manifests Vercel separados. | web/vercel.json, backend/vercel.json |

## Confirmed Inconsistencies

| ID | Area | Inconsistency and impact | Evidence |
| --- | --- | --- | --- |
| INC-001 | Route aliases | O diretório features/groups implementa GroupRepository e group routes, mas app.ts não monta groupRoutes. /api/v1/groups monta ministryRoutes, portanto o módulo groups dedicado fica inalcançável e o alias usa coleções ministry_*. | backend/src/app.ts, features/groups/, MinistryRepository.ts |
| INC-004 | Password login | Quando FIREBASE_WEB_API_KEY não existe, verifyPassword busca o usuário via Admin SDK, mas não verifica a senha recebida. | UserRepository.verifyPassword |
| INC-005 | Smart Chords endpoints | O frontend usa /smart-chords/song/:songId; o backend expõe somente /smart-chords e /smart-chords/:id. | web/src/api.ts, smart_chord.routes.ts |
| INC-006 | Smart Chords access | As rotas backend de cifras não aplicam authenticate; controllers usam anonymous e o repository lista todos os documentos sem filtrar userId. | smart_chord.routes.ts, smart_chord.controller.ts, SmartChordRepository.ts |
| INC-007 | Liturgy update | LiturgyService.updateLiturgy ignora liturgyId e chama createLiturgy, criando um novo documento em vez de atualizar. | liturgy.service.ts |
| INC-008 | Liturgy item payload | O frontend envia song_id, o schema Zod aceita songId e o valor desconhecido é removido antes do repository; a referência à música pode chegar nula. | web/src/api.ts, liturgy.types.ts, LiturgyRepository.ts |
| INC-009 | Tenant scoping | Várias operações de repertório recebem ministryId na camada service, mas buscam/alteram/excluem apenas pelo ID do recurso sem confirmar ministry_id. | RepertoireService, RepertoireRepository |
| INC-010 | Schedule membership | A confirmação de escala procura membership em group_members, enquanto os fluxos ativos de ministry usam ministry_members. Se não encontrar o participante, o código pode confirmar o primeiro participante elegível como fallback. | ScheduleRepository.updateParticipantConfirmation |
| INC-012 | Diagnostic exposure | /api/diag é público e retorna identificadores/configuração operacional como Firebase project ID e default ministry ID. | backend/src/app.ts |

INC-002 e INC-003 foram corrigidos na implementação do sistema de planos (isolamento de tenant rigoroso em `MinistryRepository.getMinistryById` e substituição de `requireActiveSubscription` por `enforceOperationalAccess`). INC-011 foi resolvido em etapa anterior.

## Incomplete Implementation

| ID | Area | Current state | Evidence |
| --- | --- | --- | --- |
| GAP-002 | Lint | Backend declara eslint src/, mas não possui ESLint em dependencies/devDependencies nem arquivo de configuração. Web não declara lint. | backend/package.json, inventário |
| GAP-003 | Smart Chords list | api.getSmartChords retorna sempre um array vazio e não chama o endpoint backend. | web/src/api.ts |
| GAP-004 | Liturgies navigation | LiturgiesView existe e chama a API, mas App.tsx apenas o importa; não há renderização/rota ativa desse componente. | App.tsx, LiturgiesView.tsx |
| GAP-005 | Dashboard announcements | Avisos exibidos no dashboard vêm de MOCK_ANNOUNCEMENTS local, sem persistência/API. | DashboardView.tsx |
| GAP-006 | Supabase migration residue | @supabase/supabase-js permanece como dependência; env.ts expõe campos vazios e lib/supabase.ts retorna null. | backend/package.json, config/env.ts, lib/supabase.ts |
| GAP-007 | Environment onboarding | Arquivos .env locais existem e são ignorados, mas não há .env.example versionado. | .gitignore, inventário |
| GAP-008 | Infrastructure | Não há CI/CD, Docker, migrations ou schema Firestore versionado. | inventário |
| GAP-009 | Formatting | Não há formatter ou script format configurado. | package.json, inventário |
| GAP-010 | Dependency advisories | A instalação das dependências web reportou 3 vulnerabilidades moderadas e 6 altas. A aplicabilidade dos advisories e uma estratégia de atualização compatível não foram auditadas nesta tarefa. | saída de npm install; Unknown / Not yet verified |

## Outdated Documentation

| Previous claim | Current evidence |
| --- | --- |
| O produto atual inclui mobile/ Flutter. | Não existe diretório mobile/ no checkout. |
| A persistência ativa é Supabase/PostgreSQL. | Repositories importam Firestore; lib/supabase.ts está marcado deprecated e retorna null. |
| Existem migrations SQL sob supabase/migrations/. | Não existe diretório supabase/. |
| O repositório contém somente backend/mobile. | O cliente ativo está em web/ com React/Vite/PWA. |
| Alguns módulos estavam apenas planejados. | Escalas, dashboard e outras telas existem, embora tenham lacunas específicas acima. |

README.md e GEMINI.md foram atualizados para não perpetuar essas afirmações.

## Unknown / Not yet verified

- Produção ativa, URLs publicadas e saúde dos deployments.
- Regras de segurança, índices, TTLs, backups e políticas de retenção do Firestore.
- Existência/estado das coleções em qualquer projeto Firebase real.
- Metas de disponibilidade, tráfego, volume de dados ou desempenho.
- Responsável operacional, processo de release e estratégia de rollback.
- Versão mínima oficialmente suportada de Node.js e npm.
- Concorrência de transações sob Firestore Emulator: NOT YET VERIFIED (atomicidade e isolamento validados em testes unitários com mocks via Vitest; emulador físico do Firestore indisponível no host).
- Funcionamento E2E com credenciais reais; não foi realizado para evitar uso de serviços externos/dados.
- Gateway de pagamento e cobrança real (Stripe/Asaas): não implementado nesta fase (gestão de planos e cotas opera funcionalmente no backend/frontend sem cobrança financeira ativa).

## Use in Future Work

Ao tocar uma área listada:

1. confirme novamente a evidência, pois o código pode ter mudado;
2. crie um ExecPlan para correções não triviais;
3. trate segurança/autorização como mudança de contrato;
4. adicione testes deliberadamente como parte do escopo da correção;
5. mova o item para comportamento confirmado somente depois de validar a solução.

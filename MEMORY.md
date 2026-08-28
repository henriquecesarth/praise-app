# Project Memory

## Project Identity

- Nome: LouvAIO (anteriormente Praise App).
- Propósito: gestão web e PWA de ministérios de louvor, seus integrantes, repertório, escalas, cifras inteligentes e rotinas associadas.
- Identidade Visual Oficial: Verde escuro `#0F2A1F`, Terracota `#B85A3C`, Creme `#F5EFE6`, Preto `#121212`. Tokens centralizados em `web/src/styles/louvaio-brand.css`, `web/src/theme/louvaioTheme.ts` e `web/src/index.css`.
- Stack: React 19 + TypeScript + Vite/PWA + TailwindCSS v4; Node.js + TypeScript + Express 5; Firebase Authentication + Cloud Firestore.
- Entry points: web/src/main.tsx, web/src/App.tsx, backend/src/server.ts e backend/src/app.ts.

## Architecture

Monorepo com dois pacotes npm independentes. A SPA usa web/src/api.ts para consumir a API REST. O backend segue predominantemente route → controller → service → repository → Firebase. Não há workspace/package raiz.

## Important Components

- App.tsx: sessão, ministério ativo, navegação, sidebar institucional LouvAIO e estado principal da SPA.
- api.ts: URL base, JWT em localStorage, fetch e mapeamento de contratos.
- app.ts: middleware e montagem das rotas Express.
- unifiedConfig.ts: leitura/validação de ambiente.
- firebase.ts: Firebase Admin, Firestore e Auth.
- middleware/auth.ts e rbac.ts: JWT e papéis admin/member.
- repositories/: fonte dos nomes de coleções e comportamento de persistência.
- theme/louvaioTheme.ts: mapeamento de cores e caminhos de assets oficiais de branding.

## Important Domain Concepts

Ministry é a fronteira principal de tenant. Usuários podem ser admin ou member; também há funções musicais separadas. Recursos incluem membros, convites PR-*, equipes, funções, classificações, artistas, músicas/versões, pastas, escalas, comentários, modelos de roteiro, liturgias e cifras.

### Commercial Structure & Plans

- 6 planos definidos: `free` (10 membros / 50 músicas), `lite` (20 membros / 100 músicas), `lite_plus` (30 membros / 150 músicas, apresentado como Lite+), `essential` (40 membros / 200 músicas, suporta add-on), `pro` (100 membros / 500 músicas, suporta add-on) e `premium` (ilimitado).
- Add-ons de membros em blocos de +10; tetos configuráveis por plano (inicialmente: essential até 4 blocos = 80 membros; pro até 10 blocos = 200 membros).
- Sem cobrança real nesta etapa (apenas modelagem de dados e validação de limites). Detalhes em `docs/product/plans-and-limits.md`.

## Integrations

- Firebase Admin SDK: Auth e Firestore.
- Firebase Identity Toolkit REST: login por e-mail/senha quando FIREBASE_WEB_API_KEY existe.
- Vercel: manifests separados para frontend e backend.
- Google Fonts e html2pdf.js: carregados por CDN no HTML.
- Supabase: dependência/stub legado, não é persistência ativa.

## Persistence

Firestore é a fonte persistente. Nomes de coleções e relações estão documentados em docs/architecture/integrations.md. Não há migrations ou schema versionado.

## Configuration

Backend reconhece PORT, NODE_ENV, JWT_SECRET, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL, DEFAULT_MINISTRY_ID e FIREBASE_WEB_API_KEY. Web reconhece VITE_API_URL. Nunca registrar valores.

## Testing

O backend usa Vitest para testes unitários do motor de quotas, serviços de assinatura e isolamento de tenant (44 testes). O web usa Vitest/Testing Library (23 testes) e Playwright (61 testes com matriz de 6 viewports: 320x568, 360x800, 375x812, 390x844, 412x915, 430x932 em temas light e dark); as jornadas E2E interceptam a API e usam fixtures locais, sem escrita persistente. Ambos os pacotes são validados por build TypeScript. O lint backend está declarado, mas não operacional.

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
- Firebase/Firestore é a implementação ativa; referências antigas a Supabase/Flutter não descrevem este checkout.
- Não existe contrato HTTP uniformizado; mudanças devem preservar respostas locais.
- Inconsistências confirmadas ficam catalogadas em docs/system-status.md e exigem tarefas próprias.

## Known Constraints

- Testes de concorrência física de transações sob Firestore Emulator: NOT YET VERIFIED (validado com mocks unitários). Sem CI/CD, Docker, migrations, formatter ou esquema Firestore versionado.
- Componentes web e o cliente api.ts concentram muito comportamento.
- Alias groups/ministry e campos snake_case/camelCase coexistem por compatibilidade.
- Versão mínima suportada de Node/npm: Unknown / Not yet verified.

## Known Issues

Itens duráveis e priorizados estão em docs/system-status.md: fallback de login sem verificação de senha, contratos Smart Chords divergentes, atualização de liturgia incorreta e documentação histórica desatualizada. (INC-002 e INC-003 foram corrigidos).

## Current State

- Sistema completo de Planos, Quotas, Entitlements e Assinatura por Ministério implementado no backend e web (concluído em 2026-08-28).
- Adoção integral da identidade visual e PWA LouvAIO concluída em 2026-08-28.
- O web possui rotas estáveis, navegação mobile e desktop coerente, bootstrap autenticado, tela `/ministerio/plano`, testes E2E com cobertura de overflow horizontal em 6 viewports (light/dark) e PWA com manifest LouvAIO atualizado.
- O repositório contém backend e web; não contém mobile ou supabase.

## Completed Milestones

- Estrutura inicial backend/web.
- Migração observável do backend para Firebase.
- Gestão de ministérios, repertório, escalas e PWA presentes no código.
- Auditoria e correção de overflow horizontal em 6 viewports mobile.
- Reestilização integral da identidade visual e PWA LouvAIO.
- Implementação do Sistema de Planos, Quotas e Entitlements por Ministério.

## Current Work

Consulte docs/exec-plans/active/; planos concluídos ficam em docs/exec-plans/completed/.

## Next Likely Areas

Priorizar uma revisão isolada de autenticação/autorização e, em seguida, alinhar contratos Smart Chords e liturgias. Cada correção deve ter ExecPlan e testes introduzidos de forma deliberada.

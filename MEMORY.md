# Project Memory

## Project Identity

- Nome: Praise App.
- Propósito: gestão web de ministérios de louvor, seus integrantes, repertório, escalas e rotinas associadas.
- Stack: React 18 + TypeScript + Vite/PWA; Node.js + TypeScript + Express 5; Firebase Authentication + Cloud Firestore.
- Entry points: web/src/main.tsx, web/src/App.tsx, backend/src/server.ts e backend/src/app.ts.

## Architecture

Monorepo com dois pacotes npm independentes. A SPA usa web/src/api.ts para consumir a API REST. O backend segue predominantemente route → controller → service → repository → Firebase. Não há workspace/package raiz.

## Important Components

- App.tsx: sessão, ministério ativo, navegação e estado principal da SPA.
- api.ts: URL base, JWT em localStorage, fetch e mapeamento de contratos.
- app.ts: middleware e montagem das rotas Express.
- unifiedConfig.ts: leitura/validação de ambiente.
- firebase.ts: Firebase Admin, Firestore e Auth.
- middleware/auth.ts e rbac.ts: JWT e papéis admin/member.
- repositories/: fonte dos nomes de coleções e comportamento de persistência.

## Important Domain Concepts

Ministry é a fronteira principal de tenant. Usuários podem ser admin ou member; também há funções musicais separadas. Recursos incluem membros, convites PR-*, equipes, funções, classificações, artistas, músicas/versões, pastas, escalas, comentários, modelos de roteiro, liturgias e cifras.

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

O web usa Vitest/Testing Library e Playwright; as jornadas E2E interceptam a API e usam fixtures locais, sem escrita persistente. O backend continua sem testes. Ambos os pacotes são validados por build TypeScript. O lint backend está declarado, mas não operacional.

## Operational Commands

    cd backend && npm ci
    cd backend && npm run dev
    cd backend && npm run build
    cd backend && npm start

    cd web && npm ci
    cd web && npm run dev
    cd web && npm run build
    cd web && npm test
    cd web && npm run test:e2e
    cd web && npm run preview

## Important Decisions

- Código atual prevalece sobre documentação histórica.
- Firebase/Firestore é a implementação ativa; referências antigas a Supabase/Flutter não descrevem este checkout.
- Não existe contrato HTTP uniformizado; mudanças devem preservar respostas locais.
- Inconsistências confirmadas ficam catalogadas em docs/system-status.md e exigem tarefas próprias.

## Known Constraints

- Sem testes backend, CI/CD, Docker, migrations, formatter ou esquema Firestore versionado.
- Componentes web e o cliente api.ts concentram muito comportamento.
- Alias groups/ministry e campos snake_case/camelCase coexistem por compatibilidade.
- Versão mínima suportada de Node/npm: Unknown / Not yet verified.

## Known Issues

Itens duráveis e priorizados estão em docs/system-status.md: autorização permissiva em determinados fluxos, fallback de login sem verificação de senha, contratos Smart Chords divergentes, atualização de liturgia incorreta e documentação histórica desatualizada.

## Current State

Harness documental criado em 2026-08-27. O web possui rotas estáveis, navegação mobile de cinco áreas, bootstrap autenticado, testes isolados e PWA com cache apenas do shell estático. O repositório contém backend e web; não contém mobile ou supabase.

## Completed Milestones

- Estrutura inicial backend/web.
- Migração observável do backend para Firebase.
- Gestão de ministérios, repertório, escalas e PWA presentes no código.
- Harness de documentação e contexto operacional.

## Current Work

Consulte docs/exec-plans/active/; planos concluídos ficam em docs/exec-plans/completed/.

## Next Likely Areas

Priorizar uma revisão isolada de autenticação/autorização e, em seguida, alinhar contratos Smart Chords e liturgias. Cada correção deve ter ExecPlan e testes introduzidos de forma deliberada.

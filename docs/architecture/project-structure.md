# Project Structure

## Relevant Tree

    praise-app/
    ├── AGENTS.md
    ├── MEMORY.md
    ├── README.md
    ├── GEMINI.md
    ├── run-backend.bat
    ├── run-web.bat
    ├── backend/
    │   ├── package.json
    │   ├── package-lock.json
    │   ├── tsconfig.json
    │   ├── vitest.config.ts
    │   ├── firestore.indexes.json
    │   ├── .env.example
    │   ├── vercel.json
    │   ├── scripts/
    │   └── src/
    │       ├── app.ts
    │       ├── server.ts
    │       ├── config/
    │       ├── controllers/
    │       ├── features/
    │       ├── lib/
    │       ├── middleware/
    │       ├── repositories/
    │       └── utils/
    ├── web/
    │   ├── package.json
    │   ├── package-lock.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
    │   ├── vitest.config.ts
    │   ├── playwright.config.ts
    │   ├── vercel.json
    │   ├── index.html
    │   ├── public/
    │   └── src/
    │       ├── main.tsx
    │       ├── App.tsx
    │       ├── api.ts
    │       ├── types.ts
    │       ├── index.css
    │       ├── components/
    │       ├── styles/
    │       ├── theme/
    │       └── utils/
    └── docs/
        ├── architecture/
        ├── business/
        ├── decisions/
        ├── development/
        ├── exec-plans/
        ├── operations/
        ├── product/
        └── security/

## Root

- AGENTS.md: regras obrigatórias e operacionais para agentes.
- MEMORY.md: fatos duráveis do projeto; não é diário.
- README.md: visão geral de onboarding para humanos e agentes.
- GEMINI.md: ponte para ferramentas legadas, apontando para o harness.
- run-backend.bat e run-web.bat: atalhos Windows legados.
- .gitignore: ignora dependencies, builds, .env, IDE e .agents.
- .agents/: catálogo local de skills, ignorado pelo Git; não faz parte do runtime do produto.

## Backend

### Entradas e configuração

- src/server.ts: app.listen para execução persistente e ciclo de vida do `BillingReconcilerWorker`.
- src/app.ts: exporta o Express app; também é entry point do Vercel.
- src/config/unifiedConfig.ts: dotenv + schema Zod e defaults de ambiente.
- src/config/plans.config.ts: fonte única da verdade sobre catálogo de planos, quotas, preços e cálculo de accessMode.
- src/config/env.ts: compatibilidade legada.

### Shared infrastructure

- src/lib/firebase.ts: inicialização de Firestore e Firebase Auth.
- src/lib/supabase.ts: stub deprecated que retorna null.
- src/controllers/BaseController.ts: helpers de resposta.
- src/middleware/auth.ts: valida Bearer JWT da API e Firebase ID Tokens.
- src/middleware/rbac.ts: papéis admin/member e autorização por ministério.
- src/middleware/platform-admin.ts: segurança de autoridade da plataforma (`PLATFORM_ADMIN_SECRET`).
- src/middleware/quota-enforcement.ts: validação de cotas operacionais (`members`, `songs`).
- src/middleware/validate.ts: valida body/query/params com Zod.
- src/middleware/error-handler.ts: AppError e fallback global.
- src/utils/billing-date.ts: cálculo de datas comerciais no timezone configurado.

### Features

Cada feature normalmente tem controller, routes, service, types e testes:

- auth/: signup, login e verificação de perfil.
- ministries/: tenant ativo, convites PR-*, membership e administração.
- subscriptions/: quotas operacionais, ciclo de vida de assinaturas, planos de cortesia e accessMode.
- billing/: gateway Asaas (`AsaasBillingProvider`), checkout sessions, webhooks transacionais, histórico financeiro, future payment cleanup e worker de reconciliação.
- repertoire/: músicas, artistas, classificações e pastas.
- schedules/: escalas, participantes, confirmação e comentários.
- liturgies/: ordem de culto e itens.
- smart_chords/: armazenamento de cifras filtradas por user_id.
- teams/: equipes e member IDs.
- roles/: funções musicais e seed padrão.
- classifications/: classificações ministeriais e seed padrão.
- templates/: modelos de roteiro de escala.
- groups/: módulo legado não montado diretamente.

### Repositories

Repositórios acessam Firestore diretamente, com isolamento por `ministry_id` e proteções anti-IDOR. Não há ORM nem interfaces de repositório no domínio de produto.

### Scripts

- scripts/grant-complimentary.ts: CLI seguro para concessão/revogação de planos cortesia.
- scripts/audit-billing-state.ts e audit-checkout-webhooks.ts: scripts de diagnóstico.

## Web

- src/main.tsx: React root e import do CSS.
- src/App.tsx: composição principal, estado e sincronização de rotas com React Router.
- src/api.ts: cliente HTTP centralizado e mappers camelCase/snake_case.
- src/types.ts: modelos e DTOs da UI.
- src/components/: telas e modais (incluindo `SubscriptionPlanView` para faturamento e gestão de plano).
- src/components/ui/: inputs flutuantes reutilizáveis.
- src/styles/louvaio-brand.css e src/theme/louvaioTheme.ts: identidade visual LouvAIO.
- src/utils/smart_chord.ts: funções puras de cifra.
- src/routing.ts e src/auth-bootstrap.ts: rotas estáveis e bootstrap autenticado.
- src/**/*.test.*: testes Vitest/Testing Library co-localizados.
- e2e/: jornadas Playwright e fixtures HTTP locais.
- src/index.css: folha global, tokens de tema e responsividade.
- public/: favicon SVG, ícones PNG e fallback offline da PWA.

## Paths That Do Not Exist

- mobile/: ausente.
- supabase/: ausente.
- .github/workflows/: ausente.
- Dockerfile/compose: ausentes.
- migrations SQL: ausentes.

Essas ausências são estado atual, não sugestões para criação automática.

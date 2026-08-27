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
    │   ├── vercel.json
    │   └── src/
    │       ├── app.ts
    │       ├── server.ts
    │       ├── config/
    │       ├── controllers/
    │       ├── features/
    │       ├── lib/
    │       ├── middleware/
    │       └── repositories/
    ├── web/
    │   ├── package.json
    │   ├── package-lock.json
    │   ├── tsconfig.json
    │   ├── vite.config.ts
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
    │       └── utils/
    └── docs/
        ├── architecture/
        ├── development/
        ├── product/
        ├── decisions/
        └── exec-plans/

## Root

- AGENTS.md: regras obrigatórias para agentes.
- MEMORY.md: fatos duráveis e pequenos; não é diário.
- README.md: entrada curta para humanos.
- GEMINI.md: ponte para ferramentas antigas, apontando para o harness.
- run-backend.bat e run-web.bat: atalhos Windows. Ambos esperam uma distribuição local .node/node-v20.13.1-win-x64, que não está versionada nem presente no checkout analisado.
- .gitignore: ignora dependencies, builds, .env, IDE e .agents.
- .agents/: catálogo local de skills, ignorado pelo Git; não faz parte do runtime do produto.

## Backend

### Entradas e configuração

- src/server.ts: app.listen para execução persistente.
- src/app.ts: exporta o Express app; também é entry point do Vercel.
- src/config/unifiedConfig.ts: dotenv + schema Zod e defaults.
- src/config/env.ts: compatibilidade; campos Supabase são strings vazias.

### Shared infrastructure

- src/lib/firebase.ts: inicialização de Firestore e Firebase Auth.
- src/lib/supabase.ts: stub deprecated que retorna null.
- src/controllers/BaseController.ts: helpers de resposta.
- src/middleware/auth.ts: valida Bearer JWT.
- src/middleware/rbac.ts: papéis e status de assinatura.
- src/middleware/validate.ts: valida body/query/params com Zod.
- src/middleware/error-handler.ts: AppError e fallback 500.

### Features

Cada feature normalmente tem controller, routes, service e types:

- auth/: signup, login e perfil atual.
- ministries/: tenant ativo, convites, membership e administração.
- groups/: implementação paralela/legada não montada diretamente.
- repertoire/: músicas, artistas, classificações e pastas.
- schedules/: escalas, confirmação e comentários.
- liturgies/: ordem de culto e itens.
- smart_chords/: armazenamento de cifras; contratos atuais divergem do frontend.
- teams/: equipes e member IDs.
- roles/: funções musicais e seed padrão.
- classifications/: classificações ministeriais e seed padrão.
- templates/: modelos de roteiro de escala.

### Repositories

Um repository por área acessa Firestore diretamente. Não há repository interface nem ORM. Os IDs relacionados são armazenados como strings e arrays; não há foreign keys.

## Web

- src/main.tsx: React root e import do CSS.
- src/App.tsx: composição principal, estado e sincronização da navegação com React Router.
- src/api.ts: cliente HTTP e mappers.
- src/types.ts: modelos da UI.
- src/components/: telas e modais. Componentes de criação/gestão de escala, ministério e cifras são especialmente grandes e stateful.
- src/components/ui/: inputs flutuantes reutilizáveis.
- src/utils/smart_chord.ts: funções puras de cifra.
- src/routing.ts e src/auth-bootstrap.ts: rotas estáveis e bootstrap autenticado.
- src/**/*.test.*: testes Vitest/Testing Library co-localizados.
- e2e/: jornadas Playwright e fixtures HTTP locais.
- src/index.css: folha global extensa, tokens de tema, responsividade e estilos de features.
- public/: favicon SVG, ícones PNG e fallback offline da PWA.

## Paths That Do Not Exist

- mobile/: ausente.
- supabase/: ausente.
- testes backend: ausentes; os testes web ficam em src/ e e2e/.
- .github/workflows/: ausente.
- Dockerfile/compose: ausentes.
- migrations/: ausente.
- .env.example: ausente.

Essas ausências são estado atual, não sugestões para criação automática.

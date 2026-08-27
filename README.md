# Praise App

Aplicação web para gestão de ministérios de louvor. O estado atual reúne uma SPA React/PWA e uma API REST Express que usam Firebase Authentication e Cloud Firestore.

## Estado atual

- Frontend: React 18, TypeScript, Vite e PWA.
- Backend: Node.js, TypeScript, Express 5, Zod e Firebase Admin SDK.
- Persistência: Cloud Firestore.
- Autenticação: Firebase Authentication para usuários e JWT próprio para sessões da API.
- Implantação declarada: configurações independentes do Vercel em web/ e backend/.
- Testes web: Vitest/Testing Library e Playwright com fixtures HTTP locais; o backend continua sem testes.
- CI/CD, Docker e migrations: não existem neste repositório.

Documentos antigos mencionavam Flutter, Supabase e migrations SQL. Esses artefatos não existem no checkout atual e não descrevem a implementação vigente.

## Execução rápida

Pré-requisito confirmado: Node.js com npm. O repositório não fixa uma versão em engines.

Backend:

    cd backend
    npm ci
    npm run dev

Frontend, em outro terminal:

    cd web
    npm ci
    npm run dev

O backend usa a porta 3000 por padrão e o Vite usa a porta 5173. A configuração local requer variáveis de ambiente; consulte [Getting started](docs/development/getting-started.md). Nenhum valor sensível é versionado.

## Validação

    cd backend
    npm run build

    cd ../web
    npm run build
    npm test
    npm run test:e2e

O script backend npm run lint está declarado, mas a configuração/dependência do ESLint não existe no estado atual. O frontend não possui script de lint. Os testes E2E usam mocks locais e não devem apontar para dados reais.

## Estrutura

    backend/   API REST, regras de aplicação e acesso ao Firestore
    web/       SPA React, cliente HTTP, PWA e estilos
    docs/      arquitetura, desenvolvimento, produto, decisões e planos

## Documentação

- [Manual para agentes](AGENTS.md)
- [Memória durável](MEMORY.md)
- [Arquitetura](docs/architecture/overview.md)
- [Estrutura do projeto](docs/architecture/project-structure.md)
- [Fluxos de execução](docs/architecture/runtime-flow.md)
- [Integrações](docs/architecture/integrations.md)
- [Guia de desenvolvimento](docs/development/getting-started.md)
- [Estado, inconsistências e lacunas](docs/system-status.md)
- [Visão funcional](docs/product/system-overview.md)
- [ExecPlans](docs/exec-plans/README.md)

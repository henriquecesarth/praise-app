# LouvAIO

Aplicação web e PWA para gestão completa de ministérios de louvor: integrantes, equipes, repertório, escalas, liturgias, cifras inteligentes, quotas operacionais e faturamento SaaS recorrente. O sistema reúne uma SPA React/PWA e uma API REST Express integradas a Firebase Authentication, Cloud Firestore e gateway Asaas.

## Estado atual

- Frontend: React 18, TypeScript, Vite, Tailwind CSS v4 e PWA.
- Backend: Node.js, TypeScript, Express 5, Zod, Firebase Admin SDK e gateway Asaas.
- Persistência: Cloud Firestore.
- Autenticação: Firebase Authentication para credenciais e JWT próprio para sessões da API.
- Faturamento e Assinaturas: Sistema de planos, quotas, add-ons e assinaturas recorrentes com Asaas (fluxos principais homologados em Sandbox; gaps conhecidos em aberto; produção não presumida).
- Implantação declarada: configurações independentes do Vercel em web/ e backend/.
- Testes: Vitest para testes unitários e de integração do backend; Vitest/Testing Library e Playwright (E2E com fixtures locais) para o frontend.
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

O backend usa a porta 3000 por padrão e o Vite usa a porta 5173. A configuração local requer variáveis de ambiente; consulte [Getting started](docs/development/getting-started.md) e [`backend/.env.example`](backend/.env.example). Nenhum valor sensível é versionado.

## Validação

    cd backend
    npm run build
    npm test

    cd ../web
    npm run build
    npm test
    npm run test:e2e

Verificação de integridade do repositório:

    git diff --check
    git status
    git diff --stat

O script backend `npm run lint` está declarado, mas a configuração/dependência do ESLint não está instalada. O frontend não possui script de lint. Os testes E2E usam mocks locais e não devem apontar para dados reais.

## Estrutura

    backend/   API REST, regras de aplicação, quotas, billing e acesso ao Firestore
    web/       SPA React, cliente HTTP, PWA e estilos
    docs/      arquitetura, desenvolvimento, produto, operações, segurança, decisões e planos

## Documentação

- [Manual para agentes](AGENTS.md)
- [Memória durável](MEMORY.md)
- [Arquitetura](docs/architecture/overview.md)
- [Estrutura do projeto](docs/architecture/project-structure.md)
- [Fluxos de execução](docs/architecture/runtime-flow.md)
- [Integrações](docs/architecture/integrations.md)
- [Arquitetura de Billing](docs/operations/billing-architecture.md)
- [Guia de desenvolvimento](docs/development/getting-started.md)
- [Estado, inconsistências e lacunas](docs/system-status.md)
- [Visão funcional](docs/product/system-overview.md)
- [Planos e Limites](docs/product/plans-and-limits.md)
- [ExecPlans](docs/exec-plans/README.md)

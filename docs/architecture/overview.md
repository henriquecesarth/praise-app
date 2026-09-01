# Architecture Overview

## System Context

LouvAIO (anteriormente Praise App) é uma aplicação web instalável (PWA) para gestão de ministérios de louvor. O browser executa uma SPA React estilizada com a identidade visual oficial LouvAIO (tokens centralizados em `web/src/styles/louvaio-brand.css`), que chama uma API REST Express. A API autentica sessões com JWT próprio e usa Firebase Admin SDK para Firebase Authentication e Cloud Firestore, além de se integrar ao gateway de pagamentos Asaas para assinaturas SaaS recorrentes.

Não há aplicativo Flutter ou banco Supabase ativo neste checkout. O backend inclui o `BillingReconcilerWorker` para reconciliação periódica de transições de plano em background.

## Architectural View

~~~mermaid
flowchart TD
    U[Usuário no browser] --> W[React SPA / PWA]
    W -->|HTTPS JSON + Bearer JWT| A[Express API /api/v1]
    A --> M[Middleware: auth, RBAC, Zod, quotas, errors]
    M --> C[Feature controllers]
    C --> S[Feature services]
    S --> R[Repositories]
    S --> BP[BillingProvider / AsaasBillingProvider]
    BP -->|REST API v3| Asaas[(Gateway Asaas)]
    Asaas -->|Webhooks HTTPS| A
    R --> F[(Cloud Firestore)]
    R --> FA[Firebase Authentication]
    R --> IT[Firebase Identity Toolkit REST]
    W --> CDN[Google Fonts / html2pdf CDN]
    BRW[BillingReconcilerWorker] -->|Reconciliação periódica| S
~~~

## Components and Responsibilities

### Web SPA

- web/src/main.tsx monta o aplicativo.
- web/src/App.tsx mantém sessão, ministério ativo, módulo/tela selecionado e dados centrais.
- web/src/api.ts define URL base, headers, fetch, tratamento de erros e adaptação entre formatos.
- web/src/components/ implementa login, dashboard, ministério, repertório, escalas, cifras, tela de planos/faturamento (`SubscriptionPlanView`) e modais.
- web/src/utils/smart_chord.ts contém parsing, transposição e transformação visual de cifras.
- web/vite.config.ts configura React, Tailwind Vite plugin e geração PWA.

### Express API

- backend/src/server.ts inicia o servidor local e o worker de reconciliação de billing (`BillingReconcilerWorker`).
- backend/src/app.ts compõe middleware, health/diag e rotas de todas as features e webhooks.
- feature.routes.ts define endpoints e encadeia autenticação, RBAC, validação e quotas.
- controllers recebem Express Request/Response e traduzem códigos/respostas.
- services orquestram repositories e entidades de domínio (`SubscriptionService`, `BillingService`, etc.).
- repositories implementam consultas e gravações Firestore diretamente.
- middleware/error-handler.ts é a fronteira global de erro.

### Integrations and Persistence

- lib/firebase.ts inicializa Firebase Admin uma vez e exporta Firestore/Auth.
- features/billing/providers/asaas/asaas.provider.ts implementa a interface `BillingProvider` para comunicação com o Asaas.
- Repositories acessam as coleções Firestore diretamente com isolamento por `ministry_id`.

## Dependency Direction

    React component
      → web/src/api.ts
      → Express route
      → middleware
      → controller
      → service
      → repository / BillingProvider
      → Firestore / Asaas

O backend não possui interfaces de repository nem inversão formal de infraestrutura para persistência. Services importam implementações concretas de repositórios. No billing, a integração com gateway utiliza a interface desacoplada `BillingProvider`.

## Boundaries

- **Client/API**: HTTP JSON sob API_URL, normalmente /api/v1.
- **Authentication**: token JWT emitido pela própria API após operação de Auth.
- **Tenant**: ministryId é a fronteira principal; groupId aparece como alias legado.
- **Billing Authority**: Asaas gerencia o estado financeiro; LouvAIO gerencia o direito de uso e quotas do produto.
- **Persistence**: repositories são a fronteira direta com Firestore.
- **Presentation**: autorização visual por admin/member não substitui middleware de backend.

## Main Capabilities

- contas e sessão;
- ministérios, convites e membros;
- funções, equipes, classificações e modelos de roteiro;
- músicas, artistas, versões, links e pastas;
- escalas, participantes, confirmação e comentários;
- liturgias;
- cifras, transposição e exportação PDF;
- planos, quotas de uso e planos cortesia da plataforma;
- faturamento SaaS recorrente via gateway Asaas (checkout hospedado, webhooks idempotentes, cleanup financeiro);
- instalação PWA, shell estático revisionado e fallback offline sem cache de API.

## Response and Data Conventions

Dados Firestore/API usam principalmente snake_case. A UI converte partes para camelCase. Não há envelope HTTP único: respostas de repertório frequentemente são { data: value }, enquanto ministérios, escalas e liturgias retornam objetos/arrays diretamente.

## Architectural Risks

Consulte [System status](../system-status.md) antes de modificar autenticação, autorização, repertório, liturgias, escalas, Smart Chords ou faturamento.

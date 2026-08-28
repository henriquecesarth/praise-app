# Architecture Overview

## System Context

LouvAIO (anteriormente Praise App) é uma aplicação web instalável (PWA) para gestão de ministérios de louvor. O browser executa uma SPA React estilizada com a identidade visual oficial LouvAIO (tokens centralizados em `web/src/styles/louvaio-brand.css`), que chama uma API REST Express. A API autentica sessões com JWT próprio e usa Firebase Admin SDK para Firebase Authentication e Cloud Firestore.

Não há aplicativo Flutter, banco Supabase ativo, worker, fila ou serviço de background neste checkout.

## Architectural View

~~~mermaid
flowchart LR
    U[Usuário no browser] --> W[React SPA / PWA]
    W -->|HTTPS JSON + Bearer JWT| A[Express API /api/v1]
    A --> M[Middleware: auth, RBAC, Zod, errors]
    M --> C[Feature controllers]
    C --> S[Feature services]
    S --> R[Repositories]
    R --> F[(Cloud Firestore)]
    R --> FA[Firebase Authentication]
    R --> IT[Firebase Identity Toolkit REST]
    W --> CDN[Google Fonts / html2pdf CDN]
~~~

## Components and Responsibilities

### Web SPA

- web/src/main.tsx monta o aplicativo.
- web/src/App.tsx mantém sessão, ministério ativo, módulo/tela selecionado e dados centrais.
- web/src/api.ts define URL base, headers, fetch, tratamento de erros e adaptação entre formatos.
- web/src/components/ implementa login, dashboard, ministério, repertório, escalas, cifras e modais.
- web/src/utils/smart_chord.ts contém parsing, transposição e transformação visual de cifras.
- web/vite.config.ts configura React, Tailwind Vite plugin e geração PWA. O estilo observado continua majoritariamente em index.css.

### Express API

- backend/src/server.ts inicia o servidor local.
- backend/src/app.ts compõe middleware, health/diag e rotas.
- feature.routes.ts define endpoints e encadeia autenticação, RBAC e validação.
- controllers recebem Express Request/Response e escolhem códigos/respostas.
- services orquestram repositories; não existe uma camada de domínio independente.
- repositories implementam consultas e gravações Firestore e concentram parte das regras.
- middleware/error-handler.ts é a fronteira global de erro.

### Firebase

- lib/firebase.ts inicializa Firebase Admin uma vez e exporta Firestore/Auth.
- UserRepository usa Auth para identidade e a coleção users para perfil.
- Os outros repositories usam coleções Firestore com IDs e referências lógicas armazenadas em campos.

## Dependency Direction

    React component
      → web/src/api.ts
      → Express route
      → middleware
      → controller
      → service
      → repository
      → Firebase

O backend não possui interfaces de repository nem inversão formal de infraestrutura. Services importam implementações concretas. Portanto, “domain does not depend on infrastructure” não é uma regra válida para este projeto.

## Boundaries

- **Client/API**: HTTP JSON sob API_URL, normalmente /api/v1.
- **Authentication**: token JWT emitido pela própria API após operação de Auth.
- **Tenant**: ministryId é a fronteira principal; groupId aparece como alias legado.
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
- instalação PWA, shell estático revisionado e fallback offline sem cache de API.

## Response and Data Conventions

Dados Firestore/API usam principalmente snake_case. A UI converte partes para camelCase. Não há envelope HTTP único: respostas de repertório frequentemente são { data: value }, enquanto ministérios, escalas e liturgias retornam objetos/arrays diretamente.

## Architectural Risks

As fronteiras existem, mas não garantem isolamento por tenant em todas as operações. Aliases legacy e contratos incompletos também atravessam camadas. Consulte [System status](../system-status.md) antes de modificar autenticação, autorização, repertório, liturgias, escalas ou Smart Chords.

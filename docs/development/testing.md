# Testing

## Current State

O projeto possui suítes de testes automatizados no backend e no frontend:

- **Backend (`backend/`)**: Vitest cobrindo motor de quotas, ciclo de vida de assinaturas, planos cortesia, repositórios Firestore, integração Asaas, concorrência, idempotência atômica de webhooks, amount validation, future payment cleanup, autorização RBAC e segurança anti-IDOR.
- **Frontend (`web/`)**:
  - Vitest + Testing Library + jsdom para helpers, componentes e fluxos de UI;
  - Playwright/Chromium para jornadas móveis no build de produção, com API interceptada e fixtures em memória.

## Commands

### Backend

Executar testes:

    cd backend
    npm test

Compilar TypeScript:

    cd backend
    npm run build

### Frontend

Unitários e componentes:

    cd web
    npm test

Jornadas E2E:

    cd web
    npm run build
    npm run test:e2e

O Playwright inicia `vite preview` em `127.0.0.1:4173`. Reconstrua `web/dist/` antes da suíte para que o preview utilize os artefatos atuais.

## Current Coverage

| Category | Current status |
| --- | --- |
| Quotas, entitlements e accessMode | Covered in Backend Vitest |
| Billing, Asaas provider e checkout intents | Covered in Backend Vitest |
| Webhook idempotency e amount validation | Covered in Backend Vitest |
| Concorrência transacional e lease do worker | Covered in Backend Vitest |
| Security anti-IDOR, RBAC e platform admin | Covered in Backend Vitest |
| Auth bootstrap/token gate | Covered in Web Vitest |
| Route parsing/path generation | Covered in Web Vitest |
| pt-BR date/time formatting | Covered in Web Vitest |
| Floating fields | Covered in Testing Library |
| Mobile bottom navigation/account menu | Covered in Testing Library |
| Smart Chords ministry change/stale request cancellation | Covered in Testing Library |
| PWA registration/update callbacks | Covered in Web Vitest |
| Mobile journeys, history and refresh | Covered in Playwright at 360×800, 390×844 and 412×915, light/dark |
| Offline fallback | Covered in Chromium against production preview |
| Concorrência física sob Firestore Emulator | Unknown / Not yet verified |
| Testes em dispositivos físicos reais | Unknown / Not yet verified |

## Isolation Rules

- Não aponte testes automatizados para dados reais de produção.
- `web/e2e/mock-api.ts` deve interceptar contratos HTTP e manter qualquer escrita em memória.
- Jornadas E2E de leitura usam entidades de fixture.
- Mudanças de contrato no backend devem incluir testes unitários/integrados próprios em `backend/src/`.

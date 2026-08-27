# Testing

## Current State

O pacote `web/` possui duas camadas automatizadas:

- Vitest + Testing Library + jsdom para helpers, componentes e ciclos de UI;
- Playwright/Chromium para jornadas móveis no build de produção, com API interceptada e fixtures em memória.

O pacote `backend/` continua sem suíte ou script de testes. Também não há Firebase Emulator, cobertura/thresholds ou pipeline CI.

## Commands

Unitários e componentes:

    cd web
    npm test

E2E:

    cd web
    npm run build
    npm run test:e2e

O Playwright inicia `vite preview` em `127.0.0.1:4173`. Reconstrua `web/dist/` antes da suíte para que o preview não use um artefato anterior.

## Current Coverage

| Category | Current status |
| --- | --- |
| Auth bootstrap/token gate | Covered in Vitest |
| Route parsing/path generation | Covered in Vitest |
| pt-BR date/time formatting | Covered in Vitest |
| Floating fields | Covered in Testing Library |
| Mobile bottom navigation/account menu | Covered in Testing Library |
| Smart Chords ministry change/stale request cancellation | Covered in Testing Library |
| PWA registration/update callbacks | Covered in Vitest |
| Mobile journeys, history and refresh | Covered in Playwright at 360×800, 390×844 and 412×915, light/dark |
| Offline fallback | Covered once in Chromium against production preview |
| Backend/API/repository behavior | Absent |
| Real Firebase integration | Unknown / Not yet verified |
| Security regression tests | Absent |

## Isolation Rules

- Não aponte testes automatizados para dados reais ou para a conta demo.
- `web/e2e/mock-api.ts` deve interceptar contratos HTTP e manter qualquer escrita em memória.
- Jornadas de leitura podem usar entidades de fixture; nenhuma conclusão sobre Firebase real decorre desses testes.
- Uma mudança de contrato backend exige cobertura própria; os mocks web não validam a implementação da API.

## Priority Gaps

1. autenticação por senha/JWT no backend;
2. membership/RBAC e isolamento de tenant;
3. atualização de liturgia e itens;
4. contratos/persistência Smart Chords;
5. operações de repertório por ID;
6. confirmação de participantes de escala;
7. testes reais do Firefox/WebKit e instalação em dispositivo: **Unknown / Not yet verified**.

Essas lacunas não autorizam mudanças fora do escopo de uma tarefa.

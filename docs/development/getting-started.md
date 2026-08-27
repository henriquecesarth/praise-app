# Getting Started

## 1. Prerequisites

Confirmed:

- Node.js;
- npm;
- acesso a um projeto Firebase compatível para fluxos reais de Auth/Firestore;
- dois terminais para backend e web durante desenvolvimento.

O package.json não define engines, .nvmrc, .node-version ou Volta. A inspeção do harness ocorreu com Node v22.23.2 e npm 12.0.2, mas a versão mínima oficialmente suportada é **Unknown / Not yet verified**.

Os scripts .bat tentam adicionar .node/node-v20.13.1-win-x64 ao PATH. Esse diretório não está versionado nem presente no checkout analisado. Use Node instalado no sistema ou providencie esse bundle fora do Git.

## 2. Install Dependencies

Os dois pacotes têm package-lock.json lockfile v3. Para instalação reproduzível:

    cd backend
    npm ci

    cd ../web
    npm ci

Não há package.json na raiz e não há comando único de workspace.

## 3. Environment Configuration

Os arquivos reais .env são ignorados e não devem ser copiados para documentação ou commits. Não existe .env.example.

### Backend

Crie backend/.env localmente com os nomes necessários ao ambiente:

| Variable | Code behavior |
| --- | --- |
| PORT | opcional; default 3000 |
| NODE_ENV | development, production ou test; default development |
| JWT_SECRET | possui default no código; deve ser definido com valor forte fora de desenvolvimento |
| FIREBASE_PROJECT_ID | usado pelo Firebase Admin |
| FIREBASE_CLIENT_EMAIL | service account |
| FIREBASE_PRIVATE_KEY | service account; sequências de nova linha escapadas são normalizadas |
| FIREBASE_DATABASE_URL | opcional no initializer |
| FIREBASE_WEB_API_KEY | usado no login real por e-mail/senha |
| DEFAULT_MINISTRY_ID | compatibilidade; possui default no código |

Para um backend funcional com serviços reais, credenciais Firebase válidas são necessárias. O modo de inicialização sem service account existe, mas sua capacidade de ler/gravar no Firestore sem emulator é **Unknown / Not yet verified**.

### Web

Crie web/.env localmente quando a API não estiver no default:

| Variable | Code behavior |
| --- | --- |
| VITE_API_URL | URL completa com /api/v1; default http://localhost:3000/api/v1 |

Não prefixe outros segredos com VITE_: variáveis Vite são incorporadas no bundle do browser.

## 4. Database and Schema

Persistência é Cloud Firestore. Não há migrations, seeds gerais, schema ou configuração de emulator no repositório.

Ao criar um ministério, o código semeia funções e classificações padrão em runtime. Isso não substitui migrations.

Regras Firestore, índices necessários e preparação de um projeto novo: **Unknown / Not yet verified**.

## 5. Run the Backend

    cd backend
    npm run dev

Esse comando usa tsx watch src/server.ts. Defaults:

- API versionada: http://localhost:3000/api/v1
- health: http://localhost:3000/api/health
- diagnostic: http://localhost:3000/api/diag

Build/start de produção local:

    npm run build
    npm start

## 6. Run the Web App

Em outro terminal:

    cd web
    npm run dev

Vite usa a porta 5173 configurada em vite.config.ts.

Build/preview:

    npm run build
    npm run preview

## 7. Windows Convenience Scripts

Na raiz:

    run-backend.bat
    run-web.bat

Eles pressupõem o bundle local .node mencionado acima. Se esse caminho não existir, o comando npm só funciona se Node/npm já estiverem disponíveis no PATH existente.

## 8. Tests and Lint

- Web unit/component: `cd web && npm test`.
- Web E2E: `cd web && npm run test:e2e`; usa build/preview local, Chromium e API mockada.
- Backend tests: não existem.
- Backend lint: npm run lint está declarado, mas ESLint/config não existem no projeto atual.
- Web lint: não existe script.
- Format: não existe script.

Consulte [Testing](testing.md) e [Validation](validation.md).

## 9. External Dependencies

Fluxos completos reais podem exigir rede para Firebase Identity Toolkit, Firebase Auth e Firestore. O frontend também usa Google Fonts e html2pdf.js por CDN. Os E2E web usam interceptação HTTP local; não há Firebase emulator configurado.

## 10. First Verification

Sem usar credenciais reais, a verificação segura é:

    cd backend
    npm run build

    cd ../web
    npm run build
    npm test
    npm run test:e2e

Não execute smoke tests de escrita contra um projeto Firebase desconhecido. Confirme explicitamente o ambiente e dados-alvo antes de qualquer operação externa.

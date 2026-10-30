# M20-C9A — Deployment Autorizado do Backend Preview

- Data: 2026-10-29
- Executor: Gemini Argon High (Orquestrador temporário)
- Branch: `feat/m20-phase-2a-android-share`
- HEAD: `e3c4902e0d8786e164ea0686486c564f9dea1578` (WIP integralmente preservada)
- Projeto Vercel: `praise-app` (ID: `prj_VMRmyqvZ8mm0Dk90nmZwJYZCWDl2`)

---

## 1. Resumo Executivo e Veredito

| Campo | Valor / Evidência |
|---|---|
| **M20_C9A_VERDICT** | **PASS** |
| **VERCEL_PROJECT** | `praise-app` (`prj_VMRmyqvZ8mm0Dk90nmZwJYZCWDl2`) |
| **DEPLOYMENT_ID** | `dpl_6Sqi6hj2yDVoo5vJhvWXgihDtjkR` |
| **PREVIEW_URL** | `https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app` |
| **API_BASE_URL** | `https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/v1` |
| **DEPLOYMENT_STATUS** | `READY` |
| **FIREBASE_PROJECT** | `louvaio-staging` (exclusivo Preview/Staging; guarda fail-closed ativa contra produção) |
| **JWT_ISOLATION** | `PASS` (segredo dedicado e exclusivo para Preview em variáveis Vercel) |
| **HEALTHCHECK** | `PASS` (HTTP 200, `preview: true`, `service: "praise-backend"`) |
| **RUNTIME_LOGS** | `PASS` (inicialização limpa de Firebase Admin Service Account; zero erros de boot) |
| **PRODUCTION_IMPACT** | `ZERO` (`https://praise-app-gray.vercel.app` inalterado; sem conexões ou escritas no Firebase de produção) |
| **FILES_CHANGED** | `ZERO` (nenhum commit, push, merge ou alteração em arquivos rastreados do Git) |
| **BLOCKERS** | `Nenhum` |
| **NEXT_GATE** | **M20-C9B: Deployment da Web Preview (`praise-app-m7tn`) apontando para a API Preview** |

---

## 2. Auditoria Pré-Deploy (Preflight)

1. **Leitura de Normas:** AGENTS.md, GEMINI.md e M20-C9 revisados e integralmente respeitados.
2. **Git Status & HEAD:** Branch `feat/m20-phase-2a-android-share`, HEAD `e3c4902e0d8786e164ea0686486c564f9dea1578`. WIP local 100% mantida.
3. **Projeto Vercel Canônico:** Confirmado ID `prj_VMRmyqvZ8mm0Dk90nmZwJYZCWDl2` (Nome: `praise-app`, Owner: `henriquecesarths-projects`, Root Directory configurado: `backend`).
4. **Isolamento de Ambiente:** Target estritamente `preview` (sem flag `--prod`).
5. **Configuração de Variáveis de Ambiente no Vercel Preview:**
   - `FIREBASE_STAGING_PROJECT_ID` (Secret, Preview)
   - `FIREBASE_STAGING_CLIENT_EMAIL` (Secret, Preview)
   - `FIREBASE_STAGING_PRIVATE_KEY` (Secret, Preview)
   - `FIREBASE_STAGING_WEB_API_KEY` (Secret, Preview)
   - `JWT_SECRET` (Secret, Preview, isolado da produção)
6. **Guardas de Fail-Closed no Código (`unifiedConfig.ts`):**
   - Em Preview (`VERCEL_ENV=preview`), o backend inicializa estritamente a partir das chaves `FIREBASE_STAGING_*`.
   - Se qualquer chave faltar ou se o projeto configurado for `praise-app-7a362`, o processo é imediatamente abortado:
     `Preview requires dedicated Firebase staging Admin credentials; production project credentials are forbidden.`
   - Não existe fallback para credenciais de produção em Preview.
   - `FIREBASE_STAGING_DATABASE_URL` verificado como opcional para Firestore.
7. **Higiene de Upload:**
   - Regras em `.vercelignore` impediram estritamente o envio de arquivos `.env`, `*.log`, fixtures de teste, código de outras plataformas (`mobile/`, `web/`) e artefatos de build locais (`dist/`).
   - Upload restrito estritamente aos fontes do backend (289 arquivos, ~6.1MB).

---

## 3. Evidências da Homologação Hospedada

### 3.1 Status do Deployment e Proteção
```json
{
  "id": "dpl_6Sqi6hj2yDVoo5vJhvWXgihDtjkR",
  "url": "https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app",
  "readyState": "READY",
  "target": null,
  "deploymentProtection": [
    "vercel_authentication"
  ]
}
```

### 3.2 Acesso Público Não-Autenticado (Deployment Protection Ativa)
Chamada sem credenciais Vercel:
```http
GET https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/health
HTTP/1.1 302 Found
Location: https://vercel.com/sso-api?url=...
Protected by Vercel Authentication
```
*Evidência:* Proteção Vercel Authentication ativa, bloqueando acesso externo não autorizado.

### 3.3 Endpoint de Saúde (`/api/health`) via Vercel Autenticado
```bash
vercel curl https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/health
```
Resposta:
```json
{"status":"ok","service":"praise-backend","preview":true,"timestamp":"2026-10-29T20:23:09.702Z"}
```
*Evidência:* Runtime Express ativo em Node.js 24.x, identificando `preview: true`.

### 3.4 Endpoint de Diagnóstico (`/api/diag`) via Vercel Autenticado
```bash
vercel curl https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/diag
```
Resposta:
```json
{"status":"ok","service":"praise-backend","environment":"production","preview":true,"timestamp":"2026-10-29T20:23:19.215Z"}
```
*Evidência:* Modo Preview ativado, isolado do ecossistema de produção.

### 3.5 Verificação de Rejeição de Rota Autenticada sem Token (`/api/v1/auth/me`)
```bash
vercel curl -i https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/v1/auth/me
```
Resposta:
```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json; charset=utf-8

{"error":{"message":"Token de autenticação não fornecido."}}
```
*Evidência:* Middleware de autenticação operacional, respondendo JSON 401 canônico.

### 3.6 Logs de Inicialização (Runtime Logs)
```json
{"level":"info","message":"🔥 Firebase Admin SDK inicializado com sucesso via Service Account.","stream":"stdout"}
{"level":"info","message":"◇ injected env (0) from .env // tip: ◈ secrets for agents [www.dotenvx.com]","stream":"stdout"}
```
*Evidência:* Inicialização do Firebase Admin SDK sem erros e sem carregar arquivos `.env` locais.

### 3.7 Integridade da Produção
```bash
curl -i https://praise-app-gray.vercel.app/api/health
```
Resposta:
```http
HTTP/1.1 200 OK
{"status":"ok","service":"praise-backend","timestamp":"2026-10-29T20:24:25.028Z"}
```
*Evidência:* Produção canônica totalmente intacta e independente.

---

## 4. Próximo Passo

URL canônica do Backend Preview para provisionamento no frontend:
`https://praise-87tmrr3kj-henriquecesarths-projects.vercel.app/api/v1`

Aguardando autorização para o **M20-C9B** (Deployment da Web Preview no projeto `praise-app-m7tn`).

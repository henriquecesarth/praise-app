# LouvAIO — Configuração de Novo Computador (Windows / PowerShell)

Este guia contém todos os passos e comandos prontos para copiar no **Windows PowerShell** para continuar o desenvolvimento do **LouvAIO** em uma nova estação de trabalho a partir da branch integrada de continuidade `handoff/louvaio-workstation-migration`.

---

## 1. Ferramentas e Versões Recomendadas

| Ferramenta | Versão Recomendada / Homologada | Comando de Verificação |
| :--- | :--- | :--- |
| **Git** | `>= 2.43+` | `git --version` |
| **Node.js** | `v20 LTS` ou `v22 / v24` (homologado em `v24.18.0`) | `node --version` |
| **npm** | `>= 10.x` | `npm --version` |
| **Flutter** | `3.24+` / `3.27+` (canal `stable`) | `flutter --version` |
| **Dart** | `>= 3.5+` (incluído no Flutter SDK) | `dart --version` |
| **Java (JDK)** | `JDK 17` (Eclipse Temurin / Android Studio JBR) | `java -version` |
| **Android SDK** | API 34 / 35 + Build-Tools + Platform-Tools (`adb`) | `flutter doctor -v` |
| **Obsidian** | Última versão estável (opcional, para leitura da base `docs/`) | Interface Desktop |
| **Codex CLI / Gemini (Antigravity)** | Última versão do CLI | `codex --version` / `agy --version` |

---

## 2. Clonagem e Seleção da Branch de Continuidade

Abra o **PowerShell** na pasta onde deseja armazenar seus projetos (sem depender de caminhos antigos) e execute:

```powershell
# Caso esteja clonando o repositório pela primeira vez no novo computador:
git clone -b handoff/louvaio-workstation-migration https://github.com/henriquecesarth/praise-app.git louvaio
cd louvaio
```

Caso você já possua um clone do repositório na máquina:

```powershell
cd caminho\para\seu\clone\praise-app
git fetch origin
git switch handoff/louvaio-workstation-migration
git pull --ff-only origin handoff/louvaio-workstation-migration
```

Verifique o estado e o commit atual:

```powershell
git status
git log -n 3 --oneline
```

---

## 3. Instalação de Dependências (Backend, Web e Mobile)

Execute na raiz do repositório clonado (`louvaio`):

```powershell
# 1. Instalar dependências do Backend (Express + TypeScript + Vitest)
Push-Location backend
npm ci
Pop-Location

# 2. Instalar dependências da Web (React 19 + Vite + Tailwind v4 + Vitest + Playwright)
Push-Location web
npm ci
npx playwright install chromium
Pop-Location

# 3. Instalar pacotes do cliente Mobile (Flutter)
Push-Location mobile
flutter pub get
Pop-Location
```

---

## 4. Variáveis de Ambiente Necessárias (Somente Nomes — Nunca Commitar Valores)

> [!CAUTION]
> O repositório `henriquecesarth/praise-app` é **PÚBLICO**. Nunca adicione arquivos `.env`, chaves de serviço Firebase (`serviceAccountKey.json`), tokens Asaas ou keystores Android ao Git.

### 4.1. Backend (`backend/.env`)

Crie o arquivo `backend/.env` localmente com os seguintes nomes de variáveis (preenchendo com suas credenciais de desenvolvimento/staging):

```dotenv
PORT=3000
NODE_ENV=development
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

# Firebase Admin SDK (Desenvolvimento / Staging)
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Autenticação / JWT
JWT_SECRET=

# Provedor Financeiro (Asaas Sandbox — apenas se for testar faturamento)
ASAAS_API_URL=https://sandbox.asaas.com/api/v3
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=

# Integração WhatsApp (Opcional em dev local)
ZERNIO_API_URL=
ZERNIO_API_KEY=
ZERNIO_WEBHOOK_SECRET=
```

### 4.2. Web (`web/.env.local`)

Crie o arquivo `web/.env.local` localmente para desenvolvimento:

```dotenv
VITE_API_URL=http://localhost:3000/api/v1
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_PUBLIC_SUPPORT_EMAIL=
VITE_CONTROLLER_DISPLAY_NAME=LouvAIO
```

### 4.3. Mobile Android (`mobile/android/key.properties` — Somente para Build de Release)

Para execução em debug/emulador ou `flutter test` não é necessário keystore de release. Caso vá assinar um AAB local no futuro, mantenha `mobile/android/key.properties` e o arquivo `.jks` **exclusivamente fora do controle de versão**.

---

## 5. Comandos de Build e Testes Locais

### Backend
```powershell
Push-Location backend
npm test
npm run build
Pop-Location
```

### Web
```powershell
Push-Location web
# Executar suíte unitária/integração Vitest
npm test

# Executar apenas os testes focados do D2-A (Design System + Leitor Dedicado + SmartChords)
npx vitest run src/components/ui/FloatingFields.test.tsx src/components/smart-chords/SmartChordToolbar.test.tsx src/components/smart-chords/SmartChordDedicatedReader.test.tsx src/components/SmartChordsWorkspace.test.tsx

# Compilar TypeScript e gerar bundle local de validação (respeitando o publish-guard)
npx tsc
npx vite build --mode test
Pop-Location
```

> **Nota sobre `publish-guard.ts` na Web:** O arquivo `web/src/config/publish-guard.ts` bloqueia propositalmente `vite build` em modo `production` fora de um ambiente de publicação verificado (`VERCEL_ENV`). Para validar o build localmente sem publicar, utilize sempre `npx tsc && npx vite build --mode test`.

### Mobile (Flutter)
```powershell
Push-Location mobile
flutter analyze
flutter test
Pop-Location
```

---

## 6. Como Iniciar Web, Backend e Flutter Localmente

### Iniciar o Backend (Terminal 1)
```powershell
cd backend
npm run dev
```

### Iniciar a Web SPA/PWA (Terminal 2)
```powershell
cd web
npm run dev
# Acesse http://localhost:5173
```

### Executar o App Flutter (Terminal 3 — com emulador ou aparelho USB conectado)
```powershell
cd mobile
flutter devices
flutter run
```

---

## 7. Como Abrir a Documentação no Obsidian

1. Abra o **Obsidian**.
2. Clique em **Open folder as vault** (Abrir pasta como cofre).
3. Selecione a pasta `<raiz-do-clone>/docs` (ou a própria raiz `<raiz-do-clone>`).
4. O ponto de entrada da documentação é `docs/00-PAINEL.md` e o estado de engenharia atual está em `docs/development/CURRENT_PROJECT_STATE.md`.

---

## 8. Como Configurar o Codex CLI e o Gemini / Antigravity

O repositório já inclui toda a configuração multi-agente versionada:
- Regras globais: `AGENTS.md` e `GEMINI.md` (na raiz do repositório).
- Configuração nativa do Codex CLI: `.codex/config.toml` e os 6 perfis em `.codex/agents/*.toml`.
- Prompts canônicos dos 6 papéis: `.agents/agents/*/agent.md` (`product-architect`, `feature-engineer`, `feature-reviewer`, `billing-engineer`, `billing-reviewer`, `sandbox-auditor`).
- Política de workflow multi-agente: `docs/development/multi-agent-workflow.md`.

Para iniciar uma sessão no novo computador:
1. Abra o terminal na raiz do clone (`louvaio`).
2. Certifique-se de estar na branch `handoff/louvaio-workstation-migration`.
3. Inicie o **Codex CLI** (`codex`) ou o **Gemini / Antigravity** apontando para o workspace `louvaio` e cole o prompt curto de retomada disponível em `docs/development/AI_AGENT_HANDOFF.md`.

---

## 9. Como Continuar o Desenvolvimento (Integração P1–P8 e Fase D2-B)

1. A etapa **D2-A** (Fundação do Design System v1.0 + Leitor Musical Dedicado com Rolagem Automática + Separação Editar/Visualizar) está concluída e validada nesta branch (`handoff/louvaio-workstation-migration`).
2. As especificações e protótipos visuais aprovados da fase **D1** estão em `docs/design/`:
   - `docs/design/LouvAIO_Design_System_v1_0.md`
   - `docs/design/D1_Auditoria_Visual_e_Inventario.md`
   - `docs/design/D1_Especificacao_Repertorio_e_Cifras.md`
   - `docs/design/D1_Design_Review_Package.md`
   - `docs/design/prototypes/repertorio-desktop-mobile.html`
   - `docs/design/prototypes/cifras-inteligentes-desktop-mobile.html`
3. As evidências reais de navegador da etapa **D2-A** estão em `docs/exec-plans/evidence/d2-a/` e o relatório técnico em `docs/exec-plans/2026-11-06-d2-a-design-system-reader.md`.
4. **Próximos passos imediatos no novo computador:**
   - **Passo 1:** Realizar a integração seletiva das branches paralelas **P1–P8** do Smart Chords (`origin/parallel/regression-musical-20261107`, `origin/parallel/smart-chords-notation-20261107`, `origin/parallel/smart-chords-notation-p3-20261107`, `origin/parallel/smart-chords-p4-p6-20261107`, `origin/parallel/smart-chords-p7-p8-20261107`), preservando o **D2-A** como referência canônica para o leitor e editor visual.
   - **Passo 2:** Após revisão visual do proprietário, avançar para a etapa **D2-B** (Redesign da Biblioteca de Repertório — lista densa inspirada no Linear + painel/detalhe de música e versões musicais).

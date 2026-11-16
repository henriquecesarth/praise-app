# Continuidade de Desenvolvimento no Windows (Checkpoint 2026-11-16)

Este guia registra exatamente o estado publicado no GitHub ao encerrar o ciclo de trabalho no Mac e os passos limpos para retomar no **Windows (PowerShell)** sem depender de nenhum arquivo preso ao computador antigo.

---

## 1. Branches Publicadas no GitHub (`origin`)

| Finalidade | Branch | Worktree no Mac (origem) | Estado no Handoff |
| :--- | :--- | :--- | :--- |
| **Remediação R2 / R2.1 / R2.2** *(trabalho principal)* | `fix/louvaio-audit-remediation-20261113` | `praise-app-audit-remediation` | **Commitado e enviado ao GitHub** (inclui R2.2 Backend + Web + Mobile + Testes + ExecPlans + esta documentação) |
| **Testes de Propriedade Musical P2** *(paralelo separado)* | `parallel/musical-integrity-p2-20261107` | `praise-app` (worktree principal) | **Commitado e enviado ao GitHub** em commit isolado `ab74b6bc8966acfc8d163080071646494558672b` preservando `web/src/utils/smart_chord.properties-p2.test.ts` (sem misturar à R2.2; 12/26 passam e 14/26 falham nessa branch por casos WIP de enarmonia como `B#`) |
| **Handoff Musical P1** *(referência preservada)* | `parallel/regression-musical-20261107` | — | Preservada intacta em `fd4abf27ce167093127f381127e88b992e0e0e36` |

> **Atenção:** Uma branch antiga local `ci/r4-m5-mobile-validation-20261025` (`7181906`, datada de 2026-10-25, anterior à remediação atual) permaneceu 1 commit à frente apenas no Mac por não fazer parte do escopo R2.2 / P2. **Não** faça merge na `main` sem revisão e autorização explícita.

---

## 2. Como Clonar e Restaurar no Windows (PowerShell)

```powershell
# 1. Clonar o repositório completo e entrar na branch principal R2.2
git clone https://github.com/henriquecesarth/praise-app.git
cd praise-app
git fetch origin --prune
git switch -c fix/louvaio-audit-remediation-20261113 origin/fix/louvaio-audit-remediation-20261113

# 2. Caso queira acessar também o trabalho paralelo P2 em worktree separada (recomendado):
git worktree add ../praise-app-musical-p2 origin/parallel/musical-integrity-p2-20261107
```

Se já existir um clone no Windows:

```powershell
git fetch origin --prune
git switch fix/louvaio-audit-remediation-20261113
git pull --ff-only origin fix/louvaio-audit-remediation-20261113
```

---

## 3. Instalação de Dependências no Windows

```powershell
# Backend
Push-Location backend
npm ci
Pop-Location

# Web
Push-Location web
npm ci
npx playwright install chromium
Pop-Location

# Mobile Flutter
Push-Location mobile
flutter pub get
Pop-Location
```

---

## 4. Arquivos Locais / Credenciais NÃO Versionados (Reconfigurar no Windows)

O repositório `henriquecesarth/praise-app` é **público**. Segredos e caches locais nunca vão para o Git e precisam ser recriados localmente no Windows quando necessário:

1. **`backend/.env`**: copie de `backend/.env.example` e preencha credenciais de desenvolvimento/staging (`PORT`, `NODE_ENV`, `ALLOWED_ORIGINS`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `JWT_SECRET`, e variáveis opcionais Asaas Sandbox / Zernio / `CRON_SECRET`).
2. **`web/.env.local`**: configure apenas em desenvolvimento/staging local (`VITE_API_URL`, `VITE_FIREBASE_*`, `VITE_PUBLIC_SUPPORT_EMAIL`, `VITE_CONTROLLER_DISPLAY_NAME`).
3. **`mobile/android/key.properties` e arquivo `.jks` de release**: não são necessários para `flutter analyze`, `flutter test` nem para builds `stagingDebug`; mantenha fora do Git se for gerar release/AAB local.
4. **`mobile/android/local.properties`**: gerado automaticamente pelo `flutter pub get` / Android Studio com o caminho do SDK no Windows.
5. **CLI autenticadas no Windows (quando necessário)**:
   - GitHub (`gh auth login` ou Git Credential Manager)
   - Vercel CLI (`vercel login` — note que `backend/vercel.json` e `web/vercel.json` desabilitam auto-deploy Git na branch `fix/louvaio-audit-remediation-20261113`, portanto deploys de Preview/Staging são manuais se necessários)
   - Firebase CLI (`firebase login`) e Android SDK/ADB para homologação física USB.
6. **Observação sobre arquivos locais do Mac antigo:** no checkout principal do Mac existiam apenas arquivos locais ignorados/de suporte (`backend/.env`, `backend/.firebaserc` para Staging — sendo `.firebaserc` também presente no checkout —, `.spike-future-checkout-state.json` e `.spike-upgrade-adjustment-state.json` de spikes anteriores), além de `node_modules/` e `.dart_tool/` recompiláveis com `npm ci` / `flutter pub get`.

---

## 5. Comandos de Verificação no Windows

```powershell
# Backend
Push-Location backend
npm run build
npm test
Pop-Location

# Web (respeitando publish-guard local)
Push-Location web
npx tsc --noEmit
npx vite build --mode test
npx vitest run --maxWorkers=1
Pop-Location

# Mobile Flutter + Kotlin (aproveitando execução nativa no Windows!)
Push-Location mobile
flutter analyze
flutter test
Push-Location android
.\gradlew.bat testStagingDebugUnitTest
Pop-Location
Pop-Location
```

---

## 6. Pendências Pós-Migração

1. **Homologação física em dispositivo Android real (`PHYSICAL_VALIDATION_PENDING`):** validar ao vivo o APK Debug Staging gerado pelo workflow `LouvAIO Unified Staging CI & APK Build`, testando estante D1 compacta, leitura em tela cheia (inclusive em largura estreita), navegação sequencial na escala (músicas repetidas e versões) e separação admin vs. member nas cifras vinculadas.
2. **Ambiente Staging Web/Backend (Vercel):** confirmar ou atualizar os previews Staging (`louvaio-staging-web.vercel.app` e `louvaio-staging-api.vercel.app`) antes dos testes integrados Web/Mobile em Staging caso ainda apontem para deploys anteriores à R2.2.
3. **Branch paralela `parallel/musical-integrity-p2-20261107`:** decidir posteriormente a correção dos 14 casos WIP de enarmonia (`B#`) em `web/src/utils/smart_chord.ts` antes de qualquer integração seletiva.

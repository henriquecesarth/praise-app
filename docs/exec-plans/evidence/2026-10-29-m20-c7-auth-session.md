# M20-C7 — correção de autenticação e sessão

Base: [revisão C6](2026-10-29-m20-c6-review.md).
Branch `feat/m20-phase-2a-android-share`, HEAD
`e3c4902e0d8786e164ea0686486c564f9dea1578`; WIP anterior preservado.

## Causa e contrato

O notifier aceitava login/signup por `opId == _authOpId ||
!state.isAuthenticated`. Logout invalidava a operação, mas deixava verdadeiro
o segundo ramo. Além disso, o evento Firebase do próprio login avançava
`_authOpId`, motivando a exceção permissiva introduzida anteriormente. Uma
correção somente no notifier não basta: o SDK nativo pode concluir sign-in
e alterar `currentUser` depois do logout. HTTP 200 também precisava validar
a geração antes de entregar o resultado ao consumidor.

Contrato: intenção mais recente governa mutações nativas; resposta de perfil
exige identidade e geração atuais; eventos do mesmo login não duplicam geração;
cancelamento legítimo preserva `SESSION_CHANGED` com recuperação limitada.

## Correção

O repositório reserva geração uma vez por intenção, serializa mutações nativas,
rejeita intenção antiga e limpa a conclusão nativa obsoleta antes de permitir
o próximo login. A identidade efetiva exige concordância entre UID nativo e
UID aceito pelo repositório. Eventos Firebase atrasados são conferidos contra
`currentUser`; o evento do próprio login pertence à mesma operação explícita.

Logout invalida imediatamente o repositório e o notifier antes de aguardar
limpeza de push. Se outro login começar durante essa espera, o logout antigo
não encerra a sessão nova. Limpeza de push continua best-effort e não impede
o logout. Token e callback de expiração HTTP agora passam pelo repositório,
com reset de features antes de aguardar a limpeza nativa.

O interceptor descarta HTTP 200 e erros de sessões antigas. Mudança de sessão
durante force-refresh preserva `SESSION_CHANGED`, sem converter um 401 antigo
em logout de B. `/auth/me` confere contexto/intenção antes de atualizar cache;
login/signup só publicam resultado se a operação continuar válida. Recuperação
de `SESSION_CHANGED` limita-se a duas tentativas por cadeia de bootstrap.
O HTTP de perfil de signup fica fora da fila nativa, evitando deadlock com
callback de expiração que precisa usar a mesma fila.

## Evidência executada

- Auth: `flutter test --no-pub
  test/features/auth/data/auth_session_race_test.dart
  test/features/auth/data/auth_repository_test.dart
  test/features/auth/presentation/controllers/auth_controller_test.dart
  test/core/http/auth_interceptor_test.dart --timeout 20s --reporter expanded`,
  em `mobile/`: PASS, 59 testes,
  exit 0. Log copiado para `mobile/build/m20-c7/auth-tests-final.log`.
  A fixture usa Repository/Notifier/Interceptor de produção e controla tanto
  a resposta quanto a mutação independente de `FirebaseAuth.currentUser`.

- Share: `flutter test --timeout 45s
  test/features/smart_chords/presentation/controllers/share_intent_router_test.dart
  test/features/smart_chords/presentation/controllers/share_intent_app_router_test.dart`,
  em `mobile/`: PASS, 16 testes, exit 0. Log local ignorado
  `mobile/build/m20-c7/share-tests-final.log` (reexecução após correção/revisão).
- Dois novos casos exercitam `AuthNotifier.logout` e listener real do roteador:
  Share pendente iniciado por A ou antes de login cancelado é removido antes
  de B entrar sem ministério; nenhuma chamada de importação ocorre para B.
  Casos positivos de primeiro login sem ministério permanecem cobertos.
- Fixtures JWT Preview: agente `/root/secondary` executou
  `npm test -- --run src/config/jwt-preview-security.test.ts`: PASS, 17 testes.
- Workflow staging: Python embutido validado por `ast.parse`; `mkdir` e escrita
  exercitados em diretório temporário isolado: PASS, exit 0. Workflow/build/APK:
  NOT_EXECUTED.
- `dart analyze` dirigido a providers, ApiClient/interceptor, repository/notifier,
  quatro arquivos de testes auth e teste app-router Share: PASS, exit 0,
  `No issues found!`. Log `mobile/build/m20-c7/analyze-final.log`.
- Após restaurar formatação prévia nos testes existentes, reexecução de
  repository/controller com `flutter test --no-pub` e
  `--timeout 20s --reporter expanded`: PASS, 32 testes, exit 0, log
  `mobile/build/m20-c7/auth-restored-format-tests.log`.
- `git diff --check` final: PASS, exit 0; status e diff/stat capturados em
  `mobile/build/m20-c7/`. Busca limitada de padrões de segredo no escopo C7:
  PASS (não é auditoria histórica exaustiva; nenhum `.env` lido).

## Firebase Auth Emulator — limite de evidência

Emulator local do projeto `demo-m20-c7` iniciado em `127.0.0.1:19099`,
com proxy de resposta controlada somente em loopback `127.0.0.1:19098`.
O harness usa FlutterFire real, contas locais `example.test`, persistência
desativada e mocks somente para perfil/preferences da aplicação. Nenhum
Firebase remoto, dispositivo ou dado de produção é utilizado.

Execução com SDK real: BLOCKED no carregamento do harness de testes Chrome
em Flutter 3.47.5/Windows; CanvasKit retorna 404 apesar dos arquivos locais
existirem. Roteamento de teste para os arquivos locais foi tentado uma vez;
o log permaneceu em `loading`, sem testes concluídos. Portanto consistência
do SDK real: **Unknown / Not yet verified**. Os 59 testes controlados não são
rotulados como execução FlutterFire/Emulator. Logs locais preservados:
`auth-emulator-tests.log` e `auth-browser-driver.log` em `mobile/build/m20-c7/`.
Processos locais encerrados; portas 19098/19099 confirmadas inacessíveis pelo
implementador. Teste Chrome interrompido com exit 1; driver encerrou com exit 0
após 90 segundos. `node --check` dos dois helpers: PASS, exit 0.

Harness reproduzível: `test/features/auth/data/auth_emulator_browser_test.dart`,
`tool/m20_c7_auth_proxy.mjs` e `tool/m20_c7_auth_browser_driver.mjs`.
Exige emulator demo na porta 19099 e proxy na 19098; habilitar explicitamente
`M20_C7_AUTH_EMULATOR=true` no teste Chrome. O teste verifica primeiro o
comportamento cru do SDK e depois a correção de produção para login/logout,
signup/logout, concorrência A/B e geração. Não executar contra ambiente remoto.

Comando tentado em `mobile/`:

```powershell
flutter test --no-pub --platform chrome --dart-define=M20_C7_AUTH_EMULATOR=true test/features/auth/data/auth_emulator_browser_test.dart --timeout 30s --reporter expanded
```

Para reproduzir o ambiente local, criar JSON temporário com
`emulators.auth={host:"127.0.0.1",port:19099}`, `ui.enabled=false`, hub em
19400 e logging em 19450 (ambos em loopback). Na raiz, iniciar
`node backend/node_modules/firebase-tools/lib/bin/firebase.js emulators:start
--only auth --project demo-m20-c7 --config <json-temporário>` e
`node mobile/tool/m20_c7_auth_proxy.mjs`. CLI 15.31.0 pronto e health HTTP 200
foram observados; isso não equivale à execução dos casos de autenticação.
Driver opcional recebe porta CDP do Chrome de teste e diretório CanvasKit local;
não alterar o SDK. Versões observadas: Flutter 3.47.5, Dart 3.13.4,
firebase_auth 6.7.0, platform interface 9.1.0, web 6.3.0.

O implementador preservou snapshots pré-C7 e um patch exclusivo das mudanças
auth; cópia local em `mobile/build/m20-c7/auth-task-only.patch`.
O diff contra HEAD contém também WIP anterior e não deve ser tratado como
uma lista exclusiva desta entrega.

## Matriz reproduzível

| Cenário | Evidência dirigida |
| --- | --- |
| Login pendente → logout → conclusão nativa/perfil | auth_session_race_test; app e Firebase fake permanecem sem usuário |
| Signup pendente → logout | provisioning, SDK e perfil controlados separadamente |
| Login A e B concorrentes | último intento vence; A limpo antes de B iniciar SDK |
| Troca A/B e eventos atrasados | A/null atrasados não substituem B nativo atual |
| `/auth/me` HTTP 200 antigo | descarte antes do cache/publicação |
| Login normal | geração inicial 1 → A 2 → B 3; evento antes/depois do Future |
| Logout com push pendente | invalidação imediata; logout antigo não encerra B |
| Falha e recuperação | SESSION_CHANGED limitado, refresh A→B, signup 401/401 sem deadlock |
| Share sem ministério | positivos de primeiro login e negativos de logout/cancelamento pelo router real |

## Revisão e dependências

- `/root/auth_fix`: writer auth mobile, Sol/high solicitado conforme política
  de concorrência/segurança. Implementação e testes controlados concluídos.
- `/root/secondary`: writer fixtures/workflow, feature-engineer. Ajustes concluídos.
- `/root/security_review`: feature-reviewer somente leitura. Revisão final
  SOURCE_SECURITY_REVIEW=PASS; nenhum achado BLOCKER/HIGH/MEDIUM aberto.
  Encontrou corrida do 401 durante refresh, corrigida e revalidada com regressão.
  Conferiu log final de 59 testes; não duplicou a execução. Identidade efetiva de inferência:
  **Unknown / Not yet verified**.
- Configuração hospedada Vercel/Firebase/Actions: **Unknown / Not yet verified**.
  API Preview exige `VERCEL_ENV=preview`, Firebase staging, JWT forte server-only,
  URL HTTPS canônica `/api/v1` e CORS exato. Caminhos legados de Preview sem
  `VERCEL_ENV=preview` exigem avaliação antes de qualquer escrita.
- Actions staging depende de `STAGING_API_BASE_URL` e segredos Firebase staging
  de projeto/API key/app ID/sender ID/storage bucket/google-services JSON.
  Nenhuma configuração remota foi lida ou modificada nesta etapa.
- C4C/C5D aceitos sem repetir homologação; sem Lenovo, produção, deploy,
  commit, push ou merge. Release não aprovado.

## Entrega e próximo gate

```text
M20_C7_VERDICT = PASS_LOCAL_SOURCE; SDK_EMULATOR_GATE_BLOCKED; release não aprovado
STALE_LOGIN_ROOT_CAUSE = OR permissivo no notifier + mutação nativa não cancelável + HTTP200 sem fence
STALE_SIGNUP_PROTECTION = PASS controlado em provisioning, sign-in nativo e perfil
LOGOUT_FENCING = PASS; invalidação imediata, fila nativa e logout antigo sem encerrar B
FIREBASE_SESSION_CONSISTENCY = PASS em mocks com currentUser independente; SDK real Unknown / Not yet verified
AUTH_ME_ISOLATION = PASS; contexto/intenção, HTTP200 e refresh401 antigos descartados
PENDING_SHARE_REGRESSION = PASS; 16 testes, incluindo router real e usuário sem ministério
JWT_PREVIEW_FIXTURES = PASS; fixtures staging isoladas, 17 testes
STAGING_WORKFLOW = PASS estático/Python; diretório criado; Actions NOT_EXECUTED
TESTS = 59 auth PASS; 16 share PASS; 17 JWT PASS; 32 revalidação PASS; analyze PASS; Emulator BLOCKED
FILES_CHANGED = relação abaixo; WIP anterior preservado
EVIDENCE = este documento e logs locais mobile/build/m20-c7
REMAINING_RELEASE_BLOCKERS = SDK real/emulator; configuração e fluxo hospedados isolados; compatibilidade/fallback físico conforme C6
NEXT_GATE = concluir homologação dirigida SDK Auth/Emulator em runner funcional; depois staging isolado sob autorização separada
```

Arquivos alterados pelo C7 (não confundir com diff cumulativo do WIP):

- `mobile/lib/app/providers.dart`
- `mobile/lib/core/http/auth_interceptor.dart`
- `mobile/lib/features/auth/data/auth_repository.dart`
- `mobile/lib/features/auth/presentation/controllers/auth_controller.dart`
- `mobile/test/features/auth/data/auth_repository_test.dart`
- `mobile/test/features/auth/data/auth_session_race_test.dart` (novo)
- `mobile/test/features/auth/data/auth_emulator_browser_test.dart` (novo)
- `mobile/test/features/auth/presentation/controllers/auth_controller_test.dart`
- `mobile/test/features/smart_chords/presentation/controllers/share_intent_app_router_test.dart`
- `mobile/tool/m20_c7_auth_proxy.mjs` (novo)
- `mobile/tool/m20_c7_auth_browser_driver.mjs` (novo)
- `backend/src/config/jwt-preview-security.test.ts`
- `.github/workflows/android-staging-apk.yml` (mkdir no WIP existente)
- plano e evidência C7. `ApiClient` foi inspecionado e analisado;
  alterações prévias desse arquivo foram preservadas, sem edição C7.

O bloqueador HIGH do código C6 foi corrigido e revisado. A etapa seguinte de
homologação está delimitada, mas não há alegação de prova com SDK real ou
aprovação de release. A captura Android continua sujeita às restrições do C6;
WebView/parser/Web/iOS não foram alterados nesta correção.

# M20-C8A: Revisão crítica de autenticação e preflight de staging

**Data:** 2026-10-29  
**Branch:** `feat/m20-phase-2a-android-share`  
**HEAD:** `e3c4902e0d8786e164ea0686486c564f9dea1578` (todo o WIP preservado)

---

## 1. Veredito e Resumo Executivo

- **M20_C8A_VERDICT = PASS_SOURCE_REVIEW_AND_LOCAL_HARDENING; PREFLIGHT_STAGING_READY**
- **AUTH_SECURITY_REVIEW = PASS** (correções de concorrência e sessão validadas por 79 testes mobile locais e regressão física C7B).
- **CALLBACK_LIFECYCLE = PASS** (`FirebaseAuthRepository.dispose()` limpa sessão e desacopla `_sessionContextProvider`; `ref.onDispose` usa guarda `identical(...)` contra sobreposição de callbacks em instâncias ativas do `ApiClient`).
- **PROVIDER_GRAPH = PASS** (resolvida a dependência circular silenciosa em `resetAuthenticatedFeatures` utilizando `ref.container`; notifiers de onboarding/invite e share são resetados e invalidados sem erro).
- **SESSION_FENCING = PASS** (respostas de rede em voo vinculadas à sessão são rejeitadas com `SESSION_CHANGED` mesmo se `sessionContextProvider` for desacoplado durante a requisição; `/auth/me` carrega as opções de sessão da invocação).
- **STAGING_CONFIGURATION = PASS** (`AppEnvironment.fromDartDefines()` no mobile sincronizado com o contrato exato do GitHub Actions: HTTPS estrito, sem userinfo/porta/query/fragmento e caminho canônico `/api/v1` em domínio Vercel Preview `-henriquecesarths-projects.vercel.app`).
- **FIREBASE_ISOLATION = PASS** (unificado `unifiedConfig.ts`: todo modo Preview via `isPreviewEnvironment()` seleciona exclusivamente credenciais `FIREBASE_STAGING_*` e falha fechado contra o projeto de produção `praise-app-7a362`, sanando o Finding 2 do C6).
- **JWT_PREVIEW = PASS** (19 testes no backend cobrindo rejeição de segredos inseguros, tokens forjados de desenvolvimento e isolamento estrito contra produção nos modos legado e explícito).
- **RELEASE_BLOCKERS = REMAINING: 0 NO CÓDIGO FONTE LOCAL.**
  - *Bloqueadores operacionais externos:* credenciais dedicadas do projeto Firebase Staging configuradas no GitHub Actions e Vercel Preview (variáveis hospedadas permanecem **Unknown / Not yet verified** até deployment autorizado); autorização explícita do usuário para deploy/escrita remota.
- **RECOMMENDED_FIXES = IMPLEMENTADOS E VALIDADOS LOCALMENTE.**
  1. `mobile/lib/app/providers.dart`: `resetAuthenticatedFeatures` resolvido via `ref.container` + desacoplamento idempotente em `ref.onDispose`.
  2. `mobile/lib/features/auth/data/auth_repository.dart`: `_disposed` guard, invalidação de sessão e desacoplamento do `_sessionContextProvider` em `dispose()`.
  3. `mobile/lib/core/http/auth_interceptor.dart`: `_isSessionActive` falha fechado se requisição possuir sessão vinculada e `sessionContextProvider` for nulo.
  4. `mobile/lib/app/environment/app_environment.dart`: validação canônica de URI de staging alinhada com o workflow.
  5. `backend/src/config/unifiedConfig.ts`: seleção de `FIREBASE_STAGING_*` e fail-closed unificados para `isPreviewEnvironment()`.
- **READY_FOR_STAGING = YES** (código local pronto para staging após provisionamento dos segredos externos).
- **EVIDENCE =**
  - Mobile tests: 79 PASS (exit 0) — `providers_circular_dependency_test.dart`, `auth_session_race_test.dart`, `auth_repository_test.dart`, `auth_controller_test.dart`, `auth_interceptor_test.dart`, `share_intent_app_router_test.dart`, `share_intent_router_test.dart`.
  - Static analysis: `dart analyze` — `No issues found!`.
  - Backend tests: 56 PASS (exit 0) — 19 `jwt-preview-security.test.ts`, 37 `preview-guard.test.ts`.
  - Formatting & diff integrity: `git diff --check` — PASS (exit 0).
- **CODEX_HANDOFF =**
  - Codex reassume como agente principal para as etapas hospedadas e aprovação final.
  - Nenhum commit, push, merge, deploy ou escrita remota foi realizado.
  - Dispositivo Lenovo intocado nesta revisão; testes físicos de autenticação e share aprovados em C7B mantidos como evidência durável.

---

## 2. Auditoria Técnica dos Diffs M20-C7/C7B/C8A

### 2.1 Ausência de Dependências Circulares (`PROVIDER_GRAPH`)
- **Problema prévio (C7):** `apiClientProvider` chamava `ref.read(authRepositoryProvider)` enquanto `authRepositoryProvider` chamava `ref.watch(apiClientProvider)`, gerando `CircularDependencyError` em runtime durante `/auth/me`.
- **Correção C7B:** Inversão de dependência — `authRepositoryProvider` injeta callbacks diretamente no `apiClient`.
- **Achado e Correção C8A:** Em `resetAuthenticatedFeatures`, o uso do `ref` do próprio `authRepositoryProvider` causava `CircularDependencyError` silencioso (capturado por `catch (_) {}`) ao tentar resetar `createMinistryNotifierProvider`, `joinMinistryNotifierProvider` e `inviteCodeNotifierProvider` (que observam `authNotifierProvider` -> `authRepositoryProvider`). A correção utilizou `ref.container` garantindo invocação no contêiner raiz sem ciclos de `ProviderElementBase`.

### 2.2 Ciclo de Vida e Desacoplamento de Callbacks (`CALLBACK_LIFECYCLE`)
- `FirebaseAuthRepository.dispose()` agora marca `_disposed = true`, avança geração/intenção (`_beginAuthIntent()`), invalida o `currentSessionContext` e remove `_sessionContextProvider` do `ApiClient` se ainda for idêntico.
- `authRepositoryProvider` armazena referências locais e apenas remove `tokenProvider` e `onAuthenticationFailed` do `ApiClient` caso ainda coincidam (`identical`), prevenindo sobrescrita de instâncias mais novas.

### 2.3 Fencing de Sessão e Interceptor (`SESSION_FENCING`)
- `AuthInterceptor._isSessionActive` conferia `sessionContextProvider == null` no topo, retornando `true` antes de verificar UIDs vinculados. Se o provider fosse descartado com uma resposta HTTP em voo, a resposta antiga era entregue. Corrigido para retornar `false` e cancelar com `SESSION_CHANGED` se a requisição continha contexto de sessão associado.
- `FirebaseAuthRepository.getMe()` passa explicitamente `sessionUserIdKey` e `sessionGenerationKey` nas `Options(extra: ...)` do Dio.

### 2.4 Preflight de Staging e Isolamento Firebase (`FIREBASE_ISOLATION`)
- `unifiedConfig.ts`: Unificada a seleção de staging para `isPreviewEnvironment()`. Qualquer modo Preview (incluindo `PREVIEW_MODE=true` ou `VERCEL=1`) seleciona exclusivamente `FIREBASE_STAGING_*` e lança erro caso credenciais staging estejam ausentes ou apontem para `praise-app-7a362`.
- `jwt-preview-security.test.ts`: Expandido com testes garantindo que modos legados falham fechado sem expor ou aceitar credenciais de produção.
- `android-staging-apk.yml`: O script Python embutido valida a presença de todas as variáveis staging, o pacote `com.louvaio.app.staging` e a rejeição de `praise-app-7a362`.
- `AppEnvironment.fromDartDefines()`: Restrito para exigir URL canônica HTTPS terminada em `/api/v1` em domínio `-henriquecesarths-projects.vercel.app`, impedindo desvios de configuração no app mobile.

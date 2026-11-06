# M20-C8B — Verificação de Isolamento Preview/Production

- Data: 2026-10-29
- Branch: `feat/m20-phase-2a-android-share`
- HEAD: `e3c4902e0d8786e164ea0686486c564f9dea1578` (WIP preservada)
- Agente: Gemini 4 Argon — High (subordinado temporário ao Codex)

---

## 1. Contexto e Diagnóstico

Conforme documentação oficial da Vercel:
- `VERCEL=1` (ou `'true'`) indica execução na plataforma Vercel em **todos** os ambientes (Production, Preview, Development/CLI). Não é um identificador exclusivo de Preview.
- A implementação anterior em `backend/src/config/unifiedConfig.ts`:
  ```ts
  if (process.env.VERCEL === '1' || process.env.VERCEL === 'true') {
    return true; // BUG: classificava qualquer deploy Vercel sem VERCEL_ENV explícito como Preview
  }
  ```
- Além disso, combinações contraditórias como `VERCEL_ENV=production` e `PREVIEW_MODE=true` silenciavam o erro e executavam com presunções ambíguas.

---

## 2. Correções Aplicadas

### `backend/src/config/unifiedConfig.ts`
1. **Autoridade de `VERCEL_ENV`**:
   - `VERCEL_ENV === 'production'` determina inequivocamente ambiente de Produção (`return false`).
   - `VERCEL_ENV === 'preview'` determina inequivocamente ambiente de Preview (`return true`).
2. **Fail-Closed em Conflitos (`CONFIG_CONFLICT`)**:
   - Se `VERCEL_ENV === 'production'` for combinado com `PREVIEW_MODE === 'true'` (ou `'1'`), dispara imediatamente `AppError(500, 'CONFIG_CONFLICT: VERCEL_ENV=production cannot be combined with PREVIEW_MODE=true.', { code: 'CONFIG_CONFLICT' })`.
3. **Plataforma Vercel (`VERCEL=1`) sem `VERCEL_ENV`**:
   - `VERCEL=1` sozinho indica execução na plataforma, mas **não presume Preview** (`return false`).
4. **Preview Local Explícito**:
   - Na ausência de `VERCEL_ENV` e `VERCEL`, `PREVIEW_MODE === 'true'` (ou `'1'`) ativa Preview localmente.
5. **Proteção JWT e Isolamento Firebase**:
   - `configSchema.refine` exige segredo JWT seguro em qualquer ambiente implantado (`isVercel || isPreview || production`).
   - Preview exige credenciais dedicadas `FIREBASE_STAGING_*` e bloqueia terminantemente o projeto de produção (`praise-app-7a362`).

---

## 3. Matriz de Testes Executada

Arquivo: `backend/src/config/jwt-preview-security.test.ts` e `backend/src/middleware/preview-guard.test.ts`.

| VERCEL | VERCEL_ENV | PREVIEW_MODE | Comportamento Observado | Status |
|---|---|---|---|---|
| `1` | `production` | ausente | Produção (`isPreviewEnvironment() === false`) | PASS |
| `1` | `preview` | ausente | Preview (`isPreviewEnvironment() === true`) | PASS |
| `1` | `production` | `true` | Erro `CONFIG_CONFLICT` (fail closed) | PASS |
| `1` | `preview` | `true` | Preview (`isPreviewEnvironment() === true`) | PASS |
| ausente | ausente | `true` | Preview local explícito (`isPreviewEnvironment() === true`) | PASS |
| `1` | ausente | ausente | Não presume Preview (`isPreviewEnvironment() === false`) | PASS |

---

## 4. Resultados de Verificação

1. **Vitest Backend**:
   - Comando: `npm --prefix backend test -- --run src/config/jwt-preview-security.test.ts src/middleware/preview-guard.test.ts`
   - Resultado: **63 passed (63/63)**
2. **Compilação TypeScript (`tsc`)**:
   - Comando: `npm --prefix backend run build`
   - Resultado: **0 erros (código 0)**
3. **Sintaxe e Whitespace**:
   - Comando: `git diff --check`
   - Resultado: **PASS**

# Validation Protocol

## Official Sequence

Use somente etapas aplicáveis à mudança:

1. Confirmar escopo com `git status`.
2. Instalar dependências com lockfile (`npm ci`), se necessário.
3. Compilar e testar backend quando backend ou contratos compartilhados forem afetados.
4. Compilar e testar web quando frontend ou contratos forem afetados.
5. Executar suíte E2E quando fluxos de ponta a ponta forem modificados.
6. Fazer smoke test apenas em ambiente explicitamente seguro.
7. Revisar git diff, arquivos novos, paths citados e ausência de secrets.
8. Atualizar ExecPlan/documentação.

## Commands

### Dependency installation

    cd backend
    npm ci

    cd ../web
    npm ci

Não é necessário reinstalar em toda tarefa quando node_modules corresponde ao lockfile.

### Backend build & tests

    cd backend
    npm run build
    npm test

Equivalente de build: `tsc`. Executa `vitest run` para suíte unitária/integrada.

### Web build & tests

    cd web
    npm run build
    npm test
    npm run test:e2e

Executa `tsc && vite build` para build, `vitest run` para unitários e `playwright test` para jornadas E2E locais.

### Backend lint status check

    cd backend
    npm run lint

Este comando existe no package.json, mas espera-se falha no estado atual porque ESLint/configuração não estão instalados. Não use a presença do script para declarar lint operacional.

## Git Review

    git status --short
    git diff --check
    git diff --stat
    git diff -- README.md GEMINI.md AGENTS.md MEMORY.md docs/

## Documentation-specific Checks

- Todo path/classe citado existe ou está marcado ausente.
- Não há referências vigentes a Mobile/Supabase como implementação ativa.
- Todas as variáveis são somente nomes, sem valores.
- Unknown / Not yet verified é usado em lacunas reais.
- MEMORY.md não contém log de sessão nem detalhes descartáveis.
- ExecPlans concluídos saem de active/.
- Markdown não contém links internos quebrados.

## Result Reporting

Use status real:

    Backend build: PASS/FAIL
    Backend tests: PASS/FAIL
    Web build: PASS/FAIL
    Web tests: PASS/FAIL
    Backend lint: PASS/FAIL/NOT OPERATIONAL
    E2E: PASS/FAIL/NOT RUN — reason
    Diff review: PASS/FAIL

Uma falha preexistente não deve ser escondida. Registre comando, mensagem essencial, impacto e se algum arquivo funcional foi alterado.

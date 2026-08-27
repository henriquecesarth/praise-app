# Validation Protocol

## Official Sequence

Use somente etapas aplicáveis à mudança:

1. Confirmar escopo com git status.
2. Instalar dependências com lockfile, se necessário.
3. Compilar backend quando backend ou contratos compartilhados forem afetados.
4. Compilar/bundlear web quando frontend ou contratos forem afetados.
5. Executar testes/lint somente se estiverem realmente configurados.
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

### Backend build

    cd backend
    npm run build

Equivalente declarado: tsc. Produz backend/dist/, que é ignorado.

### Web build

    cd web
    npm run build

Executa tsc e vite build. Produz web/dist/, que é ignorado.

### Backend lint status check

    cd backend
    npm run lint

Este comando existe no package.json, mas espera-se falha no estado atual porque ESLint/configuração não estão instalados. Não use a presença do script para declarar lint operacional.

### Tests

Frontend:

    cd web
    npm test
    npm run build
    npm run test:e2e

Os E2E usam fixtures HTTP locais. O backend não possui comando de testes.

## Git Review

    git status --short
    git diff --check
    git diff --stat
    git diff -- README.md GEMINI.md AGENTS.md MEMORY.md docs/

Para arquivos ainda untracked, git diff não exibe conteúdo por padrão; inclua uma listagem com rg --files docs e leia os documentos diretamente.

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
    Web build: PASS/FAIL
    Backend lint: PASS/FAIL/NOT OPERATIONAL
    Backend tests: NOT AVAILABLE
    Web tests: PASS/FAIL
    E2E: PASS/FAIL/NOT RUN — reason
    Diff review: PASS/FAIL

Uma falha preexistente não deve ser escondida. Registre comando, mensagem essencial, impacto e se algum arquivo funcional foi alterado.

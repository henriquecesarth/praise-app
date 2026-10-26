---
tags:
  - louvaio
  - agentes
  - desenvolvimento
type: runbook
status: piloto
---

# LouvAIO — Execução multiagente orientada a tempo de entrega

## Objetivo

Reduzir o tempo até **código integrado + revisão independente + testes verificáveis**. A quantidade de tokens não é métrica principal. Não confundir paralelismo com concorrência de escrita no mesmo arquivo.

## Ferramentas e fronteiras

| Ferramenta | Papel | Fonte de configuração |
| --- | --- | --- |
| Obsidian | contexto, decisões e navegação | `docs/` como vault |
| Antigravity CLI (`agy`) | orquestração e implementação principal | `.agents/agents/`, `GEMINI.md` |
| Gemini CLI nativo (`gemini`) | alternativa opcional com autenticação própria | `.gemini/agents/` |
| Codex CLI (`codex`) | revisão independente / investigação paralela | `.codex/config.toml`, `.codex/agents/` |
| GitHub | versionamento, PRs e CI; Issues opcionais | `.github/workflows/` |

**Piloto disponível:** `scripts/Invoke-LouvAioReadOnlyPilot.ps1` coordena duas análises locais em paralelo e salva evidências. A coordenação automática de escrita/PRs ainda não existe; os relatórios e diffs de implementação continuam convergindo pelo GitHub. A autenticação do `agy` não configura a do Gemini CLI nativo.

## Plano de execução por tarefa

1. **Discovery breve:** identificar tarefa em prompt/Markdown, branch-base real, arquivos afetados, interfaces e contratos.
2. **Decomposição:** explicitar dependências. Primeiro fixar contratos da API se Web e Flutter forem avançar em paralelo.
3. **Pesquisa paralela (read-only):** delegar mapeamento de código, segurança/tenant, análise de regressão. Esses agentes não escrevem arquivos.
4. **Implementação:** um escritor por arquivo. Para Web, Backend e Mobile simultâneos, usar branches/worktrees diferentes, escopos de arquivos distintos e base comum declarada.
5. **Revisão independente:** Codex revisa um diff estável (commit ou PR) e sugere falhas; não aprova mudança sem executar/inspecionar evidências.
6. **Integração:** combinar mudanças em ordem de dependência, reexecutar builds/testes pós-integração e atualizar a descrição do Draft PR.
7. **Handoff:** publicar links para PR, workflow, arquivos, resultados e lacunas. Manter decisão de merge/deploy com o responsável humano.

## Exemplos de propriedade de arquivos

- **Backend:** `backend/src/`; contratos e endpoints (primeiro fixar com consumidores).
- **Web:** `web/src/`; depende de API estabilizada.
- **Mobile:** `mobile/lib/`, `mobile/test/`; depende da mesma API.
- **Revisão:** somente leitura de PR, código e testes; não modificar arquivos da feature.
- **Documentação compartilhada:** um integrador altera `AGENTS.md`, `MEMORY.md`, `docs/` e contratos comuns depois de reunir as entregas.

Se dois agentes precisarem do mesmo arquivo, eles não trabalham simultaneamente nele. O orquestrador sequencia, redefine fronteiras ou usa patch aplicado por único integrador.

## Operação manual no Windows (sem nova API key)

Em um checkout limpo, na raiz do repositório:

```powershell
git status --short
gh auth status
agy --version
codex --version
agy
```

Na sessão `agy`, execute `/agents` para conferir os agentes carregados. Se o cliente/plano oferecer `/teamwork-preview`, experimente em **uma** tarefa isolada; confirme na versão instalada, pois não há teste de execução dessa funcionalidade neste PR.

**Prompt inicial para o Antigravity:**

> Leia AGENTS.md, GEMINI.md, docs/01-CONTEXTO-ATUAL.md e docs/development/multi-agent-workflow.md. Para a tarefa descrita pelo usuário, confirme a branch-base e trabalhe em branch isolada. Delegue em paralelo investigação dos contratos, auditoria de segurança e plano de testes com agentes read-only. Congele o contrato compartilhado antes de implementar. Se o escopo permitir backend/web/mobile simultâneos, use worktrees isolados e um escritor por arquivo. Execute validações reais e prepare Draft PR com evidência e riscos. Não faça merge, deploy ou mudanças de produção.

Em **outro terminal**, para revisão do PR já publicado, escolha checkout read-only/cópia de trabalho distinta:

```powershell
codex
```

**Prompt inicial para o Codex:**

> Revise de forma independente o PR #NUMERO do LouvAIO, baseando-se no diff e nos contratos do código. Divida, se disponível, entre análise de segurança multi-tenant, contratos API Web/Mobile e regressões/testes. Não altere o código nem faça push; reporte achados priorizados, com paths/linhas e evidências. Se faltar acesso ao PR, informe e não invente resultados.

Observação: `codex` e `agy` requerem instalação/login local; o GitHub deste PR não os executa automaticamente.

## Branches e worktrees

Para trabalho dependente da WIP atual, crie worktrees com nomes de tarefa e base explicitada no plano:

```powershell
git fetch origin
git worktree add -b feat/repertorio-web ..\louvaio-repertorio-web origin/wip/repertoire-versions-smartchords-20261022
git worktree add -b feat/repertorio-mobile ..\louvaio-repertorio-mobile origin/wip/repertoire-versions-smartchords-20261022
```

Criar diretórios separados é apenas o isolamento de Git. Não autoriza iniciar automaticamente dois processos sem conferir contratos, dependências, permissões e limites de cada CLI.

Após integrar, conferir:

```powershell
git diff --check
gh pr checks <NUMERO-PR>
gh run list --limit 5
```

### Evidência mínima exigida

| Campo | Obrigatório |
| --- | --- |
| Tarefa / base e HEAD (PR se publicado) | Sim |
| Agente, papel e caminhos sob responsabilidade | Sim |
| Commits e arquivos modificados | Sim |
| Testes realmente executados (comandos, exit code, URL) | Sim |
| Falhas, riscos e lacunas não verificadas | Sim |
| Tempo de execução / tempo de espera | Quando medido |
| Decisão de merge e deploy | Humana, nunca automática |

## Como medir se ficou mais rápido

Compare duas tarefas de complexidade semelhante usando: **tempo entre início da tarefa e PR com CI verde**, retrabalho (número de ciclos de revisão), regressões e dependências bloqueadas. Medir também o custo de orquestração/conflitos. Ganho real = menos tempo para mudança validada, não mais agentes iniciados.

## Guarda-corpos

- Nada de `git push --force`, merge, deploy, rotação de secrets ou escrita em Firebase real sem autorização explícita.
- Não misturar changes de branches WIP no `main` antes da validação de integração.
- Agentes read-only devem ter ferramentas de leitura, não de escrita, quando o runtime permitir política efetiva.
- Não reutilizar `MEMORY.md` inteiro como prompt automático.
- Verificar UX/device real apenas onde testes automatizados não podem demonstrar comportamento.


## Auditoria de configuração em 26/10/2026

A auditoria independente confirmou Codex CLI 0.164.0, Antigravity CLI 1.4.7 e descoberta dos seis papéis. No Windows há múltiplas instalações do Codex no PATH; o supervisor registra o executável resolvido e a versão. O usuário conseguiu iniciar a sessão interativa do Codex com `codex --no-daemon`; para automação usar `codex exec` e não pressupor que essa opção interativa seja necessária.

**Limites ainda existentes**: regras read-only em Markdown não são uma fronteira de segurança; portas/fixtures/serviços e credenciais não são isolados por Git worktree. GitHub Actions existentes focam Flutter e não substituem gates Web/Backend. Ver `docs/development/multiagent-pilot.md`.

### E2E por worktree

O Playwright lê `LOUVAIO_E2E_PORT` (padrão 4173) e usa `--strictPort`. Reutilização de servidor é desativada por padrão, inclusive fora de CI, para não testar artefatos do HEAD errado. Apenas em uso manual deliberado, `LOUVAIO_E2E_REUSE_SERVER=1` reativa o reuso, e o operador assume a verificação do commit servido.

Exemplo no PowerShell, após build e com a pasta `web/` selecionada:

```powershell
$env:LOUVAIO_E2E_PORT = "4183"
npm run test:e2e
Remove-Item Env:\LOUVAIO_E2E_PORT
```

### Piloto automatizado seguro

No checkout **limpo** do branch do piloto, execute `.scriptsInvoke-LouvAioReadOnlyPilot.ps1` para pré-visualizar e, após inspeção das permissões, `.scriptsInvoke-LouvAioReadOnlyPilot.ps1 -Execute` para rodar Antigravity e Codex simultaneamente, ambos em tarefas informativas. Saídas locais em `.logs/multiagent/` (não versionadas). O processo verifica código de saída, estados e integridade do working tree, mas **não garante isolamento de escrita do Antigravity se seu sandbox não estiver disponível**. Não há merge, push ou deploy pelo script.

## Forma preferida de entrada (26/10/2026)

Não exigir GitHub Issues. O usuário envia o trabalho como texto livre no CLI ou como arquivo Markdown em `docs/`. O piloto `scripts/Invoke-LouvAioTask.ps1` recebe `-Task` ou `-TaskFile`, realiza preflight, e com `-Execute` inicia análises paralelas do Antigravity e Codex sem alterar código. Consulte `docs/development/task-first-multiagent.md`. A implementação automatizada em worktrees é uma etapa separada que exige validações adicionais.

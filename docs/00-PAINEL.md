---
aliases:
  - Painel LouvAIO
tags:
  - louvaio
  - projeto
type: dashboard
status: ativo
---

# LouvAIO — Painel do Projeto

> Este vault é a pasta `docs/` do repositório; O Obsidian organiza conhecimento e o GitHub versiona o código. As tarefas começam com prompts diretos ou arquivos de planejamento; não exigir GitHub Issues.

## Comece aqui

- [[01-CONTEXTO-ATUAL|Contexto atual e fontes de verdade]]
- [[system-status|Matriz de status técnico]]
- [[development/multi-agent-workflow|Fluxo multiagente Gemini / Codex]]
- [[development/task-first-multiagent|Como iniciar uma tarefa diretamente]]
- [[development/github-ai-handoff|Integração ChatGPT, GitHub e Antigravity]]
- [[development/testing|Testes e validação]]
- [[mobile/architecture|Arquitetura mobile]]

## Fluxo de trabalho

1. Consulte contexto e status relevantes antes de iniciar uma tarefa.
2. Descreva o objetivo diretamente ao Antigravity/Codex ou use uma nota Markdown do Obsidian. GitHub Issues são opcionais e não fazem parte do fluxo padrão.
3. Para mudanças não triviais, mantenha um plano em `exec-plans/active/`.
4. Execute em branch/worktree isolada; acompanhe logs em `gh pr checks` e GitHub Actions.
5. Após revisão e testes, atualize a documentação atingida e arquive o plano em `exec-plans/completed/`.

## Navegação de áreas

- **Produto:** `product/` e `business/`
- **Arquitetura:** `architecture/` e `decisions/`
- **Código e processos:** `development/`
- **Mobile:** `mobile/`
- **Releases e produção:** `operations/`
- **Segurança:** `security/`
- **Execuções:** `exec-plans/`
- **Passagens de contexto:** `handovers/`

## Projeto e monitoramento

- [Repositório](https://github.com/henriquecesarth/praise-app)
- [Pull requests](https://github.com/henriquecesarth/praise-app/pulls)
- [GitHub Actions](https://github.com/henriquecesarth/praise-app/actions)

**Regra:** entrada de tarefas por prompt ou Markdown; GitHub registra commits, PRs e CI quando utilizados. Este painel fornece contexto, não uma fila obrigatória.

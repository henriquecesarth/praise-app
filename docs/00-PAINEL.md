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

> Este vault é a pasta `docs/` do repositório; GitHub controla o trabalho e o Obsidian organiza o conhecimento. Não duplicar backlogs nem relatar aprovações sem evidência.

## Comece aqui

- [[01-CONTEXTO-ATUAL|Contexto atual e fontes de verdade]]
- [[system-status|Matriz de status técnico]]
- [[development/multi-agent-workflow|Fluxo multiagente Gemini / Codex]]
- [[development/github-ai-handoff|Integração ChatGPT, GitHub e Antigravity]]
- [[development/testing|Testes e validação]]
- [[mobile/architecture|Arquitetura mobile]]

## Fluxo de trabalho

1. Consulte contexto e status relevantes antes de abrir uma Issue.
2. Registre a tarefa no **GitHub Issues** (não use o Obsidian como fila concorrente).
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

- [Issues](https://github.com/henriquecesarth/praise-app/issues)
- [Pull requests](https://github.com/henriquecesarth/praise-app/pulls)
- [GitHub Actions](https://github.com/henriquecesarth/praise-app/actions)

**Regra:** status vivo de tarefas = GitHub. Este painel fornece caminhos, decisões e contexto; nunca substitui a leitura de código, testes ou PR.

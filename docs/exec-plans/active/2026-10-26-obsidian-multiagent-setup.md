---
tags:
  - louvaio
  - planejamento
type: exec-plan
status: piloto
---

# ExecPlan — Obsidian + orquestração multiagente

Data: 2026-10-26. Base: `wip/repertoire-versions-smartchords-20261022`. Branch de preparação: `chore/obsidian-multiagent-workflow-20261026`.

## Objetivo e limites

Organizar o vault de documentação e padronizar descoberta, isolamento e validação de agentes Antigravity, Gemini CLI opcional e Codex. **Não** implementar ou modificar funcionalidades do produto nem realizar merge/deploy.

## Entregas nesta branch

- [x] Painel de navegação do Obsidian e resumo operacional compacto.
- [x] Runbook com regras de execução paralela, worktrees e handoff.
- [x] Ajustar instruções de agentes e documentação desatualizada sobre mobile/CI.
- [x] Configurar limite explícito de subagentes Codex (até 4 filhos por sessão).
- [x] Criar adaptadores opcionais para subagentes Gemini CLI nativo.
- [ ] Verificar localmente descoberta dos agentes em `agy /agents`.
- [ ] Verificar localmente `codex`, limites, revisão read-only e licença/credenciais.
- [ ] Executar piloto de uma Issue real, medir duração/retrabalho e atualizar o plano.
- [ ] Validar eventual `/teamwork-preview` se disponível na versão/plano instalados.

## Critérios de saída

O piloto encerra quando: agentes aparecem corretamente nas CLIs, worktrees não conflitam, uma Issue chega a um Draft PR revisado com CI aplicável, resultados são verificáveis e `docs/01-CONTEXTO-ATUAL.md` foi atualizado. Até lá, manter este plano em `active/` e marcar **Unknown / Not yet verified** para resultados locais.

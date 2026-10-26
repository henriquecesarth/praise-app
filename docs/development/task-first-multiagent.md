---
tags:
  - louvaio
  - agentes
  - workflow
type: runbook
status: piloto
---

# Desenvolvimento multiagente — entrada por tarefa, sem GitHub Issues

## Decisão operacional

**O LouvAIO não utiliza GitHub Issues como entrada do trabalho dos agentes.** A maneira real de iniciar trabalho é passar uma solicitação em linguagem natural diretamente ao Antigravity/Codex (ou registrá-la em uma nota do Obsidian, quando útil).

GitHub é o local de código, branches, revisão, PRs e CI **quando houver uma publicação expressamente autorizada**. Não exigir `gh issue view`, rótulos `ai:ready` ou um número de Issue.

## Fluxo escolhido

1. Usuário define o objetivo em texto direto ou nota Markdown do Obsidian.
2. `scripts/Invoke-LouvAioTask.ps1` faz preflight de Git e das duas CLIs.
3. `-Execute` coordena duas investigações independentes em paralelo:
   - Antigravity pesquisa implementação, contratos, testes e pode mobilizar seus subagentes;
   - Codex pesquisa riscos, autorização, testes e regressões de forma independente.
4. Supervisor grava um `RUN_ID`, duração, saída/erros locais e resultado `COMPLETE`, `DEGRADED` ou `FAILED`. O supervisor exige Git sem alterações, mas **não substitui sandbox de SO**.
5. A execução de código em worktrees isolados **será uma fase futura**, com seleção de paths e contrato compartilhado, integração, testes, revisão Codex sobre o SHA e autorização específica para publicar Draft PR.

## Como utilizar no Windows

Abra um terminal no worktree com esta branch e execute o preflight:

```powershell
.\scripts\Invoke-LouvAioTask.ps1 -Task "Investigar e planejar a preservação de BPM textual entre Backend e Web, com testes de regressão"
```

Para executar a investigação paralela:

```powershell
.\scripts\Invoke-LouvAioTask.ps1 -Task "Investigar e planejar a preservação de BPM textual entre Backend e Web, com testes de regressão" -Execute
```

Ou usando uma nota de planejamento já existente no Obsidian:

```powershell
.\scripts\Invoke-LouvAioTask.ps1 -TaskFile ".\docs\exec-plans\active\minha-tarefa.md" -Execute
```

Não há necessidade de criar notas para cada solicitação; use `-Task` para tarefas curtas.

Os arquivos de execução ficam em `.logs/tasks/<RUN_ID>/` e são ignorados pelo Git. O `summary.json` separa resultado principal e degradação interna de delegação. **Nunca envie stdout/stderr bruto sem inspecionar se contém segredos.**

## Limitações do piloto

- Este script é exclusivamente para **pesquisa e planejamento read-only**, não para modificação de código.
- `agy --sandbox` precisa de verificação de enforcement real no Windows; prompt de somente leitura e verificação Git não fornecem isolação garantida.
- Em timeout de job PowerShell, pode haver processos filhos persistentes. Confirmar o encerramento antes de iniciar outra execução.
- `turn.completed` do Codex é conclusão do turno principal; falhas como `collab spawn failed` geram resultado `DEGRADED`.
- O Obsidian não aciona automaticamente agentes; é a interface de documentação, não a fila obrigatória de tarefas.
- O GitHub não recebe logs automaticamente.
- Não marca testes de produto como executados e não permite publicar PR ou fazer deploy.

## Próxima fase planejada

Supervisor a partir de **texto livre ou TaskFile**, nunca de Issue; trabalho isolado em worktrees, provas de testes, revisão Codex e Draft PR opcional após aprovação. Um único proprietário por arquivo para escrita paralela; coordenação contratual entre Backend/Web/Mobile antes de simultaneidade.

## Links

- [[multi-agent-workflow|Regras gerais de agentes]]
- [[multiagent-pilot|Resultado do primeiro piloto]]
- [[../00-PAINEL|Painel inicial]]

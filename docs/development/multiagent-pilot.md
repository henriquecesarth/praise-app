---
tags:
  - louvaio
  - agentes
  - piloto
type: runbook
status: local-validation-required
---

# Piloto local — Antigravity + Codex em paralelo

## Escopo

O script `scripts/Invoke-LouvAioReadOnlyPilot.ps1` inicia uma pesquisa do Antigravity e uma auditoria do Codex **simultaneamente**, cada uma em um processo PowerShell separado, utilizando apenas a conta já autenticada nas respectivas CLIs. Este é um piloto de coordenação e observabilidade, não de escrita de código.

**Ainda não foi executado no Windows do usuário.** Apenas a estrutura e os comandos foram preparados e precisam de aceitação local. O projeto não requer uma nova chave API.

## Pré-requisitos

- Windows PowerShell 5.1 ou PowerShell 7, Git e GitHub CLI instalados.
- Antigravity CLI 1.4.7 e Codex CLI 0.164.0 descobertos no PATH; conferir executável realmente escolhido porque existem outras versões no computador.
- Login local das duas CLIs e modelo Codex compatível com login ChatGPT (o padrão anterior `gpt-6.1-sol` gerou erro de modelo).
- Um worktree **limpo** da branch do piloto, sem alterações do Obsidian pendentes. Não descarte nem sobrescreva o `docs/00-PAINEL.md` já editado no worktree antigo.

## Executar

No PowerShell, na raiz do novo worktree:

```powershell
.\scripts\Invoke-LouvAioReadOnlyPilot.ps1
# Inspecione versões, caminhos e branch. Nenhum agente é iniciado nesse passo.

.\scripts\Invoke-LouvAioReadOnlyPilot.ps1 -Execute
# Se necessário, selecione um modelo liberado:
# .\scripts\Invoke-LouvAioReadOnlyPilot.ps1 -Execute -CodexModel "MODELO_DISPONIVEL"
```

Saída: `.logs/multiagent/<RUN_ID>/` contendo `manifest.json`, logs separados de stdout/stderr e `summary.json` com HEAD, duração, estado e integridade do working tree. Logs podem conter conteúdo sensível e devem permanecer locais; nunca publicar logs brutos de autenticação.

## Critérios de PASS

- Ambos os jobs encerram com exit code 0.
- Antigravity reporta `status: SUCCESS` no JSON final.
- Codex emite evento JSONL `turn.completed`.
- O Git HEAD e o working tree permanecem inalterados.
- Durações são registradas para comparar o tempo total do trabalho paralelo contra execuções sequenciais.

## Limitações explícitas

- `agy --sandbox` tem comportamento dependente de suporte real do sistema; se indisponível no host, **não garante read-only**. Prompt e verificação posterior detectam mudanças, mas não são barreira contra escrita ou serviços externos.
- O modo `codex exec --sandbox read-only` restringe a execução no sandbox Codex. Subagentes herdam a política do processo principal.
- Não cria worktrees, realiza merge, push, PR, deploy nem chamadas a Firebase real.
- O script não adiciona novos gates de CI e não elimina colisões em portas, emulador Firestore ou fixtures; isso requer fases posteriores.
- Em caso de timeout/interrupção, examine os processos remanescentes antes de iniciar nova execução; o encerramento de processos filhos no Windows ainda precisa de teste.

## Fases posteriores, após PASS local

1. Supervisor com manifesto por Issue, RUN_ID, base/HEAD, paths, portas e dependências.
2. Execução em worktrees separadas para tarefas **com permissão de escrita explícita**.
3. Revisão independente por SHA e integração sequencial, sem aceitar relatório de commit anterior.
4. CI de PR com jobs Web/Backend/Mobile e validação de isolamento de E2E/emulador.
5. Atualização do Obsidian apenas com decisões duráveis e links aos relatórios verificados.

## Resultado do primeiro piloto local (evidência relatada em 26/10/2026)

Execução no worktree `local/multiagent-pilot`, HEAD `193bff7b349aebd868e3a3d1fddb8505013bb58f`, `RUN_ID=20261026-102504-395fe087`. Saída terminal fornecida pelo operador:

| Executor | Versão | Exit code | Resultado terminal | Duração |
| --- | --- | ---: | --- | ---: |
| Antigravity | 1.4.7 | 0 | `SUCCESS` | 729,79 s |
| Codex | 0.164.0 | 0 | `turn.completed` | 156,32 s |

- Os dois executores produziram arquivos stdout e o supervisor gerou `summary.json`.
- Comparação ilustrativa: soma sequencial de durações = **886,11 s**; trabalho paralelo dominado pela execução mais longa = **729,79 s** (~17,6% de economia em relação à soma; exclui overhead). Não inferir produtividade de produto a partir de um teste de pesquisa.
- O `git status --short` foi informado vazio durante a execução. O script também exige working tree e HEAD inalterados antes do encerramento normal; o valor explícito `unchanged` do `summary.json` não foi colado na conversa.
- O log stderr do Codex **contém erros não fatais para o turno principal**: `failed to refresh available models: request timed out` e `collab spawn failed: ... no rollout found for thread id`. Portanto, **execução principal = PASS**, **subagentes internos do Codex = NOT_VERIFIED/DEGRADED**. Nunca converter `turn.completed` automaticamente em sucesso de todas as subtarefas.
- O sucesso final do Antigravity veio perto do limite de `--print-timeout 12m`; inspecionar se todas as tarefas esperadas foram concluídas ou somente finalizadas por orçamento de tempo.

**Veredito atual:** piloto de coordenação concorrente concluído com resultados terminais positivos; delegação interna e isolamento efetivo ainda não homologados. Antes de habilitar implementação automática, aprimorar o supervisor para separar `PROCESS_OK`, `TASK_OK`, `DELEGATION_OK`, `GIT_CLEAN` e `EVIDENCE_COMPLETE`. Não executar novamente apenas para repetir o mesmo teste; verificar evidências existentes e passar a um piloto de Issue isolada.

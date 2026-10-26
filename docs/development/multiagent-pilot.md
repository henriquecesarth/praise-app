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

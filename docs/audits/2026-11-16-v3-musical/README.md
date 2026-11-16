# LouvAIO V3 Musical — Fase 0

Data: 2026-11-16. Auditoria de código e planejamento, sem implementação. As propostas abaixo não equivalem a aprovação para iniciar a Fase 1.

## Entregáveis

- [Inventário, matriz de reaproveitamento e evidências](audit.md).
- [ADR: motor musical determinístico](../../decisions/2026-11-16-v3-musical-theory-engine.md).
- [ADR: player ligado à versão](../../decisions/2026-11-16-v3-musical-version-player.md).
- [ADR: Local First e Pacote de Ensaio](../../decisions/2026-11-16-v3-musical-local-first-package.md).
- [Protocolo da POC de separação](separation-poc.md).
- [Custos, riscos e gates](costs-risks-gates.md).
- [Roadmap incremental / ExecPlan](../../exec-plans/active/2026-11-16-v3-musical-phase-1-proposal.md).

## Decisão obrigatória do proprietário

Áudio original e faixas separadas ficam em arquivos locais. Nenhum áudio binário, base64, blob, chunk, original ou stem será persistido em Firestore ou outros bancos do LouvAIO. Não haverá upload automático, bucket central ou API paga de separação. Índices locais podem guardar apenas metadados e referências a arquivos. Nenhum manifesto, hash de áudio ou vínculo novo será enviado ao servidor nesta proposta.

## Referência auditada

- Diretório inicial: `<repository>`.
- Branch inicial: `feat/m20-phase-2a-android-share`; HEAD `452a2558e9fbb16e509a99a682c368e329821d15`. Árvore já continha alterações e arquivos não rastreados; preservada.
- Base escolhida: worktree existente `.worktrees/louvaio-audit-remediation`, branch `fix/louvaio-audit-remediation-20261113`, HEAD `6d77ace34a1c63965e0968980f94bb73f8b22af7`, limpo antes destes documentos.
- `git worktree list --porcelain`: 19 worktrees existentes; nenhum criado, removido ou trocado. Relação registrada em [git-reference.json](git-reference.json).
- Para publicação do checkpoint F0, caminhos pessoais foram substituídos por `<repository>` e `<workspace>` no snapshot e neste relatório; branches e SHAs foram preservados. O snapshot continua sendo evidência histórica anterior ao commit documental.
- `git for-each-ref --sort=-committerdate`: a referência indicada é a branch local com commit mais recente. `origin/fix/...` local aponta para o mesmo HEAD. Atualidade remota após o último fetch: **Unknown / Not yet verified**; não houve fetch nem acesso à produção.
- `docs/01-CONTEXTO-ATUAL.md` e `docs/00-PAINEL.md` não existem nesta base. Consultados `docs/system-status.md`, contratos e ExecPlans pertinentes, sem ler MEMORY.md.

## Equipe e método

Delegação real, contexto separado e somente leitura: `/root/audit_theory` (Frente A), `/root/audit_player` (Frente B), `/root/research_local_audio` (C/D e fontes primárias). Modelos efetivos dos investigadores: **Unknown / Not yet verified**. Revisão independente da proposta: `/root/review_v3`, papel `feature-reviewer`, somente leitura; resultado registrado em `costs-risks-gates.md`. Único escritor: agente principal, apenas documentos novos.

Leitura de testes existentes comprova cobertura declarada, não execução. Testes/builds de produto e processamento de áudio: **NOT_EXECUTED** por escopo. Evidência insuficiente usa **Unknown / Not yet verified**. Validação documental e revisão estão no relatório de gates.

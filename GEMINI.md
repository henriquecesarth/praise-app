# LouvAIO — ferramenta opcional Gemini

@./AGENTS.md

- Codex é o agente principal e obrigatório para todas as reviews feitas por um agente (use o Antigravity para review somente se o Codex estiver comprovadamente indisponível); sempre que usar um modelo no Codex, use **Sol 6.2 high** (`-m gpt-6.2-sol -c model_reasoning_effort="high"`). Gemini e Claude são ferramentas opcionais; nenhuma tarefa exige chamá-los ou repetir revisão equivalente.
- Siga AGENTS.md e `docs/development/multi-agent-workflow.md`; não mantenha hierarquia de modelos duplicada neste arquivo.
- Consulte contexto/documentos apenas por escopo com rg e trechos limitados. Nunca importe ou leia MEMORY.md integralmente por padrão; registre nele somente decisões duráveis.
- Preserve a branch, HEAD, alterações locais e contratos observados. Issues são opcionais; não assuma main como destino de trabalho WIP.
- Sem autorização separada: nenhum push, PR, merge, deploy ou escrita externa/produção. Não exponha credenciais nem declare validação sem evidência.

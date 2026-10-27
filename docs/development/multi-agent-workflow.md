---
aliases:
  - Protocolo Multiagente Permanente V2
  - Multi-agent Workflow
tags:
  - louvaio
  - agentes
  - workflow
  - protocolo
type: runbook
status: ativo
---

# LouvAIO — protocolo nativo de agentes

AGENTS.md contém os invariantes de arquitetura, segurança, Git e validação. Codex é o principal; Gemini e Claude são ferramentas opcionais, sem chamada ou revisão duplicada obrigatória. Não criar scripts, frameworks ou supervisores adicionais.

## Contexto e sessões
- Comece pelo status/branch/HEAD; preserve a árvore local, inclusive M20. Consulte documentos/código somente no escopo autorizado.
- Use `rg --files <diretório>` para localizar e `rg -n -m 8 --max-columns 200 --max-columns-preview '<tema>' <arquivos>` para buscar; leia depois trechos de 40–80 linhas. Amplie só se faltar evidência.
- MEMORY.md é referência histórica opcional: buscar e extrair trechos pertinentes, nunca carregar integralmente por padrão. Não repetir leituras já disponíveis; decisões duráveis somente, sem segredos/status transitório.
- Mantenha contexto estável durante a mesma tarefa. Abra nova sessão para trabalho independente. Compacte apenas quando necessário para continuidade, preservando objetivo, decisões, contratos, arquivos, evidências e pendências; não reinicie a investigação após compactação.
- Para workers delimitados, use contexto separado (`fork_turns="none"` quando disponível) e forneça apenas tarefa, limites, contratos e arquivos necessários.

## Modelos e seis papéis preservados
Configuração nativa: `.codex/config.toml` e `.codex/agents/*.toml`; responsabilidades canônicas em `.agents/agents/`.

| Papel | Modelo configurado | Esforço |
| --- | --- | --- |
| Principal / product-architect | gpt-6.1-sol | medium |
| feature-engineer / billing-engineer (trabalho rotineiro delimitado) | gpt-6-luna | low |
| feature-reviewer / billing-reviewer (separados, somente leitura) | gpt-6.1-sol | high |
| sandbox-auditor (guardrails de provedor preservados) | gpt-6.1-sol | high |

- Modelos/esforços foram encontrados em `codex debug models --bundled` do CLI 0.164.0. O catálogo comprova compatibilidade declarada; disponibilidade da conta/identidade efetiva de inferência não deve ser inventada.
- Escale para Sol com esforço adequado quando houver contratos complexos, concorrência, segurança, regras monetárias ou dependências não resolvidas. O default low não autoriza mudanças financeiras complexas sem essa avaliação e revisão especializada.
- Papéis com modelo/esforço fixos não aceitam override no spawn deste runtime: use o papel de arquitetura/revisão ou agente Sol explicitamente delimitado para a escalação, mantendo a especialidade e a responsabilidade.
- Alterar configuração não comprova troca do modelo de uma sessão já iniciada. Registre modelo solicitado/configurado separadamente do efetivo; quando não exposto: **Unknown / Not yet verified**.

## Delegação verificável
- `agents.enabled=true`, limite configurado de quatro threads. O runtime atual oferece quatro slots totais, incluindo o principal; respeite sempre o menor limite efetivo.
- Delegue apenas investigações ou implementações independentes úteis. Investigações são somente leitura; no máximo dois workers de implementação simultâneos por padrão.
- Antes de implementar em paralelo, congele contratos compartilhados e atribua um único escritor por arquivo; transfira posse explicitamente. Worktree só quando necessário.
- Cada delegação registra ID real, escopo, modelo/esforço solicitado e resultado observado. Uma lista textual não comprova spawn. Não duplique revisão equivalente.
- Fluxo proporcional: investigar → delimitar → implementar → validar → revisar separadamente quando pertinente → documentar/entregar. ExecPlan só para mudança relevante; nenhum plano extenso em ajuste pontual.

## Validação e Git
- Documentação/configuração: validar no CLI e com `git diff --check`, status e diff/stat; **não rodar testes/builds de produto**.
- Código: conferir dependências/Emulator, testar primeiro o escopo afetado com timeout, capturar exit code e resultados; sem polling indefinido. Revalidar correções de código após revisão.
- Classificar PASS, FAIL, NOT_EXECUTED ou BLOCKED com evidência real. Revisores não editam nem homologam por suposição.
- Preservar WIP e não assumir main. Commit só quando autorizado; nenhum push, PR, merge, deploy, escrita em produção/provedor ou exposição de credenciais sem autorização separada.

## Rust Token Killer (RTK)
- Nesta auditoria, `rtk` / `rust-token-killer` não foram encontrados no PATH nem `rtk.exe` no local padrão `~/.cargo/bin`. Instalações em outros locais: **Unknown / Not yet verified**.
- Não instalar, configurar hooks ou reescrever comandos automaticamente. Se disponível e autorizado futuramente, comparar isoladamente um comando somente leitura com/sem RTK, conferindo fidelidade, exit code e tamanho da saída antes de adotar.

## Evidência curta desta auditoria (2026-10-26)
- `/root/context_audit`: spawn Luna/low, contexto separado, somente leitura; concluiu apontando leituras irrestritas de MEMORY.md nos papéis canônicos/adaptadores.
- `/root/efficiency_audit`: spawn Luna/low independente e simultâneo; concluiu apontando hierarquia Gemini obsoleta e duplicação de política.
- Ambos retornaram resultados concretos, sem edições, testes de produto ou rede; identidade resolvida de inferência não exposta. Os seis papéis continuam registrados; nenhum supervisor externo criado.
- CLI 0.164.0: `codex debug prompt-input` validou/renderizou a configuração com exit 0 e os seis papéis; catálogo local/cache contém Luna/low e Sol/medium/high. `--strict-config` não é suportado por `debug`/`features` nesta versão; a renderização exigiu permissão fora do sandbox por acesso negado ao estado local do CLI.
- `git diff --check` PASS; hash do diff Backend/Web/Flutter preservado antes/depois. Testes/builds de produto: NOT_EXECUTED (mudança somente documental/configuração).
- Referência: [documentação oficial de subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents).

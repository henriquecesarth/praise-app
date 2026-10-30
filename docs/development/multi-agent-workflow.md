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
- Preserve modelo, reasoning effort e conjunto de ferramentas/MCPs durante a sessão. `.codex/config.toml` define defaults, não comprova o modelo efetivo; confira `/status` ou o diagnóstico equivalente antes de registrar o efetivo. Evite trocar configuração no meio de trabalho longo sem necessidade concreta e autorização.
- Prefira os comandos nativos de Codex/Gemini e ferramentas locais como `rg`/`git` quando forem suficientes. Use MCP/integrações externas só quando a tarefa depender de dados ou operações que o CLI local não oferece; não adicione servidores para otimização hipotética.
- Para workers delimitados, use contexto separado (`fork_turns="none"` quando disponível) e forneça apenas tarefa, limites, contratos e arquivos necessários.

### Retomada após pausa ou cota
- Continue a sessão existente com `codex resume` ou `gemini --resume latest` quando disponível. Se for necessária uma sessão nova, comece pelo `git status`, branch e HEAD; leia apenas o ExecPlan/checkpoint ativo e os trechos necessários para distinguir trabalho concluído do pendente.
- Não refaça investigações, testes ou builds já registrados como concluídos. Revalide somente se arquivos, dependências, configuração ou ambiente relevantes mudaram. Não suponha que ações externas pendentes tenham ocorrido.
- Em tarefas longas, atualize o ExecPlan/checkpoint em limites naturais com objetivo, branch/HEAD, arquivos alterados e respectivos escritores, decisões, evidências (comando, exit code e log), pendências e ações externas não executadas. Commit Git é checkpoint apenas quando estiver autorizado.

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
- Em tarefa simples, trabalhe sem subagente. Delegue apenas quando isolamento de contexto ou paralelismo independente compensar o custo de instruir, acompanhar e integrar o resultado. Investigações são somente leitura; no máximo dois workers de implementação simultâneos por padrão.
- Antes de implementar em paralelo, congele contratos compartilhados e atribua um único escritor por arquivo; transfira posse explicitamente. Worktree só quando necessário.
- Cada delegação registra ID real, escopo, modelo/esforço solicitado e resultado observado. Uma lista textual não comprova spawn. Não duplique revisão equivalente.
- Fluxo proporcional: investigar → delimitar → implementar → validar → revisar separadamente quando pertinente → documentar/entregar. ExecPlan só para mudança relevante; nenhum plano extenso em ajuste pontual.

## Validação e Git
- Documentação/configuração: validar no CLI e com `git diff --check`, status e diff/stat; **não rodar testes/builds de produto**.
- Código: conferir dependências/Emulator, testar primeiro o escopo afetado com timeout, capturar exit code e resultados; sem polling indefinido. Revalidar correções de código após revisão.
- Para comandos verbosos, grave stdout e stderr completos em log de tarefa dentro do diretório de build ignorado ou em temporário; capture o exit code imediatamente. Retorne somente o exit code e trechos limitados encontrados com `rg`/`Select-String`, mantendo o log integral disponível para diagnóstico. Não filtre a saída no caminho de execução de modo que esconda um exit code ou falha.
- Classificar PASS, FAIL, NOT_EXECUTED ou BLOCKED com evidência real. Revisores não editam nem homologam por suposição.
- Preservar WIP e não assumir main. Commit só quando autorizado; nenhum push, PR, merge, deploy, escrita em produção/provedor ou exposição de credenciais sem autorização separada.

## Métricas de uso e cache
- Quando suportado pela versão/autenticação, Codex TUI documenta `/status` para modelo e uso de tokens da sessão e `/usage` para atividade de tokens da conta. Gemini CLI documenta `/stats` para estatísticas da sessão; tokens em cache só aparecem quando o provedor/autenticação os fornece (por exemplo, API key/Vertex, não OAuth Code Assist). Confira o escopo antes de comparar.
- Os comandos de sessão não devem ser tratados como medidor de cache se não exibirem campos de leitura/escrita/cache. `cached_tokens` da API OpenAI é uma métrica de resposta da API, não evidência automática do Codex CLI. Não calcule taxa de acerto ou economia a partir de contadores que não existem na saída observada.
- Para uma comparação, registre contadores reais antes/depois, CLI e versão, modelo/esforço, autenticação quando relevante, intervalo e escopo equivalentes. Sem baseline comparável, reporte **TOKEN_SAVINGS_MEASURED = NOT MEASURED**; estabilidade de configuração é uma prática, não uma economia quantificada.
- Não altere statusline, telemetry/exporters, hooks, MCPs ou comandos para colher métricas sem tarefa autorizada, avaliação de privacidade/fidelidade e evidência de benefício. Nunca importe hooks de Claude Code (`PreToolUse`, reescrita de comando) nem limites de contexto/compactação inferidos.

### Comparação V4 — antes/depois
| Regra | Antes | Depois |
| --- | --- | --- |
| Modelo/esforço | Defaults e papéis já fixavam Sol/medium, Luna/low e Sol/high; modelo efetivo ainda precisava de evidência. | Preservar também effort e ferramentas/MCPs durante a sessão; conferir o modelo efetivo sem reconfigurar por rotina. |
| CLI e saídas | Busca limitada, snippets e exit codes já eram recomendados. | Preferir CLI/ferramentas locais; guardar stdout/stderr completos em log e devolver apenas exit code e trechos relevantes. |
| Ferramentas/MCPs | Gemini era opcional; não havia servidor MCP de projeto declarado no `.codex/config.toml`. | Manter a configuração enxuta; usar CLI nativo quando suficiente e não adicionar MCPs/hooks só para medir ou filtrar. |
| Agentes | Delegar trabalho independente útil; limite de workers e revisão separada já existiam. | Tarefa simples fica no agente principal; delegar somente quando isolamento/paralelismo paga o overhead. |
| Pausa/cota | Compactar só quando necessário; contexto e evidências deveriam ser preservados. | Retomar a sessão quando possível; ao abrir outra, reconciliar status/branch/HEAD e ExecPlan, sem repetir o que já foi verificado. |
| Uso/cache | Sem regra de comparação de consumo e sem baseline medido. | Usar somente métricas que o CLI/autenticação realmente expõe; distinguir sessão, conta e cache; não atribuir economia sem comparação equivalente. |

## Rust Token Killer (RTK)
- Nesta auditoria, `rtk` / `rust-token-killer` não foram encontrados no PATH nem `rtk.exe` no local padrão `~/.cargo/bin`. Instalações em outros locais: **Unknown / Not yet verified**.
- Não instalar, configurar hooks ou reescrever comandos automaticamente. Se disponível e autorizado futuramente, comparar isoladamente um comando somente leitura com/sem RTK, conferindo fidelidade, exit code e tamanho da saída antes de adotar.

Referências para esta política:
- [Codex developer commands: `/status`, `/usage`, `/resume` e `/recap`](https://learn.chatgpt.com/docs/developer-commands)
- [Gemini CLI: token caching e `/stats`](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/token-caching.md)
- [Beer And Code: economia de tokens nos CLIs](https://blog.beerandcode.com.br/tutoriais/como-economizar-tokens-claude-code-codex-cursor) — recomendações específicas de Claude Code foram tratadas como não aplicáveis automaticamente ao Codex/Gemini.

## Evidência curta desta auditoria (2026-10-26)
- `/root/context_audit`: spawn Luna/low, contexto separado, somente leitura; concluiu apontando leituras irrestritas de MEMORY.md nos papéis canônicos/adaptadores.
- `/root/efficiency_audit`: spawn Luna/low independente e simultâneo; concluiu apontando hierarquia Gemini obsoleta e duplicação de política.
- Ambos retornaram resultados concretos, sem edições, testes de produto ou rede; identidade resolvida de inferência não exposta. Os seis papéis continuam registrados; nenhum supervisor externo criado.
- CLI 0.164.0: `codex debug prompt-input` validou/renderizou a configuração com exit 0 e os seis papéis; catálogo local/cache contém Luna/low e Sol/medium/high. `--strict-config` não é suportado por `debug`/`features` nesta versão; a renderização exigiu permissão fora do sandbox por acesso negado ao estado local do CLI.
- `git diff --check` PASS; hash do diff Backend/Web/Flutter preservado antes/depois. Testes/builds de produto: NOT_EXECUTED (mudança somente documental/configuração).
- Referência: [documentação oficial de subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## Evidência da auditoria V4 (2026-10-27)
- Configuração Codex validada com `tomllib`: `.codex/config.toml` e os seis arquivos de papel parseiam, referências existem; defaults Sol/medium e Luna/low confirmados. `codex debug prompt-input` no CLI 0.164.0: exit 0 e JSON válido, com saída completa capturada em temporário e não impressa no contexto. `--strict-config` não é aceito no subcomando `debug` desta versão (exit 1); a validação TOML/CLI sem esse flag passou.
- CLI detectados: Codex 0.164.0 e Gemini 0.53.0; `gemini --help` confirma `--resume`. `/status`, `/usage` do Codex e `/stats` do Gemini são documentados, mas não foram executados nesta auditoria. Configurações de conta/MCP fora do escopo não foram inspecionadas.
- Nenhum contador de tokens/cache foi coletado; não há baseline comparável. Economia medida: **NOT MEASURED**. Testes e builds do produto: **NOT_EXECUTED**.

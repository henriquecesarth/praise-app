# LouvAIO — instruções permanentes para Antigravity CLI (agy) e agentes compatíveis

@./AGENTS.md

## Fontes de verdade

- O código atual e os testes executáveis prevalecem sobre descrições históricas.
- Comece por `docs/01-CONTEXTO-ATUAL.md` e consulte `docs/00-PAINEL.md` no Obsidian (`docs/` como vault).
- Consulte `docs/system-status.md` e os documentos específicos da funcionalidade antes de alterações pertinentes.
- Não importe `MEMORY.md` integralmente neste arquivo ou contexto de prompt: ele é volumoso; consulte apenas as seções estritamente relevantes para a tarefa.
- Preserve o fluxo arquitetural, os limites de segurança e o protocolo de mudança definidos em `AGENTS.md`.
- Atualize `MEMORY.md` apenas para decisões duráveis e documentação específica quando necessário; não registre estados transitórios ou segredos.

## Fluxo de Tarefas (Chat ou GitHub)

Tarefas podem ser recebidas diretamente pelo chat ou por GitHub Issues (Issues são **opcionais**, não obrigatórias).

Quando uma Issue for indicada (por exemplo, #42):
1. Leia título, descrição e comentários da Issue usando `gh issue view 42 --json title,body,comments` (substitua o número).
2. Confira a branch atual, o estado do Git e o escopo. Trabalhe em uma branch de feature específica, nunca diretamente na `main`. Confirme a branch-base correta no plano (geralmente uma branch WIP, como `wip/repertoire-versions-smartchords-20261022`), e nunca assuma `main` automaticamente.
3. Inspecione o código existente e utilize os agentes especializados canônicos (`.agents/agents/`) conforme a área.
4. Implemente o menor conjunto coerente de alterações, execute as validações aplicáveis e revise `git diff --check`.
5. Prepare um relatório factual contendo: origem da tarefa, resumo, arquivos, decisões, testes realmente executados e resultados reais, riscos, limitações e eventuais alterações de arquitetura.
6. Quando **autorizado expressamente pelo usuário**, faça push apenas da branch de trabalho e crie/atualize um **Draft Pull Request** para a branch-base correta, usando o relatório como descrição. Mencione a Issue no PR, se houver.
7. Retorne os comandos de push e a URL/descrição do PR preparado para que o usuário possa autorizar e auditar a publicação.

## Protocolo Multiagente Permanente V2

- Instruções detalhadas em `docs/development/multi-agent-workflow.md`.
- Hierarquia de Modelos:
  - **Argon High:** arquitetura complexa, contratos compartilhados Backend/Web/Mobile, segurança multi-tenant e desambiguações difíceis. Não acionar para tarefas rotineiras.
  - **Gemini Flash (preferencialmente Gemini Flash 3.8 High):** implementação ágil de código, endpoints, componentes, testes e documentação operacional. Registrar variantes apenas com evidência do runtime.
  - **Codex:** revisão independente e read-only de diffs estáveis com foco em segurança, RBAC, persistência e regressões.
- Limite de delegação: subagentes apenas quando houver ganho real; no máximo 2 workers de implementação simultâneos; único escritor por arquivo; congelar contratos de API antes de paralelizar.
- Evitar retrabalho: não realizar revisão extensa com Gemini antes de uma revisão Codex equivalente.
- Política de testes: checar dependências antes de suítes amplas (ex: Firebase Emulator), usar timeouts seguros e classificar como PASS, FAIL, NOT_EXECUTED ou BLOCKED. Não reexecutar testes de código em tarefas estritamente documentais.

## Limites operacionais

- Sem autorização explícita: não faça push e não crie PR; mantenha os resultados locais e informe como publicá-los.
- Nunca realize merge, deploy, mudanças em produção ou reescrita de histórico automaticamente.
- Não declare testes ou validações como concluídos sem evidência real.
- Um PR aberto não significa aprovação; a revisão e o merge são decisões humanas separadas.
- Nunca realize escritas no banco de dados Firebase de produção.

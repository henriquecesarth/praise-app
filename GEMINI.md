# LouvAIO — instruções permanentes para Antigravity CLI (agy) e agentes compatíveis

@./AGENTS.md

## Fontes de verdade

- O código atual e os testes executáveis prevalecem sobre descrições históricas.
- Comece por `docs/01-CONTEXTO-ATUAL.md`; consulte `docs/system-status.md`, documentos da funcionalidade e apenas trechos pertinentes de `MEMORY.md` antes de alterações.
- Não importe `MEMORY.md` integralmente neste arquivo: ele é volumoso; consulte as seções relevantes para a tarefa.
- Preserve o fluxo arquitetural, os limites de segurança e o protocolo de mudança definidos em `AGENTS.md`.
- Atualize `MEMORY.md` apenas para decisões duráveis e documentação específica quando necessário; não registre estados transitórios ou segredos.

## Tarefas recebidas pelo GitHub

Quando o usuário solicitar a implementação de uma Issue (por exemplo, #42), inclusive por um fluxo automatizado explicitamente autorizado:

1. Leia título, descrição e comentários da Issue usando `gh issue view 42 --json title,body,comments` (substitua o número).
2. Confira a branch atual, o estado do Git e o escopo. Trabalhe em uma branch de feature específica, nunca diretamente na `main`.
3. Inspecione o código existente e siga os agentes especializados e as instruções de `AGENTS.md` conforme a área.
4. Implemente o menor conjunto coerente de alterações, execute as validações aplicáveis e revise `git diff --check`.
5. Quando a tarefa permitir, delegue mapeamento de contratos, análise de riscos e preparação de testes em paralelo. Escrita concorrente somente em worktrees isolados, com responsável claro por path e integração sequencial. Prepare um relatório factual contendo: Issue, resumo, arquivos, decisões, testes realmente executados e resultados, riscos, limitações e eventuais alterações de arquitetura.
6. Quando **autorizado expressamente pelo usuário**, faça push apenas da branch de trabalho e crie/atualize um **Draft Pull Request** para a branch-base verificada no plano (pode ser WIP, não necessariamente `main`), usando o relatório como descrição. Mencione a Issue no PR.
7. Retorne a URL do PR para que o ChatGPT possa consultar código, diff e relatório diretamente no GitHub.

## Limites operacionais

- Sem autorização explícita: não faça push e não crie PR; mantenha os resultados locais e informe como publicá-los.
- Nunca realize merge, deploy, mudanças em produção ou reescrita de histórico automaticamente.
- Não declare testes ou validações como concluídos sem evidência.
- Um PR aberto não significa aprovação; a revisão e o merge são decisões separadas.

## Execução paralela e observabilidade

- Leia `docs/development/multi-agent-workflow.md` para papéis, critérios de paralelismo, isolamento, comandos e formato do handoff.
- No Antigravity CLI (`agy`), aproveite os agentes canônicos `.agents/agents/` e confirme descoberta em `/agents`. Considere `/teamwork-preview` para coordenação de tarefas grandes se disponível no plano e versão instalados. Não assuma suporte sem testar.
- O Gemini CLI **nativo** (comando `gemini`, quando instalado e autenticado separadamente) lê os adaptadores opcionais em `.gemini/agents/`; isto não altera as credenciais da sessão `agy`.
- Codex é verificador independente: pode revisar em outro terminal/checkout a qualquer momento que exista um diff estável. Não afirme que `agy` inicia automaticamente `codex` sem integração local efetivamente configurada.
- Não inicie escritores em paralelo no mesmo diretório. Em branches divergentes, crie PRs para a base correta e valide a integração após combinar mudanças.
- O resultado mínimo de cada subagente deve ter: escopo, arquivos examinados/alterados, evidência, riscos e próximos bloqueios, sem textos especulativos extensos.

# LouvAIO — instruções permanentes para Gemini CLI

@./AGENTS.md

## Fontes de verdade

- O código atual e os testes executáveis prevalecem sobre descrições históricas.
- Consulte `MEMORY.md`, `docs/system-status.md` e os documentos específicos da funcionalidade antes de alterações pertinentes.
- Não importe `MEMORY.md` integralmente neste arquivo: ele é volumoso; consulte as seções relevantes para a tarefa.
- Preserve o fluxo arquitetural, os limites de segurança e o protocolo de mudança definidos em `AGENTS.md`.
- Atualize `MEMORY.md` apenas para decisões duráveis e documentação específica quando necessário; não registre estados transitórios ou segredos.

## Tarefas recebidas pelo GitHub

Quando o usuário solicitar a implementação de uma Issue (por exemplo, #42):

1. Leia título, descrição e comentários da Issue usando `gh issue view 42 --json title,body,comments` (substitua o número).
2. Confira a branch atual, o estado do Git e o escopo. Trabalhe em uma branch de feature específica, nunca diretamente na `main`.
3. Inspecione o código existente e siga os agentes especializados e as instruções de `AGENTS.md` conforme a área.
4. Implemente o menor conjunto coerente de alterações, execute as validações aplicáveis e revise `git diff --check`.
5. Prepare um relatório factual contendo: Issue, resumo, arquivos, decisões, testes realmente executados e resultados, riscos, limitações e eventuais alterações de arquitetura.
6. Quando **autorizado expressamente pelo usuário na sessão**, faça push apenas da branch de trabalho e crie/atualize um **Draft Pull Request** para `main`, usando o relatório como descrição. Mencione a Issue no PR.
7. Retorne a URL do PR para que o ChatGPT possa consultar código, diff e relatório diretamente no GitHub.

## Limites operacionais

- Sem autorização explícita: não faça push e não crie PR; mantenha os resultados locais e informe como publicá-los.
- Nunca realize merge, deploy, mudanças em produção ou reescrita de histórico automaticamente.
- Não declare testes ou validações como concluídos sem evidência.
- Um PR aberto não significa aprovação; a revisão e o merge são decisões separadas.

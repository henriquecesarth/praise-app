# Fluxo ChatGPT ↔ GitHub ↔ Gemini CLI (sem Agent Manager)

Objetivo: o ChatGPT cria Issues e revisa PRs pelo GitHub; o Gemini CLI implementa localmente e publica o resultado em Draft PR quando autorizado. O usuário não precisa copiar relatórios entre IAs.

## Preparação (uma vez)

1. No PowerShell, na raiz do repositório, confirme `gh auth status`, `git status --short` e `gemini --version`.
2. O `GEMINI.md` importa `AGENTS.md`, mas mantém `MEMORY.md` sob consulta direcionada para economizar contexto. Confira com `/memory show` no Gemini.
3. Nunca coloque secrets, .env, credenciais ou tokens em Issues, relatórios ou PRs.

## A cada funcionalidade

1. Peça ao ChatGPT para criar uma Issue com escopo e critérios de aceite. Anote apenas o número da Issue.
2. Em PowerShell, na raiz do projeto, substitua `42` pelo número da Issue:

```powershell
git status --short
git switch main
git pull --ff-only origin main
git switch -c feat/issue-42
gemini -i "Implemente a Issue #42 do repositório, lendo o conteúdo e comentários via gh issue view 42. Siga GEMINI.md e AGENTS.md; execute testes pertinentes e produza relatório completo para o PR. Autorizo push somente da branch feat/issue-42 e criação de Draft PR para main. Não autorizei merge nem deploy."
```

3. Acompanhe as permissões propostas pelo Gemini CLI. A autorização mencionada no prompt limita o escopo solicitado, não dispensa a checagem humana de comandos arriscados.
4. Se o Gemini não publicar o PR, verifique o estado com `git status --short`. Após confirmar o resultado, publique a branch e abra o Draft PR manualmente usando `git push -u origin feat/issue-42` e `gh pr create --draft --base main --head feat/issue-42`; descreva os resultados reais.
5. Volte ao ChatGPT e diga apenas: **Revise o PR #XX do LouvAIO**. O ChatGPT consulta diff, descrição e comentários direto no GitHub, sem relatório copiado.
6. Se precisar de correção, o ChatGPT pode registrar comentários no PR; peça ao Gemini para ler os comentários, ajustar a branch e atualizar o mesmo PR. Faça o merge somente quando as alterações tiverem sido revisadas.

## Segurança e limites

- O ChatGPT acessa GitHub, não a sessão do Gemini nem seus arquivos locais não publicados.
- O Gemini não publica resultados não comitados/pushed: para revisão remota, a branch e o relatório devem estar no GitHub.
- Nenhum processo roda automaticamente no Windows só por existir uma Issue. O usuário inicia o Gemini CLI.
- Não há execução automática de merge ou deploy.

# Fluxo ChatGPT ↔ GitHub ↔ Antigravity CLI (conta Google, sem API Key)

O ChatGPT publica Issues com requisitos e revisa Draft PRs pelo GitHub. O Antigravity CLI (`agy`), autenticado localmente com a conta Google pessoal (AI Pro/Ultra), implementa código e gera o relatório para revisão. Não existe dependência do antigo Agent Manager.

> Mudança de produto (18/06/2026): login pessoal Google AI Pro/Ultra deixou de atender Gemini CLI. Para reaproveitar a assinatura pessoal na linha de comando, use Antigravity CLI; não confunda a autenticação por conta com a API Key Gemini. Fonte: https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals

## Primeira configuração no Windows

Instale pelo instalador oficial (inspecione o script antes de executá-lo quando sua política de segurança exigir):

```powershell
irm https://antigravity.google/cli/install.ps1 | iex
```

Abra um novo PowerShell e execute na pasta do LouvAIO:

```powershell
agy --version
agy
```

Faça login uma vez no navegador, usando a conta Google da assinatura. Na sessão interativa, verifique a conta e as permissões. Em seguida:

```powershell
agy -p "Responda apenas OK."
gh auth status
git status --short
```

O modo headless `agy -p` reutiliza as credenciais armazenadas localmente. Não copie tokens OAuth ou credenciais para repositórios, Issues, GitHub Secrets ou outros computadores.

Documentação: https://antigravity.google/docs/cli/headless/ ; https://antigravity.google/docs/cli/install/

## Fluxo manual de uma Issue (teste inicial)

1. Solicite ao ChatGPT uma Issue com escopo e critérios de aceite. O ChatGPT registra a Issue no GitHub.
2. Em um checkout limpo, crie uma branch para essa Issue. Exemplo #42:

```powershell
git status --short
git switch main
git pull --ff-only origin main
git switch -c feat/issue-42
agy
```

3. Na sessão interativa do `agy`, solicite: `Implemente a Issue #42 de henriquecesarth/praise-app. Leia com gh issue view 42. Siga AGENTS.md e GEMINI.md. Valide os testes e builds pertinentes. Prepare relatório com arquivos, decisões, resultados reais dos testes e limitações. Não faça merge nem deploy. Não publique sem autorização expressa.`
4. Após revisar o código, autorize apenas `git push` da branch e um Draft PR. Peça ao agente para executar `gh pr create --draft --base main` incluindo o relatório no corpo. O agente precisa ter permissões específicas para comandos shell (`git`, `gh`, comandos de teste); confirme as permissões na UI. Nunca use `--dangerously-skip-permissions` indiscriminadamente.
5. Basta dizer ao ChatGPT: `Revise o PR #XX do LouvAIO`. O ChatGPT lê PR, diff e relatório pelo GitHub, sem texto copiado.

## Receber novas tarefas sem digitar prompts

Há dois caminhos:

- **Na sessão interativa:** o Antigravity CLI tem `/schedule`. Exemplo: `/schedule a cada 5 minutos, confira Issues abertas de henriquecesarth/praise-app com o rótulo ai:ready e informe a próxima elegível; não execute mudanças de código automaticamente.` Essa agenda pertence à conversa aberta; use `/tasks` para conferir/cancelar.
- **Fila eficiente com poucas chamadas ao modelo:** um observador local PowerShell pode consultar o GitHub com `gh issue list` e **chamar `agy -p` só quando houver nova Issue autorizada**. Isso exige um processo local rodando, mas não gasta chamadas de modelo a cada intervalo sem tarefas. Para implementação automática segura, usar uma branch/worktree isolada, marcação atômica da Issue e permissões de comandos estritamente delimitadas; nunca merge/deploy automático.

O comportamento escolhido precisa ser configurado/testado no Windows. Nenhum observador ou agendamento está ativado só pela existência deste documento.

## Segurança

- O ChatGPT enxerga o GitHub, não os arquivos locais não publicados ou a sessão Antigravity.
- Não incorpore no fluxo automações que fazem merge ou deploy sem revisão humana.
- O modo headless retorna respostas não interativas, mas, sem política de permissão para `git`, `gh` e testes, comandos podem ser negados mesmo quando o processo termina com código 0. Verifique evidências de commit/PR antes de marcar uma tarefa como concluída.
- Nunca exponha credenciais, arquivos `.env`, chaves, dados sensíveis ou logs brutos de autenticação.

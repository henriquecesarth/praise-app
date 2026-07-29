# Guia de Operação para Agentes de IA

Este é o guia de operação primário para qualquer agente de IA trabalhando no repositório **Praise App**.

## Protocolo de Atuação
- **Sempre** ler os arquivos relevantes na pasta `docs/` antes de realizar qualquer alteração no código.
- O conhecimento documentado em `docs/` é a fonte da verdade para arquitetura, regras de negócio e segurança.

## Workflow de Validação
- **Frontend (Web)**: Executar `npx -p typescript tsc --noEmit` no diretório `/web` após qualquer alteração.
- **Backend**: Executar os testes e checagens no diretório `/backend` após qualquer alteração no backend.
- O código só deve ser considerado finalizado se não houver erros de compilação ou testes falhando.

## Convenções de Commit
- Seguir o padrão Conventional Commits com mensagens claras.
- Exemplos: `feat(web): adiciona modal de escalas em tela cheia`, `fix(backend): corrige permissões na rota de comentários`.

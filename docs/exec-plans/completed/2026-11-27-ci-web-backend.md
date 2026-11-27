# CI da web e do backend; testes instáveis da web

Início: 2026-11-27. Branch `fix/louvaio-audit-remediation-20261113`, sobre `945e119`. Commit local autorizado; push aguarda autorização.

## Causas das falhas intermitentes
Reproduzidas ocupando os 4 núcleos da máquina local.

- `VocalExercisePlayer`: cada `getByRole` na página inteira (cerca de 1000 elementos) levava 220–460 ms, e o teste passava dos 5 s. As consultas dos botões passaram a ser feitas na barra de transporte (cerca de 4 ms).
- Codificação MP3 com LAME real (`MinistryAudioLocalSeparation.compression`, `mp3-draft-compression`, `mp3-draft-isolation`): esperas de 1 s e testes de 5 s. Limites maiores nesses arquivos; duas esperas por tempo fixo viraram espera por evento.
- Esperas `waitFor`/`findBy` em geral (também um teste do WhatsApp): o padrão passou de 1 s para 4 s em `web/src/test/setup.ts`.

Nenhuma asserção foi retirada ou afrouxada.

## CI
- `.github/workflows/web-ci.yml`: `npm ci`, `tsc --noEmit`, `npm test`, `vite build --mode test`.
- `.github/workflows/backend-ci.yml`: `npm ci`, `npm run build`, `npm test` (só unitários).
- Node 22. Disparo por push em qualquer branch, PR para `main` e manual, filtrado por `web/**` ou `backend/**`; ambos incluem `shared/**`. Sem segredos.
- Fora do CI novo: testes E2E da web e de integração do backend.

## Validação local (2026-11-27, Windows)
- Web: suíte inteira 3 vezes seguidas, 1767 de 1767 em cada; antes, uma vez sob carga e em UTC, 1767 de 1767. `tsc` e `vite build --mode test` PASS.
- `feature-reviewer` (leitura estática): 0 BLOCKER, HIGH ou MEDIUM, 7 LOW. Corrigido o disparo por tags. Abertos: pausa fixa de 20 ms no teste de saída durante a compressão; espera por evento que, em regressão, só falha no limite de 40 s; ações fixadas por tag.
- Backend: build PASS; testes (em UTC) 2942 de 2944. As 2 falhas (`m22c5d-r2-mp3-e2e-core`) conferem permissão `0600`, que o Windows não aplica; backend não alterado.
- Uma rodada em segundo plano foi encerrada por falta de memória; refeita em primeiro plano.
- CI no GitHub (commit `38944cf`): PASS. Web run 46068478302 (1767 de 1767); backend run 46068478229 (2944 de 2944, incluindo os dois testes de permissão que falham no Windows).

## Resultado final
Concluído em 2026-11-27, sem deploy. Permanecem fora do CI os testes E2E da web e os de integração do backend; no Windows, os 2 testes de permissão continuam falhando.

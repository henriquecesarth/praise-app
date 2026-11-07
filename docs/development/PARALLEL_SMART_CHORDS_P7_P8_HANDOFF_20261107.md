# P7–P8 — CI isolada e corpus de regressão musical (07/11/2026)

Origem: parallel/smart-chords-p4-p6-20261107, commit 3e8e2cfc38b3b43d5dfad30c047b0bf628974712.
Branch: parallel/smart-chords-p7-p8-20261107.

## P7 — Teste real de repositório

Arquivo novo: .github/workflows/smart-chords-p7-p8.yml.
Push limitado a branches parallel/smart-chords-p7-p8-* e workflow_dispatch; sem execução em main.
Permissões somente contents:read; checkout sem credenciais persistidas.
Steps: Node 22, npm ci no pacote Web conforme lockfile; npm test (todos os Vitest Web), npm run build -- --mode test (build local sem publicação).
Não usa secrets, Firebase de produção, merge, deploy nem artefatos.
Workflow existente no branch não garante que o GitHub Actions iniciou ou concluiu. Conferir os logs antes de atribuir PASS.

## P8 — Referências musicais

Arquivo: web/src/utils/fixtures/smart_chord_reference_cases.ts.
Corpus com 34 cifras sintéticas originais, expectativas explícitas de transposição +2 semitons (sem calcular a expectativa com a implementação).
Cobre compassos, progressões, repetições, acordes opcionais, acordes múltiplos por compasso, inversões, acordes complexos, marcadores % e N.C., anotações acima e inline, acordes em versos, tablaturas, CRLF, Unicode e entrada malformada.
Teste: web/src/utils/smart_chord_reference_cases.test.ts. Valida saída exata, tokenização reversível, offsets de símbolos e anotações e unicidade dos casos.

## Limites e integração na segunda-feira

CI deve comprovar execução real com link de run, logs, contagem e build. Status inicial: UNKNOWN / NOT YET VERIFIED.
Preservar antes o M21/D2-A e 674 registros WIP no computador antigo; recuperar a baseline e fazer integração seletiva.
Este trabalho não altera o editor, PDF, persistência, app mobile, backend, Vercel produção ou main.
Se um push disparar previews automáticos Vercel, cancelar apenas builds desta branch, sem mexer em produção.
Testes de dispositivo físico, exportação PDF, salvamento/reabertura e UI não foram incluídos.

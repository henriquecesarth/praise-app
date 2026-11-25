# M22-S3.1 — Homologação MP3 longa no R2 DEV

Estado: `MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`. `serverByteValidation` de `mp3_cbr256` continua `false`
no código publicável (`audio-codec.ts` intacto); o codec é aberto apenas em memória dentro do harness protegido.

## Harness

- `backend/scripts/m22s31-r2-long-e2e.ts` (`--plan` | `--run`), núcleo em `backend/src/scripts/m22s31-long-core.ts`, cenário em `m22s31-long-scenarios.ts`. Harness **separado**: os limites de `m22c5d-r2-mp3-e2e.ts` não foram alterados (a única mudança em `m22c5d-r2-mp3-e2e-core.ts` é exportar a interface `CommandLike`).
- Tetos (não metas; nada os amplia): 1 gravação, 6 stems, 300 s, 10 MiB por objeto, 60 MiB de originais comprimidos, 300 MiB de corpos transferidos, 200 comandos de objeto na execução + 100 no cleanup, 15 min.
- `LongCommandGuard` = guard original + ledger de bytes cobrado **antes** de cada corpo do SDK (tamanho declarado ou do stem), sem `Range` e sem `CopyObject`. URLs assinadas passam por `ledgerSignedRequest` (PUT cobrado antes; GET exige espaço para um objeto e é cobrado pelo recebido). O ledger é conservador.
- Journal write-ahead obrigatório (mesmo formato do C.5D; o cleanup padrão `m22c5d-r2-mp3-cleanup.ts` o lê). Cleanup apenas das chaves do journal, ausência provada e varredura tardia.
- Fixtures sintéticas (sem música comercial): `backend/scripts/m22s31/generate-synthetic-stems.ts` (seis timbres procedurais, 298 s) + `m22s3/encode-long-fixtures.ts` (encoder Web real, LAME 3.100). Não versionadas (≈57 MB).
- Prova offline antes do live: `m22s31-long-e2e.integration.test.ts` (`M22S31_LONG_DIR=<fixtures>`), com R2 simulado, expiração em relógio virtual e a mesma contabilidade.

Comandos (somente com autorização e credenciais DEV; ver variáveis de isolamento do C.5D, incluindo `LOUVAIO_LOCAL_EMULATORS=1`):

```
cd backend
npx --no-install tsx scripts/m22s31-r2-long-e2e.ts --plan
M22S31_LONG_DIR=<fixtures> [M22S31_KEEP_DIR=<novo diretório>] M22C5D_JOURNAL=<novo>.journal.json npx --no-install tsx scripts/m22s31-r2-long-e2e.ts --run
```

## Resultados observados (execução real no bucket DEV autorizado, 2026-11-25)

| Item | Resultado |
|---|---|
| su curto (fixture `web-lame`) | PASS, 0 falhas; 59 comandos; cleanup 48/48 chaves ausentes |
| Longo (6 × 9.537.827 B, 298 s) | PASS, 25/25 passos; cleanup 24/24 ausentes, 0 escritas tardias |
| Comandos de objeto | 48 na execução (HEAD 30, GET 12, PUT 6, sem Range/Copy) + 72 no cleanup = 120 de 300 |
| Bytes transferidos (ledger, conservador) | 282 MiB de 300 (cliente PUT 57,2 MB; SDK GET 114,5 MB; SDK PUT 57,2 MB; cliente GET 66,8 MB) |
| Selagem por stem (ms) | 6080, 3211, 3912, 3076, 3022, 3663 |
| PUT assinado por stem (ms) | 1352–2078 |
| Download assinado por stem (ms) | 1279–1605 |
| Memória (processo único: serviço + cliente) | RSS 205 → 287 MB; heap 68 → 68 MB (pico igual à linha de base) |
| URL expirada | 403 (recusada); renovada baixa o mesmo SHA-256 |
| Arquivamento | membro recebe 404; sem comando R2 |
| Reprodução Web (Chrome, decodificador e mixer reais, arquivos baixados do R2) | decodificação 1,1–1,5 s por stem; `loadStems` 15,3 s; `ready`, 6 fontes ativas, deriva entre stems 0; seek ao fim (295 s) continua tocando |
| Alinhamento (decodificado × WAV original, início/meio/fim, 6 stems) | 18/18 janelas `aligned` (com sinal) |

Limitações: uma máquina, um navegador, rede doméstica; long tasks de até ≈1,2 s durante o carregamento do mixer; os 282 MiB deixam margem de ≈18 MiB (qualquer retry extra encerraria a execução em vez de ampliar o teto). **Não houve escuta humana**: a qualidade auditiva não está aprovada por este teste. O modo `rc` não foi executado.

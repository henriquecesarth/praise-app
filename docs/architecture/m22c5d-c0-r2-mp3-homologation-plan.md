# M22-C.5D-C0 — Plano de homologação MP3 v2 no R2 DEV (preparado, NÃO executado)

Status: **preparado e provado offline; nenhuma chamada ao R2 foi feita** (nem listagem). A publicação MP3 continua bloqueada
(`serverByteValidation: false`, `AUDIO_CODEC_NOT_ENABLED` nas rotas reais). O harness vive em `backend/scripts/` e
`backend/src/scripts/`, fora do build publicável; ele abre o perfil MP3 **apenas na memória do próprio processo**, depois de
passar o guard de isolamento.

## 1. Auditoria
| Item | Estado |
|---|---|
| Config R2 DEV | `getR2DevelopmentConfig`: variáveis `MINISTRY_AUDIO_R2_DEV_*` (nunca lidas/impressas aqui); bucket deve casar `louvaio-ministry-audio-dev(-x)*`. |
| Scripts anteriores | `m22c-r2-e2e-cleanup.ts` só conhece chaves `.wav` (prefixo `m22c-r2-`); `m22c-r2-e2e-server.ts` instrumenta `S3Client.send`; **não** suportam `.mp3`. Por isso o cleanup MP3 é novo e não reutiliza os antigos. |
| Proteção contra produção | guard antigo exige emuladores; o novo exige, além disso, **bucket permitido por nome exato** (`M22C5D_R2_ALLOWED_BUCKET`), `NODE_ENV=test`, `M22C5D_R2_LIVE=1`, ausência de `VERCEL*`, projeto `demo-*`. |
| Fluxos | upload assinado, seal (stream+upload e ranged+copy), CopyObject condicional, verificação persistida: já homologados para WAV (M22-C.2/C.4); MP3 só offline até agora. |
| Gate / hash / recibos | `serverByteValidation:false`, `AUDIO_CODEC_NOT_ENABLED` intactos; `requestHash` v1 inalterado (M22-C.5D-B); manifesto v2 e recibos com fatos MP3 cobertos por 321 testes de integração. |

## 2. Componentes
- `src/scripts/m22c5d-r2-mp3-e2e-core.ts`: limites, `assertLiveIsolation`, `CommandGuard`, journal write-ahead, `plannedKeys`, `cleanupJournal`.
- `src/scripts/m22c5d-r2-mp3-e2e-scenarios.ts`: cenários independentes do armazenamento (mesmo código offline e ao vivo).
- `src/scripts/m22c5d-fake-r2.ts`: bucket em memória (condicionais, ranges, 404/412), só para testes.
- `scripts/m22c5d-r2-mp3-e2e.ts` (execução real), `scripts/m22c5d-r2-mp3-cleanup.ts` (cleanup por journal).

## 3. Proteções (aplicadas em código, antes de o comando sair do processo)
- Só cinco comandos: Head, Get, Put, Copy, Delete. **Nenhum List.** Qualquer outro nome é recusado.
- Bucket exato. Chaves exatas: `staging/ministry-audio/<m>/<64hex>/<stem>/<1-3>.mp3` e `objects/ministry-audio/<m>/<64hex>/<stem>.mp3`, com `<m>` ∈ os 4 ministérios sintéticos **desta** execução (`m22c5d-r2-<uuid>-(su|rc)[x]`). Origem de cópia validada igual. Sem traversal, sem outra extensão, sem chaves de execuções ou testes anteriores (`m22c-r2-…`).
- Limites: 8 gravações; 700 comandos por modo; objeto ≤ 64 KiB (fixture real de 10 866 B); 160 objetos criados; 300 s de relógio. Estouro ⇒ a execução aborta (fail-closed) e o cleanup roda com um guard novo (orçamentos próprios), para que um orçamento esgotado nunca impeça a limpeza.
- As URLs assinadas usadas pelo cliente simulado (PUT/GET por `fetch`, fora do SDK) são validadas antes do uso: https, host `<accountId>.r2.cloudflarestorage.com`, bucket permitido e chave sintética desta execução.
- O journal nunca sobrescreve um arquivo existente e exige nome `*.journal.json`.
- Trace sem chaves, URLs, headers ou conteúdo; a saída do script imprime só nomes de passo, PASS/FAIL, contadores e o caminho do journal. URLs assinadas nunca são impressas.
- Journal (arquivo 0600 em `$TMPDIR`, ou `M22C5D_JOURNAL`, nome `*.journal.json`): criado de forma **exclusiva** (`wx`; nunca sobrescreve) e atualizado por **escrita atômica** (arquivo temporário exclusivo 0600 no mesmo diretório, fsync, `rename`); uma falha em qualquer ponto preserva o último journal válido e remove o temporário. As chaves planejadas são gravadas **antes** do primeiro `upload-url` de cada gravação. `parseJournal` é estrito: `runId` UUID canônico; todo ministério deve ser exatamente `m22c5d-r2-<runId>-su|rc` (um só modo); sem duplicatas, sem campos extras, `stems` completos e em ordem; chaves recalculadas. Um journal consistente de outro `runId` é recusado antes de qualquer comando R2.
- O cleanup standalone limpa **qualquer** journal estritamente válido (inclusive de execuções anteriores interrompidas); ele recusa apenas journal inválido, de outro bucket ou com chaves fora do plano de seu próprio `runId`. Para a execução em curso, o cleanup automático usa o journal em memória.
- O cleanup automático só começa depois de o servidor local ser fechado (nenhuma requisição em voo) e cada passo do cleanup é protegido por try/catch (falha ⇒ FAIL + dica de re-execução).
- Requisições assinadas do cliente (`fetch`, fora do guard do SDK): alvo validado antes, `redirect: 'error'`, timeout de 20 s cobrindo o corpo, PUT ≤ 64 KiB, GET lido em streaming e cancelado ao passar de 64 KiB (corpos de erro ≤ 8 KiB), sem acumular além do limite.

## 4. Cenários
S0 gate fechado (422, zero comandos R2) · S1 fluxo completo (reserva v2, PUT assinado `audio/mpeg`+`if-none-match:*`, validação streaming, promoção, recibos com fatos iguais nas seis faixas, finalização concorrente ×3, leitura dos seis objetos com SHA-256 do manifesto, `/complete` repetido sem comandos R2) · S4 isolamento (outro ministério 404, membro 403, **zero** comandos R2) · S2 (só ranged+copy) falha injetada de `CopyObject` após verificação completa, retomada sem reler o staging e recibo = fatos persistidos · S3 MP3 malformado com SHA-256 válido (422, nada promovido, finalização 409, invisível) · S6 cleanup exato e prova de ausência.
**Um modo por execução, escolhido explicitamente** (`--mode su` ou `--mode rc`; sem modo válido o script imprime o uso e sai com código 2, sem conexão). A homologação real começa **somente por `su`** (stream + upload). `rc` (ranged de 4 KiB ⇒ 3 partes por objeto + copy) exige autorização posterior, depois de PASS e limpeza confirmada em `su`.

**Fail-fast (C0.1):** a primeira verificação obrigatória com FAIL interrompe imediatamente os cenários (nenhum upload, promoção ou cenário posterior); o cleanup das chaves já registradas roda sempre, inclusive após exceção.

## 5. Comandos preparados (zsh, a partir de `backend/`; **só após autorização**)
```zsh
# 0. conferir o plano sem conectar a nada
npx --no-install tsx scripts/m22c5d-r2-mp3-e2e.ts --plan

# 1. emuladores (terminal separado, projeto de demonstração)
npx --no-install firebase emulators:start --only firestore,auth --project demo-louvaio-c5dc0 --config d2b-emulator.config.json

# 2. execução real (valores MINISTRY_AUDIO_R2_DEV_* definidos só no shell, nunca no repositório)
export NODE_ENV=test FIREBASE_PROJECT_ID=demo-louvaio-c5dc0
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8186 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098
export M22C5D_R2_LIVE=1 M22C5D_R2_ALLOWED_BUCKET="$MINISTRY_AUDIO_R2_DEV_BUCKET"
npx --no-install tsx scripts/m22c5d-r2-mp3-e2e.ts --mode su     # primeira (e única autorizada até aqui) execução
# rc: somente com autorização posterior:  ... e2e.ts --mode rc

# 3. cleanup isolado, caso a execução tenha sido interrompida (journal impresso no início)
M22C5D_JOURNAL=<journal.json> npx --no-install tsx scripts/m22c5d-r2-mp3-cleanup.ts
```
Sem as variáveis o script sai com código 2 (`BLOCKED`) sem contatar nada (provado: execução com ambiente vazio).

## 6. Critérios PASS/FAIL
PASS: saída `0` com todos os passos `PASS` (24 em `su`, 28 em `rc`), contadores dentro dos limites, e `S6 cleanup: N/N keys absent, 0 still present, 0 errors` nos dois modos. FAIL: qualquer passo `FAIL`, aborto por guard/limite, ou chave residual. `BLOCKED` (2): guard não satisfeito (nada foi contatado). Mesmo com PASS, a habilitação do MP3 continua exigindo decisão e autorização separadas.

## 7. Cleanup
Automático em `finally` (sucesso, falha e aborto) sobre as chaves do journal do modo; verificado por `HEAD` (404) de cada chave. Se o processo morrer (Ctrl+C, queda), o journal em disco já tem as chaves planejadas: execute o passo 3. Documentos no Firestore Emulator são descartáveis (emulador).

## 8. Comprovado offline × precisa de R2 real
| Comprovado offline (emulador + bucket em memória + adaptador real + guard real) | Precisa do R2 real |
|---|---|
| Todos os cenários S0–S4 e S6 nos dois modos (52 passos) | Presigned PUT/GET reais com `audio/mpeg` (assinatura, `if-none-match`, CORS não se aplica a Node) |
| Guard de isolamento, de comandos, de chaves, de limites; journal e cleanup | ETag real do R2 para PUT único e `CopyObject` condicional beta (`cf-copy-destination-if-none-match`) |
| Fatos MP3 em recibos/verificação persistida, retomada, concorrência | Range GET real com `If-Match`, latência e o orçamento de 38 s do seal |
| Recusa total sem ambiente (BLOCKED) | Comportamento do provedor com `Content-Type: audio/mpeg` e `Cache-Control` |

## 9. Riscos
Sem Safari/Firefox/Android; leitor remoto MP3 desligado; política `decoderDelayFrames` com um único encoder; revisão Codex indisponível (`gpt-6.2-sol`), exceção registrada; o harness abre o codec em memória dentro do próprio processo de dev (nunca no build publicável).

### Riscos residuais (C0.1), a reavaliar antes da execução real
- `Promise.all` (finalize ×3 e S4): se uma requisição falha, as demais já estão em voo; o cleanup só começa depois de fechar o servidor local.
- A resposta da API local (`env.api`) não tem limite de bytes (destino é o servidor local do próprio processo).
- Uma exceção inesperada fora dos cenários não imprime os passos já executados.
- Revisão Codex (`gpt-6.2-sol`) indisponível: revisão por subagente Claude somente leitura; sem conformidade integral com o AGENTS.md declarada.

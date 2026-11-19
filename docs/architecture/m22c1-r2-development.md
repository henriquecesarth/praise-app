# M22-C.1 — R2 privado em desenvolvimento

O checkpoint da Biblioteca Ministerial simulada é `7d9767e29270f45311b881be9d2e0d051e0cdc10`, descendente de M22-A e M22-B. O modo direto trabalha com os mesmos seis WAVs, manifesto e estados do [M22-C](./m22c-ministry-audio-library.md). O navegador usa o Express para operações de autorização e metadados. A autorização concede um PUT ou GET temporário para um único objeto no endpoint S3 do R2. A verificação continua no backend.

## Operações e dados

| Operação | Contrato |
| --- | --- |
| Reserva e progresso | A API mantém as rotas e respostas do M22-C. A resposta inclui `transfer:"direct"` nas novas reservas feitas com adaptador direto. Sessões antigas mantêm o transporte anterior. |
| `POST /uploads/:id/stems/:stemId/upload-url` | Admin ativo solicita `{attempt,url,headers,expiresAt}`. O prazo de PUT é de até 300 s e termina junto com a sessão de 24 h. O PUT assina a chave e o método, `If-None-Match: *`, tipo WAV e tamanho. O navegador envia o tamanho do Blob. |
| `POST /uploads/:id/stems/:stemId/complete` | Admin ativo envia `{attempt}`. Depois da verificação e do armazenamento, uma transação revalida a permissão, o estado e a tentativa e registra a faixa. A resposta mantém o DTO de progresso. `409 AUDIO_UPLOAD_MISSING` permite enviar pelo mesmo link. `422 AUDIO_UPLOAD_INVALID` invalida a tentativa e permite uma nova chave, com até três tentativas por faixa. |
| Finalização | Exige seis confirmações. No modo direto, checa em paralelo tamanho e a identidade dos seis objetos verificados antes de publicar em transação autorizada. Os despachos repetidos convergem para a gravação publicada. |
| Leitura | `GET /:id/playback` retorna o manifesto e, no modo direto, `transfer:"direct"` e `tracks:[{id,url,headers}]`. Cada GET assinado expira em até 120 s e usa `If-Match` para a identidade verificada. A Web verifica o SHA-256 antes de liberar o mixer. |
| Falhas e expiração | A API autoriza novas concessões e novas confirmações. Uma resposta perdida pode ser recuperada confirmando a faixa já gravada. Uma URL reutilizada com PUT condicional pode retornar 412. O cliente checa o progresso ou confirma antes de prosseguir. |

As rotas de controle permanecem sob `/api/v1/ministries/:ministryId/audio-library`. `directAttempts` acrescenta ao documento Firestore o número da tentativa, seu estado inválido quando aplicável e o recibo opaco do objeto final quando confirmado. O campo `uploadedStemIds` continua sendo a lista pública de progresso. URLs assinadas são emitidas na hora e ficam fora do Firestore.

`staging/ministry-audio/{ministryId}/{id}/{stem}/{attempt}.wav` recebe o PUT condicional do navegador. O backend lê o objeto de staging em fluxo, valida cabeçalho WAV PCM16, frames, tamanho e SHA-256 e grava os bytes verificados por PUT condicional em `objects/ministry-audio/{ministryId}/{id}/{stem}.wav`. O ETag é usado como precondição de versão em HEAD e GET. O SHA-256 do manifesto é calculado separadamente a partir dos bytes. O fluxo usa um PUT por objeto. [Operações condicionais R2](https://developers.cloudflare.com/r2/api/s3/conditional-operations/) · [Compatibilidade e checksums S3](https://developers.cloudflare.com/r2/api/s3/api/)

O endpoint de limpeza interpreta somente chaves conhecidas do registro. Ele aguarda 15 minutos após o vencimento da reserva direta e remove staging. Objetos finais são elegíveis exclusivamente para sessões expiradas e nunca publicadas. A passagem de controle posterior cobre gravações tardias. A política do bucket deve expirar somente `staging/ministry-audio/`, por exemplo após dois dias, para recuperar bytes de uma transferência iniciada antes da expiração ou de um processo interrompido. [Consistência do R2](https://developers.cloudflare.com/r2/reference/consistency/) · [Ciclo de vida do R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

### Revogação

As operações de API usam o pertencimento vigente ao ministério. A revogação impede emitir links e confirmar uma faixa. Um PUT já concedido ainda pode gravar a chave de staging durante a janela concedida. Um GET já concedido é uma capacidade de portador e pode iniciar uma leitura até vencer, inclusive após revogação ou arquivamento. Um download iniciado e bytes já entregues podem permanecer disponíveis no dispositivo. Se o produto exigir revogação de cada leitura antes de transferir os bytes, usar autorização em um proxy de mídia com limite de resposta adequado à mídia. [URLs pré-assinadas R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)

## Vercel e orçamento de recursos

- `backend/vercel.json` configura 60 s para `src/app.ts`. A Vercel documenta 4,5 MB de corpo HTTP e até 500 MB em `/tmp`. Os corpos de áudio seguem diretamente entre navegador e R2. O Express valida uma faixa por confirmação, limitando tamanho e tempo de rede. A cópia temporária ocupa até 57,6 MB e o limite de duas confirmações simultâneas reserva até 115,2 MB de áudio temporário por instância. [Limites de Functions](https://vercel.com/docs/functions/limitations) · [Runtime e filesystem](https://vercel.com/docs/functions/runtimes)
- A finalização direta usa seis HEAD condicionais e a confirmação individual distribui a leitura integral dos seis WAVs por chamadas. No pior caso, verificar e promover um WAV transfere até 115,2 MB em uma chamada. O tempo real com cold start, região, Firestore e R2 no limite é **Unknown / Not yet verified**. A homologação mede o tamanho máximo e o p95 antes de liberar o modo em Vercel. Se o prazo for insuficiente, medir primeiro a transferência regional e propor uma confirmação assíncrona com persistência de progresso antes de escolher qualquer infraestrutura.
- O limite permanece 300 s a 48 kHz. A Web pode preparar as faixas diretas individualmente e reter os seis AudioBuffers necessários à reprodução sincronizada. No limite, somente os buffers decodificados somam cerca de 659 MiB. Testar em dispositivos representativos antes de ampliar duração. Para gravações maiores, avaliar FLAC com teste de decodificação e frame alignment, e reprodução segmentada com buffers sincronizados e retomada de requisições. Opus exige avaliação perceptiva e de alinhamento. O manifesto preserva codec, taxa, canais, frames e duração.
- Seis WAVs estéreo PCM16 a 44,1 kHz usam aproximadamente 63,5 MB por minuto. Três minutos representam cerca de 190,5 MB e o limite de cinco minutos a 48 kHz chega a 345,6 MB. A tarifa Standard publicada de US$ 0,015 por GB-mês dá cerca de US$ 2,86 por mil gravações de três minutos ou US$ 5,18 por mil gravações no limite, antes de franquias, gravações arquivadas, staging e operações. Um envio completo normal escreve seis objetos temporários e seis finais. Separar esses custos do tráfego de leitura e do runtime ao homologar. [Tarifas R2](https://developers.cloudflare.com/r2/pricing/)

## Limitações conhecidas (revisão independente, 2026-11-19)

- O cliente não usa o relógio do dispositivo para decidir expiração. Uma concessão vencida é detectada e renovada no máximo uma vez por faixa:
  - **Upload:** o provedor responde 403, ou o PUT falha sem status HTTP (rede ou CORS opaco). Neste último caso a renovação só ocorre depois que `/complete` confirma `AUDIO_UPLOAD_MISSING`, isto é, que o objeto de staging não existe. O PUT é criação exclusiva (`If-None-Match: *`), então repetir é seguro. Se o objeto chegou, `/complete` o sela e nada é reenviado. A segunda falha encerra com erro, sem terceira concessão.
  - **Download:** 401, 403 ou falha de rede sem status (convertida em `ApiError` com `statusCode 0`) pedem um novo `playback` ao backend e uma nova tentativa. O backend revalida o pertencimento ao ministério a cada renovação. Cancelamento por `AbortSignal` nunca renova.
- **Selagem e retomada:** o selo é idempotente. Depois de um timeout (503), uma falha do Firestore ou uma resposta perdida, `/complete` com a mesma tentativa verifica primeiro o objeto final e reaproveita um objeto já correto. Staging é consumido sem apagar o final. O controller admite 2 selagens simultâneas por instância (`DIRECT_SEAL_LIMIT`, responde 429) e o adaptador também 2 (`MAX_SEAL_OPERATIONS`, responde 503). Os limites coincidem, de modo que o do controller atua primeiro. O limite de memória e de `/tmp` fica em 2 × 57,6 MB.
- **Arquivos maiores:** o timeout de selagem de 38 s fica abaixo do `maxDuration` de 60 s configurado em `backend/vercel.json` para `src/app.ts`. Um WAV de 57,6 MB exige GET, SHA-256, escrita temporária e PUT dentro desse orçamento. Se a vazão entre a função e o R2 ficar por volta de 3 MB/s ou menos, a selagem estoura e o cliente pode tentar de novo sem progresso. Timeout e proteção de memória foram mantidos até haver medição real. O tempo real é **Unknown / Not yet verified**.
- A sonda `/complete` anterior ao PUT consome um dos dois slots de selagem da instância. Sob carga, um 429 após um PUT bem-sucedido falha a publicação até nova tentativa com a mesma tentativa. Avaliar pular a sonda em tentativa nova ou repetir 429/503 com backoff.
- O orçamento único de 38 s para selagem pode não caber nos maiores stems com baixa vazão entre função e R2. Medir na homologação.
- A allowlist da Web valida somente a origem do endpoint da conta R2, não o bucket nem o prefixo da chave. Reforço opcional.
- O carregamento sob demanda do mixer não aborta o download em andamento quando uma nova carga substitui a anterior. Custo de banda, sem impacto de correção.

## Validação local (2026-11-19)

| Verificação | Resultado |
| --- | --- |
| Adaptador R2 com SDK mockado | PASS, 15 testes |
| Integração `ministry_audio` com Firestore Emulator | PASS, 22 testes |
| Web `ministry-audio-api` e `six-stem-mixer` | PASS, 13 e 7 testes, incluindo renovação de upload e download |
| E2E Chromium `m22c-ministry-audio.spec.ts`, modo proxy | PASS: seis faixas publicadas por admin e reproduzidas por outro membro, com início comum |
| E2E Chromium, modo `MINISTRY_AUDIO_DIRECT_SIMULATOR=1` | PASS (repetido após as mudanças de renovação) |
| `tsc --noEmit` da Web e `tsc -p tsconfig.publish.json --noEmit` do backend | PASS |
| `vite build --mode test` | PASS (saída em diretório temporário; `--mode test` é o único build local permitido pelo guard de publicação) |
| `tsc --noEmit` completo do backend | 35 erros em 7 arquivos de teste, **idênticos** aos de `7d9767e` (exportado com `git archive`). Falha global preexistente, sem relação com o M22-C.1 |
| R2 real | Histórico: **BLOCKED** no processo do Claude. O usuário executou depois os testes reais; veja "M22-C.3D — resultados reais consolidados". |

A expiração e a renovação são cobertas por testes unitários da Web. O E2E não fabrica uma URL expirada.

## M22-C.2 — homologação real (status)

| Escopo | Status |
| --- | --- |
| Smoke do adaptador contra o R2 de desenvolvimento (CORS, PUT/GET assinados, escrita condicional, SHA-256, selagem, expiração, limpeza) | **PASS**, executado pelo usuário no PowerShell local. Evidência: relato do usuário. O Claude não teve acesso às credenciais nem à saída bruta. |
| Fluxo Web completo no R2 (publicação, manifesto/hashes, reprodução por outro membro, mute/solo/seek, zero Demucs, renovação, retomada, revogação) | **PASS (6 de 6 testes)**, executado pelo usuário; relato do usuário, o Claude não viu a saída bruta. Foi executado antes da retomada persistida e do modo `ranged`/`copy`. |
| Benchmark de selagem com WAVs de 1 a 57,6 MB | Executado pelo usuário em várias configurações; veja "M22-C.3D — resultados reais consolidados". São observações únicas, sem percentil (p95 **não** foi medido). |
| Runtime Vercel | **NOT_EXECUTED**. Nenhuma medição local o representa. Exige deploy autorizado separadamente. |

Execução local, a partir de `web/` e `backend/`, com Auth e Firestore Emulators ativos (portas 9098 e 8186, projeto `demo-louvaio-unit`) e as variáveis `MINISTRY_AUDIO_R2_DEV_*` definidas só no PowerShell:

```powershell
# web/: fluxo completo; a origem do navegador precisa ser http://127.0.0.1:5173 (a única autorizada no CORS)
$env:M22C_R2_LIVE_TESTS = '1'
npx --no-install playwright test --config playwright.m22c-r2.config.ts

# web/: M22-C.4, mesmo fluxo com Range GET + CopyObject e o cenário 7 (retomada persistida)
# $env:M22C_R2_MODE = 'ranged-copy'   # sem isso: stream/upload (padrão), o cenário 7 é ignorado

# backend/: benchmark M22-C.3, perfil quick (1, 5 e 15 MiB, uma execução cada, sequencial)
$env:M22C_R2_LIVE_TESTS = '1'; $env:M22C_R2_BENCH = '1'
npx --no-install tsx scripts/m22c-r2-seal-bench.ts --profile quick
# O perfil large (30 MiB e 57,6 MB, uma execução cada) exige autorização separada e nunca inicia sozinho:
# npx --no-install tsx scripts/m22c-r2-seal-bench.ts --profile large

# backend/: remove só os objetos sintéticos da rodada de navegador (valores da linha CLEANUP_HINT)
$env:M22C_CLEANUP_MINISTRY = 'm22c-r2-<uuid>'; $env:M22C_CLEANUP_RECORDINGS = '<id1>,<id2>'
npx --no-install tsx scripts/m22c-r2-e2e-cleanup.ts
```

- A porta 5173 precisa estar livre (`--strictPort`). A spec usa o ministério fictício `m22c-r2-<uuid>` no emulador e dados sintéticos, aborta qualquer host fora de `127.0.0.1` e do endpoint R2, e nunca registra URLs assinadas nem credenciais. Falhas opacas de rede/CORS são simuladas com `route.abort('failed')` em PUT e GET. A janela do GET já emitido após revogação é observada e depois verificada como expirada (a spec espera cerca de 2 minutos).
- O benchmark só aceita rodar com `M22C_R2_LIVE_TESTS=1`, `M22C_R2_BENCH=1` e `--profile quick|large` explícito. Sem perfil ou com argumento inválido ele recusa (saída 2). Ele faz uma execução por tamanho, sequencial, sem retentativa, e para no primeiro erro ou timeout (os tamanhos restantes ficam `NOT_RUN`). Reporta valores observados por tamanho, sem percentil: bytes reais, PUT, selagem, GET com SHA-256, total, pico de RSS, pico de disco temporário (amostragem a cada 100 ms, melhor esforço, só snapshots `louvaio-r2-*` novos) e se a selagem coube nos 38 s. Uma selagem abortada no orçamento aparece como `FAILED at seal (503)` com `seal within 38 s: NO`. O resultado local não reproduz o runtime da Vercel.
- **Limpeza do benchmark:** ocorre em `finally` (sucesso, erro e timeout) e remove somente o par staging/final da própria execução, sob `r2-development-probe/<id>`. Em Ctrl+C ou SIGTERM o processo não sai direto: cancela os envios, aguarda a etapa em curso (a selagem é limitada a 38 s pelo adaptador), roda a mesma limpeza e sai com 130. Falha de limpeza é reportada e resulta em saída 3. Risco residual inerente ao adaptador: se uma selagem estoura, o cliente aborta o PUT do objeto final, mas o R2 ainda pode confirmá-lo depois da remoção. Isso pode deixar uma chave `objects/…/r2-development-probe/…` órfã, que o ciclo de vida do bucket não expira. Depois de qualquer rodada com falha de selagem, confira esse prefixo. O benchmark exige Node 20.3 ou mais recente (`AbortSignal.any`). Saídas: 0 completo, 1 falha, 2 recusado ou bloqueado, 3 limpeza falhou, 130 interrompido.
- **Cobertura de CORS:** a rodada de navegador usa `context.route`, e o Chromium pode responder o preflight por conta própria enquanto a interceptação está ativa. Assim, métodos e cabeçalhos permitidos pelo bucket (`If-None-Match`, `If-Match`) são comprovados pelo smoke do adaptador, que faz o preflight real, e não por esta rodada. Esta rodada comprova o fluxo, as requisições assinadas e a recuperação de falhas.
- A métrica de selagem do navegador conta só as confirmações `/complete` com resposta 200 (as sondas anteriores ao PUT respondem 409).
- Os objetos publicados pela spec ficam no bucket até a limpeza acima. A regra de ciclo de vida do bucket expira só o staging.

## M22-C.3A — diagnóstico da selagem (status)

**Observado no R2 de desenvolvimento (executado pelo usuário, perfil large):** 30 MiB selou em 18.035 ms. O WAV máximo (57.600.044 B, 54,9 MiB) falhou em 38.020 ms com 503, pico de RSS de 328,4 MiB e pico de disco temporário de 18,3 MiB. A limpeza passou nas duas amostras. São duas observações únicas: não há percentil.

**Onde o orçamento de 38 s é gasto (análise do código):** um único `AbortSignal.timeout(38 s)` cobre, em sequência, (1) uma sonda GET do objeto final, que normalmente responde 404; (2) o GET do staging, lido em stream, com validação do cabeçalho WAV, SHA-256 e escrita do snapshot em disco, uma escrita assíncrona por pedaço; (3) o PUT condicional do snapshot como objeto final. Ou seja, duas transferências completas do tamanho do WAV (download mais upload) dentro da função.

**Causa raiz: hipótese ainda aberta.**
- Compatível com o dado: 30 MiB em 18,0 s dá cerca de 0,60 s/MiB; extrapolar linearmente para 54,9 MiB dá cerca de 33 s. O arquivo máximo fica a uns 13% do orçamento e variação de rede basta para estourá-lo, sem nenhum travamento.
- **Não explicado:** o pico de 18,3 MiB no snapshot equivale a cerca de um terço do arquivo. Se a leitura do staging tivesse terminado, o snapshot teria 54,9 MiB. Logo, no momento do aborto a leitura do staging ainda não tinha acabado, e a leitura foi muito mais lenta que nas execuções de 30 MiB.
- **Hipótese rejeitada:** que o `stat` atrasasse em relação à escrita. Teste offline neste Windows, com escrita de 57,6 MB em pedaços de 64 KiB e amostragem a cada 100 ms: a defasagem máxima do `stat` foi de 64 KiB e o tamanho final coincidiu. Os 18,3 MiB não são artefato do `stat`.
- **Abertas:** variação ou limite de vazão por conexão na leitura do R2 naquela execução, e contenção do laço de eventos que reduzisse a amostragem do sampler. A instrumentação abaixo as separa na próxima rodada.

**Instrumentação adicionada (somente tempos e tamanhos, nunca chaves, URLs ou conteúdo):** o `R2StemStorage` aceita `diagnostics` e emite `final-probe`, `staging-headers` (tempo até os cabeçalhos do GET), `staging-verify` (total, espera de rede, SHA-256 e escrita do snapshot), `final-put`, `copy`, `confirm` e `budget-abort` com a fase em que o orçamento terminou. O benchmark imprime essas linhas como `DIAG …`, com vazão em MiB/s.

**Alternativas, na ordem pedida:**

| | Proposta | Avaliação |
| --- | --- | --- |
| A | Otimizar o streaming atual | Ganho provavelmente pequeno: o SHA-256 e a escrita são rápidos frente à rede, e a instrumentação medirá isso. Leitura em faixas paralelas ou multipart paralelo só valeriam se o limite for vazão por conexão. Adiado até haver dados. |
| B | Verificar o staging e promover por `CopyObject` no R2 | **Recomendada e implementada atrás de uma opção.** Elimina o upload e o snapshot em disco, porque a promoção deixa de trafegar pela função. Restam a leitura única do staging e uma cópia interna. |
| C | Finalização assíncrona e recuperável | Exige fila ou processamento fora da requisição, com persistência de progresso. Custo e infraestrutura a avaliar antes de qualquer adoção. Só se a leitura sozinha não couber no orçamento. |

**Alternativa B, restrições da API R2 (documentação oficial consultada, não assumida):** `CopyObject` aceita as condições de origem `x-amz-copy-source-if-match` e `-if-none-match`. A condição de destino existe como `cf-copy-destination-if-none-match`, marcada como **beta**, e as condições de origem e destino **não são avaliadas atomicamente**. `x-amz-metadata-directive` é suportado. Checksums S3 (`x-amz-checksum-*`) **não** são suportados, por isso o SHA-256 continua sendo calculado pelo nosso código. `UploadPartCopy` não aceita condições e não é usado.

**Como a opção `copy` preserva as garantias:**
- O SHA-256, o cabeçalho WAV PCM16, os frames e o tamanho são verificados pela mesma `verifyWav`, numa leitura do staging. Nenhum hash informado pelo cliente é aceito.
- A cópia só é aceita para exatamente o objeto verificado (`CopySourceIfMatch` com o ETag lido na verificação). O PUT de staging é de criação exclusiva, então ele não pode ser trocado enquanto existir.
- O ETag devolvido pela cópia precisa ser igual ao do staging (um objeto de parte única mantém o MD5). Depois, um HEAD com `If-Match` confere ETag, tamanho, tipo e `Cache-Control`.
- Imutabilidade e idempotência: o objeto final existente é verificado integralmente antes de qualquer cópia. Um 412 (final já existe, ou origem alterada) só é aceito se o final existente passar na verificação completa. Caso contrário, 409.
- O isolamento entre ministérios não muda: `assertSealKeys` valida as chaves antes de qualquer chamada, e a origem da cópia é a chave de staging validada.
- Staging apagado e reenviado dentro da vida útil da URL assinada (ação que o cliente não consegue disparar sozinho): a cópia só prossegue se o ETag (MD5) coincidir com o verificado. Um staging que some entre a verificação e a cópia vira 409 `AUDIO_UPLOAD_MISSING` (reenviável). ETag de staging com `-` é rejeitado. O cabeçalho de destino é fail-closed: sem ele a cópia não é enviada. Após a cópia, o HEAD recusa `Content-Encoding`/`Content-Disposition` herdados, e um ETag sem aspas no corpo XML da cópia é tolerado. Se o R2 devolver algo diferente disso ao vivo: **Unknown / Not yet verified**.
- **Risco residual, não testado ao vivo:** se a condição de destino beta fosse ignorada pelo R2 e um final já existisse por uma corrida, ele seria reescrito com bytes idênticos aos verificados contra o mesmo manifesto. O efeito é um reescrita idempotente, não uma troca de conteúdo.

**Ativação:** `MINISTRY_AUDIO_R2_DEV_PROMOTION=copy` (padrão `upload`, o caminho já validado). Ela entra pelo `getR2DevelopmentConfig` e vale para a API e para o benchmark.

**Inspeção somente leitura de órfãos:** `backend/scripts/m22c-r2-probe-inspect.ts` só executa `ListObjectsV2` nos prefixos `staging/ministry-audio/r2-development-probe/` e `objects/ministry-audio/r2-development-probe/` e lista chave, tamanho e data. Exige `M22C_R2_LIVE_TESTS=1` e `M22C_R2_INSPECT=1`. Não escreve nem apaga. Qualquer remoção só acontece depois de identificar as chaves e com autorização separada.

**Plano de validação progressiva (cada passo com autorização):** (1) inspeção de órfãos; (2) quick com o modo `upload` e os `DIAG`, para ver a distribuição das fases em tamanhos pequenos; (3) quick com `copy`; (4) large com `copy`, só depois de (3) passar e com autorização; (5) E2E do navegador com `copy`. Se a leitura única do staging do WAV máximo não couber em 38 s mesmo com `copy`, a alternativa A (leitura paralela) ou C passa a ser necessária. Estado na época: instrumentação e modo `copy` testados offline. Resultados reais posteriores: veja "M22-C.3D — resultados reais consolidados".

## M22-C.3B — imutabilidade do CopyObject (status)

**Resultado real já informado (modo `copy`, quick):** 1, 5 e 15 MiB PASS (selagem 1.711, 3.463 e 4.492 ms), SHA-256, HEAD, GET e limpeza PASS, exit 0. Isso **não** prova a condição de não sobrescrita do destino, que é beta no R2.

**Teste isolado:** `backend/scripts/m22c-r2-copy-immutability.ts` (núcleo testável em `backend/src/scripts/m22c-r2-copy-immutability-core.ts`). Usa exatamente a requisição de promoção do adaptador (`buildPromotionCopyCommand`, exportada de `r2-storage.ts`) e o adaptador real em modo `copy`. Só escreve objetos sintéticos de 64 KiB, com ids aleatórios, em `staging/…/r2-development-probe/` e `objects/…/r2-development-probe/`. Cada chave passa por um guard de prefixo e a limpeza cobre apenas as chaves registradas pela própria execução, confirmando por HEAD que sumiram.

Cenários (para no primeiro FAIL; um destino sobrescrito é FAIL imediato):
1. Destino A criado (create-only), ETag e SHA-256 registrados. Staging B diferente.
2. Promoção de B sobre a chave de A com origem correta e `cf-copy-destination-if-none-match: *`: exige 412; GET prova que A é idêntico, e ETag e metadados não mudaram; origem B intacta.
3. Condição de origem inválida: sobre destino ocupado (412, A intacto) e sobre destino livre (412, nada criado).
4. Adaptador em modo `copy` sobre destino ocupado: deve responder exatamente 409 sem alterar A. Isso prova a pré-verificação do objeto final, não a condição da cópia, que é exercitada pelas cópias brutas acima.
5. Idempotência: primeira promoção cria o destino com os bytes verificados e metadados fixos; repetir a cópia bruta devolve 412 e o objeto fica idêntico; o `seal` do adaptador devolve o mesmo recibo duas vezes, inclusive para um staging novo.
6. Concorrência: duas promoções simultâneas de conteúdos diferentes para a mesma chave; exige um sucesso e um 412 e que o conteúdo final seja o do vencedor. É uma observação única, não prova atomicidade para toda intercalação.

**Execução (somente com autorização):** `M22C_R2_LIVE_TESTS=1`, `M22C_R2_COPY_IMMUTABILITY=1` e as variáveis do bucket de desenvolvimento, depois `npx --no-install tsx scripts/m22c-r2-copy-immutability.ts` em `backend/`. Há uma pausa de 1,1 s antes de reescrever uma chave já usada, e um 429 do provedor em chave disputada é reportado como `INCONCLUSIVE` (reexecute), nunca como falha de proteção. Códigos de saída, por precedência: 3 limpeza falhou, 1 FAIL ou erro inesperado, 130 interrompido sem outra falha, 0 PASS; 2 bloqueado. O padrão do processo continua `upload`; o script força `copy` apenas para o adaptador sob teste.

**Estado:** testado offline com um provedor simulado (inclui provedores que ignoram a condição de destino ou de origem, e uma corrida não atômica). **PASS no R2 real**, executado pelo usuário no M22-C.3B (relato do usuário; o Claude não viu a saída bruta). A concorrência é uma observação única.

## M22-C.3D — selagem de áudio grande (status)

**Observado no R2 real (modo `copy`, perfil large, executado pelo usuário):** 30 MiB PASS (23.109 ms). O WAV máximo (57.600.044 B) falhou em 38.005 ms com 503: `staging-verify` levou 36.508 ms, dos quais 36.276 ms de espera de rede e 232 ms de SHA-256, e o timeout caiu durante o `CopyObject`. Limpeza OK. São observações únicas. O gargalo é a leitura do staging pela função (cerca de 1,5 MiB/s nessa máquina), não o processamento. Se essa vazão vem do limite por conexão ou do enlace da máquina de teste é **Unknown / Not yet verified**; a Vercel pode ter outra vazão até o R2, o que também não foi medido.

**Comparação**

| | Proposta | Resolve | Custo e risco |
| --- | --- | --- | --- |
| A | Leitura paralela por Range GET, ordenada, limitada, fixada no ETag | Só se o limite for vazão por conexão. Se for o enlace, não ganha nada | Sem infraestrutura. Memória de poucas partes de 4 MiB: cerca de 28 MiB por selagem e 56 MiB com duas selagens simultâneas, nunca o WAV inteiro. Mais requisições (14 GETs para o WAV máximo) |
| B | Estado persistido no Firestore, retomada após timeout | Impede perder a verificação concluída quando a cópia falha. Não reduz a leitura inicial | Um campo no documento de reserva que já existe. Sem fila. Exige uma nova chamada de `/complete` |
| C | A + B | Reduz o tempo da leitura (se A ajudar) e preserva o resultado se algo falhar depois | Soma das complexidades acima, ambas opcionais e testadas |
| D | Finalização assíncrona | Remove o limite de tempo da requisição | Exige fila ou processamento fora da requisição: Vercel Queues ou Cron são recursos adicionais e possivelmente pagos. **Não adotada nem implementada** |
| E (descartada agora) | Verificação parcial retomável com SHA-256 serializável | Permitiria verificar em várias requisições mesmo se a leitura não couber em uma | Exigiria uma implementação própria de SHA-256 com estado persistido e mudaria o contrato de `/complete`. Só se A+B não deixarem margem |

**Solução escolhida: C (A + B), nenhuma ativa por padrão.**
- **A:** `MINISTRY_AUDIO_R2_DEV_READ=ranged` (padrão `stream`, uma leitura). Um `HEAD` fixa ETag e metadados; cada parte é um `GET` com `Range` e `If-Match` do ETag. O servidor aceita a parte só com o mesmo ETag, o `Content-Range` exato e o tamanho exato, e recusa resposta maior que a faixa. As partes são entregues em ordem a um único SHA-256 e à mesma `verifyWav` (cabeçalho, frames, tamanho, SHA-256). Um objeto trocado ou sumido no meio da leitura é inválido; uma falha transitória de parte tem uma nova tentativa, dentro do orçamento. Vale para o staging e para o objeto final já existente, e só para objetos maiores que uma parte: os menores usam o GET simples. Um problema de leitura (objeto trocado, resposta fora do formato) mantém seu status (409 ou 503) e não gasta a tentativa; só uma divergência de conteúdo vira 422. O benchmark real `ranged` + `copy` (30 MiB e o WAV máximo) passou, o que exercitou o formato de `Content-Range`, `ETag` e `Content-Length` das respostas parciais do R2 para objetos maiores que uma parte; a saída bruta não foi vista pelo Claude. Nenhum hash do cliente é aceito.
- **B:** depois de uma verificação **completa** do staging (modo `copy`), o adaptador entrega `{ etag, lastModified }` ao serviço (`onVerified`) antes de iniciar a cópia, e o serviço grava em `directAttempts[stem].verified`, só para a tentativa vigente, sem recibo e sem marca de inválida. Em um `/complete` seguinte, o serviço devolve esse valor ao adaptador, que só o aceita se o objeto vivo tiver o mesmo ETag, o mesmo `lastModified`, o tamanho e os metadados do manifesto; qualquer diferença volta à verificação completa. A cópia continua presa ao ETag (`CopySourceIfMatch`) e ao destino create-only. Um objeto final cujo ETag é o do staging verificado, com os metadados fixos, é aceito com um único `HEAD`. A tentativa inválida, o recibo e a troca de tentativa descartam o valor. O cliente nunca envia nem lê esse estado (`uploadView` não o expõe).
- O modo `upload` e o `CopyObject` continuam como estavam: `upload` é o padrão, `copy` é opt-in, e o modo `upload` ignora a retomada (precisa dos bytes verificados em disco).

**Segurança da retomada:** o valor persistido só nasce de uma verificação que o próprio servidor concluiu. O staging é criado com `If-None-Match: *` e o cliente não tem URL de exclusão, então a versão verificada não pode ser trocada; trocar o objeto exigiria apagar e reenviar dentro da vida da URL, o que muda `lastModified` e força nova verificação. A proteção real é o staging create-only e a ausência de qualquer URL de exclusão para o cliente. O `If-Match` da cópia e a conferência por ETag usam o mesmo MD5, então não são uma defesa independente; reenviar os mesmos bytes mantém o ETag e só muda `lastModified`. O risco residual é uma colisão de MD5 com `lastModified` igual, considerado desprezível.

**Efeito esperado, a confirmar ao vivo:** no cenário observado (verificação de 36,5 s, cópia estourando o orçamento), o primeiro `/complete` ainda falha com 503, mas deixa a verificação gravada, e o segundo conclui em segundos (HEAD, cópia, HEAD). O ganho de A depende da vazão por conexão e **Unknown / Not yet verified**. Se a leitura sozinha não couber em 38 s e A não ajudar, nenhuma das duas resolve; aí restam elevar o orçamento até cerca de 50 s (a função tem 60 s), E ou D.

**Validação offline (sem R2 real):** leitor ordenado (ordem com conclusão fora de ordem, limites de concorrência e de memória, cancelamento, rejeição sem promessa solta); adaptador com um bucket em memória (partes fixadas no ETag, parte adulterada, ETag/range/versão diferentes, retentativa e falha persistente, objeto final por faixas, retomada válida, inválida e adulterada, falha de cópia seguida de retomada, callback que falha, modo `upload` ignorando a retomada); serviço contra o Firestore Emulator (estado preservado após 503 e oferecido só à mesma tentativa, descartado em tentativa inválida).

**Plano progressivo no R2 real (cada passo com autorização):**
1. Inspeção somente leitura dos prefixos sintéticos (`scripts/m22c-r2-probe-inspect.ts`).
2. `quick` com `MINISTRY_AUDIO_R2_DEV_READ=ranged` e promoção `upload`: confere ausência de regressão e compara a vazão de `staging-verify` com o modo `stream`.
3. `quick` com `ranged` e `copy`.
4. Teste de imutabilidade do `CopyObject` (`scripts/m22c-r2-copy-immutability.ts`): PASS no R2 real (M22-C.3B), relato do usuário.
5. `large` com `ranged` e `copy` (uma execução). Decisão: margem confortável se `staging-verify` do WAV máximo ficar bem abaixo de 38 s; se a vazão agregada for igual à do modo `stream`, o limite é o enlace e A não ajuda.
6. E2E de navegador com `ranged` e `copy`, incluindo a retomada após um 503 forçado.

## M22-C.3D — resultados reais consolidados (checkpoint)

Todos os números abaixo foram executados pelo usuário no bucket privado de desenvolvimento e relatados ao Claude. O Claude não teve credenciais nem viu a saída bruta. São **observações únicas, sem percentil**, medidas na máquina de desenvolvimento do usuário.

| Execução | Resultado |
| --- | --- |
| Smoke do adaptador (C.2) | PASS |
| Fluxo Web completo no R2 (C.2) | PASS, 6 de 6 testes (antes de `ranged`, `copy` e da retomada persistida) |
| Modo `upload`, perfil large (C.3A) | 30 MiB PASS, selagem 18.035 ms. WAV máximo FAIL, 38.020 ms, 503 |
| Modo `copy` com leitura `stream`, quick | 1, 5 e 15 MiB PASS, selagem 1.711, 3.463 e 4.492 ms |
| Modo `copy` com leitura `stream`, large | 30 MiB PASS, 23.109 ms. WAV máximo FAIL, 38.005 ms, 503: `staging-verify` 36.508 ms (36.276 ms de rede, 232 ms de SHA-256) |
| Imutabilidade do `CopyObject` (C.3B) | PASS: a promoção não sobrescreve um destino existente |
| **Modo `copy` com leitura `ranged`, large (C.3D)** | 30 MiB PASS, selagem 12.032 ms. WAV máximo (57.600.044 B) **PASS, selagem 12.385 ms**, limpeza OK, exit 0 |

**Sobre os 35 segundos:** no benchmark `ranged` + `copy`, o GET com SHA-256 do WAV máximo levou 35.335 ms (3.361 ms para 30 MiB). Esse tempo é o download feito pelo próprio benchmark, com **uma única conexão**, da máquina do usuário, e não o tempo da selagem. Ele coincide com os cerca de 36 s que a leitura simples do staging levou antes (cerca de 1,5 MiB/s). Já a selagem, que lê o staging em até 4 conexões paralelas, concluiu em 12,4 s com o mesmo arquivo. Isso é **compatível** com um limite de vazão por conexão e não do enlace, mas uma observação não prova a causa, e o ganho precisa ser repetido antes de ser tratado como regra. A folga observada foi de 12,4 s sobre o orçamento de 38 s.

**Não validado:**
- **Runtime Vercel: NOT_EXECUTED.** Nenhuma medição local o representa: região, cold start, memória, vazão até o R2 e `maxDuration` de 60 s só aparecem com um deploy autorizado separadamente. A recomendação de manter `stream` e `upload` como padrão vale até lá.
- A retomada persistida (`verified` no Firestore) foi testada com o Firestore Emulator e um R2 simulado, **não** contra o R2 real nem na Vercel.
- Dois selos simultâneos no R2 real, e a leitura `ranged` com stems menores que 4 MiB (que usam o GET simples), não foram observados.
- O p95 não foi medido. O CORS e o fluxo de navegador foram homologados antes do `ranged` e do `copy`.

**Padrões que continuam valendo:** `MINISTRY_AUDIO_R2_DEV_READ=stream` e `MINISTRY_AUDIO_R2_DEV_PROMOTION=upload`. `ranged` e `copy` são opt-in e só existem para o bucket de desenvolvimento, atrás de `getR2DevelopmentConfig`.

## M22-C.4 — E2E real com Range GET + CopyObject e retomada persistida

**Resultado real (execução completa com `M22C_R2_MODE=ranged-copy`, relato do usuário; o Claude não viu a saída bruta):** 8 de 8 testes PASS (0 a 7), saída 0. Observações únicas, sem percentil, na máquina do usuário:

| Medida | Valor |
| --- | --- |
| Publicação de seis faixas pela UI | 30.339 ms |
| Mixer pronto para o outro membro | 2.573 ms |
| `/complete` com verificação completa por Range GET e falha injetada (503) | 2.028 ms |
| Retomada persistida (HEAD, cópia, HEAD; sem reler o staging) | 1.779 ms |
| Repetição idempotente (sem chamada ao R2) | 56 ms |

Também PASS: integridade SHA-256, reprodução sincronizada com mute/solo/seek e sem Demucs, renovação após falha, retomada de upload, revogação com expiração do GET emitido, publicação idempotente, 422 na troca de conteúdo e nova verificação completa para o mesmo conteúdo reenviado. Os valores exatos de contagem de HEAD/Range GET/CopyObject e o resultado da limpeza não foram informados ao Claude: **Unknown / Not yet verified** (a spec os confere por asserção, e o PASS implica que bateram).

**Uma execução anterior** falhou no cenário 7 (um `/complete` esperado como 200 devolveu 503, faixas guitar/piano/other). Depois da instrumentação sanitizada, a execução completa passou. A causa daquele 503 **nunca foi identificada**: a sequência passa offline e a repetição não reproduziu, então ele permanece sem explicação (provável erro transitório do R2 ou da rede, sem prova). O rastro sanitizado (`R2_FAIL`/`DIAG`) fica para uma recorrência.

**O que continua não homologado:** runtime Vercel (**NOT_EXECUTED**), dois selos simultâneos no R2 real, o p95 e a retomada persistida sob o limite de 60 s da função. `/__m22c` e o servidor de E2E vivem em `backend/scripts/`, fora de `tsconfig.publish.json`, e não aparecem em `backend/src` nem em `web/src`.

Inspeção somente leitura dos prefixos desta execução (os ids vêm da linha `CLEANUP_HINT`): em `backend/`, com `M22C_R2_LIVE_TESTS=1`, `M22C_R2_INSPECT=1` e `M22C_INSPECT_MINISTRIES='m22c-r2-<uuid>'`, execute `npx --no-install tsx scripts/m22c-r2-probe-inspect.ts`. O script só lista; nada é alterado.

Preparação (histórico):

**O que mudou:** `web/playwright.m22c-r2.config.ts` agora define explicitamente `MINISTRY_AUDIO_R2_DEV_READ` e `MINISTRY_AUDIO_R2_DEV_PROMOTION` para o backend que ele inicia (um valor esquecido no shell não os altera) conforme `M22C_R2_MODE`: ausente ou `default` mantém `stream`/`upload`; `ranged-copy` usa `ranged`/`copy`. O backend sobe por `backend/scripts/m22c-r2-e2e-server.ts` (fora do build publicado), que recusa iniciar se o ambiente não for o isolado (`NODE_ENV=test`, projeto `demo-*`, Firestore e Auth Emulators em `127.0.0.1`, R2 de desenvolvimento, sem Vercel) ou se os modos efetivos diferirem dos esperados. Em loopback, `/__m22c` expõe: `modes`, `counters` (contagem de HEAD/GET/Range GET/PUT e cópias por staging/final; nunca chaves, URLs ou conteúdo), `fault` (faz a próxima `CopyObject` falhar antes de chegar ao R2) e `delete-staging` (só chaves de staging de um ministério `m22c-r2-<uuid>`). Os padrões do produto não mudam fora deste config.

**Cenários:** os seis anteriores, mais o 0 (modos efetivos) e o 7 (só em `ranged-copy`): verificação completa por Range GET (2 partes), falha controlada na promoção, `directAttempts[stem].verified` gravado só para a tentativa vigente, segundo `/complete` sem nova leitura do staging (só HEAD e cópia), terceira chamada sem nenhuma chamada ao R2, publicação idempotente, SHA-256/tamanho conferidos no R2, nenhum ETag/recibo/`verified` nas respostas ao cliente, bytes trocados após verificação (422, tentativa marcada inválida, tentativa seguinte aceita) e mesmos bytes reenviados (`lastModified` novo, nova verificação completa).

**Comandos (PowerShell, com os Emulators ativos e as variáveis `MINISTRY_AUDIO_R2_DEV_*` locais):**

```powershell
cd web
$env:M22C_R2_LIVE_TESTS = '1'
# 1) Fluxo funcional com R2 nos padrões do produto (stream/upload)
Remove-Item Env:M22C_R2_MODE -ErrorAction SilentlyContinue
npx --no-install playwright test --config playwright.m22c-r2.config.ts
# 2) Fluxo funcional + retomada persistida (ranged + copy)
$env:M22C_R2_MODE = 'ranged-copy'
npx --no-install playwright test --config playwright.m22c-r2.config.ts
# 3) Desempenho de download/selagem: backend/scripts/m22c-r2-seal-bench.ts (perfil large exige autorização)
# 4) Limpeza, se a linha CLEANUP_HINT indicar objetos restantes: scripts/m22c-r2-e2e-cleanup.ts
```

**Separação do status:** fluxo funcional com R2 nos padrões `stream`/`upload`: PASS anterior (6/6), **não** repetido nesta etapa. Fluxo com `ranged`/`copy` e retomada persistida no R2 real: **PASS (8/8)**, veja acima. Desempenho de download: observações do C.3D; os tempos do cenário 7 são observações únicas. Runtime Vercel: **NOT_EXECUTED**.

**Primeira execução real (relato do usuário):** cenários 0–6 PASS; no 7, 503 controlado, retomada em 1.805 ms, repetição em 58 ms e 422 na troca de conteúdo passaram, e depois um `/complete` esperado como 200 (linha 541, faixas guitar/piano/other, sem falha armada) devolveu 503. Saída 1. **Causa: Unknown / Not yet verified.** A sequência exata roda offline (`ministry-audio-r2-sequence.integration.test.ts`: serviço real, Firestore Emulator, adaptador `ranged`+`copy`, bucket em memória) e passa, o que afasta um defeito de lógica do serviço ou do adaptador nessa ordem. Restam causas dependentes do R2/rede (erro transitório sem nova tentativa em HEAD/CopyObject, `maxAttempts: 1`), que só um rastro real distingue. O servidor de E2E agora guarda um rastro sanitizado (`/__m22c/trace`: comando, staging/final, duração, nome do erro, status HTTP e código de transporte; nunca chaves, URLs nem mensagens) e imprime `R2_FAIL …` no stderr; a spec imprime `DIAG …` quando um `/complete` devolve status inesperado. Reexecução isolada do cenário 7: `npx --no-install playwright test --config playwright.m22c-r2.config.ts --grep "7\. retomada"` (com `M22C_R2_MODE=ranged-copy`).

## Homologação posterior

Histórico: **BLOCKED** no processo do Claude, que não tem credenciais; o usuário executou os testes reais (veja os resultados consolidados). A execução externa depende de autorização e credenciais de desenvolvimento para um bucket privado dedicado. Use o Firestore Emulator e dados sintéticos. Para homologação, configure o bucket com acesso público desligado e token de objeto com escopo deste bucket. Defina CORS com origens exatas da Web, métodos PUT e GET, cabeçalhos `Content-Type`, `Cache-Control`, `If-None-Match` e `If-Match`, e exponha `ETag` e `Content-Length` se necessário para diagnóstico. Confirme preflight aceito e rejeição para uma origem fora da lista. [CORS R2](https://developers.cloudflare.com/r2/buckets/cors/)

Com autorização, configure no **backend** `MINISTRY_AUDIO_R2_DEV=1`, `MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID`, `MINISTRY_AUDIO_R2_DEV_BUCKET`, `MINISTRY_AUDIO_R2_DEV_ACCESS_KEY_ID` e `MINISTRY_AUDIO_R2_DEV_SECRET_ACCESS_KEY`. Use um bucket com nome `louvaio-ministry-audio-dev` ou sufixo de desenvolvimento. O aplicativo exige o modo local do M22-C com Auth e Firestore em loopback. Na Web, `VITE_MINISTRY_AUDIO_R2_ORIGIN` recebe somente a origem HTTPS S3 do bucket. O modo direto simulado usa `MINISTRY_AUDIO_DIRECT_SIMULATOR=1` e `MINISTRY_AUDIO_DIRECT_SIMULATOR_ORIGIN` com a origem HTTP de loopback da API.

Depois de verificar as políticas do bucket, execute de `backend/` com o opt-in `M22C_R2_LIVE_TESTS=1`:

```powershell
npx --no-install tsx scripts/m22c-r2-dev-smoke.ts
```

O teste usa um WAV sintético, cobre PUT e GET assinados, CORS, escrita condicional, SHA-256, reutilização em outro objeto e expiração. Remova apenas a fixture criada pelo próprio teste. Na rodada de navegador, repetir publicação com seis WAVs e reprodução em outra sessão, refazer após ticket vencido, revogar o membro e verificar a janela remanescente de um GET anterior. Medir o maior WAV permitido e as seis confirmações e a finalização com o orçamento de 60 s.

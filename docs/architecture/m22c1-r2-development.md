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
| R2 real | **BLOCKED** |

A expiração e a renovação são cobertas por testes unitários da Web. O E2E não fabrica uma URL expirada.

## Homologação posterior

**BLOCKED** para R2 real. A execução externa depende de autorização e credenciais de desenvolvimento para um bucket privado dedicado. Use o Firestore Emulator e dados sintéticos. Para homologação, configure o bucket com acesso público desligado e token de objeto com escopo deste bucket. Defina CORS com origens exatas da Web, métodos PUT e GET, cabeçalhos `Content-Type`, `Cache-Control`, `If-None-Match` e `If-Match`, e exponha `ETag` e `Content-Length` se necessário para diagnóstico. Confirme preflight aceito e rejeição para uma origem fora da lista. [CORS R2](https://developers.cloudflare.com/r2/buckets/cors/)

Com autorização, configure no **backend** `MINISTRY_AUDIO_R2_DEV=1`, `MINISTRY_AUDIO_R2_DEV_ACCOUNT_ID`, `MINISTRY_AUDIO_R2_DEV_BUCKET`, `MINISTRY_AUDIO_R2_DEV_ACCESS_KEY_ID` e `MINISTRY_AUDIO_R2_DEV_SECRET_ACCESS_KEY`. Use um bucket com nome `louvaio-ministry-audio-dev` ou sufixo de desenvolvimento. O aplicativo exige o modo local do M22-C com Auth e Firestore em loopback. Na Web, `VITE_MINISTRY_AUDIO_R2_ORIGIN` recebe somente a origem HTTPS S3 do bucket. O modo direto simulado usa `MINISTRY_AUDIO_DIRECT_SIMULATOR=1` e `MINISTRY_AUDIO_DIRECT_SIMULATOR_ORIGIN` com a origem HTTP de loopback da API.

Depois de verificar as políticas do bucket, execute de `backend/` com o opt-in `M22C_R2_LIVE_TESTS=1`:

```powershell
npx --no-install tsx scripts/m22c-r2-dev-smoke.ts
```

O teste usa um WAV sintético, cobre PUT e GET assinados, CORS, escrita condicional, SHA-256, reutilização em outro objeto e expiração. Remova apenas a fixture criada pelo próprio teste. Na rodada de navegador, repetir publicação com seis WAVs e reprodução em outra sessão, refazer após ticket vencido, revogar o membro e verificar a janela remanescente de um GET anterior. Medir o maior WAV permitido e as seis confirmações e a finalização com o orçamento de 60 s.

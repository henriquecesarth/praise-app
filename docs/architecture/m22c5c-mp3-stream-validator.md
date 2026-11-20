# M22-C.5C — Validador MPEG streaming (backend, isolado)

Status: **implementado e testado localmente; não ligado a nenhum fluxo**. `serverByteValidation` continua `false` para `mp3_cbr256`, `AUDIO_CODEC_NOT_ENABLED` continua respondendo 422, e as chaves/MIME persistidos (`.wav`/`audio/wav`), o fluxo WAV v1, R2 e Vercel não foram tocados.

## Arquitetura

`backend/src/features/ministry_audio/mp3-stream-validator.ts`

| Peça | Papel |
|---|---|
| `Mp3StemStreamValidator` | Máquina de estados `write(chunk)` / `finish()`. Aceita chunks de qualquer tamanho (inclusive 1 byte); cabeçalhos e frames podem atravessar chunks. Memória O(1): um frame Info (≤ 836 bytes) + contadores. |
| `verifyMp3Stem(source, expected, status, opts)` | Adaptador de armazenamento no formato de `verifyWav`: qualquer `AsyncIterable<Uint8Array>` (Readable do Node, gerador de `readRanged` do R2, corpo de upload direto), `contentEncoding`, `AbortSignal` e `sink` opcional (ex.: arquivo de staging). Falhas viram `AppError` genérico (409/422) com o motivo estruturado em `cause` não enumerável. |
| `assertIdentityContentEncoding` | Só ausente/`identity` é aceito; `gzip`, `br`, `deflate` etc. são recusados, pois alterariam os bytes hasheados. |
| `assertConsistentMp3Stems` | As seis faixas devem ter a mesma taxa, `frames`, `mpegAudioFrames`, atraso/corte da tag e atraso de decodificador. |

O descritor é validado por `mp3StemSchema` (contrato v2) antes de ler qualquer byte, o que já limita tamanho (≤ ceiling do perfil), duração (≤ 300 s) e a invariante `atraso + frames + corte = mpegAudioFrames × 1152`.

## O que é validado (tudo fail-closed)

- **Estrutura**: nenhum byte antes do primeiro frame (ID3v2 → `ID3`; outro lixo → `LEADING_GARBAGE`), nenhum byte após o último, sem frame truncado, sem frame além do declarado, bytes totais = `sizeBytes`.
- **Cada cabeçalho**: sincronismo, MPEG-1, Layer III, bitrate 256 kbps (não aceita free-format nem índices reservados), taxa = a declarada (44,1/48 kHz), estéreo ou joint stereo (mono e dual channel recusados), sem proteção CRC por frame, sem ênfase. Bits de padding são respeitados no comprimento do frame (`floor(144·256000/taxa) + padding`); um padding adulterado desloca os frames seguintes e é rejeitado.
- **Frame Info/Xing (primeiro frame)**: informação lateral zerada, nome `Info` ou `Xing`, flags com contagem de frames e de bytes, flags desconhecidas recusadas, identificação do codificador ASCII imprimível, CRC-16 da tag LAME, bytes nulos até o fim do frame.
- **Contagens**: `frames` da tag = `mpegAudioFrames`; `bytes` da tag e "music length" da LAME = tamanho do arquivo; CRC-16 de música (todos os bytes após o frame Info, cabeçalhos incluídos) confere.
- **Integridade**: SHA-256 incremental igual ao declarado.
- **Reuso**: após qualquer falha o validador fica invalidado (`write`/`finish` seguintes lançam `INVALID_INPUT`). O `sink` de `verifyMp3Stem` recebe os chunks antes das checagens finais de CRC/SHA; o que ele gravar não é verificado até a promessa resolver e deve ser descartado se rejeitar.
- **Alinhamento**: ver abaixo.

## Semântica investigada (medida, não presumida)

Medido com ffmpeg 9.0.1 / libmp3lame, 44,1 e 48 kHz, de 1 amostra a 300 s:

1. **Contagem de frames do Info**: o campo "frames" conta os frames de **áudio** e **exclui** o próprio frame Info (ex.: 194 frames no arquivo, tag = 193). É o mesmo significado de `mpegAudioFrames` no manifesto.
2. **O frame Info não contribui com amostras**: o fluxo decodificado tem `mpegAudioFrames × 1152` amostras, e não `(mpegAudioFrames + 1) × 1152`. Ele é um frame de aparência válida porém silencioso, com informação lateral zerada, que decodificadores sem suporte à tag tocariam como 1152 amostras de silêncio; por isso o leitor Web exige a tag.
3. **"bytes" do Info e "music length" da LAME** são o tamanho do arquivo inteiro (incluindo o frame Info).
4. **CRCs**: ambos são CRC-16/ARC (polinômio refletido 0xA001, inicial 0). O da tag cobre os primeiros 190 bytes do frame Info; o de música cobre todos os bytes depois do frame Info.
5. **Atraso**: a tag guarda 12 bits de atraso e de corte do **codificador** (576 e 1032–1681 nas amostras medidas). O decodificador acrescenta o próprio atraso (no Chrome 150, medido: 1105 = 576 + 529 amostras removidas do início). O manifesto dobra isso em `encoderDelayFrames`.

### Como o atraso declarado é tratado sem constantes

- Soma: `atraso_tag + corte_tag = encoderDelayFrames + paddingFrames` (e `frames` fecha com `mpegAudioFrames × 1152 − atraso_tag − corte_tag`).
- Derivado: `decoderDelayFrames = encoderDelayFrames − atraso_tag = corte_tag − paddingFrames`, exigido em `[0, 1152]` e devolvido no resultado.
- **A soma não detecta um par deslocado em k quadros**, e o atraso do decodificador não é observável nos bytes. Por isso há duas defesas explícitas: (a) `expectedDecoderDelayFrames`, uma **política configurável** (nunca um literal no módulo) que, quando fornecida, exige igualdade; (b) `assertConsistentMp3Stems`, que exige o mesmo valor nas seis faixas. Sem nenhuma das duas, uma troca coordenada nas seis faixas passaria; **a política deve ser fixada ao habilitar o gate**.

## Comparação com o leitor Web experimental

Reproduzível com `npx tsx scripts/m22c5c/web-parity.ts` (a partir de `backend/`), que usa as fixtures versionadas e **sai com erro** se uma fixture faltar ou divergir, ou se o servidor aceitar algo que o Web rejeita. O desempenho vem de `scripts/m22c5c/bench.ts`.

As 4 fixtures reais válidas mutadas (≈ 600 bits invertidos por arquivo), truncamentos e bytes extras, 2 552 casos:

| Resultado | Casos |
|---|---|
| Ambos aceitam (originais) | 4 |
| Ambos rejeitam | 61 |
| **Web aceita e servidor rejeita** | 2 487 (2 050 por CRC de música, 436 por frame Info/side info, 1 por modo de canal) |
| **Servidor aceita e Web rejeita** | **0** |

O servidor é estritamente mais rígido. O leitor Web só percorre cabeçalhos e confere a tag; adulterações de payload são pegas por SHA-256 no Web (passo separado) e por CRC + SHA no servidor. Divergências deliberadas: o servidor recusa frames com proteção CRC (o Web as tolera) e exige o formato exato da tag (side info zerada, flags, CRCs).

## Fixtures e fluxos de teste

- **Suíte unitária padrão (sem ffmpeg)**: `mp3-stream-validator.test.ts` usa (a) um construtor sintético em TypeScript de MP3 estruturalmente válido (Info + CRCs corretos), usado para mutações, e (b) fixtures **reais** versionadas em `shared/fixtures/ministry-audio-mp3-v1/` (ver README): 2 sondas (`probes.json`) e 11 casos (`real-encoder-cases.json`, 4 válidos e 7 inválidos como ID3 padrão, sem Info, 128/320 kbps, mono, 32 kHz e taxa trocada). Arquivo ausente ou SHA divergente **falha**; não há `skip`. Foi executada com `ffmpeg` fora do PATH.
- **Fluxo explícito com ffmpeg** (fora de `test:unit`): `npx tsx scripts/m22c5c/ffmpeg-real-encoder-check.ts` gera MP3 novos (9 combinações de taxa/duração até 60 s, mais ID3/sem Info/128 kbps/mono), valida-os e reverifica as fixtures; sai com erro sem ffmpeg ou com fixture divergente. `scripts/m22c5c/generate-real-encoder-fixtures.ts` regenera os casos e aborta sem escrever se o validador discordar.
- **Paridade Web/backend** sem regex: `probes.json` é a fonte estável; `web/src/audio/mp3-calibration-probes.test.ts` exige que o módulo do Web seja idêntico a ele.
- **Três preocupações testadas separadamente** nos mesmos bytes: (1) estrutura falha com SHA recalculado; (2) SHA falha com estrutura intacta; (3) alinhamento falha com estrutura e SHA válidos (política fixada). A decodificação e o alinhamento das amostras pertencem ao leitor Web, não ao validador.

## Dados malformados e modos de falha

Cobertos por testes (128 em `mp3-stream-validator.test.ts`): ID3v2/ID3v1, lixo inicial e final, bytes além do declarado, truncamento em 18 offsets, todos os campos do cabeçalho, mudança de taxa/bitrate no meio, padding adulterado, Info ausente/falso/sem flags/CRCs errados/contagens erradas, descritor incoerente, SHA, Content-Encoding, e invalidação do validador após falha. Revisão de segurança:

- **Sink com escrita parcial**: se o `sink` falha depois de gravar parte dos bytes, `verifyMp3Stem` rejeita com o erro do sink, fecha a origem (o gerador recebe `return`) e não drena o restante; o chamador sabe quanto escreveu e deve descartar. Bytes entregues ao sink são **não verificados** até a promessa resolver.
- **Memória com chunks adversariais**: um chunk maior que o restante declarado é processado só até `sizeBytes` (o prefixo é julgado primeiro, então o motivo não depende do chunking) e o excesso é recusado com `TOO_LARGE`; 200 mil chunks vazios e chunks de 1 byte não crescem o heap proporcionalmente; `Uint8Array` que é *view* de um buffer maior é lido só no próprio intervalo.
- **Falha de origem e cancelamento**: erro no meio do fluxo e `AbortSignal` (antes e entre chunks) rejeitam e fecham a origem; rejeições precoces (Content-Encoding, descritor inválido) também destroem/encerram a origem ainda não iniciada; nunca resolvem como válido.
- **CRC de música e da tag, contagem de frames Info/Xing, bytes da tag e "music length"**: cada um tem teste com o código exato.
- **Consistência das seis faixas**: `assertConsistentMp3Stems` (taxa, frames, `mpegAudioFrames`, atraso/corte da tag, `decoderDelayFrames`); sem a política, três faixas com atrasos 300/301/302 são aceitas individualmente e reprovadas no conjunto.

## Desempenho e memória

Arquivos reais de 300 s (9,16 MB), Node 22.14, um único núcleo:

| Arquivo | Chunk | Tempo | Vazão | Crescimento do heap |
|---|---|---|---|---|
| 44,1 kHz (11 486 frames) | 64 KiB | 66 ms | 138 MB/s | 0,4 MB |
| 44,1 kHz | 1 KiB | 87 ms | 105 MB/s | 1,9 MB |
| 44,1 kHz | 16 B | 1,12 s | 8 MB/s | 4,0 MB |
| 48 kHz (12 501 frames) | 64 KiB | 61 ms | 151 MB/s | 0,03 MB |

Buffer retido no máximo: 836 bytes (44,1 kHz) / 769 bytes (48 kHz). O custo é independente do tamanho do arquivo além do hash e do CRC lineares.

## Limitações e riscos restantes

1. **Sem publicação MP3**: `serverByteValidation` segue `false` e `AUDIO_CODEC_NOT_ENABLED` segue ativo. O módulo não está ligado a `storage.ts`, `r2-storage.ts` nem ao simulador direto; faltam chaves e MIME `.mp3`/`audio/mpeg` e `assertConsistentMp3Stems` na reserva/publicação.
2. **Sem integração R2** nem leitura real de objeto: apenas a interface (`AsyncIterable`, compatível com `readRanged`) foi preparada e testada offline.
3. **Sem validação mobile**.
4. **O parser não garante áudio semanticamente correto**: confere estrutura, contagens, CRCs, SHA-256 e a tag LAME, não o conteúdo; a correspondência com os `frames` canônicos só é demonstrada pelo leitor Web (Chrome 150).
5. **Política de `decoderDelayFrames` pendente**: o valor não é observável nos bytes (a soma atraso+corte não vê deslocamentos coordenados). Antes de habilitar o gate é preciso fixar `expectedDecoderDelayFrames` (hoje 529 nos testes, só como política de teste) e exigir `assertConsistentMp3Stems`.
6. **Rigidez deliberada**: só ffmpeg/libmp3lame foi exercitado; frames com CRC próprio, tags fora do padrão LAME ou outros codificadores serão rejeitados.
7. **Fixtures regeneráveis dependem de ffmpeg**, mas os bytes versionados são a referência; trocar de versão do ffmpeg muda as fixtures e exige revisão de diff.

# M22-C.5D-A — Armazenamento codec-aware (offline) e política de alinhamento MP3

Status: **offline, desligado**. A publicação MP3 continua bloqueada: `serverByteValidation: false` para `mp3_cbr256`,
`requirePublishableStems` responde `422 AUDIO_CODEC_NOT_ENABLED`, o serviço persiste apenas manifestos PCM, nenhuma rota
real alcança um stem MP3. Nada de R2 real, Firebase de produção, mobile, Vercel ou `main` foi tocado.

## 1. Auditoria: o que assumia WAV

| Ponto | Onde | Tratamento |
|---|---|---|
| Extensão `.wav` em chaves de staging/final | `direct-storage.ts` (regex), `ministry-audio.service.ts` (`objectKey/finalKey/stagingKey`) | Chaves agora ligadas a **uma extensão por codec**; `.wav` idêntica ao v1 (parâmetro padrão `wav`). O serviço deriva a extensão do codec do stem **persistido** (hoje sempre `wav`). |
| `audio/wav` | `r2-storage.ts` (`signUpload`, `putCommand`, `matchesManifest`, copy), `simulated-direct-storage.ts` (headers PUT/GET) | MIME vem de `CODEC_PROFILES[stem.codec].mime`; no simulador, da extensão da chave (que `assertSealKeys` amarra ao codec). |
| `verifyWav` exclusivo | `r2-storage.ts` (2 caminhos), simulador (seal/assertObject) | `verifyStemBytes` (`stem-codec.ts`) escolhe o verificador por `expected.codec` (manifesto validado por schema), nunca por extensão/Content-Type enviados. MP3 → `verifyMp3Stem` com o perfil de publicação. |
| `stemSchema` (só PCM) | `r2-storage.ts` | `isValidStoredStem` (união PCM ∪ MP3). Para PCM o resultado é o mesmo. |
| Mensagem `uploadInvalid` | `direct-storage.ts` | WAV: texto v1 inalterado; MP3: "O stem MP3 …". Mesmo código `AUDIO_UPLOAD_INVALID`, mesmo status. |
| Content-Encoding | R2 | Para MP3, `matchesManifest` recusa qualquer encoding ≠ identity (um corpo comprimido mudaria os bytes hasheados). WAV: regra v1 inalterada. |
| Receipts/ETag, CopyObject, ranged reads, snapshot | `r2-storage.ts` | Inalterados: operam sobre bytes; só o MIME do `CopyObject`/`Put` e o verificador mudam. Snapshot ganhou extensão do codec (`verified.mp3`). |
| `requestHash`, persistência do manifesto, idempotência, cleanup | serviço/repositório | **Não alterados.** O manifesto continua v1/PCM; `reserve` ainda recusa MP3. |
| Upload via servidor (`storage.ts`, `SimulatedStemStorage`) | `StemStorage` | Continua WAV-only **por tipo** (`StemManifest` PCM): não há conversão silenciosa; MP3 não compila nesse caminho. |

Seleção do codec: sempre do manifesto validado (`stemV2Schema`), nunca da extensão/Content-Type do usuário. A chave é derivada
do codec e conferida (`assertSealKeys(..., extension)`); chave `.mp3` com stem PCM (ou o inverso) → 400.

## 2. Arquitetura

- `stem-codec.ts`: `StoredStem`, `stemExtension`, `stemMime`, `isValidStoredStem`, `verifyStemBytes` (devolve o `Mp3ValidationResult` para o MP3, usado na consistência do conjunto).
- `mp3-encoder-profile.ts`: perfil de encoder suportado e `MP3_PUBLICATION_VALIDATION` (opções obrigatórias de toda verificação MP3 no armazenamento).
- `mp3-stream-validator.ts`: novas opções `allowedEncoderPrefixes` e `expectedTagDelayFrames` (além de `expectedDecoderDelayFrames`).
- `direct-storage.ts`, `r2-storage.ts`, `simulated-direct-storage.ts`, `ministry-audio.service.ts`: codec-aware, sem mudar o comportamento WAV.

Falhas parciais e staging:
- Nada vira objeto final sem verificação completa (tamanho, SHA-256, estrutura MPEG, CRCs, perfil) feita **antes** do `Put`/`Copy`. Staging inválido → 422 `AUDIO_UPLOAD_INVALID`, nenhuma escrita no destino (testado em promoção por upload e por cópia).
- Destino create-only (`If-None-Match: *` / `cf-copy-destination-if-none-match`): um objeto final existente nunca é sobrescrito; corrida (412) resolve-se verificando integralmente o vencedor; vencedor corrompido → 409.
- Retomada: final já selado é revalidado e devolvido sem reler o staging; verificação persistida (ETag + lastModified) segue valendo para cópia.
- Limpeza (`remove`) aceita chaves de ambas as extensões e recusa outras; o `cleanup` do serviço usa a extensão do manifesto.
- Isolamento por ministério/gravação/stem: staging e final precisam coincidir em ministério, gravação e stem (testado com ministério, gravação e stem trocados).
- `verifyMp3Stem` fecha a origem em toda saída (inclusive rejeição precoce); o snapshot em disco recebe os chunks durante a verificação, mas só é usado (upload do objeto final) depois que a verificação completa (CRCs, SHA-256, perfil) conclui, e é apagado no `finally` inclusive em falha.

## 3. Política de `decoderDelayFrames` (decisão técnica)

Fato: o atraso do decodificador (somado ao do encoder no `encoderDelayFrames` do manifesto) **não é observável nos bytes**; a soma
atraso+corte não detecta deslocamento coordenado. Logo ele precisa ser fixado por **perfil de encoder com evidência**, não aceito do cliente.

Evidência (reprodutível por `shared/fixtures/ministry-audio-mp3-v1` e `backend/scripts/m22c5c/ffmpeg-real-encoder-check.ts`):
- Encoder: ffmpeg/libmp3lame; identificação na tag LAME `Lavc63.1.` (prefixo `Lavc`).
- Atraso do encoder na tag: 576 em todas as amostras. As fixtures versionadas têm só 4 casos válidos curtos (≤ 0,3 s, 44,1 e 48 kHz); as medições de 1 a 300 s vêm das execuções M22-C.5B/C.5C (PoC e `ffmpeg-real-encoder-check.ts`, que exige ffmpeg) e não são reproduzíveis só pelos artefatos versionados.
- Atraso do decodificador: 529 (= 528 + 1, atraso de decodificação MPEG-1 Layer III); Chrome 150 remove 576 + 529 = 1105 no início, medido com precisão de amostra em 44,1 e 48 kHz (M22-C.5B).

Política implementada (`MP3_ENCODER_PROFILE`, id `lavc-libmp3lame-576-529`):
1. identificação do encoder deve começar com `Lavc`, senão `UNSUPPORTED_STREAM` (combinação desconhecida é rejeitada, não adivinhada);
2. atraso do encoder na tag deve ser 576, senão `ALIGNMENT`;
3. `decoderDelayFrames = encoderDelayFrames − atraso_tag` deve ser 529, senão `ALIGNMENT` (rejeita o deslocamento coordenado em k amostras, mesmo com soma, tamanho e SHA-256 válidos — teste dedicado);
4. as seis faixas: o esquema já exige `codec/taxa/frames/atraso/corte/mpegAudioFrames` iguais; com o perfil fixado, `tagDelay`, `tagPadding` e `decoderDelay` também são idênticos por construção. `verifyStemBytes` devolve o resultado de cada faixa para `assertConsistentMp3Stems`, que o serviço **deve** chamar sobre as seis faixas ao habilitar a publicação (teste cobre conjunto consistente e uma faixa divergente);
5. A identificação `Lavc…`, o atraso 576 e o corte da tag são **declaratórios** (controlados por quem fabrica os bytes): não provam o encoder. A âncora real é o par fixo 576 + 529, válido apenas se o encoder for de fato o libmp3lame do ffmpeg; o perfil reduz a superfície, não a elimina.
6. 529 é propriedade **deste perfil**, não constante universal. Outro encoder (por exemplo `LAME3.x` nativo) exige nova evidência e novo perfil.

O que a política **não** prova: alinhamento em dispositivos reais. Evidência de alinhamento existe somente para Chrome 150 (leitor Web, `canonical`). Safari/iOS, Firefox e Android seguem não verificados; o leitor Web continua fail-closed por calibração.
Status: a política está **proposta e implementada offline**; a habilitação da publicação MP3 permanece **BLOCKED** até a homologação em R2 de desenvolvimento e em mais navegadores/dispositivos.

## 4. Testes (`codec-aware-storage.test.ts`, 24 testes, sem FFmpeg, sem rede)

Chaves e MIME por codec; perfil (encoder desconhecido com CRC/SHA válidos, deslocamento coordenado, dano estrutural com SHA recalculado, truncamento, byte extra, conjunto de seis faixas); R2 offline (assinatura `audio/mpeg`, promoção por upload e por cópia, leitura por ranges, retomada idempotente, corrida 412, final corrompido, `HEAD` condicional, Content-Encoding, tipo errado, remoção); simulador local (upload `audio/mpeg`, seal, download, imutabilidade, adulteração, remoção); regressão WAV no mesmo adaptador.

## 5. Limitações / pendências

- Emulador do Firestore **não executado** (CLI/emulador indisponível offline): testes de integração do serviço NOT_EXECUTED.
- Serviço/repositório/rotas continuam PCM-only: persistência de manifesto v2, `requestHash` para MP3, chamada de `assertConsistentMp3Stems` e a troca de `serverByteValidation` são o próximo passo e só após homologação.
- Download pelo servidor (`open`/`Content-Type: audio/wav` no controller) segue WAV; o MP3 usa URL assinada direta.
- Sem R2 real, sem mobile, sem Safari/Firefox/Android; memória de seis stems de 300 s não homologada.

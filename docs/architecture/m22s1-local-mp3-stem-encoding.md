# M22-S1 — Compressão local dos stems em MP3 CBR 256 kbps (protótipo experimental)

Status: **protótipo isolado, opt-in e sem uso em nenhuma tela ou rota**. `serverByteValidation` de `mp3_cbr256` continua `false`,
`AUDIO_CODEC_NOT_ENABLED` continua respondendo, o backend não foi alterado, os fluxos WAV v1 estão intactos.
`MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`. Nenhuma qualidade auditiva foi aprovada (depende da escuta do operador).

## 1. Infraestrutura MP3 que já existe (auditada, nada reconstruído)

| Peça | Estado |
| --- | --- |
| Contrato v2 (`audio-codec.ts`, `ministry-audio.schema.ts`, `ministry-audio-contract.ts`) | Pronto: `mp3_cbr256`, 44,1/48 kHz, estéreo, ≤ 300 s, `alignment {encoderDelayFrames, paddingFrames, mpegAudioFrames, infoFrame}` com a invariante `delay + frames + padding = mpegAudioFrames × 1152` |
| Validador MPEG streaming do servidor (`mp3-stream-validator.ts`) | Pronto e testado (128 testes): cabeçalho a cabeçalho, frame Info/Xing, tag LAME com CRC-16 da tag e da música, contagens, SHA-256, consistência dos seis stems |
| Perfil do encoder (`mp3-encoder-profile.ts`) | **Um único perfil**: `Lavc` (ffmpeg/libmp3lame), atraso da tag 576, atraso do decodificador 529 |
| Leitor/decodificador Web (`mp3-stem-decoder.ts`, `mp3-calibration-probes.ts`) | Experimental; calibra o atraso do decodificador por sonda embutida, sem constante fixa |
| Persistência e R2 DEV (`m22c5d-b`, `m22c5d-c0`) | Homologados em R2 DEV (modos `su` e `rc`, 52/52 PASS, **relatado pelo operador**) |
| Rascunho Web (`local-separation-draft.ts`) | Só WAV PCM16; nenhum encoder |
| Android | `ministry_audio_models.dart` conhece o codec; **sem reprodução de stems MP3** |

Gates restantes (de `m22c5d-c3-checkpoint-and-integration-plan.md`, não resolvidos aqui): revisão Codex indisponível; **nenhum encoder
no cliente (este protótipo é o primeiro)**; nenhum cliente Web/mobile de produção consome MP3 v2; medições em Safari/Firefox/Android/iOS;
paginação da biblioteca com MP3 invisível; autorização explícita para habilitar o codec, R2 de produção ou deploy.

## 2. Encoders candidatos

| Candidato | Licença | Manutenção | Tamanho | Resultado |
| --- | --- | --- | --- | --- |
| Encoder nativo do navegador | n/a | n/a | 0 | **Inviável**: Chrome 158 — `AudioEncoder.isConfigSupported({codec:'mp3'})` = `false`; `MediaRecorder` não aceita `audio/mpeg` |
| **`wasm-media-encoders` 0.7.0** (LAME 3.100 em WASM) | wrapper MIT; LAME LGPL-2.0 | npm 2024-05; 4 anos de histórico, sem dependências além de `@swc/helpers` | WASM 130 KB; módulo com WASM embutido 783 KB (290 KB gzip) | **Escolhido** |
| `lame-wasm` 0.3.0 | MIT + LGPL-2.0 | npm 2026-10, projeto novo | 449 KB | Gera exatamente os mesmos bytes (CBR 256) no teste; API menor. Alternativa de reserva |
| `@breezystack/lamejs` 1.2.7 / `lamejs` | LGPL-3.0 (JavaScript) | fork recente / abandonado (2022) | 460 KB / 6 MB | Mesma saída sem Info frame; LGPL-3.0 é mais restritiva para empacotamento |
| `@ffmpeg/core` (FFmpeg WASM) | **GPL-2.0-or-later** | ativo | **63 MB** | Descartado: GPL e tamanho, sem necessidade (LAME direto basta) |
| FFmpeg/Python locais | — | — | — | Só referência experimental (decodificação e comparação), nunca dependência do usuário |

Nenhum candidato escreve o frame Info/Xing: o primeiro frame do fluxo bruto já é áudio. O contrato exige esse frame, então o protótipo o constrói
(seção 4). Nenhuma API paga, Vercel ou VPS: tudo roda no navegador, em Worker.

### LICENSE_STATUS (não é parecer jurídico)

`wasm-media-encoders` é MIT, mas o `.wasm` contém **LAME (LGPL-2.0)** compilado. Uso comercial é permitido pela LGPL **com condições**:
aviso de copyright e texto da licença, e possibilidade de o usuário substituir a biblioteca. O LAME entra como módulo WebAssembly separado,
mas hoje vai embutido em base64 no chunk do Worker; para satisfazer a troca da biblioteca de forma limpa, a fase S2 deve carregar o `.wasm` como arquivo
próprio (o pacote aceita uma URL) e incluir o aviso LGPL/LAME nas notas de terceiros. **Revisão jurídica pendente** (Unknown / Not yet verified).
Patentes do MP3 expiraram em 2017 (informação pública, não verificada por jurídico). A dependência foi adicionada em `web/package.json` (versão exata) e
`package-lock.json`; instalada com `--ignore-scripts`.

## 3. Compatibilidade com o perfil do servidor

Medido nesta tarefa, com um encoder real (LAME 3.100) e o validador real do servidor:

| Item | Perfil existente (`Lavc`) | Saída do protótipo |
| --- | --- | --- |
| Identificação na tag | `Lavc…` | **`LAME3.100`** |
| Atraso do encoder (tag) | 576 | 576 (constante `ENCDELAY` do LAME) |
| Atraso do decodificador | 529 (calibrado no Chrome) | 529 (calibrado em Chrome 158 e usado só para expressar o alinhamento) |
| Padding da tag | 1032–1681 | 1224 (30 s a 44,1 kHz), ≥ 529 sempre exigido |
| Bitrate/canais | CBR 256, estéreo ou joint | CBR 256, joint stereo (`0x44`) |
| Frame Info | exigido | construído pelo protótipo |
| Resultado | — | **O servidor rejeita (`UNSUPPORTED_STREAM`, "Codificador MP3 fora do perfil suportado") todos os seis stems** |

Ou seja: não há aceitação silenciosa, e o perfil precisa de uma **extensão explícita**. Proposta (não implementada, depende de autorização):

```ts
// mp3-encoder-profile.ts — lista de perfis, cada um com evidência própria
{ id: 'lavc-libmp3lame-576-529',  encoderPrefixes: ['Lavc'],      tagDelayFrames: 576, decoderDelayFrames: 529 },
{ id: 'lame-3.100-wasm-576-529',  encoderPrefixes: ['LAME3.100'], tagDelayFrames: 576, decoderDelayFrames: 529 },
```

O validador já recebe `allowedEncoderPrefixes`, `expectedTagDelayFrames` e `expectedDecoderDelayFrames` como opções; basta o chamador testar cada perfil e
exigir o mesmo perfil nos seis stems (`assertConsistentMp3Stems`). Com `{ prefixes: ['LAME3.100'], tag 576, decoder 529 }` o validador real **aceitou os
seis stems** e a consistência dos seis passou. A prova do atraso do decodificador (529) vem do Chrome (calibração) e do ffmpeg (alinhamento exato), não de
metadado declarado pelo cliente. O prefixo `LAME3.100` é a identificação real do encoder; nada é falsificado como `Lavc`.

## 4. O que o protótipo faz

`web/src/audio/mp3-encoding/` (isolado; nada importa esta pasta):

- `mp3-info-frame.ts`: percorre o fluxo CBR 256 do encoder (cabeçalho a cabeçalho, sem CRC por frame, taxa e canais corretos), calcula contagem de frames e CRC-16 de música
  e **constrói o frame Info** (informação lateral zero, flags frames+bytes, tag LAME de 36 bytes com atraso 576, corte calculado `frames × 1152 − 576 − amostras`, tamanho do arquivo, CRCs).
  Tudo é derivado dos bytes e do PCM; nenhum valor vem de manifesto declarado.
- `mp3-stem-encoder.ts`: WAV PCM16 estéreo (44,1/48 kHz, ≤ 300 s) → fatias de 73 728 frames → encoder → `EncodedMp3Stem` com SHA-256 e `alignment` do contrato v2.
  Um stem por chamada; o WAV de origem nunca é modificado; encoder liberado em `finally`; cancelamento por `AbortSignal`/`isCancelled`; falta de memória vira `OUT_OF_MEMORY`;
  rejeita WAV inválido/mono/8 bits/taxa não suportada/acima do limite, fluxo não-CBR256/truncado/lixo/vazio e corte menor que o atraso do decodificador.
- `mp3-lame-backend.ts`: carrega `wasm-media-encoders` sob demanda (nada entra em bundles que não usam a compressão).
- `mp3-encoding.worker.ts`, `mp3-encoding-protocol.ts`, `mp3-encoding-worker-client.ts`: um stem por job no Worker; cancelar ou liberar **termina o Worker** (libera a memória do WASM na hora);
  respostas de jobs antigos são ignoradas; o cliente confere tamanho e SHA-256 antes de entregar.
- Nada é comprimido automaticamente: não há chamada em nenhuma tela. A decisão de preparar a publicação continua sendo do usuário (fase S2).

## 5. Resultados medidos

Ambiente: Chrome 158 com interface (Playwright), Worker de verdade, host Windows de 7,9 GB com outros aplicativos abertos (tempos e memória ruidosos; uma execução por ponto).
Sinais **sintéticos** (tons + ruído + impulsos em 3 posições), seis stems em sequência, um Worker por stem, memória = soma de bytes privados dos processos do Chrome.

| Entrada | WAV (6 stems) | MP3 (6 stems) | Redução | Tempo por stem | Frames MPEG | Tarefas longas / maior intervalo entre frames (durante a compressão) |
| --- | --- | --- | --- | --- | --- | --- |
| 30 s | 31,75 MB | 5,77 MB | 81,8% (18,18%) | 0,87–1,00 s | 1 150 | 0 / 17 ms |
| 180 s | 190,5 MB | 34,6 MB | 81,9% (18,15%) | 4,8–5,3 s | 6 892 | 0 / 17 ms |
| 300 s | 317,5 MB | 57,6 MB | 81,9% (18,14%) | 7,95–8,83 s (≈ 50 s os seis; RTF ≈ 0,028) | 11 486 | 0 / 17 ms |

- **Memória (300 s):** linha de base da página 476–478 MB; só compressão (sem verificação por decodificação) pico 849 MB (+371 MB, incluindo os WAVs e Float32 que o próprio harness retém);
  com verificação completa (decodificação de 300 s por stem no Chrome) pico 1 423 MB. **Estimativa por código, não observada:** o Worker retém o WAV de entrada (53 MB), um par de Float32 de 73 728 frames
  (0,6 MB), os blocos do MP3 (≈ 9,6 MB) e a cópia final (≈ 9,6 MB). O pico do Worker não foi medido isoladamente.
- **Cancelamento:** abortar aos 3 s de um stem de 300 s rejeitou com `CANCELLED` em 3 014 ms e terminou o Worker. Memória residual 10 s depois: 615 MB contra linha de base de 471 MB (o harness ainda retém os arrays do stem; sem vazamento atribuível ao encoder observado).
- **Alinhamento (Chrome 158 via `Mp3StemDecoder`, forma `canonical`, calibração 529):** correlação cruzada em início, meio e fim dos seis stems com **atraso 0** em 30, 180 e 300 s; impulsos nos frames 2 000, N/2 e N−2 000 com deslocamento **0**;
  comprimento decodificado = frames originais; os seis stems com o mesmo comprimento e o mesmo número de frames MPEG.
- **Decodificador independente (ffmpeg 9.0):** `duration=30.000000`, `bit_rate=256000`, 1 323 000 frames, impulsos com deslocamento 0 no início, no meio e no fim.
- **Validador do servidor (`mp3-stream-validator.ts`):** perfil existente rejeita (`UNSUPPORTED_STREAM`); perfil proposto aceita os seis (`peakBufferedBytes` 836; consistência dos seis PASS). Mutações rejeitadas:
  bit invertido no meio/fim (`CRC`), truncado (`TOO_LARGE`), byte extra (`TRAILING_BYTES`), identificação do encoder alterada (`CRC`), side info não zero (`BAD_INFO_FRAME`), cabeçalho 128 kbps (`BAD_HEADER`),
  atraso/corte deslocados em 1 (`ALIGNMENT`), política de decodificador 528 (`ALIGNMENT`).
- **SNR contra o WAV** (sinais sintéticos ruidosos): ≈ 27 dB — não representativo de música. Em um trecho real de 30 s já separado (stems da variante A do Q3): voz 38,8 dB, baixo 58,1 dB, bateria 33,8 dB, mix 32,6 dB; a energia acima de 19 kHz cai 11–22 dB.
- **Determinismo:** o mesmo WAV gera MP3 byte-idêntico (teste unitário).
- **Bundle:** o Worker compila a 19 KB e o módulo LAME/WASM a ≈ 180 KB em chunk próprio (carregado só quando a compressão é usada); 0 byte nos bundles atuais.

## 6. Segurança

Revisão própria (o gate Codex Sol 6.2 continua indisponível; sem conformidade integral declarada):

- Entrada validada antes do encoder (WAV estrito, PCM16 estéreo, taxa, duração, 56 MiB); saída validada depois (CBR 256, MPEG-1 Layer III, sem CRC por frame, sem ID3, estéreo/joint, sem bytes sobrando).
- A tag é derivada dos bytes; nenhum metadado declarado pelo cliente é aceito; o cliente do Worker confere tamanho e SHA-256; o servidor continua sendo a autoridade (reverifica tudo).
- Sem rede, sem escrita, sem acesso a credenciais; um stem por vez; Worker terminado ao cancelar/liberar; mensagens de job antigo ignoradas.
- A dependência foi instalada com `--ignore-scripts`; o `.wasm` embutido executa só dentro do Worker. Ver LICENSE_STATUS.
- `serverByteValidation` e as rotas não foram alterados: publicação MP3 continua impossível.

## 7. Plano das próximas fases (não implementadas)

| Fase | Escopo | Critério de saída |
| --- | --- | --- |
| **S2** — rascunho Web | Botão explícito "Comprimir para publicar" após a pré-escuta; WAV mantido até o upload; decisão do usuário antes de comprimir; progresso/cancelamento; `SeparationDraft` com variante MP3; carregar o `.wasm` como arquivo próprio e incluir aviso LGPL; calibrar `decoderDelayFrames` com `Mp3StemDecoder.calibrate` | Testes de componente, memória 300 s, nenhuma alteração no fluxo WAV |
| **S3** — servidor e R2 DEV | Estender `mp3-encoder-profile.ts` para uma lista de perfis (seção 3) com testes de fixture LAME; reserva v2, validação, publicação e leitura MP3 no R2 DEV; resolver a paginação (Média-1) e congelar perfis; gate ainda **fechado em produção** | Suíte de integração + execução R2 DEV autorizada separadamente |
| **S4** — Android | Decodificação, cache e reprodução sincronizada de seis MP3 (decodificador nativo, tratamento de atraso da tag), medição em aparelhos | Sincronismo medido em hardware real |
| **S5** — homologação e liberação | Safari/Firefox/Chrome Android, 300 s, avaliação auditiva do operador, revisão jurídica da LGPL, revisão Codex, decisão de abrir o gate | Autorização explícita para habilitar |

## 8. Avaliação auditiva (resultado registrado no S2: sem diferença audível pelo operador)

**Resultado (registrado no M22-S2):** o operador ouviu voz, baixo, bateria e mix completo e não percebeu diferença audível entre o WAV original e o MP3 CBR 256 decodificado. É aprovação perceptiva do operador nas amostras avaliadas, sem alegar transparência universal nem aprovação estatística. Ver `m22s2-web-mp3-compression-draft.md`.

Procedimento original:

Pasta `Documents\m22-s1-mp3-ab` (fora do Git): voz, baixo, bateria e mix, três arquivos por grupo (dois WAV idênticos como controle e um MP3 CBR 256 decodificado), ordem aleatória, gabarito separado,
usando stems da variante A do Q3 (sem repetir o Demucs). **Nenhuma conclusão de qualidade antes da escuta.**

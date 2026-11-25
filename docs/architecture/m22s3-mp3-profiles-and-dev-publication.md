# M22-S3 — Perfis de encoder MP3, rascunho Web e homologação DEV

Estado: **experimental**. `MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`, `R2_LIVE_RESULT = BLOCKED`.
`serverByteValidation` de `mp3_cbr256` continua `false` em `audio-codec.ts` (arquivo não alterado); o codec só é aberto
em memória dentro de testes de integração e do script live já protegido.

## 1. Perfis de encoder (backend)

| id | identificação (tag Info) | delay da tag | delay do decoder |
|---|---|---|---|
| `lavc-libmp3lame-576-529` (original, intacto) | `Lavc…` | 576 | 529 |
| `lame-3.100-wasm-576-529` (novo, explícito) | `LAME3.100` | 576 | 529 |

- Implementação: `mp3-encoder-profile.ts` (`MP3_ENCODER_PROFILES`, `selectMp3EncoderProfile`) e `mp3-stream-validator.ts` (`options.profiles`).
- **Seleção determinística em passagem única:** o perfil é escolhido pela identificação lida do frame Info (exatamente um ou nenhum; prefixos disjuntos, testado). Identificação desconhecida é recusada logo que o frame Info é lido, sem transmitir o restante do objeto. Nenhum objeto é relido por perfil.
- Depois da seleção valem todas as verificações já existentes: MPEG-1 Layer III, CBR 256, estéreo/joint, taxa, frame Info, contagem de frames MPEG e de bytes, CRC-16 da tag e da música, SHA-256, `delay + frames + padding`, delay do encoder e do decoder **do perfil**. Nada do que o cliente declara é aceito sem conferência contra os bytes.
- A identificação `LAME3.100` e os CRCs **não provam a procedência** do encoder (qualquer um pode gravá-los): servem para escolher os atrasos fixados, que os bytes ainda precisam satisfazer junto com tamanho, frames, SHA-256 e CRCs.
- Consistência: os seis stems precisam ter o mesmo perfil/encoder, atrasos e linha do tempo (`assertConsistentMp3Stems`); um conjunto misto Lavc + LAME é recusado (409), mesmo com cada stem válido.
- `mp3FactsMatch` deriva o perfil da identificação lida pelo servidor, nunca de um id enviado pelo cliente. O perfil Lavc não foi flexibilizado.
- Fixtures reais do encoder Web: `shared/fixtures/ministry-audio-mp3-v2-lame/web-encoder-cases.json` (gerado por `backend/scripts/m22s3/generate-web-encoder-fixtures.ts`, que só grava se o validador de produção aceitar todos os casos).
- Compatibilidade: manifestos WAV v1 e MP3 v2 anteriores e os testes do perfil Lavc seguem passando; os testes que usavam `LAME3.100` como "encoder desconhecido" passaram a usar `LAME3.99r`.

## 2. Rascunho Web

- `Mp3PublicationHandoff` (`web/src/audio/mp3-encoding/mp3-publication-handoff.ts`): transferência explícita de propriedade do rascunho WAV **e** do comprimido como um único objeto (nunca combinação parcial; liberados juntos). `buildMp3Reservation` gera o manifesto v2 imutável a partir do rascunho verificado, conferindo tipo e tamanho de cada arquivo. `publishMp3Handoff` reserva (ou retoma), envia as seis faixas **só por transferência direta**, exige as seis antes de finalizar e nunca descarta os rascunhos.
- A tela de separação só oferece "Preparar publicação experimental (MP3)" se o chamador passar `onPrepareExperimentalMp3`; nenhuma tela de produção passa. O fluxo normal continua publicando somente WAV.
- O servidor continua recusando a reserva MP3 com `AUDIO_CODEC_NOT_ENABLED` enquanto o gate estiver fechado.

## 3. Paginação

A limitação "página curta/sem cursor com MP3 oculto" já havia sido tratada no C.5D-B (varredura com orçamento, cursor segue o que foi examinado). No S3 foi adicionado o teste de **rollback do codec no meio de uma caminhada** (cursor obtido com o codec aberto continua válido depois de fechado, sem duplicatas nem lacunas; reabrir restaura tudo). Os testes existentes cobrem páginas intermediárias só com MP3 ocultos, orçamento de varredura, cursores vinculados a ministério/consulta e isolamento.

## 4. Homologação isolada

| Cenário | Resultado |
|---|---|
| Offline (Firestore Emulator + simulador local de objetos): reserva v2, upload, validação streaming, selagem, publicação, reprodução por outro membro (bytes e SHA-256 idênticos, URLs renovadas), upload interrompido e retomada, finalização concorrente, MP3 malformado com SHA-256 válido, perfis misturados, isolamento entre ministérios, codec desabilitado | PASS (`ministry-audio-mp3-v2.integration.test.ts`, bloco "Web encoder profile") |
| Offline com bucket R2 simulado (adaptador R2 real, guard real): 18 cenários | PASS com a fixture ffmpeg e com a fixture do encoder Web (`M22S3_FIXTURE=web-lame`) |
| ~300 s (seis stems reais de 279,9 s, 8,96 MB cada) pelo caminho completo | PASS: selagem de 242–340 ms por stem; pico de heap +5 MB sobre a linha de base (validação O(1) no Info frame); pico de RSS 255 MB incluindo os ~107 MB de objetos mantidos pelo simulador e o corpo do cliente. Teste `it.skipIf(!M22S3_LONG_DIR)`: **não executa sem os arquivos** (grandes, não versionados; gerar com `backend/scripts/m22s3/encode-long-fixtures.ts`) |
| R2 DEV real | **BLOCKED**: sem autorização/credenciais DEV nesta sessão; nada foi contatado |

Limite conhecido: o script live (`m22c5d-r2-mp3-e2e.ts`) mantém `maxObjectBytes = 65536`; um cenário live de ~300 s exigiria uma decisão e autorização separadas para alterar os orçamentos.

Comandos para a homologação real (somente com autorização e credenciais DEV; o guard recusa qualquer outro ambiente; `su` primeiro, `rc` só em autorização separada):

```
cd backend
npx --no-install tsx scripts/m22c5d-r2-mp3-e2e.ts --plan                      # não conecta
M22S3_FIXTURE=web-lame npx --no-install tsx scripts/m22c5d-r2-mp3-e2e.ts --mode su
M22C5D_JOURNAL=<journal> npx --no-install tsx scripts/m22c5d-r2-mp3-cleanup.ts  # se indicado
```

## 5. Distribuição e licenciamento (LGPL pendente)

- Problema: no S2, o Worker, `mp3.wasm` e a cópia base64 embutida pelo pacote eram emitidos mesmo com a flag desligada.
- Solução: o cliente do Worker só é alcançável por `import()` dinâmico atrás de `import.meta.env.VITE_EXPERIMENTAL_MP3_COMPRESSION`, fixada em `vite.config.ts` como literal `'true' | 'false'`. Um build sem a flag **não contém** Worker, WASM nem a cópia embutida. `web/scripts/check-mp3-distribution.mjs <dist> --expect-absent` falha se qualquer um aparecer (e `--expect-present` verifica o build com a flag). Resultado: build `--mode test` sem flag PASS (ausente); com a flag PASS (Worker + `mp3-<hash>.wasm` separado + cópia embutida no chunk sob demanda).
- Conformidade LGPL não foi declarada: ver `THIRD_PARTY_NOTICES/lame-wasm.md` (revisão jurídica pendente).

## 6. Segurança

- Rotas normais continuam fechando o codec (teste de reserva recusada; `audio-codec.ts` não alterado; nenhum bypass por variável de ambiente no código de produção — `M22S3_FIXTURE`/`M22S3_LONG_DIR` só escolhem bytes de fixtures em scripts/testes).
- RBAC/IDOR: isolamento ministerial, admin obrigatório e 404/403 verificados nos testes de integração.

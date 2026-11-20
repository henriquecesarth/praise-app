# M22-C.5D-B — Persistência e finalização MP3 v2 (somente offline)

Status: **offline, desligado**. `serverByteValidation: false` para `mp3_cbr256` e `AUDIO_CODEC_NOT_ENABLED` nas rotas reais
continuam intactos. Não existe chave, rota, opção de construtor ou variável de ambiente que abra o codec no build publicável:
os testes de integração o abrem **apenas dentro do próprio arquivo de teste** (mutam o perfil em memória e o restauram).

## Auditoria (dependências)
| Ponto | Situação |
|---|---|
| Manifesto v1/v2 | `AudioManifest.stems` agora é `StemV2[]` (PCM ∪ MP3). `buildManifest` grava v1 para PCM (idêntico ao anterior) e v2 para MP3. |
| `requestHash` | `requestHashOf` = `hash({title, artist, version, manifest})`, o mesmo envelope e a mesma ordem de chaves do v1. |
| Reserva/tentativas | Inalteradas. Reserva MP3 exige armazenamento direto (409 caso contrário). |
| Verificação persistida / recibo | `ObjectReceipt` e `VerifiedStaging` ganharam `mp3?: Mp3Facts` (resultado da verificação dos bytes **daquele objeto**). |
| Finalização | `assertEnabledCodecs` + `assertPublishableMp3Set` (fora e dentro da transação). |
| Leitura | `published()` e `list` ocultam manifestos de codec não habilitado. |
| Upload pelo servidor / download pelo servidor | Recusam stems não-PCM (409/404). |
| Limpeza | Já usa a extensão do manifesto (`.mp3`); coberta por teste de integração. |
| Autorização/isolamento | Inalterados (`authorize` em toda transação); coberto por teste. |

## requestHash
- v1: bit a bit o algoritmo anterior (teste compara com a fórmula antiga reconstruída).
- v2: mesma fórmula; o manifesto carrega `schemaVersion: 2` e stems canônicos com **ordem de chaves explícita** (não depende da ordem enviada pelo cliente nem de edições futuras do schema). Mudança em codec, tamanho, SHA-256, taxa, frames ou alinhamento — e a diferença v1/v2 — gera hash diferente → `409` no reuso da chave de idempotência. Reenvio idêntico (inclusive com chaves/stems em outra ordem) devolve a mesma reserva.
- Nenhuma migração: manifestos WAV existentes não são lidos nem reescritos.

## Consistência das seis faixas (a decisão depende dos bytes)
- O adaptador (R2/simulador) devolve em `seal` o recibo `{ etag, mp3 }`, onde `mp3` é o `Mp3ValidationResult` produzido pela leitura completa dos bytes **do objeto cujo ETag o recibo nomeia**.
- O serviço só persiste o recibo se `mp3FactsMatch(stem, receipt.mp3)` (id, SHA-256, tamanho, taxa, frames, `mpegAudioFrames`, atrasos do perfil, soma tag = declarado, encoder do perfil); senão 409.
- `finalize` chama `assertPublishableMp3Set`: seis fatos presentes, cada um igual ao stem do manifesto, e `assertConsistentMp3Stems` (taxa, frames, mpeg frames, atraso/corte da tag, `decoderDelayFrames`, **encoder**). Metadado declarado sem fato → 409; nada é publicado parcialmente (a transação repete a checagem).

Retomadas (sem enfraquecer a verificação):
- **Falha de `CopyObject`:** `onVerified` persiste `{etag, lastModified, mp3}` por tentativa; o retry reaproveita só se o HEAD vivo do staging coincide (ETag, lastModified, manifesto) **e** os fatos persistidos descrevem exatamente o stem. Fatos ausentes ou de outro stem/hash → o hint é ignorado e a verificação é integral.
- **Objeto final já promovido (ETag do hint):** um HEAD; os fatos vêm do hint validado.
- **Corrida 412 / final existente:** o objeto final é lido e verificado por inteiro; os fatos vêm dessa leitura.
- **`/complete` repetido:** devolve o recibo persistido (com fatos), sem reler bytes (teste: `seal` chamado uma vez).
- **Outra tentativa:** `issueUploadUrl` troca `directAttempts[stem]` por `{ number }` (sem recibo/verificação); teste prova que os fatos de uma tentativa não passam para a seguinte.

## Testes
- Unitários: `audio-manifest.test.ts` (12), `codec-aware-storage.test.ts` (28), regressão `ministry_audio`.
- Integração (Firestore Emulator de demonstração + simulador local): `ministry-audio-mp3-v2.integration.test.ts` (12): gate fechado nas rotas reais, persistência canônica v2, idempotência, 409 por alteração, fluxo completo com `audio/mpeg`, `/complete` idempotente e finalização concorrente, recibo sem fatos, conjunto inconsistente, não reaproveitamento entre tentativas, MP3 malformado com SHA válido, isolamento/autorização, limpeza de staging `.mp3`, invisibilidade quando o codec fecha.

## Limitações
- `list` filtra manifestos ocultos depois de ler a página: se o codec for habilitado, usado e depois fechado de novo (rollback), uma página pode vir curta ou sem `nextCursor`. Hoje é teórico (MP3 não chega a `published`). `edit`/`archive` não usam `published()` e continuam operando em registros ocultos (sem expor dados).
- Sem R2 real; sem mobile; o leitor remoto MP3 continua desligado.
- Os fatos persistidos são confiáveis porque o documento só é escrito pelo servidor; quem tiver escrita direta no Firestore poderia forjá-los (a mesma premissa vale para os recibos/ETags v1). A releitura dos bytes em `finalize` não é feita (`assertObject` confere ETag/metadados), igual ao v1.
- A política de `decoderDelayFrames` (perfil Lavc/576/529) segue sendo evidência de um único encoder, medida só no Chrome 150.

# Rehearsal Package v1 — Contrato e Fixtures (`.louvaio-rehearsal.zip`)

Contrato local-first da T7 para pacotes de ensaio portáteis `.louvaio-rehearsal.zip` (`format = "louvaio-rehearsal"`, `formatVersion = 1`). Respeita [ADR Local First](../../../docs/decisions/2026-11-16-v3-musical-local-first-package.md) e [ADR Version Player](../../../docs/decisions/2026-11-16-v3-musical-version-player.md).

## 1. Escopo da T7 e fronteiras

- Define exclusivamente o contrato versionado, fixtures compartilhadas de manifesto/expectativas e validadores locais em TypeScript (`web/src/audio/rehearsal-package-validator.ts`) e Dart (`mobile/lib/core/audio/rehearsal_package_validator.dart`).
- **Não** implementa gerenciador definitivo, gravação no banco local, escrita persistente de mídia, player integrado, separação de stems, upload ou acesso à rede.
- **Nenhuma validação da T7 concede autorização para associar um pacote a `SongVersion`** (`songVersionBindingAuthorized` é sempre `false` na saída).
- **Nenhum binário `.zip` ou áudio pessoal é versionado**: os testes constroem pacotes ZIP sintéticos determinísticos em memória/temporário a partir das receitas de [rehearsal-package-v1-corpus.json](rehearsal-package-v1-corpus.json).

## 2. Pré-limites v1 (`LIMITS_V1`)

Estes limites são pré-limites do formato para rejeição de pacotes abusivos ou incompatíveis; **não garantem capacidade real de armazenamento ou decodificação em tempo real no dispositivo**:

| Constante | Valor | Significado |
| --- | --- | --- |
| `maxCompressedBytes` | `2147483648` (2 GiB) | Tamanho máximo do arquivo `.louvaio-rehearsal.zip` |
| `maxExtractedBytes` | `4294967296` (4 GiB) | Soma máxima dos bytes descomprimidos de todas as entradas |
| `maxEntries` | `32` | Número máximo de entradas no Central Directory do ZIP |
| `maxManifestBytes` | `262144` (256 KiB) | Tamanho máximo descomprimido de `manifest.json` |
| `maxPathDepth` | `3` | Número máximo de segmentos de caminho separados por `/` |
| `maxCompressionRatio` | `100` | Razão máxima `uncompressedBytes / compressedBytes` (100:1) |
| `maxDurationSeconds` | `1800` (30 min) | Duração máxima (`79380000` frames em `44100` Hz) |
| `minFreeSpaceReserveBytes` | `268435456` (256 MiB) | Reserva mínima de espaço livre para staging/importação |
| `minFreeSpaceReserveRatio` | `0.10` (10%) | Reserva percentual mínima sobre o pico estimado de staging |
| `defaultMaxChunkBytes` | `65536` (64 KiB) | Chunk máximo por leitura incremental |
| `defaultMaxMemoryBudgetBytes` | `67108864` (64 MiB) | Teto padrão de memória de trabalho durante validação |

Todos os limites de tamanho e razão são aplicados **progressivamente aos bytes efetivamente lidos/descomprimidos**, e não apenas aos metadados do cabeçalho ZIP.

## 3. Estrutura do ZIP e regras de segurança

- O arquivo ZIP deve conter exatamente `manifest.json` na raiz (UTF-8 sem BOM, `STORE` método `0` ou `DEFLATE` método `8`), os 4 stems obrigatórios (`vocals`, `drums`, `bass`, `other`) e, quando `original.included === true`, a entrada de áudio original.
- Entradas extras não declaradas no manifesto são rejeitadas (`UNDECLARED_ZIP_ENTRY`).
- Entradas de áudio devem usar **exclusivamente método `STORE` (`0`)**, conforme ADR (já comprimidas ou PCM para leitura previsível). Qualquer entrada de áudio com `DEFLATE` ou método desconhecido é rejeitada (`UNSUPPORTED_COMPRESSION_METHOD`).
- Rejeições obrigatórias antes/durante leitura:
  - Criptografia ZIP (bit 0/6 de flags ou método 99): `ENCRYPTED_ENTRY_FORBIDDEN`.
  - Diretórios, symlinks (`S_IFLNK`) e arquivos especiais POSIX (`FIFO`, `CHR`, `BLK`, `SOCK`): `SPECIAL_FILE_OR_SYMLINK_FORBIDDEN`.
  - Path traversal / Zip Slip (`..`, `.`, `/`, `\`, drive letter `C:`, barras duplas `//`, caracteres de controle, espaços/pontos finais por segmento): `PATH_TRAVERSAL_OR_UNSAFE_PATH`.
  - Profundidade maior que 3 segmentos: `PATH_DEPTH_EXCEEDED`.
  - Colisões após normalização canônica Unicode (NFD/NFC) e case-insensitive: `DUPLICATE_OR_COLLIDING_ENTRY`.
  - Archives aninhados por extensão (`.zip`, `.tar`, `.gz`, `.7z`, `.rar`) ou magic bytes (`PK\x03\x04`, `PK\x05\x06`, `\x1f\x8b`, `7z\xbc\xaf\x27\x1c`): `NESTED_ARCHIVE_FORBIDDEN`.
  - Entradas sobrepostas no arquivo físico ZIP ou divergência entre Local File Header e Central Directory: `OVERLAPPING_ZIP_ENTRIES` / `HEADER_MISMATCH`.
  - CRC-32 divergente dos bytes reais: `CRC_MISMATCH`.
  - SHA-256 divergente do declarado no manifesto: `SHA256_MISMATCH`.
  - Inspeção binária obrigatória dos cabeçalhos de áudio (`RIFF/WAVE`, `fLaC STREAMINFO`, `OggS OpusHead/OpusTags`, `ftyp/moov/mp4a`, `ID3/MPEG` apenas para `original`), sem confiar em extensão ou MIME.

## 4. Contrato do `manifest.json`

- `format`: `"louvaio-rehearsal"`
- `formatVersion`: `1` (inteiros `>= 2` -> `unsupported` / `UNSUPPORTED_FORMAT_VERSION`)
- `requiredFeatures`: lista dentro de `["stems-4", "timeline-v1", "alignment-v1", "practice-v1", "original-optional"]` (qualquer feature desconhecida -> `unsupported` / `UNSUPPORTED_REQUIRED_FEATURE`)
- `packageId`: UUID aleatório local (normalizado em minúsculas)
- `revision`: inteiro `>= 1`
- `createdAt`: timestamp ISO-8601 com timezone (`Z` ou `+HH:MM`/`-HH:MM`)
- `displayName`: rótulo texto puro (`1..200` chars, sem caracteres de controle)
- **Proibição de autoridade de acesso**: a presença de `ministryId`, `groupId`, `songId`, `versionId`, `userId`, `accountId`, `uid`, `email`, `authToken`, `accessToken`, `bearer`, `role` ou `permissions` em qualquer nível do manifesto invalida o pacote (`FORBIDDEN_AUTHORITY_FIELD`).
- `source`: `{ sha256, sanitizedFileName, durationFrames, usageRightEvidence }`
- `provenance`: `{ toolName, toolVersion, modelName, checkpointId, checkpointSha256, parameters, seed, licenseReferences }`
- `timeline`: `{ sampleRate: 44100, totalFrames, channels: 2, timeOriginFrame: 0 }`
- `original`: opcional (`{ included: false }` ou `{ included: true, path, container, codec, bitsPerSample, byteLength, sha256, sampleRate, channels, decodedFrames }`)
- `stems`: exatamente 4 itens para `["vocals", "drums", "bass", "other"]` (`{ id, path, container, codec, bitsPerSample, byteLength, sha256, sampleRate: 44100, channels: 2, decodedFrames }`). `mp3` é bloqueado em `stems` (`UNSUPPORTED_CODEC`).
- `alignment`: `{ timeOriginFrame: 0, method: "explicit-trim", initialTrimFrames, trailingTrimFrames, perStem? }`. Todo stem deve satisfazer `decodedFrames - trimInicial - trimFinal === timeline.totalFrames`.
- `practice`: opcional (`{ bpm?, timeSignature?, firstBeatOffsetFrames?, loopAFrame?, loopBFrame? }`, com loop `>= 100 ms`).
- `rights`: `{ declaration, scope, exportAllowed, attributions, isLegalProof: false, isDrm: false }`. Registro puramente informativo; jamais inventar licenças nem tratar como prova legal ou DRM.

## 5. Estados de validação, publicação e protocolo para T8/T9

| Estado (`status`) | `readyForPublication` | `publicationState` | Significado |
| --- | --- | --- | --- |
| `valid` | `true` | `staged_validated` | Pacote validado localmente; pronto apenas para etapa futura de staging/commit da T8/T9 |
| `incomplete` | `false` | `rejected` | Stem ou original ausente, SHA-256 divergente ou timeline/alinhamento inconsistente |
| `unsupported` | `false` | `rejected` | Formato/versão futura, feature obrigatória desconhecida, codec não suportado ou compressão não suportada |
| `corrupted` | `false` | `rejected` | ZIP inválido/truncado, ataque de caminho/ZIP bomb, CRC inválido, manifesto malformado (`INVALID_MANIFEST_JSON`) ou áudio corrompido |
| `insufficientSpace` | `false` | `rejected` | Espaço livre insuficiente para staging+reserva ou orçamento de RAM excedido |
| `conflict` | `false` | `rejected` | Mesmo `packageId` já presente em `existingPackages` com `compositeSha256` ou `manifestSha256` distinto |
| `cancelled` | `false` | `rejected` | Validação cancelada pelo chamador durante pré-checagem ou streaming |

### Protocolo atômico e recuperação pós-crash (para implementação em T8 e T9)

1. **Preflight:** executar este validador T7 sem persistir mídia e sem rede; calcular `requiredFreeStorageBytes = (includeSourceCopy ? compressedBytes : 0) + totalExtractedBytes + max(256 MiB, ceil(10% do pico))`. Abortar se `insufficientSpace`, `conflict` ou inválido.
2. **Staging isolado:** gravar em diretório temporário isolado por transação (`staging/<txId>/`) com arquivo de marcação `staging.journal.json` (`status: "in_progress"`, `packageId`, `compositeSha256`, `startedAt`), nunca no catálogo visível.
3. **Verificação pós-escrita:** validar cada arquivo extraído no staging (tamanho, SHA-256 e cabeçalho binário) antes de promover.
4. **Commit atômico:** mover/renomear o diretório validado para `packages/<packageId>/` e atualizar o índice local de metadados somente após `fsync`/commit bem-sucedido; apagar `staging/<txId>/`. Pacote válido só recebe estado visível `"ready"` após esse commit na T8/T9. Em conflito (`conflict`), preservar pacote existente e exigir ação explícita (nova cópia com novo UUID ou substituição confirmada).
5. **Recuperação pós-crash:** ao iniciar o app/gerenciador, qualquer entrada em `staging/*` sem commit concluído (ou com `staging.journal.json` pendente) é classificada como staging órfão para limpeza/retomada explícita, **nunca** listada como pacote pronto.

## 6. Nota sobre Flutter/Dart e zero dependências

A investigação de `mobile/pubspec.yaml` e `mobile/pubspec.lock` confirmou que nenhuma dependência ZIP é declarada diretamente em `pubspec.yaml` (`archive` existe apenas como dependência transitiva de `image`, e sua API padrão de alto nível decodifica entradas sem garantir orçamento incremental sob ZIP bombs). Em vez de adicionar dependências externas, o validador Dart em `mobile/lib/core/audio/rehearsal_package_validator.dart` utiliza recursos nativos do Dart SDK (`dart:io` `RandomAccessFile` + `RawZLibFilter.inflateFilter(raw: true)` e SHA-256/CRC-32 incrementais em memória constante). A execução de testes em aparelhos físicos Android/iOS permanece `NOT_EXECUTED` na T7.

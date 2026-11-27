# Music theory v1 — contrato de fixtures

Fonte única: [music-theory-v1.json](music-theory-v1.json). Implementação da T1, base `a788c15603d7925601ec4e9e69aa4329a7e0bbf9`. Não contém motor musical nem altera cifras persistidas. Os testes de integridade não certificam conformidade de motores futuros.

## Envelope e resultados

`format = louvaio.music-theory`, `version = 1`. Mudança incompatível exige nova versão; correções de expectativas precisam justificativa e revisão musical. IDs são estáveis e únicos entre seções. `contract` documenta as regras normativas; `cases` contém 99 vetores futuros; `legacyNotation` preserva 34 casos R17; `legacyProbes` contém 10 observações dos parsers atuais. Total: 143 vetores, sem cópias do corpus por plataforma.

Cada caso normativo tem `id`, `operation`, `input` e `expected`. Operações: `parseNote`, `parseInterval`, `parseChord`, `transposeNote`, `transposeChord`. `input.text` é sempre o texto exato. Para transposição, fornecer **ou** `interval { diatonicSteps, semitones }` com política `diatonic`, **ou** `semitones` inteiro com política `chromaticSharps`. Não inferir tom/modo da música. Contexto `chordSymbol` é padrão de parseChord; um token de letra em contexto `lyric` não ganha autoridade de acorde.

Resultado comum:

```text
status: parsed | unsupported
originalText: string exata de input.text
normalized: NoteResult | IntervalResult | ChordResult | null
notes: SpelledNote[]
diatonicSpellings: string[]
pitchClasses: integer[]
```

`unsupported` adiciona `preservedText`, `category` e `reason` (códigos estáveis), com normalized=null e listas vazias. Categorias: `invalidSyntax`, `ambiguousContext`, `unsupportedFeature`, `accidentalRange`. Assim, sintaxe inválida, falta de contexto e limitação de escopo não se confundem com um acorde sem notas. Não há resultado parcial silencioso.

`SpelledNote = { letter, accidental, spelling, pitchClass }`: letra A..G, acidente inteiro -2..2, spelling ASCII e classe 0..11 (C=0). B# e C têm a mesma classe, mas grafias distintas. Entradas aceitam #/b, ♯/♭/♮ e 𝄪/𝄫; normalizado usa #/b. `NoteResult = { kind: note, note, octave, midi }`; sem oitava explícita, ambos octave/midi são null. B#3 é MIDI 60, Cb4 é MIDI 59: não calcular MIDI somente pela classe módulo 12.

`IntervalResult = { kind: interval, name, diatonicSteps, semitones }`. Notação P/M/m/A/d, número positivo, prefixo `-` para descendente. diatonicSteps conta movimentos de letra: uníssono 0, segunda 1, oitava 7. A2 e m3 têm 3 semitons, mas 1 e 2 movimentos de letra. Intervalos compostos não perdem oitavas.

`ChordResult` contém `kind`, `canonicalSymbol`, `root`, `quality`, `seventh`, `intervals`, `extensions`, `omissions`, `alterations`, `bass`, `bassRole`, `inversion`. Qualidades: major/minor/diminished/augmented/suspended2/suspended4. Sétima é null/major/minor/diminished. Intervalos (incluindo raiz 0/0) são a autoridade das notas; não aplicar alterações duas vezes. Listas de notas/spellings/classes são paralelas, em ordem teórica da raiz; não são voicing executável. V1 não gera omissões implícitas. 9/11/13 incluem extensões ímpares anteriores e sétima; add9 não implica sétima; 7#11 explícito não implica nona. `/9` numérico é extensão, não baixo.

Baixo slash fica separado dos constituintes. Se sua grafia, ou na falta dela sua altura (grafia enarmônica, como D#/G), coincide com uma nota do acorde, bassRole=chordTone e inversion é seu índice na lista teórica (G/B=1); caso contrário nonChordTone/null (C/F#). Sem baixo explícito: unspecified/null. Isso descreve relação simbólica do baixo, sem deduzir voicing, oitavas ou posição instrumental.

## Nomenclatura brasileira e limites

| Original | Canônico em memória | Constituintes |
| --- | --- | --- |
| C7M | Cmaj7 | C E G B |
| F#m7(b5) | F#m7b5 | F# A C E |
| G/B | G/B, baixo B | G B D |
| C(add9)/E | Cadd9/E, baixo E | C E G D |

`originalText` continua igual; canonicalSymbol não é comando para reformatar cifras. Meio diminuto é quality=diminished, seventh=minor. Cdim7 usa Bbb, C#aug usa E# e G##. Acidentes triplos, microtons, power chord C5 e conjunto não especificado Calt ficam unsupported em v1, mesmo que alguma regex legada reconheça o texto. Am(G), N.C., marcações de compasso e instruções permanecem no parser de documento legado, não no núcleo harmônico.

## Compatibilidade e divergências registradas

A comparação anterior à extração confirmou 34/34 IDs, textos, expectativas +2 e flags Unicode iguais em TS/Dart. A extração mantém cada caractere, inclusive CRLF, emojis, espaços e anotações. O teste Dart conserva também sua verificação independente de instruções semânticas.

Comportamentos legados agora explícitos em `legacyProbes`: transposeNote(Db,0)=C#, mas transposeChord(Db,0)=Db; cifras C7M e C(add9)/E mantêm seus sufixos textuais. O futuro canônico pode ser Cmaj7/Cadd9 enquanto o texto original permanece intacto. Calt é reconhecido pela regex atual, porém a definição de um conjunto de notas sem escolha de alterações é unsupported no novo contrato. Acidentes duplos têm vetores normativos, mas não se declara suporte nos parsers atuais. Testes dessas observações não mudam expectativas antigas para forçar convergência com T2.

Referência experimental consultada apenas por leitura via GitHub: [TS P2](https://github.com/henriquecesarth/praise-app/blob/parallel/musical-integrity-p2-20261107/web/src/utils/smart_chord.ts), [testes paralelos](https://github.com/henriquecesarth/praise-app/blob/parallel/musical-integrity-p2-20261107/web/src/utils/smart_chord.parallel.test.ts). Casos úteis: g/b -2, Dbmaj7/Ab -1, A7M/9 -14 e F#sus4 +25; não são incorporados como suporte atual sem teste. Há diferenças de normalização de minúsculas entre versões; nenhum código dessa branch foi copiado, mesclado ou cherry-picked. Não foi usada como autoridade para cifras/formatos que seus testes não cobrem.

## Consumidores e validação

Web: wrapper `web/src/utils/fixtures/smart_chord_reference_cases.ts` importa apenas legacyNotation; teste `music_theory_contract.test.ts` lê o JSON e verifica cada vetor, gramática de intervalos, notas/qualidades, projeções, slash bass, transposição e sentinelas brasileiras. Dart: `mobile/test/support/music_theory_corpus.dart` lê o mesmo arquivo da raiz ou diretório mobile; ambos os testes consomem o loader. Não é asset de aplicativo e não altera pubspec.

Testes dirigidos reais e revisão independente são registrados no [roadmap](../../docs/exec-plans/active/2026-11-16-v3-musical-phase-1-proposal.md). Nenhum backend, API, player, schema ou dependência é necessário nesta tarefa. Antes de T2, exigir aprovação do gate T1/G2; a aprovação de arquitetura não autoriza automaticamente as tarefas seguintes.

## Guitar voicings v1 — catálogo curado de violão (T4)

Fonte única: [guitar-voicings-v1.json](guitar-voicings-v1.json). `format = louvaio.guitar-voicings`, `version = 1`, `instrument = guitar`, afinação padrão `E2 A2 D3 G3 B3 E4` (MIDI `40, 45, 50, 55, 59, 64` da 6ª para a 1ª corda).

- Proveniência: curadoria própria LouvAIO V3 (sem cópia de catálogos externos e sem geração combinatória automática), uso livre offline e online nos clientes Web e Flutter.
- Conjunto inicial curado (10 posições): `C`, `Am`, `G`, `D`, `Em`, `F`, `Am7`, `C7M` (`Cmaj7`), `G/B` (1ª inversão) e `F#m7(b5)` (`F#m7b5`).
- Invariantes verificados contra o motor T2: nota exata produzida por cada corda (`openMidi + fret`), cobertura dos tons do acorde sem notas indesejadas, nota mais grave efetivamente tocada coerente com fundamental/inversão/baixo externo, coerência física de pestanas e alcance máximo de 4 casas. Acordes sem posição verificada retornam estado explícito `"Diagrama indisponível"`.

## Harmony analysis v1 — inversões e graus harmônicos contextuais (T5)

Fonte única: [harmony-analysis-v1.json](harmony-analysis-v1.json). `format = louvaio.harmony-analysis`, `version = 1`. Amplia o contrato T2 sem modificar `music-theory-v1.json` ou cifras persistidas.

- `KeyContext` explícito: tônica (`SpelledNote` sem oitava), `mode` (`major` ou `minor`), `scaleReference` (`major` para maior; `naturalMinor` explícito para menor natural) e `spellingPolicy` (`diatonic` ou `chromaticSharps`). Não infere tonalidade automaticamente a partir dos acordes.
- `BassAnalysis`: reutiliza diretamente `bass`, `bassRole` e `inversion` da T2 (`chordTone` + `inversion >= 1` indica inversão real mesmo sem tonalidade; `nonChordTone` indica baixo externo ao acorde; `unspecified` indica posição fundamental).
- Três estados em `analyzeDegree`: `analysis` (interpretação diatônica sustentada pelo `KeyContext` explícito), `indeterminate` (`missingKeyContext`, `invalidKeyContext`, `externalSlashBass`, `enharmonicMismatch`, `nonDiatonicToNaturalMinor`, `nonDiatonicChord`) e `unsupported` (entrada fora da gramática/contexto v1).
- Corpus inicial com 61 vetores verificados entre tonalidades maiores (17), menores naturais (16), inversões/baixos externos (10), casos indeterminados (14) e não suportados (4). Empréstimos modais, dominantes secundárias e menor harmônica/melódica permanecem fora das regras de grau natural na v1 (`indeterminate`).

## Violão v2 e gerador (VH)

- [guitar-voicings-v2.json](guitar-voicings-v2.json): catálogo compacto (formas v1 curadas, formas comuns próprias `pop` e formas do chords-db, ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Gerado por `web/scripts/import-chords-db.mjs`, que também grava o relatório de importação e a cópia Dart; não editar à mão.
- [guitar-generator-v1.json](guitar-generator-v1.json): saída esperada do gerador determinístico e da busca, comparada em TypeScript e Dart.
- Omissão permitida: somente a 5ª justa, em acorde com sétima ou extensão, declarada em `omits: ["5"]`.
- A UI usa o catálogo v2 (`findGuitarVoicings`); a amostra foi aprovada em 2026-11-27.

## Harmony analysis v2 — leituras múltiplas (VH)

[harmony-analysis-v2.json](harmony-analysis-v2.json): `analyzeHarmony(chord, key, vizinhos)` devolve todas as leituras plausíveis (diatônica, menor harmônico, dominante secundária, empréstimo modal e baixo fora do acorde). `analyzeDegree` e o corpus v1 não mudam.

## Rehearsal Package v1 — `.louvaio-rehearsal.zip` (T7)

Especificação e corpus compartilhado em [rehearsal-package-v1/README.md](rehearsal-package-v1/README.md), manifestos de referência em [rehearsal-package-v1/manifests/](rehearsal-package-v1/manifests/valid-wav-minimal.manifest.json) e expectativas compartilhadas em [rehearsal-package-v1-corpus.json](rehearsal-package-v1/rehearsal-package-v1-corpus.json).

- Formato `louvaio-rehearsal`, `formatVersion = 1`, `manifest.json` UTF-8 + exatamente quatro stems (`vocals`, `drums`, `bass`, `other`) em modo `STORE` e `original` opcional.
- Pré-limites v1: `2 GiB` compactados, `4 GiB` extraídos, `32` entradas, `manifest.json <= 256 KiB`, profundidade `<= 3`, razão `<= 100:1`, duração `<= 30 min` (`79380000` frames em `44100` Hz), aplicados progressivamente aos bytes reais lidos.
- Nenhum binário `.zip` ou áudio pessoal é versionado no Git; validadores TS e Dart sintetizam ZIPs determinísticos em memória/temporário a partir das receitas compartilhadas e falham fechados por padrão (`readyForPublication = true` somente quando `status === "valid"`, e `songVersionBindingAuthorized = false` na T7).

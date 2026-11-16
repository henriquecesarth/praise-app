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

Baixo slash fica separado dos constituintes. Se sua grafia coincide com uma nota do acorde, bassRole=chordTone e inversion é seu índice na lista teórica (G/B=1); caso contrário nonChordTone/null (C/F#). Sem baixo explícito: unspecified/null. Isso descreve relação simbólica do baixo, sem deduzir voicing, oitavas ou posição instrumental.

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

# Decision: motor musical determinístico por contrato

## Status

Proposed. Planejamento V3 Fase 0, base `6d77ace`. Nenhuma dependência adotada.

## Context

[Auditoria](../audits/2026-11-16-v3-musical/audit.md): reconhecimento/transposição duplicados em TS/Dart e fixture Dart copiada manualmente. Layout de cifra não deve ser substituído por um analisador harmônico. Android e futuro iOS usam Dart; Web usa TS.

## Decision

Manter dois núcleos puros pequenos, sem I/O, governados por especificação e corpus JSON versionados. Mesmos dados de entrada/saída em ambas as linguagens; adaptadores preservam APIs atuais, texto, spans, anotações e acordes desconhecidos. Nenhuma regravação automática de cifra salva.

Modelo proposto (contrato de memória, sem schema Firestore):

- `SpelledNote { letter: A..G, accidental: -2..2, octave?: integer }`: classe de altura derivada módulo 12; oitava opcional. C=0; MIDI somente com oitava explícita (C4=60). Preservar grafia e texto original.
- `Interval { diatonicSteps: integer, semitones: integer }`: distingue segunda aumentada de terça menor; sinal e intervalos compostos explícitos.
- `Chord { root, quality, intervals, extensions, omissions, alterations, bass?, sourceText }`: sufixos conhecidos viram estrutura; desconhecidos retornam resultado `unsupported`, com literal intacto. `C/F#` é baixo slash, não presumir inversão.
- `KeyContext { tonic, mode, spellingPolicy }`: contexto explícito; sem modo/tom válido, graus são `indeterminate`. Transposição cromática legada continua disponível; transposição com intervalo diatônico preserva escrita. Não “detectar tom” automaticamente.
- `Voicing { orderedPitches, bass, inversion? }`: inversão calculável somente quando baixo pertence aos tons definidos do acorde; nota pedal ou voicing incompleto pode permanecer indeterminado.
- `DegreeAnalysis { degree, alteration, quality, secondaryTarget?, explanation }`: harmonia diatônica primeiro; dominantes secundárias e empréstimos só com regras documentadas, sem alegar uma única análise verdadeira.

Interfaces conceituais: `parseChord(text) -> Parsed | Unsupported`; `transpose(chord, interval, context?) -> Chord`; `spellPitch(class, context) -> SpelledNote`; `analyzeDegree(chord, key) -> Analysis | Indeterminate`; `chordTones(chord) -> SpelledNote[]`. Resultado deve informar motivo de unsupported e preservar offsets do chamador. Não converter palavras/letras ambíguas em acordes fora das regras de tokenização existentes.

Diagramas consomem o modelo: piano com teclas/oitavas/baixo e texto acessível; violão em afinação padrão E2 A2 D3 G3 B3 E4, cordas abertas/abafadas, trastes, pestana e digitação opcional. Começar por conjunto pequeno curado, próprio ou com licença documentada; gerar voicings arbitrários fica depois. Exibir “sem diagrama disponível” em vez de inventar posição. Validar cada nota/traste contra o acorde; testes de ergonomia humana separados da correção matemática.

Atualização de 2026-11-27 (VH, violão e harmonia): o gerador determinístico de posições e a importação do chords-db (MIT) passam a complementar o catálogo curado. Toda forma passa pelo validador, a única omissão aceita é a 5ª justa declarada, e a ligação na UI depende da revisão humana de uma amostra de 40 acordes. A análise harmônica ganha `analyzeHarmony`, que lista as leituras em vez de escolher uma; `analyzeDegree` não muda. Tonal.js não foi usado nem adicionado.

Interação no leitor por toque/teclado abre painel sem modificar a cifra; foco, Escape, alvos de toque e leitura por leitor de tela. Manter legenda textual e uso offline. Não colocar inferências novas em exportação/PDF sem gate específico.

## Alternatives Considered

| Alternativa | Vantagem | Limite / decisão |
| --- | --- | --- |
| Tonal.js direto na Web | Funções de notas, intervalos, acordes e tonalidades maduras | TS não resolve Dart; avaliar como referência/oráculo auxiliar, sem torná-lo verdade exclusiva |
| Núcleos TS/Dart por contrato | Baixo impacto, testes portáveis, sem bridge | Duplicação controlada exige corpus realmente único; recomendada |
| Núcleo WASM/FFI compartilhado | Código único | Toolchains/empacotamento novos antes de provar necessidade; adiar |

Tonal é referência candidata: [repositório oficial](https://github.com/tonaljs/tonal), [licença MIT](https://github.com/tonaljs/tonal/blob/main/LICENSE). Antes de eventual adoção: fixar versão, validar licença dos módulos usados, tamanho de bundle e formatos brasileiros. Não copiar regras/fixtures sem atribuição. Compatibilidade efetiva no LouvAIO: **Unknown / Not yet verified**.

## Consequences

Paridade significa mesmos resultados estruturados e texto esperado, não código idêntico. JSON proposto em `shared/fixtures/music-theory-v1.json` será criado somente na Fase 1. TS e Dart devem consumir o mesmo arquivo, sem listas duplicadas. Versionar gramática e migração de expectativas; desvio legado precisa de revisão explícita.

Casos mínimos: C, Cm7, Cmaj7, C7(b9), F#dim7, Bø7 (ou unsupported explícito), sus2/sus4, add9, omit5, acordes alterados, C/E, C/F#, Bb, B#, Cb, duplos acidentes; negativos e transposição ±24; inversões e intervalos compostos; tonalidades maiores/menores; entrada vazia/ambígua/Unicode/malformada e limite de comprimento. Exemplo teórico: C/E → +M2 = D/F#; C→+m2 = Db em escrita diatônica; modo cromático legado pode produzir C#. Ida/volta compara classes de altura e grafia conforme política, não exige que toda política retorne a mesma string.

## Evidence

`web/src/utils/smart_chord.ts:70`; `web/src/utils/smart_chord_notation.ts:252`; `mobile/lib/features/smart_chords/domain/smart_chord_parser.dart:392`; fixtures citadas na auditoria. Fontes externas consultadas em 2026-11-16; nenhum teste ou benchmark executado.

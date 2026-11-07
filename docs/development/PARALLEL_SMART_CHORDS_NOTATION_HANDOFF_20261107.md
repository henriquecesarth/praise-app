# P2 — Smart Chords Notação Avançada (isolada), 07/11/2026

Base: parallel/regression-musical-20261107 (fd4abf27ce167093127f381127e88b992e0e0e36).
Branch: parallel/smart-chords-notation-20261107.

## Entrega

Módulo aditivo web/src/utils/smart_chord_notation.ts, sem alterar o editor visual, o parser legado ou o backend. Gera tokens com posições UTF-16, preservando o texto fonte. Reconhece:

- Progressões | C | Am | F | G |, ||: C | Am :||, | C Am | F G |, | C (Am) | F G |, inversões e acordes complexos;
- % (marcador de repetição do compasso anterior, sem expansão automática), N.C., 2x e progressões legadas [| C | Am |];
- {{Texto}} isolada ou inline e {{^Texto}} associada ao próximo acorde, inclusive em linha subsequente;
- Acordes na letra [C]Grande [Am]é, seções e tablaturas preservadas;
- Transposição de acordes sem alterar delimitadores, anotações, parênteses, espaçamento e quebras de linha.

ANNOTATION_FONT_SCALE = 0.8 é apenas sugestão de apresentação. O leitor visual ainda não usa essa configuração. Nenhuma cifra existente foi migrada.

## Validação e gates

- web/src/utils/smart_chord_notation.test.ts: testes Vitest adicionados, ainda não executados contra a árvore completa do repositório nesta sessão.
- Validação local isolada: TypeScript estrito compilado e 12 casos smoke aprovados com stub representativo das funções de acorde; não equivale a executar o parser real.
- Build Web completo, Vitest integrado, Android/iOS, PDF e persistência real: Unknown / Not yet verified.

## Pendências para 09/11/2026

1. Preservar e publicar primeiro o workspace original e os 674 registros WIP no computador antigo; confirmar a baseline M21/D2-A.
2. Comparar esta branch à baseline recuperada; integrar seletivamente se o recurso ainda não existir.
3. Ligar os tokens annotation, optional_chord, barline, repeat_previous e repeat_count ao editor/leitor D2-A.
4. Mostrar notas pequenas (80% como proposta), acima do próximo acorde ou inline, sem sobreposição.
5. Testar ida-e-volta entre texto e editor visual, salvamento/reabertura, transposição, PDF e dispositivos.
6. Ampliar o tratamento de variantes antes de habilitar por padrão; não confundir o símbolo % ou 2x com execução automática de playback.
7. Executar testes e build local: cd web; npm test; npm run build -- --mode test.

Proteções: sem merge, deploy ou alterações em SmartChordsWorkspace, SongDetail, App, M21, D2-A, PDF, backend ou web/src/utils/smart_chord.ts. A sintaxe existe somente como mecanismo de interpretação isolado.

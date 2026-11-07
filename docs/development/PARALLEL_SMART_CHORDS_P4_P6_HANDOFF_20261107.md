# P4–P6 — Validação e novas notações musicais (07/11/2026)

Base da entrega: parallel/smart-chords-notation-p3-20261107 no commit 604c3ef2a0c037db27bf44beb634e9e14d29bc7f.
Nova branch: parallel/smart-chords-p4-p6-20261107.

## P4 — Validação possível neste ambiente

- TypeScript estrito (tsc --strict --target ES2022 --module commonjs) dos módulos musicais isolados, usando funções de acordes extraídas do código do repositório: PASS.
- Reexecução de validate_p3.cjs: 1.023 checks locais PASS.
- A execução de npm test com Vitest e o build Web completo ficaram BLOQUEADOS por falta de dependências do projeto e impossibilidade de clonar o repositório diretamente neste ambiente. NÃO declarar validação integrada como aprovada.
- O teste Vitest adicional smart_chord_notation_extensions.test.ts foi incluído mas ainda precisa ser executado num checkout completo.
- Não há alteração de comportamento no editor real porque os módulos novos ainda não estão conectados à UI.

## P5 — Marcadores musicais avançados

Arquivo novo: web/src/utils/smart_chord_notation_advanced.ts

- Leitura sem reescrita de assinatura de compasso 2/4, 3/4, 4/4 etc.
- Casas de repetição na forma [1., [2. (também [1] e [2]), fermata 𝄐 e pausas 𝄽 e 𝄼.
- Reutilização da classificação de %, N.C. e 2x da P3.
- Reconhecimento de acidentes ASCII e Unicode (B♭, F♯, E♮). Adaptador transposeAccidentalNotation transpõe Unicode apenas em progressões ou acordes explicitamente entre colchetes; não transpõe texto musical livre nem altera as anotações.
- Saída é uma lista de marcadores com offsets UTF-16. Nenhuma interpretação automática de ritmo, playback ou mudança de métrica.

## P6 — Anotações estruturadas

Arquivo novo: web/src/utils/smart_chord_annotation_semantics.ts

- Suporta escrita livre existente: {{Só violão}}, {{^Entra baixo}}.
- Categorias opcionais: {{Entrada: baixo}}, {{Saída: bateria}}, {{Dinâmica: suave}}, {{Execução: arpejo}}, {{Observação: repetir a ponte}}.
- Para posicionar sobre o próximo acorde, prefixar ^: {{^Entrada: baixo}}. Anotações sem ^ podem ficar em linha própria ou inline, conforme parser P3.
- Retorna tipo, texto para exibição, estilo proposto (escala 0.8), posição no texto e destino do acorde; não altera o conteúdo original.

## Validação local P5/P6

- 1.020 checks locais em validate_p5p6.cjs com 1.000 combinações determinísticas: PASS.
- Cinco transposições de acidentes Unicode testadas com as funções de acordes reais extraídas do repositório: PASS.
- Compilação estrita dos módulos P3, P5 e P6: PASS.
- A suíte Vitest integrada, build Web, editor visual, persistência, PDF, Android e iOS NÃO foram validados nesta sessão.

## Isolamento e integração futura

- Sem alterações no motor antigo smart_chord.ts, backend, áudio/MIDI, D2-A, M21, visual, PDF ou produção.
- Não fazer merge automático. Na segunda-feira, 09/11/2026, preservar e publicar primeiro o estado WIP do computador antigo, conferir a baseline M21/D2-A, executar Vitest e build completo em checkout limpo e só então integrar seletivamente o motor novo.
- Validar round-trip texto↔editor, ancoragem acima do acorde, PDF, alinhamentos e persistência real antes de habilitar por padrão.
- O push para uma nova branch pode criar automaticamente deploys de preview no Vercel, mesmo sem promoção a produção. Inspecionar e cancelar previews indesejados.

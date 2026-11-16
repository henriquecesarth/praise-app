# Inventário e matriz de reaproveitamento

Base e limites: [README](README.md). Caminhos abaixo são relativos ao worktree auditado; números indicam pontos de entrada do código em `6d77ace`.

## Frente A: teoria, notação e leitura

| Evidência | Comportamento observado | Reuso / limite |
| --- | --- | --- |
| `web/src/utils/smart_chord.ts:26`, `:70`, `:89` | Cifras entre colchetes, reconhecimento por regex, transposição por tabela cromática | Preservar API textual; tabela de sustenidos não mantém grafia contextual |
| `web/src/utils/smart_chord_notation.ts:7`, `:204`, `:252` | Tokens, progressões, repetição e separadores; transpõe delegando ao legado | Reutilizar parser de layout e spans; separar semântica musical |
| `web/src/utils/smart_chord_notation_advanced.ts:28`, `:79` | Símbolos/acidentes e transposição via legado | Preservar apresentação e compatibilidade de documentos |
| `mobile/lib/features/smart_chords/domain/smart_chord_parser.dart:392`, `:408`, `:496`, `:561` | Escala/mapas/regex próprios, slash bass, progressões, transposição e tom como raiz + sufixo | Portar contrato; não substituir parser inteiro |
| `mobile/lib/features/smart_chords/presentation/widgets/chord_lyric_line.dart:41`, `:69` | Parse e transposição para renderizar | Reusar linha/leitor e inserir modelo interativo sem alterar texto salvo |
| `mobile/lib/features/smart_chords/presentation/views/smart_chord_reader_screen.dart:609` | Tom exibido derivado de `originalKey` e semitons | Campo textual não é análise de tonalidade/modo |
| `web/src/components/smart-chords/SmartChordEditor.tsx:118` | Seleção de tom | Manter edição; não inferir harmonia só deste campo |
| `web/src/utils/fixtures/smart_chord_reference_cases.ts:1`; `mobile/test/features/smart_chords/domain/smart_chord_r17_reference_parity_test.dart:18` | Casos de referência TS e cópia manual Dart | Extrair futuramente corpus neutro; hoje não é fonte única |

Motor dedicado de diagramas, voicings, inversões e graus: **Unknown / Not yet verified**; buscas direcionadas não localizaram implementação. Piano do M21 é teclado de exercícios, não catálogo de diagramas harmônicos. Cobertura de impressão/PDF para diagramas: **Unknown / Not yet verified**.

## Frente B: repertório, versões e M21

| Evidência | Comportamento observado | Reuso / limite |
| --- | --- | --- |
| `backend/src/features/repertoire/repertoire.types.ts:16` | `songVersionSchema`: id, nome, key, bpm, duration, notes, links e classificações | Versão existente é identidade canônica; nenhum segundo repertório |
| Mesmo arquivo `:29` | `audio_url`, YouTube e links legados da música | Não são arquivos locais nem autorização de download; preservar contratos |
| `web/src/types.ts:156`; `mobile/lib/features/repertoire/domain/song_detail.dart:142` | Modelos consumidores de versão | Reusar IDs e contexto; não adicionar campos ao backend nesta fase |
| `web/src/components/SongDetail.tsx:68`, `:91`, `:194` | Adaptação de links legados à versão original e seleção por ID | Vincular localmente ao ID resolvido; não escolher versão por título |
| `mobile/lib/features/repertoire/presentation/views/song_detail_view.dart:124` | Versão e sequência da escala propagadas na navegação | Reusar estante, ordem e duplicatas da escala |
| `web/src/components/VocalExercisePlayer.tsx:25`; `web/src/audio/sampled-piano.ts` | Exercícios/piano amostrado | Reusar experiência e técnicas de agendamento após isolamento; não tratar como player de stems pronto |
| `mobile/lib/features/vocal/presentation/vocal_player_screen.dart:44` | Canal nativo `vocal_audio`, BPM/metrônomo | Investigar ciclo de vida e relógio; não extrapolar capacidade de mixer |
| `web/vite.config.ts:50` | Precache de shell e amostras WAV; rota vocal NetworkFirst; demais navegações NetworkOnly/fallback | Offline atual não cobre repertório/pacotes. Resumo genérico em system-status omite exceção vocal |
| `backend/src/features/repertoire/repertoire.routes.ts:24` | Autenticação, leitura member, mutações admin | Preservar isolamento e RBAC; arquivo recebido não concede acesso à API |

Player de gravação por versão, mixer multifaixa, A–B, velocidade e cache de gravações Flutter: **Unknown / Not yet verified**; não encontrados nos caminhos auditados. Não declarar ausência global nem homologação a partir desta leitura.

## Ownership: código recente prevalece

Smart Chords mantêm autoria pessoal. Porém `backend/src/features/smart_chords/smart_chord.service.ts:526` e `:564` contêm leitura ministerial controlada por vínculo e administradores atuais; mutações usam `assertMinistryAdminRole` (`:55`). O ExecPlan R2.2 descreve esse fluxo. Portanto, a frase histórica “vínculo não compartilha cifra” não descreve integralmente esta base: preservar as verificações reais, sem estender a gravações. Leitura ministerial de cifra não implica licença nem compartilhamento de áudio.

## Documentos cruzados

- `docs/exec-plans/active/2026-11-09-d2-b-repertorio.md`: versões e estante.
- `docs/exec-plans/active/2026-11-15-r2-2-music-stand-sequence-rbac.md`: sequência, RBAC e leitura vinculada; seu diagnóstico é histórico, não prova de falha atual.
- `docs/exec-plans/2026-11-06-m21-vocal.md`, `2026-11-06-m21-2-r1-piano.md`, `2026-11-06-m21-2-r2-android-handoff.md`: M21 e limites de homologação histórica.
- `docs/architecture/integrations.md:106` e `docs/system-status.md:24`: confrontados com `vite.config.ts`, sem editar documentos gerais fora do escopo.
- `web/package.json` e `mobile/pubspec.yaml`: sem Tonal ou biblioteca genérica de player declarados; não instalar nesta fase.

## Resultado por frente

A: reuso alto de notação/leitores; formalizar semântica e corpus antes da interação. B: reuso alto de domínio, navegação e UI; transporte/mixer de gravação exige spike próprio. C: processamento é ferramenta independente de desktop. D: armazenamento de arquivos e import/export são novos contratos locais, não migração do repertório.

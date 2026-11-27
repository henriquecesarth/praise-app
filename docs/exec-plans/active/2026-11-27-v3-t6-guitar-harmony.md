# T6 — Violão para qualquer acorde e análise harmônica comum

Início: 2026-11-27. Branch `fix/louvaio-audit-remediation-20261113`, sobre `5b92119`. Commit (junto com a T3) e push autorizados em 2026-11-27; sem deploy. Áudio e backend fora do escopo.

## Decisões do responsável
- Omissão permitida: somente a 5ª justa, em acorde com sétima ou extensão.
- Baixo fora do acorde: usar os acordes vizinhos da linha (baixo de passagem).
- Acorde maior só com a 9 (`C9`, `C(9)`, `C/9`) é sus2; só com a 4 é sus4. A nona dominante se escreve `C7(9)` ou `C7/9`.
- Com a terça maior no baixo (`C9/E`, `D9/F#`), o 9 sozinho é add9.
- Baixo com grafia enarmônica (`D#/G`) conta como a nota do acorde que soa igual.
- Corrigir o transpositor de exibição para `(4)` e, pelo mesmo defeito, `º`, `°`, `ø` e `m(maj7)`.
- Mostrar todas as posições de cada acorde existentes no chords-db (sem limite por acorde). O validador continua descartando as inválidas.
- Incluir formas comuns ausentes do chords-db: lista fixa `COMMON` em `web/scripts/import-chords-db.mjs` (origem `pop`), escolhida na implementação e sujeita à revisão da amostra; 12 entraram. Aparecem depois das curadas v1 e antes das do chords-db.

## Situação
- [x] Notação brasileira no parser T2 (`4`, `(9)`, `(b5)`, `M7`, `º`, `7sus4`), TS e Dart.
- [x] Importação chords-db (`df06fa7`): 3283 posições lidas, 2527 aceitas (90 com dedilhado refeito, mesmas casas), 38 repetidas, 598 rejeitadas pelo validador, 120 de sufixos sem suporte (`5`, `alt`, `sus2sus4`); relatório em `shared/fixtures/guitar-voicings-v2.import-report.json`.
- [x] Gerador determinístico e busca (`findGuitarVoicings`), TS e Dart.
- [x] Amostra de 40 acordes: `docs/exec-plans/evidence/t6-guitar-sample.json` e página privada de revisão.
- [x] Revisão da amostra pelo responsável: aprovada em 2026-11-27.
- [x] `analyzeHarmony` (v2), TS e Dart.
- [x] UI Web e Flutter ligada (posições, origem, omissão, leituras, vizinhos). Os nomes de posição passaram a ser genéricos ("1ª posição").
- [x] `feature-reviewer` (leitura estática): 0 bloqueios, 0 HIGH, 3 MEDIUM, 7 LOW. Corrigidos: testes de vizinhos, posição mantida ao reabrir (web), documentação.

## Pendências do revisor
- Corrigidas em 2026-11-27 (web e Flutter): `C9/E`, baixo enarmônico e transposição. Revisadas pelo `feature-reviewer` (leitura estática): 0 bloqueios, 0 HIGH, 1 MEDIUM, 5 LOW.
- Corrigidos depois (sem nova revisão): linha sem colchetes no Flutter com `C7(4)` (também na importação por imagem); legenda de `C/B#`; transposição de `(M7)`, `(add11)`, `(#13)`, `(b11)`; `A/2` e datas deixam de ser acorde (a parte numérica após a barra só aceita graus 4, 5, 6, 7, 9, 11, 13); vetor `C/9/E`.
- Aberto: o backend (`smart_chord_normalizer.ts`) tem cópia própria sem a notação nova; fica para tarefa própria. No Flutter, a cor do ponto do baixo em `C/B#` não usa a cor da fundamental.
- A reimportação passou a aceitar 15 formas com baixo enarmônico (2527 aceitas, 598 rejeitadas, 737 acordes, 2549 formas). No corpus, `E/G#`, `Db/F` e `F#/A#` ganharam uma posição cada.
- Abertas (menores): busca de posições sem cache; rótulo `Vsus47`; anúncio de posição para leitor de tela; licença sem tela de visualização no app.

## Diferenças em relação ao plano aprovado
- O catálogo v2 usa uma string por forma, não um objeto por entrada.
- A importação abafa cordas graves abaixo do baixo correto (o chords-db costuma mantê-las) e grava também a cópia Dart (sem script separado).
- Entre formas do catálogo, a ordem é por tocabilidade; a curada v1 continua primeiro.
- `lookupGuitarVoicing` (v1) não mudou; a busca nova é `findGuitarVoicings`.
- Em tom menor, o VII diatônico aparece como `VII7` (não `bVII7`), como na v1.
- Dominantes secundárias incluem só V e V7; vii° secundário ficou fora.
- Tonal.js não foi usado como conferência.

## Limites conhecidos
- Sem forma em 4 de 660 combinações testadas (maj13 em Db, F#, Ab e A).
- `C5` e `alt` continuam fora da gramática.
- Formas com muitas notas (11, 13) são corretas pelo validador, mas a ergonomia ainda não foi conferida por pessoa.

## Validação final (2026-11-27, após a UI)
- Web: `tsc` PASS; `npm test` 1763 de 1764, falhando apenas `AdminAvailabilityView` 8 (fora do escopo).
- Flutter: `flutter analyze` completo PASS; `test/core` (506), `test/features/smart_chords` (630) e `test/features/repertoire` (176) PASS. Antes do commit, as demais pastas também PASS: suíte completa em lotes, 2298 testes.
- `vite build` BLOCKED (ambiente de publicação).
- Conferência no tablet Lenovo TB-J616F (2026-11-27, responsável): PASS ("Está ok"). APK `preview` offline (`main_preview.dart`) com cifra de teste temporária, não commitada. Conferência manual na web: NOT_EXECUTED.

## Validação dos motores (antes da UI)
- Web: música e smart-chords PASS (421); `npm test` com falhas nos vetores novos de contrato (corrigidas e repetidas: PASS) e em dois testes fora do escopo: `AdminAvailabilityView` 8 (falha isolada; usa datas fixas de 2026-09; causa Unknown / Not yet verified) e `VocalExercisePlayer` (passa isolado). `tsc` PASS; `vite build` BLOCKED ("Verified publish environment required").
- Flutter: `test/core/music` PASS (384); `test/features/smart_chords` PASS (619); `flutter analyze` de `lib/core/music` e `test/core/music` PASS.

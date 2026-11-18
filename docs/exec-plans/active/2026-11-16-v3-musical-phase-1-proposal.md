# V3 Musical — plano incremental proposto para Fase 1

> Para executores: após autorização explícita de implementação, executar tarefa por tarefa com revisão independente. Este documento é planejamento; nenhuma tarefa de produto está autorizada por sua criação. Sem commits/push/deploy automáticos.

**Objetivo:** evoluir teoria musical e reprodução local sem duplicar repertório e sem armazenar áudio em bancos LouvAIO.

**Arquitetura:** núcleo musical puro TS/Dart por especificação; player por versão acima das rotas; adaptadores de arquivos e transporte locais; POC CPU isolada do produto.

**Stack observada:** React/Vite/TS, Flutter/Dart, Express/Firestore existentes; ferramentas da POC e qualquer dependência futura dependem de seleção/revisão, sem alteração agora.

**Spec:** [índice da Fase 0](../../audits/2026-11-16-v3-musical/README.md) e três ADRs vinculados. Base `6d77ace34a1c63965e0968980f94bb73f8b22af7`, worktree de referência indicado no índice.

## Restrições globais

- Áudio original/stems em arquivos locais; nenhum binário/base64/blob/chunk em banco LouvAIO, banco local ou bucket central. Índice local apenas metadados/referências.
- Não criar segundo repertório, novos IDs de música/versão ou schema backend para player local.
- Preservar contratos e comportamento existente, inclusive R2.2 e M21; nenhuma migração silenciosa de cifras.
- Não alterar planos/billing nem adicionar dependência sem necessidade revisada; fontes/checkpoints precisam licença verificável.
- Autorizar separadamente instalações/processamento POC e implementações. Nesta Fase 0 só documentos; sem testes/builds de produto.

## Pontos de revisão

Entrada ambígua preservada; conta/ministério/versão obsoletos; baixo espaço/crash no staging; delays/seek/loop entre codecs; perda de arquivos privados ou revogação de handles. Cada tarefa abaixo deve produzir evidência desses casos quando for responsável por eles. Caminhos novos são propostas, não arquivos já criados.

## Ordem, fronteiras e tarefas pequenas

### T1 — Corpus e contrato musical neutros

Responsável futuro: feature-engineer; um escritor por arquivo. Pré-requisito G1. A revisão do contrato/corpus produzido por T1 satisfaz G2; G2 não é pré-requisito circular de T1.

Arquivos propostos: criar `shared/fixtures/music-theory-v1.json`; adaptar consumidores `web/src/utils/fixtures/smart_chord_reference_cases.ts` e `mobile/test/features/smart_chords/domain/smart_chord_r17_reference_parity_test.dart` sem alterar expectativas legadas inadvertidamente.

Produz: gramática v1, notas/intervalos/spelling e resultados JSON comuns descritos no ADR. Consome: corpus legado TS/Dart.

- [x] Comparar listas e registrar divergências antes de alterar resultados.
- [x] Criar casos estruturados e fazer TS/Dart lerem o mesmo artefato, incluindo inválidos, Unicode, slash bass, acidentes e transposição negativa.
- [x] Rodar testes direcionados de paridade, confirmar igualdade e revisão independente das expectativas musicais (PASS).

Aceite: nenhuma lista manual divergente; C/E +M2 = D/F#, desconhecido preservado e caso de grafia diatônica versus cromática explícito. Não exige Tonal instalado.

### T2 — Núcleo puro de notas/intervalos e adaptação de transposição

Arquivos propostos: `web/src/music/theory.ts`, `mobile/lib/core/music/theory.dart`, testes adjacentes; adaptar somente funções de transposição dos parsers existentes citados na auditoria.

Consome T1 revisada (G2); produz `parseChord`, `transpose`, `spellPitch` e `chordTones`, com Unsupported e política legada. Sem I/O.

- [x] Criar testes falhando para intervalos/grafias, preservação de layout e `chordTones` de C, Cm e C7.
- [x] Implementar o mínimo, manter wrappers existentes e comparar corpus completo TS/Dart.
- [x] Rodar testes de parsers/renderização afetados; revisar diff de comportamento, sem reformatar cifras salvas (PASS).

Aceite: mesmo JSON nos dois runtimes, separadores/CRLF intactos, sem mudança silenciosa da escrita legada. Build pertinente só após alteração real de código.

### T3 — Diagrama de piano e painel acessível

Arquivos propostos: componentes dedicados sob `web/src/components/smart-chords/` e `mobile/lib/features/smart_chords/presentation/widgets/`, integração mínima nos leitores existentes. Nome final definido pelo executor após inspeção local.

Consome `Chord`/`chordTones` T2; produz painel visual+texto sem alteração de cifra. Reusar desenho M21 somente se isolado do transporte vocal.

- [ ] Testar C, Cm, C7 e slash bass; unknown mostra estado indisponível.
- [ ] Implementar toque/teclado, foco/Escape, leitor de tela e alvos >=44 px/dp.
- [ ] Validar Web/Android, retrato/tela pequena e regressão do leitor/estante.

Aceite: notas coerentes com contrato, nenhum parse novo na UI nem escrita de cifra.

### T4 — Catálogo mínimo de violão

Consome T2/T3; arquivos propostos `shared/fixtures/guitar-voicings-v1.json` e renderizadores dedicados nas mesmas áreas.

- [x] Fixar conjunto inicial, afinação padrão e licença/proveniência de cada forma.
- [x] Testar cordas/trastes/notas, pestanas e baixo; revisão por músico de ergonomia.
- [x] Renderizar aberto/abafado/texto acessível; sem diagrama arbitrário para acorde não coberto.

Aceite: todas as formas verificadas, sem geração combinatória ou ampliação de catálogo sem revisão.

### T5 — Inversões e graus contextuais

Consome T2; amplia os mesmos núcleos/testes, não schemas de tom.

- [x] Fixar maior/menor e casos de baixo não pertencente ao acorde.
- [x] Implementar `analyzeDegree`/voicing com indeterminate e explicação; testar C/E, C/F#, C em C maior e tom ausente.
- [x] Expor leitura opcional no painel e testar sem alterações de texto ou inferência automática de tonalidade.

Aceite: inversão versus slash bass distinguíveis; empréstimo/dominante secundária só em tarefa posterior com corpus dedicado.

### T6 — Spike do transporte de uma gravação local

Pré-requisitos G1/G3; independente de T3–T5 e da separação. Áreas futuras: `web/src/audio/`, `mobile/lib/features/repertoire/` e canais nativos relevantes, sem editar backend. Arquivos exatos/adaptador dependem do spike, não pressupor nova biblioteca.

- [x] Testar arquivo sintético/fixture autorizado curto, play/pause/seek/volume e persistência durante navegação.
- [x] Avaliar relógio/decoder, orçamento de RAM, interrupções/background separadamente; medir velocidade com pitch preservado.
- [x] Decidir adaptador com evidência, mantendo M21 funcional; não integrar mixer ainda.

Aceite: contrato de transporte do ADR comprovado no alvo escolhido; proposta específica de dependência, se necessária, revisada antes de instalação no produto.

### T7 — Pacote v1 e validador local

Consome ADR Local First; independente de modelos. Arquivos propostos: `shared/fixtures/rehearsal-package-v1/` (manifestos e expectativas pequenos, sem áudio real), validadores dedicados em `web/src/audio/` e domínio local Flutter. Não criar JSON schema backend.

- [x] Fixar campos/limites v1, fixtures válidas e adversariais; manifesto major futuro, zip-slip, duplicatas, bombas, hash e stem ausente.
- [x] Implementar validação incremental e orçamento de bytes; índice só metadados.
- [x] Testar idempotência/conflito, nenhum acesso à rede ou arquivo externo.

Aceite: pacote inválido nunca vira pronto; contrato legível nos dois clientes; limites aplicados nos bytes reais.

### T8 — Importação e gerenciador offline Android

Consome T7; área futura de pacote local em Flutter e ponte SAF se necessária.

- [ ] Implementar staging, espaço prévio, commit atômico e limpeza após crash/cancelamento.
- [ ] Listar tamanho/estado/local/vínculo, verificar/exportar/excluir com escopo explícito.
- [ ] Validar em modo avião, baixo espaço, arquivo movido e conta diferente; garantir que desinstalação/backup sejam explicados.

Aceite: quatro stems verificáveis offline; sem storage permission ampla, upload ou mistura entre namespaces.

### T9 — Acesso e gerenciador local Web

Consome T7; mesma semântica, adaptadores input/download e FS Access/OPFS quando suportados.

- [ ] Testar gesto/permissão, quota, reabertura sem handle e evicção; fallback funcional sem directory picker.
- [ ] Implementar arquivos no OPFS ou pasta selecionada, nunca blobs em banco.
- [ ] Validar offline do gerenciador sem introduzir cache genérico de dados ministeriais; decidir estratégia mínima do shell por teste.

Aceite: usuário pode exportar backup e recuperar/reimportar; sem promessa de retenção garantida do browser.

### T10 — Vínculo por versão e sessão global

Consome T6–T9 e domínio atual. Modificar pontualmente `SongDetail.tsx`, `song_detail_view.dart`, raiz de sessão e índice local.

- [ ] Criar testes de A/B conta/ministério/versão, ID legado resolvido, versão removida e eventos obsoletos.
- [ ] Implementar associação local explícita e mini-player; trocar contexto não renomeia mídia antiga nem toca automaticamente.
- [ ] Validar navegação da escala com versões/duplicatas e logout durante decode.

Aceite: nenhuma chamada HTTP nova para áudio/vínculo, nenhum segundo catálogo e nenhum uso de pacote como autoridade API.

### T11 — POC CPU independente

Consome G4 e [protocolo](../../audits/2026-11-16-v3-musical/separation-poc.md). Workspace separado autorizado futuramente; nenhum arquivo/dependência de produto alterado.

- [ ] Autorizar instalação, fixar checkpoint/licenças, corpus e hardware.
- [ ] Executar protocolo e registrar todas as métricas/fracassos, sem publicar áudio real no Git.
- [ ] Comparar resultados e escolher ou rejeitar candidato; manter quatro stems.

Aceite: relatório reproduzível com mediana/dispersão e gates, não “funciona no meu computador”. Só então avaliar mais categorias.

### T12 — Mixer quatro stems, A–B e modos

Consome T10/T11 e pacote íntegro. Subdividir revisão em transporte sincronizado, depois metrônomo/count-in e modos, sem acumular mudanças não verificadas.

- [ ] Medir alinhamento após decode, seek, loop e deriva em gravação de 10 min nos alvos.
- [ ] Implementar ganhos/mute/solo e original alternativo; velocidade só após gate de qualidade/CPU.
- [ ] Validar Ensaio/Culto, beat offset/compasso, ausência de clique involuntário no Culto e recuperação de interrupção.

Aceite: metas numéricas do ADR e memória respeitadas; falha não habilita funcionalidade parcialmente silenciosa. iOS requer spike/dispositivo próprio antes de declaração de suporte.

## Validação e critérios de saída

Na execução futura, confirmar scripts atuais. Web usa `vitest run`/Playwright; Flutter `flutter test`/`flutter analyze`; rodar primeiro apenas arquivos afetados com timeout e fixtures isoladas. Builds só para mudanças pertinentes; backend não precisa build/test por uma entrega exclusivamente de cliente/local. Se houver mudança Dart, validar hot reload quando runtime estiver disponível e registrar indisponibilidade sem fabricar execução. Revisor independente somente leitura por fronteira; registrar PASS/FAIL/NOT_EXECUTED/BLOCKED com logs reais.

Fase 1 não significa concluir T1–T12 de uma vez: recomendar autorização inicial T1/T2 e spike T6/T7; demais tarefas dependem dos gates. LAN, mais categorias, detecção automática de tom/BPM, processamento Android/browser, nuvem e distribuição de pesos não pertencem a esse recorte inicial.

## Registro da Fase 0

- [x] Base e worktrees conferidos, estado inicial preservado.
- [x] Auditorias independentes A/B/C-D recebidas.
- [x] Propostas/roadmap escritos somente como documentos.
- [x] Revisão independente final e validação documental PASS (resultado no relatório de gates).
- [ ] Implementação autorizada na Fase 0 (não houve; autorização incremental posterior da T1 registrada abaixo).

## Execução incremental — T1 (2026-11-16)

O proprietário aprovou a arquitetura e autorizou exclusivamente T1 nesta sessão (G1 satisfeito para este recorte). A restrição histórica da Fase 0 acima não impede essa autorização posterior. T2–T12, commits, push, merge e deploy continuam sem autorização nesta missão.

Base/HEAD preservado: `a788c15603d7925601ec4e9e69aa4329a7e0bbf9`, branch `fix/louvaio-audit-remediation-20261113`, worktree de remediação inicialmente limpo. Nenhum worktree foi criado, removido ou trocado; WIP da pasta principal preservado.

Entrega: [contrato e corpus](../../../shared/fixtures/README.md), JSON único com 99 casos normativos futuros, 34 casos de notação R17 e 10 observações legadas (143 vetores). Os dois clientes consomem a mesma fonte; o teste de instruções musicais Dart permanece. Nenhum motor, interface, player, backend, schema, API ou dependência foi alterado. Núcleos determinísticos são trabalho de T2; estes testes não alegam conformidade de motores inexistentes.

Decisões T1: intervalo diatônico usa movimentos de letra explícitos; cromático usa política sharp de raiz; notes representam conjunto teórico completo, não voicing. Qualidade diminuta + sétima menor representa meio diminuto. Acidentes até duplos são normativos; overflow triplo é unsupported. CanonicalSymbol nunca substitui originalText em cifras salvas.

Comparação antes da extração: 34/34 IDs, source, expectedPlusTwo e flags Unicode equivalentes; comparação automatizada posterior por deep equality contra `git show a788c156:...` PASS. Nenhuma expectativa legada foi recalculada ou corrigida silenciosamente. Divergências intencionais de contratos registradas: nota Db em zero normaliza para C#, cifra Db em zero permanece Db; Calt é reconhecido pela regex legada, mas não define conjunto de notas normativo; sufixos 7M/(add9) são preservados no texto legado e normalizados apenas em memória no contrato futuro.

Referência P2 consultada pelo conector GitHub sem merge/cherry-pick: branch `parallel/musical-integrity-p2-20261107`, arquivos `web/src/utils/smart_chord.ts` (blob `ca2e72fdac6998fa5c08d50e4c3cc5dc6f5a37b1`), `smart_chord.parallel.test.ts` (blob `852d6cbe4b76c9cf26645d0b618b6fb5012ae6c8`) e teste de segurança Dart (blob `363710f30cc5868232bdd13332f77281518b1f09`). A consulta Git CLI falhou no proxy local, mas o conector permitiu leitura dos arquivos. Nenhum código da branch foi incorporado.

Escritor único: principal. `/root/audit_player` comparou os corpora sem edição; `/root/audit_theory` revisou os 99 vetores e a referência P2, sem erro musical concreto encontrado; `/root/review_v3` concluiu revisão independente somente leitura do contrato, consumidores e testes: **PASS**, sem findings acionáveis. Confirmou independentemente 34/34 casos legados intactos, corpus normativo separado de observações legadas e ausência de motores T2. Identidade efetiva de inferência: **Unknown / Not yet verified**.

Validação real até este checkpoint local:

- RED TS: ENOENT do JSON ainda ausente; RED Dart: StateError do corpus ausente. Ajustes iniciais de carregamento do teste TS foram resolvidos sem alterar configuração global.
- GREEN Web: `npm test -- --run` nos seis arquivos de contrato/referência/parsers/notação, `--testTimeout=10000`: exit 0, **258 testes PASS** (111 do contrato/probes, 147 regressões).
- GREEN Dart: `flutter test --no-pub` nos seis arquivos de contrato/referência/parser/segurança/progressão/parênteses, `--timeout 30s`: exit 0, **180 testes PASS** (111 do contrato/probes, 69 regressões).
- Logs completos temporários: `louvaio-t1-web-tests.log`, `louvaio-t1-dart-tests.log`. Nenhum áudio real ou escrita externa nesses testes; sem emulador/backend necessário.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0, PASS. `dart analyze` nos três arquivos de teste/suporte afetados: exit 0, No issues found. Logs temporários `louvaio-t1-tsc.log` e `louvaio-t1-dart-analyze.log`.
- JSON parseável, links relativos válidos, `git diff --check` PASS e áreas fora do escopo sem diff. Os validadores e o loader novos são exclusivamente de testes. Hot reload não se aplica: nenhuma tela ou código de aplicativo Dart foi alterado.

G2/T1: **PASS**, pronto para checkpoint posterior autorizado. Isso não inicia T2 automaticamente. Sem commit/push nesta tarefa.

## Execução incremental — T2 (2026-11-16)

Autorização posterior do proprietário: exclusivamente núcleos TS/Dart e testes T2, sem commit/push e sem iniciar T3–T12. Base `a2da9c46f018a139388dae980cf37c34f3fd4e1a`, branch `fix/louvaio-audit-remediation-20261113`, worktree de remediação inicialmente limpo. Worktrees existentes preservados; as 185 entradas de WIP da pasta principal mantêm o estado anterior.

Responsabilidade de escrita: `/root/t2_typescript` somente `web/src/music/theory.ts` e `theory.test.ts`; `/root/t2_dart` somente `mobile/lib/core/music/theory.dart` e `mobile/test/core/music/theory_test.dart`; principal somente este registro e validação de integração. Revisão musical `/root/audit_theory` e revisão independente separada, ambas somente leitura. Workers solicitados como Sol/high com contexto separado; identidade efetiva de inferência: **Unknown / Not yet verified**.

Ruling: o corpus publicado T1 é a autoridade normativa da T2 e permanece intacto. Embora o ADR cite omit5 entre casos mínimos futuros, T1 fixa omissions vazio: omissões explícitas ficam unsupported em v1, sem ampliar o contrato silenciosamente. A inversão de T1 é relação simbólica do baixo com a lista teórica de notas, não inferência de voicing instrumental. C## + intervalo diatônico A1 excede acidente duplo; C## +1 cromático pode ser D#, portanto não confundir os dois modos. O custo dessa delimitação é manter omissões e demais sufixos fora da gramática v1 indisponíveis até novo contrato.

Ruling: os novos módulos puros não substituem wrappers nem renderizadores legados nesta tarefa. Diferenças normativas de grafia/canonicalSymbol permanecem isoladas; nenhum texto persistido ou comportamento visível é reformatado. A entrega deve provar o novo motor nos 99 casos normativos, além de manter os 34 vetores de notação e 10 observações no fluxo legado.

Helpers sem vetores diretos em T1: `spellPitch` retorna o envelope de nota (originalText é a representação textual da classe recebida; oitava/MIDI nulos), aceita classe inteira 0..11, letra explícita opcional ou preferência sharps/flats, sem inferir tonalidade. `chordTones(text)` retorna o envelope harmônico completo, com notes e projeções, como conveniência segura de parseChord. Ambos os runtimes devem seguir a mesma decisão e ter testes diretos fora do corpus. Numericamente, usar apenas inteiros seguros equivalentes ao domínio JS; entradas malformadas retornam Unsupported tipado.

Ruling: chromaticSharps escolhe a grafia da raiz; todos os constituintes e o baixo, inclusive baixo externo, seguem o movimento diatônico derivado dessa raiz. Assim C/E +1 resulta C#/E# e C/F# +1 resulta C#/F##. Essa escolha preserva a relação intervalar escrita e pode exibir um acidente duplo em lugar da alternativa enarmônica simples; não é inferência de função harmônica nem normalização independente do baixo.

### Artefatos e interfaces T2

- [Motor TS](../../../web/src/music/theory.ts) e [testes TS](../../../web/src/music/theory.test.ts).
- [Motor Dart](../../../mobile/lib/core/music/theory.dart) e [testes Dart](../../../mobile/test/core/music/theory_test.dart).
- Sete APIs: parseNote, parseInterval, parseChord, transposeNote, transposeChord, spellPitch e chordTones. TS retorna união discriminada Result<T>; Dart retorna TheoryResult<T> selado com Parsed<T>/Unsupported<T> e toJson(). Envelopes comparáveis preservam originalText, normalized, notes, diatonicSpellings e pitchClasses; falhas não expõem interpretação parcial.
- Opções de transposição: política diatonic com intervalo assinado ou chromaticSharps com semitons inteiros seguros; não aceitar opções contraditórias. Dart usa SignedInterval(posição diatônica, semitons), TS usa objeto com esses dois campos. Sem tonalidade inferida. BigInt interno evita perda de precisão; saídas numéricas continuam no domínio seguro comum.
- Gramática de acordes limitada e explícita: qualidades maior/menor/diminuta/aumentada/sus2/sus4, aliases min/+ e brasileiros 7M/m7(b5), 6/7/9/11/13, adições 9/11/13, alterações de extensão e slash bass. Grupos parentetizados só para modificadores reconhecidos; baixo numérico /9 é extensão, não nota de baixo. Não importar arquivos/fixtures/JSON ou fazer I/O nos motores.
- Nomes canônicos são apenas representações em memória: por exemplo Cmmaj7add9 e Cm(maj7)add9 convergem em Cm(maj7)add9, mantendo o original de cada chamada. O parser de documento continua responsável por comentários, compassos, letras e tablaturas.

### Validação e revisões T2

Resultados reais, com logs completos em temporários e sem instalação de dependências:

| Verificação | Resultado |
| --- | --- |
| Testes do motor TS, `npm test -- src/music/theory.test.ts --testTimeout=10000` | PASS, 108 testes; 99 comparações integrais contra os resultados normativos T1 + helpers/limites/aliases |
| Testes do motor Dart, `flutter test --no-pub test/core/music/theory_test.dart --timeout 30s` | PASS, 114 testes; os mesmos 99 resultados normativos + helpers/limites/aliases |
| Regressões Web, oito arquivos de notação/parser/contrato T1 e leitores/fontes | PASS, 270 testes; inclui 34 vetores R17 e 10 observações, preservação literal e alinhamento |
| Regressões Dart, diretório domain Smart Chords e widgets chord_lyric_line/musical_progression_line | PASS, 252 testes; inclui R17, observações, referência M20 de alinhamento, tablaturas e progressões |
| TypeScript `npx tsc --noEmit` após correção revisada | PASS, exit 0 |
| `dart analyze lib/core/music/theory.dart test/core/music/theory_test.dart` após correções | PASS, No issues found |
| Comparação direta de resultados reais TS/Dart em runner temporário | PASS, 2.576 entradas e zero diferenças de envelopes JSON |
| `npm run build` padrão local | BLOCKED pelo guard preexistente: Verified publish environment required; nenhum ambiente/credencial de publicação foi configurado |
| `npm run build -- --mode test` local, modo explicitamente previsto pelo guard | PASS, exit 0, inclusive nova execução após última correção TS; sem deploy |

A matriz diferencial inclui os 99 vetores normativos, 35 raízes (sete letras e cinco acidentes), 24 sufixos, slash bass, helpers de grafia, intervalos assinados, oitavas, transposições positivas/negativas, entradas inválidas e os limites de inteiros seguros. Ela inclui também os 27 probes da revisão independente. Comparação por deep equality após serialização; não é mock do motor nem comparação apenas de formato. Os 34 vetores legados e 10 probes observacionais continuam sendo executados no fluxo legado; diferenças deliberadas entre esses contratos não são forçadas no novo núcleo.

Logs temporários: louvaio-t2-ts-{red,green,tsc}.log e louvaio-t2-ts-review-{red,green,tsc}.log, louvaio-dart-theory-green.log e logs de RED/order da correção, louvaio-t2-web-legacy.log, louvaio-t2-dart-legacy.log, louvaio-t2-web-final-build.log. Runners/entradas/resultados diferenciais temporários louvaio-t2-differential-final.mjs, louvaio-t2-differential.dart, louvaio-t2-differential-inputs.json, louvaio-t2-typescript-results.json, louvaio-t2-dart-results.json e louvaio-t2-parity-differences-final.json (lista vazia após correções). Não são dados de usuário nem artefatos de áudio.

RED comprovado antes dos motores e antes das correções: testes reais chamam as funções novas e comparam o envelope completo com expected. Revisão musical /root/audit_theory: sem falhas musicais concretas em notas, intervalos, oitavas, qualidades, alterações e baixos; política de baixo externo documentada acima.

Revisão independente /root/t2_review detectou e motivou correções com RED/GREEN: alias min em meio diminuto, canônico de menor com sétima maior e adição, intervalos numéricos sem qualidade, reconhecimento de microtons/validação lexical completa e prioridade de erros em extremos numéricos. A fonte normativa não foi alterada. Em parseNote, texto lexicalmente incompleto não ganha interpretação parcial; em transposição diatônica, primeiro validar a grafia resultante e depois as coordenadas numéricas finais. Essa prioridade mantém categorias de Unsupported equivalentes entre runtimes.

Re-revisão independente final /root/t2_review: **PASS**, todos os achados corrigidos, sem findings abertos. O revisor executou independentemente 36 probes cirúrgicos (27 de aliases/erros e nove de precedência nos extremos), com zero diferenças; confirmou chamadas reais dos motores nos testes, ausência de I/O/lookup do corpus em runtime e escopo de quatro arquivos novos + este ledger. A análise musical /root/audit_theory também concluiu sem falhas musicais concretas.

Checks finais: corpus SHA-256 preservado `5bd27986e83ea9631763f42bcbddaf7b8082f5eca54b1617f5b498cf45e4c594`, dependências e fontes legadas sem diff, JSON/links/whitespace validados, índice vazio e HEAD ainda na base. As 185 entradas da pasta principal mantêm o mesmo hash de status anterior. Nenhuma tela Dart foi alterada ou importa o núcleo nesta etapa; hot reload não integra a comprovação destes módulos puros, que foram compilados e executados pelos testes.

**Gate T2: PASS local, pronto para revisão/checkpoint posteriormente autorizado.** Nenhum commit/push, publicação, alteração de backend/API, UI, M21, faturamento ou dado persistido foi realizado. O build de publicação permanece sujeito ao guard e não foi homologado; o build local de teste passou. T3 não foi iniciada.

## Execução incremental — T4 (2026-11-16)

Base/HEAD preservado: `f77d6ce87e1b3c03cba6013abb0b0b3ac4ae4f5c` (T3 publicada), branch `fix/louvaio-audit-remediation-20261113`, worktree `.worktrees/louvaio-audit-remediation`. Nenhum commit, push, merge, deploy ou alteração fora do escopo T4 foi realizado; T5 e posteriores não foram iniciadas.

- **Catálogo curado v1**: [guitar-voicings-v1.json](../../../shared/fixtures/guitar-voicings-v1.json) e [documentação de fixtures](../../../shared/fixtures/README.md). Afinação padrão `E2 A2 D3 G3 B3 E4` (MIDI `40, 45, 50, 55, 59, 64`). 10 acordes/posições verificadas: `C`, `Am`, `G`, `D`, `Em`, `F` (pestana na 1ª casa), `Am7`, `C7M` (`Cmaj7`), `G/B` (1ª inversão, 6ª corda abafada, baixo `B2`) e `F#m7(b5)` (`F#m7b5`, 2ª casa com baixo `F#2`). Proveniência: curadoria própria LouvAIO V3 (sem cópia externa e sem geração combinatória).
- **Validadores e lookup T4**: [guitarVoicings.ts](../../../web/src/music/guitarVoicings.ts) / [guitarVoicings.test.ts](../../../web/src/music/guitarVoicings.test.ts) e [guitar_voicings.dart](../../../mobile/lib/core/music/guitar_voicings.dart) / [guitar_voicings_test.dart](../../../mobile/test/core/music/guitar_voicings_test.dart) consumindo os núcleos T2 e o mesmo catálogo compartilhado via [guitar_voicings_corpus.dart](../../../mobile/test/support/guitar_voicings_corpus.dart).
- **Interfaces Web e Flutter**: alternância `Piano` / `Violão` integrada ao painel existente em [ChordPianoDiagram.tsx](../../../web/src/components/smart-chords/ChordPianoDiagram.tsx), [ChordGuitarDiagram.tsx](../../../web/src/components/smart-chords/ChordGuitarDiagram.tsx), [workspace.css](../../../web/src/components/smart-chords/workspace.css) e [chord_piano_diagram_sheet.dart](../../../mobile/lib/features/smart_chords/presentation/widgets/chord_piano_diagram_sheet.dart), preservando acorde selecionado, transposição visual, foco/`Escape`/rolagem, edição inline do `SmartChordReader`, `SongDetail`, `ChordLyricLine`, `MusicalProgressionLine`, `SmartChordReaderScreen` e `SongDetailView`. Acordes sem posição verificada exibem `"Diagrama indisponível"`.
- **Validação final executada**:
  - Web: 7 suítes direcionadas (331 testes PASS, incluindo 15 de `guitarVoicings.test.ts` e 20 de `ChordPianoDiagram.test.tsx`), `npx tsc --noEmit` (PASS), `npm run build -- --mode test` (PASS).
  - Flutter: 8 suítes direcionadas (408 testes PASS, incluindo 7 de `guitar_voicings_test.dart` e 61 de `chord_piano_diagram_sheet_test.dart` com layout fluido em 320/360/393/840dp a 1.3x), `dart analyze` nos arquivos T4 (No issues found).
  - Revisão independente read-only (`feature-reviewer`): **PASS** (0 findings BLOCKER/HIGH/MEDIUM/LOW).

## Execução incremental — T5 (2026-11-16)

Base/HEAD preservado: `f02107e4ca950f8be9e532ce1bfbea3ae19bb254` (T4 publicada), branch `fix/louvaio-audit-remediation-20261113`, worktree `.worktrees/louvaio-audit-remediation`. Corpus T1 (`shared/fixtures/music-theory-v1.json`, SHA-256 `5BD27986E83EA9631763F42BCBDDAF7B8082F5ECA54B1617F5B498CF45E4C594`) e T4 (`shared/fixtures/guitar-voicings-v1.json`) preservados sem alteração. Sem commit/push/merge/deploy ou início da T6.

- **Corpus harmônico v1**: [harmony-analysis-v1.json](../../../shared/fixtures/harmony-analysis-v1.json) e [documentação de fixtures](../../../shared/fixtures/README.md). 61 casos verificados cobrindo tonalidades maiores (17), tonalidades menores com referência explícita à escala menor natural (16), inversões reais vs baixo externo ao acorde (10), análises indeterminadas (14: ausência/invalidade de tonalidade, baixo externo, graus elevados de menor harmônica/melódica, divergência enarmônica e acordes cromáticos fora do escopo) e entradas não suportadas (4).
- **Núcleos puros TS/Dart**: `parseKeyContext`, `analyzeBass` (reutilizando diretamente `bassRole` e `inversion` da T2 sem duplicar cálculo) e `analyzeDegree` em [theory.ts](../../../web/src/music/theory.ts) / [theory.test.ts](../../../web/src/music/theory.test.ts) e [theory.dart](../../../mobile/lib/core/music/theory.dart) / [theory_test.dart](../../../mobile/test/core/music/theory_test.dart) consumindo o mesmo corpus via [harmony_analysis_corpus.dart](../../../mobile/test/support/harmony_analysis_corpus.dart). Paridade estrutural 1:1 sem inferência automática de tonalidade.
- **Interfaces Web e Flutter**: seção opcional `"Análise Harmônica Contextual"` com seletor de tonalidade exclusivamente em memória local (sem gravação em Firestore ou mutação de `SongVersion`/cifra) em [ChordPianoDiagram.tsx](../../../web/src/components/smart-chords/ChordPianoDiagram.tsx), [workspace.css](../../../web/src/components/smart-chords/workspace.css), [ChordPianoDiagram.test.tsx](../../../web/src/components/smart-chords/ChordPianoDiagram.test.tsx), [chord_piano_diagram_sheet.dart](../../../mobile/lib/features/smart_chords/presentation/widgets/chord_piano_diagram_sheet.dart) e [chord_piano_diagram_sheet_test.dart](../../../mobile/test/features/smart_chords/presentation/widgets/chord_piano_diagram_sheet_test.dart).
- **Validação executada**:
  - Web: 13 suítes (547 testes PASS, incluindo 172 de `theory.test.ts` com 61 casos do corpus T5 e 23 de `ChordPianoDiagram.test.tsx`), `npx tsc --noEmit` (PASS), `npm run build -- --mode test` (PASS).
  - Flutter: 577 testes PASS em core/music, domínio Smart Chords, `chord_piano_diagram_sheet_test.dart` (incluindo layout fluido T5 em 320/360/393/840dp a 1.3x), `chord_lyric_line_test.dart`, `musical_progression_line_test.dart`, `smart_chord_reader_screen_test.dart` e `song_detail_view_test.dart`; `dart analyze` nos arquivos T5 (`No issues found`).

## Execução incremental — T6 (2026-11-17)

Base/HEAD preservado: `2b0c1a3a4a0eb0ce482562edb98b936f4c9e9b99` (T5 publicada), branch `fix/louvaio-audit-remediation-20261113`, worktree `.worktrees/louvaio-audit-remediation`. Nenhuma integração com `SongDetail`, `SongVersion`, `SmartChordReader`, `SchedulesView`, backend, Firestore, M21 ou dependências novas de produto foi realizada.

### Recorte G3 e ambiente real verificado

- **Alvo experimental G3:** Web desktop em `HeadlessChrome/151.0.7922.34` (Playwright `1.62.1`), Windows 10 x64 `10.0.19045`, CPU `Intel(R) Core(TM) i5-3550 CPU @ 3.30GHz` (4 núcleos), 8.079 MB RAM total (~1.709 MB livres no preflight), `jsHeapSizeLimit = 3.76 GB`, zero dependências externas.
- **Fixture de áudio:** WAV PCM 16-bit estéreo 44.100 Hz gerado sinteticamente em memória por [createSyntheticWavFile](../../../web/src/audio/local-audio-transport.ts) (880 Hz / 440 Hz, uso próprio 100% autorizado, sem binários pesados em Git).
- **Não homologado neste spike:** Android, iOS, background/lockscreen, mixagem multifaixa (4 stems T12) e codecs comprimidos sob carga VBR real.

### Implementação isolada (Web)

- **Transporte local isolado**: [local-audio-transport.ts](../../../web/src/audio/local-audio-transport.ts) (`LocalAudioTransportController`, máquina de estados `idle -> loading -> ready -> playing -> paused -> idle/error`, comandos `load`, `play`, `pause`, `seek(frame)`, `setRate(rate, { preservesPitch })`, `setMasterGain(gain)`, `setSessionContext`, `stop`, `dispose`). Usa streaming por `URL.createObjectURL(File/Blob)` em `HTMLMediaElement` + `AudioContext` (`MediaElementAudioSourceNode -> GainNode -> destination`, mantendo `audio.volume = 1` para evitar dupla atenuação e fallback para `audio.volume` sem Web Audio), lê apenas slice inicial de até 4 KiB (`WAV_HEADER_SLICE_BYTES = 4096`) para metadados RIFF/WAVE sem decodificar gravações longas em PCM, rejeita URLs remotas (`REMOTE_URL_FORBIDDEN`), arquivos vazios/corrompidos, desabilita autoplay na troca de arquivo e descarta callbacks de gerações obsoletas.
- **Harness experimental de navegação**: [LocalAudioTransportHarness.tsx](../../../web/src/audio/LocalAudioTransportHarness.tsx), isolado das rotas do LouvAIO, preservando sessão única de transporte durante desmontagem/montagem de telas experimentais (`Detalhe`, `Estante`, `Escala`), troca explícita por `<input type="file">`, troca de arquivo sem autoplay, invalidação imediata ao alterar `accountNamespace` ou `ministryId`, e liberação via `stop`/`dispose`.

### Medições reais em navegador Chromium e testes automatizados

- **Load / Play / Pause (WAV 4s 44,1 kHz estéreo, 880 Hz):** `load` em `276.2 ms` (`noAutoplayVerified: true`, `currentFrame = 0`, `paused = true`), chamada `play()` em `10.3 ms`, avanço para `10.539 frames` (`0.239 s`) após ~350 ms de parede, e `pause()` congelou deterministicamente em `10.550` frames após mais 120 ms.
- **Precisão de Seek (WAV PCM16):** alvos `22050`, `66150`, `110250`, `0`, `-5000` (clamp `0`) e `9999999` (clamp `176400`) resolveram evento `'seeked'` em `0.4–6.0 ms` com **0 frames (0 ms) de erro**. *Limitação documentada:* precisão sub-frame aplica-se a PCM WAV; MP3/AAC/Opus com priming delay e sincronização multi-stem continuam não comprovados até T7/T12.
- **Master Gain (`GainNode` + `AnalyserNode` em 880 Hz):** `gain 1.0 -> RMS 0.3533`, `0.5 -> RMS 0.1768`, `0.1 -> RMS 0.0354`, `0.0 -> RMS 0.0` (elemento mantido em `volume = 1`). Não controla volume do hardware/SO.
- **Velocidade (0,5×–1,5×) e tonalidade (`AnalyserNode` em 880 Hz):** com `preservesPitch = true`, manteve `880 Hz` exatos em todas as marchas (`0.5×` -> `0.44×` medido na janela; `0.75×` -> `0.69×`; `1.0×` -> `1.00×`; `1.25×` -> `1.21×`; `1.5×` -> `1.44×`). Com `preservesPitch = false` (varispeed), deslocou para `440 Hz` em `0.5×` (`0.50×`) e `1320.2 Hz` em `1.5×` (`1.47×`). Pitch-shifting independente de velocidade (`pitchShiftSemitonesSupported`) é `false` neste backend nativo; time-stretching nativo WSOLA do navegador pode apresentar artefatos/phasiness em música complexa abaixo de ~0,6×.
- **Orçamento de memória e limpeza:** leitura restrita a slice <= `4.096` bytes mesmo com cabeçalho simulado de 5 min (`13.230.000` frames, cujo decode Float32 integral exigiria `105.840.000` bytes). Em Chromium, `performance.memory.usedJSHeapSize` manteve-se no bucket quantizado mínimo de `10.000.000` bytes antes do load, após o load e após `dispose`, com `2/2` blob URLs criadas devidamente revogadas (`liveUrlsAfterDispose = 0`).
- **Autoplay e persistência em navegação React real:** troca de telas no Chromium real manteve áudio tocando (`Frames: 8576/132300` em Estante -> `32768/132300` em Escala); troca para fixture 440 Hz entrou em `ready` (`Geração: 2`, sem autoplay); `<input type="file">` rejeitou WAV inválido com `UNSUPPORTED_OR_CORRUPT_HEADER` e carregou/tocou/descartou WAV válido sem erros de console. Em contexto Chromium headless padrão sem `--autoplay-policy`, `play()` programático também iniciou, porém navegadores desktop/mobile interativos bloqueiam autoplay sem gesto (`PLAYBACK_REJECTED` coberto em unidade com recuperação por clique).
- **Suítes automatizadas, builds e regressão M21:** [local-audio-transport.test.ts](../../../web/src/audio/local-audio-transport.test.ts) (13 testes PASS) + [LocalAudioTransportHarness.test.tsx](../../../web/src/audio/LocalAudioTransportHarness.test.tsx) (4 testes PASS, incluindo ciclo duplo sob `React.StrictMode`) + regressão M21 Web (`VocalExercisePlayer.test.tsx` 7 PASS e `VocalExercisePlayer.m21-final.test.tsx` 16 PASS) -> **40/40 PASS**; `tsc --noEmit` PASS; `npm run build -- --mode test` PASS (1590 módulos). M21 intacto (zero diff em `sampled-piano.ts` e `VocalExercisePlayer.tsx`).

### Matriz técnica de viabilidade multiplataforma (T6)

| Critério | Web Desktop Chromium (Evidência Executada) | Flutter Android (Evidência de Código M21 + Doc; T6 `NOT_EXECUTED`) | Flutter iOS (Evidência de Código M21 + Doc; T6 `NOT_EXECUTED`) |
| --- | --- | --- | --- |
| Transporte local (1 faixa) | **PASS:** `HTMLMediaElement` + `URL.createObjectURL` + Web Audio `GainNode` medido em `HeadlessChrome/151` | M21 usa `AudioTrack` (`MODE_STREAM`, PCM 16-bit mono) via `MethodChannel` para síntese piano; para arquivos locais sugere-se Media3/ExoPlayer nativo | M21 usa `IOSVocalAudioPlayer` via `MethodChannel` (`AVFoundation`); para gravações sugere-se `AVPlayer`/`AVAudioEngine` (requer macOS/aparelho real) |
| Offline local / seleção | **PASS:** `<input type="file">` sem rede/DB; FS Access/OPFS pertencem à T9 | **Hipótese/Doc:** `file_picker` + SAF URI + diretório privado gerenciado (`minSdk >= 23`), sem `READ_EXTERNAL_STORAGE` amplo (a implementar na T8) | **Hipótese/Doc:** `file_picker` + Security-Scoped URL / `FileManager` sandbox (não testado neste host Windows) |
| Background / Lockscreen | Sessão persiste entre rotas SPA na aba ativa; aba suspensa/OS throttle não homologado em segundo plano | **Não homologado:** `AndroidManifest.xml` não declara `FOREGROUND_SERVICE_MEDIA_PLAYBACK` nem `MediaSession` | **Não homologado:** `Info.plist` não declara `UIBackgroundModes` audio; `AppDelegate.swift` interrompe M21 em `willResignActive`/`didEnterBackground` |
| Velocidade 0,5×–1,5× c/ pitch preservado | **PASS medido:** `preservesPitch = true` manteve 880 Hz de 0,5× a 1,5×; sem pitch-shift independente (`false`) | **Doc/Hipótese:** `Media3 ExoPlayer` suporta `PlaybackParameters(speed, pitch=1.0f)` via Sonic em API >= 23; sem medição local | **Doc/Hipótese:** `AVPlayer` (`AVAudioTimePitchAlgorithm`) e `AVAudioEngine` + `AVAudioUnitTimePitch` suportam speed + pitch-shift; sem medição local |
| Seek e multifaixa futuro (T12) | **WAV:** 0 frames erro em seek 1-faixa; **4 stems (T12)** exigirão `AudioWorklet`/buffers curtos sincronizados no `AudioContext`, não múltiplos `<audio>` | 1 faixa: ExoPlayer resolve com codecs (`FLAC`/`Opus`/`AAC`); **4 stems (T12)** exigirão decoder nativo (`MediaExtractor`/`MediaCodec`) + mixer único PCM/Oboe | **Hipótese:** `AVAudioEngine` permite conectar múltiplos `AVAudioPlayerNode` no mesmo grafo/clock, pendente de spike real em hardware Apple |
| Recomendação de dependências | **Zero novas deps npm** para T6/T10 1-faixa; avaliar WASM/AudioWorklet apenas se DSP/stems na T12 exigirem | **Não instalar pacotes pub/Gradle nesta T6;** validar primeiro canal nativo Kotlin com `media3-exoplayer` em spike Android dedicado | **Sem deps iOS** até existência de ambiente macOS/iOS e gate próprio |

## Execução incremental — T7 (2026-11-17)

Base/HEAD preservado: `dd57935d275d4e67af522e30989a424865b475dc` (T6 publicada), branch `fix/louvaio-audit-remediation-20261113`, worktree `.worktrees/louvaio-audit-remediation`. Nenhuma dependência foi adicionada em `web/package.json` ou `mobile/pubspec.yaml`; backend, Firestore, APIs, M21, `SongDetail.tsx`, `song_detail_view.dart`, worktree principal e configurações de agentes permaneceram intocados; T8–T12 não foram iniciadas.

### Contrato versionado, fixtures e protocolo atômico

- **Especificação e corpus compartilhado:** [rehearsal-package-v1/README.md](../../../shared/fixtures/rehearsal-package-v1/README.md), [README de fixtures](../../../shared/fixtures/README.md), manifestos de referência ([valid-wav-minimal](../../../shared/fixtures/rehearsal-package-v1/manifests/valid-wav-minimal.manifest.json), [valid-with-original-and-practice](../../../shared/fixtures/rehearsal-package-v1/manifests/valid-with-original-and-practice.manifest.json)) e [rehearsal-package-v1-corpus.json](../../../shared/fixtures/rehearsal-package-v1/rehearsal-package-v1-corpus.json) (44 receitas declarativas determinísticas sem versionar binários `.zip` ou gravações pessoais no Git).
- **Pré-limites v1 (`LIMITS_V1`):** `2 GiB` compactados, `4 GiB` extraídos, `32` entradas, `manifest.json <= 256 KiB`, profundidade `<= 3`, razão `<= 100:1`, duração `<= 30 min` (`79380000` frames em `44100` Hz), reserva `max(256 MiB, 10% do pico)`, chunk máximo `64 KiB` (`65536` bytes) e orçamento padrão de memória de trabalho `64 MiB`.
- **Estados e publicação fail-closed:** `valid` (`readyForPublication: true`, `publicationState: "staged_validated"`), `incomplete`, `unsupported`, `corrupted`, `insufficientSpace`, `conflict` e `cancelled` (`readyForPublication: false`, `publicationState: "rejected"` em todos os estados não válidos; `songVersionBindingAuthorized: false` constante em T7). Protocolo atômico (`staging/<txId>/` + `staging.journal.json` -> verificação pós-escrita -> commit por rename -> limpeza pós-crash) documentado no contrato para implementação em T8/T9.

### Implementação incremental Web e Flutter/Dart

- **Web (`web/src/audio/`):** [rehearsal-package-validator.ts](../../../web/src/audio/rehearsal-package-validator.ts), [rehearsal-package-fixtures.ts](../../../web/src/audio/rehearsal-package-fixtures.ts) e [rehearsal-package-validator.test.ts](../../../web/src/audio/rehearsal-package-validator.test.ts) (delegado inicialmente ao Hydrogen Web). Zero `node:*` e zero novas dependências: usa `RandomAccessByteSource` (`Blob.slice`/`File`/buffer em fatias `<= 64 KiB`, sem `blob.arrayBuffer()` integral), `DecompressionStream('deflate-raw')` em fatias de `4 KiB` com cancelamento imediato de bomba DEFLATE, SHA-256 e CRC-32 incrementais O(1), `AbortSignal` cooperativo e inspeção binária head/tail (`<= 4 KiB` cada) para WAV, FLAC, Ogg Opus, M4A e MP3 (somente `original`).
- **Flutter/Dart (`mobile/`):** [rehearsal_package_validator.dart](../../../mobile/lib/core/audio/rehearsal_package_validator.dart), [rehearsal_package_corpus.dart](../../../mobile/test/support/rehearsal_package_corpus.dart) e [rehearsal_package_validator_test.dart](../../../mobile/test/core/audio/rehearsal_package_validator_test.dart) (delegado inicialmente ao Hydrogen Dart). Investigação de `pubspec.yaml`/`pubspec.lock` confirmou que `archive` (4.5.2) é apenas transitivo de `image` e não oferece leitor ZIP incremental com orçamento sem nova dependência; implementado validador puro em Dart + `dart:io` (`FileRehearsalByteSource` com `RandomAccessFile` em fatias `<= 64 KiB` + `RawZLibFilter.inflateFilter(raw: true)` em fatias de `4 KiB` para `manifest.json`), `RehearsalCancellationToken`, SHA-256/CRC-32 incrementais e proteção explícita contra overflow/wraparound de inteiros 64 bits assinados. Suporte em hardware Android/iOS permanece `NOT_EXECUTED` nesta T7 (testado na Dart VM via `flutter test`).

### Validação final, paridade e revisão independente de segurança

- **Testes Web (`web/`):** `npm test -- --run src/audio/rehearsal-package-validator.test.ts src/audio/local-audio-transport.test.ts src/audio/LocalAudioTransportHarness.test.tsx --testTimeout=15000` -> **PASS** (3 arquivos, **70/70 testes PASS**: 53 da T7 incluindo streaming `>100 MiB`, ZIP64, bombas DEFLATE, Zip Slip, colisões Unicode/case, cancelamento, memória/espaço e ausência de rede, + 17 de regressão T6/M21); `npx tsc --noEmit` -> **PASS** (exit 0); `npm run build -- --mode test` -> **PASS** (exit 0, 1590 módulos).
- **Testes Flutter/Dart (`mobile/`):** `dart analyze lib/core/audio/rehearsal_package_validator.dart test/support/rehearsal_package_corpus.dart test/core/audio/rehearsal_package_validator_test.dart` -> **PASS** (`No issues found!`); `flutter test --no-pub test/core/audio/rehearsal_package_validator_test.dart --timeout 30s` -> **PASS** (**51/51 testes PASS**, incluindo `FileRehearsalByteSource` em arquivo temporário, `HttpOverrides` sem rede, `MEMORY_BUDGET_EXCEEDED`, overflow ZIP64, short-reads e todas as 44 receitas do corpus).
- **Paridade diferencial direta TS vs Dart:** comparação estrutural JSON completa sobre 50 pacotes ZIP reais (44 receitas do corpus + 6 probes de borda: `formatVersion=0`, `aac_lc`, `original` WAV mono, Ogg EOS `-1`, `practice.bpm=500`, `availableStorageBytes=-1`) -> **PASS** (`Compared 50 cross-runtime packages. Diffs: 0`).
- **Revisão independente read-only de segurança (`feature-reviewer`):** primeira rodada identificou `2 HIGH` (`HIGH-1` LFH ZIP64 extra field em Dart; `HIGH-2` overflow/wraparound em `_u64le`/`_u64be` e `_inspectM4a` em Dart), `4 MEDIUM` (`MEDIUM-1` `perStem` negativo em TS; `MEDIUM-2` WAV `bitsPerSample`/extensible `0xFFFE` em TS; `MEDIUM-3` fatias de `4 KiB` no DEFLATE em Dart; `MEDIUM-4` short-read/cancelamento em `readBounded` curto em Dart) e `1 LOW` (caminhos duplicados no manifesto, reserva de espaço `includeSourceCopy`, case-insensitivity de codec e tracking de memória). Todos os achados foram corrigidos com testes de regressão dedicados, e a re-auditoria independente confirmou **PASS** (`0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW`), registrando apenas duas notas `INFO` não bloqueantes sem risco de segurança: (`INFO-1`) entrada não-objeto em `alignment.perStem[id]` retorna `INVALID_MANIFEST_JSON` em TS e usa o trim padrão em Dart; (`INFO-2`) `canonicalizeRehearsalPath` em Dart normaliza Unicode latino `U+00C0..U+017F` + marcas combinantes `U+0300..U+036F`, enquanto TS usa `normalize('NFC')` completo.

**Gate T7:** **PASS** local dentro de `.worktrees/louvaio-audit-remediation`; checkpoint T7 autorizado exclusivamente para os 12 arquivos revisados, sem início da T8.

---

## Execução incremental — T8 (2026-11-17)

Base/HEAD de partida: `890d8bf78e6155879a49603422b3a3a7bd22b638` (`T7` publicada em `fix/louvaio-audit-remediation-20261113`), worktree `.worktrees/louvaio-audit-remediation`. Nenhuma dependência nova foi adicionada em `pubspec.yaml`, `build.gradle.kts` ou `package.json`; nenhuma permissão ampla de armazenamento (`MANAGE_EXTERNAL_STORAGE`, `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_AUDIO`) foi solicitada; backend, Firestore, `web/`, `shared/`, M21 (`mobile/lib/features/vocal/`), transporte T6, `SongVersion`, mixer e T9–T12 permaneceram intocados.

### Fase A — Fechamento adversarial de INFO-1 e INFO-2 do validador T7

- **Alinhamento `perStem` (`INFO-1`):** `_validateManifestMap` em [rehearsal_package_validator.dart](../../../mobile/lib/core/audio/rehearsal_package_validator.dart) agora exige `Map<String, dynamic>` em `alignment.perStem` e `perStem[id]`, rejeita IDs/chaves desconhecidas com `INVALID_MANIFEST_JSON` e rejeita `initialTrimFrames`/`trailingTrimFrames` não inteiros, negativos ou `null` explícito com `TIMELINE_MISMATCH` (`incomplete`), alinhado 100% à Web TS.
- **Canonicalização Unicode (`INFO-2`) e extrator limitado:** `canonicalizeRehearsalPath` foi ampliada para Latin Extended-B, Greek/Greek-Ext, Cyrillic, Latin Extended Additional, decomposição algorítmica Hangul NFD e reordenação CCC em 5 blocos combinantes, além da adição de `validateAndExtractRehearsalPackage` (extração streaming em fatias `<= 64 KiB` somente após `readyForPublication == true`, com verificação contínua de CRC-32/SHA-256 e propagação limpa de `FileSystemException`).
- **Isolamento estrito de destino e prova comparativa Unicode (`Missão 2`):** [rehearsal_package_manager.dart](../../../mobile/lib/features/rehearsal_packages/data/rehearsal_package_manager.dart) nunca usa nomes/caminhos do ZIP na criação de arquivos locais (`resolveInternalFileName` mapeia exclusivamente para `manifest.json`, `stem_<id>.<ext>`, `original.<ext>` e `package.louvaio-rehearsal.zip`). Comparação Web TS (`normalize('NFC').toLowerCase()`) vs Dart (`canonicalizeRehearsalPath`) confirma que: (a) resolução manifesto->ZIP usa igualdade literal UTF-8 exata em ambos (`resolvedEntries[stem.path]` / `zipEntriesByPath.get`), rejeitando divergência NFC/NFD (`\u304C` vs `\u304B\u3099`) fail-closed com `MISSING_REQUIRED_STEM`; (b) em scripts fora dos blocos Unicode cobertos (`\u304C.wav` vs `\u304B\u3099.wav`) ou homógrafos cross-script (`v\u0430cals.wav` Cirílico vs `vocals.wav` Latino), a atribuição por `(role, stemId, container)` em `resolveInternalFileName` impede qualquer colisão, sobrescrita ou perda de integridade no Android (`rehearsal_package_manager_test.dart`, 2 testes dedicados). Mantida a restrição explícita como nota informativa sem alterar o contrato T7.

### Fase B–G — Ponte SAF Android, pipeline transacional, isolamento de conta e UI

- **Android SAF (`mobile/android/`):** [RehearsalPackageSafHandler.kt](../../../mobile/android/app/src/main/kotlin/com/louvaio/louvaio_mobile/audio/RehearsalPackageSafHandler.kt) integrado à [MainActivity.kt](../../../mobile/android/app/src/main/kotlin/com/louvaio/louvaio_mobile/MainActivity.kt) no canal `com.louvaio.mobile/rehearsal_package_saf` (`ACTION_OPEN_DOCUMENT` e `ACTION_CREATE_DOCUMENT`, streaming incremental em chunks de `64 KiB` via `ContentResolver` + `CancellationSignal`, `StatFs`, contenção canônica `isInsideFilesDir`, tratamento de cancelamento/permissão/arquivo movido/leitura interrompida/tamanho falsificado/`ENOSPC`).
- **Gerenciador local (`mobile/lib/features/rehearsal_packages/`):** [rehearsal_package_models.dart](../../../mobile/lib/features/rehearsal_packages/domain/rehearsal_package_models.dart), [rehearsal_package_saf_channel.dart](../../../mobile/lib/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart) e [rehearsal_package_manager.dart](../../../mobile/lib/features/rehearsal_packages/data/rehearsal_package_manager.dart) implementam `Seleção → Preflight → Staging → Validação T7 → Publicação local → Indexação`, reserva `max(256 MiB, 10% do pico)`, gate pós-validação antes da extração, `idempotent_noop`, resolução explícita de conflito com backup `.backup.part` e restauração pós-falha/crash, recuperação de `staging/*` na inicialização/carregamento, revalidação SHA-256 em disco, exportação SAF apenas quando íntegro, renomeação de rótulo local e exclusão com confirmação explícita de escopo.
- **Isolamento por conta e UI:** namespace SHA-256 por usuário (`louvaio-rehearsal-ns-v1:<userId>`) independente de `ministryId`; [providers.dart](../../../mobile/lib/app/providers.dart) (`resetAuthenticatedFeatures`) cancela tokens/SAF, fecha fontes abertas e limpa estado em memória ao sair/trocar conta sem apagar arquivos persistidos; [app_router.dart](../../../mobile/lib/app/router/app_router.dart) (`/rehearsal-packages`) e [app_shell.dart](../../../mobile/lib/app/shell/app_shell.dart) expõem [rehearsal_packages_screen.dart](../../../mobile/lib/features/rehearsal_packages/presentation/views/rehearsal_packages_screen.dart) e [rehearsal_package_controller.dart](../../../mobile/lib/features/rehearsal_packages/presentation/controllers/rehearsal_package_controller.dart) com aviso de backup/desinstalação, progresso em bytes, 4 stems + original, localização interna privada e status informativo `Vínculo local: Não associado`.

### Fase H–I — Validações, dispositivo físico `HND29KG9`, auditoria independente e checkpoint

- **Dart/Flutter:** `dart analyze lib/core/audio lib/features/rehearsal_packages lib/app test/core/audio test/features/rehearsal_packages` -> **PASS** (`No issues found!`); `flutter test --no-pub test/core/audio/rehearsal_package_validator_test.dart test/features/rehearsal_packages/rehearsal_package_manager_test.dart test/features/rehearsal_packages/rehearsal_packages_screen_test.dart test/app/` -> **PASS** (**120/120 testes PASS**, sendo 56 em `rehearsal_package_validator_test.dart`, 25 em `rehearsal_package_manager_test.dart`, 13 em `rehearsal_packages_screen_test.dart` e 26 em `test/app/`).
- **Android / Gradle JVM & APK final:** `flutter build apk --flavor vocal --debug` recompilado sobre o código final (incluindo extração `internal fun isInsideFilesDir`) -> **PASS** (`app-vocal-debug.apk`); `gradle.bat testVocalDebugUnitTest :app:processVocalDebugMainManifest` -> **PASS** (`BUILD SUCCESSFUL`, **29/29** testes JVM Android incluindo **6/6** em [RehearsalPackageSafHandlerTest.kt](../../../mobile/android/app/src/test/kotlin/com/louvaio/louvaio_mobile/audio/RehearsalPackageSafHandlerTest.kt); manifestos mesclados sem permissões de mídia/armazenamento amplo).
- **Dispositivo físico `HND29KG9` (`Lenovo_TB_J616F`, Android 12):** exercício interativo real com `DocumentsUI` (`com.louvaio.app.preview`, pacotes sintéticos descartáveis) verificou: cancelamento real no picker `ACTION_OPEN_DOCUMENT` (`STEP1_CANCEL_OK`), rejeição fail-closed de pacote sintético inválido via `ContentResolver` (`STEP2_INVALID_OK`), e importação real de pacote sintético válido de 4 stems em modo avião ativo (`airplane_mode_on=1`) com extração e persistência de `manifest.json`, `package.louvaio-rehearsal.zip`, `stem_vocals.wav`, `stem_drums.wav`, `stem_bass.wav`, `stem_other.wav` e `index.json` (`integrityState: "verified"`) em `files/rehearsal_packages/`. Após interrupção de asserção de texto do harness e posterior bloqueio da tela (`showing=true`), exportação SAF interativa, reimportação idempotente, troca de conta e persistência pós-`force-stop` no aparelho permanecem `NOT_EXECUTED_INTERACTIVE`.
- **Revisão independente read-only (`feature-reviewer`):** primeira rodada registrou `2 MEDIUM`, `2 LOW` e `2 INFO`; após todas as correções, a re-auditoria independente confirmou **PASS** (`0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW`, `1 INFO` residual em `canonicalizeRehearsalPath`, comprovado seguro em `Missão 2`).

**Gate T8:** `CHECKPOINT_TECNICO_PASS` (`ANDROID_PRODUCTION_HOMOLOGATION_PENDING`); checkpoint autorizado para os 16 arquivos da T8 na branch `fix/louvaio-audit-remediation-20261113`.

---

## Execução incremental — T9 (2026-11-17)

Base/HEAD de partida: `c2efbbbd110ef8f6267b0ca9d4bc5a9fb05bfe8f` (`T8` publicada em `fix/louvaio-audit-remediation-20261113`), worktree `.worktrees/louvaio-audit-remediation`. Nenhuma dependência nova foi adicionada em `web/package.json`; `backend/`, `mobile/`, `shared/`, `firestore.rules`, `web/vite.config.ts`, `BottomNav.tsx`, `VocalExercisePlayer.tsx`, `SmartChordsWorkspace.tsx`, `SongDetail.tsx` e worktree principal permaneceram intocados; T10–T12 não foram iniciadas; a pendência `ANDROID_PRODUCTION_HOMOLOGATION_PENDING` da T8 permanece registrada sem declaração de resolução pela T9.

### Decisão de armazenamento Web e extração limitada

- **Armazenamento primário e fallback explícito:** adotado o Origin Private File System (`OPFS`, `navigator.storage.getDirectory()`) como armazenamento local privado gerenciado em navegador compatível, com fallback explícito em memória (`ephemeral-fallback`) e aviso persistente na UI quando o OPFS estiver indisponível ou restrito, sempre sem promessa de retenção permanente pelo navegador/OS. No fallback efêmero, o orçamento explícito mantém apenas `manifest.json <= 256 KiB` em memória, verifica CRC-32/SHA-256 em fatias `<= 64 KiB` (dentro do orçamento padrão `64 MiB`) descartando os bytes de áudio descomprimidos após verificação e retém somente metadados + referência `File`/`Blob`. Seleção e exportação suportam progressivamente `showOpenFilePicker` / `showSaveFilePicker`, `<input type="file">` e `<a download>` (`Blob`). Nenhum áudio, arquivo `.zip`, stem ou chunk é gravado em `IndexedDB`, `localStorage` ou Firestore, e nenhuma chamada de upload/endpoint de mídia é realizada.
- **Extrator T7 limitado em fluxo:** [rehearsal-package-validator.ts](../../../web/src/audio/rehearsal-package-validator.ts) agora exporta `validateAndExtractRehearsalPackage`, `RehearsalEntryWritableSink` e `ExtractValidatedRehearsalPackageOptions` (além de `onProgress` em `ValidateRehearsalPackageOptions`), executando validação prévia e extração incremental em fatias `<= 64 KiB` somente quando `readyForPublication === true`, com verificação contínua de cancelamento (`AbortSignal`) e propagação de `SinkIoError` (`QuotaExceededError`, disco cheio ou recusa de escrita).

### Pipeline seguro, isolamento por conta, roteamento e UI

- **Gerenciador com consistência lógica recuperável:** [rehearsal-package-library.ts](../../../web/src/audio/rehearsal-package-library.ts) implementa `Seleção → Preflight → Staging → Validação T7 → Publicação local → Indexação`, namespace SHA-256 por conta (`computeAccountNamespaceHash(userId)`), checagem prévia de quota (`navigator.storage.estimate()` com reserva `max(256 MiB, 10% do pico)`), nomes canônicos derivados exclusivamente de `(role, stemId, container)` via `resolveInternalFileName` e staging transacional em `staging/<txId>/`. Como as APIs OPFS do navegador não garantem `rename` atômico estilo POSIX nem `fsync` físico em hardware, a publicação oferece **consistência lógica recuperável** por ordenação de escrita (`staging/<txId>/` → arquivos em `packages/<id>/` → `commit.json` → `index.tmp.json` → `index.json`, com `.backup` em substituições de conflito), além de recuperação/reconciliação em `loadLibrary`, revalidação integral SHA-256, renomeação local de rótulo, exportação/reimportação de backup, exclusão restrita à cópia gerenciada com confirmação explícita de escopo (`confirmedScope: true`) e encerramento cooperativo de operações/sessão em `invalidateSession()`.
- **Integração e UI LouvAIO:** [routing.ts](../../../web/src/routing.ts) (`/pacotes-ensaio`, preservando `MODULE_PATHS`), [MinistryView.tsx](../../../web/src/components/MinistryView.tsx) (acesso discreto abaixo de `Exercícios vocais`), [App.tsx](../../../web/src/App.tsx) (navegação lateral, `invalidateActiveRehearsalLibrarySession()` no logout/expiração de sessão e guarda `isLocalOnlyRouteRef` em `loadSubscription` para não disparar requisições tardias em rotas locais) e [RehearsalPackageLibraryView.tsx](../../../web/src/components/RehearsalPackageLibraryView.tsx) (layout `320px+`, avisos explícitos de não retenção permanente no navegador e recomendação de backup, barra de progresso/cancelamento, resolução de conflitos, detalhes com 4 stems + original opcional, status informativo `Vínculo local: Não associado` e travas síncronas via `useRef` em ações assíncronas).

### Validações, comportamento offline, Playwright Chromium e auditoria independente

- **TypeScript e build Web (`web/`):** `npx tsc --noEmit` -> **PASS** (exit 0); `npm run build -- --mode test` -> **PASS** (`1593 modules transformed`, `PWA v1.3.0`, `precache 48 entries`).
- **Suíte Vitest completa (`web/`):** `npm test` -> **PASS** (**53 passed (53)** arquivos, **1198 passed (1198)** testes, `0` falhas; inclui `rehearsal-package-validator.test.ts` (57 testes), `rehearsal-package-library.test.ts` (15 testes), `RehearsalPackageLibraryView.test.tsx` (7 testes), `routing.test.ts`, `LiturgiesNavigation.test.tsx`, `App.auth.test.tsx` e `App.session-expiry.test.tsx`).
- **Playwright E2E Chromium real (`web/e2e/rehearsal-package-library.spec.ts`):** `npx playwright test e2e/rehearsal-package-library.spec.ts --project=390x844-dark --project=320x568-light` -> **PASS** (**12 passed**, 6 cenários em ambos os viewports) cobrindo OPFS real, fallback `ephemeral-fallback`, conflito/substituição, limpeza de `staging` órfão em reload, isolamento multi-conta, exclusão escopada, uso offline dentro da SPA já carregada com zero chamadas `/api/v1/`, e verificação explícita de que cold start offline em página nova sem Service Worker/precache para `/pacotes-ensaio` falha conforme a configuração vigente do PWA (`vite.config.ts` mantém `NetworkOnly` fora de `/exercicios-vocais`).
- **Revisão independente read-only (`feature-reviewer`):** primeira rodada apontou `1 HIGH`, `1 MEDIUM` e `2 LOW`; após as correções, a re-auditoria independente confirmou **PASS** (`0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW`, `1 INFO` apenas para o registro documental neste ExecPlan).

Status de homologação registrados no checkpoint T9:

- `OFFLINE_SPA = PASS`
- `OFFLINE_COLD_START = NOT_SUPPORTED / NOT_HOMOLOGATED`
- `ANDROID_PRODUCTION_HOMOLOGATION = PENDING`

**Gate T9:** **PASS** local dentro de `.worktrees/louvaio-audit-remediation`; checkpoint T9 autorizado exclusivamente para os 12 arquivos revisados na branch `fix/louvaio-audit-remediation-20261113`.

---

## Execução incremental — T10 (2026-11-17)

Base/HEAD de partida: `76cbacefcb8be0e39f3837314e4ec0754d0731d7` (`T9` publicada em `fix/louvaio-audit-remediation-20261113`), worktree `.worktrees/louvaio-audit-remediation`. Nenhuma dependência nova foi adicionada em `web/package.json`, `web/package-lock.json` ou `mobile/pubspec.yaml`; `backend/`, `firestore.rules`, `shared/`, `web/vite.config.ts`, `mobile/android/`, `mobile/lib/features/vocal/` (M21), worktree raiz e demais worktrees permaneceram intocados; T11–T12 não foram iniciadas; `ANDROID_PRODUCTION_HOMOLOGATION = PENDING` (T8) e `OFFLINE_COLD_START = NOT_SUPPORTED / NOT_HOMOLOGATED` (T9) permanecem preservados.

### Identidade canônica de `SongVersion` e vínculo local Web + Flutter

- **Resolução canônica e paridade TS/Dart:** implementada em [song-version-audio-binding.ts](../../../web/src/audio/song-version-audio-binding.ts) e [rehearsal_package_models.dart](../../../mobile/lib/features/rehearsal_packages/domain/rehearsal_package_models.dart) reutilizando o padrão canônico `SAFE_VERSION_ID_REGEX` de [smart_chord_version.ts](../../../backend/src/features/smart_chords/smart_chord_version.ts). Músicas legadas sem array `versions` sintetizam `<songId>_v1` (`isSynthetic: true`); alias legado `'v1'` é aceito **somente** nessa forma sintética única. Múltiplas versões sem `requestedVersionId` retornam `version_required` e IDs inexistentes retornam `version_not_found`, exigindo seleção explícita nas interfaces [SongDetail.tsx](../../../web/src/components/SongDetail.tsx) e [song_detail_view.dart](../../../mobile/lib/features/repertoire/presentation/views/song_detail_view.dart) sem fallback silencioso para índice `0`. Nomes repetidos com IDs distintos permanecem isolados por `canonicalVersionId`.
- **Política conservadora para versão removida/recriada:** como o backend `SongVersion` ([repertoire.types.ts](../../../backend/src/features/repertoire/repertoire.types.ts)) não possui UID/timestamp imutável de criação por versão além de `id` (limitação registrada sem alteração de backend), `reconcileSongVersionBindings` marca imediatamente como `version_removed` (`versionRemoved`) qualquer vínculo cujo `canonicalVersionId` desapareça ou altere `isSynthetic`, mantendo invalidação aderente (*sticky tombstone*) até que o usuário crie explicitamente novo vínculo.
- **Registro local isolado por `(accountNamespaceHash, ministryId, songId, canonicalVersionId)`:** persistido em `index.json` (Web OPFS + fallback efêmero em [rehearsal-package-library.ts](../../../web/src/audio/rehearsal-package-library.ts); Android em [rehearsal_package_manager.dart](../../../mobile/lib/features/rehearsal_packages/data/rehearsal_package_manager.dart)) sem criar catálogo paralelo ou chamadas HTTP novas. Criação de novo vínculo exige sessão autenticada, ministério válido, leitura da música verificada, pacote `verified` no mesmo namespace de conta e contexto online (`OFFLINE_BIND_FORBIDDEN` / `OFFLINE_BIND_DENIED`). Desvincular mantém o pacote pessoal; excluir o pacote mantém a música e invalida o vínculo como `package_missing` (`packageMissing`); substituição incompatível marca `package_replaced_incompatible`; corrupção marca `package_corrupted`.
- **Representação explícita de `assetId`:** pacotes com áudio `original` recebem `assetId = 'original'`; pacotes com somente quatro stems recebem `assetId = 'stems_bundle_v1'` e **não** são apresentados como mixagem reproduzível antes da T12 nem reproduzem stem isolado como gravação completa. Na Web, `resolveVerifiedBoundAsset` exige `assetId === 'original'`, `assetContainer === 'wav'` (homologação T6 no Chromium, falhando fechado com `unsupported_codec` para outros formatos) e valida hash SHA-256 ao vivo em fatias `<= 64 KiB` antes de entregar ao transporte.

### Sessão global Web, mini-player e limitação explícita no Android

- **Sessão única acima das rotas Web:** `GlobalRehearsalAudioSessionController` em [song-version-audio-binding.ts](../../../web/src/audio/song-version-audio-binding.ts) envolve uma única instância de `LocalAudioTransportController` com *generation fencing*, `AbortController` e revogação de Object URLs, montada acima das rotas em [App.tsx](../../../web/src/App.tsx) com o [GlobalRehearsalAudioMiniPlayer.tsx](../../../web/src/components/GlobalRehearsalAudioMiniPlayer.tsx). Suporta reprodução explícita, pausa, retomada, seek em frames, volume master e velocidade (`0.5×–1.5×`), preservando identidade real `(song, canonicalVersion, package)` ao navegar entre músicas, módulos (`/repertorio`, `/escalas`, `/ministerio`, `/pacotes-ensaio`) e sequências de escala (`slotIndex` em [routing.ts](../../../web/src/routing.ts) e [ScheduleDetailView.tsx](../../../web/src/components/ScheduleDetailView.tsx)) sem autoplay e sem disfarçar áudio antigo como se pertencesse à nova versão. Troca de ministério, logout ou expiração de sessão (`clearClientSession`) e remoção/substituição de pacote interrompem imediatamente a reprodução e limpam o estado em memória.
- **Flutter Android sem reprodução fictícia nem abuso de M21:** integrados [rehearsal_package_controller.dart](../../../mobile/lib/features/rehearsal_packages/presentation/controllers/rehearsal_package_controller.dart), [rehearsal_packages_screen.dart](../../../mobile/lib/features/rehearsal_packages/presentation/views/rehearsal_packages_screen.dart), [song_detail_view.dart](../../../mobile/lib/features/repertoire/presentation/views/song_detail_view.dart) e [providers.dart](../../../mobile/lib/app/providers.dart) (`resetAuthenticatedFeatures`) com vínculo completo por `SongVersion`. Verificado que `VocalAudioPlayer.kt` é um sintetizador PCM vocal exclusivo de M21 e `pubspec.yaml` não possui Media3/ExoPlayer nem plugin de mídia local; a reprodução nativa Android permanece explicitamente marcada como indisponível nesta etapa com proposta técnica de adaptador nativo dedicado sem alterar M21 nem instalar dependências sem autorização.

### Validações, regressões, Chromium E2E e auditoria independente

- **Web TypeScript, build e suíte Vitest completa (`web/`):** `npx tsc --noEmit` -> **PASS** (exit 0); `npm run build -- --mode test` -> **PASS** (`1596 modules transformed`, `PWA v1.3.0`, `precache 48 entries`); `npm test` completo (sem contenção) -> **PASS** (**55 passed (55)** arquivos, **1219 passed (1219)** testes, `0` falhas; inclui [song-version-audio-binding.test.ts](../../../web/src/audio/song-version-audio-binding.test.ts) (15), [SongDetail.rehearsal-binding.test.tsx](../../../web/src/components/SongDetail.rehearsal-binding.test.tsx) (6), [SongDetail.test.tsx](../../../web/src/components/SongDetail.test.tsx) (11), [ScheduleDetailView.test.tsx](../../../web/src/components/ScheduleDetailView.test.tsx) (5), [routing.test.ts](../../../web/src/routing.test.ts) (4), [rehearsal-package-validator.test.ts](../../../web/src/audio/rehearsal-package-validator.test.ts) (57), [rehearsal-package-library.test.ts](../../../web/src/audio/rehearsal-package-library.test.ts) (15), [local-audio-transport.test.ts](../../../web/src/audio/local-audio-transport.test.ts) (13), [LocalAudioTransportHarness.test.tsx](../../../web/src/audio/LocalAudioTransportHarness.test.tsx) (4), [VocalExercisePlayer.test.tsx](../../../web/src/components/VocalExercisePlayer.test.tsx) (7) e [VocalExercisePlayer.m21-final.test.tsx](../../../web/src/components/VocalExercisePlayer.m21-final.test.tsx) (16)).
- **Playwright E2E Chromium real (`web/`):** `npx playwright test e2e/song-version-audio-session.spec.ts e2e/rehearsal-package-library.spec.ts --project=390x844-dark --project=320x568-light` -> **PASS** (**14 passed**, 7 cenários em `320x568-light` e `390x844-dark`), incluindo importação OPFS real de WAV sintético, vínculo por `SongVersion`, reprodução real via `<audio>`, navegação entre módulos/sequência de escala com mini-player persistente, ausência de autoplay e encerramento imediato em troca de ministério/logout.
- **Flutter/Dart (`mobile/`):** `dart analyze lib/features/rehearsal_packages/ lib/features/repertoire/presentation/views/song_detail_view.dart lib/app/providers.dart test/features/rehearsal_packages/` -> **PASS** (`No issues found!`); `flutter test --no-pub test/core/audio/rehearsal_package_validator_test.dart test/features/rehearsal_packages/ test/features/repertoire/ test/features/schedules/ test/features/vocal/ test/app/` -> **PASS** (**498 passed (498)** testes em Dart VM, incluindo [song_version_binding_test.dart](../../../mobile/test/features/rehearsal_packages/song_version_binding_test.dart) e regressões T7/T8/M21). Testes físicos em aparelho Android não executados nesta T10.
- **Revisão independente read-only (`feature-reviewer`):** primeira rodada registrou `2 LOW` (`handleLoadBoundVersionAudio` erro tardio em `SongDetail.tsx` e paridade de `bindingState` inválido em `_syncPackageBindingStates` no Dart); após correção e adição dos testes dedicados, a re-auditoria independente confirmou **PASS** (`0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW`, `1 INFO` fechado por este registro).

**Gate T10:** **PASS** local dentro de `.worktrees/louvaio-audit-remediation` (alterações mantidas locais/não commitadas aguardando autorização de checkpoint; T11 não iniciada).

### Retomada Codex — remediação autorizada (2026-11-18)

O PASS acima é o registro histórico da implementação anterior, substituído pelo gate de transição Codex **FAIL**, com cinco MEDIUM: conclusão obsoleta interrompendo o transporte atual; perda da proveniência sintética nos adaptadores TS/Dart; IDs posicionais tratados como canônicos; mini-player ausente na rota vocal; concorrência Flutter entre vínculo, reconciliação e recovery do índice.

Autorização atual: reproduzir → regressão RED → correção mínima → GREEN → revisão independente → corrigir/repetir até zero achados abertos. Gate final inclui typecheck, suíte/build Web, Chromium real e análise/regressões Flutter pertinentes. Sem stage, commit, push, instalações ou T11; backend/Firestore/billing/M21 e outras worktrees preservados. Arquivos adicionais de adaptadores e testes dentro do domínio T10 são permitidos e serão discriminados.

| Frente | Escritor e posse | Coordenação |
| --- | --- | --- |
| Identidade TS/Dart (achados 2/3) | `/root/identity_fix`: adaptadores/tipos, resolução canônica e regressões de identidade | Transfere `song-version-audio-binding.ts` e seu teste ao executor do transporte após conclusão; não toca manager/controller Flutter |
| Persistência Flutter (achado 5) | `/root/flutter_persistence_fix`: manager, controller e teste dedicado de concorrência | Consome contratos de domínio; não edita modelos nem testes de identidade |
| Interface Web (achado 4) | `/root/web_ui_fix`: `App.tsx` e E2E de sessão | Sem editar M21; apenas testes próprios durante implementação |
| Transporte (achado 1) | Executor dedicado após transferência dos dois arquivos TS | Evita escritores concorrentes com identidade |
| Integração/documentação/gates | Codex principal | Revisores separados, somente leitura; resultados globais consolidados pelo principal |

**Iteração 1 — em execução:** base/HEAD `76cbacefcb8be0e39f3837314e4ec0754d0731d7`, branch e 20 caminhos originais conferidos (14 modificados, seis novos); índice vazio. Snapshot dos 20 arquivos preservado em temporário antes das correções. Nenhuma dependência adicionada. Evidências RED/GREEN e resultados de cada ciclo serão registrados nesta seção; não inferir PASS enquanto o gate final estiver pendente.

- Identidade: regressões RED pelos adaptadores reais `api.getSongById` e `SongDetail.fromJson`; GREEN Web API + vínculo (54 testes), API final (39), Dart identidade/manager (23). Proveniência sintética local (Symbol não serializável em TS; propriedade de domínio não lida de JSON no Dart), sem IDs fabricados por posição; IDs explícitos reais `v_1` continuam válidos. IDs duplicados são ambíguos e bloqueados; expectativa antiga que escolhia o primeiro foi substituída por verificação fail-closed, acompanhada do RED de ambiguidade. Transição sintética→explícita com ID reutilizado invalida o vínculo; tombstone observado permanece aderente.
- Persistência: RED determinístico `bind → pausa pré-commit → reconcile/load → liberar` confirmou `BIND_FAILED / 0 vínculos / busy=true`. GREEN com fila por conta, geração/token capturados antes de enfileirar e finalização por identidade de mutação: 12 regressões novas + 25 testes do manager, 37 PASS. Teste antigo que chamava `loadLibrary` recursivamente de dentro do próprio picker passou a coordenar duas operações externas; reentrada pública é rejeitada prontamente com regressão própria. Rename do índice é ponto de linearização síncrono: cancelamento anterior aborta; cancelamento posterior preserva o commit efetivado.
- Interface: Chromium real confirmou RED na rota vocal (esperada uma instância do mini-player, encontradas zero); `App` agora inclui a sessão existente nessa saída, sem modificar M21. Teste permanente verifica playback nativo, acessibilidade dos controles, instância única, retorno e logout.
- Novo achado 6 (MEDIUM): Chromium também demonstrou autoplay ao clicar **Carregar áudio**, antes de alcançar a rota vocal. Removido `autoPlayAfterLoad: true` de `SongDetail`; teste real mantém a exigência de estado pronto e zero chamadas de play até gesto explícito. Testes de componente agora exigem carregar sem autoplay e reproduzir separadamente: seis PASS. O comportamento antigo de autoplay não foi mantido como expectativa.
- Transporte: posse dos dois arquivos TS transferida de `/root/identity_fix` para `/root/web_transport_fix`; testes de corrida e correção em execução. Revisões independentes direcionadas de identidade e persistência em andamento. Gates globais e revisão final ainda pendentes.

Logs RED/GREEN e relatórios dos executores estão no temporário `louvaio-t10-remediation-292a1ebc174b4bbd915daefd6e9579df`; somente áudio sintético de fixtures. Hot reload: **NOT_EXECUTED**, descoberta DTD não encontrou app/processo de debug ativo; não iniciar app autenticado nem alegar homologação física por isso.

**Iteração 2 — integração e regressão:** transporte corrigido removendo somente o `stop()` global da conclusão obsoleta; cinco regressões permanentes de conclusão/falha tardia, ministérios, logout e dispose. RED final: três corridas falharam por destruir a geração atual; GREEN: 34 testes (21 vínculo/sessão + 13 transporte). O probe original independente agora mantém `B=playing`, `loadedSong=B`, uma URL ativa antes/depois da conclusão obsoleta de A (exit 0). Revisões direcionadas independentes `/root/independent_gate` (identidade TS/Dart) e `/root/flutter_review` (persistência) retornaram requisitos/qualidade PASS, zero achados novos; não substituem a revisão final.

- Web integrada: `npm test -- --testTimeout=15000 --hookTimeout=15000` → **PASS, 55 arquivos / 1230 testes**, exit 0 (`final-web-tests.log`). Inclui SongDetail, escalas, API, T6/T7/T9, sessão global e M21.
- Flutter integrada: `flutter test --no-pub test/core/audio/rehearsal_package_validator_test.dart test/features/rehearsal_packages/ test/features/repertoire/ test/features/schedules/ test/features/vocal/ test/app/ test/features/auth/domain/ test/features/auth/presentation/controllers/ test/features/auth/data/auth_session_race_test.dart test/features/auth/data/auth_repository_test.dart --timeout 30s --reporter expanded` → **PASS, 582 testes**, exit 0 (`final-flutter-tests.log`); testes browser dependentes de emuladores externos não são parte desta bateria.
- `dart analyze` no projeto mobile inteiro → **PASS, No issues found**, exit 0 (`final-dart-analyze-clean.log`). A primeira análise tinha somente quatro sugestões `const` em duas fixtures novas; corrigidas mecanicamente e o teste de transição sintética→explícita reexecutado: PASS (`final-dart-const-regression.log`). Nenhuma correção de comportamento foi necessária nessa integração além do autoplay já registrado.
- Typecheck `npx --no-install tsc --noEmit` → **PASS**, exit 0; `npm run build -- --mode test` → **PASS**, exit 0, PWA com 48 entradas (`final-web-typecheck.log`, `final-web-build.log`). Aviso de tamanho de chunk do build permanece informativo, sem dependência ou configuração alterada.
- Chromium real sobre o build integrado: `npx --no-install playwright test e2e/song-version-audio-session.spec.ts e2e/rehearsal-package-library.spec.ts --project=390x844-dark --project=320x568-light --reporter=list --output=<temporário>/final-playwright-artifacts --timeout=90000 --global-timeout=420000` → **PASS, 16 testes / 2,0 min**, exit 0 (`final-playwright.log`). Confirma play nativo, avanço do seek, pausa/retomada, instância única na rota vocal, retorno ao repertório, zero autoplay e liberação de recursos no logout, além dos fluxos T9.
- Fontes de produto congeladas por SHA-256 antes dos gates e conferidas inalteradas depois.

### Retomada Antigravity (Argon + Hydrogen + `feature-reviewer`) — Fechamento T10 (2026-11-18)

- **Recuperação integral do trabalho Codex:** preservadas integralmente todas as correções das iterações 1 e 2 (achados 1–5 + achado 6) nos 26 arquivos locais de `.worktrees/louvaio-audit-remediation` (`fix/louvaio-audit-remediation-20261113`, base `76cbacefcb8be0e39f3837314e4ec0754d0731d7`).
- **Auditoria independente inicial (`feature-reviewer`):** confirmou aprovação dos achados 1–6 (`0 BLOCKER, 0 HIGH, 0 MEDIUM`), apontando `3 LOW` (`SongDetail.tsx`: estado habilitado no-op em aba sem ID e fallback `songReadVerified ?? Boolean(...)`; `GlobalRehearsalAudioMiniPlayer.tsx`: `minHeight: '28px'` nos sliders; `rehearsal_package_manager.dart`: `unawaited(source.close())` potencialmente concorrente com `tearDown` no Windows).
- **Iteração 3 — remediação dos 3 achados `LOW` (Hydrogen / `feature-engineer`):**
  1. `web/src/components/SongDetail.tsx`: `isVersionAmbiguousOrMissing` derivado diretamente de `resolvedCanonicalVersion === null` e `songReadVerified: songReadVerified === true` (fail-closed), com 2 testes de regressão em `web/src/components/SongDetail.rehearsal-binding.test.tsx`.
  2. `web/src/components/GlobalRehearsalAudioMiniPlayer.tsx`: `minHeight: '44px'` aplicado em `mini-player-seek` e `mini-player-volume`.
  3. `mobile/lib/features/rehearsal_packages/data/rehearsal_package_manager.dart`: `_openByteSources` convertido para `Map<FileRehearsalByteSource, Future<void>?>` com `_closeSourceOnce()` compartilhado entre `invalidateSession()` e `_closeAndUntrackSource()`, garantindo aguardo determinístico do fechamento do handle.
- **Reauditoria independente final (`feature-reviewer`):** **PASS** (`0 BLOCKER, 0 HIGH, 0 MEDIUM, 0 LOW`, `1 INFO` fechado pelos gates finais abaixo).
- **Gate final sequencial após todas as edições de código:**
  - `web/`: `npx --no-install tsc --noEmit` → **PASS** (exit 0); `npm run build -- --mode test` → **PASS** (`1598 modules transformed`, `PWA v1.3.0`, `precache 48 entries`); `npm test -- --run --testTimeout=15000 --hookTimeout=15000` → **PASS** (**55 arquivos / 1232 testes**); Playwright Chromium real (`e2e/song-version-audio-session.spec.ts` + `e2e/rehearsal-package-library.spec.ts` em `320x568-light` e `390x844-dark`) → **PASS** (**16 passed**, 1.7m).
  - `mobile/`: `dart analyze` → **PASS** (`No issues found!`); `flutter test --no-pub test/core/audio/rehearsal_package_validator_test.dart test/features/rehearsal_packages/ test/features/repertoire/ test/features/schedules/ test/features/vocal/ test/app/ test/features/auth/domain/ test/features/auth/presentation/controllers/ test/features/auth/data/auth_session_race_test.dart test/features/auth/data/auth_repository_test.dart --timeout 30s` → **PASS** (**582 passed**).
  - `ANDROID_PRODUCTION_HOMOLOGATION = PENDING` (reprodução musical nativa Android ainda não implementada; testes físicos pendentes da T8 continuam pendentes); `OFFLINE_COLD_START = NOT_SUPPORTED / NOT_HOMOLOGATED`.

**Gate T10:** **PASS** local dentro de `.worktrees/louvaio-audit-remediation` (pronto para autorização de checkpoint; sem stage, commit ou push; T11 não iniciada).

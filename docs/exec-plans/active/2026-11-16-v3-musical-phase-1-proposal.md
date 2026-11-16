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

- [ ] Comparar listas e registrar divergências antes de alterar resultados.
- [ ] Criar casos estruturados e fazer TS/Dart lerem o mesmo artefato, incluindo inválidos, Unicode, slash bass, acidentes e transposição negativa.
- [ ] Rodar testes direcionados de paridade, confirmar igualdade e revisão independente das expectativas musicais.

Aceite: nenhuma lista manual divergente; C/E +M2 = D/F#, desconhecido preservado e caso de grafia diatônica versus cromática explícito. Não exige Tonal instalado.

### T2 — Núcleo puro de notas/intervalos e adaptação de transposição

Arquivos propostos: `web/src/music/theory.ts`, `mobile/lib/core/music/theory.dart`, testes adjacentes; adaptar somente funções de transposição dos parsers existentes citados na auditoria.

Consome T1 revisada (G2); produz `parseChord`, `transpose`, `spellPitch` e `chordTones`, com Unsupported e política legada. Sem I/O.

- [ ] Criar testes falhando para intervalos/grafias, preservação de layout e `chordTones` de C, Cm e C7.
- [ ] Implementar o mínimo, manter wrappers existentes e comparar corpus completo TS/Dart.
- [ ] Rodar testes de parsers/renderização afetados; revisar diff de comportamento, sem reformatar cifras salvas.

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

- [ ] Fixar conjunto inicial, afinação padrão e licença/proveniência de cada forma.
- [ ] Testar cordas/trastes/notas, pestanas e baixo; revisão por músico de ergonomia.
- [ ] Renderizar aberto/abafado/texto acessível; sem diagrama arbitrário para acorde não coberto.

Aceite: todas as formas verificadas, sem geração combinatória ou ampliação de catálogo sem revisão.

### T5 — Inversões e graus contextuais

Consome T2; amplia os mesmos núcleos/testes, não schemas de tom.

- [ ] Fixar maior/menor e casos de baixo não pertencente ao acorde.
- [ ] Implementar `analyzeDegree`/voicing com indeterminate e explicação; testar C/E, C/F#, C em C maior e tom ausente.
- [ ] Expor leitura opcional no painel e testar sem alterações de texto ou inferência automática de tonalidade.

Aceite: inversão versus slash bass distinguíveis; empréstimo/dominante secundária só em tarefa posterior com corpus dedicado.

### T6 — Spike do transporte de uma gravação local

Pré-requisitos G1/G3; independente de T3–T5 e da separação. Áreas futuras: `web/src/audio/`, `mobile/lib/features/repertoire/` e canais nativos relevantes, sem editar backend. Arquivos exatos/adaptador dependem do spike, não pressupor nova biblioteca.

- [ ] Testar arquivo sintético/fixture autorizado curto, play/pause/seek/volume e persistência durante navegação.
- [ ] Avaliar relógio/decoder, orçamento de RAM, interrupções/background separadamente; medir velocidade com pitch preservado.
- [ ] Decidir adaptador com evidência, mantendo M21 funcional; não integrar mixer ainda.

Aceite: contrato de transporte do ADR comprovado no alvo escolhido; proposta específica de dependência, se necessária, revisada antes de instalação no produto.

### T7 — Pacote v1 e validador local

Consome ADR Local First; independente de modelos. Arquivos propostos: `shared/fixtures/rehearsal-package-v1/` (manifestos e expectativas pequenos, sem áudio real), validadores dedicados em `web/src/audio/` e domínio local Flutter. Não criar JSON schema backend.

- [ ] Fixar campos/limites v1, fixtures válidas e adversariais; manifesto major futuro, zip-slip, duplicatas, bombas, hash e stem ausente.
- [ ] Implementar validação incremental e orçamento de bytes; índice só metadados.
- [ ] Testar idempotência/conflito, nenhum acesso à rede ou arquivo externo.

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
- [ ] Implementação autorizada (pendente; não executar nesta tarefa).

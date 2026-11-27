# M21.2 — homologacao real (2026-11-06)

Workspace: `../worktrees/m21-vocal`, branch `feat/m21-vocal`, HEAD `29d09f1b2cf1d94aa8f5e84d77f906a6a88ae6f8`. Flutter certificado de origem `11b57976b56130d79ecbe032f8b442358fc8f796`. Nenhuma release certificada alterada.

## Evidencia Web real
Chromium headed 151.0.7922.34, AudioContext real 48 kHz. Captura paralela AudioWorklet preserva destino normal do navegador. `web-native-context.json` confirma caminho sem alterar construtor: nenhum contexto antes do clique, contexto realtime running apos interacao, indicador MIDI48, suspensao e retomada reais.

- 3 exercicios (escala maior, arpejo maior, arpejo menor), BPM40/80/120/180:12casos,36 primeiras notas analisadas. Frequencias medidas por FFT Hann interpolada: erro observado <1cent. Nao implica precisao acustica do alto-falante.
- Intervalos observados: desvio maximo5ms. Detector RMS tem resolucao5ms;6casos tiveram128-256frames omitidos na captura (ate5,33ms a48kHz). Analise concatena esses blocos: registrar incerteza adicional, sem afirmar captura perfeita/latencia acustica.
- Duas progressoes completas de arpejo em180BPM:14notas cada, passos de semitom ascendentes/descendentes corretos; erro relativo observado <=1,67ms e afinacao <1cent no sinal capturado.
- Pico das12capturas <0,20FS; zero amostras clipadas nesses trechos. Metronomo ligado adiciona banda do acento1200Hz: fracao de energia0,02576 vs0,000236 no piano isolado (primeiros0,4s comparaveis). Combinacao de clique e piano funciona; acordes/pedal/polifonia de exercicios nao fazem parte deste modelo sequencial.
- Pause congela relogio de audio (delta0); Retomar avanca0,339s; Stop deixou12800frames de silencio digital. Reinicio, faixa invalida e indicador da nota verificados. Sem pageerror nos casos. Console de deprecacao do capturador ScriptProcessor motivou substituicao por Worklet; primeira captura foi descartada e sobrescrita.
- Web offline: shell carregado online, pagina fechada, rede do contexto desativada, pagina nova reaberta, outro exercicio selecionado e PCM nao zero. Service worker controlador ativo; fetch sem cache falhou. Chromium manteve navigator.onLine=true sob emulacao: evidencia e bloqueio de rede do contexto, nao desligamento fisico do adaptador do computador.

Artefatos locais em `evidence/m21-2/`: WAVs reais, screenshots, JSONs, analises Python. Scripts reproduziveis `web/scripts/m21-*.mjs`. Validador `node scripts/m21-validate-web-evidence.mjs`: PASS_TECHNICAL_WEB_EVIDENCE. Evidencia antes do DAC; audição humana e timbre agradavel: **Unknown / Not yet verified**.

## Correcoes Web e testes
Adicionados pausa/retomada e indicador da nota pelo relogio AudioContext; conclusao segue tempo de audio em vez de timer de parede. Teste de suspend/stop/restart e unmount durante resume pendente. `npm run test -- --run src/components/VocalExercisePlayer.test.tsx src/routing.test.ts`: PASS10/10. `npm run build -- --mode test`: PASS, PWA34entradas ~2166KiB; warnings existentes de chunks/imports. Nenhum deploy.

## Android fisico: bloqueio de build
Tablet ADB conectado: Lenovo TB-J616F / HND29KG9, ABIarm64-v8a. Pacotes existentes production `com.louvaio.app` e staging `com.louvaio.app.staging` verificados sem alteracao. Novo flavor local `vocal`, applicationId exclusivo `com.louvaio.app.m21vocal`, entrada `main_vocal.dart` sem bootstrap Firebase. Nenhum APK instalado.

Comando `flutter build apk --debug --flavor vocal -t lib/main_vocal.dart --no-pub`: BLOCKED/ABORTED por disco. Iniciou com~4,63GB; interrompido quando livre~1,82GB, antes do piso1,5GB. Sem assemble concluido. Espaco recuperado apos aborto~3,56GB. Sem limpeza global. Nao repetir build emC sem margem comprovada; nenhuma outra unidade local adequada confirmada. ARM64 isolado pode reduzir Flutter mas nao garante reduzir intermediarios Gradle suficientes.

Motor Android PCM22,05kHz, AudioTrack MODE_STATIC, amplitude limitada e pausas entre frases; reproducao REAL no dispositivo, ANRs/crashes da nova versao, offline fisico, latencia, afinacao e timbre Android permanecem NOT_EXECUTED. Nao confundir compilacao parcial ou mocks MethodChannel com homologacao.

Correcoes Android em finalizacao/revisao: remocao de callbacks de release ao parar/substituir; pausa/retomada; indicador atual; preservacao de prazo restante durante pausa; bloquear pausa antes de admissao do PCM; release suave no fim das notas. Atualizar estado final abaixo.

## Gate humano e continuidade
Solicitada audicao simples: abrir http://127.0.0.1:4173/exercicios-vocais, Arpejo maior, BPM80, ouvir10s e relatar piano agradavel/estalos/distorcao. Resposta ainda pendente. Preview local mantido disponivel; nenhum acesso a credenciais, Firebase/Vercel remoto, push, merge ou publicacao.

M21.2 NAO APROVADO INTEGRALMENTE: faltam build/install/validacao fisica Android e avaliacao auditiva. Sem editor, rotinas, favoritos ou MIDI novo. Proximo passo: margem de disco local adequada para candidato debug isolado, depois validacao fisica e audicao comparativa.

## Fechamento desta execucao
- Revisao independente `/root/m212_review`: achados MEDIUM de pausa e LOW de callbacks/tail resolvidos por inspecao do snapshot final. Nenhum bloqueante de codigo confirmado no escopo. Isto nao certifica Kotlin compilado nem execucao Android.
- Flutter final: root `flutter test --no-pub test/features/vocal/vocal_player_test.dart --timeout 45s`: PASS4/4, exit0. Inclui atraso do retorno MethodChannel, pausa desabilitada antes da admissao, retomada/nota/stop. Mock so valida contrato/estado; nao audio nativo. Implementador `flutter analyze lib/features/vocal test/features/vocal`: PASS sem issues. Web final10/10PASS; buildPASS; validador de evidencia realPASS. Console.error no caminho sem instrumentar AudioContext: zero.
- Original final:674entradas WIP, zero divergencias SHA256; AGENTS.md/backend intocados. `git diff --check`:PASS. Espaco final3.562.262.528bytes (~3,56GB decimais). Nenhum APK instalado, nenhuma alteracao remota/commit/push/merge/deploy.
- Servidor de desenvolvimento4181 encerrado; preview4173 mantido para audicao do proprietario. Scripts de captura usam navegador com janela real e geram apenas evidencias locais (~4,6MB), nao assets de produto.
- Audicao solicitada pela ferramenta de pergunta: resposta ainda pendente. Nenhuma aprovacao humana inferida por ausencia de resposta.

```text
M21_2_STATUS = PARCIAL; NAO HOMOLOGADO INTEGRALMENTE
WEB_AUDIO_REAL = PASS TECNICO: PCM real e contexto realtime
ANDROID_BUILD = BLOCKED: aborto seguro por disco
ANDROID_INSTALL = NOT_EXECUTED; nenhum APK concluido
ANDROID_AUDIO_REAL = NOT_EXECUTED
PIANO_QUALITY_TECHNICAL = Web: pitch/ritmo/clipping medidos; Android pendente
PIANO_QUALITY_LISTENING = Unknown / Not yet verified
MIDI_PITCH_ACCURACY = Web: <1cent nos trechos medidos; Android pendente
TIMING_ACCURACY = Web: desvio observado<=5ms; incerteza captura adicional<=5,33ms
BPM = Web40/80/120/180 medidos; Android fisico pendente
METRONOME = Web ligado/desligado confirmado no sinal; Android fisico pendente
TRANSPOSITION = Web duas progressoes completas medidas; Android fisico pendente
PLAY_PAUSE_STOP = Web verificado; Flutter codigo/testes PASS, aparelho pendente
OFFLINE_WEB = PASS sob emulacao de rede bloqueada e reabertura; adaptador OS nao desligado
OFFLINE_ANDROID = NOT_EXECUTED
ANDROID_CALLBACK_LOW = Corrigido e revisado no codigo; runtime pendente
CRASHES = Web sem pageerror/console.error no caminho normal; Android nova versao NOT_EXECUTED
TESTS = Web10/10PASS; buildPASS; evidenciaPCM PASS; Flutter4/4PASS; analyzePASS; diffcheckPASS
WIP_INTEGRITY = 674 entradas preservadas; zero divergencias SHA256
DISK_FREE = 3,56GB
BLOCKERS = APK Android sem espaco seguro comprovado; audicao humana pendente
NEXT_ACTION = Disponibilizar folga de disco local e concluir APK isolado; ouvir resultado Web e depois tablet
```

## Atualizacao M21.2-R1 — avaliacao humana recebida
O proprietario reprovou o sintetizador anterior: PIANO_QUALITY_LISTENING=FAIL, timbre artificial e estalos. Esse resultado substitui as linhas historicas de audicao pendente acima. Nova implementacao com samples reais FreePats KW, CC0, descrita em [[2026-11-06-m21-2-r1-piano]]. Preview novo4183. Aprovacao auditiva R1 ainda pendente; Android nao repetido.

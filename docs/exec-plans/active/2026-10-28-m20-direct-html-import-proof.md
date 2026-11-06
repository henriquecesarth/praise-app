# M20 — prova isolada de importação HTML direta

Escopo: parser próprio TypeScript/Cheerio, obtenção HTTPS limitada e adaptação para
`SmartChordImportDraft`. Sem alterar a rota atual, persistir, gerar APK ou publicar.
Branch preservada: `feat/m20-phase-2a-android-share`; base inspecionada:
`e3c4902e0d8786e164ea0686486c564f9dea1578`. Alterações locais preexistentes preservadas.

## Execução e evidência

- [x] Inspecionar extrator, contrato, normalizador e consumidores de revisão.
- [x] Implementar parser puro, adaptador HTTPS e composição experimental.
- [x] Testar fixtures sintéticas, alinhamento por coluna e seis cordas com técnicas.
- [x] Testar SSRF, redirecionamentos, HTTP 403, limites e deadline com transporte simulado.
- [ ] Validar HTML real da página de referência em acesso permitido.
- [ ] Validar visualmente a revisão antes de considerar ativação da rota.

Entradas em `backend/src/features/smart_chords/`:
`parseCifraClubHtml(html, sourceUrl)` em `cifraclub_html_parser.ts` retorna
`{ draft, version, lines }`; `importCifraClubDirect(url)` em
`cifraclub_direct_import.ts` compõe HTTP e parser. Nenhuma é chamada pela rota atual.

Parser: aceita um único `.cifra_cnt pre` ou `pre.js-tab-content`; preserva quebras,
linhas vazias, espaços e tablaturas. BR vira uma quebra; nós inline não duplicam
conteúdo. Não executa scripts. Layout ausente, múltiplo ou sem música falha fechado.
O `original_text` guarda o texto extraído; `lines` classifica seções, progressões,
acordes, letra e tablatura. Pares acorde/letra geram `[Acorde]` na coluna exata,
sem aproximar para limites de palavras. Tabulações geram aviso de alinhamento.

Título/artista vêm de campos HTML. Tom vem exclusivamente de `#cifra_tom` e
`#cifra_tom_original`; capotraste de `#cifra_capo`/`.capotraste`; versão de
`#cifra_versao`/`.cifra_version`. Estes seletores de metadados adicionais são
hipóteses cobertas por fixtures, ainda sem confirmação no HTML real. Com capo,
o parser não calcula o tom original: preserva o indicado em `displayed_key` e
exige revisão se o original não estiver explícito. Não infere tom dos acordes.
Versão fica no resultado auxiliar porque o contrato de draft não tem esse campo.

HTTP: somente HTTPS, dois hosts exatos, caminho canônico artista/música, sem
credenciais, query ou fragmento. DNS IPv4 público validado e fixado no socket TLS;
IPv6 não é utilizado. Conexão nova, sem redirects, retries, cookies ou autenticação.
Deadline total de 8 s inclui DNS/corpo; máximo de 2 MiB anunciado e em streaming.
Aceita somente HTML sem compressão; interrompe respostas diferentes de 200 e
registra `http_status` no AppError. Não tenta resolver CAPTCHA ou restrições.

## Acesso real e limites

Em 2026-10-28, a consulta web a
https://www.cifraclub.com.br/projeto-sola/glorificar/ retornou **403 Forbidden**.
Sem novas tentativas ou troca de identidade. HTTP nativo contra a origem:
**NOT_EXECUTED** após esse bloqueio. Compatibilidade com o HTML real:
**Unknown / Not yet verified**. Nenhum HTML real foi obtido ou usado como fixture.

Referências técnicas consultadas (sem chamar APIs hospedadas):
- https://github.com/adrianohcampos/cifraclub-api/blob/main/api/cifra.js
- https://github.com/code4music/cifraclub-api/blob/main/app/cifraclub.py

O draft é compatível com os campos consumidos por `api.ts` e pelo editor de
revisão. A sintaxe inline é aceita por `parseSmartChord`. A prova testa posições
no modelo e integridade textual na transposição existente, não pixels no preview.
O preview web atual calcula margens próprias e interpreta colchetes de harmônicos
como marcação de acorde; precisa de verificação/correção antes de ligar esta entrada.
Versão não é persistida nem mostrada como campo próprio. Não há integração de UI.

## Validação reproduzível

Em `backend/`:
```text
npm test -- --run src/features/smart_chords/cifraclub_html_parser.test.ts src/features/smart_chords/cifraclub_http.test.ts src/features/smart_chords/smart_chord_url_extractor.test.ts src/features/smart_chords/smart_chord_import.routes.test.ts --test-timeout=10000
npm run build
```

Testes HTTP usam mocks de DNS/HTTPS e não escrevem em serviços externos. Testes
de rota verificam que o importador vigente continua exigindo colagem manual e
não persiste cifras. Sem homologação externa ou validação visual declarada.

Resultados finais: **PASS** nos 13 testes do parser (reexecução após correção de
progressões entre colchetes); **PASS** nos outros 53 testes HTTP e de regressão
na execução conjunta anterior. **PASS** em `npm run build` (exit 0). A primeira
tentativa de Vitest no sandbox teve `spawn EPERM`; execução autorizada fora do
sandbox permitiu validar. Nenhum build web/mobile foi necessário.

Próximo passo: obter HTML por acesso permitido, confirmar seletores e validar o
preview com tablaturas antes de propor ativação. A pendência externa mantém este
registro ativo; a implementação técnica isolada e seus testes estão entregues.

## Continuação — prova Android por WebView (2026-10-28)

Critério: `DIRECT_IMPORT = PASS` somente após importação completa da URL pública
real pelo LouvAIO, sem colagem manual. Fixtures sintéticas não satisfazem isso.
O parser TypeScript não foi alterado nesta continuação.

O diagnóstico inicial não encontrou Android nem AVD. Após solicitação, o usuário
conectou um Lenovo TB-J616F, Android API 31, WebView do sistema
`com.google.android.webview` 155.0.8059.43. O ADB o reconheceu como `device`.

### Implementação entregue

- `mobile/tool/cifraclub_access_probe.dart`: alvo Flutter normal, com WebView
  visível, uma navegação por execução e identidade padrão; sem Firebase, login,
  backend, proxy, alteração de user-agent ou resolução de desafio.
- Observa início/fim da navegação, erros HTTP da URL principal e disponibilidade
  do DOM musical separadamente. Ausência de erro não comprova HTTP 200.
- Deadline de navegação de 45 s após configurar o controller; observação de DOM
  limitada a seis leituras em dez segundos, sem reload. Interrompe autenticação,
  erro principal, desafio ou navegação fora da URL exata.
- Exporta somente diagnóstico explícito (contadores e metadados selecionados).
  Não transmite cookies, headers, scripts, credenciais ou HTML da página.
- `webview_flutter` 4.14.1 adicionado como dependência de desenvolvimento.
  A resolução passou a exigir Flutter >=3.47 no lock; versão local: 3.47.5.
- Variante `cifraProbe` com applicationId próprio, inicialização automática do
  Firebase removida e processamento Google Services desativado só nela.
  Alterações preexistentes nos flavors/configuração foram preservadas.

### Evidência real e resultado

Comandos de execução local (somente debug, sem APK de homologação/distribuição):
```text
flutter analyze tool/cifraclub_access_probe.dart
flutter run -t tool/cifraclub_access_probe.dart -d <android-device-id> --flavor cifraProbe --debug --no-resident
flutter run -t tool/cifraclub_access_probe.dart -d <android-device-id> --flavor cifraProbe --debug --no-resident --no-enable-impeller --use-application-binary build/app/outputs/flutter-apk/app-cifraprobe-debug.apk
```

Análise estática: **PASS**, sem issues. Compilação/instalação debug: **PASS**.
Execução real, com Impeller e depois com Skia reutilizando o mesmo binário:
**FAIL na obtenção do conteúdo**, ambas com `access_result = TIMEOUT`,
`page_started = false`, `page_finished = false` após 45 s. Capturas inspecionadas
mostraram a tela do LouvAIO com área da WebView vazia/preta, sem cifra visível.
A troca de renderizador foi diagnóstico local, sem mudança de identidade/rede;
não resolveu o problema e não foi persistida como configuração do produto.

Um alvo de integration_test foi tentado anteriormente, mas apresentou ausência
inicial de DOM e falhas/timeouts de instrumentação; foi removido e substituído
pelo alvo Flutter normal. Esses testes não comprovam resposta da origem.
Nenhuma fixture sintética adicional foi usada para aprovar o acesso.

Status HTTP no Android: **Unknown / Not yet verified**. Não foi observado 403,
CAPTCHA ou exigência de autenticação no Android. A causa do timeout também é
**Unknown / Not yet verified**; não há evidência para atribuí-la ao site, rede,
renderizador ou plugin. O 403 anterior era da consulta web, não de uma execução
comprovada do adaptador HTTP nativo do backend.

DOM musical, Glorificar/Projeto Sola, Bb, intro/interlúdio, Eb/G, Ab/Bb, alinhamento
real e tablaturas de seis cordas: **Unknown / Not yet verified**.
Evidência selecionada: `../evidence/2026-10-28-m20-cifraclub-android-access.json`.
Não foi criado adaptador de captura de HTML nem endpoint: a condição de acesso
permitido e conteúdo musical disponível não foi satisfeita. Nenhuma cifra foi
salva; o importador vigente permanece preservado. `DIRECT_IMPORT = BLOCKED`.

Colagem e compartilhamento já convergem em `_extractUrl()` →
`SmartChordImportNotifier.importUrl()` → `SmartChordRepository.importUrlDraft()`;
o repositório ainda chama `manualUrlDraft(url)`. Essa convergência foi verificada
por inspeção de código, não por uma importação direta completa no aparelho.

Próximo passo: diagnosticar por que a navegação WebView não inicia/conclui neste
runtime, com instrumentação nativa de inicialização/navegação, ou repetir em
outro Android com acesso permitido. Só após obter o DOM real, extrair estrutura
musical mínima, reutilizar o parser TypeScript e validar os dois pontos de entrada.
Se uma próxima tentativa revelar 403 ou desafio, parar e obter acesso autorizado;
a presente evidência não autoriza declarar essa causa ou tentar contorná-la.

Referências oficiais consultadas:
- https://pub.dev/packages/webview_flutter
- https://pub.dev/documentation/webview_flutter/latest/webview_flutter/NavigationDelegate-class.html

## Diagnóstico A/B/C e recuperação comprovada (2026-10-28)

Atualização da evidência anterior: o timeout foi isolado antes da rede. No mesmo
controller/widget, A (HTML local), B (example.com) e C (Cifra Club) retornaram das
cargas, mas ficaram em progresso 10 por ~45 s; JavaScript também expirou.
`INTERNET` estava concedida; Activity retomada e WebView nativa montada com
2000x1056. O provedor 155.0.8059.43 estava válido/habilitado. Seus serviços sandbox
estavam pendentes, sem processo nem binder (`app=null`, `requested=false`,
`received=false`, `hasBound=false`). Não foi comprovada falha de delegate,
permissão, URL, timeout iniciado antes da configuração ou renderizador gráfico.

Reiniciar apenas a prova não recuperou A. O usuário autorizou reboot do Lenovo e
reautorizou USB depois dele. Com o mesmo binário e provedor, mantendo multiprocess
e segurança habilitados, o renderer passou a ter processo, binder e binding
ativos. A passou em 2304 ms com marcador local e DOM complete; B em 601 ms com
Example Domain e status 200 via Navigation Timing. O gatilho do travamento
OS/provedor continua **Unknown / Not yet verified**; a falha e sua recuperação
estão demonstradas, sem atribuir causa especulativa a GPU ou ao site.

C inicialmente produziu `hostLookup/-2`, sem status HTTP. A tela mostrou
`net::ERR_INTERNET_DISCONNECTED`; a amostra de conectividade não tinha rede padrão.
Após o usuário confirmar rede autorizada, somente C foi repetido, com registro
sanitizado de `net::ERR_*`. C passou em 3747 ms: PageStarted, progresso até 100,
PageFinished, DOM complete, HTTP 200 e URL final exata da referência. Nenhum 403,
CAPTCHA ou pedido de autenticação foi observado no Android. Não foram alterados
VPN, DNS, user-agent, cookies ou políticas de segurança.

O DOM real usa `article > pre` com classes geradas, em vez dos seletores antigos;
tem um único pre com 3133 caracteres, 145 linhas, 68 nós b e 24 linhas de tab.
O campo explícito é `Tom: Bb`; título Glorificar e link do artista Projeto Sola.
Isso é evidência real de diferença de layout, não falha da interpretação musical.

`mobile/tool/cifraclub_dom_probe.mjs` usa DevTools local da própria WebView debug
somente para inspeção da página já carregada, sem buscar a origem pelo desktop.
O modo `--convert` projeta exclusivamente título, artista, tom explícito e texto do
pre em um fragmento mínimo compatível com o parser existente, sem outro mecanismo
de interpretação musical. A projeção e conversão ficam em memória; não há escrita
na biblioteca nem captura de scripts, cookies, headers ou HTML alheio.

Conversão real pelo `parseCifraClubHtml` TypeScript **inalterado**: **PASS**.
Draft com 2885 caracteres, 53 linhas de letra e 46 linhas de acordes/progressões;
sem warnings e `requires_manual_paste=false`. Intro, interlúdio, Eb/G e Ab/Bb
confirmados. As 24 linhas formam quatro grupos completos E/B/G/D/A/E, preservados
exatamente. O original_text coincide com o texto extraído. Nenhum trabalho em
OCR ou alinhamento foi realizado nesta continuação.

Validações: análise direcionada Dart sem issues; debug local compilado/instalado;
`node --check` e conversão do DOM real pelo parser em memória. Nenhuma suíte
anterior repetida. Artefatos são debug local, sem APK de homologação ou publicação.

Reprodução da inspeção (somente em WebView debug do alvo local):
```text
adb -s <device> forward tcp:9223 localabstract:webview_devtools_remote_<pid>
node mobile/tool/cifraclub_dom_probe.mjs
node --import ./backend/node_modules/tsx/dist/loader.mjs mobile/tool/cifraclub_dom_probe.mjs --convert
adb -s <device> forward --remove tcp:9223
```
Apenas C: acrescentar `--dart-define=CIFRA_PROBE_CASE=C` ao comando flutter run.

Evidência JSON preserva os resultados antigos e acrescenta `navigation_diagnosis`
com antes/depois, última navegação C, estrutura real e resumo da conversão:
`../evidence/2026-10-28-m20-cifraclub-android-access.json`.

A investigação de navegação e a conversão real estão comprovadas. **DIRECT_IMPORT
do produto permanece BLOCKED**: colagem/compartilhamento ainda não acionam essa
captura e o parser sem DevTools. A captura por DevTools é ferramenta de diagnóstico,
não arquitetura de produto. Próximo trabalho: integrar o fluxo normal à captura
validada, preservando revisão e confirmação antes de persistir. A rota atual não
foi substituída. Sem push, merge, deploy ou alteração de produção.

## M20-C1 — checkpoint da integração transparente (2026-10-28)

Branch preservada: feat/m20-phase-2a-android-share; HEAD e3c4902e0d8786e164ea0686486c564f9dea1578.
Sem commit, push, merge, deploy ou APK de homologação. WIP anterior preservado.

Delegação nativa realizada, com um escritor por arquivo:
- /root/dom_backend (feature-engineer): contrato musical_html opcional na rota URL,
  testes backend e runner local isolado em m20-c1-local-e2e.ts. Resultado: PASS nos
  5 testes da rota/build e smoke com Auth/Firestore reais emuladores. O smoke usa
  HTML sintético: não é evidência da origem pública nem E2E Android.
- /root/mobile_contract (feature-engineer): repositório, notifier, fakes e testes;
  depois testes da captura. Resultado: 30 testes repositório/controller PASS;
  regressão de preservação ao salvar (21 controller PASS), 10 captura/validação PASS.
- /root/capture_review (feature-reviewer, somente leitura): revisão independente.
  Achados corrigidos: metadados de capo/tom original; cancelamento e callbacks
  tardios; sobreposição JS após timeout; trim destrutivo ao salvar; preview tabs.
  Resultado final estático: sem novo HIGH/BLOCKER verificado no código inspecionado.
  Modelo efetivo dos agentes: Unknown / Not yet verified (papéis nativos usados).

Implementação atual:
- Android: captura no Import Hub para URL colada e Share Intent pelo mesmo _extractUrl.
- WebView real com dimensões de tela, sem Offstage/tamanho zero; progresso próprio,
  exclusão de semântica/interação do site e cobertura opaca antes da navegação.
- Prontidão do renderer por documento local; timeout de configuração e captura,
  cancelamento/back/dispose, bloqueio de redirects/autenticação/403/desafios,
  descarte de sessão/ministério/operação obsoleta, snapshot da geração de sessão.
- Projeção estrutural mínima -> POST autenticado /smart-chords/import/url com
  musical_html -> parser TypeScript existente inalterado -> draft/preview existente.
- Sem persistência antes da confirmação; save preserva texto sem trim; preview
  reutiliza ChordLyricLine para preservar linhas musicais e tabs longas.

Validações locais reais já observadas nesta execução:
- 44 testes de telas/captura/validação: PASS antes da última alteração de composição.
- 7 checks de projeção DOM em Chromium + parser TS: PASS (fixtures, não E2E).
- Backend em 127.0.0.1:3107, Auth 9099, Firestore 8080; projeto demo-m20-c1,
  cwd temporário sem .env, sem credenciais/Firestore de produção.
- JDK17 local com firebase-tools13.15 (CLI15 exige Java21); instâncias reais locais.
- integration_test/m20_c1_android_flow_test.dart tentou colagem real e falhou antes
  do preview com CIFRACLUB_RENDERER_UNAVAILABLE; nenhuma cifra salva por esse teste.
- Execução debug normal tool/m20_c1_local_app.dart também reproduziu a falha de
  prontidão. A URL foi colada pela área de transferência real; não foi copiada letra.
  Estado nativo: renderer sandbox app=null, binder=null, hasBound=false, pending.
- Não houve reboot nesta etapa C1. Não é permitido mascarar a falha como PASS.

Última ação em curso: composição híbrida nativa suportada pelo plugin Android,
para distinguir a composição por textura da indisponibilidade do renderer. Somente
este cenário afetado será revalidado. Não repetir navegação/parser já aprovados.

Autorização formal da fonte: Unknown / Not yet verified. Usuário instruiu prosseguir
sem documentação e tratar depois. Nenhuma permissão da fonte é inferida de HTTP200;
403 legal não foi contornado, e proteções de acesso continuam encerrando a captura.

Próximo checkpoint: resultado da composição híbrida em fluxo normal, captura real,
preview e save/reopen; se renderer continuar indisponível, marcar BLOCKED e manter
implementação isolada. Emuladores reais não tornam testes com fixtures E2E aprovado.

### M20-C1 — retomada e resultado real em 2026-10-28

Evidência: `../evidence/2026-10-28-m20-c1-android-flow.json`.
Git preservado: branch `feat/m20-phase-2a-android-share`, HEAD
`e3c4902e0d8786e164ea0686486c564f9dea1578`; nenhum commit/push/deploy.

A composição híbrida permitiu uma execução real por colagem: captura automática,
preview editável Glorificar / Projeto Sola / Bb, 24 linhas de tablatura e 2885
caracteres normalizados. Confirmados intro/interlúdio, Eb/G e Ab/Bb. Zero documentos
antes do clique real em Salvar Cifra Pessoal; um depois. Reabertura por GET real e
reader existente confirmou texto exatamente igual ao preview. Toda persistência
ocorreu somente nos emuladores locais do projeto demo-m20-c1. A imagem
`../evidence/2026-10-28-m20-c1-own-progress.png` registra progresso próprio sem site.

O Share Intent foi conectado ao mesmo pipeline. Corrigida retenção indevida para
usuário autenticado sem ministério (cifras são pessoais); contextos loading/error
continuam retidos. A entrada debug e integration_test agora usam o roteador/provider
canônico, evitando segundo handler no canal nativo. ACTION_SEND real abriu o Hub,
preencheu a URL exata e iniciou captura automaticamente.

Contudo, nova execução real falhou ANTES da URL: timeout da prontidão local;
SandboxedProcessService1:0 associado ao app com app=null, binder=null, hasBound=false.
Causa nativa: **Unknown / Not yet verified**. Não houve reboot, mudança de segurança,
troca do provedor, evasão ou tentativa de mascarar o resultado. Não atribuir essa
falha a HTTP/site: a navegação da origem não foi alcançada nessa tentativa.

Resultado M20_C1_VERDICT=BLOCKED. Sucesso real isolado não comprova estabilidade.
Captura mantida desativada por padrão em cifraClubDirectImportEnabledProvider,
habilitada apenas por override explícito nas entradas debug/teste. O importador
normal permanece disponível; a implementação experimental e todo WIP foram mantidos.

Verificações finais direcionadas: 9 testes de lifecycle/roteador PASS; 34 testes de
Import Hub PASS; regressão adicional de captura desativada por padrão PASS (1).
Analyze dos seis arquivos afetados PASS. Resultados anteriores de parser/backend
continuam registrados; diagnósticos de navegação aprovados não foram repetidos.
Integration_test automatizado anterior falhou no renderer, foi corrigido para o
provider canônico e não foi reexecutado após a nova falha nativa. Revisão independente
somente leitura não encontrou novo achado material. git diff --check PASS.

Próximo passo: resolver inicialização repetível do renderer nativo sem reboot e
revalidar somente Share Intent -> captura real -> preview -> save/reopen exato.
Não liberar a captura por padrão nem declarar Android E2E PASS antes disso.
Autorização formal da fonte permanece **Unknown / Not yet verified**, conforme
instrução do usuário para prosseguir tecnicamente sem documentação por enquanto.

### M20-C2 — renderer e contrato universal (2026-10-28)

Resultado: **BLOCKED**. Evidência detalhada e arquivos atingidos:
`../evidence/2026-10-28-m20-c2-renderer-universal.json`.

Mantidos branch/HEAD, WIP, parser e pipeline C1. Não repetidos diagnósticos de
HTTP/DOM/música já aprovados. Entrada debug no flavor existente chamou a captura
de produto sem autenticação, backend, persistência ou ACTION_SEND; o mesmo erro
de prontidão local ocorreu. Portanto ACTION_SEND/backend não são necessários
para reproduzir a falha. O provedor está instalado/habilitado, relros 2/2,
aparelho acordado/desbloqueado e nenhum pacote congelado na observação.

Dois defeitos de integração foram corrigidos sem substituir o importador:
1. Primeiro frame podia ter viewport 0x0. Agora a construção do controller espera
   dimensões válidas, host resumed e transição concluída (gate de 5s).
2. Plugin4.14.1 tem dispose vazio no platform view; remover widget não comprova
   destroy. A bridge nativa usa a API pública do plugin para resolver a instância
   do engine atual, remover parent e executar stopLoading/destroy. Liberação de
   duas instâncias foi confirmada em execução real.

Recuperação: no máximo uma recriação após falha de prontidão local, aguardando
route.completed e liberação confirmada. Cancelamento/403/auth/desafio/redirect e
falhas após navegação externa não repetem. Ambas as esperas endOfFrame agora
têm prazo de 2s, incluindo a lacuna apontada pela revisão independente.

Prova final no aparelho: dois viewports 1333.33x784, liberação nativa true nas
duas tentativas, falha total em 19.45s; serviço sandbox continuou pending com
app=null/binder=null/hasBound=false. Fonte não alcançada. Não afirmar que a
correção de viewport/cleanup resolveu o processo nativo; causa subjacente e
especificidade do aparelho/provedor: **Unknown / Not yet verified**.
Sem reboot, troca de provedor, desativação de sandbox ou comandos ADB como solução.

Contrato consolidado em `docs/architecture/smart-chord-url-acquisition.md`:
mesmo endpoint/modelo SmartChordImportDraft, callback de aquisição independente,
parser TypeScript autoritativo. Vetor sintético compartilhado entre teste da rota
backend e consumidor Flutter, preservando Bb, baixo e seis linhas TAB/técnicas.
Web usa ponto de extensão backend; 403 permanece sem solução e não foi ativado.
iOS/WKWebView tem apenas diferenças de lifecycle/contrato documentadas, sem testes.

Validação dirigida: lifecycle 8 PASS, rota backend 5 PASS, consumidor compartilhado
1 PASS, analyze dos três arquivos 0 problemas; build/execução debug real PASS.
Revisão independente somente leitura concluída, git diff --check PASS.
E2E colagem/share e save/reopen C2 bloqueados antes da URL; sucesso C1 preservado
como histórico, sem promovê-lo a estabilidade atual. Nenhuma escrita em produção.
Captura experimental continua desativada por padrão. Próximo bloqueio: investigar
inicialização nativa por meios suportados ou comparar outro Android autorizado;
só após prontidão repetível retomar E2E completo. Plano continua ativo.

### M20-C3 — aquisição centralizada no backend (2026-10-28)

Evidência: `../evidence/2026-10-28-m20-c3-backend-acquisition.json` e seus dois
samples HTTP. C1/C2/C2D/C2E e toda WIP preservados. C2D/E posteriores à C2
identificaram DuraSpeed por controle antes/depois, restaurando a configuração
original; a amostra Android de captura foi 4488ms. Nenhum teste/mudança Android C3.

O 403 original era da consulta web; o registro original dizia HTTP nativo
NOT_EXECUTED. A execução Node atual não reproduziu403: HTTP obteve HTML200.
A primeira tentativa encontrou layout incompatível com o seletor legado do
parser. Criada apenas projeção estrutural Cheerio para o formato musical_html
existente (article/pre + campos explícitos); parser musical permaneceu inalterado.
O helper experimental continua isolado de rotas/UI, sem nova dependência.

Após correções de revisão (omitir conteúdo oculto e tornar testes de limites
efetivos), prova final real: HTTP200 em496ms, 502887bytes; projeção3268chars;
Glorificar/Projeto Sola/Bb,145linhas, conteúdo2885chars,24linhasTAB exatas;
44pares acorde/letra com colunas e texto exatos, intro/interlúdio e Eb/G/Ab/Bb,
zero warnings/duplicações. Total741ms, CPU do processo374ms, RSS final~117MiB;
amostra local Windows/Node24, sem bootstrap de DB, persistência ou sessão pessoal.
Não é benchmark Vercel nem comparação A/B com Android.

Avaliado headless por documentação oficial: tecnicamente condicional ao runtime
Node, binário Linux/bundle/memória/prazo; atual configmaxDuration60 e API única
src/app.ts. Browser ampliaria bundle/concorrência/isolamento e exigiria proteção
de rede para todos os subrecursos/redirecionamentos, não só URL inicial. Não foi
instalado/ativado/executado: HTTP local já entregou música sem executar scripts.
Cenários hipotéticos headless por1000imports emgru1 custam~US$0.28/0.61 variáveis
com premissas explícitas na evidência; não são medição nem teto de custo.

Resultado: **BLOCKED_FOR_HOSTED_PROOF**, não PASS baseado em acesso só local.
Consulta Vercel somente leitura: últimos3deployments do projeto backend ERROR;
docs/01-CONTEXTO-ATUAL.md já registra bloqueio de buildfsPath. Não inferir o estado
de todos os deploys antigos/outros projetos. Código C3 WIP não hospedado; deploy
é proibido nesta tarefa. Acesso de saída/403 no runtime real da Vercel permanece
**Unknown / Not yet verified**. Não corrigir infraestrutura fora deste escopo.

Validações dirigidas:51testes projeção/HTTP PASS, build backend PASS, revisão
independente sem pendência material, git diff --check PASS. Nenhum push/merge,
deploy, APK ou escrita em produção. Próximo passo: comprovar o mesmo draft no
runtime hospedado autorizado antes de ativar aquisição universal; preferir HTTP
limitado/Cheerio e não adicionar headless sem necessidade demonstrada.

### M20-C4B — revisão final Web e checkpoint (2026-10-29)

Revisão objetiva encerrada, com limites explícitos. Checkpoint completo:
`../evidence/2026-10-29-m20-c4b-web-checkpoint.json`.
Branch/HEAD preservados; sem commit/push/merge/deploy, alteração Android ou APK.

A revisão independente identificou HTML de clipboard obsoleto, descarte de música
como cabeçalho, trim no salvamento e corte de tablatura longa no PDF. Corrigidos
pontualmente. Regressão adicional confirmou trim da primeira coluna no normalizador;
agora só linhas vazias de borda são removidas, preservando indentação horizontal.

PDF real exportado pelo produto nas seis fontes: 6 arquivos, 18 páginas A4 com
conteúdo. O download confirmou override indevido de fonte monoespaçada e captura
com deslocamento vertical, ambos corrigidos. TAB longa ajustada sem mudar texto,
colunas e final19p17 visíveis, final da cifra presente. Artefatos em
`../evidence/m20-c4b-pdf/`; manifest SHA256, imagens das páginas e contatos retidos.
PDF rasterizado, sem fonte/texto pesquisável; TAB muito longa usa tamanho reduzido.

Correções da abrangência C4A: SAVE_REOPEN usou page.route/route.fulfill com array
em memória; não houve persistência durável Web. O teste XSS avaliou flag antes
da requisição simulada, não o backend. Caminho efetivo: texto+html -> controller
autenticado -> schema -> normalizeChordText/Cheerio para metadados. Não existe
sanitizador geral: HTML literal pode permanecer como texto; renderizações revistas
usam escaping React. Não transformar essa cobertura em garantia genérica XSS.

web/.env revisado sem exibir valores: ignorado, fora do índice, quatro variáveis
públicas VITE, URL local, sem padrão de credencial detectado. Arquivo preservado;
não incluir em commits e conferir configuração de build de release separadamente.

Validação: 74 testes do módulo normalizador, 4 regressões dirigidas do modal,
2 casos Chromium C4A afetados e 1 caso PDF real PASS (81 casos no escopo);
typecheck Web, build TypeScript backend e git diff --check PASS. Os 189 reportados
anteriormente não foram repetidos como suíte completa.

Pronto para revisão de release Web, não aprovação de publicação. Gate de release:
save/reload/reopen com backend de teste durável, limite de cobertura XSS explícito
e revisão das configurações de release. Para retomar Android, preservar contexto
C2D/E e DuraSpeed; nenhuma ação Android autorizada/executada neste checkpoint.
Pendências e ownership de todos os arquivos C4/C4B constam no JSON. Frente de
revisão Web encerrada aqui; plano M20 geral permanece ativo para próximas frentes.

### M20-C4C — persistência e segurança Web integradas (2026-10-29)

**PASS técnico local**, sem homologação hospedada. Checkpoint curto e evidências:
`../evidence/2026-10-29-m20-c4c-checkpoint.json`, `m20-c4c-integration-run.json`
e `m20-c4c-db-snapshot.json` (mesmo diretório e prefixo de data).

Executado Import Hub real -> API autenticada real -> Admin SDK -> Firestore
emulator demo-m20-c4c, sem mocks de persistência. Cadastro Auth real e nova sessão
por ID token do Auth emulator; novo contexto/reload reabriu exatamente conteúdo
e metadados. REST independente confirmou Bb original/exibido, capo0, seis TABs
indentadas, seções e baixos. Leituras/alteração/exclusão de outro usuário404;
mesmo ministério não compartilha cifra pessoal; ministério estranho403 e vínculos
separados. Autoridade user_id enviada no corpo não substituiu o usuário da sessão.

Falha controlada no transporte de Commit (gRPC7), após controle real positivo:
rascunho conservado, nenhum sucesso/registro parcial, retry explícito gravou uma
vez. Proxy de teste só encaminha RPCs normais ao banco real; não simula dados
persistidos. Encerramento HTTP/2 do harness foi corrigido e validado em <1s.

Matriz HTML integrada: scripts, eventos, SVG, iframe/srcdoc, URLs perigosas,
HTML malformado e tags codificadas em título/artista/letra. Zero execução ou
elemento HTML injetado após salvar/reabrir/reload; PDF conferido somente no DOM
de origem. Não houve nova exportação PDF/teste de fontes/alinhamento. A segurança
é de texto escapado React, não sanitização geral; nenhum sanitizador instalado.

Defeito comprovado e corrigido: payload válido110041bytes retornava500 pelo limite
global100KiB. JSON pessoal de Smart Chords agora limitado a2MiB para import/save;
outros endpoints mantêm limite global. Excesso413 e JSON inválido400 sem logar
corpo. Schema de texto100000/HTML200000 preservado. Unicode importado/salvo/lido
exatamente, excesso de schema400 e URLs de origem perigosas rejeitadas.

PASS: cenário integrado final9.4s, build backend, typecheck dos novos testes e
diff-check. Testes iniciais corrigiram apenas pressupostos do harness (prompt
opcional e envelope do repertório), sem alterar contratos do produto.
.env ativos intactos/ignorados; variantes agora protegidas por .env.* com exceção
de templates. Nenhuma configuração Vercel ou dado de produção foi alterado.

Gate restante separado: Preview com VITE_API_URL HTTPS/backendcanônico/api/v1,
CORS exato e variáveis server-only de staging. Firestore hospedado NOT_EXECUTED;
qualquer escrita remota exige autorização específica. Sem Android/iOS, parser ou
renderer alterados; sem commit/push/merge/deploy. Arquivos e ownership no JSON.

### M20-C5 — continuidade Android (2026-10-29)

**BLOCKED para homologação física completa.** Inventário somente leitura: apenas
Lenovo TB-J616F conectado; SDK sem executável de emulador, system-images ou AVD.
Não repetido o diagnóstico DuraSpeed C2D/E nem alterado o dispositivo. Evidências
C1/C2E/C3 preservadas; Web C4C permanece fora do escopo.

Corrigido despacho de share pendente antes do login para usuário sem ministério:
o router real agora aciona importação pessoal após bootstrap `ready` ou `empty`,
inclusive inicialização já autenticada; notificações dependentes de ministério
mantêm `ready`. PASS nos dois casos do teste com LouvAioApp/router real e share
frio, sem chamada manual de despacho. PASS em novo teste de falha do renderer:
URL mantida, carregamento encerrado, nenhuma importação/persistência automática,
retry explícito chega ao preview. Análise dos três Dart alterados sem issues.
Revisão independente somente leitura sem achado material pendente após correção.

Não reexecutadas suítes aprovadas, build/APK ou E2E no Lenovo incompatível.
Captura experimental continua desabilitada por padrão. Próximo gate: URL e Share
reais em Android compatível até edição, save explícito e reabertura exata,
incluindo alinhamento, técnicas, transposição e fontes no leitor. Testes com
plataforma falsa não certificam liberação nativa/repetibilidade do WebView.
Checkpoint e comandos: `../evidence/2026-10-29-m20-c5-checkpoint.json`.

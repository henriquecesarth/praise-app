# M22-S4.2 — Reprodução MP3 incremental no Android (experimental)

Estado: **experimental, desligada por padrão**. `MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`. Limite de duração inalterado (300 s). Publicação MP3, backend e produção não mudaram; o caminho WAV v1 não mudou.

Para ligar num build de desenvolvimento: `--dart-define=LOUVAIO_EXPERIMENTAL_MP3_AUDIO=true --dart-define=LOUVAIO_EXPERIMENTAL_MP3_INCREMENTAL=true`.

## Decisão aceita

No modo incremental o comprimento PCM integral só é confirmado **durante e ao final** da decodificação. **Um erro de decodificação posterior pode ser detectado depois de parte do áudio já ter sido reproduzida.** A validação dos bytes comprimidos antes de qualquer áudio **não** foi relaxada.

## Continuidade PCM: o que é detectado e quando

| Origem da divergência | Detecção | Momento |
|---|---|---|
| Quadro comprimido saltado, repetido, reordenado ou alterado em disco após a validação | `Mp3InputCheck`: cada quadro entregue ao codec é comparado, por posição absoluta, com o digest de 128 bits (SHA-256 truncado) do índice | Antes de o PCM daquele quadro existir (o codec está à frente da reprodução) |
| Posição errada no seek | Janela aberta no offset do quadro; a checagem de entrada começa nesse quadro; comparação bit a bit nos testes de aparelho | Antes do áudio, para a entrada |
| Resultado de geração antiga | Produtores são encerrados antes da geração seguinte; falhas de integridade ficam registradas mesmo se um seek chegar junto | Não chega ao mixer |
| Codec perde ou duplica PCM internamente | Só pela contagem: excesso ao ultrapassar o total da janela, falta no EOS | **Depois** de parte do áudio ter sido reproduzida |

Não são usados timestamps estimados. Limites: quadros byte a byte idênticos (silêncio digital) não se distinguem entre si, então um salto dentro de um trecho assim só aparece no primeiro quadro diferente ou no fim da entrada; e não há como atribuir amostras de saída a quadros de entrada, por isso a perda interna do codec continua sendo o **risco residual**. Nos testes com um bloco de saída removido ou duplicado, áudio divergente foi entregue antes de a sessão ser invalidada. Num arquivo alterado em disco depois da validação, a sessão foi recusada e todo o áudio entregue antes era idêntico à referência.

## Antes de qualquer áudio

1. Dart: `ensureCached` (revalidação online e SHA-256 do cache) e, depois do `prepare`, nova revalidação online antes de expor `ready`.
2. Nativo (`Mp3StreamIndexer`), para os seis arquivos, numa passada com um quadro em memória: estrutura MPEG estrita, frame Info, CRC da tag e CRC de música, perfil (LAME 3.100 ou Lavc, delay 576 + 529), delay/padding contra o manifesto, contagem integral de quadros, tamanho e SHA-256; mesmo codificador nas seis faixas. Espelha `mp3-stream-validator.ts` do backend.
3. `Mp3IncrementalCalibration` no aparelho: quatro fixtures (dois perfis × duas taxas), gapless desligado, comprimento bruto exato, rajadas nos dois canais e janelas com preroll 10 idênticas ao decode linear.
4. Um segundo de PCM alinhado nos seis rings.

## Arquitetura

- Seis produtores (um codec por stem) → seis `PcmRing` de 3 s → um `MixerCore` → um `AudioTrack` → um relógio. Sem PCM temporário.
- Só o produtor bloqueia (ring cheio) e sempre pode ser abortado. O consumidor nunca bloqueia: sem os seis blocos, o motor pausa o `AudioTrack` (sem flush e sem silêncio), entra em `BUFFERING` e só retoma com 1 s disponível nas seis faixas.
- Stems mutados ou fora do solo são descartados até a posição do mix, então o produtor não trava e a faixa volta alinhada.
- Seek: os seis produtores param e liberam os codecs **antes** da geração seguinte; a janela abre no offset do quadro (índice próprio), 10 quadros antes, e descarta até a amostra alvo.
- EOS: cada produtor falha ao entregar mais amostras que o permitido e exige contagem exata no fim; `COMPLETED` só depois dos seis EOS verificados.
- `stop`, `dispose` e o caminho de erro só confirmam depois de os produtores terminarem; caso contrário `SHUTDOWN_PENDING` e o lease é mantido.

## Fallback

Para a decodificação integral **somente** quando o aparelho não consegue fazer streaming: calibração incremental reprovada ou codec indisponível na preparação. Os seis arquivos são validados (estrutura e SHA-256) antes de qualquer fallback, inclusive quando não há suporte a streaming; a decodificação integral de fallback também passa pela checagem de entrada e os hashes são conferidos de novo depois. Arquivo corrompido, hash, estrutura, divergência de comprimento ou autorização nunca caem em fallback. Depois que a reprodução começou não há fallback.

## Medidas (Lenovo TB-J616F, Android 12; seis stems de ~298 s; já no cache; código final)

LAME 3.100 44,1 kHz e Lavc 48 kHz, 5 rodadas cada, calibração incluída em todas, sem amostragem de memória:

| Medida (mediana, mín–máx, ms) | LAME 44,1 | Lavc 48 |
|---|---|---|
| `prepare` nativo | 2938 (2763–3468) | 3037 (2706–3077) |
| — validação + índice + SHA-256 | 871 (751–1381) | 788 (675–944) |
| — calibração incremental | 1412 (1371–1497) | 1387 (1367–1478) |
| — preenchimento dos rings (inclui abrir os codecs) | 623 (578–1015) | 653 (608–898) |
| — dos quais até o 6º codec aberto | 604 (563–979) | 640 (582–871) |
| `play` → primeiro bloco no `AudioTrack` | 40 (22–79) | 26 (23–42) |
| `play` → relógio avança | 68 (48–188) | 58 (34–81) |
| início do `prepare` → relógio avança | 3111 (2811–3578) | 3095 (2759–3143) |

O digest por quadro acrescentou cerca de 0,3 s à indexação em relação à medição anterior à checagem de entrada. SHA-256 dos seis arquivos isoladamente: 74 ms (LAME) e 219 ms (Lavc), uma amostra cada.

- Seek até voltar a avançar: LAME 483–938 ms (mediana 702), Lavc 387–1446 ms (mediana 1118), 6 seeks cada.
- Underruns: 0 nos primeiros 12 s das 10 aberturas, 0 nos seeks, 0 em 298 s contínuos (um único `buffering`, o da partida). O caminho WAV registrou 1 underrun em 3 s.
- Memória: rings 3 175 200 bytes (44,1 kHz); índice por faixa ~230 kB; PSS de pico 191,3 MB contra 187,9 MB de base no mesmo processo (a base inclui as fixtures carregadas pelo teste). PCM temporário: 0.
- **Não medido**: download, revalidação online e o tempo total percebido a partir do toque na tela (exige backend real).

## Correção verificada no aparelho

Referência: decodificação integral de produção, mesma `MixerCore`, comparação amostra a amostra nos dois canais.

- Gravação inteira (26,3 M e 28,6 M amostras): idêntica.
- Quatro combinações curtas, do início e de 4 posições: idênticas.
- Seeks (início, meio, fim, repetidos, durante pausa, durante rebuffering): idênticos.
- Stall injetado em cada um dos seis stems: relógio parado e saída idêntica depois.
- 40 cancelamentos durante o `prepare`: fechados em até 38 ms, sem thread viva.
- Arquivo alterado em disco depois da validação: recusado, só áudio validado antes.
- Perda transitória de foco real pausa e retoma; `stop` libera os seis codecs.

## Revisão independente (Codex, somente leitura)

Cinco rodadas sobre o diff desde `a2d8a90`: a primeira achou 9 defeitos; as três seguintes acharam lacunas nas correções; a quinta aprovou. Principais correções: seek para o fim exato; retomada após seek em pausa; pausa e seek durante o dreno final; geração iniciada por um feed já falho; falha perdida por um seek concorrente; `engineFactory` falhando com produtores vivos; fallback sem verificação; snapshot atrasado sobrescrevendo erro no Dart; `PLAYING` publicado com a saída sem iniciar.

Aceito sem correção (P3): numa corrida entre `pause`/`resume` e o render, um bloco pode ser renderizado em `BUFFERING`; o áudio não é descartado.

**Preexistente no caminho WAV e não alterado** (o mesmo código em `a2d8a90`): retomar após um seek em pausa toca um instante do áudio antigo; pausar durante o dreno final pode cortar o fim; um seek aceito durante a finalização é perdido. As correções valem apenas para o caminho incremental.

## Limitações e pendências

1. Perda ou duplicação interna do codec só é detectada pela contagem (ver tabela de continuidade).
2. A calibração (~1,4 s) é feita uma vez por processo e é a maior parcela do `prepare` frio.
3. Um codec por stem fica retido em pausa; é liberado em `stop`, background e `close`.
4. Um único aparelho. Stems longos: LAME só a 44,1 kHz e Lavc só a 48 kHz.
5. Não verificado: remoção física de fones (só o receptor em testes JVM), logout/troca de ministério/revogação no aparelho (cobertos em Dart com fakes), escuta humana, 600 s, falta real de recursos para seis codecs (injetada).
6. Clone limpo: `mobile/integration_test/m22_e1_ministry_audio_test.dart` tem alteração local que importa um arquivo não rastreado de `integration_test/support/` (homologação E2/E3). Regularizar antes de validar um clone limpo.

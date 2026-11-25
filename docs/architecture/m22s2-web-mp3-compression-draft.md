# M22-S2 — Compressão experimental MP3 no rascunho de publicação (Web)

Estado: **experimental, desligada por padrão**. `MP3_RELEASE_GATE = BLOCKED`, `PRODUCTION_DEPLOY_GATE = BLOCKED`.
Nada é enviado ao servidor e a publicação efetiva em MP3 continua bloqueada; backend, modelo Demucs, limite de 300 s e
`serverByteValidation` não foram alterados.

## 1. Resultado da avaliação auditiva do S1 (registro do operador)

O operador ouviu os grupos voz, baixo, bateria e mix completo e **não percebeu diferença audível entre o WAV original e o MP3
CBR 256 kbps decodificado de volta para WAV**. Isto é aprovação perceptiva **do operador, nas amostras avaliadas**; não é
afirmação de transparência universal nem aprovação estatística. MP3 CBR 256 permanece o formato de publicação *proposto*.

## 2. Fluxo

Importar MP3/WAV → Demucs (inalterado) → pré-escuta dos seis WAV → (flag ligada) botão **Comprimir para publicar** →
seis stems comprimidos localmente, um por vez, no Worker do S1 → tamanhos antes/depois e economia real → manifesto MP3 v2
→ pré-escuta do resultado comprimido (alternável com "Voltar ao WAV") → **Preparar publicação continua entregando os WAV**.

- Flag: `VITE_EXPERIMENTAL_MP3_COMPRESSION=true` (build). Sem ela a tela é idêntica à anterior (teste dedicado).
- Nunca comprime sozinho: só após o usuário pedir, com a separação já pronta e ouvida.
- Código: `web/src/audio/mp3-encoding/mp3-draft-compression.ts` (módulo), `MinistryAudioLocalSeparation.tsx` (UI).

## 3. Garantias implementadas

| Requisito | Como |
|---|---|
| Um stem por vez, Worker existente | `compressSeparationDraft` codifica sequencialmente; um Worker por execução, terminado ao fim/cancelar/descartar |
| Sem Demucs e compressão simultâneos | `separate()` e `compress()` se bloqueiam mutuamente; campos de arquivo e botões ficam desabilitados |
| Sem cópias redundantes / um mixer | cada WAV é lido do `File` e transferido ao Worker; a pré-escuta decodifica um MP3 por vez sob demanda; apenas um `SixStemMixerPanel` montado (chave `wav-preview`/`mp3-preview`) |
| Delay do decoder calibrado | `Mp3StemDecoder.calibrate(rate)` antes de codificar; se o navegador não decodifica MP3, falha antes de codificar |
| Validação dos seis stems | por stem: tamanho + SHA-256 (cliente do Worker), decodificação com o descritor (tag/alinhamento/frames), `frames` e taxa iguais ao rascunho, alinhamento de amostras contra o WAV original (início/meio/fim, lag 0 por resíduo mínimo); entre stems: mesma taxa, frames, `mpegAudioFrames`, delay e padding |
| Invalidação por contexto | trocar/descartar música, nova separação, desmontar a tela (troca de ministério/sessão) abortam e liberam tudo; compressão nunca é reaproveitada entre separações |
| WAV preservado | o rascunho WAV nunca é alterado; cancelar/falhar mantém os WAV e os stems já prontos para *Tentar novamente* |
| Cancelamento | `AbortSignal` → término do Worker; testes cancelam durante cada um dos seis stems |
| Sem publicação MP3 | o MP3 comprimido nunca é entregue a `onPrepare`; teste confirma que só WAV é preparado |

Alinhamento: a correlação bruta foi trocada por erro residual (um deslocamento só vale se reduzir o resíduo em ≥1,5×),
pois em baixo real (banda estreita) o pico de correlação é plano entre lags vizinhos e o ruído do codec o fazia oscilar
(falso positivo de 1 amostra observado no teste com música real).

## 4. Binário LAME externalizado

`mp3.wasm` (132.999 bytes, SHA-256 `85e81719…eb9a`) é emitido pelo Vite como arquivo independente (`assets/mp3-<hash>.wasm`,
verificado em `vite build --mode test`, mesmo SHA-256) e o Worker o busca e valida (tamanho + SHA-256) antes de instanciar.
Substituição em build: `VITE_LAME_WASM_URL` + `VITE_LAME_WASM_SHA256`. Ressalva: o pacote npm ainda embute uma cópia base64
no chunk JS carregado sob demanda (não executada pelo Worker). Licenças e pendências: `THIRD_PARTY_NOTICES/lame-wasm.md`
(sem declaração de conformidade jurídica definitiva).

## 5. Medições (Chrome 158, música real autorizada de 279,9 s, stems do Q3 reutilizados — sem novo Demucs)

| Medida | Resultado |
|---|---|
| WAV → MP3 (6 stems) | 296,26 MB → 53,76 MB (**−81,86%**; 8,96 MB por stem) |
| Tempo total (codificar + verificar 6 stems) | ≈ 60 s |
| Pré-escuta: decodificar 1 stem sob demanda | ≈ 1,7 s |
| Alinhamento | lag 0 nas 6 faixas; `encoderDelay 1105`, `padding 559`, `mpegAudioFrames 10717` iguais nos seis |
| Determinismo | mesmo SHA-256 por stem em execuções repetidas e após cancelar + retomar |
| Heap JS (pico) | 387 MB; memória privada do Chrome: base 502 MB → pico 1.100 MB |
| Responsividade | 0 long tasks durante a codificação (Worker); 13 long tasks de 73–372 ms (maiores ≈ 200–370 ms) concentradas na verificação por decodificação do navegador; `rAF` máximo 351 ms |
| Cancelar no stem 0 / 3 / 5 | cancelado em 3,1 s / 36,6 s / 60,2 s; retomada codifica só o que falta (60,6 s / 42,4 s / 10,8 s) com os mesmos SHA-256 |

Limites: um navegador, uma música, uma máquina; sem medição em celular ou outros navegadores. As long tasks de verificação
vêm da decodificação (`decodeAudioData`) do navegador; não há mitigação além de rodar a verificação por stem.

## 6. Pendências (bloqueios restantes)

1. Revisão jurídica LGPL (ver notices) e decisão sobre aviso/fonte correspondente.
2. S3: o servidor só aceita hoje o perfil `Lavc`; é preciso estender o perfil para `LAME3.100` (tag 576, decoder 529).
3. Nenhum teste em outros navegadores/dispositivos móveis; sem revisão Codex.
4. Publicação MP3 permanece bloqueada (`MP3_RELEASE_GATE`).
5. Falha pré-existente de `AdminAvailabilityView` (fora do escopo).

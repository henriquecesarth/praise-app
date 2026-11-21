# M22-C.5D-C3 — Checkpoint da homologação MP3, auditoria e plano de integração

Base: branch `fix/louvaio-audit-remediation-20261113`, HEAD `937a5d1be8a5353fa1ce5899728045b4c68ae995`. Documentação apenas: nenhum
código de produto foi alterado, nenhuma operação foi feita no R2 ou no Firebase, e **o MP3 continua desabilitado em produção**
(`serverByteValidation: false`, `AUDIO_CODEC_NOT_ENABLED`). `RELEASE_GATE = BLOCKED`.

## 1. Evidências da homologação real (reportadas pelo operador)
Registradas em `m22c5d-c0-r2-mp3-homologation-plan.md` ("Resultados da homologação real"). Resumo: `su` (run `efff477c-…`) 24/24 PASS,
59 comandos SDK, cleanup inicial e posterior 48/48 ausentes; `rc` (run `b7f2416b-…`) 28/28 PASS, 116 comandos (39 leituras parciais,
13 `CopyObject` com uma falha injetada, retomada sem reler staging), cleanup inicial e posterior 72/72 ausentes. Consolidado 52/52,
175 comandos, 120/120 chaves ausentes. **O agente não reexecutou nada**; são evidências fornecidas pelo operador.
Limitações: sem outros navegadores/dispositivos, sem arquivos grandes (fixture de ~10,9 kB), risco residual de operação remota tardia,
um único encoder (`Lavc`).

## 2. Revisão independente (somente leitura)
**Codex Sol 6.2 high: indisponível.** Teste direto nesta tarefa (`codex exec -s read-only -m gpt-6.2-sol -c model_reasoning_effort="high"`,
prompt trivial, sem código do repositório): `model_not_found` — "The 'gpt-6.2-sol' model is not supported when using Codex with a
ChatGPT account". Nenhuma revisão Codex foi simulada. A revisão abaixo é **alternativa**, feita por um subagente **Claude** somente
leitura (conforme AGENTS.md: documentar o impedimento real). Sem conformidade integral declarada.

| Sev. | Achado | Local | Cenário / recomendação |
|---|---|---|---|
| Média | Paginação da biblioteca pode truncar (sem `nextCursor`) quando há MP3 `published` invisível | `ministry-audio.service.ts:271-285` (`list`: lê `limit+1`, filtra `isVisibleManifest`, só emite cursor se `index+1 < rows.length`) — confirmado por leitura direta | Com o portão fechado e um MP3 publicado entre as linhas, a página volta curta sem cursor e esconde WAVs posteriores. Latente (hoje nenhum MP3 publicado existe com o portão fechado). Filtrar na consulta ou preencher a página em laço; teste com MP3 publicado + portão fechado |
| Média | Nenhum cliente consome o contrato MP3 v2 | `web/.../MinistryAudioLibraryView.tsx:111` (sem `mp3Decoder`), `ministry-audio-files.ts:72-85`, `api.ts:538-541` (`readMinistryWav` exige `audio/wav`), `ministry-audio-contract.ts:31`; `mobile/lib` sem referência a `mp3_cbr256` | Abrir o portão sem mudar o Web quebra a reprodução. Bloqueio de habilitação, não regressão atual |
| Baixa | O portão é propriedade mutável (`Readonly` só em tipo) | `audio-codec.ts:50-63`; o harness a altera por cast (`scripts/m22c5d-r2-mp3-e2e.ts`) | Código no mesmo processo (ou teste que não restaure) abre o MP3 globalmente. Risco de import no build é baixo (`tsconfig.publish.json` exclui `src/scripts/**`, testes e `scripts/`; nada em `src/features` importa o harness). `Object.freeze` e injeção de portão |
| Baixa | Divergência de fatos após `seal` lança 409 sem marcar a tentativa `invalid` | `ministry-audio.service.ts:203-205` | Reserva fica parada até expirar; praticamente inalcançável (mesmo perfil de validação) |
| Baixa | O validador é estrutural, não decodifica o áudio | `mp3-stream-validator.ts` | Admin pode publicar frames válidos com áudio corrompido; risco limitado (upload só de admin) |
| Info | Pico de memória Web por stem de 300 s a 48 kHz acima dos 165-182 MB medidos (cópias de `slice` + WAV de 57,6 MB) | `mp3-stem-decoder.ts:323-324` | Manter decodificação sequencial (`direct`), documentar e medir em Safari/Firefox |

Sem achado de severidade alta. Verificado sem problema (leitura): seis camadas contra habilitação acidental (`requirePublishableStems`,
`assertEnabledCodecs` ×2 incluindo dentro da transação, `isVisibleManifest`, router só montado sob o gate de simulador/emulador,
R2 só instanciado dentro desse gate, guards do harness); autorização e isolamento ministerial por transação; URLs assinadas (PUT ≤ 300 s
com `content-length`/`content-type`/`if-none-match`, GET 120 s com `If-Match` no ETag); promoção create-only e condicional, retomada com
fatos coincidentes, finalize idempotente e revalidado na transação; consistência dos seis stems; validador streaming O(1); caminho WAV v1
intacto (chave `.wav`, `verifyWav`, `requestHash` v1 inalterado). Limitações da revisão: não executou testes nem leu o mixer em profundidade.

## 3. Matriz de capacidades (Web / Android / iOS)
Evidência: inventário somente leitura (`web/src/audio/`, `web/src/components/`, `mobile/lib/`, plano M22). **NV** = não verificado.

| Capacidade | Web | Android | iOS |
|---|---|---|---|
| Separação local Demucs/ONNX (`htdemucs_6s` fp16, 136 MB, `onnxruntime-web`) | **Experimental** (harness; WASM RTF ≈ 6,7; WebGPU com fallback; sem multithread/COOP-COEP global) | **Ausente** (sem runtime ONNX no `pubspec`) | **Ausente** |
| Worker + controle de memória (segmentos 343 980 amostras, overlap-add, limites 36 MiB/180 s, cancelamento) | **Implementado** | Ausente | Ausente |
| Cache persistente do modelo | **Ausente** (só memória/sessão) | Ausente | Ausente |
| Mixer de 6 faixas (mute/solo/seek, WAV PCM16) | **Implementado e testado** (`six-stem-mixer.ts`) | **Ausente** (sem player de stems) | **Ausente** |
| Decodificador MP3 v2 (`mp3-stem-decoder.ts`) | **Experimental** (só Chrome 150; não ligado a manifestos remotos) | Ausente | Ausente |
| Encoder MP3 no cliente | **Ausente** (WAV manual) | Ausente | Ausente |
| Biblioteca ministerial (lista/reserva/upload direto/playback) | **Implementada atrás de flag de emulador**; v1 WAV publicável, v2 só leitura experimental; fora de produção | **Ausente** | **Ausente** |
| Ponte separação → publicação (`SeparatedLibraryPublishDraft` → upload) | **Ausente** (draft existe, sem ligação) | Ausente | Ausente |
| Pacotes de ensaio (`.louvaio-rehearsal.zip`) | OPFS (`rehearsal-package-library.ts`) — **implementado** | Implementado (SAF `RehearsalPackageSafHandler.kt`, extração transacional) — reprodução **NV** | **Ausente** (SAF só Android) |
| Player vocalise nativo | n/a | Implementado (`VocalAudioPlayer.kt`) | **NV** (referência AVAudio no `AppDelegate.swift`, não verificada) |
| Armazenamento local de stems separados | Ausente | Ausente (arquivos app-private só para pacotes) | Ausente |
| Medição em dispositivos móveis | NV | NV | NV |

## 4. Menor plano incremental (não implementado)
Princípios: sem VPS, sem API paga, processamento no dispositivo, R2 opcional como armazenamento (nunca como processador), WAV v1 preservado
(é o único formato publicável hoje), MP3 só depois dos gates.

0. **Pré-requisitos de hardening (backend, pequenos):** corrigir a paginação com MP3 invisível (achado Média-1) e congelar os perfis
   de codec (Baixa). Nenhum flip de portão.
1. **Web, só WAV v1 (valor imediato):** ligar `SeparatedLibraryPublishDraft` ao `MinistryAudioPublicationForm`/`api.ministryAudio` por
   ponte programática, com confirmação do usuário, `model {id, version}` e upload direto dos 6 WAV PCM16 (≤ 57,6 MB/stem). Critério:
   publicação e reprodução por outro membro, com a mesma suíte de emulador já existente. Sem R2 novo (R2 DEV já homologado para WAV).
2. **Modelo no dispositivo:** cache persistente do `.onnx` (OPFS, com SHA-256, fora do precache do PWA, download explícito e
   cancelável), medição real de tempo/memória em desktop e em ao menos um celular de entrada; rejeitar/limitar duração por dispositivo.
   Critério de decisão: RTF e pico de memória medidos, não extrapolados (a extrapolação atual indica ~20 min por música de 3 min em WASM).
3. **Controle de bateria/memória:** execução só em primeiro plano ou com wake lock, pausa/retomada por segmento, limites por classe de
   dispositivo, aviso de consumo; sem processamento em segundo plano.
4. **Mobile (decisão explícita, não implícita):** primeiro apenas **reproduzir** stems já publicados (player de 6 faixas + download
   offline em área privada) em Android/iOS; separação no celular só se a medição do passo 2 justificar (runtime ONNX nativo é grande risco
   de escopo). Nada é prometido para mobile antes dessa decisão.
5. **MP3 v2 (somente depois):** encoder no cliente com alinhamento (Info/LAME, delay 576 + 529, perfil `Lavc`) e/ou transcodificação
   opcional; integrar o decodificador no Web (`audio/mpeg` aceito só para stems MP3, decodificação sequencial); medir Safari/Firefox/
   Android/iOS e arquivos de 300 s; só então avaliar o flip do portão, com autorização separada. R2 produção fora deste plano.

## 5. Gates que permanecem
Revisão Codex Sol 6.2 high (indisponível); clientes Web/mobile para MP3 v2; medições em outros navegadores/dispositivos e com arquivos
grandes; correção da paginação (Média-1); autorização explícita para qualquer habilitação, R2 de produção ou deploy.

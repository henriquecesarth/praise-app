# Decision: player local vinculado a SongVersion

## Status

Proposed. Fase 0 somente documental. Backend e contratos HTTP atuais preservados.

## Context

SongVersion já contém identidade/metadados e a escala já informa música/versão. M21 toca exercícios/piano, sem evidência de mixer de gravação pronto. [Inventário](../audits/2026-11-16-v3-musical/audit.md).

## Decision

Sessão de reprodução acima das rotas Web e telas Flutter, com adaptador de áudio por plataforma. Vínculo exclusivamente local: `(localAccountNamespace, ministryId, songId, versionId) -> packageId + assetId`. `versionId` deve ser o ID canônico resolvido pelo domínio existente; versões legadas usam o adaptador atual, nunca um ID novo inventado. Associação ausente/ambígua exige escolha explícita. Exclusão/recriação de versão invalida o vínculo, sem apagar arquivo pessoal.

Pacote é mídia, não música nem catálogo paralelo. A UI reaproveita detalhe, estante e sequência. Links externos continuam externos: não baixar YouTube, contornar DRM ou extrair mídia de URLs. BPM/key no manifesto são snapshot técnico; não sobrescrevem a versão da API. Transpor a cifra não transpõe automaticamente a gravação.

Contrato proposto de transporte: `load(binding, generation)`, `play`, `pause`, `seek(frame)`, `setRate(rate)`, `setMasterGain(gain)`, `setStemGain(id,gain)`, `setLoop(aFrame,bFrame)`, `stop`, `dispose`; estado `idle/loading/ready/playing/paused/error`. Todas as posições vêm de um relógio único e timeline em frames. Respostas antigas são descartadas por geração e contexto; evitar eventos de sessão anterior mudando UI nova.

Navegar entre módulos mantém a sessão e mini-player visível. Abrir outra música/versão não toca automaticamente: mostra o que está soando; ação explícita “Carregar áudio desta versão” pausa anterior e troca de forma atômica. Nunca exibir áudio antigo como pertencente ao novo contexto. Trocar conta/ministério, logout ou perder autorização detectada interrompe reprodução, invalida vínculo ativo e limpa buffers/handles. Não apagar arquivos silenciosamente. Background/lockscreen não decorre de persistência entre rotas: fica condicionado a spike de plataforma.

## Recursos e modos

| Recurso | Regra proposta / aceite |
| --- | --- |
| Reprodução/seek | Retomar no frame do transporte; limites clamped; não depender de timers de UI |
| Volume/mixer | Volume master do aplicativo e ganho/mute/solo por stem; não prometer volume do sistema no browser; original e stems são modos alternativos para evitar dobrar a mixagem |
| Velocidade | Meta 0,5×–1,5× em Ensaio com pitch preservado e todas as faixas no mesmo relógio; liberar só após medir artefatos/CPU. Se spike falhar, indisponível com motivo; não fingir mudança de BPM |
| Loop A–B | `0 <= A < B <= totalFrames`, mínimo 100 ms; guardar por hash do asset; seek/loop reiniciam todas as faixas juntos; fades curtos medidos para evitar clicks |
| Metrônomo | BPM validado da versão ou ajuste pessoal; compasso/downbeat e offset do beat 1 explícitos, sem inferir BPM confiável de gravação variável |
| Count-in | Quantidade configurável de compassos, mesmo relógio do transporte; não entra no arquivo exportado. BPM/compasso ausentes exigem configuração |
| Modo Ensaio | Loop, velocidade, mixer e ferramentas de estudo; ajustes pessoais locais |
| Modo Culto | Controles grandes, bloqueio de alterações acidentais, metrônomo/count-in/autoavanço desligados por padrão; perfil ensaio não vaza automaticamente |

Metrônomo sobre gravação com rubato só com grade manual válida; sem ela, ferramenta livre explicitamente não sincronizada. Na primeira etapa, metrônomo sai no mesmo dispositivo de áudio: não é monitor separado/saída de clique profissional.

## Mixer e paridade

Web: spike com Web Audio e agendamento no mesmo `AudioContext`; buffers curtos e orçamento de memória explícito. Faixas longas exigem pipeline incremental/streaming, ainda não escolhido. Não carregar todas as músicas/versões em PCM. Flutter: avaliar canal nativo atual e adaptador de decoder/mixer com relógio comum; múltiplos players independentes não provam sincronismo. Biblioteca futura requer autorização na fase de implementação. iOS deve implementar o mesmo contrato e fixtures, com teste real de interrupção/rota de áudio antes de suporte declarado.

Gates propostos: diferença entre stems <=1 frame após normalização/decodificação; erro de seek <=20 ms e deriva <=10 ms em 10 minutos no hardware alvo; ausência de estalos audíveis nos casos curados. São metas, medições **Unknown / Not yet verified**. Bluetooth afeta latência absoluta e exige teste separado. Não usar cronômetro visual como prova de sincronismo.

## Offline, permissões e alternatives

Arquivos locais íntegros podem tocar offline pelo gerenciador local; isso não transforma o repertório inteiro em cache offline. Associação a ministério só é criada com sessão e leitura autorizada verificadas. Offline, acesso a conteúdo já exportado não pode ser revogado remotamente; UI deve distinguir pacote pessoal no dispositivo de autorização atual da API. No namespace da conta, impedir acesso casual de outra conta no mesmo app; sandbox não substitui criptografia contra administrador do dispositivo. Novo login não herda vínculos anteriores.

Alternativas rejeitadas: player por tela (perde sessão), catálogo novo (duplica repertório), upload central (contraria decisão), misturar quatro elementos de áudio independentes (sincronismo não demonstrado). Reuso de M21 limitado a técnicas e componentes com dependências isoladas, sem regressão dos exercícios.

## Evidence

`backend/src/features/repertoire/repertoire.types.ts:16`; `web/src/components/SongDetail.tsx:68`; `mobile/lib/features/repertoire/presentation/views/song_detail_view.dart:124`; `web/src/components/VocalExercisePlayer.tsx:25`; `mobile/lib/features/vocal/presentation/vocal_player_screen.dart:44`.

Agendamento de fontes é suportado por [Web Audio start](https://developer.mozilla.org/en-US/docs/Web/API/AudioBufferSourceNode/start); isso não comprova desempenho do futuro mixer. Pacote e recuperação: [ADR Local First](2026-11-16-v3-musical-local-first-package.md).

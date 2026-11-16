# Decision: arquivos locais e Pacote de Ensaio LouvAIO

## Status

Proposed para o contrato técnico. Restrição de áudio somente local: decisão obrigatória já dada pelo proprietário. Nenhuma implementação ou mudança de schema nesta fase.

## Context

Separação requer espaço, CPU e portabilidade; bancos LouvAIO não são armazenamento de mídia. Android pode receber um arquivo exportado no computador; Web depende das permissões e capacidades do navegador. Não haverá serviço pago de processamento ou transferência central.

## Decision

Originais, stems e temporários são arquivos locais. Índice local guarda nome, tamanho, estado de integridade, referência ao diretório/URI e vínculos de versão; não contém áudio. Nenhum blob/base64/segmento em Firestore, IndexedDB, SQLite ou outro banco do app. OPFS, quando escolhido, armazena arquivos, não registros binários em banco. Manifestos e hashes continuam locais; sem endpoint novo e sem telemetria de conteúdo.

Desktop: diretório de trabalho escolhido pelo usuário, com entrada preservada e saída separada. Android: importar por SAF para diretório privado gerenciado, com exportação explícita via seletor de destino; usar URI e permissões concedidas, nunca caminho absoluto recebido no manifesto. Web: seleção `<input type=file>` como fallback; File System Access como melhoria progressiva em HTTPS/contexto seguro e gesto explícito. Se copiar para OPFS, mostrar uso/quota e necessidade de backup. Handles e caminhos nunca fazem parte da exportação.

### Contrato proposto v1

Arquivo `.louvaio-rehearsal.zip`, ZIP padrão com entradas de áudio em modo STORE (já comprimidas) e `manifest.json` UTF-8. Um pacote descreve uma gravação e suas quatro faixas, não um ministério nem uma biblioteca. Manifesto serializado com campos abaixo; é proposta, não schema instalado:

| Campo | Tipo / regra |
| --- | --- |
| `format`, `formatVersion`, `requiredFeatures` | `louvaio-rehearsal`, inteiro 1, lista de capacidades; versão major desconhecida ou feature obrigatória não suportada bloqueia importação |
| `packageId`, `revision`, `createdAt`, `displayName` | UUID aleatório local, inteiro >=1, timestamp, texto tratado como texto; hash do manifesto/arquivos decide conflito, nunca confiar só no ID |
| `source` | Hash SHA-256 de origem, nome sanitizado, duração em frames e evidência local de direito de uso; sem nome pessoal obrigatório, token ou caminho absoluto |
| `provenance` | Ferramenta/versão, modelo/checkpoint/hash, parâmetros e seed se aplicável, referências às licenças; não embutir pesos |
| `timeline` | sample rate, totalFrames, canais, time origin=0; perfil v1 normalizado 44.100 Hz estéreo, duração idêntica entre stems após decode |
| `original` | Entrada local opcional: arquivo original autorizado; padrão exportável inclui original, mas usuário pode omiti-lo por direitos/tamanho, marcado explicitamente. Original de entrada no computador nunca é apagado |
| `stems` | Exatamente `vocals`, `drums`, `bass`, `other` no perfil v1; cada um com id, path relativo, codec/container, bytes, SHA-256, frames decodificados e canais |
| `alignment` | Trim inicial/final em frames quando codec exigir e origem temporal comum; não alinhar por silêncio ou duração arredondada |
| `practice` | BPM/compasso/offset do primeiro beat e A/B opcionais; metadados pessoais, não altera SongVersion |
| `rights` | Declaração de autorização, escopo de uso/exportação e atribuições. É registro informativo, não prova legal nem DRM |

O vínculo `(ministryId, songId, versionId)` fica fora do pacote portátil por padrão, no índice local da conta. Na importação, usuário escolhe explicitamente a versão autorizada. IDs eventualmente incluídos como dica em evolução futura jamais concedem acesso. Pacote sem original pode ser válido, mas stem ausente/corrompido torna o perfil de quatro faixas incompleto. Número de faixas maior depende da POC e de nova revisão do formato.

### Formatos

| Formato | Qualidade/tamanho | Plataforma e sincronismo | Proposta |
| --- | --- | --- | --- |
| WAV PCM 16/24 bits | Sem perda por codec; grande; conversão 24→16 exige decisão de dither | Simples para comparar frames; validar PCM aceito pelo decoder | Baseline POC; original preservado no formato recebido |
| FLAC 16/24 bits | Lossless; tamanho depende do sinal, sem taxa garantida | Android documenta suporte; Web/iOS exigem teste no decoder/container alvo | Candidato preferido de pacote mestre; não declarar universal |
| Opus/Ogg | Lossy, bom candidato portátil; perfil de teste 128/192 kbit/s estéreo por faixa | Preskip/padding e sample rate decodificado precisam normalização; suporte varia com plataforma/container | Perfil compacto opcional após testes de alinhamento; não substituir mestre |
| AAC-LC/M4A | Lossy; compatibilidade ampla em muitos sistemas | Encoder delay/priming e seeks precisam medir; condições de encoder/distribuição separadas | Fallback se matriz justificar |
| MP3 | Lossy; compatível em muitos ambientes | Delay/padding e seek dificultam precisão | Somente original/entrada; não padrão de stems |

Android documenta FLAC e Opus com versões/contêineres específicos; isso não certifica o futuro plugin Flutter. iOS: suporte efetivo do adaptador é **Unknown / Not yet verified**. Web deve testar decode real de amostra local antes de importar biblioteca grande; extensão/MIME não bastam. Taxa de amostragem comum não garante fase: resample uma única vez com regra determinística, remover delays documentados, preservar zeros iniciais e número de frames.

Exemplo teórico de 5 min / 44,1 kHz / estéreo: WAV16 ≈52,92 MB por arquivo; quatro stems ≈211,68 MB; mais original PCM equivalente ≈264,60 MB. Quatro Opus de 128 kbit/s ≈19,2 MB, sem overhead nem original. FLAC: **Unknown / Not yet verified** até medir. Decode Web float32 de quatro stems completos consome ≈423,36 MB só para amostras; não usar compressão de disco como estimativa de RAM.

### Compatibilidade, corrupção e recuperação

Pré-limites propostos v1, a validar antes da implementação: 2 GiB compactados, 4 GiB extraídos, 32 entradas, manifesto <=256 KiB, profundidade <=3, razão máxima 100:1 e duração <=30 min. Não confundir esses limites de arquivo com capacidade do player: dispositivo/decoder pode rejeitar pacote válido por orçamento de memória. Rejeitar criptografia ZIP, arquivos especiais/symlinks, archives aninhados, entradas duplicadas inclusive colisões case-insensitive/Unicode, caminhos absolutos, drive letters, `..` e separadores alternativos após normalização. Conferir limites pelos bytes realmente lidos, não só pelo cabeçalho ZIP.

Pipeline: inspecionar manifesto e declarar espaço → extrair em staging → validar tamanho/CRC/SHA-256 → decodificar cabeçalhos e validar perfil/timeline → publicar por rename/commit local atômico. Hash detecta corrupção, não autoria; manifesto não é assinatura. Sem rede, conteúdo remoto ou execução de arquivos/scripts. Falha/cancelamento não publica nem sobrescreve pacote bom. Após crash, staging incompleto é marcado para limpeza ou retomada verificável, nunca listado como pronto.

Espaço livre necessário: bytes restantes da cópia do ZIP + bytes extraídos + temporários estimados + reserva `max(256 MiB, 10% do pico previsto)`, sem contar duas vezes entrada já no dispositivo. Exportação reserva ZIP novo além dos arquivos existentes. Consulta de quota é estimativa, toda escrita ainda trata ENOSPC/QuotaExceededError. Se espaço insuficiente: mostrar necessidade e permitir trocar destino/cancelar; não apagar outros pacotes automaticamente.

Hash divergente, stem ausente ou timeline incompatível: estado “incompleto”, sem mixer; permitir excluir staging/reimportar ou localizar backup. Codec não suportado: preservar arquivo e explicar conversão desktop explícita. Mesma identidade/hash: import idempotente; mesmo ID com conteúdo diferente: nova cópia ou confirmação de substituição, sem sobrescrever silenciosamente. Major futuro incompatível: preservar ZIP intacto e pedir cliente compatível.

### Gestão, privacidade e direitos

Gerenciador mostra nome, tamanho, quatro faixas, formato, estado, última verificação, vínculo local e local de armazenamento; permite validar novamente, renomear rótulo, exportar e excluir. Exclusão confirma escopo: cópia gerenciada, vínculo, staging; arquivo de origem/exportação externo só se houver seleção e autorização explícitas. Não prometer apagar backups nem apagamento seguro em SSD. Desinstalar Android ou limpar dados/site pode remover arquivos privados/OPFS; oferecer exportação antes e explicar perda potencial.

Sem compartilhamento automático entre ministérios, contas ou dispositivos. Namespace local por conta; troca de conta libera handles e não lista a biblioteca anterior. Pacotes de gravações pessoais não viram recursos ministeriais pela associação. Exportação manual implica nova verificação de direitos de gravação, composição, intérpretes e dados pessoais; possuir um link ou conseguir ouvir não autoriza processamento/distribuição. Revogação de acesso no servidor não revoga cópias já exportadas; comunicar essa limitação. Nenhuma API/telemetria recebe nomes/hashes/áudio do pacote por acidente.

## Alternatives Considered

Cloud Storage/Firestore: rejeitados pelo requisito e custo. Binários em banco local: rejeitados para manter fronteira de arquivos explícita. Arquivos soltos sem manifesto: difíceis de validar/migrar; ZIP+manifest recomendado. Opus exclusivo: economiza espaço, mas aumenta risco de perdas e desalinhamento. FLAC exclusivo sem fallback: depende de homologação por decoder.

Transferência LAN peer-to-peer fica futura: pareamento explícito, autenticação de ambos, canal protegido, consentimento de envio/recebimento, expiração, integridade e retomada; sem listener, descoberta ou implementação na Fase 0. Rede local não é automaticamente confiável.

## Evidence

- [Android formatos](https://developer.android.com/media/platform/supported-formats), [SAF](https://developer.android.com/training/data-storage/shared/documents-files), [diretório privado](https://developer.android.com/training/data-storage/app-specific).
- [Chrome File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access), [MDN OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), [quotas/evicção](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- [FLAC](https://xiph.org/flac/format.html), [Opus em Ogg / RFC 7845](https://www.rfc-editor.org/rfc/rfc7845).

Fontes consultadas para planejamento em 2026-11-16; nenhum pacote ou decoder foi executado.

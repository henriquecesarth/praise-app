# M22-C — Biblioteca Ministerial experimental

O fluxo parte do mixer M22-B em `389d6f83cf3d615fa82e77e6d96e92948b7765ab`. Um administrador informa os metadados, seleciona os seis WAVs exportados e confirma a publicação. Um membro ativo encontra a gravação e carrega as seis faixas diretamente no mixer Web Audio. O frontend chama a API Express pelo cliente em `web/src/api.ts`.

## Acesso e estados

- A API usa Bearer e as regras de pertencimento existentes. O proprietário ou um administrador pode reservar, enviar, publicar, editar, arquivar e processar a fila de expiração. Membros ativos podem pesquisar e reproduzir. A sessão identifica o usuário e o caminho identifica o ministério.
- A reserva, a confirmação de cada faixa, a publicação, a edição, o arquivamento e a expiração usam transações de metadados. A validação dos bytes e a remoção de objetos ficam fora delas. A publicação relê a autorização e o estado no momento da transação.
- Uma chave de idempotência de 16–128 caracteres alfanuméricos, hífen ou sublinhado é isolada por usuário e ministério. Repetir os mesmos metadados e manifesto recupera o upload. Dados diferentes com a mesma chave retornam 409. Uma sessão fica disponível por 24 horas. O limite é de oito reservas ativas por ministério.
- Cada PUT valida bytes em fluxo e instala o arquivo completo de forma condicional. PUTs interrompidos podem ser repetidos desde o início da faixa. Faixas confirmadas permanecem disponíveis. Se os bytes forem aceitos e a confirmação no Firestore falhar, um administrador pode repetir o PUT para concluir a transação. A finalização exige seis confirmações autorizadas, verifica os seis objetos armazenados e converge para um único estado publicado.
- O arquivamento retira a gravação da listagem e invalida novos acessos às faixas, preservando o manifesto e os WAVs. A limpeza atua somente em reservas expiradas, em até dez registros por chamada, com prazo para nova tentativa e uma segunda passagem para objetos que chegaram durante a expiração.

## Contrato HTTP

Base `/api/v1/ministries/:ministryId/audio-library`. Operações bem-sucedidas retornam 200. Os timestamps são epoch em milissegundos. A API usa o formato de erro existente `{error:{message,details}}`.

| Método e caminho | Permissão | Entrada e resultado |
| --- | --- | --- |
| `GET /` | Membro | `q`, `limit` de 1 a 30, `cursor`. Retorna `{items,nextCursor}` com músicas publicadas. A busca por substring em título, artista ou versão ignora acentos e maiúsculas. Cada chamada examina até 50 registros e pode retornar itens vazios com cursor para continuação. |
| `POST /uploads` | Admin | `{idempotencyKey,confirmed:true,title,artist,version,model,stems}`. Retorna `{id,status,uploadedStemIds,expiresAt}`. |
| `GET /uploads/:id` | Admin | Retorna o progresso e a data de expiração da sessão. |
| `PUT /uploads/:id/stems/:stemId` | Admin | Bytes do WAV com `Content-Type: audio/wav`. Retorna o progresso atualizado. |
| `POST /uploads/:id/finalize` | Admin | Valida todos os objetos e retorna `{id,title,artist,version,status,updatedAt}`. |
| `PATCH /:id` | Admin | Atualiza `{title,artist,version}` de uma gravação publicada. O manifesto preserva a versão identificada no envio. |
| `POST /:id/archive` | Admin | Arquiva a gravação publicada de forma idempotente. Retorna o registro resumido. |
| `GET /:id/playback` | Membro | Retorna `{manifest,tracks:[{id,url}],expiresAt}` para gravações publicadas. URLs relativas à base da biblioteca. |
| `GET /:id/stems/:stemId?ticket=…` | Membro com URL válida | WAV verificado, `Cache-Control: private, no-store`. O token dura 120 segundos e vincula usuário, ministério, gravação e faixa. O backend revalida a publicação e o pertencimento ao entregar o arquivo. |
| `POST /uploads/cleanup` | Admin | Processa um lote de reservas expiradas do ministério. Retorna `{cleaned}`. |

401 é usado para ausência de sessão válida, 403 para permissão ou concessão inválida e 404 para gravações inexistentes ou indisponíveis naquela biblioteca. 409 cobre conflito de idempotência, sessão encerrada e objetos ausentes ou divergentes durante finalização ou reprodução. Um WAV que diverge do manifesto no upload retorna 422 e os limites de concorrência retornam 429.

## Firestore e manifesto

`ministries/{ministryId}/audio_recordings/{id}` mantém `id`, `ministryId`, `createdBy`, `title`, `artist`, `version`, `status`, `manifest`, `requestHash`, `uploadedStemIds` e timestamps. `uploadDeadline` controla reservas ativas, `publishedAt` ordena o catálogo visível e `cleanupAfter` seleciona lotes de expiração. O estado progride de `uploading` a `published` ou `expired`, e de `published` a `archived`. A chave lógica de armazenamento é `{ministryId}/{id}/{stemId}.wav`, derivada no backend.

O manifesto imutável inclui `schemaVersion:1`, `recordingId`, `recordingVersion`, `model:{id,version}` e `stems`. Cada faixa contém `id`, `codec:"pcm_s16le"`, `sampleRate`, `channels:2`, `durationSeconds`, `frames`, `sizeBytes` e `sha256`. Os IDs são `vocals`, `drums`, `bass`, `guitar`, `piano` e `other`. As faixas têm os mesmos frames e taxa, entre 8 e 48 kHz, até 300 segundos, com cabeçalho PCM16 canônico de 44 bytes. Isso aceita a saída de 44,1 kHz do M22-B. O servidor mede o tamanho, lê o cabeçalho e calcula o SHA-256 das amostras e do cabeçalho em fluxo. A indicação de modelo é metadado declarado pelo publicador.

`AudioManifest` e `StemStorage` podem ser reutilizados em outro catálogo com suas próprias regras de acesso e chaves. Um novo codec exige outra versão do esquema ou um perfil validado para seus metadados e bytes.

## Execução local

Requer Node, o Firebase CLI já presente nas dependências do backend e Java compatível com o Firestore Emulator. A configuração usa o projeto de demonstração `demo-louvaio-unit`, Firestore em `127.0.0.1:8186` e Auth em `127.0.0.1:9098`.

```powershell
# Em backend, primeiro terminal
npx --no-install firebase emulators:start --only firestore,auth --project demo-louvaio-unit --config d2b-emulator.config.json

# Em backend, integração HTTP
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8186'
$env:METADATA_SERVER_DETECTION = 'none'
npm run test:integration -- src/features/ministry_audio/ministry-audio.integration.test.ts

# Em web, Chromium com API e Vite iniciados pelo próprio teste
npm run test:e2e -- --config playwright.m22c.config.ts
```

O servidor experimental exige `MINISTRY_AUDIO_EMULATOR=1`, `LOUVAIO_LOCAL_EMULATORS=1`, `NODE_ENV=test`, identificação de projeto `demo-…` e ambos os emuladores em loopback. A aplicação Web exige `VITE_MINISTRY_AUDIO_EMULATOR=1`, modo dev ou test e `VITE_API_URL` em HTTP loopback. O teste Chromium define essas variáveis, cria perfis no Auth Emulator e usa seus ID tokens nos contextos do navegador. `MINISTRY_AUDIO_SIMULATOR_DIR` aponta para um diretório privado dedicado ao simulador. O mesmo diretório preserva objetos entre reinícios do backend. Tickets emitidos antes do reinício precisam ser renovados.

## Evidência

| Verificação | Resultado |
| --- | --- |
| `npm run test:integration -- src/features/ministry_audio/ministry-audio.integration.test.ts` | PASS, 11 cenários HTTP com Firestore Emulator. Inclui upload e retomada, idempotência, finalizações concorrentes, RBAC, troca de ministério, revogação, falha e recuperação da publicação, adulteração, reprodução byte a byte e limpeza concorrente. |
| `npm run test:e2e -- --config playwright.m22c.config.ts` | PASS, Chromium. Um administrador confirma a publicação de seis WAVs e outro membro os carrega em uma sessão separada. O teste observa seis inícios com o mesmo timestamp Web Audio e zero requisições de modelo ou worker Demucs. |
| `npm test` no backend | PASS, 2.622 testes, incluindo 11 do storage simulado. |
| `npm test -- --maxWorkers=2` na Web | PASS, 1.271 testes. A execução inicial em paralelo com build e E2E registrou três timeouts, um no mixer e dois em exercícios vocais. |
| Build do backend e build Web em `--mode test` | PASS. O build local Web emite artefatos do runtime ONNX e zero arquivos de pesos `.onnx`. O build padrão Web exige o ambiente de publicação. |

A revisão independente no Codex encontrou uma corrida entre revogação do papel de administrador e conclusão do PUT. O teste falhou antes da correção e passou após exigir seis confirmações autorizadas na transação de publicação. A revisão final também verificou o limite da busca e a liberação dos WAVs depois da captura do mixer. O tamanho máximo em navegadores permanece como limitação de homologação.

## Limitações e homologação R2

- O proxy simulado verifica e copia um snapshot temporário antes de entregar o WAV. A API trabalha com streams e aplica um limite de doze operações simultâneas por processo. Em desenvolvimento com disco local, um encerramento abrupto pode deixar arquivos de staging. A expiração cobre os objetos finais de reservas, e a limpeza é chamada explicitamente por um administrador.
- O mixer descarta as entradas WAV durante o preparo e aloca somente um par de canais temporários por vez. Os seis AudioBuffers finais no limite de 300 segundos a 48 kHz ainda representam cerca de 659 MiB, além das alocações temporárias do carregamento. O comportamento nesse limite em dispositivos reais é **Unknown / Not yet verified**. A retomada após recarregar a mesma aba exige selecionar os mesmos arquivos e informar os mesmos metadados. O navegador conserva apenas o hash da solicitação e a chave de retomada.
- A sessão do navegador pode cancelar trabalho e liberar o mixer na troca de contexto. Revogação bloqueia novos downloads, inclusive com tickets anteriores. Bytes já entregues ao membro podem continuar disponíveis no dispositivo.
- FLAC é candidato para preservar amostras PCM com compressão sem perdas. Opus é candidato para perfis com maior economia que tolerem perdas. Antes de escolher, medir redução de bytes, leitura, decodificação por navegador, alinhamento de frames e qualidade em comparação cega por faixa, incluindo guitarra e piano. A qualidade perceptiva de todos os instrumentos é **Unknown / Not yet verified**. [FLAC, RFC 9639](https://www.rfc-editor.org/info/rfc9639/) · [Opus, RFC 6716](https://www.rfc-editor.org/info/rfc6716/)

1. Com autorização posterior, usar um bucket de homologação privado separado, sem endpoint público, com permissões limitadas a objetos e prefixos necessários. Validar bloqueio de acesso direto e a regra de Firestore que mantém os metadados acessíveis pelo backend.
2. Implementar o adaptador com chave imutável e escrita condicional `If-None-Match: *`. Testar a condição contra PUTs simultâneos e substituição, validar SHA-256 real em fluxo e registrar como a versão verificada fica vinculada à leitura. Separar staging, rejeitar promoção de conteúdo divergente e exercitar retomada com falhas entre R2 e Firestore. [Operações condicionais R2](https://developers.cloudflare.com/r2/api/s3/conditional-operations/) · [Compatibilidade S3](https://developers.cloudflare.com/r2/api/s3/api/)
3. Medir tempo, memória e transferências para as seis faixas no limite. Comparar proxy autenticado com GET pré-assinado de TTL curto. Um GET pré-assinado é utilizável por quem possui o link até expirar, então a decisão precisa verificar o requisito de revogação com URLs anteriores. Caso se use leitura direta pelo navegador, homologar CORS por origem e os cabeçalhos necessários. [URLs pré-assinadas](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) · [CORS do R2](https://developers.cloudflare.com/r2/buckets/cors/)
4. Homologar expiração no prefixo de staging, reprocessamento idempotente, fragmentos de multipart abandonados e proteção dos objetos publicados ou arquivados. Qualquer reaproveitamento futuro de bytes exige vínculo e autorização próprios e avaliação de direitos da gravação. [Ciclo de vida no R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

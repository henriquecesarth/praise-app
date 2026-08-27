# Integrations and Persistence

## Firebase Admin SDK

**Purpose:** identidade administrativa e persistência Firestore.

**Implementation:** backend/src/lib/firebase.ts inicializa uma única app. Quando project ID, client e private key existem, usa cert; caso contrário inicializa somente com projectId padrão/local.

**Configuration names:**

- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- FIREBASE_DATABASE_URL

Nenhum valor é documentado.

**Direction:** backend → Firebase.

**Authentication:** service account quando as três credenciais principais estão presentes.

**Errors:** repositories normalmente transformam erros esperados em AppError ou deixam o erro chegar ao handler global. Alguns fluxos capturam e apenas registram.

**Retries:** nenhum retry, timeout ou circuit breaker explícito.

**Risks:** ausência de configuração de emulator, regras/índices versionados, schema/migrations e health check real do Firebase. O fallback de inicialização não garante que operações remotas funcionem.

## Firebase Authentication and Identity Toolkit

Signup usa Firebase Admin createUser. Login usa o endpoint accounts:signInWithPassword quando FIREBASE_WEB_API_KEY está configurada e depois emite um JWT da própria API.

Configuração adicional:

- FIREBASE_WEB_API_KEY
- JWT_SECRET

Não há refresh token da API, revogação, rotação de chaves ou rate limiting no código. O fallback de login sem Web API Key não valida senha e está catalogado em INC-004.

## Cloud Firestore Collections

Não existe schema versionado. A tabela abaixo é inferida dos repositories:

| Area | Collections | Relationships |
| --- | --- | --- |
| Identity | users | document ID igual ao Firebase uid quando criado pelo signup |
| Active tenancy | ministries, ministry_members, ministry_invites | ministry_id e user_id como strings |
| Legacy tenancy | groups, group_members, group_invites | módulo dedicado não montado; group_members ainda aparece na confirmação de escala |
| Repertoire | songs, artists, ministry_classifications, folders, folder_songs | ministry_id; folder_id/song_id; snapshots opcionais em songs |
| Planning | schedules, schedule_comments | ministry_id e schedule_id; arrays embedded em schedules |
| Teams/functions | ministry_teams, ministry_roles | ministry_id; member_ids/role_ids como arrays |
| Templates | ministry_schedule_templates | items embedded no documento |
| Liturgies | liturgies, liturgy_items | group_id no pai e liturgy_id nos itens |
| Chords | smart_chords | user_id, song_id e artist_id, sem filtro efetivo na listagem |

Consultas e ordenações frequentemente ocorrem em memória para evitar índices compostos. Integridade referencial e exclusão em cascata não são gerais.

## Vercel

- backend/vercel.json usa backend/src/app.ts com @vercel/node e redireciona todos os caminhos para o app.
- web/vercel.json reescreve todos os caminhos para index.html.

Não existe arquivo de pipeline, comando de deploy, environment mapping ou rollback no repositório. Deploy real: Unknown / Not yet verified.

## Browser CDNs

web/index.html carrega:

- Outfit via fonts.googleapis.com/fonts.gstatic.com;
- html2pdf.js 0.10.1 via cdnjs.cloudflare.com.

O PDF depende de window.html2pdf. Não há fallback empacotado, SRI ou política CSP no repositório. Falhas de rede são tratadas somente pela disponibilidade natural do recurso no browser.

## PWA/Service Worker

vite-plugin-pwa e Workbox geram manifest e service worker no build. O precache contém somente shell e assets estáticos revisionados; não existe runtime cache de API. O cliente informa estados offline/atualização e o Playwright valida o fallback `offline.html` no preview de produção.

## Supabase

@supabase/supabase-js ainda está em dependencies, mas backend/src/lib/supabase.ts está explicitamente deprecated e retorna null. backend/src/config/env.ts mantém nomes Supabase como strings vazias. Nenhuma chamada ativa ao cliente foi encontrada.

Status: integração legada/incompleta, não persistência atual.

## External Links in Product Data

Músicas podem conter URLs de cifra, YouTube, áudio e links arbitrários. A UI abre/normaliza links, mas o backend apenas valida alguns campos como URL via Zod. Conteúdo remoto não é baixado pelo backend.

## Absent Integrations

- mensageria/event bus;
- jobs/background services;
- e-mail/SMS/push;
- provedor de pagamentos;
- analytics/APM;
- armazenamento de arquivos;
- CI/CD.

Não inferir sua existência a partir de campos como subscription_status ou de elementos visuais.

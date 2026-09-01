# Integrations and Persistence

## Firebase Admin SDK

**Purpose:** identidade administrativa e persistência Firestore.

**Implementation:** backend/src/lib/firebase.ts inicializa uma única app. Quando project ID, client e private key existem, usa cert; caso contrário inicializa somente com projectId padrão/local.

**Configuration names:**

- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- FIREBASE_DATABASE_URL

Nenhum valor sensível é documentado.

**Direction:** backend → Firebase.

**Authentication:** service account quando as três credenciais principais estão presentes.

**Errors:** repositories normalmente transformam erros esperados em AppError ou deixam o erro chegar ao handler global.

**Risks:** ausência de regras/índices versionados no deploy automatizado e schema/migrations SQL.

## Firebase Authentication and Identity Toolkit

Signup usa Firebase Admin createUser. Login usa o endpoint Identity Toolkit REST `accounts:signInWithPassword` quando FIREBASE_WEB_API_KEY está configurada e emite um JWT da própria API (com validação criptográfica estrita).

Configuração adicional:

- FIREBASE_WEB_API_KEY
- JWT_SECRET

## Asaas Payment Gateway (v3)

**Purpose:** processamento financeiro de assinaturas recorrentes no cartão de crédito, emissão de sessões hospedadas de checkout e notificações transacionais de cobrança.

**Implementation:** `backend/src/features/billing/providers/asaas/asaas.provider.ts` implementa a interface `BillingProvider`. Comunica-se com a API REST v3 do Asaas (`/v3/checkouts`, `/v3/subscriptions`, `/v3/payments`, `/v3/customers`).

**Configuration names:**

- ASAAS_API_URL
- ASAAS_API_KEY
- ASAAS_WEBHOOK_TOKEN
- ASAAS_ENVIRONMENT
- BILLING_PUBLIC_API_URL
- WEB_APP_URL
- BILLING_TIMEZONE

**Direction:** backend → Asaas API v3 (REST); Asaas → backend (Webhooks HTTPS em `/api/v1/billing/webhooks/asaas`).

**Authentication:** `access_token` no header das requisições de saída; header `asaas-access-token` validado com `crypto.timingSafeEqual` no webhook de entrada.

**Status:** Integração implementada com fluxos principais homologados em ambiente Sandbox (incluindo GAP-011 revalidado); gap conhecido (GAP-012) permanece em aberto; deploy/configuração de produção não devem ser presumidos.

**Known Implementation Gap:** GAP-012 (Same-Plan Interval Change na UI) permanece aberto. GAP-011 (Asaas Customer Reuse) foi integralmente implementado, protegido contra concorrência e revalidado com sucesso em Sandbox.

## Billing Reconciler Worker

**Purpose:** reconciliação periódica de transições de plano (`supersede`) em background com suporte a retries atômicos, lease/locks transacionais multi-instância e detecção de anomalias financeiras.

**Implementation:** `backend/src/features/billing/billing-reconciler.worker.ts`, inicializado no `server.ts`.

**Configuration names:**

- BILLING_RECONCILIATION_ENABLED (desativado automaticamente quando `NODE_ENV === 'test'`)
- BILLING_RECONCILIATION_INTERVAL_MINUTES (padrão: 15 minutos)

## Cloud Firestore Collections

Não existe schema SQL versionado. A tabela abaixo documenta as coleções ativas do sistema:

| Area | Collections | Relationships |
| --- | --- | --- |
| Identity | users | document ID igual ao Firebase uid quando criado pelo signup |
| Active tenancy | ministries, ministry_members, ministry_invites | ministry_id e user_id como strings |
| Product entitlement | ministry_subscriptions, ministry_usage | ministry_id como document ID; quotas operacionais e accessMode |
| Billing & Payments | billing_customers | `${ministry_id}_${provider}`; vínculo de cliente no gateway |
| Billing & Payments | billing_subscriptions | `${ministry_id}_${provider}`; estado da assinatura recorrente no gateway |
| Billing & Payments | billing_transactions | `${provider}_${provider_payment_id}`; histórico financeiro de faturas |
| Billing & Payments | billing_webhook_events | `${provider}_${provider_event_id}`; controle de concorrência e idempotência atômica |
| Billing & Payments | billing_plan_changes | `checkout_intent_id`; isolamento de transição de planos e controle de supersede/cleanup |
| Repertoire | songs, artists, ministry_classifications, folders, folder_songs | ministry_id; folder_id/song_id; snapshots opcionais em songs |
| Planning | schedules, schedule_comments | ministry_id e schedule_id; arrays embedded em schedules |
| Teams/functions | ministry_teams, ministry_roles | ministry_id; member_ids/role_ids como arrays |
| Templates | ministry_schedule_templates | items embedded no documento |
| Liturgies | liturgies, liturgy_items | group_id/ministry_id no pai e liturgy_id nos itens |
| Chords | smart_chords | user_id, song_id e artist_id; filtrado estritamente por user_id |
| Legacy tenancy | groups, group_members, group_invites | módulo dedicado não montado diretamente |

## Vercel

- backend/vercel.json usa backend/src/app.ts com @vercel/node e redireciona todos os caminhos para o app.
- web/vercel.json reescreve todos os caminhos para index.html.

## Browser CDNs

web/index.html carrega:

- Outfit via fonts.googleapis.com/fonts.gstatic.com;
- html2pdf.js 0.10.1 via cdnjs.cloudflare.com.

## PWA/Service Worker

vite-plugin-pwa e Workbox geram manifest e service worker no build. O precache contém somente shell e assets estáticos revisionados; não existe runtime cache de API. O cliente informa estados offline/atualização e o Playwright valida o fallback `offline.html` no preview de produção.

## Supabase

@supabase/supabase-js ainda está em dependencies, mas backend/src/lib/supabase.ts está explicitamente deprecated e retorna null. backend/src/config/env.ts mantém nomes Supabase como strings vazias. Nenhuma chamada ativa ao cliente é realizada.

Status: integração legada/inativa, não é persistência atual.

## Absent Integrations

- mensageria/event bus externo dedicado (Kafka, RabbitMQ, etc.);
- e-mail/SMS/push direto via gateway terceiro dedicado;
- analytics/APM corporativo dedicado;
- armazenamento de arquivos/S3 externo dedicado;
- CI/CD automatizado no repositório.

Não inferir sua existência a partir de campos visuais ou mockups.

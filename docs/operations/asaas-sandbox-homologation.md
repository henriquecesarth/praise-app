# Guia de Homologação Asaas Sandbox & Operação de Billing

Este documento descreve os procedimentos operacionais, validações de segurança, variáveis de ambiente e testes de ponta a ponta para a homologação do gateway **Asaas (v3)** no LouvAIO.

---

## 1. Configuração do Ambiente Sandbox

Para conectar o LouvAIO ao Sandbox do Asaas:

1. Acesse o painel de Sandbox: [https://sandbox.asaas.com](https://sandbox.asaas.com)
2. Gere a Chave de API em **Configurações da Conta > Integrações > Chaves de API**.
3. Configure as seguintes variáveis no arquivo `.env` do backend:

```env
NODE_ENV=development
PORT=3000
PLATFORM_ADMIN_SECRET="sua-chave-secreta-de-super-admin-da-plataforma"

# Configurações do Asaas Sandbox
ASAAS_ENVIRONMENT=sandbox
ASAAS_API_URL="https://sandbox.asaas.com/api/v3"
ASAAS_API_KEY="$aact_YTU5YTE0M2M6N2I4..."
ASAAS_WEBHOOK_TOKEN="token-secreto-definido-no-painel-do-asaas"
```

> [!CAUTION]
> **Nunca comite chaves privadas ou tokens reais no repositório Git**.

---

## 2. Configuração do Webhook no Painel Asaas

1. Acesse **Configurações > Integrações > Webhooks > Webhook para Cobranças**.
2. URL do Webhook: `https://api.seudominio.com/api/v1/billing/webhooks/asaas` (ou URL do `ngrok` em desenvolvimento local).
3. **Token de Autenticação**: Insira o mesmo valor definido em `ASAAS_WEBHOOK_TOKEN`.
4. Eventos obrigatórios a habilitar:
   - `PAYMENT_CONFIRMED`
   - `PAYMENT_RECEIVED`
   - `PAYMENT_OVERDUE`
   - `PAYMENT_DELETED`
   - `PAYMENT_REFUNDED`
   - `SUBSCRIPTION_INACTIVATED`
   - `SUBSCRIPTION_DELETED`

---

## 3. Controles de Segurança & Invariantes Implementados

### 3.1. Idempotência Atômica de Webhooks (P0)
- **ID Determinístico**: Todo evento recebido é indexado por `${provider}_${provider_event_id}` na coleção `billing_webhook_events`.
- **Lock Transacional Atômico**: Utiliza `db.runTransaction` do Firestore. Se 10 requisições simultâneas do mesmo evento chegarem ao mesmo tempo, exatamente 1 adquire o lock e processa o negócio; as outras 9 retornam imediatamente `{ status: 'ok', processed: false, reason: 'duplicate_event' }`.
- **Deduplicação de Transações**: A coleção `billing_transactions` utiliza ID `${provider}_${provider_payment_id}`, impedindo duplicidade contábil.

### 3.2. Proteção Contra Double Checkout (P0)
- Ao solicitar checkout (`POST /billing/checkout`), o backend verifica se já existe uma sessão `pending` para aquele ministério com o mesmo plano, ciclo e add-ons criada há menos de 15 minutos.
- Em caso afirmativo, reutiliza a URL de checkout hospedada existente sem criar nova assinatura ou cliente no Asaas.

### 3.3. Invariante de 1 Assinatura Ativa por Ministério
- O LouvAIO mantém `billing_subscriptions` chaveado por `${ministryId}_${provider}`. Ao confirmar o pagamento de um upgrade/downgrade, a assinatura anterior no gateway é cancelada automaticamente no gateway para impedir dupla cobrança recorrente.

### 3.4. Validação de Valor & Moeda (Amount Validation)
- Ao receber `PAYMENT_CONFIRMED`, o backend calcula o valor oficial do plano via `calculatePlanPriceCents(plan_id, interval, addon_blocks)`.
- Se o valor pago for inferior ao esperado (ex: pagamento de R$ 14,90 para plano Premium de R$ 214,90), a mutação é bloqueada, o evento é marcado como `failed` e um log de anomalia de segurança é disparado.

### 3.5. Proteção Contra Eventos Fora de Ordem (Out-of-Order Guards)
- Se um evento `PAYMENT_OVERDUE` atrasado chegar após a confirmação de um ciclo novo (`PAYMENT_CONFIRMED`), a assinatura ativa é preservada e o evento antigo é ignorado.

---

## 4. Planos Cortesia (`Complimentary Plans`)

### 4.1. Regras de Negócio
- Concessão administrativa (ex: igrejas parceiras, beta testers, convenções).
- `subscription_mode = 'complimentary'`.
- **Zero chamadas ao Asaas**: Não cria cliente, checkout, faturas nem gera cobranças no gateway.
- Entitlement oficial idêntico ao plano concedido (ex: Pro, Premium).
- Suporte a expiração com prazo (`expires_at`) ou sem prazo (`expires_at = null`).
- Revogação preserva dados do ministério (abre carência de 7 dias caso o uso ultrapasse o plano Free).
- Transição segura para plano pago caso o ministério decida assinar.

### 4.2. Segurança e Operação Administrativa (Platform Admin)
- **Política de Segurança para Produção**: Em ambientes de produção (`NODE_ENV === 'production'`), a rota HTTP administrativa (`/api/v1/admin/*`) é **automaticamente bloqueada com HTTP 403 Forbidden**, eliminando qualquer superfície de ataque pública baseada em senha mestre (`x-platform-admin-secret`).
- **Operação Via CLI**: A concessão e revogação de planos de cortesia são realizadas exclusivamente via script CLI seguro no servidor:
```bash
# Conceder cortesia:
npx ts-node scripts/grant-complimentary.ts <ministryId> <planId> [grantedBy] [grantReason] [expiresInDays]

# Exemplo:
npx ts-node scripts/grant-complimentary.ts min_abc123 premium "admin@louvaio.com" "Parceria Igreja Central" 365
```

---

## 5. Validação de Contrato & Valor (Amount Validation)

O processamento do webhook do Asaas valida com precisão matemática o valor esperado da assinatura:
- **Plano**: `plan_id`
- **Ciclo**: `interval` (anual com 10% de desconto)
- **Add-ons**: `member_addon_blocks` (+10 membros por bloco)
- **Moeda**: `currency = BRL`
- **Correspondência**: `paidAmountCents === expectedPriceCents` (divergências geram rejeição, status `failed` no log de auditoria e nenhum entitlement é concedido).

---

## 6. Reconciliação com o Gateway

Administradores de ministério podem acionar a reconciliação sob demanda:
```http
POST /api/v1/ministries/:ministryId/billing/reconcile
Authorization: Bearer <TOKEN_JWT_ADMIN_MINISTERIO>
```
O backend consulta a assinatura no Asaas, compara com o estado local e sincroniza divergências de forma segura.

# Google Cloud Scheduler Setup & Contract (Phase 7D1-B-R2)

## 1. Context & Hosting Invariant

LouvAIO's production backend is deployed on Vercel under the **Hobby (Free)** plan.
The Vercel Hobby tier does not support minute-level crons (e.g. `*/5 * * * *`), which are restricted to Vercel Pro/Enterprise accounts.

To maintain strict adherence to the zero-user-action durable lifecycle without incurring hosting plan upgrades or weakening distributed-systems guarantees:
- **Durable Executor**: Google Cloud Scheduler (on Google Cloud / Firebase project `praise-app-7a362`).
- **Vercel Plan**: Hobby.
- **Vercel Cron**: NOT USED for Phase 7D1. (Removed from `backend/vercel.json`).
- **Cadence**: Every 5 minutes (`*/5 * * * *`).

---

## 2. Job Contracts

Both jobs target canonical internal HTTP routes protected by `CRON_SECRET`.

### Job 1: WhatsApp Cleanup Executor
- **Job Name**: `praise-whatsapp-cleanup-executor`
- **Project**: `praise-app-7a362`
- **Region**: `us-central1` (or canonical project App Engine / Cloud Scheduler region)
- **Schedule**: `*/5 * * * *` (every 5 minutes)
- **Timezone**: `America/Sao_Paulo`
- **HTTP Method**: `GET`
- **Target URL**: `${BACKEND_BASE_URL}/api/v1/internal/whatsapp/cleanup-jobs/execute`
- **HTTP Headers**:
  - `Authorization`: `Bearer <CRON_SECRET>`
  - `User-Agent`: `Google-Cloud-Scheduler/LouvAIO`
- **Attempt Deadline**: `60s`
- **Retry Configuration**:
  - `--max-retry-attempts=3`
  - `--min-backoff=10s`
  - `--max-backoff=60s`
- **Response Handling**:
  - `200 OK`: Successful cycle with summary JSON (`{ executed, succeeded, failed, remaining }`).
  - Cache headers returned: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Pragma: no-cache`, `Expires: 0`.

### Job 2: WhatsApp WABA Reconciliation Executor
- **Job Name**: `praise-whatsapp-reconciliation-executor`
- **Project**: `praise-app-7a362`
- **Region**: `us-central1`
- **Schedule**: `*/5 * * * *` (every 5 minutes)
- **Timezone**: `America/Sao_Paulo`
- **HTTP Method**: `GET`
- **Target URL**: `${BACKEND_BASE_URL}/api/v1/internal/whatsapp/reconciliation-jobs/execute`
- **HTTP Headers**:
  - `Authorization`: `Bearer <CRON_SECRET>`
  - `User-Agent`: `Google-Cloud-Scheduler/LouvAIO`
- **Attempt Deadline**: `60s`
- **Retry Configuration**:
  - `--max-retry-attempts=3`
  - `--min-backoff=10s`
  - `--max-backoff=60s`
- **Response Handling**:
  - `200 OK`: Successful cycle with summary JSON (`{ executed, succeeded, failed, remaining }`).
  - Cache headers returned: `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Pragma: no-cache`, `Expires: 0`.

---

## 3. Idempotency & Overlap Safety

Cloud Scheduler guarantees *at-least-once* delivery, meaning duplicate or overlapping scheduler requests may occur.
The backend routes are designed for strict concurrency resilience:
1. **Atomic Transactional Leasing**: `acquireJobLease` locks each eligible job in Cloud Firestore under an atomic transaction, marking it `processing`, incrementing `attempt_count`, and assigning a 60-second lease with unique `lease_owner_id`.
2. **Duplicate Invocations**: If Cloud Scheduler triggers a duplicate request while an existing execution is in progress, the second worker query finds 0 unleased jobs and exits immediately with HTTP 200 without racing or duplicating remote side-effects.
3. **Crash Recovery**: If an execution worker crashes or times out mid-flight, its lease expires (`lease_expires_at <= now`). On the next 5-minute tick, `findDueJobs` discovers the expired lease and reclaims it automatically with an incremented attempt count.
4. **Soft-Budget Safety**: Workers stop acquiring new jobs when elapsed execution reaches 45 seconds, providing a 15-second safety buffer before the 60-second HTTP timeout.

---

## 4. Security & Separation of Authority

- **Machine Authority (`CRON_SECRET`)**:
  - Used exclusively by Google Cloud Scheduler to trigger autonomous batch cycles.
  - Cannot invoke operator manual routes (`/override-lease`, `/force-abandon` reject with `403 FORBIDDEN`).
  - Compared in constant time via `crypto.timingSafeEqual` over SHA-256 digests.
- **Operator Authority (`INTERNAL_OPERATOR_SECRET`)**:
  - Used strictly for authenticated human operator emergency interventions.
  - Cannot trigger scheduled execution routes (rejects with `401 UNAUTHORIZED`).
- **Invariant**: `CRON_SECRET != INTERNAL_OPERATOR_SECRET`. Neither secret is ever exposed to the frontend web application.

---

## 5. Deployment Commands

The deployment artifact is located at `backend/scripts/deploy-cloud-schedulers.sh`.

To deploy or update both Cloud Scheduler jobs once authorized:

```bash
export CRON_SECRET="your-strong-random-cron-secret"
export BACKEND_BASE_URL="https://praise-app-gray.vercel.app"
export PROJECT_ID="praise-app-7a362"
export REGION="us-central1"

./backend/scripts/deploy-cloud-schedulers.sh
```

Or execute directly via `gcloud`:

```bash
# 1. Cleanup Executor Job
gcloud scheduler jobs create http praise-whatsapp-cleanup-executor \
  --project="praise-app-7a362" \
  --location="us-central1" \
  --schedule="*/5 * * * *" \
  --time-zone="America/Sao_Paulo" \
  --uri="https://praise-app-gray.vercel.app/api/v1/internal/whatsapp/cleanup-jobs/execute" \
  --http-method="GET" \
  --headers="Authorization=Bearer ${CRON_SECRET},User-Agent=Google-Cloud-Scheduler/LouvAIO" \
  --attempt-deadline="60s" \
  --max-retry-attempts=3 \
  --min-backoff="10s" \
  --max-backoff="60s" \
  --description="LouvAIO WhatsApp durable provider cleanup executor (every 5 minutes)"

# 2. Reconciliation Executor Job
gcloud scheduler jobs create http praise-whatsapp-reconciliation-executor \
  --project="praise-app-7a362" \
  --location="us-central1" \
  --schedule="*/5 * * * *" \
  --time-zone="America/Sao_Paulo" \
  --uri="https://praise-app-gray.vercel.app/api/v1/internal/whatsapp/reconciliation-jobs/execute" \
  --http-method="GET" \
  --headers="Authorization=Bearer ${CRON_SECRET},User-Agent=Google-Cloud-Scheduler/LouvAIO" \
  --attempt-deadline="60s" \
  --max-retry-attempts=3 \
  --min-backoff="10s" \
  --max-backoff="60s" \
  --description="LouvAIO WhatsApp WABA reconciliation executor (every 5 minutes)"
```

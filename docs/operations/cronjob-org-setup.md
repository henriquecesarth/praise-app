# cron-job.org Zero-Cost Durable Scheduler Setup & Contract (Phase 7D1-B-R3)

## 1. Context & R$ 0 Architecture Invariant

LouvAIO's production backend is deployed on Vercel under the **Hobby (Free)** plan.
- The Vercel Hobby plan does not support sub-daily cron schedules (such as `*/5 * * * *`).
- To maintain an operational cost of **R$ 0,00** during development and homologation without requiring Google Cloud Billing or Firebase Blaze solely for scheduled execution:
  - **Durable Executor**: `cron-job.org` (Free Tier).
  - **Executor Class**: External Best-Effort Scheduler (`EXTERNAL_BEST_EFFORT_SCHEDULER`).
  - **Scheduler Cost**: R$ 0 (zero-cost, no credit card required).
  - **Google Cloud Billing Required for Scheduler**: NO.
  - **Vercel Native Cron**: NOT USED.
  - **Cadence**: Every 5 minutes (`*/5 * * * *`).
  - **Global Jobs**: Exactly **TWO** global jobs (Cleanup Executor and Reconciliation Executor).
  - **Multi-Tenant Invariant**: NEVER create per-tenant, per-organization, per-WABA, or per-phone scheduler jobs. All tenant partitioning is handled internally by bounded Firestore batch queries.

---

## 2. Global Job Contracts

Both global scheduled jobs invoke canonical internal HTTPS endpoints authenticated via machine bearer token (`CRON_SECRET`).

### Job 1: WhatsApp Durable Provider Cleanup Executor
- **Job Title**: `LouvAIO WhatsApp Provider Cleanup Executor`
- **Target URL**: `https://<BACKEND_DOMAIN>/api/v1/internal/whatsapp/cleanup-jobs/execute`  
  *(Canonical: `https://praise-app-gray.vercel.app/api/v1/internal/whatsapp/cleanup-jobs/execute`)*
- **HTTP Method**: `GET`
- **Schedule**: Every 5 minutes (`*/5 * * * *`)
- **Timezone**: `America/Sao_Paulo` (or UTC)
- **HTTP Headers**:
  - `Authorization`: `Bearer <CRON_SECRET>`
  - `User-Agent`: `cron-job.org/LouvAIO`
- **Request Timeout**: `30s` (free-tier default limit)
- **Response Format**: Compact operational summary JSON:
  ```json
  {
    "ok": true,
    "claimed": 1,
    "processed": 1,
    "succeeded": 1,
    "retryWait": 0,
    "exhausted": 0,
    "skipped": 0
  }
  ```
- **Response Cache Headers**:
  - `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
  - `Pragma: no-cache`
  - `Expires: 0`

### Job 2: WhatsApp WABA Reconciliation Executor
- **Job Title**: `LouvAIO WhatsApp WABA Reconciliation Executor`
- **Target URL**: `https://<BACKEND_DOMAIN>/api/v1/internal/whatsapp/reconciliation-jobs/execute`  
  *(Canonical: `https://praise-app-gray.vercel.app/api/v1/internal/whatsapp/reconciliation-jobs/execute`)*
- **HTTP Method**: `GET`
- **Schedule**: Every 5 minutes (`*/5 * * * *`)
- **Timezone**: `America/Sao_Paulo` (or UTC)
- **HTTP Headers**:
  - `Authorization`: `Bearer <CRON_SECRET>`
  - `User-Agent`: `cron-job.org/LouvAIO`
- **Request Timeout**: `30s` (free-tier default limit)
- **Response Format**: Compact operational summary JSON:
  ```json
  {
    "ok": true,
    "claimed": 1,
    "processed": 1,
    "stable": 1,
    "repaired": 0,
    "failed": 0,
    "skipped": 0
  }
  ```
- **Response Cache Headers**:
  - `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
  - `Pragma: no-cache`
  - `Expires: 0`

---

## 3. Step-by-Step Manual Setup in cron-job.org

1. **Sign In**: Log into [https://cron-job.org](https://cron-job.org) (create a free account if not already registered).
2. **Navigate to Cronjobs**: Click **Cronjobs** in the navigation bar, then click **Create cronjob**.
3. **Configure Job 1 (Cleanup Executor)**:
   - **Title**: `LouvAIO WhatsApp Provider Cleanup Executor`
   - **URL**: `https://praise-app-gray.vercel.app/api/v1/internal/whatsapp/cleanup-jobs/execute`
   - **Execution schedule**: Select **Every 5 minutes** (or Cron mode: `*/5 * * * *`).
   - **Timezone**: `America/Sao_Paulo` (UTC-3).
   - **Request Method**: `GET`.
   - **Advanced**:
     - Under **Request Headers**, click **Add header**:
       - Name: `Authorization`
       - Value: `Bearer <YOUR_CRON_SECRET>`
     - Set **Request Timeout**: `30` seconds.
     - Under **Notifications**, configure email alerts on failure (e.g. notify after 3 consecutive failures).
   - Click **Create**.
4. **Configure Job 2 (Reconciliation Executor)**:
   - Click **Create cronjob** again.
   - **Title**: `LouvAIO WhatsApp WABA Reconciliation Executor`
   - **URL**: `https://praise-app-gray.vercel.app/api/v1/internal/whatsapp/reconciliation-jobs/execute`
   - **Execution schedule**: Select **Every 5 minutes** (or Cron mode: `*/5 * * * *`).
   - **Timezone**: `America/Sao_Paulo` (UTC-3).
   - **Request Method**: `GET`.
   - **Advanced**:
     - Under **Request Headers**, click **Add header**:
       - Name: `Authorization`
       - Value: `Bearer <YOUR_CRON_SECRET>`
     - Set **Request Timeout**: `30` seconds.
     - Under **Notifications**, configure email alerts on failure (e.g. notify after 3 consecutive failures).
   - Click **Create**.
5. **Verify Activation**:
   - Both jobs will appear in the dashboard with status **Active**.
   - Review execution logs after the next 5-minute tick to verify HTTP 200 responses with the compact summary JSON.

---

## 4. Execution Budget, Deadline Propagation & 30-Second Timeout Hardening (Phase 7D1-B-R3-R1)

The free tier of `cron-job.org` enforces a strict connection timeout of ~30 seconds.
To provide an implementation-enforced execution deadline designed to return safely within the 30-second scheduler envelope (`<= 24-25s`):

1. **`WhatsAppExecutionDeadline` Authority**:
   - Initialized at route entry with `budgetMs: 24_000` (24 seconds) and `safetyMarginMs: 1_500` (1.5 seconds).
   - Dynamic remaining budget is calculated as `deadlineAt - Date.now() - safetyMarginMs`.
   - Propagated downstream into both Cleanup and Reconciliation services and provider calls.
2. **Pre-Acquisition & Pre-Call Execution Checks**:
   - Acquisition Cutoff: 15,000ms (`acquisitionCutoffMs: 15_000`). If 15s have elapsed, or if `!deadline.hasRemaining(3_000)`, candidate loop ceases acquiring new jobs.
   - Pre-Reservation Attempt Guard: Before reserving attempts or calling Meta Graph API, worker verifies `deadline.hasRemaining(3_000)`. If insufficient budget remains, the worker skips remote dispatch, releases WABA lease as `idle`, and reschedules the job with `INSUFFICIENT_EXECUTION_BUDGET` without incrementing `attempt_count`.
3. **Clamped Provider Timeouts**:
   - Provider timeouts are clamped dynamically to remaining budget via `deadline.getClampedTimeoutMs(normalTimeoutMs, minOperationalMs)`.
   - Mutation timeouts (e.g. DELETE 10s) and verification timeouts (10s) are clamped so they cannot block past the deadline.
   - If remaining budget is less than the minimum operational threshold (1.5s / 2.0s), the provider call is not initiated.
4. **Deadline-Aware Pagination**:
   - `checkMessagingAccountSubscribedApps` checks remaining budget before fetching each page (`deadlineAt - Date.now() < 1000`).
   - If budget is insufficient, pagination breaks safely and returns `{ proof: 'UNPROVEN', status: 'UNPROVEN' }`, preventing connection timeout.
5. **Post-Condition Verification Budget Guard**:
   - If DELETE outcome is ambiguous, worker runs verification only if `deadline.hasRemaining(2_000)`.
   - If verification budget is exhausted, worker marks `isProvenClean = false` with `VERIFICATION_BUDGET_EXHAUSTED`, records `unknown_outcome` in WABA lock ledger, and schedules reconciler resolution.
6. **No Lost Leases / No Dropped Attempts**:
   - Skipping a job past the cutoff or due to tight deadline does NOT increment `attempt_count` and does NOT lock the job lease.
   - Jobs remain durable in Firestore for subsequent scheduler ticks.
7. **Function Runtime Limit**:
   - Vercel function configuration in `backend/vercel.json` retains `maxDuration: 60` for `src/app.ts`, providing an ample serverless buffer above the 24-second execution envelope.

---

## 5. Idempotency, Concurrency & Best-Effort SLA

- **Best-Effort Delivery**:
  - `cron-job.org` is a best-effort external trigger. If a tick is delayed or missed due to public internet jitter or provider load, **system correctness is unaffected**.
  - All state transitions, retry intervals, backoff schedules, and uncertainty ledgers are persisted durably in Cloud Firestore.
  - The next successful tick discovers all due work.
- **Concurrent Tick Safety**:
  - If overlapping ticks occur, atomic Firestore transactional leasing (`acquireJobLeaseInTransaction`, 5-minute lease with unique token) ensures that only one worker can process a given job. The overlapping runner finds 0 unleased candidates and exits with HTTP 200 immediately.
- **Worker Crash Recovery**:
  - If a worker crashes mid-flight, its lease expires (`lease_expires_at <= now`). Subsequent scheduler invocations discover expired leases via two-query discovery and reclaim them safely.

---

## 6. Security & Separation of Authority

- **`CRON_SECRET`**: Machine bearer token used exclusively by `cron-job.org` to trigger autonomous cycles.
  - Rejects human operator mutations (`/override-lease`, `/abandon` reject with `403 FORBIDDEN`).
  - Validated via constant-time comparison (`crypto.timingSafeEqual`) over SHA-256 digests.
- **`INTERNAL_OPERATOR_SECRET`**: Secret used strictly for human operator intervention.
  - Rejects machine cron executions with `401 UNAUTHORIZED`.
- **Invariant**: `CRON_SECRET != INTERNAL_OPERATOR_SECRET`. Neither secret is ever sent to or exposed in the frontend client.

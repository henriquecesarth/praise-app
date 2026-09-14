#!/usr/bin/env bash
# ==============================================================================
# LouvAIO — Google Cloud Scheduler Deployment Artifact (Phase 7D1-B-R2)
# ==============================================================================
# Deploys the two durable 5-minute WhatsApp lifecycle executor jobs to Google
# Cloud Scheduler for project praise-app-7a362, ensuring compatibility with the
# Vercel Hobby hosting plan without requiring minute-level Vercel Cron.
#
# Prerequisites:
#   - gcloud CLI authenticated with permissions on project praise-app-7a362
#     (roles/cloudscheduler.admin or roles/editor)
#   - App Engine application enabled in the project region (Cloud Scheduler prerequisite)
#   - Environment variables:
#       CRON_SECRET (required): Machine bearer token matching backend configuration
#       BACKEND_BASE_URL (optional): Base URL of backend (default: https://praise-app-gray.vercel.app)
#       PROJECT_ID (optional): GCP project (default: praise-app-7a362)
#       REGION (optional): Scheduler location (default: us-central1)
#       TIMEZONE (optional): Cron timezone (default: America/Sao_Paulo)
# ==============================================================================

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-praise-app-7a362}"
REGION="${REGION:-us-central1}"
BACKEND_BASE_URL="${BACKEND_BASE_URL:-https://praise-app-gray.vercel.app}"
TIMEZONE="${TIMEZONE:-America/Sao_Paulo}"
SCHEDULE="*/5 * * * *"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "[-] ERROR: CRON_SECRET environment variable is required." >&2
  echo "    Usage: CRON_SECRET=\"...\" BACKEND_BASE_URL=\"...\" ./deploy-cloud-schedulers.sh" >&2
  exit 1
fi

echo "=============================================================================="
echo "LouvAIO Cloud Scheduler Deployment"
echo "Project:   ${PROJECT_ID}"
echo "Region:    ${REGION}"
echo "Schedule:  ${SCHEDULE} (${TIMEZONE})"
echo "Endpoint:  ${BACKEND_BASE_URL}"
echo "=============================================================================="

create_or_update_job() {
  local job_name="$1"
  local path_suffix="$2"
  local description="$3"
  local target_url="${BACKEND_BASE_URL}${path_suffix}"

  echo "[+] Configuring job: ${job_name}..."

  if gcloud scheduler jobs describe "${job_name}" --project="${PROJECT_ID}" --location="${REGION}" >/dev/null 2>&1; then
    echo "    Job exists. Updating definition..."
    gcloud scheduler jobs update http "${job_name}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --schedule="${SCHEDULE}" \
      --time-zone="${TIMEZONE}" \
      --uri="${target_url}" \
      --http-method="GET" \
      --headers="Authorization=Bearer ${CRON_SECRET},User-Agent=Google-Cloud-Scheduler/LouvAIO" \
      --attempt-deadline="60s" \
      --max-retry-attempts=3 \
      --min-backoff="10s" \
      --max-backoff="60s" \
      --description="${description}" \
      --quiet
  else
    echo "    Job does not exist. Creating definition..."
    gcloud scheduler jobs create http "${job_name}" \
      --project="${PROJECT_ID}" \
      --location="${REGION}" \
      --schedule="${SCHEDULE}" \
      --time-zone="${TIMEZONE}" \
      --uri="${target_url}" \
      --http-method="GET" \
      --headers="Authorization=Bearer ${CRON_SECRET},User-Agent=Google-Cloud-Scheduler/LouvAIO" \
      --attempt-deadline="60s" \
      --max-retry-attempts=3 \
      --min-backoff="10s" \
      --max-backoff="60s" \
      --description="${description}" \
      --quiet
  fi

  echo "    Job ${job_name} successfully configured."
}

# 1. WhatsApp Provider Cleanup Executor
create_or_update_job \
  "praise-whatsapp-cleanup-executor" \
  "/api/v1/internal/whatsapp/cleanup-jobs/execute" \
  "LouvAIO WhatsApp durable provider cleanup executor (every 5 minutes)"

# 2. WhatsApp WABA Reconciliation Executor
create_or_update_job \
  "praise-whatsapp-reconciliation-executor" \
  "/api/v1/internal/whatsapp/reconciliation-jobs/execute" \
  "LouvAIO WhatsApp WABA reconciliation executor (every 5 minutes)"

echo "=============================================================================="
echo "[✓] All Cloud Scheduler jobs successfully configured for project ${PROJECT_ID}."
echo "=============================================================================="

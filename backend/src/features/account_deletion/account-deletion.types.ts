export type AccountDeletionBlockerCode =
  | 'MINISTRY_OWNER'
  | 'ORGANIZATION_OWNER'
  | 'SOLE_MINISTRY_ADMIN'
  | 'BILLING_CONTACT_REPLACEMENT_REQUIRED';

export interface AccountDeletionBlocker {
  code: AccountDeletionBlockerCode;
  message: string;
  details?: {
    ministryId?: string;
    ministryName?: string;
    organizationId?: string;
    organizationName?: string;
    [key: string]: any;
  };
}

export type AccountDeletionJobStatus =
  | 'requested'
  | 'preflight_blocked'
  | 'cleanup_in_progress'
  | 'auth_delete_pending'
  | 'completed'
  | 'attention_required';

export interface AccountDeletionCheckpoints {
  personal_data_deleted?: boolean;
  memberships_detached?: boolean;
  future_schedules_cleaned?: boolean;
  historical_anonymized?: boolean;
  whatsapp_anonymized?: boolean;
  legacy_cleaned?: boolean;
  auth_deleted?: boolean;
}

export interface AccountDeletionJobRecord {
  id: string; // `del_${userId}`
  user_id: string;
  user_email: string | null;
  status: AccountDeletionJobStatus;
  blockers?: AccountDeletionBlocker[] | null;
  checkpoints: AccountDeletionCheckpoints;
  step_progress?: string;
  error_details?: string | null;
  requested_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
}

export interface AccountDeletionPreflightResponse {
  deletionAllowed: boolean;
  blockers: AccountDeletionBlocker[];
  activeJob?: {
    id: string;
    status: AccountDeletionJobStatus;
    step_progress?: string;
    requested_at: string;
  } | null;
}

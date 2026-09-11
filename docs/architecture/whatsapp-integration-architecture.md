# LouvAIO WhatsApp Integration — Technical & Domain Architecture

> **Authoritative Business Reference:** *"Integração com WhatsApp — Regras de Negócio"*  
> **Target Release:** Phase 7 (WhatsApp Integration)  
> **Document Status:** Architectural Specification & Authority Finalization (Phase 7A-R2 Finalized)  
> **Author:** LouvAIO Product Architect  
> **Authorities:** "Integração com WhatsApp — Regras de Negócio", AGENTS.md, MEMORY.md, docs/system-status.md, docs/product/system-overview.md  

---

## 1. Executive Summary & Principles

This document establishes the canonical, reconciled technical and domain architecture for LouvAIO's WhatsApp integration. It resolves all topological, membership, governance, and boundary contracts identified during Phase 7A prior to any production implementation in Phase 7B.

### Non-Negotiable Locked Business Rules (BR-7A-01 .. BR-7A-13)
1. **Paid Plan Capacity:** Paid plans include 1 WhatsApp connection; additional connections are purchased as generic add-on blocks (`addons.additionalWhatsapps`).
2. **Organization Ownership:** The **Organization (Church)** is the exclusive owner of `WhatsAppConnection`. A Ministry *never* owns a connection.
3. **Default Connection:** An Organization defines at most one default WhatsApp connection. Ministries without an exclusive connection automatically inherit this default.
4. **Ministry Assignment:** An Organization may assign a connection exclusively to a Ministry if capacity permits. Ownership remains strictly with the Organization.
5. **Subscription Entitlement Authority:** The backend `SubscriptionService` is the sole authority for evaluating connection capacity. No frontend component may branch on plan names directly.
6. **Billing Model:** Subscriptions expose `includedConnections` and `additionalConnections`.
7. **Non-Destructive Preservation:** Plan downgrades, quota reductions, and billing lapses **never** delete connection documents or configuration. Excess connections transition into a deterministic `disabled_over_limit` state.
8. **Normalized Entity:** Connections are first-class entities storing provider metadata, phone number, and status without exposing credentials.
9. **Status Semantics:** Normalized state machine (`pending`, `connecting`, `connected`, `error`, `disabled_by_user`, `disabled_over_limit`, `disconnected`). Only `connected` sends messages.
10. **Role Separation:** Org Admin manages org connections, purchases, and assignments. Ministry leaders view and use assigned or default connections.
11. **Provider Abstraction:** Core logic interacts with `WhatsAppProvider` abstraction, isolating vendor-specific Meta Cloud API details.
12. **Official Platform Strategy:** Production strictly uses the official Meta WhatsApp Business Platform (Cloud API + Embedded Signup). Unofficial scraping or reverse-engineered APIs are prohibited.
13. **Customer Phone Ownership:** The customer organization supplies and owns its phone number. LouvAIO does not resell or provision carrier numbers.

---

## 2. Canonical Persistence Topology Resolution (DEC-7A-16-R1)

### The Topology Contradiction Resolved
Phase 7A contained a structural contradiction between nested subcollection path syntax (`organizations/:organizationId/whatsapp_connections`) and root collection references (`whatsapp_connections` with `organization_id`).

### Repository Audit & Architectural Evaluation
An audit of LouvAIO's existing 24 production Firestore collections confirms:
- **Zero Subcollections:** Every active domain aggregate (`ministries`, `ministry_members`, `schedules`, `songs`, `member_unavailabilities`, `ministry_announcements`, `ministry_subscriptions`, `billing_subscriptions`) is implemented as a **root collection** using tenant foreign keys (`ministry_id`, `user_id`).
- **Webhook Lookups:** Inbound Meta webhook events provide `provider_phone_number_id` or `provider_waba_id`. In a nested subcollection topology, resolving the connection document would require Firestore `collectionGroup` queries with collection-group index declarations and specialized security rules. In a root collection, it is a fast, direct query: `.where('provider_phone_number_id', '==', id).limit(1)`.
- **Composite Index Consistency:** Firestore composite indexes in `firestore.indexes.json` operate seamlessly on root collections with standard field scopes.
- **Tenant Isolation:** Invariant #4 requires server-side tenant filtering (`.where('organization_id', '==', organizationId)`). Root collections strictly satisfy this requirement.

### The Canonical Collection Map
All WhatsApp-related persistence is strictly structured as **Root Collections**:

| Collection Name | Scope / Hierarchy | Key Identifiers | Purpose |
| :--- | :--- | :--- | :--- |
| `organizations` | Root Collection | `id` (UUID / nanoid) | Institutional entity representing the Church. |
| `organization_members` | Root Collection | `id` (`${organization_id}_${user_id}`) | Membership and administrative RBAC for the Organization. |
| `whatsapp_connections` | Root Collection | `id` (`wac_*`), `organization_id` | Provisioned phone numbers and connection states. |
| `whatsapp_connection_secrets` | Restricted Root Collection | `id` (matches `connection_id`), `organization_id` | Encrypted access tokens and security metadata. |
| `whatsapp_messages` | Root Collection | `id` (`wamsg_*`), `organization_id`, `ministry_id` | Transactional notification audit log and dispatch state. |
| `whatsapp_webhook_events` | Root Collection | `id` (`wbh_*` or hash), `provider_event_id` | Sanitized webhook delivery log for deduplication. |

*Subcollections are completely eliminated from the architecture.*

---

## 3. Organization Membership Model & RBAC (DEC-7A-14-R2, DEC-7A-20-R2)

### The `organization_members` Aggregate
To support multi-admin governance beyond a single `owner_user_id` without conflating institutional authority with ministry operations, LouvAIO introduces the `organization_members` root collection.

#### Schema
```typescript
export type OrganizationRole = 'owner' | 'admin';

export interface OrganizationMemberRecord {
  id: string; // Deterministic: `${organization_id}_${user_id}`
  organization_id: string; // Foreign key to organizations
  user_id: string; // Firebase Auth UID
  role: OrganizationRole; // 'owner' or 'admin'
  invited_by_user_id: string | null;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}
```

#### Unique Invariants & Safety Rules
1. **Compound Uniqueness:** A user can have at most one role document per Organization (`id = `${organization_id}_${user_id}``).
2. **Owner Representation:** The user identified by `organizations.owner_user_id` MUST possess an `organization_members` record with `role: 'owner'`.
3. **Owner Cardinality:** Exactly one user holds `role: 'owner'` per Organization at any time.
4. **Owner Protection:** An owner membership can **never** be deleted through member management APIs (`DELETE /organizations/:id/members/:userId`). An owner cannot remove themselves.
5. **Ownership Transfer:** Transfer of institutional ownership is executed exclusively by `ORG_OWNER` and atomically:
   - Updates `organizations.owner_user_id = newOwnerUserId`;
   - Demotes the former owner in `organization_members` to `role: 'admin'`;
   - Promotes the new owner in `organization_members` to `role: 'owner'`.
6. **Least-Privilege Admin Delegation (DEC-7A-20-R2):**
   - **`ORG_OWNER`** exclusively manages Organization administrators (add, remove).
   - **`ORG_ADMIN`** CANNOT grant, promote, invite, or revoke other Organization admins or the Org Owner.
   - `ORG_ADMIN` authority is strictly focused on managing WhatsApp connections, assigning connections to child ministries, configuring the organization default connection, and reviewing billing/capacity summaries.

### Authoritative RBAC Matrix
Authority is strictly compartmentalized across domain boundaries:

| Permission / Action | `ORG_OWNER` | `ORG_ADMIN` | `MINISTRY_ADMIN` | `MINISTRY_MEMBER` |
| :--- | :---: | :---: | :---: | :---: |
| **Manage Organization Details & Transfer Ownership** | Yes | No | No | No |
| **Manage Billing Anchor Ministry** | Yes | No | No | No |
| **Add / Remove Organization Admins** | Yes | No | No | No |
| **Attach / Detach Ministries to Organization** | Yes | No | No | No |
| **Start WhatsApp Onboarding (Embedded Signup)** | Yes | Yes | No | No |
| **Configure Organization Default Connection** | Yes | Yes | No | No |
| **Assign Connection Exclusively to Ministry** | Yes | Yes | No | No |
| **Disconnect / Deactivate Connection** | Yes | Yes | No | No |
| **Purchase Add-on WhatsApp Capacity** | Yes | Yes* | No | No |
| **View Ministry Resolved WhatsApp Status** | Yes | Yes | Yes | No |
| **Trigger Schedule WhatsApp Notification** | Yes | Yes | Yes | No |
| **Receive Notification / Set Phone & Opt-Out** | Yes | Yes | Yes | Yes |

*\*Subject to commercial billing permissions on the billing anchor ministry.*

**Key Boundary Principle:** Being an Admin in a Ministry (`ministry_members.role === 'admin'`) gives administrative rights *only* inside that specific Ministry (repertoire, schedules, unavailabilities, team members). It does **not** grant Organization-level authority over WhatsApp connections or institutional governance.

---

## 4. Existing Ministries → Organization Association (DEC-7A-25-R1)

LouvAIO churches may already operate multiple independent ministries in the system (e.g., *Louvor Geral*, *Louvor Jovens*, *Coral*). The association of these ministries into a unified Organization must be explicit, authorized, and non-destructive.

### Association Invariants & Authority
1. **Zero Heuristic Association:** The backend **NEVER** automatically groups ministries based on name similarity, email domain, shared members, or billing customer IDs. All associations must be explicitly authorized.
2. **Single Organization Boundary:** A Ministry belongs to **exactly one** Organization (`ministries.organization_id`).
3. **Attach Authority (Dual-Authorization Handshake):** Attaching an existing Ministry B to Organization X requires proof of authority in **both** contexts:
   - The executing actor must be the **`ORG_OWNER`** of Organization X; **AND**
   - The executing actor must be an **`owner`** or **`admin`** of Ministry B.
4. **Standalone Eligibility:** A Ministry can only be attached to Organization X if its current `organization_id` is `null` or belongs to an empty, standalone auto-provisioned organization with zero active connections.
5. **Preservation of Ministry Data:** Attaching a ministry to an Organization causes **zero** changes to its songs, schedules, members, roles, or unavailabilities.
6. **Detach Authority:** A Ministry can be detached from an Organization **ONLY by the `ORG_OWNER`**, provided that the Ministry is **not** the `billing_anchor_ministry_id`.
   - Detaching the billing anchor ministry is strictly prohibited with `400 CANNOT_DETACH_BILLING_ANCHOR`.
   - Upon detachment, `ministry.organization_id` is reset to `null`, and any dedicated connection has its `assigned_ministry_id` cleared to `null`.

---

## 5. Organization Provisioning & Concurrency Invariants (DEC-7A-27)

### Invariants
1. **One-to-Many Cardinality:** An Organization contains 1 to N Ministries.
2. **Anchor Invariant:** An Organization must always have exactly one `billing_anchor_ministry_id`, and that ministry must belong to the Organization (`ministry.organization_id === organization.id`).
3. **Immutable Tenant ID:** The `organization.id` is immutable once created.

### Initial Organization Owner Derivation (`INITIAL_ORG_OWNER_SOURCE`)
In LouvAIO, every ministry document in Firestore maintains a canonical owner field: `ministries.owner_user_id: string`.
- **Authoritative Owner Derivation:** When an Organization is provisioned for a Ministry, the initial institutional owner is strictly derived from the canonical owner of that Ministry:
  ```text
  INITIAL_ORG_OWNER_SOURCE: ministry.owner_user_id
  organizations.owner_user_id = ministry.owner_user_id
  ```
- The initial `organization_members` owner record is deterministically created for `ministry.owner_user_id` with `role: 'owner'`.
- If the authenticated actor executing the provisioning command is a Ministry Admin who is *not* the Ministry Owner, the transaction creates:
  - `organization_members` for `ministry.owner_user_id` with `role: 'owner'`; **AND**
  - `organization_members` for the caller (`actorUserId`) with `role: 'admin'`.
- This ensures institutional ownership is grounded in legitimate church ministry ownership, completely eliminating arbitrary races or administrative takeovers.

### Explicit Provisioning Trigger (Command Pattern)
Creating an Organization establishes institutional tenant identity, legal owner authority, and billing anchors.
- **Strict Non-Mutating GET Behavior:** Ordinary authenticated `GET` requests (e.g., `GET /api/v1/ministries/:ministryId/whatsapp/status` or viewing a dashboard) **NEVER** implicitly create or provision an Organization. If no Organization exists, GET endpoints return `hasOrganization: false` or `404 Not Found`.
- **Explicit Provisioning Command:** Provisioning occurs strictly via an intentional `POST` command:
  ```text
  POST /api/v1/ministries/:ministryId/organization/provision
  ```
  Authorized strictly for authenticated users holding `owner` or `admin` roles in `ministryId`.

### Concurrency & Race Condition Resolution
When two authorized administrators (e.g., Admin A and Admin B) simultaneously trigger provisioning for the same Ministry:
- The backend executes inside an atomic Firestore transaction (`db.runTransaction`):
  1. Transaction reads `ministries.doc(ministryId)`.
  2. If `ministry.organization_id != null` (set by a concurrent transaction), the transaction commits nothing, aborts creation, and returns the existing Organization.
  3. If `ministry.organization_id == null`, the first transaction to commit creates:
     - `organizations.doc(orgId)` with `owner_user_id = ministry.owner_user_id`;
     - `organization_members.doc(`${orgId}_${ministry.owner_user_id}`)` with `role: 'owner'`;
     - `organization_members.doc(`${orgId}_${actorUserId}`)` with `role: 'admin'` (if actor != owner);
     - Updates `ministries.doc(ministryId)` with `{ organization_id: orgId }`.
- **Resolution Invariant:** The first transaction to commit wins. Because `organizations.owner_user_id` is derived from `ministry.owner_user_id`, both requests agree on the owner. The losing transaction retries, reads the newly set `organization_id`, and returns the existing Organization without overwriting `owner_user_id`, `role`, or `billing_anchor_ministry_id`.

---

## 6. Complete Billing Anchor Semantics (DEC-7A-15-R1, DEC-7A-28)

### Commercial Subscription Anchoring
Commercial billing in LouvAIO is currently anchored to individual ministries in `ministry_subscriptions`, integrated with Asaas recurring subscriptions.

To avoid breaking live payment gateway webhooks, customer IDs, and the `BillingReconcilerWorker`:
- The Organization inherits commercial capacity from its designated **Billing Anchor Ministry** (`organizations.billing_anchor_ministry_id`).

### Multi-Subscription & Transition Rules
1. **Initial Selection:** The billing anchor is automatically set to the initial ministry provisioned with the Organization.
2. **Phase 7B Foundation Immutability (DEC-7A-28):** Arbitrary mutation of `billing_anchor_ministry_id` is **NOT** exposed through public REST APIs in Phase 7B. Modifying commercial anchors during active billing transitions is commercially sensitive and is deferred to specialized billing phases with `billing-engineer`.
3. **Multiple Paid Subscriptions in One Organization:**
   - If an Organization contains Ministry A (on *Pro*) and Ministry B (on *Essential*):
     - **Safety Invariant:** LouvAIO executes **NO automatic cancellation, NO automatic migration, and NO automatic merging of existing subscriptions.**
     - **WhatsApp Entitlement Rule:** Exclusively the subscription of the **`billing_anchor_ministry_id`** governs the Organization's WhatsApp capacity.
     - **Other Ministry Subscriptions:** Ministry B's subscription remains fully active and independent, governing Ministry B's operational quotas (members, songs, smart chords, liturgy storage).
     - **Future Commercial Merging:** Unified multi-ministry institutional billing is deferred to specialized billing phases with `billing-engineer`.

---

## 7. Authoritative WhatsApp Entitlement Contract (DEC-7A-05, DEC-7A-06)

The backend `SubscriptionService` is the sole authority for calculating connection capacity. No WhatsApp controller or repository may inspect `planId` or Asaas fields directly.

### Method Signature
```typescript
SubscriptionService.getOrganizationWhatsAppEntitlement(organizationId: string): Promise<OrganizationWhatsAppEntitlement>
```

### Schema
```typescript
export interface OrganizationWhatsAppEntitlement {
  organizationId: string;
  billingAnchorMinistryId: string;
  enabled: boolean; // True if subscription plan is active or in grace
  includedConnections: number; // 1 for paid plans, 0 for free
  additionalConnections: number; // Generic add-on blocks (addons.additionalWhatsapps)
  totalAllowedConnections: number; // includedConnections + additionalConnections
  configuredConnectionsCount: number; // Total non-disconnected connections in database
  capacityConsumingCount: number; // Connections in PENDING, CONNECTING, CONNECTED, ERROR
  remainingCapacity: number; // Math.max(0, totalAllowedConnections - configuredConnectionsCount)
  accessMode: 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
  restrictionReason: 'NONE' | 'GRACE_PERIOD' | 'OVER_ENTITLEMENT' | 'SUSPENDED';
  canCreateConnection: boolean; // true if accessMode is normal and remainingCapacity > 0
  canSendMessages: boolean; // true if accessMode is normal or grace, and not restricted_over_limit
}
```

### Formula
```text
totalAllowedConnections = includedConnections + additionalConnections
remainingCapacity = Math.max(0, totalAllowedConnections - configuredConnectionsCount)
```

---

## 8. Billing Grace, Over-Limit & Non-Destructive Restrictions (DEC-7A-18-R1)

LouvAIO strictly enforces non-destructive data preservation.

### Operational Grace Period (`accessMode === 'grace'`)
When a subscription payment is overdue but within the commercial grace window:
- **Sending Messages:** **Permitted**. Existing active connections continue dispatching operational schedule notifications without interruption.
- **New Onboarding:** **Blocked**. The system disallows starting new Embedded Signup sessions (`canCreateConnection: false`).
- **Configuration Modifications:** **Blocked**. Assigning or switching connections is locked.

### Restricted Over Limit (`accessMode === 'restricted_over_limit'`)
When commercial capacity drops below configured connections (e.g., plan downgrade from *Pro* to *Free*, or cancellation of add-on blocks):
1. **Zero Automatic Disabling / Zero Deletion:** The system **NEVER automatically picks a phone number to disable or disconnect.** Automatic selection risks shutting off the church's primary pastoral or administrative line.
2. **Operational Status:** The Organization enters `restricted_over_limit`.
   - Creation of new connections is **BLOCKED**;
   - Outbound dispatch through all connections is **BLOCKED** with error code `RESTRICTED_OVER_LIMIT`;
   - Inbound webhook events are acknowledged but dispatch remains frozen.
3. **Administrator Resolution Workflow:**
   - Org Admin UI displays a persistent alert banner: *"Sua organização possui X conexões configuradas, mas seu plano atual permite apenas Y. Regularize sua assinatura ou desconecte conexões excedentes."*
   - The Org Admin must resolve the over-limit state by either:
     - **Option A:** Upgrading the plan or purchasing additional add-on blocks; OR
     - **Option B:** Explicitly clicking **"Desconectar"** on specific connections until `configuredConnectionsCount <= totalAllowedConnections`.

---

## 9. Capacity Accounting & Loophole Elimination (DEC-7A-17-R1)

### Status Definitions & Capacity Consumption

| Connection Status | Consumes Quota Slot? | Can Send Messages? | Definition |
| :--- | :---: | :---: | :--- |
| `pending` | **Yes** | No | Reserved onboarding slot during Embedded Signup (expires via 24h TTL). |
| `connecting` | **Yes** | No | Code exchanged, awaiting phone registration & webhook validation. |
| `connected` | **Yes** | **Yes** | Verified, active, and authorized to send template messages. |
| `error` | **Yes** | No | Transient technical fault, certificate mismatch, or health check failure. |
| `disabled_by_user` | **Yes** | No | Manually paused by Org Admin. Still occupies an allocated slot. |
| `disabled_over_limit` | **Yes** | No | Preserved record from a prior over-limit event. Still occupies a slot. |
| `disconnected` | **No** | No | Soft-deleted / unlinked. Does NOT consume capacity. |

### Elimination of the Accumulation Loophole
- **The Loophole:** In a naive model where disabled connections do not consume capacity, an organization with 1 allowed connection could onboard number A, disable it, onboard number B, disable it, and accumulate unlimited configured numbers, cycling between them.
- **The Invariant:** New connection onboarding (`POST /whatsapp/onboarding/start`) strictly enforces:
  ```text
  configuredConnectionsCount < totalAllowedConnections
  ```
  where `configuredConnectionsCount` counts **ALL non-disconnected connections** (`status !== 'disconnected'`).
- To onboard a new connection when at quota, an administrator must explicitly **disconnect** an existing connection, moving it to `disconnected`.

---

## 10. Re-Upgrade Behavior & Sender Stability (DEC-7A-20-R1)

When an Organization purchases additional add-on capacity or upgrades its plan:
1. **Explicit Reactivation Required:** Connections in `disabled_over_limit` or `disabled_by_user` do **NOT** automatically resume sending messages.
2. **No Silent Sender Switching:** Automatic reactivation could cause recipients to unexpectedly receive messages from a different number than the one used during the restriction.
3. **Administrative Flow:** The Org Admin dashboard indicates that newly purchased slots are available. The Admin explicitly clicks **"Reativar Conexão"**. The system validates that `capacityConsumingCount < totalAllowedConnections` and transitions the status to `connected`.

---

## 11. Default vs Exclusive Connection Invariants (DEC-7A-21-R1)

To eliminate routing ambiguity and ensure predictable messaging:
1. **Mutual Exclusivity:** A connection **CANNOT** simultaneously be an Organization Default and an Exclusive Ministry Assignment.
   ```typescript
   if (connection.is_organization_default === true) {
     assert(connection.assigned_ministry_id === null);
   }
   if (connection.assigned_ministry_id !== null) {
     assert(connection.is_organization_default === false);
   }
   ```
2. **Single Default per Organization:** An Organization can have at most one connection with `is_organization_default: true`.
3. **Assignment Cardinality (1:1):**
   - One connection is assigned to at most **one** Ministry (`assigned_ministry_id`).
   - Each Ministry has at most **one** exclusively assigned connection.
   - Shared usage occurs **exclusively** through the Organization default fallback.

### Connection Resolution Algorithm (`resolveWhatsAppConnection`)
When Ministry M requests message dispatch:
1. Search for an exclusive connection:
   `whatsapp_connections.where('organization_id', '==', orgId).where('assigned_ministry_id', '==', M.id).where('status', '==', 'connected')`
   If found → **Dispatch via Exclusive Connection**.
2. If none, search for the organization default:
   `whatsapp_connections.where('organization_id', '==', orgId).where('is_organization_default', '==', true).where('status', '==', 'connected')`
   If found → **Dispatch via Organization Default Connection**.
3. If neither exists or the resolved connection is not in `connected` status:
   → **Fail Closed** with `NO_USABLE_WHATSAPP_CONNECTION`.

---

## 12. Recipient Phone Normalization & Validation (DEC-7A-22-R1)

### Canonical Storage: Strict E.164
- Phone numbers in `users` and `ministry_members` are stored strictly in **E.164** format:
  ```text
  ^\+[1-9]\d{1,14}$
  ```
  Example: `+5511999998888`, `+14155552671`.

### Elimination of Backend Regional Bias
- The backend API **NEVER** silently assumes `+55` or any country code. Any phone payload missing a leading `+` or country code is rejected with HTTP `400 INVALID_PHONE_E164`.
- **Frontend Localization:** The web application provides country code selection defaulting to `+55` (Brazil) for Brazilian locales, performing client-side normalization into E.164 before transmission.

---

## 13. Secret Storage & Envelope Encryption Hardening (DEC-7A-19-R1)

Meta Cloud API System User Tokens must be secured against data breaches and cross-tenant transplantation.

### Cryptographic Specification
- **Algorithm:** AES-256-GCM (Authenticated Encryption with Associated Data).
- **Master Key:** `WHATSAPP_TOKEN_ENCRYPTION_KEY` configured in backend `unifiedConfig` (32-byte cryptographically random key, Base64-encoded). Server-only secret, never exposed to clients or build artifacts.
- **Nonce / IV:** Cryptographically secure unique 12-byte initialization vector generated per encryption operation. IV reuse is strictly prohibited.
- **Authentication Tag:** 16-byte GCM authentication tag verifying ciphertext integrity.
- **Associated Authenticated Data (AAD):** The AAD binds the ciphertext to the exact tenant context:
  ```text
  AAD = `${organization_id}:${connection_id}`
  ```
  This prevents ciphertext transplantation attacks between connections or organizations.
- **Key Versioning:** Each secret record contains `key_version: number` (initial version: `1`) to enable zero-downtime key rotation in future phases.
- **Fail-Closed Decryption:** Decryption failures throw `SECRET_DECRYPTION_FAILED` and halt execution immediately.
- **Zero Logging:** Decrypted tokens are strictly prohibited from application logs, error traces, and diagnostic payloads.

#### `whatsapp_connection_secrets` Schema
```typescript
export interface WhatsAppConnectionSecretRecord {
  id: string; // matches connection_id
  organization_id: string; // tenant boundary
  key_version: number; // encryption key version for rotation
  encrypted_access_token: string; // Base64 or Hex ciphertext
  iv: string; // Base64 IV (12 bytes)
  auth_tag: string; // Base64 GCM Tag (16 bytes)
  token_type: 'system_user' | 'user_token';
  expires_at: string | null; // ISO 8601 or null if permanent
  created_at: string;
  updated_at: string;
}
```

---

## 14. Webhook Event Retention, Privacy & Sanitization (DEC-7A-23-R1)

Inbound Meta webhook payloads may contain sensitive PII, participant phone numbers, and message bodies.

### Minimization & Sanitization Policy
1. **No Indefinite Raw Payload Storage:** Storing unredacted raw webhook JSON payloads indefinitely violates data minimization principles.
2. **Sanitized Persistence Schema:**
   ```typescript
   export interface WhatsAppWebhookEventRecord {
     id: string; // sha256(provider_event_id) or wbh_*
     provider_event_id: string; // Meta event identifier for deduplication
     connection_id: string | null; // Resolved connection
     event_type: string; // e.g. 'messages.status_update'
     processing_status: 'received' | 'processed' | 'ignored' | 'failed';
     error_code: string | null;
     sanitized_metadata: {
       message_id?: string;
       recipient_phone_hash?: string; // Hashed phone for tracing without PII
       status?: 'sent' | 'delivered' | 'read' | 'failed';
       timestamp?: string;
     };
     processed_at: string | null;
     created_at: string; // ISO 8601
   }
   ```
3. **Retention TTL:** Webhook event records are retained for **30 days** for operational deduplication and delivery troubleshooting, after which they are purged by a background sweeper.

---

## 15. Disconnect vs Delete Semantics (DEC-7A-24-R1)

To balance user control with auditability and relational integrity:

### Disconnect (Operational Deactivation)
- **Action:** `POST /api/v1/organizations/:organizationId/whatsapp/connections/:connectionId/disconnect`
- **Semantics:**
  - Deregisters webhook subscriptions from Meta;
  - Sets `status: 'disconnected'`;
  - Clears `is_organization_default` and `assigned_ministry_id`;
  - Releases the capacity slot (`configuredConnectionsCount` decreases);
  - **Preserves** the connection record and historical `whatsapp_messages` audit trail.

### Delete (Hard Record Purge)
- **Action:** `DELETE /api/v1/organizations/:organizationId/whatsapp/connections/:connectionId`
- **Semantics:**
  - Allowed **ONLY** if `whatsapp_messages` has 0 messages linked to this connection, OR if the Org Owner provides explicit multi-step confirmation (`force=true`);
  - Permanently purges the secret from `whatsapp_connection_secrets`;
  - Permanently removes the `whatsapp_connections` document.

---

## 16. First Messaging Use Case: Schedule Call-Up Notifications (DEC-7A-26)

### Functional Flow
1. **Explicit Admin Trigger:** Notifications are triggered **only** when a Ministry Admin explicitly clicks **"Notificar Escala via WhatsApp"** in `ScheduleDetailsView`. No automated background dispatch on schedule creation in V1.
2. **Audience Filtering:**
   - Evaluates schedule participants;
   - Skips participants with `opt_out_whatsapp === true`;
   - Skips participants with no valid E.164 `phone`, flagging them in the dispatch report.
3. **Idempotency Key:**
   ```text
   idempotencyKey = sha256(`${scheduleId}_${memberId}_${scheduleUpdatedAt}`)
   ```
   Repeated clicks within a 10-minute window detect the existing dispatch record in `whatsapp_messages` and prevent duplicate WhatsApp delivery.
4. **Template Concept:** `escala_convocacao_v1`
   - Parameter 1: Member First Name
   - Parameter 2: Event / Service Name
   - Parameter 3: Service Date
   - Parameter 4: Service Time
   - Parameter 5: Musical / Ministry Role
   - Parameter 6: Confirmation Link URL
5. **Audit Record:** Persisted in `whatsapp_messages` with initial status `queued`, updated via webhooks to `sent`, `delivered`, `read`, or `failed`.

---

## 17. Provider-Dependent Assumptions Register

The following items are external dependencies on Meta's WhatsApp Cloud API platform and are explicitly cataloged as **`[EXTERNAL META VALIDATION REQUIRED]`**:

1. **`[EXTERNAL META VALIDATION REQUIRED]` Embedded Signup SDK Response:** Verification of the exact JSON payload returned by Meta's Embedded Signup JavaScript SDK and the exact System User Token exchange handshake on Graph API v21.0.
2. **`[EXTERNAL META VALIDATION REQUIRED]` Mobile Coexistence:** Official confirmation of Meta's policy regarding whether a phone number currently active on the mobile WhatsApp Business App can simultaneously receive Cloud API messages without full account migration.
3. **`[EXTERNAL META VALIDATION REQUIRED]` Utility Template Pre-Approval:** Confirmation of whether operational utility templates (`escala_convocacao_v1`) can be programmatically submitted via Graph API or must be pre-approved in the Meta Business Manager UI.
4. **`[EXTERNAL META VALIDATION REQUIRED]` System User Token Expiration:** Validation of the lifespan of Meta System User Tokens (permanent vs 60-day refresh requirement).
5. **`[EXTERNAL META VALIDATION REQUIRED]` Webhook Signature Verification:** Validation of Meta's exact HMAC-SHA256 signature header format (`X-Hub-Signature-256`) and payload digest calculation.

---

## 18. Updated Decision Register (DEC-7A-01 .. DEC-7A-28)

| Decision ID | Status | Subject | Summary |
| :--- | :--- | :--- | :--- |
| **DEC-7A-01** | Locked | Plan Capacity Model | Paid plans include 1 connection; extra via generic add-on blocks. |
| **DEC-7A-02** | Locked | Connection Ownership | Organization is the sole owner. Ministry never owns. |
| **DEC-7A-03** | Locked | Organization Default | Max 1 default per Organization; inherited by unassigned ministries. |
| **DEC-7A-04** | Locked | Ministry Assignment | Organization may assign connection exclusively to 1 Ministry. |
| **DEC-7A-05** | Locked | Entitlement Authority | `SubscriptionService` authorizes creation; no client plan logic. |
| **DEC-7A-06** | Locked | Billing Contract | Exposes included and additional connection capacities. |
| **DEC-7A-07** | Locked | Data Preservation | Plan lapses never delete connection documents. |
| **DEC-7A-08** | Locked | Entity Normalization | First-class entity without exposed secrets. |
| **DEC-7A-09** | Locked | Status Semantics | State machine defined; only `CONNECTED` dispatches. |
| **DEC-7A-10** | Locked | Security Roles | Org Admin manages; Ministry Admin uses. |
| **DEC-7A-11** | Locked | Provider Abstraction | `WhatsAppProvider` isolates vendor details. |
| **DEC-7A-12** | Locked | Official Strategy | Meta Cloud API + Embedded Signup; scraping prohibited. |
| **DEC-7A-13** | Locked | Phone Ownership | Customer owns phone number; LouvAIO does not resell lines. |
| **DEC-7A-14-R2**| **Finalized** | Organization Membership | Introduces `organization_members` root collection; owner-only admin management. |
| **DEC-7A-15-R1**| **Remediated** | Billing Anchor Semantics | Subscriptions remain on `ministry_subscriptions`; zero auto-merging of multi-ministry subscriptions. |
| **DEC-7A-16-R1**| **Remediated** | Canonical Root Topology | Rejects subcollections; mandates root collections for all 6 entities. |
| **DEC-7A-17-R1**| **Remediated** | Capacity Accounting | Counts all non-disconnected connections; closes rotation loophole. |
| **DEC-7A-18-R1**| **Remediated** | Non-Destructive Over-Limit | Replaces automatic phone disabling with `restricted_over_limit` mode & manual admin resolution. |
| **DEC-7A-19-R1**| **Remediated** | Secret Storage Hardening | AES-256-GCM envelope encryption with key versioning and AAD tenant binding. |
| **DEC-7A-20-R2**| **Finalized** | Least-Privilege Org Governance | `ORG_OWNER` manages admins and ministries; `ORG_ADMIN` manages connections only. |
| **DEC-7A-21-R1**| **Remediated** | Default vs Exclusive Invariant | Mutually exclusive; connection cannot be both default and assigned. 1:1 cardinality. |
| **DEC-7A-22-R1**| **Remediated** | Strict E.164 Backend | Backend rejects non-E.164; regional +55 defaults isolated to frontend. |
| **DEC-7A-23-R1**| **Remediated** | Webhook Privacy & Retention | Sanitized metadata persistence; 30-day retention TTL; no raw payload storage. |
| **DEC-7A-24-R1**| **Remediated** | Disconnect vs Delete | Disconnect preserves audit; Delete purges record (restricted). |
| **DEC-7A-25-R1**| **Finalized** | Ministry Association Handshake | Attaching requires `ORG_OWNER` + Ministry Admin/Owner; zero heuristic guessing. |
| **DEC-7A-26** | **New** | First Messaging Use Case | Explicit manual schedule call-up with idempotency and audit trail. |
| **DEC-7A-27** | **New** | Deterministic Owner Derivation | `INITIAL_ORG_OWNER_SOURCE: ministry.owner_user_id`; explicit POST provisioning command. |
| **DEC-7A-28** | **New** | Billing Anchor Immutability in 7B | Public REST API does not mutate billing anchor in Phase 7B foundation. |

---

## 19. Phase 7B Concrete Implementation Contract

The following technical specification defines the exact scope for **Phase 7B (Organization Foundation & Entitlements)**:

### 1. Data Contract & Collections
- **`organizations` (Root Collection):**
  - `id`: string (UUID v4 or nanoid)
  - `name`: string (e.g. "Igreja Batista Central")
  - `slug`: string | null
  - `owner_user_id`: string (Firebase Auth UID)
  - `billing_anchor_ministry_id`: string (Ministry holding the active commercial subscription)
  - `default_whatsapp_connection_id`: string | null (*strictly null in 7B; populated in Phase 7C*)
  - `created_at`: string (ISO 8601)
  - `updated_at`: string (ISO 8601)
- **`organization_members` (Root Collection):**
  - `id`: string (`${organization_id}_${user_id}`)
  - `organization_id`: string
  - `user_id`: string
  - `role`: `'owner' | 'admin'`
  - `invited_by_user_id`: string | null
  - `created_at`: string (ISO 8601)
  - `updated_at`: string (ISO 8601)
- **`ministries` (Root Collection Schema Extension):**
  - `organization_id`: string | null (optional foreign key)

### 2. Repositories to Implement in Phase 7B
- **`backend/src/repositories/OrganizationRepository.ts`:**
  - `getOrganizationById(orgId: string): Promise<OrganizationRecord | null>`
  - `getOrganizationByMinistryId(ministryId: string): Promise<OrganizationRecord | null>`
  - `getUserOrganizations(userId: string): Promise<OrganizationRecord[]>`
  - `getOrganizationMember(orgId: string, userId: string): Promise<OrganizationMemberRecord | null>`
  - `listOrganizationMembers(orgId: string): Promise<OrganizationMemberRecord[]>`
  - `addOrganizationMember(orgId: string, userId: string, actorUserId: string): Promise<OrganizationMemberRecord>` (Org Owner only, role strictly 'admin')
  - `removeOrganizationMember(orgId: string, userId: string, actorUserId: string): Promise<void>` (Org Owner only, rejects deleting owner)
  - `lazyProvisionForMinistry(ministryId: string, actorUserId: string): Promise<OrganizationRecord>` (atomic transaction, derives owner from `ministries.owner_user_id`)
  - `linkMinistryToOrganization(orgId: string, ministryId: string, actorUserId: string): Promise<void>` (dual-authorized transaction)
  - `detachMinistryFromOrganization(orgId: string, ministryId: string, actorUserId: string): Promise<void>` (Org Owner only, rejects detaching billing anchor)

### 3. Services to Extend in Phase 7B
- **`backend/src/features/subscriptions/subscription.service.ts`:**
  - Add method `getOrganizationWhatsAppEntitlement(organizationId: string): Promise<OrganizationWhatsAppEntitlement>`.
  - Resolves `organizations.billing_anchor_ministry_id`, reads commercial subscription, evaluates `includedConnections` and generic add-on blocks (`addons.additionalWhatsapps`), and returns effective quota.

### 4. Canonical REST API Endpoints Matrix for Phase 7B

| Method | Endpoint Path | Authority Required | Status in Phase 7B | Description & Preconditions |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/v1/organizations/:organizationId` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7B** | Retrieve Organization details. Returns 404 if not found or unauthorized. |
| **GET** | `/api/v1/organizations/:organizationId/members` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7B** | List Organization members and roles. |
| **POST** | `/api/v1/organizations/:organizationId/members` | `ORG_OWNER` only | **IMPLEMENT IN 7B** | Add Organization Admin (`{ userId, role: 'admin' }`). Rejects `role: 'owner'`. |
| **DELETE** | `/api/v1/organizations/:organizationId/members/:userId` | `ORG_OWNER` only | **IMPLEMENT IN 7B** | Remove Organization Admin. Rejects deleting current `owner_user_id`. |
| **GET** | `/api/v1/organizations/:organizationId/entitlements/whatsapp` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7B** | Return effective WhatsApp capacity via `SubscriptionService`. |
| **POST** | `/api/v1/ministries/:ministryId/organization/provision` | Ministry Admin or Owner | **IMPLEMENT IN 7B** | Explicit command to lazy-provision Organization for standalone Ministry. |
| **POST** | `/api/v1/organizations/:organizationId/ministries/:ministryId` | `ORG_OWNER` + Ministry Admin | **IMPLEMENT IN 7B** | Attach existing Ministry to Organization (dual-authorization). |
| **DELETE** | `/api/v1/organizations/:organizationId/ministries/:ministryId` | `ORG_OWNER` only | **IMPLEMENT IN 7B** | Detach Ministry from Organization. Rejects detaching billing anchor. |
| **PATCH** | `/api/v1/organizations/:organizationId/billing-anchor` | `ORG_OWNER` only | **DEFER** | Defer to specialized billing phases to avoid unvalidated commercial transitions. |

### 5. Composite Index Contract
- **Evaluation:** Firestore automatically builds single-field indexes in ascending and descending orders for every field on every document.
- **Phase 7B Queries:**
  - `organizations.doc(id)`: Direct primary key lookup.
  - `organization_members.doc("${orgId}_${userId}")`: Direct primary key lookup.
  - `organization_members.where('organization_id', '==', orgId)`: Single-field equality filter.
  - `organization_members.where('user_id', '==', userId)`: Single-field equality filter.
  - `ministries.where('organization_id', '==', orgId)`: Single-field equality filter.
- **Verdict:** **NO NEW COMPOSITE INDEXES REQUIRED FOR PHASE 7B.** Standard single-field automatic indexes fully satisfy all Phase 7B query patterns without extra index declarations.

### 6. Phase 7B Concrete Test Matrix (21 Frozen Tests)
1. **Explicit Provisioning Authority:** `POST /api/v1/ministries/:id/organization/provision` succeeds for authenticated Ministry Admin/Owner; rejects non-admin with `403 Forbidden`.
2. **Non-Mutating GET Behavior:** Authenticated GET requests on unprovisioned ministries return `hasOrganization: false` without creating database records.
3. **Provisioning Idempotency:** Invoking provision twice sequentially for the same ministry returns the identical Organization record without duplicating state.
4. **Concurrency Safety:** Two concurrent provisioning requests for the same ministry result in exactly one Organization record created in Firestore.
5. **Deterministic Initial Owner:** Initial `organizations.owner_user_id` strictly matches `ministry.owner_user_id`.
6. **Concurrent Owner Stability:** A concurrent admin cannot overwrite or replace `organizations.owner_user_id` or `billing_anchor_ministry_id`.
7. **Owner Membership Invariant:** An `organization_members` document exists with `role: 'owner'` matching `owner_user_id`.
8. **Single Owner Invariant:** Exactly one member document holds `role: 'owner'` per Organization.
9. **Least-Privilege Org Admin:** An `ORG_ADMIN` attempting to call member management or ministry attach/detach endpoints is rejected with `403 Forbidden`.
10. **Attach Dual-Authorization:** Attaching a ministry requires caller to be `ORG_OWNER` of the organization AND `admin`/`owner` of the target ministry.
11. **Cross-Link Prevention:** Attaching a ministry already linked to a different Organization is rejected with `400 / 409`.
12. **Anchor Detachment Block:** Attempting to detach the `billing_anchor_ministry_id` is rejected with `400 CANNOT_DETACH_BILLING_ANCHOR`.
13. **Generic Member Owner Prohibition:** `POST /organizations/:id/members` with `{ role: 'owner' }` is rejected with `400 Bad Request`.
14. **Owner Deletion Prohibition:** `DELETE /organizations/:id/members/:ownerUserId` is rejected with `400 OWNER_CANNOT_BE_REMOVED`.
15. **Billing Anchor Subscription Scope:** Entitlement calculation strictly inspects the subscription of `billing_anchor_ministry_id`.
16. **Free Plan Quota:** Standalone free plan returns `includedConnections: 0, totalAllowedConnections: 0, canCreateConnection: false`.
17. **Paid Plan Quota:** Paid plan (e.g. Pro) returns `includedConnections: 1, totalAllowedConnections: 1, canCreateConnection: true`.
18. **Add-on Block Quota:** Paid plan with add-on blocks returns `includedConnections: 1, additionalConnections: N, totalAllowedConnections: 1 + N`.
19. **Grace Access Mode:** Overdue subscription in grace returns `accessMode: 'grace', canCreateConnection: false, canSendMessages: true`.
20. **Restricted Over Limit Mode:** Downgraded subscription over limit returns `accessMode: 'restricted_over_limit', canCreateConnection: false, canSendMessages: false`.
21. **Anti-IDOR & Fail-Closed Security:** Callers without organization membership querying organization endpoints receive indistinguishable `404 Not Found`.

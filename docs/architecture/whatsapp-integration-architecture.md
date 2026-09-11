# LouvAIO WhatsApp Integration — Technical & Domain Architecture

> **Authoritative Business Reference:** *"Integração com WhatsApp — Regras de Negócio"*
> **Target Release:** Phase 7 (WhatsApp Integration)
> **Document Status:** Architectural Specification & Implementation Boundary Finalization (Phase 7A-R3 Finalized)
> **Author:** LouvAIO Product Architect
> **Authorities:** "Integração com WhatsApp — Regras de Negócio", AGENTS.md, MEMORY.md, docs/system-status.md, docs/product/system-overview.md

---

## 1. Executive Summary & Principles

This document establishes the canonical, reconciled technical and domain architecture for LouvAIO's WhatsApp integration. It freezes all topological, membership, governance, boundary, and phase-split contracts prior to any production implementation in Phase 7B.

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
| `whatsapp_connections` | Root Collection | `id` (`wac_*`), `organization_id` | Provisioned phone numbers and connection states (Phase 7C). |
| `whatsapp_connection_secrets` | Restricted Root Collection | `id` (matches `connection_id`), `organization_id` | Encrypted access tokens and security metadata (Phase 7C). |
| `whatsapp_messages` | Root Collection | `id` (`wamsg_*`), `organization_id`, `ministry_id` | Transactional notification audit log and dispatch state (Phase 7G). |
| `whatsapp_webhook_events` | Root Collection | `id` (`wbh_*` or hash), `provider_event_id` | Sanitized webhook delivery log for deduplication (Phase 7E). |

*Subcollections are completely eliminated from the architecture.*

---

## 3. Organization Membership Model & RBAC (DEC-7A-14-R3, DEC-7A-20-R2)

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
4. **Owner Protection:** An owner membership can **never** be deleted through member management APIs (`DELETE /organizations/:id/members/:userId`). An owner cannot remove themselves without transfer.
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

## 4. Existing Ministries → Organization Association (DEC-7A-25-R2)

LouvAIO churches may operate multiple independent ministries in the system (e.g., *Louvor Geral*, *Louvor Jovens*, *Coral*). The association of these ministries into a unified Organization must be explicit, authorized, and non-destructive.

### Association Invariants & Authority
1. **Zero Heuristic Association:** The backend **NEVER** automatically groups ministries based on name similarity, email domain, shared members, or billing customer IDs. All associations must be explicitly authorized.
2. **Single Organization Boundary:** A Ministry belongs to **exactly one** Organization (`ministries.organization_id`).
3. **Strict Null-Organization Requirement (DEC-7A-25-R2):** Attaching a Ministry to Organization X succeeds **ONLY** if:
   ```text
   ministry.organization_id === null
   ```
   If the Ministry already belongs to ANY Organization (including an auto-provisioned standalone Organization), the request is strictly rejected with:
   ```text
   HTTP 409 Conflict (MINISTRY_ALREADY_HAS_ORGANIZATION)
   ```
4. **Organization Merge / Transfer Deferral:** LouvAIO does **NOT** support automatic or implicit merging of existing Organizations in Phase 7B. Merging a standalone Organization into another requires an explicit multi-tenant migration protocol (transferring members, resolving billing anchors, merging paid subscriptions, re-pointing WhatsApp connections, and archiving donor organizations). This capability is explicitly **DEFERRED**.
5. **Attach Authority (Dual-Authorization Handshake):** Attaching a Ministry to Organization X requires proof of authority in **both** contexts:
   - The executing actor must be the **`ORG_OWNER`** of Organization X; **AND**
   - The executing actor must be the **`owner`** or **`admin`** of the target Ministry.
6. **Preservation of Ministry Data:** Attaching a ministry causes **zero** changes to its songs, schedules, members, roles, unavailabilities, or subscriptions.
7. **Detach Authority & Safeguards:** A Ministry can be detached from an Organization **ONLY by the `ORG_OWNER`**, provided that the Ministry is **not** the `billing_anchor_ministry_id`.
   - Detaching the billing anchor ministry is strictly prohibited with `400 CANNOT_DETACH_BILLING_ANCHOR`.
   - Upon detachment:
     - `ministry.organization_id` is reset to `null`;
     - Any WhatsApp connection exclusively assigned to that ministry has its assignment cleared;
     - The detached Ministry operates independently without an Organization until explicitly provisioned;
     - Former Organization membership records are NOT copied to the ministry;
     - Ministry operational data and independent subscriptions remain 100% untouched.
8. **Empty-Organization Invariant:** An active Organization MUST always contain at least one Ministry (its billing anchor). Phase 7B operations can never produce an orphaned Organization with zero ministries.

---

## 5. Organization Provisioning & Concurrency Invariants (DEC-7A-27-R1)

### Invariants
1. **One-to-Many Cardinality:** An Organization contains 1 to N Ministries.
2. **Anchor Invariant:** An Organization must always have exactly one `billing_anchor_ministry_id`, and that ministry must belong to the Organization (`ministry.organization_id === organization.id`).
3. **Immutable Tenant ID:** The `organization.id` is immutable once created.

### Initial Owner Derivation & No Implicit Escalation (DEC-7A-27-R1)
In LouvAIO, every ministry document in Firestore maintains a canonical owner field: `ministries.owner_user_id: string`.
- **Authoritative Owner Source:**
  ```text
  INITIAL_ORG_OWNER_SOURCE: ministry.owner_user_id
  organizations.owner_user_id = ministry.owner_user_id
  ```
- **Strict Provisioning Authority:** Organization provisioning establishes institutional governance and is restricted strictly to the **Ministry Owner** (`ministry.owner_user_id`).
  - If a non-owner Ministry Admin attempts to invoke provisioning, the request is rejected with:
    ```text
    HTTP 403 Forbidden (ONLY_MINISTRY_OWNER_CAN_PROVISION_ORGANIZATION)
    ```
- **Zero Implicit Privilege Escalation:** Executing provisioning creates **exactly one** initial membership record:
  - `organization_members.doc(`${orgId}_${ministry.owner_user_id}`)` with `role: 'owner'`.
  - It does **NOT** grant Organization Admin (`role: 'admin'`) to any other Ministry Admin or member.
  - Any additional Organization Admins must be explicitly added post-creation by the `ORG_OWNER` via `POST /api/v1/organizations/:organizationId/members`.
  - This strictly preserves the boundary: **Ministry Authority != Organization Authority**.

### Explicit Provisioning Trigger (Command Pattern)
Creating an Organization establishes institutional tenant identity, legal owner authority, and billing anchors.
- **Strict Non-Mutating GET Behavior:** Ordinary authenticated `GET` requests (e.g., `GET /api/v1/ministries/:ministryId/whatsapp/status` or viewing a dashboard) **NEVER** implicitly create or provision an Organization. If no Organization exists, GET endpoints return `hasOrganization: false` or `404 Not Found`.
- **Explicit Provisioning Command:** Provisioning occurs strictly via an intentional `POST` command:
  ```text
  POST /api/v1/ministries/:ministryId/organization/provision
  ```

### Concurrency & Race Condition Resolution
When multiple provisioning requests are submitted concurrently:
- The backend executes inside an atomic Firestore transaction (`db.runTransaction`):
  1. Transaction reads `ministries.doc(ministryId)`.
  2. If `ministry.organization_id != null` (set by a concurrent transaction), the transaction commits nothing, aborts creation, and returns the existing Organization.
  3. If `ministry.organization_id == null`, the first transaction to commit creates:
     - `organizations.doc(orgId)` with `owner_user_id = ministry.owner_user_id`;
     - `organization_members.doc(`${orgId}_${ministry.owner_user_id}`)` with `role: 'owner'`;
     - Updates `ministries.doc(ministryId)` with `{ organization_id: orgId }`.
- **Resolution Invariant:** The first transaction to commit wins. The losing transaction retries, reads the newly set `organization_id`, and returns the existing Organization without overwriting `owner_user_id`, `role`, or `billing_anchor_ministry_id`.

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

## 7. Authoritative WhatsApp Entitlement Contract & Boundary Split (DEC-7A-29)

To ensure clean implementation boundaries and avoid coupling subsystems prematurely:
- **Phase 7B (Commercial Capacity Entitlement):** `SubscriptionService` evaluates commercial capacity derived exclusively from plan definitions and billing states.
- **Phase 7C (Connection Usage Composition & Enforcement):** A connection facade service combines commercial capacity with actual Firestore connection usage (`configuredConnectionsCount`, `capacityConsumingCount`, `remainingCapacity`, `isOverLimit`).
- **Phase 7H (Add-on Billing Integration):** Asaas recurring checkout and payment webhooks for additional WhatsApp connection blocks (`addons.additionalWhatsapps`).

### Phase 7B Method Signature
```typescript
SubscriptionService.getOrganizationWhatsAppCapacity(organizationId: string): Promise<OrganizationWhatsAppCapacity>
```

### Phase 7B Schema
```typescript
export interface OrganizationWhatsAppCapacity {
  organizationId: string;
  billingAnchorMinistryId: string;
  enabled: boolean; // True if subscription plan is active or in grace
  includedConnections: number; // 1 for paid plans (lite, lite_plus, essential, pro, premium), 0 for free
  additionalConnections: number; // Strictly 0 in Phase 7B runtime (extension seam for Phase 7H)
  totalAllowedConnections: number; // includedConnections + additionalConnections
  billingAccessMode: 'normal' | 'grace' | 'suspended';
}
```

### Additional Connection Policy for Phase 7B
- An audit of the production subscription engine confirms that member add-ons (`member_addon_blocks`) exist, but **no WhatsApp add-on schema (`addons.additionalWhatsapps`) exists in production code**.
- Phase 7B does **NOT** invent a premature add-on persistence schema.
- In Phase 7B runtime, `additionalConnections` evaluates to `0`. Phase 7B provides the clean extension seam for Phase 7H where `billing-engineer` will introduce Asaas recurring add-on blocks.

---

## 8. Billing Grace, Over-Limit & Non-Destructive Restrictions (DEC-7A-18-R1)

LouvAIO strictly enforces non-destructive data preservation.

### Operational Grace Period (`billingAccessMode === 'grace'`)
When a subscription payment is overdue but within the commercial grace window:
- **Sending Messages:** **Permitted**. Existing active connections continue dispatching operational schedule notifications without interruption.
- **New Onboarding:** **Blocked**. The system disallows starting new Embedded Signup sessions (`canCreateConnection: false` in 7C).
- **Configuration Modifications:** **Blocked**. Assigning or switching connections is locked.

### Restricted Over Limit (Phase 7C Operational Enforcement)
When commercial capacity drops below configured connections (e.g., plan downgrade from *Pro* to *Free*):
1. **Separation of Concerns:** Phase 7B establishes commercial capacity. Phase 7C introduces connection documents and evaluates whether `configuredConnectionsCount > totalAllowedConnections`.
2. **Zero Automatic Disabling / Zero Deletion:** The system **NEVER automatically picks a phone number to disable or disconnect.** Automatic selection risks shutting off the church's primary pastoral or administrative line.
3. **Operational Status:** In Phase 7C, when connections exceed capacity:
   - The Organization enters `restricted_over_limit`;
   - Creation of new connections is **BLOCKED**;
   - Outbound dispatch through all connections is **BLOCKED** with error code `RESTRICTED_OVER_LIMIT`;
   - The Org Admin must resolve the over-limit state by purchasing capacity (Phase 7H) or explicitly clicking **"Desconectar"** on specific connections.

---

## 9. Capacity Accounting & Loophole Elimination (Phase 7C Implementation)

### Status Definitions & Capacity Consumption (DEC-7C-04, DEC-7C-06)

| Connection Status | Consumes Quota Slot? | Can Send Messages? | Definition |
| :--- | :---: | :---: | :--- |
| `pending` | **Yes** | No | Reserved onboarding slot during Embedded Signup (expires via `pending_expires_at` 24h TTL). |
| `connecting` | **Yes** | No | Code exchanged, awaiting phone registration & webhook validation. |
| `connected` | **Yes** | **Yes** | Verified, active, and authorized to send template messages. |
| `error` | **Yes** | No | Transient technical fault, certificate mismatch, token expired, or health check failure. |
| `disabled_by_user` | **Yes** | No | Manually paused by Org Admin. Still occupies an allocated capacity slot. |
| `disconnected` | **No** | No | Soft-deleted / unlinked. Does NOT consume capacity. Permanent terminal state in V1. |

*(Note on `disabled_over_limit`: Removed per DEC-7C-04. Non-destructive quota over-limit is evaluated dynamically as an aggregate Organization mode `connectionAccessMode = 'restricted_over_limit'` rather than mutating individual connection documents.)*

### Elimination of the Accumulation Loophole (Phase 7C Enforced)
- In Phase 7C, new connection onboarding (`POST /whatsapp/onboarding/start`) strictly enforces:
  ```text
  configuredConnectionsCount < totalAllowedConnections
  ```
  where `configuredConnectionsCount` counts **ALL non-disconnected connections** (`status !== 'disconnected'`).
- The configured status set is strictly:
  ```typescript
  export const CONFIG_CONSUMING_STATUSES: WhatsAppConnectionStatus[] = [
    'pending',
    'connecting',
    'connected',
    'error',
    'disabled_by_user',
  ];
  ```
- To onboard a new connection when at quota, an administrator must explicitly **disconnect** an existing connection, moving it to `disconnected`.

---

## 10. Re-Upgrade Behavior & Sender Stability (DEC-7A-20-R1, DEC-7C-04)

When an Organization purchases additional add-on capacity or upgrades its plan:
1. **Explicit Reactivation Required:** Connections paused in `disabled_by_user` do **NOT** automatically resume sending messages.
2. **No Silent Sender Switching:** Automatic reactivation could cause recipients to unexpectedly receive messages from a different number than the one used during the restriction.
3. **Aggregate Over-Limit Lift:** When commercial capacity increases so that `configuredConnectionsCount <= totalAllowedConnections`, `connectionAccessMode` returns to `'normal'`. Existing `connected` lines immediately resume operational sending without individual document mutations.
4. **Administrative Flow:** The Org Admin dashboard indicates that newly purchased slots are available. If an Admin previously paused a line (`disabled_by_user`), the Admin explicitly clicks **"Reativar Conexão"**. The system validates that `configuredConnectionsCount <= totalAllowedConnections` and transitions the status to `connected`.

---

## 11. Default vs Exclusive Connection Invariants (DEC-7A-21-R1, DEC-7C-02, DEC-7C-03)

To eliminate routing ambiguity and ensure predictable messaging:

### 1. Default Connection Single Source of Truth (DEC-7C-02)
- **Canonical Authority:** `organizations.default_whatsapp_connection_id: string | null` is the **sole source of truth** for the Organization's default connection.
- **Elimination of Dual-Persistence Drift:** `whatsapp_connections.is_organization_default` is **REMOVED from the Firestore persistence schema**. It does NOT exist as a document field in `whatsapp_connections`.
- **Derived in API DTOs:** In API responses and DTOs (`WhatsAppConnectionDto`), `isOrganizationDefault: boolean` is derived dynamically on the server:
  ```typescript
  isOrganizationDefault = organization.default_whatsapp_connection_id === connection.id;
  ```
- **Atomic Mutation:** Setting or changing the default connection is an atomic update on the `organizations` document (`default_whatsapp_connection_id = connectionId`). Clearing the default sets `default_whatsapp_connection_id = null`. There is zero boolean dual-write drift or multi-connection boolean race.

### 2. Mutual Exclusivity Invariant
A connection **CANNOT** simultaneously be an Organization Default and an Exclusive Ministry Assignment:
- Setting a connection as the Organization default requires `connection.assigned_ministry_id === null`.
- Assigning a connection exclusively to a Ministry requires `organization.default_whatsapp_connection_id !== connection.id` (must clear or switch default first).

### 3. Assignment Cardinality (1:1)
- One connection is assigned to at most **one** Ministry (`assigned_ministry_id`).
- Each Ministry has at most **one** exclusively assigned connection.
- Shared usage occurs **exclusively** through the Organization default fallback.

### 4. Exclusive Unusable Fallback Prevention (DEC-7C-03)
A critical routing safety invariant:
- If Ministry M has an exclusive connection assigned, but that connection is currently **unusable** (`error`, `disabled_by_user`, `disconnected`):
  → The resolver **STRICTLY REFUSES** to send and fails with `CONNECTION_NOT_ACTIVE`.
  → The resolver **NEVER silently falls back** to the Organization default number.
- **Rationale:** If a youth ministry (*Louvor Jovens*) configured a dedicated number, and that line experiences a transient fault, dispatching messages from the church's senior pastoral line (*Atendimento Geral*) would violate recipient expectations, context, and privacy. Fallback to Organization default occurs **ONLY** when Ministry M has **NO explicit exclusive assignment** (`assigned_ministry_id === null`).

### 5. Connection Resolution Algorithm (`resolveWhatsAppConnection`)
When Ministry M requests message dispatch (Phase 7G):
1. **Commercial / Access Verification:**
   - Verify `ministry.organization_id !== null` (otherwise fail with `NO_ORGANIZATION`).
   - Evaluate `SubscriptionService.getOrganizationWhatsAppCapacity(org.id)`.
   - If `billingAccessMode === 'suspended'`, fail with `WHATSAPP_SUSPENDED`.
   - If `configuredConnectionsCount > totalAllowedConnections`, fail with `RESTRICTED_OVER_LIMIT`.
   - If `totalAllowedConnections === 0` (Free plan), fail with `RESTRICTED_OVER_LIMIT`.
2. **Step 1: Check Exclusive Ministry Assignment:**
   - Query: `whatsapp_connections.where('organization_id', '==', orgId).where('assigned_ministry_id', '==', M.id).limit(1)`.
   - If an exclusive connection is found:
     - If `status === 'connected'`: **Dispatch via Exclusive Connection**.
     - If `status !== 'connected'`: **Fail Closed with `CONNECTION_NOT_ACTIVE`** (do NOT fall back per DEC-7C-03).
3. **Step 2: Fallback to Organization Default (Only if No Exclusive Assignment):**
   - Read `org.default_whatsapp_connection_id`.
   - If `default_whatsapp_connection_id === null`: **Fail Closed with `NO_CONNECTION_AVAILABLE`**.
   - Load connection: `whatsapp_connections.doc(default_whatsapp_connection_id)`.
   - If not found or `connection.organization_id !== orgId`: **Fail Closed with `NO_CONNECTION_AVAILABLE`**.
   - If `connection.status === 'connected'`: **Dispatch via Organization Default Connection**.
   - If `connection.status !== 'connected'`: **Fail Closed with `CONNECTION_NOT_ACTIVE`**.

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

## 13. Secret Storage & Envelope Encryption Hardening (DEC-7A-19-R1, DEC-7C-08)

Meta Cloud API System User Tokens must be secured against data breaches and cross-tenant transplantation (implemented in Phase 7C).

### Cryptographic Specification
- **Algorithm:** AES-256-GCM (Authenticated Encryption with Associated Data).
- **Master Key:** `WHATSAPP_TOKEN_ENCRYPTION_KEY` configured in backend `unifiedConfig` (32-byte cryptographically random key, Base64-encoded). Server-only secret, never exposed to clients or build artifacts.
- **Nonce / IV:** Cryptographically secure unique 12-byte initialization vector generated per encryption operation (`crypto.randomBytes(12)`). IV reuse is strictly prohibited.
- **Authentication Tag:** 16-byte GCM authentication tag verifying ciphertext integrity (`cipher.getAuthTag()`).
- **Associated Authenticated Data (AAD):** The AAD binds the ciphertext to the exact tenant context:
  ```text
  AAD = `${organization_id}:${connection_id}`
  ```
  This prevents ciphertext transplantation attacks between connections or organizations.
- **Key Versioning:** Each secret record contains `key_version: number` (initial version: `1`) to enable zero-downtime key rotation in future phases.
- **Storage Encodings (DEC-7C-08):**
  - `encrypted_access_token`: Base64 string
  - `iv`: Base64 string (12 decoded bytes)
  - `auth_tag`: Base64 string (16 decoded bytes)
- **Fail-Closed Decryption:** Decryption failures throw `AppError(500, 'SECRET_DECRYPTION_FAILED')` and halt execution immediately.
- **Zero Logging:** Decrypted tokens are strictly prohibited from application logs, error traces, and diagnostic payloads.

### Boot-Safe Configuration Loading (DEC-7C-08)
- In `backend/src/config/unifiedConfig.ts`, the encryption key is defined as optional:
  ```typescript
  whatsappTokenEncryptionKey: z.string().optional()
  ```
- **Application Boot Safety:** Absence of `WHATSAPP_TOKEN_ENCRYPTION_KEY` in development or staging environments does **NOT** cause application boot failure while WhatsApp crypto operations remain uninvoked.
- **Runtime Fail-Closed Guard:** The crypto service (`WhatsAppEncryptionService`) evaluates the key upon construction or crypto invocation:
  - If the key is absent, empty, not valid Base64, or decodes to length !== 32 bytes (`Buffer.from(key, 'base64').length !== 32`):
    The service throws a typed internal configuration error `AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING')`.
- **Production Release Requirement:** Provisioning `WHATSAPP_TOKEN_ENCRYPTION_KEY` in Vercel Production is a mandatory prerequisite prior to deploying Phase 7C backend code.

#### `whatsapp_connection_secrets` Schema (Phase 7C)
```typescript
export interface WhatsAppConnectionSecretRecord {
  id: string; // matches connection_id
  connection_id: string; // foreign key to whatsapp_connections
  organization_id: string; // tenant boundary for cumulative anti-IDOR
  key_version: number; // encryption key version for rotation (1 initially)
  encrypted_access_token: string; // Base64 ciphertext
  iv: string; // Base64 IV (12 bytes)
  auth_tag: string; // Base64 GCM Tag (16 bytes)
  token_type: 'system_user' | 'user_token'; // [EXTERNAL META VALIDATION REQUIRED for token lifespan]
  expires_at: string | null; // ISO 8601 or null if permanent
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}
```

---

## 14. Webhook Event Retention, Privacy & Sanitization (DEC-7A-23-R1)

Inbound Meta webhook payloads may contain sensitive PII, participant phone numbers, and message bodies (Phase 7E).

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

To balance user control with auditability and relational integrity (Phase 7C):

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

### Functional Flow (Phase 7G)
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

## 18. Updated Decision Register (DEC-7A-01 .. DEC-7A-29, DEC-7C-01 .. DEC-7C-10)

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
| **DEC-7A-14-R3**| **Finalized** | Organization Membership & No Escalation | Introduces `organization_members`; provisioning creates owner record only (no implicit Org Admin grant). |
| **DEC-7A-15-R1**| **Remediated** | Billing Anchor Semantics | Subscriptions remain on `ministry_subscriptions`; zero auto-merging of multi-ministry subscriptions. |
| **DEC-7A-16-R1**| **Remediated** | Canonical Root Topology | Rejects subcollections; mandates root collections for all 6 entities. |
| **DEC-7A-17-R1**| **Remediated** | Capacity Accounting | Counts all non-disconnected connections; closes rotation loophole (Phase 7C). |
| **DEC-7A-18-R1**| **Remediated** | Non-Destructive Over-Limit | Replaces automatic phone disabling with `restricted_over_limit` mode & manual admin resolution (Phase 7C). |
| **DEC-7A-19-R1**| **Remediated** | Secret Storage Hardening | AES-256-GCM envelope encryption with key versioning and AAD tenant binding (Phase 7C). |
| **DEC-7A-20-R2**| **Finalized** | Least-Privilege Org Governance | `ORG_OWNER` manages admins and ministries; `ORG_ADMIN` manages connections only. |
| **DEC-7A-21-R1**| **Remediated** | Default vs Exclusive Invariant | Mutually exclusive; connection cannot be both default and assigned. 1:1 cardinality. |
| **DEC-7A-22-R1**| **Remediated** | Strict E.164 Backend | Backend rejects non-E.164; regional +55 defaults isolated to frontend. |
| **DEC-7A-23-R1**| **Remediated** | Webhook Privacy & Retention | Sanitized metadata persistence; 30-day retention TTL; no raw payload storage (Phase 7E). |
| **DEC-7A-24-R1**| **Remediated** | Disconnect vs Delete | Disconnect preserves audit; Delete purges record (restricted; Phase 7C). |
| **DEC-7A-25-R2**| **Finalized** | Strict Null-Org Attach & Merge Deferral | Attaching requires `ministry.organization_id === null`; already-provisioned ministries rejected (409); merge deferred. |
| **DEC-7A-26** | **New** | First Messaging Use Case | Explicit manual schedule call-up with idempotency and audit trail (Phase 7G). |
| **DEC-7A-27-R1**| **Finalized** | Owner Derivation & Provisioning Authority | `INITIAL_ORG_OWNER_SOURCE: ministry.owner_user_id`; provisioning restricted strictly to Ministry Owner. |
| **DEC-7A-28** | **New** | Billing Anchor Immutability in 7B | Public REST API does not mutate billing anchor in Phase 7B foundation. |
| **DEC-7A-29** | **New** | Commercial Entitlement Phase Split | 7B evaluates commercial capacity; 7C evaluates connection usage/over-limit; 7H evaluates add-on checkout. |
| **DEC-7C-01** | **Frozen** | Canonical Connection Schema & Nullability | Defines `WhatsAppConnectionRecord` with exact 6-status lifecycle nullability matrix; provider IDs nullable in `pending`. |
| **DEC-7C-02** | **Frozen** | Default Connection Single Source of Truth | `organizations.default_whatsapp_connection_id` is sole canonical authority; `is_organization_default` removed from persistence, derived in DTO. |
| **DEC-7C-03** | **Frozen** | Exclusive Unusable Fallback Prevention | Unusable exclusive connection fails with `CONNECTION_NOT_ACTIVE`; zero silent fallback to Organization default. |
| **DEC-7C-04** | **Frozen** | Status Model & Over-Limit Reachability | 6 active lifecycle states; `disabled_over_limit` removed; over-limit represented via `connectionAccessMode = 'restricted_over_limit'`. |
| **DEC-7C-05** | **Frozen** | Disconnect Responsibility & Boundaries | Internal domain disconnect in 7C; public disconnect and webhook unregistration activated in Phase 7D. |
| **DEC-7C-06** | **Frozen** | Capacity-Consuming Status Set | Configured count evaluates `['pending', 'connecting', 'connected', 'error', 'disabled_by_user']`; `disconnected` is excluded. |
| **DEC-7C-07** | **Frozen** | Provider Identity Uniqueness | Enforces platform uniqueness on `provider_phone_number_id` among non-disconnected connections. |
| **DEC-7C-08** | **Frozen** | Crypto Storage Encoding & Config Loading | Base64 encoding for ciphertext, IV, auth tag; optional config at boot, fail-closed runtime validation upon crypto invocation. |
| **DEC-7C-09** | **Frozen** | Composite Index & Query Contract | Declares 3 composite indexes for `whatsapp_connections` in `firestore.indexes.json`; deployment required before production release. |
| **DEC-7C-10** | **Frozen** | Pending TTL Ownership | Schema includes `pending_expires_at` (24h); automated cleanup sweeper deferred to Phase 7D onboarding. |

---

## 19. Phase 7B Concrete Implementation Contract

The following technical specification defines the exact scope for **Phase 7B (Organization Foundation & Commercial Entitlements)**:

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
  - `lazyProvisionForMinistry(ministryId: string, actorUserId: string): Promise<OrganizationRecord>` (atomic transaction, restricted strictly to `ministries.owner_user_id`)
  - `linkMinistryToOrganization(orgId: string, ministryId: string, actorUserId: string): Promise<void>` (dual-authorized transaction, requires `ministry.organization_id === null`)
  - `detachMinistryFromOrganization(orgId: string, ministryId: string, actorUserId: string): Promise<void>` (Org Owner only, rejects detaching billing anchor)

### 3. Services to Extend in Phase 7B
- **`backend/src/features/subscriptions/subscription.service.ts`:**
  - Add method `getOrganizationWhatsAppCapacity(organizationId: string): Promise<OrganizationWhatsAppCapacity>`.
  - Resolves `organizations.billing_anchor_ministry_id`, evaluates commercial plan definition (0 for Free, 1 for Paid plans), sets `additionalConnections = 0` (extension seam for 7H), and returns `billingAccessMode` (`normal`, `grace`, `suspended`).
  - *Does not reference connections or calculate over-limit states.*

### 4. Canonical REST API Endpoints Matrix for Phase 7B

| Method | Endpoint Path | Authority Required | Status in Phase 7B | Description & Preconditions |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/v1/organizations/:organizationId` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7B** | Retrieve Organization details. Returns 404 if not found or unauthorized. |
| **GET** | `/api/v1/organizations/:organizationId/members` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7B** | List Organization members and roles. |
| **POST** | `/api/v1/organizations/:organizationId/members` | `ORG_OWNER` only | **IMPLEMENT IN 7B** | Add Organization Admin (`{ userId, role: 'admin' }`). Rejects `role: 'owner'`. |
| **DELETE** | `/api/v1/organizations/:organizationId/members/:userId` | `ORG_OWNER` only | **IMPLEMENT IN 7B** | Remove Organization Admin. Rejects deleting current `owner_user_id`. |
| **GET** | `/api/v1/organizations/:organizationId/entitlements/whatsapp` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7B** | Return commercial capacity via `SubscriptionService.getOrganizationWhatsAppCapacity`. |
| **POST** | `/api/v1/ministries/:ministryId/organization/provision` | Ministry Owner only (`ministry.owner_user_id`) | **IMPLEMENT IN 7B** | Explicit command to provision Organization. Rejects non-owners with 403. |
| **POST** | `/api/v1/organizations/:organizationId/ministries/:ministryId` | `ORG_OWNER` of Organization AND (owner OR admin) of target Ministry | **IMPLEMENT IN 7B** | Attach existing Ministry. Rejects already-attached ministries with 409. |
| **DELETE** | `/api/v1/organizations/:organizationId/ministries/:ministryId` | `ORG_OWNER` only | **IMPLEMENT IN 7B** | Detach Ministry from Organization. Rejects detaching billing anchor with 400. |
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

### 6. Phase 7B Concrete Test Matrix (22 Frozen Tests)
1. **Ministry Owner Provisioning Authority:** `POST /api/v1/ministries/:id/organization/provision` succeeds for authenticated Ministry Owner (`ministry.owner_user_id`).
2. **Ministry Admin Provisioning Block:** `POST /api/v1/ministries/:id/organization/provision` invoked by a non-owner Ministry Admin is strictly rejected with `403 ONLY_MINISTRY_OWNER_CAN_PROVISION_ORGANIZATION`.
3. **No Implicit Privilege Escalation:** Executing provisioning does not grant Org Admin to any other ministry members; creates exactly one owner record for `ministry.owner_user_id`.
4. **Non-Mutating GET Behavior:** Authenticated GET requests on unprovisioned ministries return `hasOrganization: false` without creating database records.
5. **Provisioning Idempotency:** Sequential provisioning calls for the same ministry return the identical Organization record without duplicating state.
6. **Concurrency Safety:** Two concurrent provisioning requests for the same ministry produce exactly one Organization document in Firestore.
7. **Deterministic Initial Owner:** Initial `organizations.owner_user_id` strictly matches `ministry.owner_user_id`.
8. **Concurrent Owner Stability:** A concurrent request cannot overwrite or replace `organizations.owner_user_id` or `billing_anchor_ministry_id`.
9. **Owner Membership Invariant:** An `organization_members` document exists with `role: 'owner'` matching `owner_user_id`.
10. **Single Owner Invariant:** Exactly one member document holds `role: 'owner'` per Organization.
11. **Least-Privilege Org Admin:** An `ORG_ADMIN` attempting member management or ministry attach/detach endpoints is rejected with `403 Forbidden`.
12. **Attach Dual-Authorization:** Attaching a ministry requires caller to be `ORG_OWNER` of the organization AND `(owner OR admin)` of the target ministry.
13. **Attach Requires Null Organization:** Attaching a ministry succeeds only when `ministry.organization_id == null`.
14. **Already-Attached Ministry Rejection (409):** Attaching a ministry that already has `organization_id != null` (even a standalone organization) is rejected with `409 MINISTRY_ALREADY_HAS_ORGANIZATION`.
15. **Anchor Detachment Block:** Attempting to detach the `billing_anchor_ministry_id` is rejected with `400 CANNOT_DETACH_BILLING_ANCHOR`.
16. **Valid Detach Behavior:** Detaching a non-anchor ministry resets its `organization_id` to `null` while preserving ministry operational data.
17. **Generic Member Owner Prohibition:** `POST /organizations/:id/members` with `{ role: 'owner' }` is rejected with `400 Bad Request`.
18. **Owner Deletion Prohibition:** `DELETE /organizations/:id/members/:ownerUserId` is rejected with `400 OWNER_CANNOT_BE_REMOVED`.
19. **Billing Anchor Subscription Scope:** Capacity calculation strictly inspects the subscription of `billing_anchor_ministry_id`.
20. **Free Plan Quota:** Standalone free plan returns `includedConnections: 0, additionalConnections: 0, totalAllowedConnections: 0`.
21. **Paid Plan Quota:** Paid plan (e.g. Pro) returns `includedConnections: 1, additionalConnections: 0, totalAllowedConnections: 1, billingAccessMode: 'normal'`.
22. **Anti-IDOR & Fail-Closed Security:** Callers without organization membership querying organization endpoints receive indistinguishable `404 Not Found`.

---

## 20. Phase 7C Concrete Implementation Contract (WhatsApp Connection Domain & Secret Encryption)

The following technical specification defines the exact scope for **Phase 7C (WhatsApp Connection Domain & Secret Encryption)**:

### 1. Data Contracts & Persistence Schemas

#### A. `WhatsAppConnectionStatus` (DEC-7C-04)
The lifecycle status is restricted to exactly 6 frozen states:
```typescript
export type WhatsAppConnectionStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disabled_by_user'
  | 'disconnected';
```
*(Note: `disabled_over_limit` is explicitly eliminated per DEC-7C-04. Quota violations do not mutate individual connection statuses; they are evaluated dynamically as an aggregate Organization mode `connectionAccessMode = 'restricted_over_limit'`.)*

#### B. `whatsapp_connections` (Root Collection Schema — DEC-7C-01, DEC-7C-02)
```typescript
export interface WhatsAppConnectionRecord {
  id: string; // Document ID: `wac_${nanoid(20)}` or uuid
  organization_id: string; // Foreign key to organizations (tenant authority)
  display_name: string; // LouvAIO-local administrative label (1..100 chars)
  phone_number: string | null; // Canonical E.164 string; null in pending
  provider: 'meta_cloud_api'; // Vendor platform identifier
  provider_waba_id: string | null; // Meta WABA ID; null in pending
  provider_phone_number_id: string | null; // Meta Phone Number ID; null in pending
  status: WhatsAppConnectionStatus; // Current lifecycle status
  status_reason: string | null; // Sanitized internal status reason code (max 255 chars)
  assigned_ministry_id: string | null; // Foreign key to ministries (exclusive assignment); null if unassigned
  created_by_user_id: string; // Firebase Auth UID of creating Org Admin
  pending_expires_at: string | null; // ISO 8601 UTC; 24h TTL for 'pending'; null for all other statuses
  last_connected_at: string | null; // ISO 8601 UTC timestamp of last active connection
  last_health_check_at: string | null; // ISO 8601 UTC timestamp of last health evaluation
  created_at: string; // ISO 8601 UTC timestamp
  updated_at: string; // ISO 8601 UTC timestamp
}
```

#### C. Field-by-Field Authority, Lifecycle & Mutability Matrix
| Field Name | Type | Nullable? | Who Writes | When Known | Client Editable via PATCH? |
| :--- | :--- | :---: | :--- | :--- | :---: |
| `id` | `string` | No | Server | Creation (`wac_*`) | No |
| `organization_id` | `string` | No | Server | Creation (derived from route) | No |
| `display_name` | `string` | No | Org Admin / Server | Creation (user-supplied) | **Yes** (1..100 chars) |
| `phone_number` | `string` | Yes (in `pending`) | Server (via Provider) | Populated on registration | No |
| `provider` | `'meta_cloud_api'` | No | Server | Creation (`'meta_cloud_api'`) | No |
| `provider_waba_id` | `string` | Yes (in `pending`) | Server (via Provider) | Populated on token exchange | No |
| `provider_phone_number_id`| `string` | Yes (in `pending`) | Server (via Provider) | Populated on registration | No |
| `status` | `WhatsAppConnectionStatus` | No | Server | Initial `'pending'` / transitions | No |
| `status_reason` | `string` | Yes | Server | Populated on error/timeout | No |
| `assigned_ministry_id` | `string` | Yes | Org Admin / Server | Assigned or null | **Yes** (via dedicated assign) |
| `created_by_user_id` | `string` | No | Server | Creation (`req.user.id`) | No |
| `pending_expires_at` | `string` | Yes | Server | Creation (now + 24h for pending)| No |
| `last_connected_at` | `string` | Yes | Server | On entering `connected` | No |
| `last_health_check_at` | `string` | Yes | Server | On health check run | No |
| `created_at` | `string` | No | Server | Creation (ISO 8601 UTC) | No |
| `updated_at` | `string` | No | Server | Mutation (ISO 8601 UTC) | No |

#### D. Pre-Connected Lifecycle State vs Nullability Matrix (DEC-7C-01)
| Field | `pending` | `connecting` | `connected` | `error` | `disabled_by_user` | `disconnected` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `id` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `organization_id` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `display_name` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `provider` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `status` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `created_by_user_id` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `created_at` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `updated_at` | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED | REQUIRED |
| `phone_number` | **NULL ALLOWED** | **REQUIRED** | **REQUIRED** | **REQUIRED** | **REQUIRED** | **REQUIRED** |
| `provider_waba_id` | **NULL ALLOWED** | **REQUIRED** | **REQUIRED** | **REQUIRED** | **REQUIRED** | **REQUIRED** |
| `provider_phone_number_id`| **NULL ALLOWED** | **REQUIRED** | **REQUIRED** | **REQUIRED** | **REQUIRED** | **REQUIRED** |
| `pending_expires_at` | **REQUIRED** (24h) | **MUST BE NULL** | **MUST BE NULL** | **MUST BE NULL** | **MUST BE NULL** | **MUST BE NULL** |
| `assigned_ministry_id` | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED |
| `status_reason` | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED |
| `last_connected_at` | NULL ALLOWED | NULL ALLOWED | **REQUIRED** | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED |
| `last_health_check_at` | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED | NULL ALLOWED |

*Timing Note:* The exact moment Meta SDK yields `phone_number` vs `provider_waba_id` in Phase 7D remains cataloged as `[EXTERNAL META VALIDATION REQUIRED]`. Phase 7C persistence strictly tolerates null provider identity fields in `pending` status without guessing Meta callback sequence.

#### E. `whatsapp_connection_secrets` (Restricted Root Collection Schema — DEC-7C-08)
```typescript
export interface WhatsAppConnectionSecretRecord {
  id: string; // matches connection_id
  connection_id: string; // foreign key to whatsapp_connections
  organization_id: string; // tenant boundary for cumulative anti-IDOR
  key_version: number; // encryption key version for rotation (1 initially)
  encrypted_access_token: string; // Base64 ciphertext
  iv: string; // Base64 IV (12 decoded bytes)
  auth_tag: string; // Base64 GCM Tag (16 decoded bytes)
  token_type: 'system_user' | 'user_token'; // [EXTERNAL META VALIDATION REQUIRED for token lifespan]
  expires_at: string | null; // ISO 8601 or null if permanent
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}
```

---

### 2. Repositories to Implement in Phase 7C

#### A. `backend/src/repositories/WhatsAppConnectionRepository.ts`
- `getConnectionById(connectionId: string): Promise<WhatsAppConnectionRecord | null>`
- `listConnectionsByOrganization(orgId: string, limit?: number): Promise<WhatsAppConnectionRecord[]>`
- `findAssignedConnectionForMinistry(orgId: string, ministryId: string): Promise<WhatsAppConnectionRecord | null>`
- `countConfiguredConnections(orgId: string): Promise<number>` (counts statuses in `CONFIG_CONSUMING_STATUSES`)
- `findByProviderPhoneNumberId(phoneId: string): Promise<WhatsAppConnectionRecord | null>`
- `createConnection(data: CreateWhatsAppConnectionData): Promise<WhatsAppConnectionRecord>` (internal only)
- `updateConnection(orgId: string, connectionId: string, data: Partial<WhatsAppConnectionRecord>): Promise<void>`
- `setConnectionStatus(orgId: string, connectionId: string, status: WhatsAppConnectionStatus, reason?: string | null): Promise<void>`
- `disconnectConnection(orgId: string, connectionId: string): Promise<void>` (internal atomic domain disconnect)

#### B. `backend/src/repositories/WhatsAppConnectionSecretRepository.ts`
- `getSecret(orgId: string, connectionId: string): Promise<WhatsAppConnectionSecretRecord | null>` (enforces cumulative `organization_id` + `connection_id`)
- `setSecret(secret: WhatsAppConnectionSecretRecord): Promise<void>`
- `deleteSecret(orgId: string, connectionId: string): Promise<void>` (internal cleanup)

---

### 3. Services to Implement in Phase 7C

#### A. `backend/src/features/whatsapp/whatsapp-encryption.service.ts`
- `encryptToken(token: string, orgId: string, connectionId: string): { encryptedAccessToken: string; iv: string; authTag: string; keyVersion: number }`
- `decryptToken(record: WhatsAppConnectionSecretRecord): string`
- Enforces:
  - AES-256-GCM authenticated encryption.
  - AAD: `${organization_id}:${connection_id}`.
  - Storage encoding: Base64 for ciphertext, IV, auth tag.
  - Fail-closed error: `AppError(500, 'SECRET_DECRYPTION_FAILED')` on tampered ciphertext, bad tag, or mismatched AAD.
  - Boot-safe config loading: Throws `AppError(500, 'WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING')` at runtime if `WHATSAPP_TOKEN_ENCRYPTION_KEY` is missing, not valid Base64, or length !== 32 bytes.
  - Decrypted token zero logging guarantee.

#### B. `backend/src/features/whatsapp/whatsapp-connection.service.ts`
- `listConnections(orgId: string, actorUserId: string): Promise<WhatsAppConnectionDto[]>`
- `updateConnection(orgId: string, connectionId: string, input: UpdateWhatsAppConnectionInput, actorUserId: string): Promise<WhatsAppConnectionDto>`
- `setOrganizationDefault(orgId: string, connectionId: string, actorUserId: string): Promise<void>`
- `clearOrganizationDefault(orgId: string, actorUserId: string): Promise<void>`
- `assignMinistry(orgId: string, connectionId: string, ministryId: string, actorUserId: string): Promise<void>`
- `unassignMinistry(orgId: string, connectionId: string, actorUserId: string): Promise<void>`
- `getOrganizationCapacityUsage(orgId: string): Promise<OrganizationWhatsAppCapacityUsageDto>`
- `resolveWhatsAppConnection(ministryId: string): Promise<ResolvedWhatsAppConnectionResult>`

---

### 4. Canonical REST API Endpoints Matrix for Phase 7C

| Method | Endpoint Path | Authority Required | Status in Phase 7C | Description & Preconditions |
| :--- | :--- | :--- | :--- | :--- |
| **GET** | `/api/v1/organizations/:organizationId/whatsapp/connections` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7C** | List Organization connections with safe DTOs (`WhatsAppConnectionDto`). Enforces bounded limit (max 50). |
| **PATCH** | `/api/v1/organizations/:organizationId/whatsapp/connections/:connectionId` | `ORG_OWNER` or `ORG_ADMIN` | **IMPLEMENT IN 7C** | Update connection configuration (`displayName`, `isOrganizationDefault`, `assignedMinistryId`). |
| **GET** | `/api/v1/ministries/:ministryId/whatsapp/status` | `MINISTRY_ADMIN` or `MINISTRY_MEMBER` | **IMPLEMENT IN 7C** | Ministry resolved WhatsApp status DTO (`MinistryWhatsAppStatusDto`). Omit secrets and foreign org data. |
| **POST** | `/api/v1/organizations/:organizationId/whatsapp/connections` | None | **PROHIBITED IN 7C** | **NO public connection creation.** Connection onboarding belongs strictly to Phase 7D (Meta Embedded Signup). |
| **POST** | `/api/v1/organizations/:organizationId/whatsapp/connections/:connectionId/disconnect` | None | **DEFER TO 7D** | Public disconnect requires Meta webhook deregistration. Phase 7C implements internal domain method only. |
| **DELETE** | `/api/v1/organizations/:organizationId/whatsapp/connections/:connectionId` | None | **PROHIBITED IN 7C** | No public hard-delete connection endpoint in Phase 7C. Data preservation strictly enforced. |

---

### 5. Invariants & Business Logic Specifications

#### A. Default Connection Authority (DEC-7C-02)
- Canonical pointer: `organizations.default_whatsapp_connection_id: string | null`.
- `whatsapp_connections.is_organization_default` is **NOT** a persistent Firestore field.
- Setting default (`PATCH ...` with `{ isOrganizationDefault: true }`):
  1. Load target connection: verify `connection.organization_id === orgId`.
  2. Invariant: `connection.assigned_ministry_id === null` (cannot be exclusively assigned).
  3. Invariant: `connection.status !== 'disconnected' && connection.status !== 'pending'`.
  4. Atomically update `organizations.doc(orgId)` with `{ default_whatsapp_connection_id: connectionId, updated_at: now }`.
- Clearing default (`PATCH ...` with `{ isOrganizationDefault: false }`):
  1. If `org.default_whatsapp_connection_id === connectionId`, atomically set `default_whatsapp_connection_id = null`.

#### B. Exclusive Ministry Assignment Invariants (DEC-7C-03)
- Setting exclusive assignment (`PATCH ...` with `{ assignedMinistryId: ministryId }`):
  1. Load target connection: verify `connection.organization_id === orgId`.
  2. Invariant: `org.default_whatsapp_connection_id !== connectionId` (cannot be current Organization default).
  3. Load target ministry: verify `ministry.organization_id === orgId`.
  4. Invariant: Target Ministry cannot already have another exclusive connection assigned (`findAssignedConnectionForMinistry` must return null or the same connection). Rejects with `409 MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION`.
  5. Atomically update `whatsapp_connections.doc(connectionId)` with `{ assigned_ministry_id: ministryId, updated_at: now }`.
- Clearing assignment (`PATCH ...` with `{ assignedMinistryId: null }`):
  - Atomically update `whatsapp_connections.doc(connectionId)` with `{ assigned_ministry_id: null, updated_at: now }`.

#### C. Unusable Exclusive Fallback Prevention (DEC-7C-03)
- If Ministry M has an assigned connection, but `connection.status !== 'connected'`:
  `resolveWhatsAppConnection(M.id)` returns `{ success: false, code: 'CONNECTION_NOT_ACTIVE' }`.
- **Zero silent fallback:** The resolver NEVER falls back to the Organization default when an exclusive assignment is configured on the Ministry.

#### D. Non-Destructive Over-Limit & Capacity Composition (DEC-7C-04, DEC-7C-06)
- Evaluated dynamically:
  ```typescript
  const configured = await connectionRepo.countConfiguredConnections(orgId);
  const capacity = await subscriptionService.getOrganizationWhatsAppCapacity(orgId);
  const isOverLimit = configured > capacity.totalAllowedConnections;
  const connectionAccessMode = capacity.billingAccessMode === 'suspended'
    ? 'suspended'
    : isOverLimit
      ? 'restricted_over_limit'
      : capacity.billingAccessMode; // 'normal' or 'grace'
  ```
- If `connectionAccessMode === 'restricted_over_limit'`:
  - `canCreateConnection: false`
  - `canSendMessages: false`
  - Outbound dispatch blocked with `RESTRICTED_OVER_LIMIT`.
  - **Zero documents mutated or deleted.**

#### E. Provider Identity Uniqueness (DEC-7C-07)
- For any non-null `provider_phone_number_id`:
  - Before saving a new or linked connection, the service queries `whatsapp_connections.where('provider_phone_number_id', '==', phoneId).limit(2)`.
  - If any existing non-disconnected connection (`status !== 'disconnected'`) possesses the same `provider_phone_number_id`, creation/link is rejected with `409 PROVIDER_PHONE_ALREADY_REGISTERED`.

---

### 6. Safe Public DTOs (DEC-7C-01, DEC-7C-02)

#### A. `WhatsAppConnectionDto` (Organization Connection List / Detail)
```typescript
export interface WhatsAppConnectionDto {
  id: string;
  organizationId: string;
  displayName: string;
  phoneNumber: string | null;
  provider: 'meta_cloud_api';
  status: WhatsAppConnectionStatus;
  statusReason: string | null;
  isOrganizationDefault: boolean; // Derived from organization.default_whatsapp_connection_id === connection.id
  assignedMinistryId: string | null;
  createdAt: string;
  updatedAt: string;
}
```
*(Category rule: `encrypted_access_token`, `iv`, `auth_tag`, `key_version`, and raw credentials are NEVER exposed in DTOs.)*

#### B. `MinistryWhatsAppStatusDto` (Ministry-Facing Resolved Status)
```typescript
export interface MinistryWhatsAppStatusDto {
  hasOrganization: boolean;
  organizationId: string | null;
  isConfigured: boolean; // True if exclusive or default connection is found
  isConnected: boolean; // True if resolved connection has status === 'connected'
  source: 'exclusive' | 'default' | 'none';
  connectionId: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  connectionAccessMode: 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
  canSendMessages: boolean;
}
```

#### C. `OrganizationWhatsAppCapacityUsageDto` (Capacity & Usage Summary)
```typescript
export interface OrganizationWhatsAppCapacityUsageDto {
  organizationId: string;
  billingAnchorMinistryId: string;
  totalAllowedConnections: number;
  includedConnections: number;
  additionalConnections: number;
  configuredConnectionsCount: number;
  remainingCapacity: number;
  billingAccessMode: 'normal' | 'grace' | 'suspended';
  connectionAccessMode: 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
  canCreateConnection: boolean;
  canSendMessages: boolean;
}
```

---

### 7. Firestore Composite Index Contract & Terminology (DEC-7C-09)

#### Exact Index Declarations (`backend/firestore.indexes.json`)
```json
{
  "collectionGroup": "whatsapp_connections",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "organization_id", "order": "ASCENDING" },
    { "fieldPath": "created_at", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "whatsapp_connections",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "organization_id", "order": "ASCENDING" },
    { "fieldPath": "assigned_ministry_id", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "whatsapp_connections",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "organization_id", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" }
  ]
}
```

#### Authoritative Deployment Terminology
- **`FIRESTORE_INDEX_DECLARATION_REQUIRED: YES`**: The 3 composite indexes above MUST be declared in `backend/firestore.indexes.json` as part of Phase 7C implementation.
- **`FIRESTORE_INDEX_DEPLOYMENT_REQUIRED_BEFORE_PRODUCTION_RELEASE: YES`**: These composite indexes MUST be deployed to Google Cloud Firestore before Phase 7C code runs in production.
- **`FIRESTORE_INDEX_DEPLOYMENT_DURING_7C_IMPLEMENTATION: NO`**: No deployment commands (`firebase deploy --only firestore:indexes`) are authorized during Phase 7C local execution.
- **`PRODUCTION_ENV_CHANGE_REQUIRED_BEFORE_7C_RELEASE: YES`**: `WHATSAPP_TOKEN_ENCRYPTION_KEY` must be configured in Vercel Production before Phase 7C release.
- **`FIRESTORE_RULES_CHANGE_REQUIRED: NO`**: Collections are consumed strictly by the backend Firebase Admin SDK; no direct client Firestore access exists.

---

### 8. Phase 7C Concrete Test Matrix (Frozen Scenarios)

1. **AES-256-GCM Crypto Round-Trip:** Encrypt and decrypt access token produces identical plaintext.
2. **IV Uniqueness:** Encrypting identical plaintext twice produces distinct ciphertexts and IVs.
3. **AAD Tenant Binding Security:** Decryption with incorrect `organization_id` fails with `SECRET_DECRYPTION_FAILED`.
4. **AAD Connection Binding Security:** Decryption with incorrect `connection_id` fails with `SECRET_DECRYPTION_FAILED`.
5. **Ciphertext Tamper Resistance:** Mutating ciphertext bytes causes decryption failure (fail-closed).
6. **Auth Tag Tamper Resistance:** Mutating authentication tag causes decryption failure (fail-closed).
7. **Key Validation Fail-Closed:** Missing, non-Base64, or length !== 32 byte master key throws `WHATSAPP_ENCRYPTION_KEY_INVALID_OR_MISSING`.
8. **Secret Non-Exposure:** Decrypted tokens and secret records NEVER appear in `WhatsAppConnectionDto` or HTTP responses.
9. **Single Default Authority:** Setting default updates `organizations.default_whatsapp_connection_id`; derived `isOrganizationDefault` is true for that connection only.
10. **Default Replacement Atomicity:** Setting a second connection as default updates Organization pointer and reflects correctly in derived DTOs without boolean dual-write races.
11. **Default Mutual Exclusivity:** Setting a connection with `assigned_ministry_id !== null` as default is rejected with `400 CANNOT_SET_ASSIGNED_CONNECTION_AS_DEFAULT`.
12. **Exclusive Assignment Mutual Exclusivity:** Assigning the current Organization default connection to a Ministry is rejected with `400 CANNOT_ASSIGN_DEFAULT_CONNECTION`.
13. **Exclusive Assignment Cross-Tenant Rejection:** Assigning a connection to a Ministry belonging to a different Organization is rejected with `404 Not Found`.
14. **Single Exclusive Assignment per Ministry:** Attempting to assign a second connection to a Ministry that already has one is rejected with `409 MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION`.
15. **Unusable Exclusive Fallback Prevention (DEC-7C-03):** When a Ministry has an exclusive connection in `error` status, `resolveWhatsAppConnection` returns `CONNECTION_NOT_ACTIVE`; does NOT fall back to default.
16. **Usable Exclusive Resolution:** When a Ministry has an exclusive connection in `connected` status, resolver selects it over the Organization default.
17. **Default Fallback Resolution:** When a Ministry has no exclusive assignment, resolver successfully selects the Organization default in `connected` status.
18. **Unconfigured Ministry Resolution:** Ministry with no exclusive assignment and no Organization default returns `NO_CONNECTION_AVAILABLE`.
19. **Unprovisioned Ministry Resolution:** Ministry with `organization_id === null` returns `NO_ORGANIZATION`.
20. **Capacity Accounting Composition:** Configured count counts `['pending', 'connecting', 'connected', 'error', 'disabled_by_user']`; excludes `disconnected`.
21. **Non-Destructive Over-Limit Evaluation:** When configured > allowed, `connectionAccessMode` evaluates to `restricted_over_limit`; resolver fails with `RESTRICTED_OVER_LIMIT`; zero documents mutated.
22. **Operational Grace Resolution:** Subscription in `grace` mode allows existing `connected` lines to send messages (`canSendMessages: true`), but blocks creation (`canCreateConnection: false`).
23. **Suspended Resolution:** Subscription in `suspended` mode blocks dispatch (`canSendMessages: false`) with `WHATSAPP_SUSPENDED`.
24. **Provider Identity Uniqueness:** Saving a connection with a `provider_phone_number_id` already registered on an active connection is rejected with `409 PROVIDER_PHONE_ALREADY_REGISTERED`.
25. **Org Admin vs Ministry Admin RBAC:** Org Admin can manage connections via PATCH; Ministry Admin is rejected with `403 Forbidden` on Organization endpoints.
26. **Anti-IDOR Security:** Callers querying connections of an Organization they do not belong to receive indistinguishable `404 Not Found`.
27. **Query Limit Bounding:** Connection listing enforces maximum limit of 50 and deterministic ordering (`created_at DESC, __name__ DESC`).

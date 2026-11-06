# M20 Phase 2.6 — Firebase staging and Android login

## Result

**PARTIAL.** Local isolation guards and a reproducible staging APK workflow are prepared. Authenticated Android login is not validated because a dedicated Firebase project/account and isolated Preview Admin credentials do not yet exist in this repository's verified evidence.

## Firebase isolation audit

- The supplied Vercel evidence confirms the same variable names (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`) are configured for Production and Preview. Secret values were not read or compared, so whether those environments currently point to the same Firebase project is **Unknown / Not yet verified**. Separate Firestore isolation is also **not established**.
- Local Android production config identifies `praise-app-7a362`; the backend initializes Firebase Admin from `config.firebase` and uses that Admin Auth instance to verify ID tokens and access Firestore. This creates a production-data risk for any Preview route that performs authenticated reads or writes.
- This work did not retrieve or print Vercel variable values, inspect live Firebase resources, sign in, or write Firestore data. Whether live Firebase Auth tenants/rules create any additional isolation is **Unknown / Not yet verified**.
- Backend Preview now selects only `FIREBASE_STAGING_PROJECT_ID`, `FIREBASE_STAGING_CLIENT_EMAIL`, `FIREBASE_STAGING_PRIVATE_KEY`, `FIREBASE_STAGING_DATABASE_URL`, and `FIREBASE_STAGING_WEB_API_KEY`. The dedicated Web API key matters because password login calls Firebase Identity Toolkit. Preview refuses to start if required staging credentials are absent or the project ID names `praise-app-7a362`. Production continues to use the existing variable names.

## Local setup required

The Firebase owner must create a dedicated Firebase project for staging, then:

1. Enable Email/Password Firebase Authentication and create one disposable test user. Do not reuse a production account.
2. Create/enable Firestore in the staging project, configure the intended rules and indexes, and create the Android Firebase app with package `com.louvaio.app.staging`.
3. Obtain that app's `google-services.json` and its Firebase options (project ID, app ID, API key, sender ID, storage bucket). Keep the JSON out of Git; supply it to the workflow secret `FIREBASE_STAGING_GOOGLE_SERVICES_JSON`.
4. Add repository Actions secrets `FIREBASE_STAGING_PROJECT_ID`, `FIREBASE_STAGING_API_KEY`, `FIREBASE_STAGING_APP_ID`, `FIREBASE_STAGING_MESSAGING_SENDER_ID`, `FIREBASE_STAGING_STORAGE_BUCKET`, and `FIREBASE_STAGING_GOOGLE_SERVICES_JSON`.
5. Add `FIREBASE_STAGING_PROJECT_ID`, `FIREBASE_STAGING_CLIENT_EMAIL`, `FIREBASE_STAGING_PRIVATE_KEY`, `FIREBASE_STAGING_DATABASE_URL`, and `FIREBASE_STAGING_WEB_API_KEY` to the Vercel project's **Preview-only** environment. These must identify the dedicated staging project/service account. Do not edit or replace the existing shared variables. Missing configuration now fails closed, so Preview API startup will remain unavailable until this is done.
6. Set GitHub Actions variable `STAGING_API_BASE_URL` to the HTTPS Vercel Preview API root ending in `/api/v1`.

The Flutter staging flavor uses `lib/main.dart`, has application ID `com.louvaio.app.staging`, and requires explicit staging Firebase Dart defines with `FIREBASE_ENV=staging`. It cannot fall back to the production Firebase options. The existing offline `preview` flavor remains separate at `com.louvaio.app.preview`.

## Vercel access plan

Keep Vercel Authentication enabled while staging Firebase isolation and authenticated API checks are incomplete. Once owner approval is given and checks pass, the owner may add one stable, dedicated Preview deployment domain under Deployment Protection Exceptions, then confirm that no production/custom alias is included. An exception makes that domain publicly accessible; it should be removed when the Android test window ends. Do not place a bypass token, SSO cookie, or share URL in the APK.

Vercel documents that Deployment Protection Exceptions exempt only listed Preview domains from protection and make those domains public ([exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions), [protection methods](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection)). The exact domain choice, exception creation/removal, and any production/Vercel settings changes require the project owner's explicit action.

## GitHub Actions

`.github/workflows/android-staging-apk.yml` is manually dispatched and builds a debug APK using `--flavor staging --target lib/main.dart`. It validates required configuration, rejects the known production Firebase project, verifies the Android package and project in `google-services.json`, checks that the API URL is a Vercel Preview URL, and uploads `louvaio-android-staging-debug`. The app ID permits side-by-side installation with production. Workflow/build success proves packaging only; it does not prove sign-in or tenant isolation.

## Evidence and outstanding validation

- Existing reported evidence: Preview without SSO received HTTP 302; authorized CLI access reached the backend and got JSON 401 without a token. This turn did not repeat network access.
- Backend auth middleware passes bearer ID tokens to `UserRepository.verifyToken`, which delegates to Firebase Admin token verification. RBAC/tenant checks remain in the existing backend request path.
- After staging setup and before making the Preview domain public, verify `/api/v1/auth/me` without a token returns JSON 401, an invalid token returns JSON 401, and the staging test account receives the expected authenticated response. Then verify through Firebase project identifiers/audit logs that requests and writes target only staging. Do not run these authenticated checks until Admin and client project IDs have been independently confirmed equal and different from production.
- A successful APK build is not evidence that Android login works. No authenticated login or live Firestore write was attempted here.

## Report fields

| Field | Result |
|---|---|
| `M20_P2_6_RESULT` | `PARTIAL` |
| `FIREBASE_PREVIEW_ISOLATION` | `Unknown / Not yet verified`; shared variable names confirmed, values not compared; local fail-closed staging selection prepared |
| `PRODUCTION_DATA_RISK` | `HIGH / unresolved` until owner confirms project IDs differ and Preview-only staging credentials are configured and verified |
| `STAGING_FIREBASE_CONFIGURATION` | Local integration ready; external Firebase project/app/account and Vercel Preview variables required |
| `STAGING_ANDROID_FLAVOR` | Prepared: `staging`, `com.louvaio.app.staging`, `lib/main.dart`; offline `preview` preserved |
| `VERCEL_ACCESS_PLAN` | Keep protection on; owner may later exempt only one dedicated Preview domain after isolation checks |
| `GITHUB_ACTIONS_PREPARATION` | Prepared; dispatch workflow fails closed on missing/mismatched staging config |
| `AUTHENTICATED_LOGIN_EVIDENCE` | `Unknown / Not yet verified` |
| `LOCAL_COMMIT` | None; commit was not authorized |
| `EXTERNAL_SETUP_REQUIRED` | Dedicated Firebase project, Android app/config, disposable test account, Preview-only Admin variables, GitHub Actions secrets/variable |
| `READY_FOR_CONTROLLED_PUBLICATION` | `NO`; authenticated staging and Preview data isolation are unverified |

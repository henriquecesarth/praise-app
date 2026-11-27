# M20-C14 Gate 5B - controlled Web Preview deployment

Status: PARTIAL. Web deployment and alias reassociation PASS. Authenticated hosted Staging homologation BLOCKED. Owner explicitly authorized Preview publication and this single alias reassociation. Gate 6 not started.

## Verified target and preserved state

- Team: team_ylfphncn6owT7qNenQR0kyjY.
- Web project: praise-app-m7tn / prj_IXyRDcVckZ5E15nVWPch1YKD9m5S, root directory web, Vite, Node 24.x.
- Branch retained: feat/m20-phase-2a-android-share. HEAD retained: 452a2558e9fbb16e509a99a682c368e329821d15. Existing uncommitted Gates 1-5 WIP included in the prebuilt artifact; no commits/push/merge/reset/clean.
- Initial free disk approximately 2.04 GiB; final approximately 2.02 GiB. No cleanup. CLI dependency check reported up to date; package/package-lock files remained unchanged.
- Preview configuration targets exactly https://praise-qvjml6wfi-henriquecesarths-projects.vercel.app/api/v1. Public configuration was checked without printing secrets. web/.env uses a local-development default; Preview overrides it. preview.config.ts fail-closed guard preserved and tested. No environment variables changed remotely.

## Deployment receipt

- Deployment: dpl_EJfKuTikmQhLKoBEZNvuUYdAjLRx, READY, source CLI, Preview (API target=null; explicit --environment preview).
- Unique URL: https://praise-app-m7tn-advbnm60c-henriquecesarths-projects.vercel.app.
- Authorized alias: https://praise-app-m7tn-git-feat-m20-p-904232-henriquecesarths-projects.vercel.app.
- Prior alias deployment and rollback: dpl_6G2oZpyJW4ggsYVUxmHBWRx4keHn / https://praise-app-m7tn-hv99uzd4x-henriquecesarths-projects.vercel.app.
- Backend unchanged: dpl_FqJPG3H3rTXHWVVVtZd9Jz4vTy8c, READY at the API above.
- Production/default and git-main Web aliases still resolve to dpl_GX9FdoAZJvF5yYmV6jgdz8FKbvfK, not the new Preview.

Executed publication path: vercel build --environment preview, followed by vercel deploy --prebuilt --environment preview, explicitly scoped to the Web project/team. No --prod or promotion. CLI 65 rejected --skip-domain before any deployment was created because that option is production-only. Normal Preview deployment left the existing alias on M20-C13, verified immediately afterward. Only after the pre-alias smoke passed was the authorized alias reassigned via authenticated Vercel connector; receipt returned oldDeploymentId=M20-C13. Readback confirmed the new mapping.

## Smoke and artifact verification

- PASS: 215 focused Web tests including Preview fail-closed/reauthentication tests. An initial config-test run from repository root could not resolve esbuild in its child process; rerunning all nine files from web passed.
- PASS: vercel build, TypeScript, Vite, PWA; output target preview. Build manifest records source SHA-256 and static assets. No server functions in the artifact.
- PASS: authenticated read-only Vercel fetch of HTML for /, /cifras, /cifras/nova and a synthetic /cifras/:id/editar path returned 200 before alias reassociation. The latter proves SPA fallback only, not loading a persisted record.
- PASS: JS/CSS returned 200 with correct MIME types. Full text length/FNV fingerprints match local prebuilt assets; manifest includes local SHA-256. Bundle includes M20-C14 markers and the required Backend URL.
- PASS: alias /cifras/nova returns new assets after reassociation. Rollback URL still returns 200 and its original M20-C13 assets through authorized read-only transport.
- Deployment Protection retained: SSO enabled with all_except_custom_domains, password/trusted-IP settings unchanged. No WAF, CORS, protection exception, automation bypass secret or trusted-source configuration changed. Connector access uses the caller's existing Vercel authorization; anonymous browser requests remain protected.
- Backend unauthenticated GET /auth/me with the authorized alias Origin returns 401 JSON and Access-Control-Allow-Origin equal to that alias, demonstrating existing CORS allowance. This is not authenticated Staging integration.

## Hosted browser and real Staging limitations

Fresh isolated Chrome, no credential injection or stored session: 1366x768, 1920x1080, 768x1024 and 390x844 all redirected to the Vercel login origin. A final HTTP 200 there is the login page, not LouvAIO UI success. No legitimate Vercel browser session or synthetic LouvAIO session was available to this runner. No passwords, tokens, cookies or storage state were captured in reports/artifacts. Existing credential/security helper scripts were not executed.

AUTHENTICATION_REAL, CRUD_REAL, PERSISTENCE_REAL, REPERTOIRE_REAL and TENANT_ISOLATION_REAL = BLOCKED. Runtime Firebase project identity is **Unknown / Not yet verified**; requested target remains louvaio-staging/(default), but no authenticated/Firestore operation was attempted. No synthetic records were created remotely, so no remote cleanup occurred.

Hosted authenticated navigation, pending-change protection, PDF rendering/cache and full responsive UI homologation are BLOCKED. Previous local evidence remains: 19 Gate 5 Playwright scenarios passed with real PDF engine and simulated application API, including six-page export/cache/download, and Gate 4 visual comparisons covered four viewports/two themes. These are not promoted to hosted PASS REAL.

## Owner manual continuation and rollback

1. Open only the authorized alias in an already authorized Vercel browser session.
2. Sign in with the authorized synthetic LouvAIO Staging account; verify /auth/me and the test ministry, plus louvaio-staging/(default) runtime provenance through authorized evidence.
3. Complete synthetic CRUD/reload/direct URL/history/discard, repertoire opening, permitted cross-identity isolation and PDF checks from the task. Avoid all real-user data. Remove only records created by that homologation when safe.
4. On a critical frontend failure, restore only the authorized alias to the rollback URL above and verify the mapping. No security relaxation is required or authorized.

Rollback command for the owner if needed:

```powershell
vercel alias set https://praise-app-m7tn-hv99uzd4x-henriquecesarths-projects.vercel.app praise-app-m7tn-git-feat-m20-p-904232-henriquecesarths-projects.vercel.app --scope team_ylfphncn6owT7qNenQR0kyjY
```

No critical frontend failure was observed in the performed artifact/HTTP checks. Per owner instructions, unavailable automated authentication does not trigger security changes or automatic rollback; M20-C14 remains on the authorized alias for manual homologation. READY_FOR_GATE_6 = NO. No production impact or Gate 6 actions.

Evidence: ../evidence/m20-c14-gate5b/build-manifest.json, deployment-receipt.json and hosted-browser-smoke.json. Operational browser probe: .vercel/m20-c14-hosted-smoke.cjs (ignored local helper, no auth state).

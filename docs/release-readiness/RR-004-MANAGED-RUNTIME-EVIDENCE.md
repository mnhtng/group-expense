# Managed runtime role and protected preview — 2026-11-09

**PASS for the explicitly approved isolated feature preview. Production/develop roles are not certified; release NO-GO.** The owner approved the [exact role/preview package](RR-004-ISOLATED-PREVIEW-PLAN.md) for source commit **`3739fc644e7a6e75ebcdc262b75703be571385a2`**, code digest **`03757fecd09d8b7ba5ae50375675234738fd16eb32ee4e7e26ddc5770489c181`**.

## Provider and application proof

| Evidence | Actual result |
|---|---|
| Neon scope | Project `withered-salad-00928018`, recovered child `br-noisy-river-b3ajidmw`, DB `group_expense`, existing compute only |
| New LOGIN | `rr004_app_20261109`, created with provider **read_only** access, then replaced by the reviewed explicit runtime grant matrix |
| Grant package | SHA-256 `4fba2cc4f1c485c80fb97348fa20052d27dd5c5922e099946c47d06d804409cb`; 138 statements in one connector transaction |
| Independent role login | `current_user=session_user`; 53 reviewed table/view profiles match; no admin/membership/owner/DDL/temp/unsafe-function/current-column/future-object authority; all 19 required guards enabled on correct tables |
| Role fingerprint | `026999fd5c3199ec2a2e4700761c5b73d0940527c010aea33efa18de48b330f9` |
| Financial preservation | All **58/58** data/schema digests unchanged after grants and after preview reads; **8/8** independent audits zero using the limited login |
| Vercel preview | `dpl_EqHn5GRrhCK3HfvcSojhkAnYhgJq`, **READY**, Node 22, target preview (provider target null), source SHA exactly `3739fc6…` |
| Protected origin | `https://group-expense-747f48alf-mnhtngs-projects.vercel.app` |
| Live runtime GET | **200**, `ok=true`, matching role/login fingerprints and exact recovered endpoint/database fingerprint; deployment SHA matches candidate |
| Missing/wrong app token | **401 / 401** after Vercel protection authenticates |
| Live status GET | **503**, only `NO_COMPLETED_CRON_RUN`; no artificial healthy record inserted |
| Existing env/protection | **16 existing env metadata entries unchanged**; only four new sensitive preview keys on `feat/settlement-cycles-bilateral`; SSO stays enabled |
| Cost/activation | Neon remains `free_v3`; existing 0.25-CU compute, no upgrade/paid build, no financial flags or Cron invocation |

The approved grants revoke PUBLIC schema CREATE/database TEMPORARY on **this child database only**, replace broad provider current/future grants, and leave the migration owner separate. No migration-owner credential was installed in the preview. The sole application DB secret belongs to the new limited login. The source/develop/production branches were not SQL write targets. This is real provider/login and browser-to-API-to-database evidence, not SET ROLE on an owner session.

## Protected access and source handling

The preview was created with the existing authenticated CLI and explicit project/team/preview selection. No Git push or GitHub Actions was used. A dry-run exposed that CLI default selection included ignored local artifacts; upload was stopped before any transfer and a temporary explicit filter restricted it to **210 approved app/config files**. All uploaded content matched the committed source manifest; `db/README.md` was additionally skipped by the CLI's default documentation exclusion. No env file, receipt, DB dump, browser state, test artifact or local secret was uploaded. The filter was saved privately for review and removed from the working tree afterward.

Protected GETs used a **short-lived development OIDC token** in `x-vercel-trusted-oidc-idp-token`, plus the independently generated `OPS_READ_SECRET` in the application Authorization header. Development env-run confirmed no DB/Cron app secret present. No project-wide bypass, share link, protection exception or SSO change was created. No token was printed. The native CLI env-run dispatch was unsuitable; the same version's official JS implementation successfully ran the OIDC-only child process. The CLI curl path was deliberately not invoked because [current documentation says it may create a project automation bypass](https://vercel.com/docs/cli/curl#how-it-works).

The private connector rejected the initial multi-statement prepared `run_sql` request before applying grants. The same reviewed statement list was then applied atomically with `run_sql_transaction`. No broadening of role permissions or financial fixture mutation was used to make verification pass.

## Evidence and remaining scope

Private mode-0600 receipts, snapshots, audit counts, upload manifests and actual HTTP reports are retained in `rr003-artifacts/2026-11-09-runtime-alerts/`. Original credential values were not decrypted/exported. New preview credentials were relayed only to their approved branch-scoped secret entries; the dedicated read token is retained privately for follow-up operator configuration. The provider role, four env entries and preview remain available for review.

This closes the **isolated deployed runtime authority proof**. It does not certify the unchanged production/develop runtime, per-user RLS, independent human financial/security acceptance, positive managed financial fixtures or full-service disaster recovery. The status endpoint is correctly unhealthy because this recovered branch has never completed Cron. The approval explicitly allowed GET only, so no replay/operational row was generated to change that result.

[Mail-channel acknowledgement and outbox tests](RR-003-ALERT-DELIVERY.md) are complete at their stated scope. Automatic hosted email delivery/scheduling and a controlled live 503 → recovery drill remain pending; [standalone Free email provisioning](RR-003-MAIL-PROVISIONING-PLAN.md) was separately approved and is waiting for provider-required browser terms acceptance. Engine OFF, PR #16 Draft, no staging/production deployment or merge.

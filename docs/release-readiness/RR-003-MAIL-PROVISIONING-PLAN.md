# Next mail action — Resend Free, isolated from application environments

**DEFERRED BY OWNER — 2026-11-09.** The owner explicitly requested skipping the email feature after confirming that only Gmail is available. Stop mail provisioning, account/key setup and drill sends. No domain or account input is requested. The notes below preserve the historical approved attempt; they are not instructions to resume it. Resuming email requires a new owner request.

Resend marketplace installation was verified on Free; no named sender-domain resource or sending credential was created. The owner previously selected email, supplied the private recipient and confirmed the Gmail channel drill. Marketplace discovery returned `resend/resend-email`; live billing metadata reported plan ID **`free`**, cost **0.00**, **no payment method required**, 3,000 emails/month and 100/day. Paid plans are excluded.

Original approved action: create one standalone Resend Free installation/resource named `rr003-ops-mail-20261109` in Vercel team `team_sVKg7rgJ5wX6UEaSTvKKgAk0`. Do **not connect it to the GroupExpense project**, do not pull project envs, do not auto-inject any email key into production/develop/preview, and do not accept a paid plan, preauthorization or upgrade.

The CLI operation was attempted with the current version’s supported non-interactive flag. The first parser attempt using unsupported `--yes` made no request; the actual request returned `action_required / integration_terms_acceptance_required` before resource provisioning. No plan upgrade or project connection occurred. Await the owner’s explicit completion of [Resend terms acceptance](https://vercel.com/mnhtngs-projects/~/integrations/accept-terms/resend?source=cli), then retry exactly the provider-suggested command:

```sh
vercel integration add resend/resend-email \
  --billing-plan free --name rr003-ops-mail-20261109 \
  --no-connect --no-env-pull --no-claim \
  --scope team_sVKg7rgJ5wX6UEaSTvKKgAk0 --non-interactive --json
```

If the provider requires account linking/claiming or sender-domain verification, the owner completes that account step. No domain purchase, DNS mutation or production sender impersonation is included. The default test sender may be used only if the actual provider account permits delivery to the owner-supplied recipient; never bypass sender restrictions.

After provisioning, read only this new resource's sending credential through its supported private channel, implement the email adapter against that real backend, and send bounded OPENED/RECOVERED drill messages only to the approved owner mailbox. Preserve the outbox's event IDs for provider idempotency; HTTP acceptance remains separate from recipient/human confirmation. Source/test evidence must be updated for the adapter. No existing user/financial data is included in mail.

A mail backend alone does not create a reliable monitor host. Persistent scheduling and protected preview machine access still need an approved execution environment; the current one-off OIDC probe and agent-invoked Gmail message are not scheduled production monitoring. Before activating an unattended scheduler, select its host, credential injection, durable state storage and failure notification path explicitly.


## Actual installation and remaining input — 2026-11-09

The owner explicitly authorized **Accept & Install**. On reopening the correct team page, it displayed **Terms Already Accepted**; no additional click/terms acceptance was necessary. CLI inspection confirms marketplace installation **`icfg_J0I3yo7hfcdtAJL3H9okuSz1`**, billing plan **`free`**, cost **`0.00`**, and **zero connected projects**. This resolves the previous terms blocker. No resource was provisioned by accepting terms alone.

The subsequent exact resource request stopped with **Missing required metadata: domain, region**. Product metadata explicitly requires an owned sending domain. The GroupExpense project currently lists only `group-expense.vercel.app`; this is not evidence of DNS ownership needed for mail-domain verification. The approved Gmail address is the recipient, not a sender domain that can be verified for this app. No fake domain, gmail.com claim, domain purchase or DNS write was attempted. Region can be selected from the provider's supported values after the sender domain is known; a resource is still not created.

The installed Free plan is verified independently from the CLI help's paid resource-plan suggestions. No paid plan fallback is allowed; recheck eligibility and stop before any paid selection. GroupExpense still has the same 20 env metadata entries, no Resend key was injected, and no sending credential has been retrieved. The email adapter has not been represented as live or complete without that credential/backend resource. Private installation receipt: `rr003-artifacts/2026-11-09-runtime-alerts/resend-installation-receipt.json`.

## Owner decision superseding the pending action

The owner confirmed Gmail-only availability and subsequently said to skip the email feature. Official [Resend test-domain guidance](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) permits owner-inbox test sends without a custom domain, but that path was not activated. A read-only browser visit reached the Resend login page; no login, key creation or mail send followed. A private CLI SSO-link receipt is excluded from Git and must not be published.

Retain the existing Free installation `icfg_J0I3yo7hfcdtAJL3H9okuSz1` with zero connected projects; no removal or billing change was requested. No Resend key was retrieved or injected into application environments. No further email setup is pending from the owner. The generic HTTPS monitor/outbox remains available, while hosted scheduling, external fault/recovery delivery and service RPO/RTO verification remain unresolved. Deferring email does not mark RR-003 PASS or waive its release gate.

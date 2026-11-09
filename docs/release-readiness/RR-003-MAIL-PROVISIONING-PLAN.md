# Next mail action — Resend Free, isolated from application environments

**Owner approved the exact Free scope; provisioning is waiting for provider-required browser terms acceptance.** The owner selected email, supplied the private recipient and confirmed the Gmail channel drill. Marketplace discovery returned `resend/resend-email`; live billing metadata reports plan ID **`free`**, cost **0.00**, **no payment method required**, 3,000 emails/month and 100/day. Paid plans are excluded.

Proposed action: create one standalone Resend Free installation/resource named `rr003-ops-mail-20261109` in Vercel team `team_sVKg7rgJ5wX6UEaSTvKKgAk0`. Do **not connect it to the GroupExpense project**, do not pull project envs, do not auto-inject any email key into production/develop/preview, and do not accept a paid plan, preauthorization or upgrade.

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

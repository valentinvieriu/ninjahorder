# NinjaHorder Agent Guide

## App Overview

NinjaHorder is a Nuxt 3 domain availability checker. Users enter a second-level domain label, choose TLD groups, and the app checks each fully-qualified domain in a Web Worker using DNS over HTTPS providers.

The app intentionally avoids registrar/WHOIS lookups in the normal flow. Results are inferred from recursive DNS responses, so `available` means "DNS strongly suggests availability" rather than a registry-authoritative answer.

## Key Files

- `pages/index.vue`: main UI orchestration, progress display, cancellation, grouped results.
- `components/DomainForm.vue`: domain label validation and TLD group selection.
- `components/DomainResult.vue`: status badges, parking indicators, confidence reason tooltip.
- `composables/useDomainCheck.ts`: Vue state, worker lifecycle, cache, cancellation, grouped results.
- `composables/domainCheck.worker.ts`: batch processing, concurrency limiting, per-domain worker progress.
- `composables/domain/checker.ts`: core per-domain availability procedure.
- `composables/domain/dns.ts`: DoH querying, retries, error classification, wildcard DNS helper.
- `composables/domain/analysis/interpretation.ts`: scoring and final status selection.
- `composables/domain/analysis/parking.ts`: parking/premium TXT and nameserver heuristics.
- `utils/DohResolver.ts`: low-level DoH resolver wrapper.
- `config/appConfig.ts`: provider URLs, timeout/retry settings, known wildcard TLDs.
- `utils/tlds.ts`: TLD groups and registrar-link support list.

## Current Availability Procedure

1. The UI expands a base label plus selected TLDs into full domains.
2. `useDomainCheck` starts `domainCheck.worker.ts` and receives incremental progress/results.
3. The worker checks domains concurrently with a small limiter.
4. Each domain is checked by `checkDomainAvailability`.
5. The checker runs a random-subdomain wildcard DNS test.
6. It queries all configured DoH providers for NS/TXT signals, with SOA focused on the current primary provider.
7. `interpretCombinedResults` groups sub-signals by resolver so each provider gets one vote; repeated query types from one resolver are not treated as independent consensus.
8. Domains that initially look available are put into `pending_confirmation`.
9. A stricter multi-provider SOA confirmation query upgrades them to `available` only after independent NXDOMAIN confirmations and no exact existence signals; otherwise they become `indeterminate`.

Important limitation: recursive DNS cannot prove registry availability. NXDOMAIN is a strong signal, but registrar/reservation, premium, blocked, reserved, wildcarded, DNSSEC-broken, and registry-policy cases need authoritative RDAP/EPP/WHOIS or registrar checks for high precision.

## Development Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview Cloudflare target: `npm run preview`
- Deploy: `npm run deploy`
- Cloudflare types: `npm run cf-typegen`

## Working Conventions

- Preserve user changes in the worktree. Do not revert unrelated edits.
- Keep domain classification conservative: prefer `indeterminate` over false `available`.
- Avoid direct registrar lookups unless the feature explicitly calls for an authoritative confirmation mode.
- When changing availability logic, add or update focused tests around DNS response interpretation if test infrastructure exists or is introduced.
- Keep provider-specific behavior centralized in `config/appConfig.ts` or `composables/domain/dns.ts`.

# Authorized Browsing and WAF-Safe Audit Policy

Use this policy for live-site audits where CDN, WAF, bot protection, rate limiting, authentication, or production stability matters.

## Allowed

- Audit only targets that the user owns, operates, or is authorized to test.
- Prefer staging, QA, allowlisted production test profiles, or documented read-only production windows.
- Use one browser context and low concurrency by default.
- Pace navigation and interactions with explicit delays and request budgets.
- Respect scope: same origin, configured path prefixes, page limits, and user-provided URL lists.
- Stop or mark blocked when a CAPTCHA, login wall, WAF block page, or rate-limit page appears.
- Report blocked states as audit limitations, not accessibility defects.
- Ask for an allowlisted test route, credentials, or staging URL when production protection prevents evidence collection.
- Keep user actions safe: navigation, focus, typing harmless test values, opening disclosures, and closing dialogs.

## Not Allowed

- Do not bypass CAPTCHA.
- Do not evade WAF, bot detection, or access controls.
- Do not mask `navigator.webdriver` or use stealth plugins in public plugin defaults.
- Do not rotate IPs, proxies, fingerprints, user agents, cookies, or browser identities to avoid detection.
- Do not brute-force, credential-stuff, submit purchases, create accounts, alter real user data, or trigger destructive flows.
- Do not present WAF-blocked automation results as proof that the page itself is inaccessible to users.

## Recommended Runtime Defaults

- `maxConcurrency`: 1
- `maxRequestsPerMinute`: 20 or lower unless the site owner authorizes more
- `pacingMs`: 1200-3000
- `sameOriginOnly`: true
- `stopOnBlockPage`: true
- `headless`: allowed for staging or non-protected targets; use headed mode when visual/manual evidence is needed

## Reporting Requirements

Every live-site report should state:

- authorization assumption
- target scope
- page/depth limits
- pacing and concurrency settings
- whether any WAF, CAPTCHA, login, or rate-limit page was encountered
- what evidence was collected and what remains unverified

## Human-Like Does Not Mean Evasion

For this skill, "human-like" means methodologically realistic:

- task-based navigation
- reasonable pauses
- visible browser interaction when needed
- keyboard and screen-reader routes
- form/error exploration with harmless values
- stopping at access-control boundaries

It does not mean hiding automation, bypassing protections, or defeating security controls.

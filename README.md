# AccessiMind Codex Plugin Marketplace

Public Codex marketplace package for the AccessiMind Accessible UI Agent plugin.

AccessiMind is a general-purpose, agentic WCAG audit and accessibility implementation tool for Codex. It is not tied to any single brand, domain, or project. The plugin helps Codex plan, execute, and report accessibility work with evidence from browser automation, keyboard traversal, visual measurements, and real screen-reader runs when available.

## What It Does

- Runs agentic WCAG 2.2 A/AA audits from a seed URL.
- Creates WCAG-EM inspired audit plans with scope, representative page types, user flows, evidence tracks, and safe browsing defaults.
- Crawls same-origin pages with configurable page and depth limits.
- Collects axe-core, DOM, keyboard, focus, contrast, target-size, mobile reflow, and screenshot evidence.
- Runs non-destructive task-based browsing flows for orientation, navigation, search/filter, form/error, and dynamic-content checks.
- Captures accessible name/role/state/relationship diffs before and after control activation.
- Captures real NVDA screen-reader output on Windows when the runtime is available.
- Combines scan, task, state, visual, motor, and screen-reader artifacts into replayable evidence bundles.
- Generates detailed, stakeholder-ready HTML reports from a reusable report template contract.
- Produces Jira-ready remediation tasks, acceptance criteria, and regression packs.
- Supports accessibility implementation and review for React, HTML, CSS, JavaScript, Codex plugin UI, and live web pages.
- Uses an authorized, low-impact browsing policy for protected production targets; it reports WAF, CAPTCHA, login, and rate-limit blocks as limitations instead of attempting bypass.

## Install

Add this marketplace repository to Codex:

```bash
codex plugin marketplace add sarperarikan/accessimind-codex--wcag-analysiss-plugIn
```

Then in the Codex app:

1. Open `Plugins`.
2. Select the `AccessiMind Public` marketplace.
3. Open the `AccessiMind Accessible UI Agent` plugin card.
4. Install the plugin.
5. Start a new Codex thread or restart Codex if the skill does not appear immediately.

## Invoke

```text
$accessimind
```

## Example Prompts

General live-site audit:

```text
$accessimind audit https://example.com for WCAG 2.2 AA. Crawl 10 same-origin pages, collect keyboard, visual, and screen-reader evidence, then generate an HTML report.
```

Agentic screen-reader task:

```text
$accessimind use NVDA like a screen-reader user to find the main navigation, open a menu, identify available categories, and report spoken output with DOM targets.
```

Component review:

```text
$accessimind review this modal component for keyboard trap, focus return, accessible name, live-region behavior, contrast, and reduced-motion risks.
```

Implementation:

```text
$accessimind make this React component WCAG 2.2 compliant and include verification steps for keyboard, screen reader, zoom, contrast, and target size.
```

Jira-ready remediation:

```text
$accessimind convert these accessibility findings into Jira-ready Summary, Description, Acceptance Criteria, Tasks, and regression checks.
```

## Bundled Agentic Audit Scripts

These scripts are generic helpers used by the skill when a runtime audit is appropriate:

- `scripts/create_audit_plan.mjs`: WCAG-EM inspired scope, page/user-flow, evidence-track, and safe browsing plan builder.
- `scripts/agentic_wcag_audit.mjs`: seed URL crawl and browser-backed WCAG evidence collection.
- `scripts/agentic_task_runner.mjs`: non-destructive task-based browsing evidence for realistic expert workflows.
- `scripts/state_diff_audit.mjs`: before/after accessible state and controlled-content diff checks.
- `scripts/evidence_bundle_builder.mjs`: replayable evidence package builder from audit, NVDA, task, and state artifacts.
- `scripts/build_accessibility_report.mjs`: generic HTML report builder from audit JSON and optional NVDA JSON.
- `scripts/nvda_web_audit.mjs`: real NVDA traversal and natural navigation evidence.
- `scripts/low_vision_web_audit.mjs`: zoom, reflow, contrast, text spacing, focus, and forced-colors evidence.
- `scripts/motor_web_audit.mjs`: keyboard, target-size, pointer actionability, and motor-access evidence.

Recommended generic sequence:

1. Create `audit-plan.json`.
2. Run the browser-backed WCAG crawl with the plan.
3. Add task-runner and state-diff artifacts.
4. Add NVDA, low-vision, and motor-access artifacts when available.
5. Build `evidence-bundle.json`.
6. Generate the HTML report.

## Authorized Browsing Policy

Protected live targets must be tested only with authorization. The plugin defaults to same-origin scope, low concurrency, pacing, and stop-on-block behavior. It does not include WAF evasion, CAPTCHA bypass, stealth plugins, proxy rotation, browser fingerprint rotation, destructive form submission, account creation, purchasing, or credential attacks.

The detailed policy is bundled at:

```text
plugins/accessimind-accessible-ui-agent/skills/accessimind/references/authorized-browsing-policy.md
```

## Report Template

The default report contract is bundled at:

```text
plugins/accessimind-accessible-ui-agent/skills/accessimind/templates/default-html-audit-report.md
```

Reports should include scope, methodology, evidence package, inspected surfaces, deduplicated findings, atomic screen-reader rows, visual measurements, motor/keyboard evidence, Jira-ready work, remediation roadmap, regression pack, gates, standards, and limitations.

## Notes

- Real NVDA evidence requires Windows, NVDA, and the Guidepup runtime.
- If screen-reader automation cannot run, the skill reports it as `blocked` or `unverified`.
- DOM-only findings are not presented as real screen-reader evidence.
- WAF, CAPTCHA, login, and rate-limit blocks are reported as audit limitations, not as user accessibility defects.
- Generated HTML reports must themselves be accessible and UTF-8 encoded.

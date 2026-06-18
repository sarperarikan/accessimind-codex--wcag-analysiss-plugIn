# Default HTML Audit Report Template Contract

Use this template contract whenever AccessiMind produces a stakeholder-ready HTML accessibility report.

The generated report must be a self-contained UTF-8 HTML file with semantic sections, a real table of contents, evidence-backed findings, and deterministic remediation work. Do not stop at an executive summary when raw audit data exists.

## Required Sections

1. Report header
   - Title
   - Target URL or surface
   - Date and run id
   - Scope
   - Decision: `PASS`, `PASS_WITH_RISK`, `FAIL`, or `BLOCKED`
   - Artifact paths

2. Table of contents
   - Same-page links to every major section
   - Stable section ids

3. Executive summary
   - Overall release decision
   - Top user-impact risks
   - What evidence supports the decision

4. Scope and methodology
   - Tested pages or components
   - Browser/channel, viewport, locale, user agent if available
   - Automated checks
   - Keyboard checks
   - Screen-reader checks
   - Visual measurements
   - Known limitations

5. Evidence package
   - Raw JSON paths
   - Screenshot paths
   - Screen-reader artifact paths
   - Render verification paths
   - Tool status and blocked checks

6. Inspected surface inventory
   - Page URL
   - HTTP status
   - Page title
   - Screenshot
   - axe violation count
   - keyboard step count and unique focus targets
   - contrast sample count
   - target-size sample count
   - mobile reflow status

7. Deduplicated finding matrix
   - Finding id
   - Severity
   - Shared component or route-specific label
   - Affected surfaces
   - WCAG 2.2 references
   - Evidence id/path
   - Confidence
   - Owner recommendation

8. Detailed finding blocks
   Each finding must include:
   - Title and severity
   - Affected surface/component
   - Evidence id, selector, DOM snippet, or spoken phrase
   - Reproduction steps
   - Observed behavior
   - Expected behavior
   - User impact for screen-reader, low-vision, keyboard, motor, and cognitive load where relevant
   - WCAG 2.2 criteria
   - Remediation direction
   - Acceptance criteria
   - Confidence

9. Live screen-reader evidence
   - Runtime status: detected, started, stopped
   - Step count
   - Accepted speech count
   - Filtered-noise count
   - Coverage summary
   - Atomic issue table:
     - step id
     - spoken phrase or explicit no speech
     - DOM target
     - expected behavior
     - observed mismatch
     - impact
     - WCAG reference
     - remediation
     - confidence

10. Low-vision and visual measurements
   - Contrast measurement rows
   - Focus visibility rows
   - Zoom/reflow rows
   - Text spacing or overflow notes
   - Screenshot references

11. Motor and keyboard evidence
   - Tab traversal summary
   - Focus order risks
   - Target-size rows
   - Pointer/touch activation risks

12. Jira-ready production work
   Each major fix group must include visible:
   - Summary
   - Description
   - Priority
   - Acceptance Criteria
   - Tasks / Yapilacaklar

13. Remediation roadmap
   - Shared shell fixes
   - Component fixes
   - Token/design-system fixes
   - Page-specific fixes
   - Verification order

14. Regression pack
   - Keyboard-only checks
   - Screen-reader checks
   - Zoom/reflow checks
   - Contrast checks
   - Target-size checks
   - Negative checks for adjacent flows

15. Standards and references
   - WCAG 2.2
   - WAI-ARIA APG when custom widgets are involved
   - axe-core notes when automated checks are used

16. Limitations and out-of-scope
   - Blocked pages
   - Authentication/payment areas not tested
   - Anti-bot or network issues
   - Any AT capture limits

## HTML Quality Requirements

- Use semantic landmarks: `header`, `main`, `section`, `article`, `footer`.
- Use a single `h1`; keep heading order logical.
- Use tables only for tabular evidence.
- Include `caption` or nearby headings for evidence tables.
- Preserve Turkish and non-ASCII characters as UTF-8.
- Keep all core content readable without JavaScript.
- Include visible focus styles in report CSS.
- Avoid color-only severity communication; include text labels.
- Do not hide major evidence in collapsed-only UI.

## Minimum Detail Gate

A report is too shallow if it lacks any of these when raw data exists:

- Per-page inventory table
- Deduplicated finding matrix
- Detailed finding blocks with acceptance criteria
- Atomic screen-reader evidence table
- Visual measurement table
- Jira-ready work section
- Regression pack
- Limitations section

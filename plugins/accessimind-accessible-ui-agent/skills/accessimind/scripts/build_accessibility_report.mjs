#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const auditPath = path.resolve(requiredArg(args, "audit"));
const nvdaPath = args.nvda ? path.resolve(args.nvda) : null;
const outPath = path.resolve(args.out || path.join(path.dirname(auditPath), `${slugFromAudit(auditPath)}-accessibility-report.html`));
const data = JSON.parse(fs.readFileSync(auditPath, "utf8"));
const nvda = nvdaPath && fs.existsSync(nvdaPath) ? JSON.parse(fs.readFileSync(nvdaPath, "utf8")) : null;
const outDir = path.dirname(outPath);

fs.mkdirSync(outDir, { recursive: true });

const pages = data.pages || [];
const successfulPages = pages.filter((page) => page.status >= 200 && page.status < 300 && !page.blocked && !page.error);
const axeCounts = countAxeIds(successfulPages);
const findings = buildFindings(successfulPages, axeCounts, nvda);
const decision = findings.some((finding) => finding.severity === "Critical" || finding.severity === "High") ? "FAIL" : findings.length ? "PASS_WITH_RISK" : "PASS";
const nvdaSpeech = nvda?.acceptedSpeech || [];
const toc = [
  ["decision", "Decision"],
  ["toc", "Table of contents"],
  ["methodology", "Scope and methodology"],
  ["evidence", "Evidence package"],
  ["pages", "Inspected surfaces"],
  ["axe", "Automated rule distribution"],
  ["matrix", "Finding matrix"],
  ["findings", "Detailed findings"],
  ["screen-reader", "Live screen-reader evidence"],
  ["visual", "Visual measurements"],
  ["keyboard", "Keyboard and motor evidence"],
  ["jira", "Jira-ready work"],
  ["regression", "Regression pack"],
  ["gates", "Release gates"],
  ["limitations", "Standards and limitations"],
];

const html = `<!doctype html>
<html lang="${escapeAttr(args.lang || "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.seedUrl || "Accessibility audit")} - WCAG 2.2 Report</title>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.5; margin: 0; color: #17202a; background: #fff; }
    header, main, footer { max-width: 1180px; margin: 0 auto; padding: 24px; }
    header { border-bottom: 4px solid #1d4ed8; }
    h1 { font-size: 30px; margin: 0 0 8px; }
    h2 { font-size: 22px; margin-top: 32px; border-bottom: 1px solid #d7dde4; padding-bottom: 6px; }
    h3 { font-size: 18px; margin: 20px 0 8px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; font-size: 14px; }
    th, td { border: 1px solid #d7dde4; padding: 8px; vertical-align: top; }
    th { background: #f3f5f7; text-align: left; }
    code { background: #f3f5f7; padding: 1px 4px; border-radius: 3px; }
    a:focus, button:focus { outline: 3px solid #111827; outline-offset: 2px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-weight: 700; font-size: 12px; }
    .Critical, .High, .FAIL { background: #b91c1c; color: white; }
    .Medium, .PASS_WITH_RISK { background: #92400e; color: white; }
    .Low, .PASS { background: #166534; color: white; }
    .panel { border-left: 6px solid #1d4ed8; background: #eff6ff; padding: 12px 16px; }
    .fail { border-left-color: #b91c1c; background: #fff5f5; }
    .finding { border: 1px solid #d7dde4; border-left: 6px solid #92400e; padding: 14px 16px; margin: 14px 0; }
    .finding.Critical, .finding.High { border-left-color: #b91c1c; }
    .meta { color: #52606d; }
  </style>
</head>
<body>
<header>
  <h1>WCAG 2.2 Accessibility Audit Report</h1>
  <p class="meta">Target: ${escapeHtml(data.seedUrl || data.scope?.base || "Unknown target")}</p>
  <p class="meta">Run id: ${escapeHtml(data.runId || "")} | ${escapeHtml(data.startedAt || "")} - ${escapeHtml(data.finishedAt || "")}</p>
  <p class="meta">Raw audit: <code>${escapeHtml(auditPath)}</code>${nvdaPath ? ` | Screen-reader artifact: <code>${escapeHtml(nvdaPath)}</code>` : ""}</p>
</header>
<main>
  <section id="decision" class="panel ${decision === "FAIL" ? "fail" : ""}">
    <h2>Decision: <span class="badge ${escapeAttr(decision)}">${escapeHtml(decision)}</span></h2>
    <p>${escapeHtml(decisionSummary(decision, findings, successfulPages.length, pages.length))}</p>
  </section>

  <nav id="toc" aria-label="Table of contents">
    <h2>Table of contents</h2>
    <ol>${toc.map(([id, label]) => `<li><a href="#${escapeAttr(id)}">${escapeHtml(label)}</a></li>`).join("")}</ol>
  </nav>

  <section id="methodology">
    <h2>Scope and methodology</h2>
    <table><tbody>
      <tr><th>Seed URL</th><td>${escapeHtml(data.seedUrl || "")}</td></tr>
      <tr><th>Page count</th><td>${pages.length} selected, ${successfulPages.length} successful HTTP 2xx pages</td></tr>
      <tr><th>Browser</th><td>${escapeHtml(data.options?.browserChannel || "browser not recorded")}, locale ${escapeHtml(data.options?.locale || "not recorded")}</td></tr>
      <tr><th>Evidence methods</th><td>axe-core, DOM inventory, keyboard traversal, contrast sampling, target-size sampling, mobile reflow screenshots${nvda ? ", live screen-reader evidence" : ""}</td></tr>
      <tr><th>Limitations</th><td>${escapeHtml([...(data.limitations || []), ...pages.flatMap((page) => page.limitations || [])].join(" | ") || "No run-level limitation recorded.")}</td></tr>
    </tbody></table>
  </section>

  <section id="evidence">
    <h2>Evidence package</h2>
    <table><thead><tr><th>Artifact</th><th>Path/status</th><th>Purpose</th></tr></thead><tbody>
      <tr><td>Audit JSON</td><td><code>${escapeHtml(auditPath)}</code></td><td>Page inventory, axe, keyboard, contrast, target-size, and reflow evidence.</td></tr>
      <tr><td>Screen-reader JSON</td><td>${nvdaPath ? `<code>${escapeHtml(nvdaPath)}</code>` : "Not provided"}</td><td>Live AT speech, foreground, and route coverage when available.</td></tr>
      <tr><td>Screenshots</td><td><code>${escapeHtml(path.dirname(auditPath))}</code></td><td>Desktop and mobile visual evidence created by the audit run.</td></tr>
    </tbody></table>
  </section>

  <section id="pages">
    <h2>Inspected surfaces</h2>
    <table><thead><tr><th>#</th><th>Kind</th><th>URL</th><th>Status</th><th>Title</th><th>axe</th><th>Keyboard</th><th>Contrast</th><th>Target size</th><th>Mobile</th><th>Screenshot</th></tr></thead>
    <tbody>${pages.map((page, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(page.kind || "")}</td><td><a href="${escapeAttr(page.url)}">${escapeHtml(page.url)}</a></td><td>${escapeHtml(page.status)}</td><td>${escapeHtml(page.title || "")}</td><td>${page.axe?.violations?.length || 0}</td><td>${page.keyboard ? `${page.keyboard.uniqueTargets}/${page.keyboard.stepCount}` : "not run"}</td><td>${page.contrast?.length ?? "not run"}</td><td>${page.targetSize?.length ?? "not run"}</td><td>${page.mobile?.horizontalOverflow?.overflow ? "overflow" : "ok/unknown"}</td><td>${escapeHtml(page.screenshot ? path.basename(page.screenshot) : "")}</td></tr>`).join("")}</tbody></table>
  </section>

  <section id="axe">
    <h2>Automated rule distribution</h2>
    <table><thead><tr><th>Rule</th><th>Successful page count</th></tr></thead><tbody>
      ${Object.entries(axeCounts).sort((a, b) => b[1] - a[1]).map(([id, count]) => `<tr><td><code>${escapeHtml(id)}</code></td><td>${count}</td></tr>`).join("")}
    </tbody></table>
  </section>

  <section id="matrix">
    <h2>Finding matrix</h2>
    <table><thead><tr><th>ID</th><th>Severity</th><th>Title</th><th>Affected</th><th>WCAG</th><th>Confidence</th></tr></thead><tbody>
      ${findings.map((finding) => `<tr><td>${escapeHtml(finding.id)}</td><td>${escapeHtml(finding.severity)}</td><td>${escapeHtml(finding.title)}</td><td>${escapeHtml(finding.surfaces)}</td><td>${escapeHtml(finding.wcag)}</td><td>${escapeHtml(finding.confidence)}</td></tr>`).join("")}
    </tbody></table>
  </section>

  <section id="findings">
    <h2>Detailed findings</h2>
    ${findings.map((finding) => `<article class="finding ${escapeAttr(finding.severity)}">
      <h3>${escapeHtml(finding.id)} - <span class="badge ${escapeAttr(finding.severity)}">${escapeHtml(finding.severity)}</span> ${escapeHtml(finding.title)}</h3>
      <p><strong>Affected surface:</strong> ${escapeHtml(finding.surfaces)}</p>
      <p><strong>Evidence:</strong> ${escapeHtml(finding.evidence)}</p>
      <p><strong>Steps to reproduce:</strong> ${escapeHtml(finding.steps)}</p>
      <p><strong>Observed:</strong> ${escapeHtml(finding.observed)}</p>
      <p><strong>Expected:</strong> ${escapeHtml(finding.expected)}</p>
      <p><strong>User impact:</strong> ${escapeHtml(finding.impact)}</p>
      <p><strong>WCAG 2.2:</strong> ${escapeHtml(finding.wcag)}</p>
      <p><strong>Remediation:</strong> ${escapeHtml(finding.fix)}</p>
      <p><strong>Acceptance criteria:</strong> ${escapeHtml(finding.acceptance)}</p>
      <p><strong>Confidence:</strong> ${escapeHtml(finding.confidence)}</p>
    </article>`).join("") || "<p>No confirmed defects were derived from the current data.</p>"}
  </section>

  <section id="screen-reader">
    <h2>Live screen-reader evidence</h2>
    <table><tbody>
      <tr><th>Detected</th><td>${escapeHtml(nvda?.nvda?.detected ?? "not provided")}</td></tr>
      <tr><th>Started/stopped</th><td>${escapeHtml(`${nvda?.nvda?.started ?? "n/a"} / ${nvda?.nvda?.stopped ?? "n/a"}`)}</td></tr>
      <tr><th>Step count</th><td>${nvda?.steps?.length ?? "not provided"}</td></tr>
      <tr><th>Accepted speech</th><td>${nvdaSpeech.length}</td></tr>
      <tr><th>Filtered noise</th><td>${nvda?.filteredNoise?.length ?? "not provided"}</td></tr>
    </tbody></table>
    <table><thead><tr><th>Step</th><th>Phrase</th><th>Foreground accepted</th><th>DOM target</th></tr></thead><tbody>
      ${(nvda?.steps || []).slice(0, 40).map((step) => `<tr><td>${escapeHtml(step.action)}</td><td>${escapeHtml((step.acceptedSpeech || []).map((entry) => entry.phrase).join(" | ") || "no accepted speech")}</td><td>${escapeHtml(step.foregroundAccepted)}</td><td>${escapeHtml(describeActive(step))}</td></tr>`).join("")}
    </tbody></table>
  </section>

  <section id="visual">
    <h2>Visual measurements</h2>
    <table><thead><tr><th>Type</th><th>Page</th><th>Element</th><th>Observed</th><th>Expected</th></tr></thead><tbody>
      ${visualRows(successfulPages).map((row) => `<tr><td>${escapeHtml(row.type)}</td><td><a href="${escapeAttr(row.page)}">${escapeHtml(row.page)}</a></td><td>${escapeHtml(row.element)}</td><td>${escapeHtml(row.observed)}</td><td>${escapeHtml(row.expected)}</td></tr>`).join("")}
    </tbody></table>
  </section>

  <section id="keyboard">
    <h2>Keyboard and motor evidence</h2>
    <table><thead><tr><th>Page</th><th>Tab steps</th><th>Unique focus targets</th><th>Body focus</th><th>Trap signal</th><th>Small targets</th></tr></thead><tbody>
      ${successfulPages.map((page) => `<tr><td><a href="${escapeAttr(page.url)}">${escapeHtml(page.url)}</a></td><td>${page.keyboard?.stepCount || 0}</td><td>${page.keyboard?.uniqueTargets || 0}</td><td>${page.keyboard?.bodyFocusCount || 0}</td><td>${page.keyboard?.possibleTrap ? "possible trap" : "no trap observed"}</td><td>${page.targetSize?.length || 0}</td></tr>`).join("")}
    </tbody></table>
  </section>

  <section id="jira">
    <h2>Jira-ready work</h2>
    ${findings.slice(0, 8).map((finding) => `<article class="finding">
      <h3>${escapeHtml(finding.id)} production task</h3>
      <p><strong>Summary:</strong> ${escapeHtml(finding.title)}</p>
      <p><strong>Description:</strong> ${escapeHtml(finding.impact)} Evidence: ${escapeHtml(finding.evidence)}</p>
      <p><strong>Priority:</strong> ${escapeHtml(priorityFor(finding.severity))}</p>
      <p><strong>Acceptance Criteria:</strong> ${escapeHtml(finding.acceptance)}</p>
      <p><strong>Tasks / Yapilacaklar:</strong> ${escapeHtml(finding.fix)}</p>
    </article>`).join("")}
  </section>

  <section id="regression">
    <h2>Regression pack</h2>
    <table><thead><tr><th>Track</th><th>Step</th><th>Expected result</th></tr></thead><tbody>
      <tr><td>Keyboard</td><td>Run Tab and Shift+Tab through header, main content, forms, dialogs, and footer.</td><td>Focus is visible, ordered, not trapped, and not hidden.</td></tr>
      <tr><td>Screen reader</td><td>Run headings, landmarks, links, buttons, forms, and table routes where applicable.</td><td>Names, roles, states, and relationships match visible intent.</td></tr>
      <tr><td>Zoom/reflow</td><td>Test 320px, 200%, and 400% equivalent layouts.</td><td>No content loss, overlap, or required two-dimensional scrolling for linear content.</td></tr>
      <tr><td>Contrast</td><td>Re-run contrast sampling and manual token checks.</td><td>Text and controls meet WCAG thresholds.</td></tr>
      <tr><td>Motor</td><td>Measure dense controls, carousel dots, icon buttons, close buttons, and form controls.</td><td>Targets meet minimum size or valid exceptions.</td></tr>
    </tbody></table>
  </section>

  <section id="gates">
    <h2>Release gates</h2>
    <table><thead><tr><th>Gate</th><th>Status</th><th>Notes</th></tr></thead><tbody>
      <tr><td>G1 Coverage</td><td>${pages.length ? "PASS_WITH_RISK" : "FAIL"}</td><td>Selected pages and limitations are listed.</td></tr>
      <tr><td>G2 Keyboard</td><td>${findings.some((f) => /Keyboard|Target|focus/i.test(f.title)) ? "FAIL" : "PASS_WITH_RISK"}</td><td>Keyboard and target-size evidence reviewed.</td></tr>
      <tr><td>G3 Semantics</td><td>${findings.some((f) => /ARIA|landmark|name|role|heading|list/i.test(f.title)) ? "FAIL" : "PASS_WITH_RISK"}</td><td>Name, role, value and structure issues reviewed.</td></tr>
      <tr><td>G4 WCAG</td><td>${decision === "FAIL" ? "FAIL" : "PASS_WITH_RISK"}</td><td>Critical/high findings determine release risk.</td></tr>
      <tr><td>G5 Evidence</td><td>PASS_WITH_RISK</td><td>Evidence is artifact-backed; manual business-flow coverage may still be needed.</td></tr>
      <tr><td>G6 AT + visual</td><td>${nvda ? "PASS_WITH_RISK" : "FAIL"}</td><td>${nvda ? "Live AT artifact provided." : "No live AT artifact provided."} Visual measurements included.</td></tr>
    </tbody></table>
  </section>

  <section id="limitations">
    <h2>Standards and limitations</h2>
    <p>Standards lens: WCAG 2.2 A/AA, WAI-ARIA APG for custom widgets, and axe-core automated checks. Automated tools do not prove full conformance; runtime keyboard, screen-reader, and visual checks are required for sign-off.</p>
    <p>Out of scope unless explicitly tested: authenticated flows, checkout/payment, destructive submissions, personalized content, long-duration screen-reader sessions, and native mobile app behavior.</p>
  </section>
</main>
<footer>
  <p class="meta">Generated by AccessiMind Accessible UI Agent template contract.</p>
</footer>
</body>
</html>`;

fs.writeFileSync(outPath, html, "utf8");
console.log(outPath);

function buildFindings(pagesValue, counts, nvdaValue) {
  const built = [];
  const pageTotal = pagesValue.length || 1;
  addIf(counts["aria-required-parent"], "Critical", "Invalid ARIA parent/child relationships are present", "1.3.1; 4.1.2", "Repair custom widget roles or remove invalid ARIA roles.");
  addIf(counts["aria-hidden-focus"], "High", "Focusable content exists inside aria-hidden content", "2.1.1; 2.4.3; 4.1.2", "Remove hidden descendants from tab order with inert or tabindex management.");
  addIf(counts["landmark-one-main"], "High", "Pages lack a main landmark", "1.3.1; 2.4.1", "Add exactly one main landmark and a working skip target.");
  addIf(counts["meta-viewport"], "High", "Viewport disables or restricts zoom", "1.4.4; 1.4.10", "Remove user-scalable=no and restrictive maximum-scale values.");
  addIf(counts["link-name"], "High", "Links lack discernible names", "2.4.4; 4.1.2", "Provide visible or programmatic link names that identify destination.");
  addIf(counts["image-alt"], "High", "Images lack appropriate text alternatives", "1.1.1", "Add alt text for informative images and hide decorative images.");
  addIf(counts["color-contrast"], "High", "Text contrast failures were detected", "1.4.3", "Adjust shared color tokens and verify contrast in browser.");
  addIf(counts["target-size"], "High", "Interactive target size failures were detected", "2.5.8", "Increase hit areas or document valid exceptions.");
  addIf(counts["list"], "Medium", "List structure is invalid", "1.3.1", "Ensure ul/ol children are li, script, or template only.");
  addIf(counts["landmark-unique"], "Medium", "Repeated landmarks are not uniquely named", "1.3.1; 2.4.6", "Give repeated navigation/region landmarks distinct accessible names.");
  addIf(counts["page-has-heading-one"], "Medium", "Pages lack a level-one heading", "1.3.1; 2.4.6", "Add one meaningful h1 per page.");

  const contrastPages = pagesValue.filter((page) => (page.contrast?.length || 0) > 0).length;
  if (contrastPages && !counts["color-contrast"]) {
    built.push(finding("F-VIS-01", "High", "Sampled text contrast failures exist", `${contrastPages}/${pageTotal} pages`, "1.4.3", "Contrast sampler found low-ratio text examples.", "Review raw contrast rows in audit JSON.", "Text should meet WCAG contrast thresholds.", "Low-vision users may miss content.", "Adjust color tokens and verify with real browser measurements."));
  }

  const smallTargetPages = pagesValue.filter((page) => (page.targetSize?.length || 0) > 0).length;
  if (smallTargetPages && !counts["target-size"]) {
    built.push(finding("F-MOT-01", "High", "Small interactive targets exist in sampled pages", `${smallTargetPages}/${pageTotal} pages`, "2.5.8", "Target-size sampler found controls below 24px.", "Review targetSize rows in audit JSON.", "Targets should meet minimum size or valid spacing exception.", "Motor-limited and touch users may accidentally activate adjacent controls.", "Increase hit areas or spacing."));
  }

  if (nvdaValue?.acceptedSpeech?.some((entry) => /graphic|￼|link, [a-z]$/i.test(entry.phrase))) {
    built.push(finding("F-SR-01", "High", "Screen-reader speech includes unnamed or weakly named graphic/link controls", "Screen-reader audited page", "1.1.1; 2.4.4; 4.1.2", "Accepted NVDA speech contains weak graphic/link output.", "Review NVDA acceptedSpeech rows.", "Controls should announce complete names and destinations.", "Blind and voice-input users cannot identify controls reliably.", "Name functional graphics and hide decorative icons."));
  }

  return built;

  function addIf(count, severity, title, wcag, fix) {
    if (!count) return;
    built.push(finding(
      `F-${String(built.length + 1).padStart(2, "0")}`,
      severity,
      title,
      `${count}/${pageTotal} successful pages`,
      wcag,
      `axe rule occurrence across ${count} pages.`,
      "Open affected page, run the audit, inspect the rule target in audit-data.json.",
      "The rule should no longer fail and runtime behavior should match visible intent.",
      impactFor(title),
      fix,
    ));
  }
}

function finding(id, severity, title, surfaces, wcag, evidence, steps, expected, impact, fix) {
  return {
    id,
    severity,
    title,
    surfaces,
    wcag,
    evidence,
    steps,
    observed: evidence,
    expected,
    impact,
    fix,
    acceptance: `${title} is fixed in automated checks and verified with keyboard/screen-reader or visual measurement evidence as applicable.`,
    confidence: "high",
  };
}

function impactFor(title) {
  if (/ARIA|landmark|heading|list|name|role|link|image/i.test(title)) return "Screen-reader users may lose orientation, purpose, or control meaning.";
  if (/contrast|zoom|viewport/i.test(title)) return "Low-vision users may be unable to read or enlarge content comfortably.";
  if (/target|focus|keyboard/i.test(title)) return "Keyboard, switch, touch, and motor-limited users may be blocked or slowed.";
  return "Users with disabilities may receive incomplete or unreliable access.";
}

function visualRows(pagesValue) {
  return pagesValue.flatMap((page) => [
    ...(page.contrast || []).slice(0, 2).map((entry) => ({
      type: "contrast",
      page: page.url,
      element: compactElement(entry),
      observed: `${entry.ratio}:1, ${entry.color} on ${entry.backgroundColor}`,
      expected: "Normal text >= 4.5:1 unless an exception applies.",
    })),
    ...(page.targetSize || []).slice(0, 2).map((entry) => ({
      type: "target-size",
      page: page.url,
      element: compactElement(entry),
      observed: `${entry.width}x${entry.height}px`,
      expected: "Target >= 24x24 CSS px or valid spacing exception.",
    })),
  ]).slice(0, 50);
}

function countAxeIds(pagesValue) {
  const counts = {};
  for (const page of pagesValue) {
    for (const violation of page.axe?.violations || []) {
      counts[violation.id] = (counts[violation.id] || 0) + 1;
    }
  }
  return counts;
}

function decisionSummary(decision, findingsValue, successfulCount, totalCount) {
  if (decision === "FAIL") return `${successfulCount}/${totalCount} pages produced enough evidence for review. Unresolved high-risk findings remain, so production sign-off should fail until remediation and regression evidence are complete.`;
  if (decision === "PASS_WITH_RISK") return "No critical/high finding was derived, but unresolved medium/low findings or limitations remain.";
  return "No confirmed defects were derived from the available evidence. Review limitations before treating this as full conformance.";
}

function priorityFor(severity) {
  if (severity === "Critical") return "P0";
  if (severity === "High") return "P1";
  if (severity === "Medium") return "P2";
  return "P3";
}

function describeActive(step) {
  const active = step.pageState?.activeElement;
  if (!active) return "";
  return [active.tag, active.id ? `#${active.id}` : "", active.role ? `[role=${active.role}]` : "", active.name || ""].filter(Boolean).join(" ");
}

function compactElement(entry) {
  return [entry.tag, entry.id ? `#${entry.id}` : "", entry.role ? `[role=${entry.role}]` : "", entry.name || entry.text || ""].filter(Boolean).join(" ").slice(0, 180);
}

function slugFromAudit(filePath) {
  return path.basename(path.dirname(filePath)) || "audit";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function requiredArg(parsed, name) {
  if (!parsed[name]) throw new Error(`Missing required argument --${name}`);
  return parsed[name];
}

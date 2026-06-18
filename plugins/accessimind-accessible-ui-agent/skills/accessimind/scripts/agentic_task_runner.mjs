#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));
const { chromium } = requireFromCwd("playwright");

const args = parseArgs(process.argv.slice(2));
const targetUrl = requiredArg(args, "url");
const planPath = args.plan ? path.resolve(args.plan) : null;
const plan = planPath && fs.existsSync(planPath) ? JSON.parse(fs.readFileSync(planPath, "utf8")) : null;
const outPath = path.resolve(args.out || path.join("reports", "agentic-task-evidence.json"));
const channel = args.channel || plan?.environment?.browserChannel || "chrome";
const headless = args.headless === "true";
const pacingMs = Number(args.pacingMs || plan?.safeBrowsing?.pacingMs || 1200);
const maxSteps = Number(args.maxSteps || 80);

const flows = plan?.userFlows?.length ? plan.userFlows : [
  { id: "orientation", goal: "Understand page purpose and structure." },
  { id: "navigation", goal: "Find and operate primary navigation." },
  { id: "search-or-filter", goal: "Find search or filtering controls." },
  { id: "dynamic-content", goal: "Operate a visible disclosure, menu, dialog, or carousel control." },
];

const result = {
  runId: `agentic-task-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  startedAt: new Date().toISOString(),
  url: targetUrl,
  plan: planPath,
  policy: {
    destructiveActionsAllowed: false,
    credentialEntryAllowed: false,
    wafEvasionAllowed: false,
    captchaBypassAllowed: false,
  },
  flows: [],
  limitations: [],
};

let browser;

try {
  browser = await chromium.launch({ channel, headless, args: ["--disable-notifications"] }).catch(() => chromium.launch({ headless }));
  const context = await browser.newContext({
    locale: plan?.environment?.locale || "en-US",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await paced();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await dismissCommonOverlays(page);

  for (const flow of flows) {
    result.flows.push(await runFlow(page, flow));
  }

  result.finishedAt = new Date().toISOString();
} catch (error) {
  result.error = error?.stack || error?.message || String(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(outPath);
}

async function runFlow(page, flow) {
  const evidence = {
    id: flow.id,
    goal: flow.goal,
    startedAt: new Date().toISOString(),
    steps: [],
    candidateIssues: [],
  };

  if (/orientation/i.test(flow.id)) {
    evidence.steps.push(await snapshotStep(page, "collect-page-orientation"));
  } else if (/navigation/i.test(flow.id)) {
    await attemptNavigation(page, evidence);
  } else if (/search|filter/i.test(flow.id)) {
    await attemptSearchOrFilter(page, evidence);
  } else if (/form/i.test(flow.id)) {
    await inspectForms(page, evidence);
  } else {
    await attemptDynamicContent(page, evidence);
  }

  if (evidence.steps.length < 2) {
    await tabTrace(page, evidence, Math.min(12, maxSteps));
  }

  evidence.finishedAt = new Date().toISOString();
  evidence.candidateIssues = deriveIssues(evidence);
  return evidence;
}

async function attemptNavigation(page, evidence) {
  const navCandidate = page.locator("nav button, nav a[href], header button, header a[href], [aria-haspopup='true'], [aria-expanded]").first();
  evidence.steps.push(await snapshotStep(page, "before-navigation-attempt"));
  if (await navCandidate.count().catch(() => 0)) {
    await navCandidate.focus().catch(() => {});
    evidence.steps.push(await snapshotStep(page, "focus-navigation-candidate"));
    await navCandidate.press("Enter").catch(() => {});
    await paced();
    evidence.steps.push(await snapshotStep(page, "activate-navigation-candidate"));
    await page.keyboard.press("Escape").catch(() => {});
  }
  await tabTrace(page, evidence, 16);
}

async function attemptSearchOrFilter(page, evidence) {
  const candidate = page.locator("input[type='search'], input[placeholder*='search' i], [role='search'] input, button[aria-label*='search' i], button:has-text('Search')").first();
  evidence.steps.push(await snapshotStep(page, "before-search-attempt"));
  if (await candidate.count().catch(() => 0)) {
    await candidate.focus().catch(() => {});
    evidence.steps.push(await snapshotStep(page, "focus-search-candidate"));
    const tag = await candidate.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
    if (tag === "input") {
      await candidate.fill("test").catch(() => {});
      evidence.steps.push(await snapshotStep(page, "type-safe-test-query"));
    } else {
      await candidate.press("Enter").catch(() => {});
      await paced();
      evidence.steps.push(await snapshotStep(page, "open-search-control"));
    }
  }
}

async function inspectForms(page, evidence) {
  evidence.steps.push(await snapshotStep(page, "before-form-inspection"));
  const fields = page.locator("input:not([type='hidden']):not([type='password']), textarea, select").first();
  if (await fields.count().catch(() => 0)) {
    await fields.focus().catch(() => {});
    evidence.steps.push(await snapshotStep(page, "focus-first-safe-form-field"));
  }
}

async function attemptDynamicContent(page, evidence) {
  const candidate = page.locator("button[aria-expanded], [role='button'][aria-expanded], details summary, [aria-controls], .accordion button, .carousel button, .swiper button").first();
  evidence.steps.push(await snapshotStep(page, "before-dynamic-content-attempt"));
  if (await candidate.count().catch(() => 0)) {
    await candidate.focus().catch(() => {});
    evidence.steps.push(await snapshotStep(page, "focus-dynamic-candidate"));
    await candidate.press("Enter").catch(() => {});
    await paced();
    evidence.steps.push(await snapshotStep(page, "activate-dynamic-candidate"));
    await page.keyboard.press("Escape").catch(() => {});
  }
}

async function tabTrace(page, evidence, count) {
  for (let i = 1; i <= count; i += 1) {
    await page.keyboard.press("Tab");
    await paced();
    evidence.steps.push(await snapshotStep(page, `tab-${i}`));
  }
}

async function snapshotStep(page, action) {
  return page.evaluate((actionName) => {
    const active = document.activeElement;
    const rect = active?.getBoundingClientRect?.();
    const style = active ? getComputedStyle(active) : null;
    const name = active ? (active.getAttribute("aria-label") || active.getAttribute("title") || active.innerText || active.value || active.textContent || "").replace(/\s+/g, " ").trim() : "";
    return {
      action: actionName,
      url: location.href,
      title: document.title,
      activeElement: active ? {
        tag: active.tagName.toLowerCase(),
        id: active.id || null,
        role: active.getAttribute("role"),
        name: name.slice(0, 180),
        ariaExpanded: active.getAttribute("aria-expanded"),
        ariaControls: active.getAttribute("aria-controls"),
        tabindex: active.getAttribute("tabindex"),
        rect: rect ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null,
        focusVisible: style ? style.outlineStyle !== "none" || style.boxShadow !== "none" : false,
      } : null,
      pageInventory: {
        h1: [...document.querySelectorAll("h1")].map((el) => el.innerText.trim()).filter(Boolean).slice(0, 5),
        landmarks: document.querySelectorAll("main,nav,header,footer,aside,[role='main'],[role='navigation'],[role='banner'],[role='contentinfo']").length,
        links: document.querySelectorAll("a[href]").length,
        buttons: document.querySelectorAll("button,[role='button']").length,
        fields: document.querySelectorAll("input:not([type='hidden']),select,textarea").length,
      },
    };
  }, action);
}

function deriveIssues(evidence) {
  const issues = [];
  for (const step of evidence.steps) {
    const active = step.activeElement;
    if (!active) continue;
    if ((active.tag === "button" || active.role === "button" || active.tag === "a") && !active.name) {
      issues.push(issue(step, "unnamed-control", "Focused interactive control has no accessible name."));
    }
    if (!active.focusVisible && active.tag !== "body") {
      issues.push(issue(step, "focus-not-visible", "Focused element does not expose a visible outline or box-shadow."));
    }
  }
  if (evidence.steps[0]?.pageInventory?.h1?.length === 0) {
    issues.push({
      type: "missing-h1",
      action: evidence.steps[0].action,
      observed: "No h1 found during orientation inventory.",
      expected: "Page should expose one meaningful h1 for orientation.",
      confidence: "medium",
    });
  }
  return issues.slice(0, 50);
}

function issue(step, type, observed) {
  return {
    type,
    action: step.action,
    target: step.activeElement,
    observed,
    expected: "Interactive elements should expose clear name, role, state, and visible focus.",
    confidence: "medium",
  };
}

async function dismissCommonOverlays(page) {
  const selectors = [
    "#onetrust-reject-all-handler",
    "#onetrust-accept-btn-handler",
    "button:has-text('Reject All')",
    "button:has-text('Accept All')",
    "button:has-text('Accept Cookies')",
    "button[aria-label='Close']",
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 2500 }).catch(() => {});
      await paced();
      break;
    }
  }
}

async function paced() {
  await new Promise((resolve) => setTimeout(resolve, pacingMs));
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

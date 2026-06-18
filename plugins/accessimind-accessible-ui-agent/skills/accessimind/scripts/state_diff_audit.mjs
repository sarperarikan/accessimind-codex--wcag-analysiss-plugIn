#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));
const { chromium } = requireFromCwd("playwright");

const args = parseArgs(process.argv.slice(2));
const targetUrl = requiredArg(args, "url");
const selector = args.selector || "button[aria-expanded], [role='button'], button, a[href], input, select, textarea";
const outPath = path.resolve(args.out || path.join("reports", "state-diff-audit.json"));
const channel = args.channel || "chrome";
const headless = args.headless === "true";
const limit = Number(args.limit || 30);

const result = {
  runId: `state-diff-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  startedAt: new Date().toISOString(),
  url: targetUrl,
  selector,
  interactions: [],
  candidateIssues: [],
  limitations: [],
};

let browser;

try {
  browser = await chromium.launch({ channel, headless, args: ["--disable-notifications"] }).catch(() => chromium.launch({ headless }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
  await dismissCommonOverlays(page);

  const count = Math.min(await page.locator(selector).count().catch(() => 0), limit);
  for (let index = 0; index < count; index += 1) {
    const locator = page.locator(selector).nth(index);
    const before = await snapshot(locator).catch((error) => ({ error: error.message }));
    await locator.focus({ timeout: 1000 }).catch(() => {});
    await locator.press("Enter", { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(500);
    const after = await snapshot(locator).catch((error) => ({ error: error.message }));
    await page.keyboard.press("Escape").catch(() => {});
    const diff = diffState(before, after);
    const record = { index, before, after, diff };
    result.interactions.push(record);
    result.candidateIssues.push(...deriveIssues(record));
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

async function snapshot(locator) {
  return locator.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
    const controlled = (el.getAttribute("aria-controls") || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const target = document.getElementById(id);
        if (!target) return { id, exists: false };
        const style = getComputedStyle(target);
        return {
          id,
          exists: true,
          hidden: target.hidden,
          ariaHidden: target.getAttribute("aria-hidden"),
          display: style.display,
          visibility: style.visibility,
          text: (target.innerText || target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 180),
        };
      });
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      role: el.getAttribute("role"),
      type: el.getAttribute("type"),
      name: name.slice(0, 180),
      ariaExpanded: el.getAttribute("aria-expanded"),
      ariaSelected: el.getAttribute("aria-selected"),
      ariaChecked: el.getAttribute("aria-checked"),
      ariaPressed: el.getAttribute("aria-pressed"),
      ariaCurrent: el.getAttribute("aria-current"),
      ariaInvalid: el.getAttribute("aria-invalid"),
      ariaDescribedBy: el.getAttribute("aria-describedby"),
      ariaControls: el.getAttribute("aria-controls"),
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      controlled,
    };
  });
}

function diffState(before, after) {
  const keys = ["name", "role", "ariaExpanded", "ariaSelected", "ariaChecked", "ariaPressed", "ariaCurrent", "ariaInvalid", "ariaDescribedBy", "ariaControls", "disabled"];
  return keys
    .filter((key) => before?.[key] !== after?.[key])
    .map((key) => ({ key, before: before?.[key] ?? null, after: after?.[key] ?? null }));
}

function deriveIssues(record) {
  const issues = [];
  if (!record.before?.name) {
    issues.push(issue(record, "unnamed-interactive", "Interactive element has no accessible name before activation."));
  }
  if (record.before?.ariaControls && record.before.controlled?.some((item) => !item.exists)) {
    issues.push(issue(record, "broken-aria-controls", "aria-controls references an element that does not exist."));
  }
  if (record.before?.ariaExpanded !== null && record.diff.every((entry) => entry.key !== "ariaExpanded")) {
    issues.push(issue(record, "expanded-state-did-not-change", "Element exposes aria-expanded but activation did not change the state."));
  }
  if (record.before?.ariaControls && record.diff.length === 0) {
    issues.push(issue(record, "no-state-diff-after-activation", "Activation produced no detectable name/role/state/controlled-content change."));
  }
  return issues;
}

function issue(record, type, observed) {
  return {
    type,
    index: record.index,
    target: record.before,
    observed,
    expected: "User-visible interaction changes should be reflected in accessible name, role, state, relationship, focus, or controlled content.",
    confidence: "medium",
  };
}

async function dismissCommonOverlays(page) {
  for (const selectorValue of ["#onetrust-reject-all-handler", "#onetrust-accept-btn-handler", "button:has-text('Reject All')", "button:has-text('Accept All')", "button[aria-label='Close']"]) {
    const locator = page.locator(selectorValue).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }
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

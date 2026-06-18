#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));
const { chromium } = requireFromCwd("playwright");
const { nvda } = requireFromCwd("@guidepup/guidepup");

const args = parseArgs(process.argv.slice(2));
const targetUrl = requiredArg(args, "url");
const targetSelector = args.selector || "body";
const outPath = args.out || path.resolve(process.cwd(), "nvda-web-audit.json");
const browserChannel = args.channel || "chrome";
const headless = args.headless === "true" ? true : false;
const maxNext = Number(args.next || 60);
const maxPrevious = Number(args.previous || 12);
const maxTab = Number(args.tab || 24);
const naturalNavigationEnabled = args.natural !== "false";
const maxNatural = Number(args.naturalSteps || 12);
const captureBeforeForeground = args.beforeForeground === "true";
const token = `NVDA-WEB-AUDIT-${Date.now()}`;

const result = {
  runId: token,
  startedAt: new Date().toISOString(),
  url: targetUrl,
  selector: targetSelector,
  browserChannel,
  nvda: {
    detected: false,
    started: false,
    stopped: false,
  },
  browser: {
    title: null,
    finalUrl: null,
  },
  domInventory: null,
  coverage: null,
  naturalNavigation: {
    enabled: naturalNavigationEnabled,
    routeStepLimit: maxNatural,
    routes: [],
    coverage: null,
  },
  steps: [],
  acceptedSpeech: [],
  filteredNoise: [],
  limitations: [],
  error: null,
};

let browser;

try {
  result.nvda.detected = await nvda.detect();
  if (!result.nvda.detected) {
    throw new Error("NVDA was not detected by Guidepup. Run `npx.cmd @guidepup/setup` and verify NVDA is installed.");
  }

  browser = await launchBrowser(browserChannel, headless);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await dismissCommonOverlays(page);
  await installAuditTitle(page, token);
  await focusAuditTarget(page, targetSelector);
  await page.bringToFront();
  await page.waitForTimeout(750);

  result.browser.title = await page.title();
  result.browser.finalUrl = page.url();
  result.domInventory = await collectDomInventory(page, targetSelector);

  await nvda.start();
  result.nvda.started = true;
  await nvda.clearSpokenPhraseLog();

  await recordStep(page, "initial-web-focus", async () => {
    await page.bringToFront();
    await focusAuditTarget(page, targetSelector);
    await page.keyboard.press("Tab");
  });

  for (let i = 1; i <= maxNext; i += 1) {
    await recordStep(page, `nvda-next-${i}`, async () => {
      await page.bringToFront();
      await nvda.next();
    });
  }

  for (let i = 1; i <= maxPrevious; i += 1) {
    await recordStep(page, `nvda-previous-${i}`, async () => {
      await page.bringToFront();
      await nvda.previous();
    });
  }

  if (naturalNavigationEnabled) {
    result.naturalNavigation.routes = await runNaturalNavigation(page, targetSelector);
  }

  for (let i = 1; i <= maxTab; i += 1) {
    await recordStep(page, `keyboard-tab-${i}`, async () => {
      await page.bringToFront();
      await page.keyboard.press("Tab");
    });
  }

  await recordStep(page, "activate-current", async () => {
    await page.bringToFront();
    await page.keyboard.press("Enter");
  });

  result.coverage = computeCoverage(result.domInventory, result.acceptedSpeech);
  result.naturalNavigation.coverage = computeNaturalCoverage(result.domInventory, result.naturalNavigation.routes);
  result.finishedAt = new Date().toISOString();
} catch (error) {
  result.error = error?.stack || error?.message || String(error);
} finally {
  if (result.nvda.started) {
    try {
      await nvda.stop();
      result.nvda.stopped = true;
    } catch (error) {
      result.nvda.stopError = error?.stack || error?.message || String(error);
    }
  }
  if (browser) {
    await browser.close().catch(() => {});
  }
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
  if (result.error) {
    process.exitCode = 1;
  }
}

async function recordStep(page, action, operation) {
  const beforeCount = (await nvda.spokenPhraseLog()).length;
  const beforeForeground = captureBeforeForeground ? getForegroundWindow() : null;
  await operation();
  await page.waitForTimeout(900);
  const afterForeground = getForegroundWindow();
  const allSpeech = await nvda.spokenPhraseLog();
  const lastSpokenPhrase = await nvda.lastSpokenPhrase().catch(() => "");
  const itemText = await nvda.itemText().catch(() => "");
  const spoken = allSpeech.slice(beforeCount);
  const pageState = await page.evaluate((auditSelector) => {
    const active = document.activeElement;
    const target = document.querySelector(auditSelector) || document.body;
    const rect = active?.getBoundingClientRect?.();
    const text = (active?.innerText || active?.getAttribute?.("aria-label") || active?.getAttribute?.("title") || active?.getAttribute?.("alt") || "").replace(/\s+/g, " ").trim();
    return {
      url: location.href,
      title: document.title,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      activeInsideTarget: active ? target === active || target.contains(active) : false,
      activeElement: active ? {
        tag: active.tagName,
        id: active.id || null,
        className: String(active.className || "").slice(0, 160),
        role: active.getAttribute("role"),
        name: text.slice(0, 200),
        tabindex: active.getAttribute("tabindex"),
        rect: rect ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null,
      } : null,
    };
  }, targetSelector);
  const foregroundAccepted = isExpectedBrowserForeground(afterForeground);
  const speechRecords = spoken.map((phrase) => ({
    action,
    phrase,
    foreground: afterForeground,
    accepted: foregroundAccepted && isLikelyWebSpeech(phrase),
  }));

  for (const record of speechRecords) {
    if (record.accepted) result.acceptedSpeech.push(record);
    else result.filteredNoise.push(record);
  }

  const stepEntry = {
    action,
    beforeForeground,
    afterForeground,
    foregroundAccepted,
    pageState,
    lastSpokenPhrase,
    itemText,
    spoken,
    acceptedSpeech: speechRecords.filter((record) => record.accepted),
    filteredSpeech: speechRecords.filter((record) => !record.accepted),
  };

  result.steps.push(stepEntry);

  if (!foregroundAccepted) {
    result.limitations.push(`Foreground window was not the audited browser after ${action}; speech from this step was filtered.`);
  }

  return stepEntry;
}

async function runNaturalNavigation(page, selector) {
  const routeSpecs = [
    { name: "headings", command: "H", domKey: "headings", expected: result.domInventory?.headings?.length || 0 },
    { name: "landmarks", command: "D", domKey: "landmarks", expected: result.domInventory?.landmarks?.length || 0 },
    { name: "links", command: "K", domKey: "links", expected: result.domInventory?.links?.length || 0 },
    { name: "form-fields", command: "F", domKey: "formFields", expected: result.domInventory?.formFields?.length || 0 },
    { name: "buttons", command: "B", domKey: "buttons", expected: result.domInventory?.buttons?.length || 0 },
    { name: "tables", command: "T", domKey: "tables", expected: result.domInventory?.tables?.length || 0 },
    { name: "graphics", command: "G", domKey: "images", expected: result.domInventory?.images?.length || 0 },
    { name: "lists", command: "L", domKey: "lists", expected: result.domInventory?.lists?.length || 0 },
  ];
  const routes = [];

  for (const route of routeSpecs) {
    const steps = [];
    await focusAuditTarget(page, selector);
    await page.bringToFront();
    await page.waitForTimeout(250);

    const budget = Math.min(maxNatural, Math.max(3, route.expected + 2));
    for (let i = 1; i <= budget; i += 1) {
      const step = await recordStep(page, `natural-${route.name}-${i}`, async () => {
        await page.bringToFront();
        await page.keyboard.press(route.command);
      });
      steps.push(step);
    }

    const reverseSteps = [];
    if (route.name === "headings" || route.name === "links" || route.name === "landmarks") {
      for (let i = 1; i <= Math.min(3, budget); i += 1) {
        const step = await recordStep(page, `natural-${route.name}-reverse-${i}`, async () => {
          await page.bringToFront();
          await page.keyboard.press(`Shift+${route.command}`);
        });
        reverseSteps.push(step);
      }
    }

    const tabRecovery = [];
    for (const command of ["Tab", "Shift+Tab"]) {
      const step = await recordStep(page, `natural-${route.name}-recover-${command.toLowerCase().replace("+", "-")}`, async () => {
        await page.bringToFront();
        await page.keyboard.press(command);
      });
      tabRecovery.push(step);
    }

    routes.push({
      name: route.name,
      command: route.command,
      domKey: route.domKey,
      expectedDomItems: route.expected,
      forwardSteps: steps.map(summarizeNaturalStep),
      reverseSteps: reverseSteps.map(summarizeNaturalStep),
      recoverySteps: tabRecovery.map(summarizeNaturalStep),
    });
  }

  return routes;
}

async function launchBrowser(channel, isHeadless) {
  try {
    return await chromium.launch({
      channel,
      headless: isHeadless,
      args: ["--disable-notifications", "--disable-features=CalculateNativeWinOcclusion"],
    });
  } catch (error) {
    if (channel !== "msedge") {
      result.limitations.push(`Could not launch ${channel}; falling back to msedge. ${error.message}`);
      return chromium.launch({
        channel: "msedge",
        headless: isHeadless,
        args: ["--disable-notifications", "--disable-features=CalculateNativeWinOcclusion"],
      });
    }
    throw error;
  }
}

async function dismissCommonOverlays(page) {
  const selectors = [
    "#onetrust-reject-all-handler",
    "#onetrust-accept-btn-handler",
    "button:has-text('Tüm Çerezleri Reddet')",
    "button:has-text('Reject All')",
    "button:has-text('Accept All')",
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.click({ timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
      break;
    }
  }
}

async function collectDomInventory(page, selector) {
  return page.evaluate((targetSelectorValue) => {
    const target = document.querySelector(targetSelectorValue) || document.body;
    const textOf = (el) => (
      el.getAttribute("aria-label") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent ||
      ""
    ).replace(/\s+/g, " ").trim();
    const boxOf = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const item = (el) => ({
      tag: el.tagName,
      id: el.id || null,
      className: String(el.className || "").slice(0, 140),
      role: el.getAttribute("role"),
      name: textOf(el).slice(0, 220),
      ariaHidden: el.getAttribute("aria-hidden"),
      tabindex: el.getAttribute("tabindex"),
      href: el.getAttribute("href"),
      box: boxOf(el),
    });
    const bySelector = (query) => [...target.querySelectorAll(query)].map(item);
    const targetMatches = (query) => target.matches?.(query) ? [item(target)] : [];
    const withTarget = (query) => [...targetMatches(query), ...bySelector(query)];
    return {
      target: item(target),
      headings: bySelector("h1,h2,h3,h4,h5,h6,[role='heading']"),
      landmarks: withTarget("main,nav,aside,header,footer,form,section[aria-label],section[aria-labelledby],[role='main'],[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary'],[role='search'],[role='form'],[role='region'][aria-label],[role='region'][aria-labelledby]"),
      controls: bySelector("button,[role='button'],input,select,textarea,[role='checkbox'],[role='radio'],[role='switch'],[role='tab']"),
      buttons: bySelector("button,[role='button'],input[type='button'],input[type='submit'],input[type='reset']"),
      formFields: bySelector("input:not([type='hidden']):not([type='button']):not([type='submit']):not([type='reset']),select,textarea,[role='textbox'],[role='combobox'],[role='listbox'],[role='spinbutton'],[role='slider'],[contenteditable='true']"),
      links: bySelector("a[href],[role='link']"),
      images: bySelector("img,svg,[role='img']"),
      tables: bySelector("table,[role='table'],[role='grid'],[role='treegrid']"),
      lists: bySelector("ul,ol,dl,[role='list'],[role='listbox'],[role='menu']"),
      focusables: bySelector("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])"),
      carouselSemantics: {
        role: target.getAttribute("role"),
        roledescription: target.getAttribute("aria-roledescription"),
        label: target.getAttribute("aria-label") || null,
        live: target.getAttribute("aria-live") || null,
        slides: bySelector(".swiper-slide,[aria-roledescription='slide']"),
        pagination: bySelector(".swiper-pagination-bullet,[class*='pagination'] [role='button']"),
      },
    };
  }, selector).catch((error) => ({ error: error.message }));
}

function computeCoverage(domInventory, acceptedSpeech) {
  const speechText = acceptedSpeech.map((record) => record.phrase).join(" \n ").toLocaleLowerCase("tr");
  const candidates = [
    ...(domInventory?.headings || []),
    ...(domInventory?.controls || []),
    ...(domInventory?.links || []),
    ...(domInventory?.images || []),
  ].filter((entry) => entry.name && entry.name.length >= 3);
  const normalized = candidates.map((entry) => {
    const shortName = entry.name.toLocaleLowerCase("tr").slice(0, 80);
    const tokens = shortName.split(/\s+/).filter((token) => token.length >= 4).slice(0, 4);
    const matched = tokens.length > 0 && tokens.some((token) => speechText.includes(token));
    return { ...entry, matchedInAcceptedSpeech: matched };
  });
  return {
    candidateCount: normalized.length,
    matchedCount: normalized.filter((entry) => entry.matchedInAcceptedSpeech).length,
    unmatched: normalized.filter((entry) => !entry.matchedInAcceptedSpeech).slice(0, 50),
    note: "Coverage is heuristic: it compares DOM names/tokens with accepted NVDA speech and should be reviewed with the step log.",
  };
}

function computeNaturalCoverage(domInventory, routes) {
  if (!routes?.length) {
    return { enabled: naturalNavigationEnabled, routeCount: 0, routes: [] };
  }
  return {
    enabled: naturalNavigationEnabled,
    routeCount: routes.length,
    routes: routes.map((route) => {
      const domItems = domInventory?.[route.domKey] || [];
      const acceptedText = [
        ...route.forwardSteps,
        ...route.reverseSteps,
        ...route.recoverySteps,
      ].flatMap((step) => step.acceptedSpeech).join(" \n ").toLocaleLowerCase("tr");
      const matchedItems = domItems.filter((entry) => entry.name && textMatchesSpeech(entry.name, acceptedText));
      const noSpeechSteps = route.forwardSteps.filter((step) => step.acceptedSpeech.length === 0).length;
      const outsideTargetSteps = [
        ...route.forwardSteps,
        ...route.reverseSteps,
        ...route.recoverySteps,
      ].filter((step) => step.outsideTarget).length;
      return {
        name: route.name,
        command: route.command,
        expectedDomItems: domItems.length,
        forwardStepCount: route.forwardSteps.length,
        acceptedSpeechCount: route.forwardSteps.reduce((count, step) => count + step.acceptedSpeech.length, 0),
        noSpeechSteps,
        matchedDomItems: matchedItems.length,
        unmatchedDomItems: domItems.filter((entry) => entry.name && !textMatchesSpeech(entry.name, acceptedText)).slice(0, 25),
        outsideTargetSteps,
      };
    }),
    note: "Natural coverage is heuristic: route speech is compared with route-specific DOM inventory and must be reviewed with the raw step log.",
  };
}

function summarizeNaturalStep(step) {
  const active = step.pageState?.activeElement;
  return {
    action: step.action,
    foregroundAccepted: step.foregroundAccepted,
    activeElement: active,
    acceptedSpeech: step.acceptedSpeech.map((record) => record.phrase),
    filteredSpeech: step.filteredSpeech.map((record) => record.phrase),
    lastSpokenPhrase: step.lastSpokenPhrase,
    itemText: step.itemText,
    outsideTarget: step.pageState?.activeInsideTarget === false,
  };
}

function textMatchesSpeech(text, speechText) {
  const shortName = String(text || "").toLocaleLowerCase("tr").slice(0, 120);
  const tokens = shortName.split(/\s+/).filter((token) => token.length >= 4).slice(0, 5);
  return tokens.length > 0 && tokens.some((token) => speechText.includes(token));
}

async function focusAuditTarget(page, selector) {
  const focused = await page.evaluate((target) => {
    const el = document.querySelector(target);
    if (!el) return { ok: false, reason: "target-not-found" };
    el.scrollIntoView({ block: "center", inline: "center" });
    if (!el.hasAttribute("tabindex")) {
      el.setAttribute("tabindex", "-1");
      el.setAttribute("data-nvda-web-audit-tabindex", "injected");
    }
    el.focus({ preventScroll: true });
    return {
      ok: document.activeElement === el,
      activeTag: document.activeElement?.tagName || null,
      activeId: document.activeElement?.id || null,
      reason: document.activeElement === el ? null : "focus-not-retained",
    };
  }, selector).catch((error) => ({ ok: false, reason: error.message }));
  if (!focused.ok) {
    result.limitations.push(`Could not focus audit target ${selector}: ${focused.reason}`);
  }
  await page.waitForTimeout(250);
  return focused;
}

async function installAuditTitle(page, auditToken) {
  await page.evaluate((value) => {
    document.title = `${value} ${document.title}`;
    window.__nvdaWebAuditToken = value;
  }, auditToken);
}

function getForegroundWindow() {
  if (process.platform !== "win32") {
    return { platform: process.platform, title: "", processName: "", pid: null };
  }
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win32Foreground {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$h=[Win32Foreground]::GetForegroundWindow()
$b=New-Object System.Text.StringBuilder 512
[void][Win32Foreground]::GetWindowText($h,$b,$b.Capacity)
$foregroundProcessId=0
[void][Win32Foreground]::GetWindowThreadProcessId($h,[ref]$foregroundProcessId)
$p=$null
try { $p=Get-Process -Id $foregroundProcessId -ErrorAction Stop } catch {}
[pscustomobject]@{ title=$b.ToString(); processName=if($p){$p.ProcessName}else{""}; pid=$foregroundProcessId } | ConvertTo-Json -Compress
`;
  try {
    return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 5000,
    }));
  } catch (error) {
    return { title: "", processName: "", pid: null, error: error.message };
  }
}

function isExpectedBrowserForeground(foreground) {
  const processName = String(foreground?.processName || "").toLowerCase();
  const title = String(foreground?.title || "");
  return ["chrome", "msedge", "chromium"].some((name) => processName.includes(name)) && title.includes(token);
}

function isLikelyWebSpeech(phrase) {
  const value = String(phrase || "").trim();
  if (!value) return false;
  const blocked = [
    "windows security",
    "logi download assistant",
    "notification",
    "bildirim",
    "microsoft teams",
    "outlook",
    "settings",
    "ayarlar",
  ];
  return !blocked.some((needle) => value.toLowerCase().includes(needle));
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function requiredArg(parsed, name) {
  if (!parsed[name]) {
    throw new Error(`Missing required argument --${name}`);
  }
  return parsed[name];
}

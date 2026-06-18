#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireFromCwd = createRequire(path.join(process.cwd(), "package.json"));
const { chromium } = requireFromCwd("playwright");
const axe = requireFromCwd("axe-core");

const args = parseArgs(process.argv.slice(2));
const seedUrl = requiredArg(args, "url");
const auditPlanPath = args.plan ? path.resolve(args.plan) : null;
const auditPlan = auditPlanPath && fs.existsSync(auditPlanPath) ? JSON.parse(fs.readFileSync(auditPlanPath, "utf8")) : null;
const outDir = path.resolve(args.outDir || path.join("reports", safeSlug(new URL(seedUrl).hostname)));
const pageLimit = Number(args.pages || auditPlan?.scope?.pageLimit || 10);
const depthLimit = Number(args.depth || auditPlan?.scope?.depthLimit || 1);
const locale = args.locale || auditPlan?.environment?.locale || "en-US";
const browserChannel = args.channel || "chrome";
const headless = args.headless === "true";
const pacingMs = Number(args.pacingMs || auditPlan?.safeBrowsing?.pacingMs || 1200);
const maxRequestsPerMinute = Number(args.maxRequestsPerMinute || auditPlan?.safeBrowsing?.maxRequestsPerMinute || 20);
const runId = `agentic-wcag-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const seed = new URL(seedUrl);
const sameOriginOnly = args.sameOrigin !== "false";
const pathPrefix = args.pathPrefix || auditPlan?.scope?.pathPrefix || seed.pathname.replace(/\/[^/]*$/, "/");
const explicitUrls = auditPlan?.scope?.urls || [];

fs.mkdirSync(outDir, { recursive: true });

const result = {
  runId,
  startedAt: new Date().toISOString(),
  seedUrl,
  options: {
    pageLimit,
    depthLimit,
    locale,
    browserChannel,
    headless,
    sameOriginOnly,
    pathPrefix,
    pacingMs,
    maxRequestsPerMinute,
    auditPlan: auditPlanPath,
    wafSafeMode: true,
  },
  policy: {
    authorizationRequired: true,
    stealthOrBypassUsed: false,
    userAgentSpoofingUsed: false,
    webdriverMaskingUsed: false,
    captchaBypassAllowed: false,
    wafEvasionAllowed: false,
  },
  selectedUrls: [],
  pages: [],
  limitations: [],
};

let browser;

try {
  browser = await launchBrowser();
  const context = await browser.newContext({
    locale,
    viewport: { width: 1440, height: 1000 },
  });

  const selected = await crawlUrls(context);
  result.selectedUrls = selected;

  for (let index = 0; index < selected.length; index += 1) {
    const page = await context.newPage();
    const label = `${String(index + 1).padStart(2, "0")}-${safeSlug(new URL(selected[index].url).pathname || "home") || "home"}`;
    result.pages.push(await auditPage(page, selected[index], label));
    await page.close().catch(() => {});
  }

  result.finishedAt = new Date().toISOString();
} catch (error) {
  result.error = error?.stack || error?.message || String(error);
} finally {
  if (browser) await browser.close().catch(() => {});
  const outPath = path.join(outDir, "audit-data.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
  console.log(outPath);
  if (result.error) process.exitCode = 1;
}

async function crawlUrls(context) {
  const seededUrls = explicitUrls.length ? explicitUrls : [seedUrl];
  const queue = seededUrls.map((url, index) => ({
    url: normalizeUrl(url),
    depth: 0,
    source: index === 0 ? "seed" : "audit-plan",
  }));
  const seen = new Set();
  const selected = [];

  while (queue.length && selected.length < pageLimit) {
    const current = queue.shift();
    if (!current || seen.has(current.url)) continue;
    seen.add(current.url);
    if (!isAllowedUrl(current.url)) continue;
    selected.push({ kind: current.depth === 0 ? "seed" : "discovered", ...current });
    if (current.depth >= depthLimit || selected.length >= pageLimit) continue;

    const page = await context.newPage();
    try {
      await pacedDelay();
      await page.goto(current.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await dismissCommonOverlays(page);
      const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")]
        .map((a) => ({ href: a.href, text: (a.innerText || a.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim() }))
        .filter((entry) => entry.href));
      for (const link of prioritizeLinks(links)) {
        const normalized = normalizeUrl(link.href);
        if (!seen.has(normalized) && isAllowedUrl(normalized)) {
          queue.push({ url: normalized, depth: current.depth + 1, source: current.url, text: link.text });
        }
      }
    } catch (error) {
      result.limitations.push(`Discovery failed for ${current.url}: ${error.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  return selected;
}

async function auditPage(page, target, label) {
  const pageResult = {
    ...target,
    startedAt: new Date().toISOString(),
    finalUrl: null,
    title: null,
    status: null,
    blocked: false,
    screenshot: null,
    axe: null,
    dom: null,
    keyboard: null,
    contrast: null,
    focus: null,
    targetSize: null,
    mobile: null,
    limitations: [],
  };

  try {
    await pacedDelay();
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    pageResult.status = response?.status() || null;
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {
      pageResult.limitations.push("networkidle timeout; continued with loaded DOM.");
    });
    await dismissCommonOverlays(page);
    await pacedDelay();
    pageResult.finalUrl = page.url();
    pageResult.title = await page.title();
    pageResult.blocked = await isBlocked(page);

    const screenshotPath = path.join(outDir, `${label}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
      pageResult.limitations.push(`Screenshot failed: ${error.message}`);
    });
    pageResult.screenshot = fs.existsSync(screenshotPath) ? screenshotPath : null;

    if (pageResult.blocked) {
      pageResult.limitations.push("Page appears blocked by access-denied or bot-protection content.");
      return pageResult;
    }

    await page.addScriptTag({ content: axe.source });
    pageResult.axe = await page.evaluate(async () => axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
      },
    })).catch((error) => ({ error: error.message }));

    pageResult.dom = await collectDom(page);
    pageResult.keyboard = await collectKeyboard(page, Number(args.tabSteps || 80));
    pageResult.contrast = await collectContrast(page);
    pageResult.focus = await collectFocusMeasurements(page);
    pageResult.targetSize = await collectTargetSizes(page);
    pageResult.mobile = await collectMobileReflow(page, target.url, label);
  } catch (error) {
    pageResult.error = error?.stack || error?.message || String(error);
  } finally {
    pageResult.finishedAt = new Date().toISOString();
  }

  return pageResult;
}

async function collectDom(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const text = (el) => (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    const compact = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      role: el.getAttribute("role"),
      name: text(el).slice(0, 180),
      ariaHidden: el.getAttribute("aria-hidden"),
      tabindex: el.getAttribute("tabindex"),
      href: el.getAttribute("href"),
    });
    const all = [...document.querySelectorAll("body *")];
    const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")].filter(visible).map(compact);
    const links = [...document.querySelectorAll("a[href],[role='link']")].filter(visible).map(compact);
    const buttons = [...document.querySelectorAll("button,[role='button'],input[type='button'],input[type='submit'],input[type='reset']")].filter(visible).map(compact);
    const fields = [...document.querySelectorAll("input:not([type='hidden']),select,textarea,[role='textbox'],[role='combobox']")].filter(visible).map(compact);
    const images = [...document.querySelectorAll("img,svg,[role='img']")].filter(visible).map(compact);
    const duplicateIds = Object.entries(all.reduce((acc, el) => {
      if (el.id) acc[el.id] = (acc[el.id] || 0) + 1;
      return acc;
    }, {})).filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
    const focusableHidden = [...document.querySelectorAll("[aria-hidden='true'] a[href],[aria-hidden='true'] button,[aria-hidden='true'] input,[aria-hidden='true'] [tabindex]:not([tabindex='-1'])")].map(compact);
    const genericLinks = links.filter((entry) => /^(learn more|view more|view all|shop now|buy now|details|read more|see all|discover|more)$/i.test(entry.name));
    const missingImageNames = images.filter((entry) => !entry.name);
    return {
      lang: document.documentElement.lang || null,
      title: document.title,
      viewport: document.querySelector("meta[name='viewport']")?.getAttribute("content") || null,
      landmarkCount: document.querySelectorAll("main,nav,header,footer,aside,[role='main'],[role='navigation'],[role='banner'],[role='contentinfo'],[role='complementary']").length,
      mainCount: document.querySelectorAll("main,[role='main']").length,
      headings,
      links,
      buttons,
      fields,
      images,
      duplicateIds: duplicateIds.slice(0, 60),
      focusableHidden: focusableHidden.slice(0, 60),
      genericLinks: genericLinks.slice(0, 80),
      missingImageNames: missingImageNames.slice(0, 80),
    };
  });
}

async function collectKeyboard(page, count) {
  const steps = [];
  await page.keyboard.press("Home").catch(() => {});
  for (let i = 1; i <= count; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(90);
    steps.push(await page.evaluate((step) => {
      const el = document.activeElement;
      const rect = el?.getBoundingClientRect?.();
      const style = el ? getComputedStyle(el) : null;
      const name = el ? (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.textContent || "").replace(/\s+/g, " ").trim() : "";
      const outlineWidth = style ? parseFloat(style.outlineWidth || "0") : 0;
      const boxShadow = style ? style.boxShadow : "none";
      const focusVisible = style ? outlineWidth > 0 || boxShadow !== "none" || style.outlineStyle !== "none" : false;
      return {
        step,
        tag: el?.tagName?.toLowerCase() || null,
        id: el?.id || null,
        role: el?.getAttribute?.("role") || null,
        name: name.slice(0, 160),
        href: el?.getAttribute?.("href") || null,
        rect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
        focusVisible,
        activeIsBody: el === document.body,
      };
    }, i));
  }
  const bodyFocusCount = steps.filter((step) => step.activeIsBody).length;
  const uniqueTargets = new Set(steps.map((step) => `${step.tag}#${step.id}:${step.name}`)).size;
  return {
    stepCount: count,
    bodyFocusCount,
    uniqueTargets,
    possibleTrap: uniqueTargets <= 2 || bodyFocusCount > count * 0.7,
    missingVisibleFocus: steps.filter((step) => !step.focusVisible && !step.activeIsBody).slice(0, 30),
    steps,
  };
}

async function collectContrast(page) {
  return page.evaluate(() => {
    const parse = (value) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
    };
    const luminance = ([r, g, b]) => {
      const values = [r, g, b].map((channel) => {
        const c = channel / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const ratio = (fg, bg) => {
      const l1 = luminance(fg);
      const l2 = luminance(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const bgOf = (el) => {
      let current = el;
      while (current && current !== document.documentElement) {
        const bg = getComputedStyle(current).backgroundColor;
        if (bg && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) return bg;
        current = current.parentElement;
      }
      return "rgb(255, 255, 255)";
    };
    return [...document.querySelectorAll("body, body *")]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
        return text.length >= 3 && rect.width > 0 && rect.height > 0 && getComputedStyle(el).display !== "none";
      })
      .slice(0, 700)
      .map((el) => {
        const style = getComputedStyle(el);
        const fg = parse(style.color);
        const bg = parse(bgOf(el));
        if (!fg || !bg) return null;
        const value = ratio(fg, bg);
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: String(el.className || "").slice(0, 100),
          text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 140),
          fontSize: style.fontSize,
          color: style.color,
          backgroundColor: bgOf(el),
          ratio: Math.round(value * 100) / 100,
          failsNormalText: value < 4.5,
        };
      })
      .filter(Boolean)
      .filter((entry) => entry.failsNormalText)
      .slice(0, 80);
  });
}

async function collectFocusMeasurements(page) {
  return page.evaluate(() => [...document.querySelectorAll("a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1']),[role='button'],[role='link']")]
    .slice(0, 120)
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        role: el.getAttribute("role"),
        name: name.slice(0, 120),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        boxShadow: style.boxShadow,
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      };
    })
    .filter((entry) => entry.visible));
}

async function collectTargetSizes(page) {
  return page.evaluate(() => [...document.querySelectorAll("a[href],button,input,select,textarea,[role='button'],[role='link'],[tabindex]:not([tabindex='-1'])")]
    .map((el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const name = (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.value || el.textContent || "").replace(/\s+/g, " ").trim();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        role: el.getAttribute("role"),
        name: name.slice(0, 120),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      };
    })
    .filter((entry) => entry.visible && (entry.width < 24 || entry.height < 24))
    .slice(0, 100));
}

async function collectMobileReflow(page, url, label) {
  const context = page.context();
  const mobile = await context.newPage();
  const mobileResult = { screenshot: null, horizontalOverflow: null, error: null };
  try {
    await mobile.setViewportSize({ width: 320, height: 800 });
    await mobile.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await mobile.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    await dismissCommonOverlays(mobile);
    mobileResult.horizontalOverflow = await mobile.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    }));
    const screenshotPath = path.join(outDir, `${label}-mobile-320.png`);
    await mobile.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
      mobileResult.error = `Mobile screenshot failed: ${error.message}`;
    });
    mobileResult.screenshot = fs.existsSync(screenshotPath) ? screenshotPath : null;
  } catch (error) {
    mobileResult.error = error?.message || String(error);
  } finally {
    await mobile.close().catch(() => {});
  }
  return mobileResult;
}

async function dismissCommonOverlays(page) {
  const selectors = [
    "#onetrust-reject-all-handler",
    "#onetrust-accept-btn-handler",
    "button:has-text('Reject All')",
    "button:has-text('Accept All')",
    "button:has-text('Accept Cookies')",
    "button:has-text('I Accept')",
    "button[aria-label='Close']",
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

async function isBlocked(page) {
  const text = await page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  return /Access Denied|Request blocked|Forbidden|AkamaiGHost|You don't have permission to access/i.test(text.slice(0, 2000));
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      channel: browserChannel,
      headless,
      args: ["--disable-notifications", "--disable-features=CalculateNativeWinOcclusion"],
    });
  } catch (error) {
    if (browserChannel !== "msedge") {
      result.limitations.push(`Could not launch ${browserChannel}; falling back to msedge: ${error.message}`);
      return chromium.launch({
        channel: "msedge",
        headless,
        args: ["--disable-notifications", "--disable-features=CalculateNativeWinOcclusion"],
      });
    }
    throw error;
  }
}

let lastRequestAt = 0;
async function pacedDelay() {
  const minimumGap = Math.max(pacingMs, Math.ceil(60000 / Math.max(1, maxRequestsPerMinute)));
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < minimumGap) {
    await new Promise((resolve) => setTimeout(resolve, minimumGap - elapsed));
  }
  lastRequestAt = Date.now();
}

function prioritizeLinks(links) {
  const scored = links
    .filter((entry) => isAllowedUrl(entry.href))
    .map((entry) => {
      const text = `${entry.href} ${entry.text}`.toLowerCase();
      const score = [
        /product|category|shop|catalog|detail/.test(text) ? 30 : 0,
        /support|contact|help|service|faq/.test(text) ? 25 : 0,
        /about|blog|article|news|sustain/.test(text) ? 15 : 0,
        entry.text && entry.text.length > 2 ? 5 : 0,
      ].reduce((a, b) => a + b, 0);
      return { ...entry, score };
    })
    .sort((a, b) => b.score - a.score || a.href.localeCompare(b.href));
  return uniqueBy(scored, (entry) => normalizeUrl(entry.href));
}

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (sameOriginOnly && parsed.origin !== seed.origin) return false;
    if (args.pathPrefix && !parsed.pathname.startsWith(pathPrefix)) return false;
    if (/\.(pdf|jpg|jpeg|png|webp|svg|zip|mp4|mp3|docx?|xlsx?)$/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/$/, "");
}

function safeSlug(value) {
  return String(value || "audit")
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "audit";
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

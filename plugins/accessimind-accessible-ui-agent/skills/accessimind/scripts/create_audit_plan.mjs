#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const seedUrl = requiredArg(args, "url");
const outPath = path.resolve(args.out || path.join("reports", "audit-plan.json"));
const seed = new URL(seedUrl);
const pageLimit = Number(args.pages || 10);
const depthLimit = Number(args.depth || 1);
const locale = args.locale || "en-US";
const pathPrefix = args.pathPrefix || seed.pathname.replace(/\/[^/]*$/, "/");
const userFlowText = args.flows || "";

const plan = {
  version: "1.0.0",
  createdAt: new Date().toISOString(),
  seedUrl,
  methodology: {
    name: "WCAG-EM inspired agentic audit plan",
    principles: [
      "Define scope before scanning.",
      "Select representative page types and user flows.",
      "Collect automated, keyboard, visual, and assistive-technology evidence.",
      "Report limitations and do not claim conformance from automation alone.",
    ],
  },
  scope: {
    sameOriginOnly: true,
    origin: seed.origin,
    pathPrefix,
    pageLimit,
    depthLimit,
    maxCandidates: Number(args.maxCandidates || Math.max(pageLimit * 6, 12)),
    urls: splitList(args.urls),
    priorityPageTypes: [
      "home",
      "navigation shell",
      "listing or category",
      "detail page",
      "search/results",
      "form",
      "support/help",
      "authentication or account entry",
      "error state",
      "modal/dialog/drawer",
    ],
  },
  safeBrowsing: {
    authorizationRequired: true,
    stealthOrBypassAllowed: false,
    wafEvasionAllowed: false,
    captchaBypassAllowed: false,
    recommendedEnvironment: "staging, allowlisted test profile, or written authorization for production read-only audit",
    pacingMs: Number(args.pacingMs || 3000),
    interactionDelayMs: Number(args.interactionDelayMs || 450),
    initialSettleMs: Number(args.initialSettleMs || 5000),
    maxRequestsPerMinute: Number(args.maxRequestsPerMinute || 12),
    maxConcurrency: 1,
    humanNavigation: args.humanNavigation !== "false",
    stopOnBlockPage: args.stopOnBlockPage !== "false",
  },
  environment: {
    locale,
    browserChannel: args.channel || "chrome",
    viewportSet: [
      { id: "desktop", width: 1440, height: 1000 },
      { id: "mobile", width: 320, height: 800 },
      { id: "zoom-200-equivalent", width: 640, height: 800 },
      { id: "zoom-400-equivalent", width: 320, height: 800 },
    ],
  },
  evidenceTracks: {
    automatedRules: true,
    domInventory: true,
    keyboardTraversal: true,
    screenReader: args.screenReader !== "false",
    lowVision: true,
    motorAccess: true,
    stateDiff: true,
    screenshots: true,
    evidenceBundles: true,
  },
  userFlows: buildFlows(userFlowText),
  report: {
    template: "templates/default-html-audit-report.md",
    includeJiraWork: true,
    includeRegressionPack: true,
    includeAtomicScreenReaderRows: true,
    includeLimitations: true,
  },
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
console.log(outPath);

function buildFlows(raw) {
  const custom = splitList(raw);
  if (custom.length) return custom.map((goal, index) => flow(`custom-${index + 1}`, goal));
  return [
    flow("orientation", "Understand the page purpose using title, h1, landmarks, and first screen content."),
    flow("navigation", "Find and operate primary navigation with keyboard and screen reader."),
    flow("search-or-filter", "Find search or filtering controls and determine whether results/state changes are announced."),
    flow("form-error", "Locate a form, trigger a validation state when safe, and inspect error naming and recovery guidance."),
    flow("dynamic-content", "Operate a carousel, modal, drawer, accordion, or menu when present and inspect state/focus behavior."),
  ];
}

function flow(id, goal) {
  return {
    id,
    goal,
    allowedActions: ["navigate", "tab", "shift-tab", "enter", "space", "escape", "type-test-query", "open-disclosure"],
    disallowedActions: ["purchase", "submit-destructive", "bypass-captcha", "bypass-waf", "credential-attack"],
    evidence: ["keyboard trace", "DOM target", "accessible name/role/state", "screenshot", "screen-reader phrase when available"],
  };
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
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

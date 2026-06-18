#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const auditPath = path.resolve(requiredArg(args, "audit"));
const nvdaPath = args.nvda ? path.resolve(args.nvda) : null;
const taskPath = args.tasks ? path.resolve(args.tasks) : null;
const statePath = args.state ? path.resolve(args.state) : null;
const outPath = path.resolve(args.out || path.join(path.dirname(auditPath), "evidence-bundle.json"));

const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
const nvda = nvdaPath && fs.existsSync(nvdaPath) ? JSON.parse(fs.readFileSync(nvdaPath, "utf8")) : null;
const tasks = taskPath && fs.existsSync(taskPath) ? JSON.parse(fs.readFileSync(taskPath, "utf8")) : null;
const state = statePath && fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : null;

const bundle = {
  runId: `evidence-bundle-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  createdAt: new Date().toISOString(),
  sourceArtifacts: {
    audit: auditPath,
    nvda: nvdaPath,
    tasks: taskPath,
    state: statePath,
  },
  target: audit.seedUrl || audit.scope?.base || audit.url || "",
  pages: summarizePages(audit.pages || []),
  ruleEvidence: buildRuleEvidence(audit.pages || []),
  screenReaderEvidence: buildScreenReaderEvidence(nvda),
  taskEvidence: buildTaskEvidence(tasks),
  stateDiffEvidence: buildStateEvidence(state),
  replayIndex: [],
};

bundle.replayIndex = buildReplayIndex(bundle);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(bundle, null, 2), "utf8");
console.log(outPath);

function summarizePages(pages) {
  return pages.map((page, index) => ({
    id: `P-${index + 1}`,
    url: page.url,
    finalUrl: page.finalUrl,
    title: page.title,
    status: page.status,
    screenshot: page.screenshot,
    mobileScreenshot: page.mobile?.screenshot,
    keyboardSteps: page.keyboard?.stepCount,
    uniqueFocusTargets: page.keyboard?.uniqueTargets,
    violations: page.axe?.violations?.length || 0,
  }));
}

function buildRuleEvidence(pages) {
  const rows = [];
  for (const [pageIndex, page] of pages.entries()) {
    for (const violation of page.axe?.violations || []) {
      for (const [nodeIndex, node] of (violation.nodes || []).slice(0, 10).entries()) {
        rows.push({
          id: `AXE-${pageIndex + 1}-${rows.length + 1}`,
          pageId: `P-${pageIndex + 1}`,
          url: page.url,
          rule: violation.id,
          impact: violation.impact,
          help: violation.help,
          wcagTags: violation.tags,
          target: node.target,
          html: node.html,
          failureSummary: node.failureSummary,
          screenshot: page.screenshot,
          replay: [
            "Open URL.",
            "Dismiss non-essential overlays if present.",
            `Inspect target ${JSON.stringify(node.target)}.`,
            `Verify rule ${violation.id} no longer fails after remediation.`,
          ],
        });
      }
    }
  }
  return rows;
}

function buildScreenReaderEvidence(nvdaData) {
  if (!nvdaData) return [];
  return (nvdaData.steps || []).map((step, index) => ({
    id: `SR-${index + 1}`,
    action: step.action,
    phrase: (step.acceptedSpeech || []).map((entry) => entry.phrase).join(" | ") || "no accepted speech",
    foregroundAccepted: step.foregroundAccepted,
    activeElement: step.pageState?.activeElement,
    expected: "Speech should match the visible and programmatic control purpose.",
    rawStep: index,
  }));
}

function buildTaskEvidence(taskData) {
  if (!taskData) return [];
  return (taskData.flows || []).flatMap((flow) => (flow.candidateIssues || []).map((issue, index) => ({
    id: `TASK-${flow.id}-${index + 1}`,
    flow: flow.id,
    goal: flow.goal,
    type: issue.type,
    action: issue.action,
    target: issue.target,
    observed: issue.observed,
    expected: issue.expected,
    confidence: issue.confidence,
  })));
}

function buildStateEvidence(stateData) {
  if (!stateData) return [];
  return (stateData.candidateIssues || []).map((issue, index) => ({
    id: `STATE-${index + 1}`,
    type: issue.type,
    target: issue.target,
    observed: issue.observed,
    expected: issue.expected,
    confidence: issue.confidence,
  }));
}

function buildReplayIndex(current) {
  return [
    ...current.ruleEvidence.map((item) => ({
      id: item.id,
      kind: "automated-rule",
      url: item.url,
      steps: item.replay,
      artifact: current.sourceArtifacts.audit,
    })),
    ...current.screenReaderEvidence.filter((item) => item.phrase !== "no accepted speech").map((item) => ({
      id: item.id,
      kind: "screen-reader",
      steps: [item.action, `Expected meaningful phrase; observed: ${item.phrase}`],
      artifact: current.sourceArtifacts.nvda,
    })),
    ...current.taskEvidence.map((item) => ({
      id: item.id,
      kind: "agentic-task",
      steps: [item.flow, item.action || "review flow evidence", item.observed],
      artifact: current.sourceArtifacts.tasks,
    })),
    ...current.stateDiffEvidence.map((item) => ({
      id: item.id,
      kind: "state-diff",
      steps: ["Focus target", "Activate target", item.observed],
      artifact: current.sourceArtifacts.state,
    })),
  ];
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

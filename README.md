# AccessiMind Codex Plugin Marketplace

Public Codex marketplace package for the AccessiMind Accessible UI Agent plugin.

## Install

After this folder is published as a public GitHub repository, users can add it to Codex:

```bash
codex plugin marketplace add OWNER/REPO
```

If the marketplace lives in a subfolder, use sparse checkout:

```bash
codex plugin marketplace add OWNER/REPO --sparse .agents/plugins --sparse plugins
```

Then open Codex app, go to Plugins, select the AccessiMind Public marketplace, and install `AccessiMind Accessible UI Agent`.

## Use

Invoke the bundled skill in Codex:

```text
$accessimind audit this page for WCAG 2.2, keyboard access, and screen-reader behavior.
```

## Package Contents

- `.agents/plugins/marketplace.json`: Codex marketplace catalog.
- `plugins/accessimind-accessible-ui-agent`: Codex plugin package.
- `plugins/accessimind-accessible-ui-agent/skills/accessimind`: bundled skill invoked as `$accessimind`.

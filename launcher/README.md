# vibechemy

Launcher for [Vibechemy](https://github.com/DiamondAlchemy/vibechemy) — command a fleet of AI
coding agents (Claude Code, Codex, OpenCode, Gemini, and more) from one terminal cockpit.

```sh
npx vibechemy
```

First run downloads the latest release (macOS, Apple Silicon), verifies its checksum against
the release's own update feed, installs it under `~/.vibechemy/app`, and launches it. After
that the app keeps itself up to date; `npx vibechemy` just relaunches it.

- `npx vibechemy --from-source` — print the run-from-source instructions (any platform).
- Everything is MIT and BYOK: the app drives the agent CLIs you already have, on your own
  subscriptions. No accounts, no telemetry, no keys of ours.

Full docs: [GETTING-STARTED](https://github.com/DiamondAlchemy/vibechemy/blob/main/GETTING-STARTED.md)

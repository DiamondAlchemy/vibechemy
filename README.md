# Vibechemy

**A terminal-grid cockpit for commanding a fleet of CLI coding agents.**

I'm not a career software engineer. I run a real business in a physical, regulated industry and I
needed to ship and operate my own software without a dev team. So I built the machine that lets one
operator command many coding agents at once — watch them work in real terminals, review their diffs,
and merge the good ones. **Vibechemy** is the open-source core of that machine: the orchestration
shell, with the business-specific and proprietary parts removed.

If you've ever had three AI CLIs open in three terminals and lost track of who's doing what — this is
the cockpit for that.

> **Who made this:** Built by [DiamondAlchemy](https://github.com/DiamondAlchemy).
> The full private rig runs my actual company; Vibechemy is the reusable core.

---

## What it is

A desktop app (Electron + React + TypeScript) that turns a wall of terminals into a controllable
fleet:

- **Terminal grid** — every agent runs in a real `tmux`-backed terminal you can watch, type into, and
  scroll. No hidden background processes; if an agent is working, you see it working.
- **Spawn / steer / review** — launch an agent from a preset into its own **isolated git worktree**,
  send it follow-up instructions, view its diff, and merge it locally when it's good.
- **Agent roster** — bring your own CLIs (Claude Code, Codex, and any command-based agent). Presets
  are data; add your own.
- **MCP control plane** — an authenticated Model Context Protocol server so an orchestrator agent can
  drive the whole fleet through tools (`spawn_worker`, `send_to_worker`, `get_diff`, `merge_worker`, …).
- **Personal Agent slot** — wire in your own assistant/agent CLI as a first-class orchestrator with an
  end-of-day handoff (see below).
- **Free-form canvas** — arrange panes freely on a starfield canvas, annotate with notes / ink / frames
  while you think.
- **Institutional memory** — a per-project knowledge base, coding-standards set, and shared memory that
  gets injected into every agent's context so the fleet stops re-solving and re-breaking the same things.
- **One consistent gesture contract** — the same click / scroll / select / copy behavior on every pane,
  no matter which CLI is inside it (see the cheat sheet below).

## What it is *not*

Vibechemy is the **core**, not a whole rig. Deliberately left out (they're business-specific or still
private): media/image generation, an always-on assistant brain, remote-rig control, and usage/billing
adapters. Features may flow out to this public repo over time, or they may not. No roadmap promises.

macOS-first (built and run on Apple Silicon). Not tested on Windows/Linux yet.

---

## Quickstart

```bash
git clone https://github.com/DiamondAlchemy/vibechemy.git
cd vibechemy
npm install
npm run dev        # launches the app in dev
```

Then:

1. Register a project (point it at a git repo on your machine, or drag a folder from Finder onto the sidebar).
2. Open the agent roster and make sure at least one CLI agent is installed and signed in.
3. Spawn a worker — it opens in its own terminal, in its own git worktree.
4. Give it a task, watch it work, review its diff, merge it.

**Requirements:** macOS, **Node 20.19+ / 22.12+**, `tmux`, and at least one agent CLI on your `PATH`.
`npm install` compiles native modules (`better-sqlite3`, `node-pty`) from source, so you also need the
**Xcode Command Line Tools** (`xcode-select --install`) and **python3**.

## The terminal gesture cheat sheet

Every pane behaves the same, whichever CLI is inside it:

| Gesture | What it does |
|---|---|
| **Click** an unfocused pane | Focus it — start typing immediately |
| **Scroll wheel** | Scroll that pane's own transcript / scrollback |
| **Option-drag** | Select text (auto-copies to clipboard) |
| **Right-click** | Copy / Paste menu |
| **⌘C / ⌘V** | Standard copy / paste |

The whole point: you never have to remember a different command per agent.

## The Personal Agent slot

Point the "Personal Agent" setting at your own assistant CLI (command + args + a display name). It
becomes a first-class orchestrator you can summon, and it receives an end-of-day handoff — a single
prompt telling it to pull the day's activity and tidy the knowledge base. It's the seam where your own
agent plugs into the cockpit; the app ships with the slot empty for you to fill.

---

## Architecture (one paragraph)

`src/main/` is the Electron main process (all the real logic — sessions, tmux, git, the MCP server,
the stores). `src/preload/` is the typed IPC bridge. `src/renderer/` is the React UI. `src/shared/` is
pure, Node-free domain logic that carries the unit tests. Every subsystem has a `shared/` half so its
logic is testable without touching live services. Start at `src/main/index.ts`.

## License

MIT — see [LICENSE](./LICENSE). Use it, fork it, build your own cockpit.

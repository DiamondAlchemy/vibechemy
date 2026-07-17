# Getting started: zero to operational

This walkthrough takes you from a clean Mac to a working Vibechemy fleet. You will install the app,
sign in to the agent CLIs you want to use, register a git repository, launch an orchestrator, and
merge an isolated worker's changes locally.

Vibechemy is BYOK: every CLI runs against your own vendor account or subscription. Vibechemy does
not store vendor credentials or proxy model access, and its Install/Log in buttons only launch the
vendor's own flow in a visible terminal pane — the sign-in itself is always between you and the
vendor. You can do the CLI setup in Terminal before you open the app, or from the in-app roster.

## 1. What you need

Vibechemy is macOS-first and has been built and tested on Apple Silicon. You need:

- macOS
- Git
- Node.js 20.19 or newer, or Node.js 22.12 or newer
- npm
- Xcode Command Line Tools
- Python 3
- Homebrew and `tmux`
- At least one supported agent CLI, installed and signed in
- A local git repository for your first project

Install the Xcode Command Line Tools:

```bash
xcode-select --install
```

If you do not have Homebrew, install it from [brew.sh](https://brew.sh/), then open a new Terminal
window. Install `tmux`:

```bash
brew install tmux
```

If `python3` is missing, install it:

```bash
brew install python
```

Install a supported Node.js release from [nodejs.org](https://nodejs.org/) or with your preferred
Node version manager. Check every prerequisite before continuing:

```bash
git --version
node --version
npm --version
xcode-select -p
python3 --version
tmux -V
```

Do not continue until each command succeeds and `node --version` reports a supported version.

## 2. Install and launch Vibechemy

Clone the public repository and install its locked dependency tree:

```bash
git clone https://github.com/DiamondAlchemy/vibechemy.git
cd vibechemy
npm ci
```

`npm ci` compiles the Electron-native `better-sqlite3` and `node-pty` modules. The Xcode tools and
Python requirement above are what make that build possible.

The first install downloads Electron and compiles those native modules — expect it to take
**10–20 minutes** depending on your connection, mostly in silence. That is normal; it is not hung.

Start Vibechemy in development mode:

```bash
npm run dev
```

Keep that Terminal window open while you use the app. Press Control-C there when you want to stop
the development process.

On first development launch, Vibechemy creates:

- `~/Library/Application Support/vibechemy-dev/vibechemy.sqlite` for projects, settings, activity,
  knowledge, and standards;
- `~/Library/Application Support/vibechemy-dev/mcp-token`, an owner-only bearer token for the MCP
  control plane;
- `~/Library/Application Support/vibechemy-dev/boot.log`;
- `~/.vibechemy/orchestrator-dev/`, containing generated MCP configuration and the orchestrator
  briefing for the built-in lead CLIs.

A packaged build uses `~/Library/Application Support/vibechemy/`, `~/.vibechemy/orchestrator/`, and
MCP port 4880 instead. Development mode uses port 4881 so both identities can coexist.

### Updating Vibechemy

To update an existing install to the latest published version, stop the running app first
(Control-C in its Terminal window), then in the same folder you cloned before:

```bash
cd vibechemy
git pull
npm install
npm run dev
```

`git pull` brings the new code and `npm install` syncs any dependency changes — it finishes in
seconds when nothing changed; the long native build from the first install only repeats when
Electron or a native module version actually moves. Your projects, settings, and activity live in
`~/Library/Application Support/vibechemy-dev/`, not in the repo folder, so updating never touches
them. There is no need to clone again — a second clone just leaves a stray copy on disk.

## 3. Install and sign in to your agents

The shipped worker roster is Shell, Claude Code, Codex, Antigravity, Cursor, Grok, OpenCode GLM,
and OpenCode MiniMax (the OpenCode chips are an editable roster — any provider/model OpenCode
supports can be added; see its section below). The orchestrator picker offers the supported lead
variants. Shell uses your
normal shell and needs no vendor login.

**Settings → Agents** shows each agent CLI's live state as chips — installed (with version)
and signed in — plus **Install** and **Log in** buttons that run the vendor's own flow in a visible
terminal pane. Vibechemy never touches credentials: it only detects the vendor's auth artifact and
launches the vendor flow; you complete the sign-in yourself in that pane. The roster also edits
Claude/Codex lead and worker models, extra Claude account profiles, OpenCode model slugs, and custom
agent commands.

The manual terminal steps below remain the authoritative path — the in-app buttons run exactly these
commands. You can operate with one signed-in agent. Complete every subsection whose agent you want
available as a working chip in Vibechemy.

### Claude Code

**Account:** a Claude account with a Claude Pro or Max subscription that includes Claude Code.

Install:

```bash
npm i -g @anthropic-ai/claude-code
```

Sign in:

```bash
claude
```

Complete the first-run flow. If Claude asks for authentication inside the session, enter `/login`
and finish the vendor flow.

Verify:

```bash
command -v claude
claude --version
```

Run `claude` once more and submit a harmless prompt such as “Reply with OK.” Claude is ready when it
answers without returning to a login screen. Vibechemy uses Claude for both lead and worker presets;
you can change their model names separately under **Settings → Agents**.

#### Optional: add more Claude subscriptions

Vibechemy can keep additional Claude logins in isolated credential stores:

1. Open **Settings → Agents → Extra Claude accounts**.
2. Select **+ Add account** and give the account a recognizable label.
3. Choose **Orchestrator only** for a lead chip, or **Orchestrator + worker** for both chip types.
4. Close Settings, open the orchestrator **＋** picker, and summon the named account.
5. Complete Claude's first-run login in that pane. Enter `/login` if Claude asks for it.
6. Submit a harmless prompt and confirm that the named account answers.

Repeat those steps for each additional Claude subscription. When one or more named accounts exist,
the generic Claude lead choices are hidden from the summon picker; delete the named rows to bring
the generic choices back.

### Codex

**Account:** a ChatGPT account whose subscription includes Codex.

Install:

```bash
npm i -g @openai/codex
```

Sign in:

```bash
codex login
```

Follow the browser flow and return to Terminal when it completes.

Verify:

```bash
command -v codex
codex --version
```

Start `codex` and submit a harmless test prompt. It is ready when it answers without asking you to
sign in. You can set different lead and worker model/effort values under
**Settings → Agents**; blank values use the Codex CLI defaults.

### Antigravity

**Account:** the Google account that has access to Antigravity. The maintained setup data does not
name a specific paid plan.

Install:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
```

Sign in by starting it:

```bash
agy
```

The first run opens Google Sign-In. Complete it with the Google account you want the agent to use.

Verify:

```bash
command -v agy
agy --version
```

Run `agy` and submit a harmless test prompt. A successful response is the authentication check;
Vibechemy does not rely on a separate Antigravity status command.

### Cursor

**Account:** the Cursor account and subscription you use for Cursor's terminal agent.

Install:

```bash
curl https://cursor.com/install -fsS | bash
```

Sign in:

```bash
cursor-agent login
```

Verify:

```bash
command -v cursor-agent
cursor-agent --version
cursor-agent status
```

Do not continue until `cursor-agent status` reports that you are logged in.

### Grok

**Account:** the X account whose SuperGrok or X subscription includes access to Grok Build.

Install:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

Sign in by starting it:

```bash
grok
```

Complete the X-account sign-in shown on first run.

Verify:

```bash
command -v grok
grok --version
```

Run `grok` and submit a harmless test prompt. It is ready when it answers without showing the
first-run login again.

### OpenCode with GLM and MiniMax

**Accounts:** OpenCode is the client. The two shipped worker models use your Z.AI Coding Plan and
MiniMax accounts respectively. Sign in only to one if you intend to use only that provider.

Install:

```bash
npm i -g opencode-ai
```

Start the provider login flow:

```bash
opencode auth login
```

Choose Z.AI and complete its prompts. Run `opencode auth login` again, choose MiniMax, and complete
that provider's prompts.

Verify the binary and confirm both model slugs are visible:

```bash
command -v opencode
opencode --version
opencode models
```

The shipped model slugs are:

- `zai-coding-plan/glm-5.2`
- `minimax/MiniMax-M3`

Test each provider directly:

```bash
opencode -m zai-coding-plan/glm-5.2
opencode -m minimax/MiniMax-M3
```

In each session, submit a harmless prompt and confirm that the selected provider answers. If a slug
changes, run `opencode models`, then update the corresponding row in the
**Models — each row is a spawn chip** block under **Settings → Agents**. Each row becomes a worker
chip; newly opened panes use the edited slug.

**OpenCode is not limited to GLM and MiniMax.** Those two are just the shipped defaults of an
editable roster: any provider/model that OpenCode supports can become a worker chip. Run
`opencode models` to see what your signed-in providers offer, then add a row in the
**Models — each row is a spawn chip** block under **Settings → Agents** (a label plus the
`provider/model` slug, **+ Add model**) — the chip appears immediately, no restart needed. You can also just ask your orchestrator to do it:
its `configure_agents` tool adds and removes OpenCode models conversationally. Either way, the
provider must be signed in (`opencode auth login`) first, or OpenCode silently falls back to its
default model.

### Any other CLI

Vibechemy can launch any terminal agent with a command line:

1. Use the vendor's install page when Vibechemy's maintained roster has no install command.
2. Install and sign in from Terminal using the vendor's flow.
3. Run `command -v` with that CLI's binary name, then start it and complete one test prompt.
4. Open Vibechemy's gear button, find **Settings → Agents → Custom agents**, and select
   **+ Add agent**.
5. Enter a label and launch command. The saved row becomes a live worker chip.

Custom commands are split on whitespace. A simple line such as `agent-cli --model example` works;
quoted arguments are not shell-parsed. Put a complex launch in a small executable wrapper script
and use the wrapper's path as the command.

Vibechemy does not ship a Gemini CLI preset. Google's built-in roster entry is Antigravity (`agy`).
You can still add Gemini CLI or another Google agent through **Custom agents**, using the vendor's
current install and sign-in documentation.

## 4. Launch your first fleet

### Register a project

Use a clean local git repository for this walkthrough.

1. In the left rail, select **＋ Add workspace**.
2. Enter a display name.
3. Enter the repository's absolute path, or select **Browse…** and choose the folder.
4. Select **Add project**.
5. Confirm the new workspace is selected in the left rail.

You can also drag a repository folder from Finder onto the workspace area. Vibechemy registers the
folder; it does not copy or upload your repository.

### Summon an orchestrator

1. In the left rail's orchestrator dock, select the **＋** button.
2. Choose a lead CLI that you installed and verified above: Claude, Codex, Grok, or an OpenCode
   variant.
3. Watch its real terminal pane. On its first line it receives an operating briefing and should
   report that it is ready for your goal.

The fleet wiring is automatic for these built-in leads. On boot, Vibechemy mints the MCP token and
generates CLI-specific, lead-only configuration. Claude receives a generated MCP config, Codex gets
invocation-scoped MCP overrides, OpenCode gets a dedicated config, and Grok gets a dedicated config
home. The lead starts with the Vibechemy tools and operating briefing already loaded. Ordinary
worker panes do not receive spawn or merge powers.

You do not need to edit those generated files or add Vibechemy to each vendor's global MCP config.

### Spawn and steer a worker

Give the orchestrator a small, concrete first task. For example:

> In the selected project, inspect the repository, then spawn one isolated Codex worker to add a
> small documentation improvement. Have it run the relevant checks. Do not merge until you have
> reviewed its output and diff.

The orchestrator can discover the selected project and roster, load project memory and standards,
and call `spawn_worker`. For code work, it uses `isolate:true`, which gives the worker its own git
worktree and `vc/` branch. The worker appears as a visible terminal on the canvas.

To redirect it while it is running, tell the orchestrator exactly what to send:

> Tell the existing worker to keep the change to one file and run the documentation check again.

The orchestrator uses `send_to_worker`; it should not spawn a replacement for a worker that already
has the right context. You can also click the worker pane and type directly into its terminal.

For a manual spawn, use the bottom command bar: leave **Isolate** on, open **Agents**, and select an
agent chip. Manual worker panes do not receive an opening task automatically, so type the task into
the new pane yourself.

### Review and merge

1. Wait for the worker to report its checks and stop changing files.
2. Ask the orchestrator to use `read_output` and `get_diff`, or inspect the worker terminal yourself.
3. Open **Review & merge** from the right-hand rail.
4. Select the worker's `vc/` branch and read the displayed diff.
5. If the result and checks are good, select **Merge**. If not, steer the same worker and review the
   updated diff. Use **Discard** only when you intend to delete that isolated work.

`merge_worker` and the **Merge** button merge into the local project only. Vibechemy does not push or
deploy the result.

## 5. Configure the Personal Agent slot

The Personal Agent slot is for an assistant CLI you already use. It becomes a named orchestrator in
the summon picker and can receive the end-of-day knowledge handoff.

1. Install and sign in to that CLI using its vendor instructions.
2. Verify it from Terminal with `command -v`, its version command if the vendor provides one, and a
   successful test prompt.
3. Open Vibechemy's gear button and find **Settings → Personal agent**.
4. Set **Label** to the name you want in the summon picker.
5. Set **Command** to the binary name or an absolute executable path.
6. Put any whitespace-separated arguments in **Args**.
7. Close Settings, select **＋** in the orchestrator dock, and choose your Personal Agent label.

Vibechemy sends this slot an orchestration briefing when it starts and can send it an end-of-day
oversight briefing from the eye button in the title bar. Because the slot accepts an arbitrary CLI,
Vibechemy cannot generate that vendor's MCP configuration. To let it call the fleet tools, configure
the CLI as an external MCP client using the next section. Built-in lead presets do not need that
manual step.

As with custom agents, Personal Agent arguments are split on whitespace rather than parsed by a
shell. Use an executable wrapper script when the launch requires quoting or shell expansion.

## 6. Connect an external MCP client

Use this for a Personal Agent or any MCP client running outside a built-in orchestrator pane.
Configure a remote Streamable HTTP MCP server with:

- **Server name:** `vibechemy`
- **Packaged URL:** `http://127.0.0.1:4880/mcp`
- **Development URL:** `http://127.0.0.1:4881/mcp`
- **Header:** `Authorization: Bearer <the contents of mcp-token>`

For the `npm run dev` setup in this guide, read the bearer token with:

```bash
cat "$HOME/Library/Application Support/vibechemy-dev/mcp-token"
```

For a packaged build, use:

```bash
cat "$HOME/Library/Application Support/vibechemy/mcp-token"
```

Treat the token like a password. Do not commit it, paste it into an issue, or expose the MCP port
beyond your machine. The server binds to `127.0.0.1`.

MCP client configuration formats differ. Use the client's vendor documentation for the exact place
to enter a Streamable HTTP URL and authorization header. After connecting, confirm the client can
list Vibechemy tools and call `list_projects` before you rely on it as an orchestrator.

## 7. Troubleshooting

### Vibechemy says `tmux` is required

Install it and verify the binary:

```bash
brew install tmux
command -v tmux
tmux -V
```

Quit and relaunch Vibechemy after the command succeeds.

### A native module reports `NODE_MODULE_VERSION`

The native modules must be built for the process that loads them. For Vibechemy/Electron, run:

```bash
npm run rebuild:electron
npm run dev
```

For Node-based tests, rebuild for Node first:

```bash
npm run rebuild:node
npm test
```

If compilation fails before the ABI step, re-check `xcode-select -p` and `python3 --version`.

### A CLI works in Terminal but Vibechemy cannot find it

The roster card for that CLI shows **not installed**. A macOS GUI process can start with a smaller
`PATH` than your Terminal. Vibechemy asks your login shell for its path and also checks the common
Homebrew and `~/.local/bin` locations. Verify that the binary is visible to a login shell:

```bash
/bin/zsh -ilc 'command -v claude'
```

Replace `claude` with the missing binary. If that command fails, add the CLI's install directory to
your login-shell `PATH`, open a new Terminal, verify it again, and restart Vibechemy. For a custom
agent or Personal Agent, you can instead enter the binary's absolute path in its **Command** field.

### Port 4880 or 4881 is already in use

Find the process holding the relevant port:

```bash
lsof -nP -iTCP:4880 -sTCP:LISTEN
lsof -nP -iTCP:4881 -sTCP:LISTEN
```

Stop the conflicting process if it is safe to do so. To run this development checkout on another
port, set `MCP_PORT` when launching:

```bash
MCP_PORT=4891 npm run dev
```

Vibechemy regenerates its built-in lead configs with the override. External MCP clients must use
`http://127.0.0.1:4891/mcp` for that run.

### A summoned pane is waiting at a trust or first-run prompt

The pane is a real vendor terminal, so the vendor can pause before accepting Vibechemy's opening
briefing or task. Click the pane, read the prompt, and approve the repository only if you trust it.
Finish any first-run choice or login request. If the original task is still staged after that, press
Enter; if it disappeared, send the task again from the orchestrator or type it directly into the
worker pane.

## Operational checklist

You are fully operational when all of these are true:

- Vibechemy starts with `npm run dev` and shows no `tmux` or MCP-port error.
- Every agent chip you intend to use shows installed (and, where detectable, signed in) in
  **Settings → Agents** and has passed a test-prompt check.
- Your git repository is registered and selected as a workspace.
- A built-in orchestrator starts, reports ready, and can call `list_projects`.
- An isolated worker appears on a `vc/` branch and accepts follow-up instructions.
- **Review & merge** shows its diff and can merge approved work locally.
- Any configured Personal Agent can see the Vibechemy MCP tools through its external-client setup.

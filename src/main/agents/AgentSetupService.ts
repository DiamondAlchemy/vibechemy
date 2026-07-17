/**
 * Agent setup probing: asks THIS machine which agent CLIs exist and which are signed in.
 * Every probe runs through a LOGIN shell (`zsh -lc`) because the CLIs live in ~/.local/bin
 * and /opt/homebrew/bin — paths a GUI app's environment doesn't have.
 *
 * Read-only by design: install/login ACTIONS are executed by the renderer in a visible
 * terminal pane (vendor's own flows) — this service never runs installers and never
 * reads credential contents, only existence.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { AGENT_CATALOG, type AgentStatus } from '../../shared/agents/catalog'

const expand = (p: string): string => (p.startsWith('~') ? p.replace('~', homedir()) : p)

function loginShell(cmd: string, timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', cmd], { timeout }, (err, stdout) => resolve(err ? null : String(stdout).trim()))
  })
}

export class AgentSetupService {
  probeAll(): Promise<AgentStatus[]> {
    return Promise.all(
      AGENT_CATALOG.map(async (f): Promise<AgentStatus> => {
        const binPath = await loginShell(`command -v ${f.bin}`, 5_000)
        const installed = !!binPath
        // Version is best-effort decoration — a hanging/quirky CLI must never wedge the card.
        const version = installed ? await loginShell(`${f.bin} --version 2>/dev/null | head -1`, 8_000) : null
        let authed: boolean | null = null
        if (f.authFile) authed = existsSync(expand(f.authFile))
        else if (f.authCmd && installed) {
          const out = await loginShell(f.authCmd.cmd, 10_000)
          authed = out === null ? null : new RegExp(f.authCmd.ok, 'i').test(out)
        }
        return {
          id: f.id,
          title: f.title,
          bin: f.bin,
          presets: f.presets,
          installed,
          version: version || null,
          authed,
          install: f.install,
          login: f.login,
          note: f.note
        }
      })
    )
  }
}

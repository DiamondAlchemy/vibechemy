#!/usr/bin/env node
// npx vibechemy — download the latest Vibechemy release and launch it.
//
// What this does, in order: query GitHub Releases for the latest published release, read the
// electron-builder update feed (latest-mac.yml) attached to it, download the zip artifact,
// verify its sha512 against the feed, extract with ditto (preserves the app signature), and
// open the app. Installs live under ~/.vibechemy/app/<version>; once installed, this command
// just relaunches, and the app keeps ITSELF current afterward via its built-in auto-updater.
//
// Dependency-free by design: Node 18+ global fetch + node:crypto + ditto/open (macOS built-ins).

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { Readable } from 'node:stream'
import { parseMacFeed, pickZipAsset, assetUrl } from './lib.mjs'

const REPO = 'DiamondAlchemy/vibechemy' // pinned — never resolved from user input or redirects
const APP_ROOT = join(homedir(), '.vibechemy', 'app')
const OK_MARKER = '.install-ok'

function out(msg) {
  process.stdout.write(msg + '\n')
}

function fail(msg) {
  process.stderr.write('vibechemy: ' + msg + '\n')
  process.exit(1)
}

function printFromSource() {
  out('Run Vibechemy from source:')
  out('  git clone https://github.com/DiamondAlchemy/vibechemy.git')
  out('  cd vibechemy && npm ci        # 10-20 minutes: native modules compile')
  out('  npm run dev')
  out('Full guide: https://github.com/DiamondAlchemy/vibechemy/blob/main/GETTING-STARTED.md')
}

async function ghJson(url) {
  const res = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'vibechemy-launcher' }
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`)
  return res.json()
}

async function downloadTo(url, filePath) {
  const res = await fetch(url, { headers: { 'user-agent': 'vibechemy-launcher' } })
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`)
  const hash = createHash('sha512')
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk)
      cb(null, chunk)
    }
  })
  await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(filePath))
  return hash.digest('base64')
}

async function findApp(dir) {
  const entries = await readdir(dir)
  const app = entries.find((e) => e.endsWith('.app'))
  return app ? join(dir, app) : null
}

async function launch(appPath, version) {
  const res = spawnSync('open', [appPath], { stdio: 'inherit' })
  if (res.status !== 0) fail(`could not open ${appPath}`)
  out(`Vibechemy ${version} launched. It keeps itself up to date from here.`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    out('npx vibechemy            download (first run) and launch the latest release')
    out('npx vibechemy --from-source   print the run-from-source instructions instead')
    return
  }
  if (args.includes('--from-source')) {
    printFromSource()
    return
  }
  if (process.platform !== 'darwin') {
    out('Prebuilt Vibechemy releases currently target macOS on Apple Silicon.')
    printFromSource()
    process.exit(1)
  }
  if (process.arch !== 'arm64') {
    out('Prebuilt releases are Apple Silicon (arm64) only for now; this Mac reports ' + process.arch + '.')
    printFromSource()
    process.exit(1)
  }

  out('Checking the latest Vibechemy release…')
  const release = await ghJson(`https://api.github.com/repos/${REPO}/releases/latest`)
  const feedUrl = assetUrl(release, 'latest-mac.yml')
  if (!feedUrl) fail('latest release has no update feed (latest-mac.yml) — is a release published yet?')
  const feedRes = await fetch(feedUrl, { headers: { 'user-agent': 'vibechemy-launcher' } })
  if (!feedRes.ok) fail(`could not fetch update feed (${feedRes.status})`)
  const feed = parseMacFeed(await feedRes.text())
  if (!feed) fail('update feed did not parse — refusing to guess at artifacts')
  // The version becomes a filesystem path under APP_ROOT — validate strictly so a malformed
  // or hostile feed can never traverse (rm/rename below are destructive).
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(feed.version))
    fail(`update feed carries an invalid version string (${JSON.stringify(feed.version)})`)
  const zip = pickZipAsset(feed, 'arm64')
  if (!zip) fail('no arm64 zip artifact in the update feed')

  const installDir = join(APP_ROOT, feed.version)
  const marker = join(installDir, OK_MARKER)
  const already = await stat(marker).then(() => true, () => false)
  if (already) {
    const appPath = await findApp(installDir)
    if (appPath) {
      out(`Vibechemy ${feed.version} is already installed.`)
      await launch(appPath, feed.version)
      return
    }
    await rm(installDir, { recursive: true, force: true }) // marker without app = broken install
  }

  const zipUrl = assetUrl(release, zip.url)
  if (!zipUrl) fail(`release is missing the artifact named in its own feed (${zip.url})`)
  out(`Downloading Vibechemy ${feed.version} (~230 MB)…`)
  await mkdir(APP_ROOT, { recursive: true })
  // In-flight failures below THROW (never process.exit) so the finally sweep always runs —
  // a checksum mismatch or bad zip must not litter ~230 MB temp files (review 2026-07-28).
  const tmpZip = join(APP_ROOT, `.download-${process.pid}.zip`)
  const tmpDir = join(APP_ROOT, `.extract-${process.pid}`)
  try {
    const digest = await downloadTo(zipUrl, tmpZip)
    if (digest !== zip.sha512)
      throw new Error('checksum mismatch — the download does not match the release feed; not installing')

    out('Verified. Installing…')
    await rm(tmpDir, { recursive: true, force: true })
    await mkdir(tmpDir, { recursive: true })
    const ditto = spawnSync('ditto', ['-x', '-k', tmpZip, tmpDir], { stdio: 'pipe' })
    if (ditto.status !== 0) throw new Error('extraction failed: ' + String(ditto.stderr))
    const extractedApp = await findApp(tmpDir)
    if (!extractedApp) throw new Error('no .app found in the release zip')
    await rm(installDir, { recursive: true, force: true })
    await rename(tmpDir, installDir)
    await writeFile(marker, new Date().toISOString() + '\n')

    const appPath = await findApp(installDir)
    if (!appPath) throw new Error('install finished but the app is missing — please retry')
    await launch(appPath, feed.version)
  } finally {
    await rm(tmpZip, { force: true })
    // Renamed-away on success (no-op); a failed extract's litter comes off here.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))

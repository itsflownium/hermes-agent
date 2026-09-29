import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileDigest, treeDigest, preparationRequired } from './prepared-packaging.mjs'
import { hudModifierBinaryRelativePath } from './build-hud-modifier-monitor.mjs'

/** Windows preparation must not certify an absent executable as a valid tree.
 * Linux's helper remains optional when X11 development libraries are absent.
 * @param {{ nativeDeps: string, platform: string, arch: string }} inputs
 */
function requireWindowsHudHelper({ nativeDeps, platform, arch }) {
  if (platform !== 'win32') return
  const helper = path.join(nativeDeps, hudModifierBinaryRelativePath(platform, arch))
  try {
    if (fs.readFileSync(helper).length === 0) throw new Error('empty file')
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw preparationRequired(`Windows HUD modifier helper is missing or unreadable: ${helper} (${detail}). ` +
      'If it disappears after a successful build, check Windows Security Protection History or other security software')
  }
}

/** @typedef {{ source: string, nativeDeps: string, platform?: string, arch?: string, nativeToolchain?: string }} NativeSelection */
/** @param {string} source @returns {string} */
function nativeIdentity(source) {
  return createHash('sha256').update(JSON.stringify([
    fileDigest(path.join(source, 'package-lock.json')),
    fileDigest(path.join(source, 'apps/desktop/package.json')),
    fileDigest(path.join(import.meta.dirname, 'stage-native-deps.mjs')),
    fileDigest(path.join(import.meta.dirname, 'prepared-native-deps.mjs')),
    ...['build-command-screenshot-monitor.mjs', 'build-hud-modifier-monitor.mjs']
      .map(name => fileDigest(path.join(import.meta.dirname, name))),
    ...['command-screenshot-monitor.m', 'hud-modifier-gesture.h', 'hud-modifier-gesture.cs',
      'hud-modifier-monitor.m', 'hud-modifier-monitor-win.cs', 'hud-modifier-monitor-x11.c']
      .map(name => fileDigest(path.join(source, 'apps/desktop/electron/native', name))),
  ])).digest('hex')
}

/**
 * The sidecar stays outside node_modules so it never ships in the application.
 * @param {{ source: string, out: string, platform: string, arch: string, nativeToolchain?: string }} inputs
 * @returns {void}
 */
export function recordNativeInputs({ source, out, platform, arch, nativeToolchain }) {
  requireWindowsHudHelper({ nativeDeps: out, platform, arch })
  fs.writeFileSync(`${out}.prepared.json`, JSON.stringify({
    schema: 1, source: fs.realpathSync(source), out: fs.realpathSync(out),
    platform, arch, nativeToolchain, identity: nativeIdentity(source), digest: treeDigest(out),
  }) + '\n')
}

/** @param {NativeSelection} inputs @returns {string} */
export function readNativeInputs({ source, nativeDeps, platform = process.platform, arch = process.arch, nativeToolchain }) {
  try {
    const record = JSON.parse(fs.readFileSync(`${nativeDeps}.prepared.json`, 'utf8'))
    requireWindowsHudHelper({ nativeDeps, platform, arch })
    if (record.schema !== 1 || record.source !== fs.realpathSync(source) || record.out !== fs.realpathSync(nativeDeps) ||
        record.platform !== platform || record.arch !== arch ||
        (nativeToolchain !== undefined && record.nativeToolchain !== nativeToolchain) ||
        record.identity !== nativeIdentity(source) || record.digest !== treeDigest(nativeDeps)) {
      throw preparationRequired('Stale or foreign native inputs')
    }
    if (!fs.statSync(path.join(nativeDeps, 'node-pty/package.json')).isFile()) throw preparationRequired('Missing prepared node-pty')
    return record.out
  } catch (error) {
    throw preparationRequired(`Cannot consume native inputs: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** @param {NativeSelection & { out: string }} inputs @returns {void} */
export function copyNativeInputs({ out, ...inputs }) {
  copyNativeTree({ ...inputs, nativeDeps: readNativeInputs(inputs), out })
}

/** Copy admitted modules and executable resources without rebuilding either.
 * @param {{ nativeDeps: string, out: string, platform?: string, arch?: string }} inputs out is the product's node_modules.
 * @returns {void}
 */
export function copyNativeTree({ nativeDeps, out, platform = process.platform, arch = process.arch }) {
  nativeDeps = fs.realpathSync(nativeDeps)
  requireWindowsHudHelper({ nativeDeps, platform, arch })
  const destination = path.resolve(out)
  const helpers = path.join(path.dirname(destination), 'native')
  for (const target of [destination, helpers]) {
    if (target === nativeDeps || target.startsWith(nativeDeps + path.sep) || nativeDeps.startsWith(target + path.sep)) {
      throw preparationRequired('Native input and product directories overlap')
    }
  }
  fs.rmSync(destination, { recursive: true, force: true })
  fs.rmSync(helpers, { recursive: true, force: true })
  const preparedHelpers = path.join(nativeDeps, 'native')
  fs.cpSync(nativeDeps, destination, { recursive: true, dereference: true,
    filter: file => file !== preparedHelpers })
  if (fs.existsSync(preparedHelpers)) fs.cpSync(preparedHelpers, helpers, { recursive: true, dereference: true })
  requireWindowsHudHelper({ nativeDeps: path.dirname(destination), platform, arch })
}

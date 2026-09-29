import assert from 'node:assert/strict'
import { test } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { builderNodeOptions, runElectronBuilder, runSourceBuilds } from './run-electron-builder.mjs'
import fs from 'node:fs'
import os from 'node:os'
import { publishPackagingInputs } from './prepared-packaging.mjs'
import { recordNativeInputs, readNativeInputs, copyNativeInputs } from './prepared-native-deps.mjs'
import { hudModifierBinaryRelativePath } from './build-hud-modifier-monitor.mjs'

test('validate-only admits real prepared inputs without launching tools and rejects unsafe arguments', async () => {
  const source = path.resolve(import.meta.dirname, '../../..')
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-validation-'))
  try {
    const electron = path.join(out, 'electron.zip')
    fs.writeFileSync(electron, 'fixture archive')
    const toolsets = { sevenZip: path.join(out, 'sevenZip'), icons: path.join(out, 'icons') }
    for (const dir of Object.values(toolsets)) fs.mkdirSync(dir)
    const manifest = await publishPackagingInputs({ source, out, target: `${process.platform}-${process.arch}`, formats: ['dir'], electron, toolsets })
    const nativeDeps = path.join(out, 'native')
    fs.mkdirSync(path.join(nativeDeps, 'node-pty'), { recursive: true })
    fs.writeFileSync(path.join(nativeDeps, 'node-pty/package.json'), '{}')
    if (process.platform === 'win32') {
      const helper = path.join(nativeDeps, hudModifierBinaryRelativePath())
      fs.mkdirSync(path.dirname(helper), { recursive: true })
      fs.writeFileSync(helper, 'helper fixture')
    }
    recordNativeInputs({ source, out: nativeDeps, platform: process.platform, arch: process.arch })
    const args = ['--validate-only', '--prepared', manifest, '--native-deps', nativeDeps, '--dir']
    const options = { spawn: () => { throw new Error('validation must not launch tools') } }
    assert.equal(runElectronBuilder(args, options), 0)
    assert.throws(() => runElectronBuilder([...args, '-c.npmRebuild=true'], options), /not admitted/)
    assert.throws(() => runElectronBuilder(['--validate-only'], options), /--prepared/)
    const cli = spawnSync(process.execPath, [path.join(import.meta.dirname, 'run-electron-builder.mjs'), ...args], { encoding: 'utf8' })
    assert.equal(cli.status, 0, cli.stderr)
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
})

test('source packaging repairs damaged native preparation once and leaves explicit inputs consume-only', () => {
  const source = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'source-native-repair-')))
  try {
    const app = path.join(source, 'apps/desktop')
    const nativeDeps = path.join(app, 'build/native-deps')
    fs.mkdirSync(path.join(nativeDeps, 'node-pty'), { recursive: true })
    fs.writeFileSync(path.join(nativeDeps, 'node-pty/package.json'), '{}')
    fs.writeFileSync(path.join(source, 'package-lock.json'), '{}')
    fs.writeFileSync(path.join(app, 'package.json'), '{}')
    fs.cpSync(path.join(import.meta.dirname, '../electron/native'), path.join(app, 'electron/native'), { recursive: true })
    const selection = { source, nativeDeps, platform: process.platform, arch: process.arch }
    const helper = path.join(nativeDeps, hudModifierBinaryRelativePath())
    const prepare = () => {
      fs.mkdirSync(path.dirname(helper), { recursive: true })
      fs.writeFileSync(helper, 'prepared executable bytes')
      recordNativeInputs({ ...selection, out: nativeDeps })
    }
    prepare()
    const calls = []
    const spawn = (_node, argv) => {
      const command = path.basename(argv[0])
      calls.push(command)
      if (command === 'stage-native-deps.mjs') prepare()
      if (command === 'run-electron-builder.mjs') {
        readNativeInputs(selection)
        copyNativeInputs({ ...selection, out: path.join(app, 'dist/node_modules') })
      }
      return { status: 0 }
    }
    const run = native => runSourceBuilds(['--dir'], native, spawn, source)
    assert.equal(run(), 0)
    assert.equal(calls.includes('stage-native-deps.mjs'), false)
    for (const damage of [() => fs.rmSync(helper), () => fs.writeFileSync(helper, 'changed bytes')]) {
      damage()
      calls.length = 0
      assert.equal(run(), 0)
      assert.deepEqual(calls, ['stage-native-deps.mjs', 'prepare-packaging-tools.mjs', 'run-electron-builder.mjs'])
      assert.deepEqual(fs.readFileSync(path.join(app, 'dist', hudModifierBinaryRelativePath())), fs.readFileSync(helper))
    }
    fs.rmSync(helper)
    calls.length = 0
    assert.throws(() => run(nativeDeps), /native inputs|Windows HUD modifier helper/)
    assert.equal(calls.includes('stage-native-deps.mjs'), false)
    const failed = []
    assert.equal(runSourceBuilds(['--dir'], undefined,
      (_node, argv) => { failed.push(path.basename(argv[0])); return { status: 7 } }, source), 7)
    assert.deepEqual(failed, ['stage-native-deps.mjs'])
  } finally {
    fs.rmSync(source, { recursive: true, force: true })
  }
})

test('source multiarch prepares isolated native and packaging inputs before each strict invocation', () => {
  const calls = []
  const spawn = (_node, args) => { calls.push(args); return { status: 0 } }
  assert.equal(runElectronBuilder(['--mac', '--x64', '--arm64', '--dir'], { spawn }), 0)
  for (const arch of ['x64', 'arm64']) {
    const native = calls.find(args => args[0].endsWith('stage-native-deps.mjs') && args.includes(arch))
    assert.ok(native)
    assert.equal(native[native.indexOf('--platform') + 1], 'darwin')
    const prepare = calls.find(args => args[0].endsWith('prepare-packaging-tools.mjs') && args.includes(`darwin-${arch}`))
    assert.ok(prepare)
    const strict = calls.find(args => args[0].endsWith('run-electron-builder.mjs') && args.includes(`--${arch}`))
    assert.ok(strict)
    assert.equal(strict[strict.indexOf('--prepared') + 1], path.join(prepare[prepare.indexOf('--out') + 1], 'prepared.json'))
    assert.equal(strict[strict.indexOf('--native-deps') + 1], native[native.indexOf('--out') + 1])
    assert.equal(strict.filter(arg => ['--x64', '--arm64'].includes(arg)).length, 1)
  }
  assert.equal(calls.length, 6)
  assert.notEqual(calls[0][calls[0].indexOf('--out') + 1], calls[3][calls[3].indexOf('--out') + 1])
  calls.length = 0
  assert.equal(runElectronBuilder(['--dir'], { spawn }), 0)
  assert.equal(calls.filter(args => args[0].endsWith('prepare-packaging-tools.mjs')).length, 1)
  assert.equal(calls.filter(args => args[0].endsWith('run-electron-builder.mjs')).length, 1)
  assert.throws(() => runElectronBuilder(['--mac', '--universal'], { spawn }), /No prepared universal native payload/)
  assert.equal(runElectronBuilder(['--mac', '--x64', '--arm64'], { spawn: () => ({ status: 7 }) }), 7)
})

test('strict builder refuses absent inputs before loading electron-builder', () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'run-electron-builder.mjs'),
    '--prepared', path.join(import.meta.dirname, 'missing-prepared.json'), '--native-deps', 'missing', '--dir'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /run preparation again/)
  assert.doesNotMatch(result.stdout, /electron-builder\s+version/)
})

test('npm run builder forwards an apostrophe path to the wrapper verbatim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-'))
  const manifest = path.join(root, "r'y'z", 'missing.json')
  const windows = process.platform === 'win32'
  try {
    // Windows needs a shell for npm.cmd, which joins argv unquoted.
    const result = spawnSync('npm', ['run', 'builder', '--silent', '--ignore-scripts', '--',
      '--prepared', windows ? `"${manifest}"` : manifest, '--native-deps', 'missing', '--dir'],
    { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8', shell: windows })
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes(manifest), result.stderr)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('source builds hand every child the builder heap without rewriting inherited NODE_OPTIONS', () => {
  const calls = []
  const spawn = (_node, args, options) => { calls.push({ args, options }); return { status: 0 } }
  assert.equal(runElectronBuilder(['--dir'], { spawn }), 0)
  assert.ok(calls.length >= 2)
  const heap = /--max-old-space-size=16384$/
  for (const { options } of calls) assert.match(options.env.NODE_OPTIONS, heap)
  assert.match(builderNodeOptions(''), heap)
  assert.match(builderNodeOptions('--max-old-space-size=4096'), heap)
  const quoted = '--require "/tmp/sp  ace/p.cjs"'
  assert.ok(builderNodeOptions(quoted).startsWith(quoted))
  assert.match(builderNodeOptions('--max-old-space-size=16384 --max-old-space-size=4096'), heap)
})

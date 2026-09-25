'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

const { resolveCommand, unwrapShim, runCommand } = require('../discovery/spawn');

function fakeIo(files) {
  return {
    fileExists: (p) => Boolean(files[String(p).replace(/\\/g, '/')]),
    readFile: (p) => {
      const key = String(p).replace(/\\/g, '/');
      if (!files[key]) throw new Error('ENOENT');
      return files[key];
    },
  };
}

test('a .exe on PATH is executed directly', () => {
  const dir = path.join(os.tmpdir(), 'bin');
  const io = fakeIo({ [path.join(dir, 'agy.exe').replace(/\\/g, '/')]: Buffer.alloc(0) });
  const out = resolveCommand('agy', { platform: 'win32', path: dir, ...io });
  assert.equal(out.kind, 'exe');
  assert.equal(out.file.endsWith('agy.exe'), true);
  assert.deepEqual(out.args, []);
});

test('an npm .cmd shim is unwrapped to its real node_modules target', () => {
  const npmDir = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm');
  const cmd = npmDir + '\\opencode.cmd';
  const target = npmDir + '\\node_modules\\opencode-ai\\bin\\opencode.exe';
  const io = fakeIo({
    [cmd.replace(/\\/g, '/')]:
      '@echo off\r\n"%_prog%" "%dp0%\\node_modules\\opencode-ai\\bin\\opencode.exe" %*\r\n',
    [target.replace(/\\/g, '/')]: Buffer.alloc(0),
  });
  const out = resolveCommand('opencode', { platform: 'win32', path: npmDir, ...io });
  assert.equal(out.kind, 'exe');
  assert.equal(out.file.replace(/\\/g, '/'), target.replace(/\\/g, '/'));
});

test('an npm .ps1 shim is unwrapped to its real node script', () => {
  const npmDir = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm');
  const ps1 = npmDir + '\\qwen.ps1';
  const target = npmDir + '\\node_modules\\@qwen-code\\qwen-code\\cli-entry.js';
  const io = fakeIo({
    [ps1.replace(/\\/g, '/')]:
      '& "$basedir/node_modules/@qwen-code/qwen-code/cli-entry.js" $args\n',
    [target.replace(/\\/g, '/')]: '// script',
  });
  const out = resolveCommand('qwen', { platform: 'win32', path: npmDir, ...io });
  assert.equal(out.kind, 'node-script');
  assert.equal(out.file, process.execPath);
  assert.equal(out.args[0].replace(/\\/g, '/'), target.replace(/\\/g, '/'));
});

test('a .cmd shim whose target is missing still resolves but is flagged', () => {
  const npmDir = path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'npm');
  const cmd = npmDir + '\\ghost.cmd';
  const io = fakeIo({
    [cmd.replace(/\\/g, '/')]: '"%_prog%" "%dp0%\\node_modules\\ghost\\main.js" %*',
  });
  const out = resolveCommand('ghost', { platform: 'win32', path: npmDir, ...io });
  assert.equal(out.kind, 'shim-unreadable');
});

test('an unknown command is reported ENOENT, distinct from a failed run', () => {
  const io = fakeIo({});
  const out = resolveCommand('nope', { platform: 'win32', path: 'C:/nope', ...io });
  assert.equal(out.error, 'ENOENT');
});

test('non-win32 platforms run the command directly', () => {
  const out = resolveCommand('opencode', { platform: 'linux', fileExists: () => false });
  assert.equal(out.kind, 'direct');
});

test('unwrapShim picks the node_modules reference that actually exists, not bare node', () => {
  const npmDir = path.join(os.tmpdir(), 'npm-shim-test');
  const ps1 = npmDir + '\\complex.ps1';
  const io = fakeIo({
    [ps1.replace(/\\/g, '/')]: '& "$basedir/node_modules/esbuild/bin/esbuild.exe" $args\n',
    [npmDir.replace(/\\/g, '/') + '/node_modules/esbuild/bin/esbuild.exe']: Buffer.alloc(0),
  });
  assert.equal(
    unwrapShim(ps1, io).replace(/\\/g, '/'),
    (npmDir + '/node_modules/esbuild/bin/esbuild.exe').replace(/\\/g, '/')
  );
});

test('runCommand honors an injectable spawn and reports outputs in order', async () => {
  const calls = [];
  const fakeSpawn = (file, args, opts) => {
    calls.push({ file, args, opts });
    return {
      stdout: { on: (ev, cb) => ev === 'data' && cb('hello') },
      stderr: { on: () => {} },
      on: (ev, cb) => ev === 'close' && cb(0, null),
      kill: () => {},
    };
  };
  const out = await runCommand('fake', ['--json'], {
    platform: 'linux',
    spawn: fakeSpawn,
    timeoutMs: 500,
  });
  assert.equal(calls.length, 1);
  assert.equal(out.exitCode, 0);
  assert.equal(out.stdout, 'hello');
});

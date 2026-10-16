'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runAcpTurn } = require('../hermes-acp');

// Real stdio subprocess, no Hermes runtime, provider, credentials or network.
const fake = String.raw`
const readline = require('node:readline');
const mode = process.argv[1];
const send = (m) => process.stdout.write(JSON.stringify({jsonrpc:'2.0', ...m})+'\n');
let permission = false;
readline.createInterface({input:process.stdin}).on('line', line => {
  const m = JSON.parse(line);
  const reply = result => send({id:m.id,result});
  if (m.method === 'initialize') {
    if(mode === 'hang') return;
    if(mode === 'crash') process.exit(2);
    if(mode === 'badjson') return process.stdout.write('SECRET-not-json\n');
    if(mode === 'oversize') return process.stdout.write('x'.repeat(1024*1024+1));
    if(mode === 'rpcerror') return send({id:m.id,error:{code:-32000,message:'SECRET'}});
    return reply({protocolVersion:1});
  }
  if(m.method === 'session/new') return reply({sessionId:'s1',models:{currentModelId:mode === 'wrongmodel' ? 'other:chosen' : 'router:chosen'}});
  if(m.method === 'session/prompt') {
    if(mode === 'wrongmodel') process.exit(5);
    const event = (id,update) => send({method:'session/update',params:{sessionId:id,update}});
    event('other-session',{sessionUpdate:'agent_message_chunk',content:{text:'SECRET'}});
    event('s1',{sessionUpdate:'agent_thought_chunk',content:{text:'SECRET'}});
    event('s1',{sessionUpdate:'tool_call',status:'in_progress',rawInput:{token:'SECRET'}});
    event('s1',{sessionUpdate:'tool_call_update',status:'completed',rawOutput:'SECRET'});
    event('s1',{sessionUpdate:'usage_update',used:123,size:999});
    if(mode === 'permission') {
      permission = m.id;
      send({id:100,method:'session/request_permission',params:{sessionId:'s1',options:[{optionId:'allow',kind:'allow_always'}]}});
      return;
    }
    return reply({stopReason:mode === 'cancel' ? 'cancelled' : mode === 'refuse' ? 'refusal' : mode === 'unknown' ? 'bogus' : 'end_turn'});
  }
  if(m.id === 100 && permission) {
    if(m.result?.outcome?.outcome !== 'cancelled') process.exit(6);
    send({id:permission,result:{stopReason:'end_turn'}});
  }
});
`;

function run(mode, overrides = {}) {
  const events = [];
  const promise = runAcpTurn(process.execPath, ['-e', fake, mode], {
    cwd: process.cwd(),
    prompt: 'private prompt SECRET',
    modelId: 'chosen',
    providerName: 'router',
    timeoutMs: 3000,
    onStatus: (status) => events.push(status),
    ...overrides,
  });
  return { events, promise };
}

test('ACP subprocess streams scoped lifecycle events and strips sensitive content', async () => {
  const { events, promise } = run('ok');
  const result = await promise;
  assert.equal(result.state, 'turn_ended');
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.eventCount, 4);
  assert.equal(result.contextUsed, 123);
  assert.equal(result.toolStatus, 'completed');
  assert.equal(JSON.stringify(events).includes('SECRET'), false);
  assert.ok(events.some((s) => s.state === 'running'));
});

test('ACP permission requests are denied while the transport remains responsive', async () => {
  assert.equal((await run('permission').promise).state, 'turn_ended');
});

for (const [mode, error] of [
  ['wrongmodel', 'ACP_MODEL_BINDING_UNVERIFIED'],
  ['crash', 'ACP_PROCESS_CLOSED'],
  ['badjson', 'ACP_INVALID_JSON'],
  ['oversize', 'ACP_FRAME_TOO_LARGE'],
  ['rpcerror', 'ACP_RPC_ERROR_-32000'],
  ['unknown', 'ACP_STOP_REASON_UNRECOGNIZED'],
]) {
  test(`ACP ${mode} fails closed without provider output in the error`, async () => {
    const { events, promise } = run(mode);
    await assert.rejects(promise, { message: error });
    assert.equal(events.at(-1).state, 'failed');
    assert.equal(JSON.stringify(events).includes('SECRET'), false);
  });
}

test('ACP timeout closes a hung process and reports failure', async () => {
  await assert.rejects(run('hang', { timeoutMs: 150 }).promise, { message: 'ACP_TIMEOUT' });
});

for (const [mode, expected] of [
  ['cancel', 'cancelled'],
  ['refuse', 'refused'],
]) {
  test(`ACP ${mode} is never reported as a completed turn`, async () => {
    assert.equal((await run(mode).promise).state, expected);
  });
}

test('ACP missing prompt refuses before launching a process', async () => {
  await assert.rejects(run('ok', { prompt: '' }).promise, /ACP_PROMPT_REQUIRED/);
});

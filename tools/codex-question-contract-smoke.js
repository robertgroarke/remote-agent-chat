#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CodexQuestionBridge,
  validateGeneratedQuestionSchemas,
} = require('../agent-proxy/codex-question-bridge');
const {
  advanceQuestionLifecycle,
  canonicalQuestionPrompt,
  canonicalQuestionResponse,
  publicQuestionResponse,
} = require('../shared/question-prompt-contract');

const repoRoot = path.resolve(__dirname, '..');
const fixturePath = path.join(repoRoot, 'tests', 'fixtures', 'codex-app-server', '0.144.4', 'request-user-input-contract.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

function codexInvocation() {
  if (process.env.CODEX_CLI_PATH) return { command: process.env.CODEX_CLI_PATH, prefix: [] };
  if (process.platform === 'win32' && process.env.APPDATA) {
    const npmEntrypoint = path.join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (fs.existsSync(npmEntrypoint)) return { command: process.execPath, prefix: [npmEntrypoint] };
  }
  return { command: 'codex', prefix: [] };
}

function runCodex(args, timeout) {
  const invocation = codexInvocation();
  return spawnSync(invocation.command, [...invocation.prefix, ...args], {
    windowsHide: true,
    encoding: 'utf8',
    timeout,
  });
}

function installedCodexVersion() {
  const result = runCodex(['--version'], 10000);
  assert.strictEqual(result.status, 0, `codex --version failed: ${result.stderr || result.stdout}`);
  const match = String(result.stdout || '').match(/(\d+\.\d+\.\d+)/);
  assert.ok(match, `could not parse Codex version: ${result.stdout}`);
  return match[1];
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function generatedSchemaDir() {
  const supplied = process.argv.find(arg => arg.startsWith('--schema-dir='));
  if (supplied) return path.resolve(supplied.slice('--schema-dir='.length));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-question-schema-'));
  const result = runCodex(['app-server', 'generate-json-schema', '--experimental', '--out', out], 30000);
  assert.strictEqual(result.status, 0, `schema generation failed: ${result.stderr || result.stdout}`);
  return out;
}

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code, `expected ${code}`);
}

const schemaDir = generatedSchemaDir();
const codexCliVersion = installedCodexVersion();
const schemaResult = validateGeneratedQuestionSchemas(schemaDir);
assert.strictEqual(schemaResult.ok, true);
assert.strictEqual(schemaResult.method, fixture.method);
for (const [name, expected] of Object.entries(fixture.generated_schema_sha256)) {
  if (codexCliVersion === fixture.codex_cli_version) {
    assert.strictEqual(sha256(path.join(schemaDir, name)), expected, `${name} drifted without a version change`);
  }
}

const nativeRequest = {
  id: 'connection-request-47',
  method: 'item/tool/requestUserInput',
  params: {
    threadId: 'thread-a',
    turnId: 'turn-b',
    itemId: 'item-c',
    autoResolutionMs: 60000,
    questions: [
      {
        id: 'deploy',
        header: 'Deploy',
        question: 'Which environment?',
        options: [
          { label: 'Staging', description: 'Deploy to staging.' },
          { label: 'Production', description: 'Deploy to production.' }
        ],
        isOther: true,
        isSecret: false
      },
      {
        id: 'token',
        header: 'Token',
        question: 'Enter the one-time token.',
        options: null,
        isOther: false,
        isSecret: true
      }
    ]
  }
};
const bridge = new CodexQuestionBridge({
  sessionId: 'codex-cli-session',
  surface: 'codex_cli',
  version: codexCliVersion,
  connectionGeneration: 'connection-generation-a',
  now: () => Date.parse('2026-07-15T12:00:00.000Z'),
});
const prompt = bridge.open(nativeRequest);
assert.strictEqual(prompt.type, 'question_prompt');
assert.strictEqual(prompt.kind, 'request_user_input');
assert.strictEqual(prompt.lifecycle, 'open');
assert.strictEqual(prompt.contains_secret, true);
assert.strictEqual(prompt.questions[0].choices.at(-1).label, 'Other');
assert.strictEqual(prompt.questions[0].choices.at(-1).requires_text, true);
assert.ok(!JSON.stringify(prompt).includes('connection-request-47'), 'connection request ID leaked into canonical prompt');
assert.deepStrictEqual(canonicalQuestionPrompt(prompt), prompt, 'canonical prompt normalization must be idempotent');

const staging = prompt.questions[0].choices.find(choice => choice.label === 'Staging');
const canonical = canonicalQuestionResponse(prompt, {
  prompt_id: prompt.prompt_id,
  session_id: prompt.session_id,
  generation: prompt.generation,
  answers: [
    { question_id: 'deploy', choice_ids: [staging.choice_id] },
    { question_id: 'token', text: 'secret-value-that-must-not-leak' }
  ]
});
const receipt = publicQuestionResponse(canonical);
assert.ok(!JSON.stringify(receipt).includes('secret-value-that-must-not-leak'));
const nativeResponse = bridge.buildResponse(canonical);
assert.deepStrictEqual(nativeResponse, {
  id: 'connection-request-47',
  result: {
    answers: {
      deploy: { answers: ['Staging'] },
      token: { answers: ['secret-value-that-must-not-leak'] }
    }
  },
  prompt_id: prompt.prompt_id,
  generation: prompt.generation,
});
expectCode(() => bridge.buildResponse(canonical), 'prompt_already_claimed');
assert.deepStrictEqual(bridge.confirmWritten(prompt.prompt_id), { prompt_id: prompt.prompt_id, lifecycle: 'answered' });

const staleBridge = new CodexQuestionBridge({
  sessionId: 'codex-cli-session', surface: 'codex_cli', version: fixture.codex_cli_version,
  connectionGeneration: 'connection-generation-b',
});
const stalePrompt = staleBridge.open({
  ...nativeRequest,
  id: 99,
  params: { ...nativeRequest.params, autoResolutionMs: null, questions: [nativeRequest.params.questions[0]] },
});
const staleChoice = stalePrompt.questions[0].choices[0];
expectCode(() => staleBridge.buildResponse({
  prompt_id: stalePrompt.prompt_id,
  session_id: stalePrompt.session_id,
  generation: prompt.generation,
  answers: [{ question_id: 'deploy', choice_ids: [staleChoice.choice_id] }],
}), 'stale_generation');
assert.strictEqual(staleBridge.disconnect()[0].error_code, 'adapter_disconnected');
expectCode(() => staleBridge.buildResponse({}), 'adapter_disconnected');

const legacyPrompt = canonicalQuestionPrompt({
  prompt_id: 'legacy-adapter', session_id: 'session', generation: 'generation',
  kind: 'request_user_input', source: { surface: 'codex', version: 'fixture' },
  questions: [{ id: 'free', header: 'Free text', question: 'Say something.', options: null }],
});
expectCode(() => canonicalQuestionResponse(legacyPrompt, {
  prompt_id: 'legacy-adapter', session_id: 'wrong', generation: 'generation',
  answers: [{ question_id: 'free', text: 'hello' }],
}), 'wrong_session');
assert.strictEqual(advanceQuestionLifecycle('open', 'submitting'), 'submitting');
expectCode(() => advanceQuestionLifecycle('submitting', 'open'), 'invalid_lifecycle_transition');
expectCode(() => advanceQuestionLifecycle('answered', 'open'), 'terminal_prompt');

const incompatibleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rac-codex-question-schema-bad-'));
for (const name of ['ToolRequestUserInputParams.json', 'ToolRequestUserInputResponse.json', 'ServerRequest.json']) {
  fs.copyFileSync(path.join(schemaDir, name), path.join(incompatibleDir, name));
}
const incompatible = JSON.parse(fs.readFileSync(path.join(incompatibleDir, 'ToolRequestUserInputParams.json'), 'utf8'));
incompatible.required.push('futureRequiredField');
fs.writeFileSync(path.join(incompatibleDir, 'ToolRequestUserInputParams.json'), JSON.stringify(incompatible));
expectCode(() => validateGeneratedQuestionSchemas(incompatibleDir), 'schema_incompatible');

console.log(JSON.stringify({
  result: 'PASS',
  codex_cli_version: codexCliVersion,
  fixture_version: fixture.codex_cli_version,
  schema_method: schemaResult.method,
  exact_native_request_id: true,
  duplicate_native_response_rejected: true,
  stale_generation_rejected: true,
  reconnect_fail_closed: true,
  secret_receipt_redacted: true,
  incompatible_schema_rejected: true,
}, null, 2));

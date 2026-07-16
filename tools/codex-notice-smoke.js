#!/usr/bin/env node
'use strict';

const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');
const { listCdpTargets, connectCdpTarget } = require('../agent-proxy/cdp-loopback');

const PORT = 9225;
const FIXTURE_ID = 'remote-agent-chat-codex-notice-fixture';
const QUEUED_TEXT = 'A deliberately long queued Codex message that must remain fully visible in the remote web UI without an ellipsis or an eighty character cutoff.';

function assert(condition, message, detail) {
  if (!condition) {
    const error = new Error(message);
    if (detail !== undefined) error.detail = detail;
    throw error;
  }
  console.log(`PASS ${message}`);
}

async function evaluate(Runtime, expression) {
  const result = await Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result?.value;
}

async function main() {
  const targets = await listCdpTargets(CDP, { port: PORT });
  const target = targets.find(item => item.type === 'page' && String(item.url || '').startsWith('app://'));
  assert(!!target, 'Codex Desktop target is reachable on port 9225');

  const client = await connectCdpTarget(CDP, {
    port: PORT,
    host: target._cdpHost,
    target: target.id,
  });
  try {
    await client.Runtime.enable();
    const baseline = await selectors.detectSessionErrorPrompt(client.Runtime, 'codex-desktop');
    console.log(`INFO live baseline notice=${baseline ? baseline.title : 'none'}`);

    await evaluate(client.Runtime, `(() => {
      document.getElementById(${JSON.stringify(FIXTURE_ID)})?.remove();
      delete document.body.dataset.codexNoticeAction;
      const composer = document.querySelector('.ProseMirror');
      const composerTop = composer?.getBoundingClientRect?.().top || (window.innerHeight - 100);
      const host = document.createElement('div');
      host.id = ${JSON.stringify(FIXTURE_ID)};
      host.style.cssText = 'position:fixed;left:420px;top:' + Math.max(20, composerTop - 150) + 'px;width:660px;z-index:2147483647;background:white;color:black;padding:8px;';
      host.innerHTML = [
        '<div data-fixture="goal"><span>Pursuing goal</span><span>Restore Codex notice fidelity&#10;&#10;This deliberately long original prompt must not be forwarded as part of the compact goal objective.</span><span>8m 41s</span></div>',
        '<div class="overflow-visible" data-testid="queued-message"><span class="text-size-chat">' + ${JSON.stringify('A deliberately long queued Codex message that must remain fully visible in the remote web UI without an ellipsis or an eighty character cutoff.')} + '</span><button type="button">Steer</button><button type="button" aria-label="Delete queued message">x</button></div>',
        '<div role="status" aria-live="polite">',
        '<div>Our systems are thinking a bit more about this request before responding</div>',
        '<div>Hang tight or retry with a faster model for a quicker response, though it may be less capable of handling complex requests</div>',
        '<button type="button">Retry with faster model</button>',
        '<button type="button" aria-label="Dismiss safety checks banner">x</button>',
        '</div>',
      ].join('');
      host.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
        document.body.dataset.codexNoticeAction = button.getAttribute('aria-label') || button.textContent.trim();
      }));
      // Put the fixture first so a naturally active Codex goal surface cannot
      // win the selector's stable document-order tie during this isolated test.
      document.body.prepend(host);
      return true;
    })()`);

    const notice = await selectors.detectSessionErrorPrompt(client.Runtime, 'codex-desktop');
    assert(notice?.notice_kind === 'slow_response', 'slow-response notice is classified', notice);
    assert(notice?.display_mode === 'inline' && notice?.blocking === false, 'slow-response notice is a non-blocking inline status', notice);
    assert(notice?.actions?.some(action => action.action_id === 'retry_with_faster_model'), 'faster-model retry action is exposed', notice);
    assert(notice?.actions?.some(action => action.action_id === 'dismiss'), 'dismiss action is exposed', notice);

    const thinking = await selectors.detectThinking(client.Runtime, 'codex-desktop');
    assert(thinking?.goal?.status === 'active', 'Codex goal chip is classified as active', thinking);
    assert(thinking?.goal?.objective === 'Restore Codex notice fidelity', 'Codex goal objective is captured', thinking);
    assert(thinking?.goal?.time_used_seconds === 521, 'Codex goal elapsed time is captured', thinking);

    const queue = await selectors.readCodexNativeQueue(client.Runtime, true);
    assert(queue?.length === 1, 'native Codex queue item is detected', queue);
    assert(queue?.[0]?.text === QUEUED_TEXT, 'native Codex queue text is captured without truncation', queue);
    assert(queue?.[0]?.state === 'queued', 'native Codex queue state is captured', queue);

    const action = await selectors.respondToSessionErrorPrompt(
      client.Runtime,
      'codex-desktop',
      'retry_with_faster_model',
      'smoke-codex-desktop',
    );
    assert(action?.ok === true, 'faster-model retry action clicks through', action);
    const clicked = await evaluate(client.Runtime, 'document.body.dataset.codexNoticeAction || null');
    assert(clicked === 'Retry with faster model', 'native retry control received the click', clicked);
  } finally {
    await evaluate(client.Runtime, `document.getElementById(${JSON.stringify(FIXTURE_ID)})?.remove(); delete document.body.dataset.codexNoticeAction; true`).catch(() => {});
    await client.close().catch(() => {});
  }
}

withCodexDesktopCdpLock('codex-desktop-notice', main, { waitMs: 90000 }).catch(error => {
  console.error(`FAIL ${error.message}`);
  if (error.detail !== undefined) console.error(JSON.stringify(error.detail, null, 2));
  process.exit(1);
});

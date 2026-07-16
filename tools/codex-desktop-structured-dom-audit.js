#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const CDP = require('../agent-proxy/node_modules/chrome-remote-interface');
const selectors = require('../agent-proxy/selectors');
const codexCli = require('../agent-proxy/codex-cli');
const { ProxyEngine } = require('../agent-proxy/proxy-engine');
const {
  codexDesktopArchiveMessages,
  codexDesktopStructuredBlockCounts,
} = require('../agent-proxy/codex-desktop-archive');
const { withCodexDesktopCdpLock } = require('../agent-proxy/codex-desktop-cdp-lock');
const { listCdpTargets, connectCdpTarget } = require('../agent-proxy/cdp-loopback');
const { freshEvidencePath } = require('./evidence-path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.CODEX_DESKTOP_CDP_PORT || 9225);
const TARGET_THREAD = process.env.CODEX_DESKTOP_AUDIT_THREAD_ID
  || 'local:019f4b6a-f61c-7db3-ba89-284406bbeefe';
const OUTPUT = process.env.CODEX_DESKTOP_AUDIT_OUTPUT
  || freshEvidencePath(ROOT, 'codex-desktop-structured-dom-audit.json');

async function evaluate(Runtime) {
  const response = await Runtime.evaluate({
    expression: `(() => {
      const d = document;
      const convo = d.querySelector('[data-thread-find-target="conversation"]');
      if (!convo) return { ok: false, error: 'conversation-missing' };
      const text = el => String(el?.innerText || el?.textContent || '').trim();
      const className = el => typeof el?.className === 'string' ? el.className : '';
      const hash = value => {
        let result = 2166136261;
        for (const ch of String(value || '')) {
          result ^= ch.codePointAt(0);
          result = Math.imul(result, 16777619);
        }
        return (result >>> 0).toString(16).padStart(8, '0');
      };
      const labelKind = value => {
        const first = String(value || '').split('\\n')[0].trim();
        if (/^Worked for /i.test(first)) return 'worked';
        if (/^Working for /i.test(first)) return 'working';
        if (/^Ran /i.test(first)) return 'ran';
        if (/^(Edited|Created|Deleted) /i.test(first)) return 'file-change';
        if (/^(Read|Searched|Search) /i.test(first)) return 'read-search';
        if (/^Shell$/i.test(first)) return 'shell';
        if (/^(Copy|Undo|Review|Show more|Commit)$/i.test(first)) return 'chrome';
        return 'other';
      };
      const shallow = el => ({
        tag: el.tagName.toLowerCase(),
        class_name: className(el).slice(0, 500),
        data_testid: el.getAttribute('data-testid') || '',
        role: el.getAttribute('role') || '',
        aria_expanded: el.getAttribute('aria-expanded'),
        aria_label_kind: labelKind(el.getAttribute('aria-label') || ''),
        text_kind: labelKind(text(el)),
        first_token: (String(text(el)).split(/\\s+/)[0] || '').replace(/[^A-Za-z-]/g, '').slice(0, 24),
        text_length: text(el).length,
        text_hash: hash(text(el)),
      });
      const describe = el => {
        const result = shallow(el);
        const unit = el.closest('[data-content-search-unit-key]');
        result.unit_role = String(unit?.getAttribute('data-content-search-unit-key') || '').split(':').pop();
        result.ancestors = [];
        for (let parent = el.parentElement, depth = 0;
          parent && parent !== convo && depth < 5;
          parent = parent.parentElement, depth += 1) {
          result.ancestors.push({
            tag: parent.tagName.toLowerCase(),
            class_name: className(parent).slice(0, 500),
            child_count: parent.children.length,
            text_length: text(parent).length,
            text_hash: hash(text(parent)),
          });
        }
        const context = el.parentElement?.parentElement || el.parentElement;
        result.context_children = Array.from(context?.children || []).slice(0, 30).map(shallow);
        result.descendants = Array.from(el.querySelectorAll('*')).slice(0, 30).map(shallow);
        return result;
      };
      const units = Array.from(convo.querySelectorAll('[data-content-search-unit-key]'));
      const roleCounts = {};
      for (const unit of units) {
        const role = String(unit.getAttribute('data-content-search-unit-key') || '').split(':').pop();
        roleCounts[role] = (roleCounts[role] || 0) + 1;
      }
      const dataTestidCounts = {};
      for (const el of convo.querySelectorAll('[data-testid]')) {
        const key = el.getAttribute('data-testid') || '';
        dataTestidCounts[key] = (dataTestidCounts[key] || 0) + 1;
      }
      const candidateSelector = [
        'button', '[data-testid]', '[class*="command"]', '[class*="output"]',
        '[class*="activity"]', '[class*="diff"]', '[class*="patch"]', '[class*="tool"]',
        '[class*="file"]', '[class*="shell"]', '[class*="terminal"]'
      ].join(',');
      const candidates = Array.from(convo.querySelectorAll(candidateSelector));
      const structuralRaw = candidates.filter(el => {
        const kind = labelKind(text(el));
        const cls = className(el);
        return kind !== 'other' || /activity|command|output|diff|patch|tool|file|shell|terminal/i.test(cls)
          || !!el.getAttribute('data-testid');
      }).map(describe);
      const structuralByShape = new Map();
      for (const item of structuralRaw) {
        const shapeKey = JSON.stringify([
          item.tag, item.class_name, item.data_testid, item.role, item.aria_expanded,
          item.text_kind, item.first_token, item.text_length, item.unit_role,
          item.ancestors.map(parent => [parent.tag, parent.class_name, parent.child_count]),
          item.context_children.map(child => [child.tag, child.class_name, child.text_kind, child.text_length]),
          item.descendants.map(child => [child.tag, child.class_name, child.text_kind, child.text_length]),
        ]);
        if (!structuralByShape.has(shapeKey)) {
          structuralByShape.set(shapeKey, { ...item, count: 0, distinct_text_hashes: [] });
        }
        const shape = structuralByShape.get(shapeKey);
        shape.count += 1;
        if (!shape.distinct_text_hashes.includes(item.text_hash)) {
          shape.distinct_text_hashes.push(item.text_hash);
        }
      }
      const structural = Array.from(structuralByShape.values()).map(item => ({
        ...item,
        distinct_text_hash_count: item.distinct_text_hashes.length,
        distinct_text_hashes: undefined,
      }));
      const sampledUnits = units.slice(-96);
      const unitSummaries = sampledUnits.map(unit => ({
        key_suffix: String(unit.getAttribute('data-content-search-unit-key') || '').split(':').pop(),
        class_name: className(unit).slice(0, 500),
        text_length: text(unit).length,
        text_hash: hash(text(unit)),
        buttons: Array.from(unit.querySelectorAll('button')).map(describe),
        data_testids: Array.from(unit.querySelectorAll('[data-testid]'))
          .map(el => el.getAttribute('data-testid') || ''),
        direct_children: Array.from(unit.children).map(el => ({
          tag: el.tagName.toLowerCase(), class_name: className(el).slice(0, 500),
        })),
      }));
      return {
        ok: true,
        unit_count: units.length,
        role_counts: roleCounts,
        turn_key_count: convo.querySelectorAll('[data-turn-key]').length,
        content_turn_key_count: convo.querySelectorAll('[data-content-search-turn-key]').length,
        button_count: convo.querySelectorAll('button').length,
        data_testid_counts: dataTestidCounts,
        structural_candidate_count: structuralRaw.length,
        structural_candidates: structural,
        sampled_unit_count: sampledUnits.length,
        units: unitSummaries,
      };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Runtime evaluation failed');
  return response.result?.value;
}

async function main() {
  const targets = await listCdpTargets(CDP, { port: PORT });
  const target = targets.find(item => item.type === 'page' && item.url === 'app://-/index.html');
  assert(target, `Codex Desktop app target not found on port ${PORT}`);
  const client = await connectCdpTarget(CDP, {
    port: PORT, host: target._cdpHost, target: target.id,
  });
  let originalThread = '';
  let restored = false;
  try {
    await client.Runtime.enable();
    const threads = await selectors.readCodexThreadList(client.Runtime, true);
    originalThread = String(threads.find(thread => thread?.active)?.id || '');
    assert(originalThread, 'active Codex Desktop thread was not detected');
    const switched = originalThread === TARGET_THREAD
      ? { ok: true, method: 'already-active' }
      : await selectors.switchCodexThread(client.Runtime, TARGET_THREAD, true);
    assert.equal(switched?.ok, true, `audit thread switch failed: ${JSON.stringify(switched)}`);
    const structure = await evaluate(client.Runtime);
    assert.equal(structure?.ok, true, structure?.error || 'structure audit failed');
    const domMessages = JSON.parse(await selectors.readMessages(
      client.Runtime,
      'codex-desktop',
      'structured-dom-audit',
      { maxRecentTurns: 24, maxRecentUnits: 96 },
    ) || '[]');
    const cliSessionId = TARGET_THREAD.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    )?.[1] || '';
    const archive = cliSessionId ? codexCli.findSessionByCliId(cliSessionId) : null;
    const countBlocks = messages => {
      const counts = {};
      for (const message of (messages || [])) {
        for (const block of (message.content_blocks || [])) {
          counts[block.type] = (counts[block.type] || 0) + 1;
        }
      }
      return counts;
    };
    const engine = Object.create(ProxyEngine.prototype);
    const archiveMessages = Array.isArray(archive?.messages) ? archive.messages : [];
    const archiveAnchor = engine._codexDesktopArchiveAnchor(archiveMessages, domMessages);
    engine._log = () => {};
    const recoveredMessages = engine._maybeUseCodexDesktopArchive(
      'structured-dom-audit',
      {
        agentType: 'codex-desktop',
        _activeThreadKey: TARGET_THREAD,
        _activeThreadTitle: '',
      },
      domMessages,
    );
    const normalizedArchiveMessages = codexDesktopArchiveMessages(archiveMessages);
    const result = {
      schema_version: 1,
      kind: 'codex-desktop-structured-dom-audit',
      ok: true,
      generated_at: new Date().toISOString(),
      port: PORT,
      original_thread_id: originalThread,
      audited_thread_id: TARGET_THREAD,
      content_safe: true,
      focus_actions: 0,
      visible_windows_opened: 0,
      sends: 0,
      controls: 0,
      structure,
      transcript_shapes: {
        dom_messages: domMessages.length,
        dom_blocks: countBlocks(domMessages),
        archive_found: !!archive,
        archive_path_hash: archive?.filePath
          ? require('crypto').createHash('sha256').update(archive.filePath).digest('hex')
          : '',
        archive_messages: archiveMessages.length,
        archive_blocks: countBlocks(archiveMessages),
        normalized_archive_messages: normalizedArchiveMessages.length,
        normalized_archive_blocks: codexDesktopStructuredBlockCounts(normalizedArchiveMessages),
        archive_partial: archive?.messagesPartial === true,
        archive_anchor: archiveAnchor,
        archive_covers_visible_users: engine._codexDesktopArchiveCoversVisibleUsers(
          archiveMessages,
          domMessages,
        ),
        recovered_messages: recoveredMessages.length,
        recovered_blocks: codexDesktopStructuredBlockCounts(recoveredMessages),
      },
    };
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: true,
      output: OUTPUT,
      unit_count: structure.unit_count,
      role_counts: structure.role_counts,
      structural_candidates: structure.structural_candidates.length,
      transcript_shapes: result.transcript_shapes,
    }));
  } finally {
    try {
      if (originalThread && originalThread !== TARGET_THREAD) {
        const restore = await selectors.switchCodexThread(client.Runtime, originalThread, true);
        restored = restore?.ok === true;
      } else {
        restored = true;
      }
    } finally {
      await client.close();
    }
    if (!restored) throw new Error(`failed to restore original Codex Desktop thread ${originalThread}`);
  }
}

withCodexDesktopCdpLock('codex-desktop-structured-dom-audit', main, { waitMs: 90000 })
  .catch(error => {
    console.error(`Codex Desktop structured DOM audit: FAIL (${error.message})`);
    process.exit(1);
  });

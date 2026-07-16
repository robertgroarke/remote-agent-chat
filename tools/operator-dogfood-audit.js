#!/usr/bin/env node
'use strict';

const DETECTION_CLASSES = Object.freeze([
  'clipped_portal',
  'horizontal_overflow',
  'mojibake',
  'wrong_harness_label',
  'stale_false_status',
  'refresh_reorder_jitter',
  'missing_capability_control',
  'wrong_chat_workspace_identity',
  'missing_timestamp_message',
  'false_completion_cue',
  'populated_source_empty',
  'lost_focus_scroll',
]);

const HARNESS_LABELS = Object.freeze({
  claude: 'Claude Code',
  codex: 'Codex',
  'codex-desktop': 'Codex Desktop',
  cursor: 'Cursor',
  continue: 'Continue',
  'antigravity-v2': 'Antigravity v2',
  antigravity_panel: 'Antigravity Chat',
  roo_code: 'Roo Code',
  gemini: 'Gemini',
  claude_cli: 'Claude CLI',
  codex_cli: 'Codex CLI',
  cursor_cli: 'Cursor CLI',
});

function normalize(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function staticPageAudit(page, options = {}) {
  const staleStatusMs = Number(options.staleStatusMs || 120000);
  return page.evaluate(({ harnessLabels, staleMs }) => {
    const findings = [];
    const visible = element => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0;
    };
    const text = element => String(element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
    const push = (detectionClass, message, evidence = {}) => findings.push({
      detection_class: detectionClass,
      severity: detectionClass === 'horizontal_overflow' || detectionClass === 'clipped_portal' ? 'P1' : 'P1',
      message,
      evidence,
    });

    const portalSelectors = [
      '[role="dialog"]', '[aria-modal="true"]', '[role="menu"]', '[role="listbox"]',
      '[role="tooltip"]', '[data-portal]', '[data-floating-ui-portal]', '.modal', '.popover', '.tooltip',
    ].join(',');
    for (const element of document.querySelectorAll(portalSelectors)) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      const clipped = rect.left < -1 || rect.top < -1
        || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1;
      if (clipped) {
        push('clipped_portal', 'Floating or modal content is clipped by the viewport', {
          role: element.getAttribute('role'),
          rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          snippet: text(element).slice(0, 160),
        });
      }
    }

    const overflowPx = Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      document.body?.scrollWidth - document.documentElement.clientWidth || 0,
    );
    if (overflowPx > 1) {
      push('horizontal_overflow', `Document overflows horizontally by ${overflowPx}px`, {
        scroll_width: document.documentElement.scrollWidth,
        client_width: document.documentElement.clientWidth,
        overflow_px: overflowPx,
      });
    }

    const bodyText = text(document.body);
    const mojibakeTokens = ['Ã', 'Â', 'â€™', 'â€œ', 'â€\u009d', 'â€“', 'â€”', 'â€¦', 'ï¿½', '\uFFFD'];
    const mojibake = mojibakeTokens.find(token => bodyText.includes(token));
    if (mojibake) {
      const offset = bodyText.indexOf(mojibake);
      push('mojibake', 'Visible text contains a common encoding-corruption marker', {
        token: mojibake,
        snippet: bodyText.slice(Math.max(0, offset - 40), offset + 120),
      });
    }

    for (const container of document.querySelectorAll('[data-agent-type], [data-harness]')) {
      if (!visible(container)) continue;
      const harness = container.getAttribute('data-agent-type') || container.getAttribute('data-harness');
      const expected = harnessLabels[harness];
      if (!expected) continue;
      const label = container.querySelector('[data-role="harness-label"], [data-harness-label], .harness-label, .agent-badge');
      if (label && visible(label) && !text(label).toLowerCase().includes(expected.toLowerCase())) {
        push('wrong_harness_label', `Harness ${harness} is labeled as ${text(label) || '(empty)'}`, {
          harness,
          expected,
          actual: text(label),
        });
      }
    }

    const activeStatuses = new Set(['working', 'thinking', 'streaming', 'online', 'healthy', 'connected']);
    for (const element of document.querySelectorAll('[data-status][data-updated-at], [data-session-status][data-updated-at]')) {
      if (!visible(element)) continue;
      const status = (element.getAttribute('data-status') || element.getAttribute('data-session-status') || '').toLowerCase();
      const updatedAt = Date.parse(element.getAttribute('data-updated-at') || '');
      if (activeStatuses.has(status) && Number.isFinite(updatedAt) && Date.now() - updatedAt > staleMs) {
        push('stale_false_status', `Active-looking ${status} status is stale`, {
          status,
          updated_at: new Date(updatedAt).toISOString(),
          age_ms: Date.now() - updatedAt,
        });
      }
    }

    for (const container of document.querySelectorAll('[data-capabilities]')) {
      if (!visible(container)) continue;
      let capabilities = [];
      const raw = container.getAttribute('data-capabilities') || '';
      try {
        const parsed = JSON.parse(raw);
        capabilities = Array.isArray(parsed) ? parsed : Object.keys(parsed).filter(key => parsed[key]);
      } catch {
        capabilities = raw.split(',').map(value => value.trim()).filter(Boolean);
      }
      const available = new Set([...container.querySelectorAll('[data-capability-control], [data-capability]')]
        .filter(visible)
        .map(element => element.getAttribute('data-capability-control') || element.getAttribute('data-capability')));
      const missing = capabilities.filter(capability => !available.has(capability));
      if (missing.length) {
        push('missing_capability_control', 'Advertised capabilities have no reachable controls', {
          advertised: capabilities,
          available: [...available],
          missing,
        });
      }
    }

    for (const container of document.querySelectorAll('[data-chat-title][data-workspace-name]')) {
      if (!visible(container)) continue;
      const chatTitle = container.getAttribute('data-chat-title') || '';
      const workspace = container.getAttribute('data-workspace-name') || '';
      const primary = container.querySelector('[data-primary-title], h1, h2, [role="heading"]');
      const primaryText = text(primary);
      if (chatTitle && workspace && chatTitle !== workspace
        && primaryText.toLowerCase() === workspace.toLowerCase()) {
        push('wrong_chat_workspace_identity', 'Workspace text is rendered as the primary chat identity', {
          chat_title: chatTitle,
          workspace_name: workspace,
          primary_title: primaryText,
        });
      }
    }

    for (const message of document.querySelectorAll('[data-message-id], [data-audit-message], .message[data-id]')) {
      if (!visible(message)) continue;
      const content = message.querySelector('[data-message-content], .message-content, .message-body');
      const timestamp = message.querySelector('time, [datetime], [data-timestamp], .timestamp');
      const missing = [];
      if (!content || !text(content)) missing.push('message');
      if (!timestamp || !text(timestamp)) missing.push('timestamp');
      if (missing.length) {
        push('missing_timestamp_message', 'Transcript row is missing required content or time context', {
          missing,
          message_key: message.getAttribute('data-message-id') || message.getAttribute('data-audit-message') || null,
        });
      }
    }

    const completionPattern = /\b(?:session completed|turn finished|task complete(?:d)?)\b/i;
    for (const container of document.querySelectorAll('[data-terminal-state], [data-session-status], [data-goal-status]')) {
      if (!visible(container) || !completionPattern.test(text(container))) continue;
      const terminalState = (
        container.getAttribute('data-terminal-state')
        || container.getAttribute('data-goal-status')
        || container.getAttribute('data-session-status')
        || ''
      ).toLowerCase();
      if (!['completed', 'complete', 'terminal', 'done', 'goal_completed'].includes(terminalState)) {
        push('false_completion_cue', 'Completion copy is visible without an authoritative terminal state', {
          state: terminalState,
          snippet: text(container).slice(0, 180),
        });
      }
    }

    for (const container of document.querySelectorAll('[data-source-count]')) {
      if (!visible(container)) continue;
      const sourceCount = Number(container.getAttribute('data-source-count'));
      const itemCount = [...container.querySelectorAll('[data-source-item]')].filter(visible).length;
      const emptyState = [...container.querySelectorAll('[data-empty-state]')].some(visible);
      if (sourceCount > 0 && (emptyState || itemCount === 0)) {
        push('populated_source_empty', 'A populated data source is rendered as empty', {
          source_count: sourceCount,
          rendered_items: itemCount,
          empty_state_visible: emptyState,
        });
      }
    }

    return findings;
  }, { harnessLabels: HARNESS_LABELS, staleMs: staleStatusMs });
}

async function captureDynamicState(page) {
  return page.evaluate(() => {
    const active = document.activeElement;
    const focusKey = active && active !== document.body
      ? active.getAttribute('data-audit-key') || active.getAttribute('name') || active.getAttribute('aria-label') || active.id || active.tagName
      : null;
    const scroll = [...document.querySelectorAll('[data-audit-preserve-scroll], [data-preserve-scroll]')].map((element, index) => ({
      key: element.getAttribute('data-audit-key') || element.id || `scroll-${index}`,
      top: element.scrollTop,
      left: element.scrollLeft,
    }));
    const lists = [...document.querySelectorAll('[data-audit-stable-list], [data-stable-list]')].map((element, listIndex) => ({
      key: element.getAttribute('data-audit-key') || element.id || `list-${listIndex}`,
      items: [...element.querySelectorAll(':scope > [data-stable-key]')].map(item => {
        const rect = item.getBoundingClientRect();
        return { key: item.getAttribute('data-stable-key'), x: rect.x, y: rect.y };
      }),
    }));
    return { focus_key: focusKey, scroll, lists };
  });
}

async function auditDynamicStability(page, options = {}) {
  const before = await captureDynamicState(page);
  const refreshInvoked = await page.evaluate(async () => {
    if (typeof window.__operatorDogfoodAuditRefresh !== 'function') return false;
    await window.__operatorDogfoodAuditRefresh();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  });
  if (!refreshInvoked && options.observeMs) await page.waitForTimeout(Number(options.observeMs));
  const after = await captureDynamicState(page);
  const findings = [];

  for (const beforeList of before.lists) {
    const afterList = after.lists.find(candidate => candidate.key === beforeList.key);
    if (!afterList) continue;
    const beforeOrder = beforeList.items.map(item => item.key);
    const afterOrder = afterList.items.map(item => item.key);
    const orderChanged = JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder);
    const drift = beforeList.items.reduce((maximum, item) => {
      const candidate = afterList.items.find(afterItem => afterItem.key === item.key);
      if (!candidate) return maximum;
      return Math.max(maximum, Math.abs(candidate.x - item.x), Math.abs(candidate.y - item.y));
    }, 0);
    if (orderChanged || drift > 1) {
      findings.push({
        detection_class: 'refresh_reorder_jitter',
        severity: 'P1',
        message: 'Refresh changed stable ordering or geometry without a declared priority change',
        evidence: { list_key: beforeList.key, before_order: beforeOrder, after_order: afterOrder, max_drift_px: drift },
      });
    }
  }

  const scrollDrift = before.scroll.map(item => {
    const candidate = after.scroll.find(afterItem => afterItem.key === item.key);
    return candidate ? Math.max(Math.abs(candidate.top - item.top), Math.abs(candidate.left - item.left)) : 0;
  }).reduce((maximum, value) => Math.max(maximum, value), 0);
  const focusLost = before.focus_key && before.focus_key !== after.focus_key;
  if (focusLost || scrollDrift > 1) {
    findings.push({
      detection_class: 'lost_focus_scroll',
      severity: 'P1',
      message: 'Refresh lost operator focus or scroll position',
      evidence: {
        before_focus: before.focus_key,
        after_focus: after.focus_key,
        max_scroll_drift_px: scrollDrift,
      },
    });
  }

  return { findings, before, after, refresh_invoked: refreshInvoked };
}

async function auditPage(page, options = {}) {
  const staticFindings = await staticPageAudit(page, options);
  const dynamic = await auditDynamicStability(page, options);
  const findings = [...staticFindings, ...dynamic.findings];
  return {
    ok: findings.length === 0,
    findings,
    detected_classes: [...new Set(findings.map(finding => finding.detection_class))].sort(),
    dynamic: {
      refresh_invoked: dynamic.refresh_invoked,
      before: dynamic.before,
      after: dynamic.after,
    },
  };
}

module.exports = {
  DETECTION_CLASSES,
  HARNESS_LABELS,
  auditDynamicStability,
  auditPage,
  staticPageAudit,
};

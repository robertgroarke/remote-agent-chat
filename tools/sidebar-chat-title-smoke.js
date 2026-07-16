#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const esbuild = require('../frontend/node_modules/esbuild');

const ROOT = path.resolve(__dirname, '..');
const webPath = path.join(ROOT, 'frontend', 'session-title.js');
const androidPath = path.join(ROOT, 'android-app', 'lib', 'session-title.js');

function loadModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const transformed = esbuild.transformSync(source, {
    loader: 'js',
    format: 'cjs',
    target: 'es2020',
  }).code;
  const module = { exports: {} };
  new Function('module', 'exports', transformed)(module, module.exports);
  return module.exports;
}

const webSource = fs.readFileSync(webPath, 'utf8');
const androidSource = fs.readFileSync(androidPath, 'utf8');
assert.strictEqual(androidSource, webSource, 'Web and Android title policy must remain byte-identical');

const title = loadModule(webPath);
const resolve = (session, custom = '', messages = [], derived = '') => (
  title.resolveSessionChatTitle(session, custom, messages, derived)
);
const project = (session, custom = '', messages = [], derived = '') => (
  title.resolveSessionChatTitleProjection(session, custom, messages, derived)
);

assert.strictEqual(resolve({ display_name: 'Codex CLI', title: 'Repair sidebar summaries' }), 'Repair sidebar summaries');
assert.strictEqual(resolve({ title: 'Native thread title' }, 'Operator rename', [{ role: 'user', content: 'Transcript title' }]), 'Native thread title');
assert.strictEqual(resolve({ codex_desktop_active_thread_title: 'Native desktop thread', chat_title: 'Producer summary', chat_title_source: 'summary' }, 'Operator rename'), 'Native desktop thread');
assert.strictEqual(resolve({ display_name: 'Claude Code' }, 'Operator rename', [{ role: 'user', content: 'Transcript title' }]), 'Operator rename');
assert.strictEqual(resolve({ chat_title: 'Producer summary', chat_title_source: 'summary' }, 'Operator rename'), 'Operator rename');
assert.strictEqual(resolve({ chat_title: 'Producer summary', chat_title_source: 'summary' }), 'Producer summary');
assert.strictEqual(resolve({ display_name: 'Cursor' }, '', [{ role: 'user', content: 'Diagnose the hydration refresh bug' }]), 'Diagnose the hydration refresh bug');
assert.strictEqual(resolve({ title: 'Codex CLI session' }, '', [
  { role: 'assistant', content: 'Assistant output must never title a chat.' },
  { role: 'user', content: '[File: C:\\temp\\screenshot.png]' },
  { role: 'user', content: '<goal_context>metadata only</goal_context>' },
  { role: 'user', content: 'Fix the first meaningful user-message fallback' },
]), 'Fix the first meaningful user-message fallback');
assert.strictEqual(resolve({ display_name: 'Roo Code' }), 'New chat');
for (const placeholder of ['[Image]', '[Attachment]', '[File: screenshot.png]', 'Screenshot', 'continue', 'proceed', 'New Claude CLI session', 'Cursor Agent session']) {
  assert.strictEqual(resolve({ title: placeholder }), 'New chat', `${placeholder} must not become a native chat title`);
}
assert.strictEqual(resolve({ display_name: 'Codex Desktop' }, '', [], 'Hydrated conversation summary'), 'Hydrated conversation summary');
assert.strictEqual(resolve({ chat_title: '中文侧边栏标题需要完整显示并且可以轻松区分' }), '中文侧边栏标题需要完整显示并且可以轻松区分');
assert.strictEqual(resolve({ chat_title: 'عنوان عربي طويل لاختبار اتجاه النص في الشريط الجانبي' }), 'عنوان عربي طويل لاختبار اتجاه النص في الشريط الجانبي');
assert.strictEqual(resolve({ title: 'Cursor CLI fixture' }, 'Codex', [{ role: 'assistant', content: 'Not a user title' }]), 'New chat');

assert.deepStrictEqual(project({ native_chat_title: 'Native title' }), {
  title: 'Native title', source: 'native', field: 'native_chat_title',
});
assert.deepStrictEqual(project({}, 'Operator rename'), {
  title: 'Operator rename', source: 'custom', field: 'custom_display_name',
});
assert.deepStrictEqual(project({ chat_title: 'Producer summary', chat_title_source: 'summary' }), {
  title: 'Producer summary', source: 'summary', field: 'chat_title',
});
assert.deepStrictEqual(project({}, '', [{ role: 'user', content: 'First meaningful prompt' }]), {
  title: 'First meaningful prompt', source: 'message', field: 'first_meaningful_user_message',
});
assert.deepStrictEqual(project({}), {
  title: 'New chat', source: 'fallback', field: 'new_chat',
});
assert.deepStrictEqual(project({ native_chat_title: 'Remote Agent Chat', workspace_name: 'Remote Agent Chat' }), {
  title: 'Remote Agent Chat', source: 'native', field: 'native_chat_title',
}, 'a legitimate chat title may equal its workspace without changing provenance');
assert.deepStrictEqual(
  title.retainStrongerSessionChatTitleProjection(
    { title: 'Native title', source: 'native', field: 'native_chat_title' },
    { title: 'New chat', source: 'fallback', field: 'new_chat' },
  ),
  { title: 'Native title', source: 'native', field: 'native_chat_title' },
  'a reconnect placeholder must not regress a stronger title',
);
assert.deepStrictEqual(
  title.retainStrongerSessionChatTitleProjection(
    { title: 'Thread A', source: 'native', field: 'native_chat_title' },
    { title: 'Thread B', source: 'native', field: 'native_chat_title' },
  ),
  { title: 'Thread B', source: 'native', field: 'native_chat_title' },
  'an equal-strength native thread switch must update in place',
);

const longTitle = resolve({}, '', [{ role: 'user', content: 'A'.repeat(100) }]);
assert.strictEqual(longTitle.length, 80, 'derived titles must be trimmed to 80 characters');

for (const harness of ['Remote Agent Chat', 'Codex', 'Codex CLI', 'Codex Desktop', 'Claude CLI', 'Claude Code', 'Claude Code CLI', 'Claude Code ext', 'Cursor', 'Cursor IDE', 'Cursor CLI', 'Continue', 'Gemini Code Assist', 'Gemini Code Assist ext', 'Roo Code']) {
  assert.notStrictEqual(resolve({ display_name: harness, title: `${harness} session` }), harness);
}

const webApp = fs.readFileSync(path.join(ROOT, 'frontend', 'app.jsx'), 'utf8');
const webStyles = fs.readFileSync(path.join(ROOT, 'frontend', 'styles.css'), 'utf8');
const androidList = fs.readFileSync(path.join(ROOT, 'android-app', 'screens', 'SessionListScreen.jsx'), 'utf8');
const androidPreferences = fs.readFileSync(path.join(ROOT, 'android-app', 'components', 'SessionPreferencesSheet.jsx'), 'utf8');
assert(webApp.includes('custom_display_name: preference.display_name'));
assert(webApp.includes('resolveSessionChatTitle('));
assert(webApp.includes('resolveSessionChatTitleProjection('));
assert(webApp.includes('data-chat-title-source={activeChatTitleProjection.source}'));
assert(webApp.includes('aria-label={`${activeAgent.name} chat: ${activeChatTitle}`}'));
assert(webApp.includes('<span className="topbar-workspace-icon">⌂</span>{activeWorkspaceContext}'));
assert(!webApp.includes('{activeLabel}'), 'the Web header must not render a workspace-derived activeLabel');
assert(androidList.includes('custom_display_name: preference.display_name'));
assert(androidList.includes('refreshSidebarTranscriptTitle(msgSid, [msg])'));
assert(androidList.includes('getCachedTranscript(sid) || []'));
assert(androidList.includes("case 'history_delta': {") && androidList.includes('shared transcript LRU from background traffic'));
assert(androidList.includes('`${harness} · ${context}`'));
assert(webApp.includes('wrapperClassName="session-title-details"'), 'web cards must provide visual full-title disclosure');
assert(webApp.includes('wrapperClassName="session-group-title-details"'), 'web groups must provide visual full-title disclosure');
assert(webApp.includes('className="session-card-menu"'), 'web secondary actions must share one menu');
assert(!webApp.includes('className="session-card-close"'), 'web close must not reserve a separate rail slot');
assert(webStyles.includes('-webkit-line-clamp: 2'), 'web session/group titles must reserve two readable lines');
assert(webApp.includes("from './title-disclosure.jsx'"), 'web title disclosure must use the shared viewport portal');
assert(webStyles.includes('.title-disclosure-portal'), 'web title disclosure portal styling is missing');
assert(webStyles.includes('position: fixed'), 'web title disclosure must escape scroll-container clipping');
const disclosureSource = fs.readFileSync(path.join(ROOT, 'frontend', 'title-disclosure.jsx'), 'utf8');
const servedDisclosureSource = fs.readFileSync(path.join(ROOT, 'relay-server', 'public', 'title-disclosure.jsx'), 'utf8');
assert.equal(servedDisclosureSource, disclosureSource, 'served title disclosure source must match frontend source');
assert(disclosureSource.includes('ReactDOM.createPortal('), 'web title disclosure must render outside the sidebar tree');
assert(disclosureSource.includes("mode: 'right'"), 'desktop disclosures must open beside the sidebar');
assert(disclosureSource.includes("mode: 'sheet'"), 'touch disclosures must use viewport-safe sheet geometry');
assert(disclosureSource.includes('onFocus:'), 'web title disclosure must remain keyboard visible');
assert(disclosureSource.includes('TOUCH_HOLD_MS'), 'web title disclosure must retain a long-press path');
assert(androidList.includes('numberOfLines={2}'), 'Android session/group titles must reserve two lines');
assert(androidList.includes('setTitleDisclosure({'), 'Android must provide touch/long-press full-title disclosure');
assert(androidList.includes('accessibilityLabel={`Session actions for ${sessionName(item)}`}'), 'Android cards must expose one accessible action menu');
assert(!androidList.includes('style={s.cardCloseBtn}'), 'Android close must not reserve a separate card column');
assert(androidPreferences.includes('onCloseSession'), 'Android consolidated menu must retain Close');
assert(androidPreferences.includes('onAutomations') && androidPreferences.includes('onSkills'), 'Android consolidated menu must retain product actions');
const androidChat = fs.readFileSync(path.join(ROOT, 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
assert(androidChat.includes('resolveSessionChatTitleProjection('));
assert(androidChat.includes('retainStrongerSessionChatTitleProjection('));
assert(androidChat.includes('>{liveChatTitle}</Text>'));
for (const messageType of ['connection_ack', 'session_list', 'session_patch', 'session_summary', 'session_meta', 'chat_list', 'thread_list']) {
  assert(androidChat.includes(`case '${messageType}'`), `Android live title hydration omitted ${messageType}`);
}

console.log(JSON.stringify({
  ok: true,
  title_resolution_order: ['native', 'operator rename', 'producer summary', 'first meaningful user message', 'New chat'],
  title_source_provenance: ['native', 'custom', 'summary', 'message', 'fallback'],
  stronger_title_regression_blocked: true,
  equal_strength_thread_switch_updates: true,
  live_android_title_hydration: true,
  assistant_fallback: false,
  selected_transcript_cache_title: true,
  background_history_hydration: true,
  web_android_policy_byte_identical: true,
  fixed_two_line_titles: true,
  visual_full_title_disclosure: true,
  consolidated_secondary_actions: true,
}, null, 2));

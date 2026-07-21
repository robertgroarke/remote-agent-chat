'use strict';

const fs = require('fs');
const path = require('path');

const configuredCdpPort = Number(process.env.VSCODE_PROBE_CDP_PORT || 9229);
const CDP_PORT = Number.isInteger(configuredCdpPort) && configuredCdpPort > 0
  ? configuredCdpPort
  : 9229;
const WORKSPACE_PATH = path.resolve('C:\\temp\\remote-agent-vscode-test');
const WORKSPACE_NAME = 'remote-agent-vscode-test';
const USER_DATA_DIR = path.resolve(process.env.VSCODE_PROBE_USER_DATA_DIR || 'C:\\temp\\remote-agent-vscode-profile');
const EXTENSIONS = Object.freeze({
  claude: 'Anthropic.claude-code',
  codex: 'openai.chatgpt',
  gemini: 'google.geminicodeassist',
  continue: 'Continue.continue',
  roo_code: 'RooVeterinaryInc.roo-cline',
});

function normalize(value) {
  return String(value || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

function assertUpdatesDisabled(callSite = 'vscode probe') {
  const settingsPath = path.join(USER_DATA_DIR, 'User', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (error) {
    throw new Error(`${callSite}: disposable VS Code settings unreadable at ${settingsPath}: ${error.message}`);
  }
  if (settings?.['update.mode'] !== 'none') {
    throw new Error(`${callSite}: refusing disposable VS Code mutation until ${settingsPath} sets \"update.mode\" to \"none\"`);
  }
  return settingsPath;
}

function isThrowawayWorkbench(target) {
  const escapedWorkspace = WORKSPACE_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exactWorkspaceTitle = new RegExp(
    `(?:^| - )${escapedWorkspace}(?: \\(workspace\\))? - visual studio code(?: |$)`,
    'i',
  );
  return target?.type === 'page'
    && /workbench\.html/i.test(String(target.url || ''))
    && exactWorkspaceTitle.test(String(target.title || ''));
}

function iframeExtension(target) {
  return ((String(target?.url || '').match(/[?&]extensionId=([^&]+)/i) || [])[1] || '').toLowerCase();
}

function isThrowawayIframe(target, agentType) {
  const extension = EXTENSIONS[agentType];
  return !!extension && target?.type === 'iframe' && iframeExtension(target) === extension.toLowerCase();
}

function assertTargetSet(targets, agentType, callSite = 'vscode probe') {
  const pages = (targets || []).filter(isThrowawayWorkbench);
  const frames = (targets || []).filter(target => isThrowawayIframe(target, agentType));
  if (pages.length !== 1) throw new Error(`${callSite}: expected one disposable workbench, found ${pages.length}`);
  if (frames.length < 1) throw new Error(`${callSite}: expected a disposable ${agentType} iframe, found ${frames.length}`);
  const launcher = agentType === 'claude'
    ? frames.find(frame => /[?&]purpose=webviewView(?:&|$)/i.test(String(frame.url || ''))) || (frames.length === 1 ? frames[0] : null)
    : frames[0];
  if (!launcher) throw new Error(`${callSite}: disposable ${agentType} extension iframe not found`);
  if (agentType !== 'claude' && frames.length !== 1) {
    throw new Error(`${callSite}: expected one disposable ${agentType} iframe, found ${frames.length}`);
  }
  return { page: pages[0], frame: launcher, frames };
}

function isThrowawaySession(session, agentType) {
  return !!session
    && session.agent_type === agentType
    && session.host_type === 'vscode'
    && normalize(session.workspace_path) === normalize(WORKSPACE_PATH)
    && String(session.workspace_name || '').toLowerCase() === WORKSPACE_NAME;
}

function pickThrowawaySession(sessions, agentType) {
  const matches = (Array.isArray(sessions) ? sessions : []).filter(session => isThrowawaySession(session, agentType));
  if (matches.length !== 1) {
    throw new Error(`guard: expected one relay ${agentType} session for ${WORKSPACE_PATH}, found ${matches.length}`);
  }
  return matches[0];
}

function assertStoreBinding(store, session, frame) {
  const stored = store?.sessions?.[session?.session_id];
  if (!stored) throw new Error(`guard: session ${session?.session_id || 'unknown'} missing from durable store`);
  if (!isThrowawaySession(stored, session.agent_type)) throw new Error('guard: durable session workspace identity mismatch');
  if (stored.target_id !== frame.id) {
    throw new Error(`guard: relay session target ${stored.target_id || 'missing'} does not match disposable iframe ${frame.id}`);
  }
  return stored;
}

function pickSessionForFrame(sessions, agentType, store, frame) {
  const matches = (Array.isArray(sessions) ? sessions : []).filter(session =>
    isThrowawaySession(session, agentType) && store?.sessions?.[session.session_id]?.target_id === frame?.id
  );
  if (matches.length !== 1) {
    throw new Error(`guard: expected one ${agentType} relay session for target ${frame?.id || 'missing'}, found ${matches.length}`);
  }
  return matches[0];
}

module.exports = {
  CDP_PORT,
  WORKSPACE_PATH,
  WORKSPACE_NAME,
  USER_DATA_DIR,
  EXTENSIONS,
  normalize,
  assertUpdatesDisabled,
  isThrowawayWorkbench,
  isThrowawayIframe,
  assertTargetSet,
  isThrowawaySession,
  pickThrowawaySession,
  assertStoreBinding,
  pickSessionForFrame,
};

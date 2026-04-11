const TEXT_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'py', 'json', 'md', 'css', 'html', 'htm',
  'sh', 'bash', 'yaml', 'yml', 'txt', 'env', 'csv', 'xml', 'sql', 'go', 'rs', 'java', 'c', 'cpp',
  'h', 'hpp', 'rb', 'php', 'swift', 'kt', 'scala', 'r', 'm', 'tf', 'toml', 'ini', 'cfg', 'conf',
  'log', 'gitignore', 'dockerfile', 'makefile', 'vue', 'svelte', 'graphql', 'gql']);

const LANG_MAP = {
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', py: 'python',
  rb: 'ruby', sh: 'bash', bash: 'bash', rs: 'rust', kt: 'kotlin', tf: 'hcl',
  md: 'markdown', yml: 'yaml', yaml: 'yaml', graphql: 'graphql', gql: 'graphql',
};

function getLang(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return LANG_MAP[ext] || ext;
}

function isTextFile(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return TEXT_EXTS.has(ext);
}

// Session display label — handles both legacy string IDs and protocol v1 metadata objects
const AGENT_DISPLAY = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
  continue: 'Continue',
  antigravity: 'Antigravity',
  antigravity_panel: 'Antigravity Chat',
  'codex-desktop': 'Codex Desktop',
  'claude-desktop': 'Claude Desktop',
};
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionLabel(sessionOrId, fallbackId) {
  // Protocol v1: metadata object with display_name / workspace_name
  if (sessionOrId && typeof sessionOrId === 'object') {
    const name      = AGENT_DISPLAY[sessionOrId.agent_type] || sessionOrId.display_name || sessionOrId.agent_type || 'Agent';
    const workspace = sessionOrId.workspace_name || sessionOrId.window_title || '';
    return workspace ? name + ' \u2014 ' + workspace : name;
  }
  // Legacy: "claude-abc123" style string IDs
  const id     = fallbackId || sessionOrId;
  if (typeof id !== 'string') return 'Agent';
  if (UUID_RE.test(id)) return 'Agent Session';
  const parts  = id.split('-');
  const agent  = parts[0];
  const win    = parts[1] || '';
  const suffix = parts[2] || '';
  const winLabel = win ? ' (win ' + win + suffix + ')' : '';
  return (AGENT_DISPLAY[agent] || agent) + winLabel;
}

// ESM exports (consumed by entry.jsx bundle)
export { getLang, isTextFile, sessionLabel };

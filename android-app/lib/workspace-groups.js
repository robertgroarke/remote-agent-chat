const GROUP_ALIAS_STORAGE_KEY = 'remote-agent-chat:group-aliases:v1';
const DEFAULT_GROUP_ALIASES = Object.freeze({
  '^remoteagent': 'Remote Agent Chat',
});

function normalizedDirectory(value) {
  const text = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!text || text.toLowerCase() === 'unknown') return null;
  if (!/^(?:[A-Za-z]:\/|\/\/|\/)/.test(text)) return null;
  return { key: text.toLowerCase(), path: text };
}

function directoryLabel(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').filter(Boolean).pop() || 'Unscoped';
}

function isSameOrChildPath(pathKey, rootKey) {
  return pathKey === rootKey || pathKey.startsWith(`${rootKey}/`);
}

function normalizedAliasProbe(value) {
  return directoryLabel(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function canonicalAliasKey(value) {
  return `alias:${String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function normalizeGroupAliases(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries({ ...DEFAULT_GROUP_ALIASES, ...input })
    .filter(([pattern, title]) => String(pattern).trim() && String(title).trim())
    .map(([pattern, title]) => [String(pattern).trim(), String(title).trim()]));
}

function matchingGroupAlias(directory, session, groupAliases) {
  const explicit = session && typeof session === 'object'
    ? (session.group_alias || session.project_group || null)
    : null;
  if (typeof explicit === 'string' && explicit.trim()) {
    const title = explicit.trim();
    return { key: canonicalAliasKey(title), title };
  }
  if (!directory) return null;
  const probe = normalizedAliasProbe(directory.path);
  for (const [pattern, title] of Object.entries(normalizeGroupAliases(groupAliases))) {
    try {
      if (new RegExp(pattern, 'i').test(probe)) {
        return { key: canonicalAliasKey(title), title };
      }
    } catch {}
  }
  return null;
}

export function groupSessionsByDirectory(sessionList, groupAliases = DEFAULT_GROUP_ALIASES) {
  const sessions = Array.isArray(sessionList) ? sessionList : [];
  const explicitRoots = sessions
    .map(session => normalizedDirectory(session && typeof session === 'object' ? session.project_root : null))
    .filter(Boolean)
    .sort((left, right) => right.key.length - left.key.length);
  const groups = [];
  const byKey = new Map();

  for (const session of sessions) {
    const explicitRoot = normalizedDirectory(session && typeof session === 'object' ? session.project_root : null);
    const workspace = normalizedDirectory(session && typeof session === 'object' ? session.workspace_path : null);
    const inheritedRoot = !explicitRoot && workspace
      ? explicitRoots.find(root => isSameOrChildPath(workspace.key, root.key))
      : null;
    const directory = explicitRoot || inheritedRoot || workspace;
    const alias = matchingGroupAlias(directory, session, groupAliases);
    const key = alias?.key || directory?.key || 'unscoped';
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        title: alias?.title || (directory ? directoryLabel(directory.path) : 'Unscoped'),
        path: directory?.path || null,
        sessions: [],
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.sessions.push(session);
  }

  return groups;
}

export {
  DEFAULT_GROUP_ALIASES,
  GROUP_ALIAS_STORAGE_KEY,
  directoryLabel,
  normalizeGroupAliases,
  normalizedDirectory,
};

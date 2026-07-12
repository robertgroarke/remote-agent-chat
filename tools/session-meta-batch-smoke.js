#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'relay-server', 'index.js'), 'utf8');
const batch = source.match(/const persistSessionMetaBatch = db\.transaction\(\(sessions\) => \{([\s\S]*?)\n\}\);/);
assert(batch, 'batched session metadata transaction is missing');
assert(batch[1].includes('stmtGetSessionMeta.get(id)'), 'batch must compare persisted values');
assert(batch[1].includes('stmtUpsertSessionMeta.run('), 'batch must retain the durable upsert');
assert(batch[1].includes('return changed'), 'batch must report only changed writes');

const registration = source.match(/else if \(t === 'session_list' \|\| t === 'proxy_session_snapshot'\)([\s\S]*?)else if \(t === 'session_meta_backfill'\)/);
assert(registration, 'session registration branch is missing');
assert.equal((registration[1].match(/persistSessionMetaBatch\(sessions\)/g) || []).length, 1);
assert.equal((registration[1].match(/stmtUpsertSessionMeta\.run/g) || []).length, 0, 'registration must not commit per session');
assert(registration[1].includes('session_count: proxySessions.size'), 'registration log must stay bounded');

const backfill = source.match(/else if \(t === 'session_meta_backfill'\)([\s\S]*?)else if \(t === 'status'/);
assert(backfill, 'session metadata backfill branch is missing');
assert(backfill[1].includes('persistSessionMetaBatch(sessions)'));
assert.equal((backfill[1].match(/stmtUpsertSessionMeta\.run/g) || []).length, 0, 'backfill must not commit per session');

console.log('session metadata batch smoke: PASS (registration/backfill use one change-aware transaction)');

#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('../relay-server/node_modules/better-sqlite3');
const { SqliteSessionStore, sessionExpiry } = require('../relay-server/sqlite-session-store');

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1]
  ? path.resolve(process.argv[outputIndex + 1]) : null;

function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
}

async function main() {
  const db = new Database(':memory:');
  try {
    const firstProcessStore = new SqliteSessionStore(db, { defaultTtlMs: 60_000 });
    const session = {
      cookie: { expires: new Date(Date.now() + 30_000).toISOString() },
      passport: { user: { id: 'native-session-test', email: 'operator@example.invalid' } },
    };
    await call(firstProcessStore, 'set', 'survives-container-replacement', session);

    const replacementProcessStore = new SqliteSessionStore(db, { defaultTtlMs: 60_000 });
    assert.deepStrictEqual(
      await call(replacementProcessStore, 'get', 'survives-container-replacement'),
      session,
      'a replacement relay process must recover the persisted browser session',
    );

    const touched = { ...session, cookie: { expires: new Date(Date.now() + 45_000).toISOString() } };
    await call(replacementProcessStore, 'touch', 'survives-container-replacement', touched);
    assert.deepStrictEqual(
      await call(replacementProcessStore, 'get', 'survives-container-replacement'),
      touched,
      'touch must persist the refreshed expiry and session payload',
    );

    const expired = { cookie: { expires: new Date(Date.now() - 1000).toISOString() } };
    await call(replacementProcessStore, 'set', 'expired-session', expired);
    assert.strictEqual(await call(replacementProcessStore, 'get', 'expired-session'), null);

    await call(replacementProcessStore, 'destroy', 'survives-container-replacement');
    assert.strictEqual(
      await call(replacementProcessStore, 'get', 'survives-container-replacement'),
      null,
    );
    assert(sessionExpiry({}, 1000, 5000) === 6000);

    const result = {
      ok: true,
      persistent_replacement_process_read: true,
      touch_refreshes_expiry: true,
      expired_sessions_rejected: true,
      destroy_removes_session: true,
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (outputPath) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    process.stdout.write(serialized);
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(`SQLite browser session store smoke: FAIL (${error.stack || error.message || error})`);
  process.exit(1);
});

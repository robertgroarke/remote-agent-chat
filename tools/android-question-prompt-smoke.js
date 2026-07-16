'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const component = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'PermissionPrompt.jsx'), 'utf8');
const screen = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const relay = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'lib', 'relay.js'), 'utf8');

assert.match(component, /prompt\.kind === 'question'/);
assert.match(component, /question\.multi_select/);
assert.match(component, /choice\.description/);
assert.match(component, /choice\.requires_text/);
assert.match(component, /TextInput/);
assert.match(component, /other_text/);
assert.match(component, /choice_ids/);
assert.match(screen, /respondToPermission\(sessionId, promptId, choiceId, details\)/);
assert.match(relay, /Array\.isArray\(details\.answers\)/);
console.log('Android structured question prompt parity: PASS');

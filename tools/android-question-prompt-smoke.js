'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const component = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'components', 'PermissionPrompt.jsx'), 'utf8');
const theme = JSON.parse(fs.readFileSync(path.join(
  __dirname, '..', 'android-app', 'components', 'permission-prompt-theme.json',
), 'utf8'));
const screen = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'screens', 'ChatScreen.jsx'), 'utf8');
const sessionList = fs.readFileSync(path.join(
  __dirname, '..', 'android-app', 'screens', 'SessionListScreen.jsx',
), 'utf8');
const relay = fs.readFileSync(path.join(__dirname, '..', 'android-app', 'lib', 'relay.js'), 'utf8');

assert.match(component, /prompt\.type === 'question_prompt'/);
assert.match(component, /prompt\.lifecycle !== 'open'/);
assert.match(component, /question\.multi_select/);
assert.match(component, /question\.answer_mode === 'text'/);
assert.match(component, /secureTextEntry=\{question\.secret === true\}/);
assert.match(component, /text:\s*String\(textAnswers/);
assert.match(component, /choice\.description/);
assert.match(component, /choice\.requires_text/);
assert.match(component, /TextInput/);
assert.match(component, /useColorScheme/);
assert.match(component, /permission-prompt-theme\.json/);
assert.match(component, /minHeight:\s*44/);
assert.match(component, /structured \? '\?'/);
assert.match(component, /Answer all questions to resume the native turn\./);
assert.match(component, /other_text/);
assert.match(component, /choice_ids/);
assert.match(component, /\{ action: 'cancel' \}/);
assert.match(screen, /case 'question_prompt'/);
assert.match(screen, /case 'question_prompt_state'/);
assert.match(screen, /open_question_prompts/);
assert.match(screen, /\['open', 'submitting'\]\.includes\(prompt\.lifecycle\)/,
  'Android reconnect restore must exclude retained terminal question prompts');
assert.match(screen, /previous\?\.type === 'question_prompt'/,
  'Android reconnect omission must retain an unresolved first-class question');
assert.match(screen, /\['open', 'submitting'\]\.includes\(previous\.lifecycle\)/,
  'Android question latch must be limited to unresolved lifecycle states');
assert.match(screen, /\['permission_response', 'question_response'\]\.includes\(msg\.command\)/);
assert.match(screen, /respondToPermission\(sessionId, promptId, choiceId, details, prompt\)/);
assert.match(screen, /prev\?\.prompt_id !== msg\.prompt_id \|\| prev\?\.generation !== msg\.generation/);
assert.match(screen, /prev\?\.request_id !== msg\.request_id/);
assert.ok(screen.indexOf('(msg.open_question_prompts || [])') < screen.indexOf('(msg.open_prompts || []).find'),
  'first-class reconnect restore must take precedence over a legacy permission row');
assert.match(sessionList, /case 'question_prompt'/);
assert.match(sessionList, /case 'question_prompt_state'/);
assert.match(sessionList, /open_question_prompts/);
assert.match(sessionList, /Question required/);
assert.match(sessionList, /current\?\.prompt_id !== msg\.prompt_id \|\| current\?\.generation !== msg\.generation/);
assert.match(relay, /prompt\?\.type === 'question_prompt'/);
assert.match(relay, /type: 'question_response'/);
assert.match(relay, /generation: prompt\.generation/);
assert.match(relay, /action === 'answer'/);
assert.match(relay, /Array\.isArray\(details\.answers\)/);
assert.deepStrictEqual(Object.keys(theme).sort(), ['dark', 'light']);
for (const colorScheme of ['dark', 'light']) {
  for (const key of [
    'container', 'border', 'text', 'muted', 'questionBorder', 'optionBackground',
    'optionBorder', 'selectedBackground', 'selectedBorder', 'inputBackground',
    'inputBorder', 'accent', 'submitBackground', 'submitText',
  ]) assert.match(theme[colorScheme][key], /^#[0-9a-f]{6}$/i, `${colorScheme}.${key}`);
}
console.log('Android structured question prompt parity: PASS');

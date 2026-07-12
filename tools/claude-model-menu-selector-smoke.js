#!/usr/bin/env node
'use strict';

const assert = require('assert');
const selectors = require('../agent-proxy/selectors');

function fixtureRuntime() {
  const state = {
    commandOpen: false,
    modelOpen: false,
    selectedId: 'fable',
    selections: [],
    expressions: [],
  };
  const options = [
    { id: 'default', label: 'Default (recommended)', description: 'Sonnet 5' },
    { id: 'sonnet', label: 'Sonnet', description: 'Sonnet 5' },
    { id: 'fable', label: 'Fable', description: 'Fable 5' },
    { id: 'opus', label: 'Opus', description: 'Opus 4.8' },
    { id: 'haiku', label: 'Haiku', description: 'Haiku 4.5' },
  ];

  return {
    state,
    Runtime: {
      _innerContextId: 1,
      async evaluate({ expression }) {
        state.expressions.push(expression);
        if (expression.includes("'claude_model_state'")) {
          const current = options.find(option => option.id === state.selectedId);
          return { result: { value: JSON.stringify({
            command_button: true,
            command_open: state.commandOpen,
            model_open: state.modelOpen,
            current_label: current.label,
            current_id: current.id,
            options: state.modelOpen
              ? options.map(option => ({ ...option, active: option.id === state.selectedId }))
              : [],
          }) } };
        }
        if (expression.includes("'claude_model_command_toggle'")) {
          if (state.commandOpen || state.modelOpen) {
            state.commandOpen = false;
            state.modelOpen = false;
          } else {
            state.commandOpen = true;
          }
          return { result: { value: true } };
        }
        if (expression.includes("'claude_model_open_list'")) {
          state.commandOpen = false;
          state.modelOpen = true;
          return { result: { value: true } };
        }
        if (expression.includes("'claude_model_select_option'")) {
          const match = expression.match(/var target = ("(?:[^"\\]|\\.)*");/);
          assert(match, 'selector did not embed an exact target id');
          const target = JSON.parse(match[1]);
          const option = options.find(candidate => candidate.id === target);
          if (!option) return { result: { value: JSON.stringify({ error: 'option_not_found' }) } };
          state.selectedId = target;
          state.selections.push(target);
          state.commandOpen = false;
          state.modelOpen = false;
          return { result: { value: JSON.stringify({ selected: option.label, model_id: target }) } };
        }
        if (expression.includes("'claude_model_close'")) {
          state.commandOpen = false;
          state.modelOpen = false;
          return { result: { value: true } };
        }
        throw new Error(`Unexpected selector expression: ${expression.substring(0, 160)}`);
      },
    },
  };
}

async function main() {
  const fixture = fixtureRuntime();
  const selected = await selectors.setAgentModel(
    fixture.Runtime, 'claude', 'sonnet', 'claude-model-menu-smoke'
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.model_id, 'sonnet');
  assert.equal(selected.selected, 'Sonnet');
  assert.deepEqual(selected.available_models.map(option => option.id), ['default', 'sonnet', 'fable', 'opus', 'haiku']);
  assert.deepEqual(fixture.state.selections, ['sonnet']);
  assert.equal(fixture.state.commandOpen, false);
  assert.equal(fixture.state.modelOpen, false);

  const same = await selectors.setAgentModel(
    fixture.Runtime, 'claude', 'Sonnet', 'claude-model-menu-smoke'
  );
  assert.equal(same.ok, true);
  assert.equal(same.model_id, 'sonnet');
  assert.deepEqual(fixture.state.selections, ['sonnet'], 'same-current selection must not click an option');

  const rejected = await selectors.setAgentModel(
    fixture.Runtime, 'claude', 'Run Terminal Command', 'claude-model-menu-smoke'
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'option_not_found');
  assert.deepEqual(fixture.state.selections, ['sonnet']);
  assert.equal(fixture.state.commandOpen, false);
  assert.equal(fixture.state.modelOpen, false);

  const source = fixture.state.expressions.join('\n');
  assert(source.includes('[title="Change the AI model"]'));
  assert(source.includes('[class*="modelList_"]'));
  assert(source.includes('[class*="modelItem_"]'));
  assert(source.includes('[class*="modelLabel_"]'));

  console.log(JSON.stringify({
    ok: true,
    selected: fixture.state.selectedId,
    options: selected.available_models.map(option => option.id),
    option_clicks: fixture.state.selections.length,
    menus_closed: !fixture.state.commandOpen && !fixture.state.modelOpen,
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

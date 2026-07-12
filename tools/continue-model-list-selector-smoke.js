#!/usr/bin/env node
'use strict';

const assert = require('assert');
const vm = require('vm');
const selectors = require('../agent-proxy/selectors');

function visibleElement(text = '') {
  return {
    textContent: text,
    innerText: text,
    parentElement: null,
    offsetParent: {},
    getBoundingClientRect() { return { width: 120, height: 20, top: 10, bottom: 30 }; },
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

function makeFixture() {
  let terminalClicks = 0;
  let selectedModel = null;

  const options = ['GLM5.1', 'qwen3.5:cloud(autodetected)'].map(label => {
    const option = visibleElement(label);
    option.getAttribute = name => name === 'role' ? 'option' : null;
    option.click = () => {
      selectedModel = label.replace(/\s*\(autodetected\)\s*$/i, '');
      modelButton.textContent = selectedModel;
      modelButton.innerText = selectedModel;
      modelButton.expanded = false;
    };
    return option;
  });

  const listbox = visibleElement(options.map(option => option.textContent).join(''));
  listbox.getAttribute = name => ({
    role: 'listbox',
    'aria-labelledby': 'continue-model-button',
  })[name] || null;
  listbox.querySelectorAll = selector => selector === '[role="option"]' ? options : [];
  options.forEach(option => { option.parentElement = listbox; });

  const modelButton = visibleElement('GLM5.1');
  modelButton.id = 'continue-model-button';
  modelButton.expanded = false;
  modelButton.getAttribute = name => ({
    'aria-expanded': modelButton.expanded ? 'true' : 'false',
    'aria-controls': modelButton.expanded ? 'continue-model-listbox' : null,
    'data-testid': 'model-select-button',
  })[name] || null;
  modelButton.click = () => { modelButton.expanded = !modelButton.expanded; };

  const modeButton = visibleElement('Agent');
  const terminalAction = visibleElement('Run Terminal Command');
  terminalAction.getAttribute = name => name === 'role' ? 'menuitem' : null;
  terminalAction.click = () => { terminalClicks += 1; };

  const toolbar = visibleElement('GLM5.1 Agent');
  toolbar.querySelector = selector => {
    if (selector === '[data-testid="model-select-button"]') return modelButton;
    if (selector === '[data-testid="mode-select-button"]') return modeButton;
    return null;
  };
  toolbar.querySelectorAll = () => [];

  const body = visibleElement('Run Terminal Command');
  body.innerText = 'Run Terminal Command';
  body.querySelectorAll = selector => selector.includes('[role="button"]') ? [terminalAction] : [];

  const document = {
    body,
    querySelector(selector) {
      if (selector === '[data-testid="model-select-button"]') return modelButton;
      if (selector === '[data-testid="mode-select-button"]') return modeButton;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.find-widget-skip') return [toolbar];
      if (selector.includes('[role="menuitem"]') || selector.includes('.truncate')) return [terminalAction];
      if (selector.includes('[role="button"]')) return [terminalAction];
      return [];
    },
    getElementById(id) {
      return id === 'continue-model-listbox' ? listbox : null;
    },
  };

  const runtime = {
    _innerContextId: 1,
    async evaluate({ expression }) {
      const value = vm.runInNewContext(expression, {
        document,
        window: {
          getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
          localStorage: { getItem: () => null },
        },
        console: { log() {} },
      });
      return { result: { value } };
    },
  };

  return {
    runtime,
    modelButton,
    terminalClicks: () => terminalClicks,
    selectedModel: () => selectedModel,
  };
}

async function run() {
  const fixture = makeFixture();

  const closedConfig = await selectors.readAgentConfig(fixture.runtime, 'continue', 'C:\\temp\\continue-test');
  assert.equal(closedConfig.model_id, 'GLM5.1');
  assert.equal(closedConfig.mode, 'Agent');
  assert.deepEqual(closedConfig.available_models, [], 'closed model selector must ignore unrelated terminal actions');

  fixture.modelButton.expanded = true;
  const openConfig = await selectors.readAgentConfig(fixture.runtime, 'continue', 'C:\\temp\\continue-test');
  assert.deepEqual(openConfig.available_models, ['GLM5.1', 'qwen3.5:cloud(autodetected)']);
  fixture.modelButton.expanded = false;

  const selected = await selectors.setAgentModel(fixture.runtime, 'continue', 'GLM5.1', 'continue-model-smoke');
  assert.deepEqual(selected, { ok: true, selected: 'GLM5.1' });
  assert.equal(fixture.selectedModel(), 'GLM5.1');

  const rejected = await selectors.setAgentModel(fixture.runtime, 'continue', 'Run Terminal Command', 'continue-model-smoke');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'option_not_found');
  assert.equal(fixture.terminalClicks(), 0, 'model selection must never click a terminal permission action');

  console.log('Continue model list selector smoke: PASS');
}

run().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

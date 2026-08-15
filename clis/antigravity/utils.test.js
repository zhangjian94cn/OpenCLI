import { describe, expect, it } from 'vitest';
import {
  AntigravitySessionConflictError,
  applyAntigravitySessionReply,
  askAntigravity,
  createAntigravitySessionState,
  extractAntigravityConversationsFromSnapshotText,
  extractConversationSnapshotFromDocument,
  extractLastAssistantReply,
  fingerprintConversationEntries,
  getAntigravityPageState,
  listAntigravityModels,
  openConversationInDocument,
  resolveAntigravityModelTarget,
  sendAntigravityMessage,
  setModelInDocument,
  stopAntigravityGeneration,
  validateAntigravitySessionRequest,
} from './utils.js';

class FakeElement {
  constructor(tagName, attrs = {}, text = '') {
    this.tagName = tagName.toLowerCase();
    this.attributes = { ...attrs };
    this.className = attrs.class || '';
    this.children = [];
    this.parent = null;
    this.hidden = false;
    this._text = text;
    this.clicked = false;
    this.focused = false;
    this.disabled = attrs.disabled === 'true' || attrs.disabled === true;
  }

  appendChild(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    this.children = [];
    this._text = '';
    for (const child of children) {
      this.appendChild(child);
    }
  }

  focus() {
    this.focused = true;
  }

  click() {
    this.clicked = true;
  }

  dispatchEvent() {
    return true;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === 'class') this.className = value;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  get textContent() {
    return [this._text, ...this.children.map((child) => child.textContent)].join('').trim();
  }

  set textContent(value) {
    this._text = value;
    this.children = [];
  }

  get innerText() {
    return [this._text, ...this.children.map((child) => child.innerText)].filter(Boolean).join('\n').trim();
  }

  get innerHTML() {
    return this.innerText;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  get isContentEditable() {
    return this.getAttribute('contenteditable') === 'true';
  }

  getBoundingClientRect() {
    return { left: 10, top: 10, width: 200, height: 40 };
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    const results = [];
    for (const node of this._walkDescendants()) {
      if (selectors.some((item) => matchesSelector(node, item))) {
        results.push(node);
      }
    }
    return results;
  }

  closest(selector) {
    const selectors = selector.split(',').map((item) => item.trim()).filter(Boolean);
    let current = this;
    while (current) {
      if (selectors.some((item) => matchesSelector(current, item))) {
        return current;
      }
      current = current.parent;
    }
    return null;
  }

  _walkDescendants() {
    const nodes = [];
    for (const child of this.children) {
      nodes.push(child);
      nodes.push(...child._walkDescendants());
    }
    return nodes;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
  }
}

class FakeDocument {
  constructor(body) {
    this.body = body;
    this.defaultView = {
      HTMLElement: FakeElement,
      Event: FakeEvent,
      InputEvent: FakeEvent,
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    };
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  getElementById(id) {
    return this.querySelector(`#${id.replaceAll('.', '\\.')}`);
  }

  querySelector(selector) {
    if (matchesSelector(this.body, selector)) return this.body;
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector) {
    const results = [];
    if (matchesSelector(this.body, selector)) results.push(this.body);
    return results.concat(this.body.querySelectorAll(selector));
  }
}

function matchesSelector(node, selector) {
  if (!node) return false;
  if (selector === '*') return true;
  if (selector === 'div') return node.tagName === 'div';
  if (selector === 'span') return node.tagName === 'span';
  if (selector === 'button') return node.tagName === 'button';
  if (selector === 'li') return node.tagName === 'li';
  if (selector === 'textarea') return node.tagName === 'textarea';
  if (selector === 'input[type="text"]') return node.tagName === 'input' && node.getAttribute('type') === 'text';
  if (selector === '[contenteditable="true"]') return node.getAttribute('contenteditable') === 'true';
  if (selector === '[data-lexical-editor="true"]') return node.getAttribute('data-lexical-editor') === 'true';
  if (selector === '[data-testid="conversation"]') return node.getAttribute('data-testid') === 'conversation';
  if (selector === '[data-testid="conversation-view"]') return node.getAttribute('data-testid') === 'conversation-view';
  if (selector === '[data-testid="composer"]') return node.getAttribute('data-testid') === 'composer';
  if (selector === '[data-testid="chat-composer"]') return node.getAttribute('data-testid') === 'chat-composer';
  if (selector === '[data-testid="model-selector"]') return node.getAttribute('data-testid') === 'model-selector';
  if (selector === '[data-testid="send-button"]') return node.getAttribute('data-testid') === 'send-button';
  if (selector === '[data-testid="new-conversation"]') return node.getAttribute('data-testid') === 'new-conversation';
  if (selector === '[role="article"]') return node.getAttribute('role') === 'article';
  if (selector === '[role="dialog"]') return node.getAttribute('role') === 'dialog';
  if (selector === '[role="listbox"]') return node.getAttribute('role') === 'listbox';
  if (selector === '[role="option"]') return node.getAttribute('role') === 'option';
  if (selector === '[role="button"]') return node.getAttribute('role') === 'button';
  if (selector === '[data-tooltip-id="new-conversation-tooltip"]') {
    return node.getAttribute('data-tooltip-id') === 'new-conversation-tooltip';
  }
  if (selector === '.overflow-y-auto') return node.className.split(/\s+/).includes('overflow-y-auto');
  if (selector === '.cursor-pointer') return node.className.split(/\s+/).includes('cursor-pointer');
  if (selector === '[aria-haspopup="dialog"] > div[tabindex="0"]') {
    return node.tagName === 'div'
      && node.getAttribute('tabindex') === '0'
      && node.parent?.getAttribute('aria-haspopup') === 'dialog';
  }
  if (selector === 'div[aria-haspopup="dialog"] > div[tabindex="0"]') {
    return node.tagName === 'div'
      && node.getAttribute('tabindex') === '0'
      && node.parent?.tagName === 'div'
      && node.parent?.getAttribute('aria-haspopup') === 'dialog';
  }
  if (selector === 'button[aria-haspopup="dialog"]') {
    return node.tagName === 'button' && node.getAttribute('aria-haspopup') === 'dialog';
  }
  if (selector === 'button[aria-label^="Select model" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().startsWith('select model');
  }
  if (selector === 'button[aria-label*="select model" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().includes('select model');
  }
  if (selector === 'button[aria-label*="current:" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().includes('current:');
  }
  if (selector === 'button[type="submit"]') {
    return node.tagName === 'button' && node.getAttribute('type') === 'submit';
  }
  if (selector === 'button[aria-label*="send" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().includes('send');
  }
  if (selector === 'button[title*="send" i]') {
    return node.tagName === 'button' && (node.getAttribute('title') || '').toLowerCase().includes('send');
  }
  if (selector === 'button[aria-label*="cancel" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().includes('cancel');
  }
  if (selector === 'button[aria-label*="stop" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().includes('stop');
  }
  if (selector === 'button[title*="cancel" i]') {
    return node.tagName === 'button' && (node.getAttribute('title') || '').toLowerCase().includes('cancel');
  }
  if (selector === 'button[title*="stop" i]') {
    return node.tagName === 'button' && (node.getAttribute('title') || '').toLowerCase().includes('stop');
  }
  if (selector === 'button[aria-label*="new conversation" i]') {
    return node.tagName === 'button' && (node.getAttribute('aria-label') || '').toLowerCase().includes('new conversation');
  }
  if (selector === 'button[title*="new conversation" i]') {
    return node.tagName === 'button' && (node.getAttribute('title') || '').toLowerCase().includes('new conversation');
  }
  if (selector === '[aria-label*="model" i]') {
    return (node.getAttribute('aria-label') || '').toLowerCase().includes('model');
  }
  if (selector.startsWith('#')) {
    const id = selector.slice(1).replaceAll('\\.', '.');
    return node.getAttribute('id') === id;
  }
  const idMatch = selector.match(/^\[id="(.+)"\]$/);
  if (idMatch) {
    return node.getAttribute('id') === idMatch[1];
  }
  return false;
}

function createConversationFixture() {
  const body = new FakeElement('body');

  const conversation = body.appendChild(new FakeElement('div', { id: 'conversation' }));
  const conversationInner = conversation.appendChild(new FakeElement('div'));
  const scroll = conversationInner.appendChild(new FakeElement('div', { class: 'overflow-y-auto' }));
  scroll.appendChild(new FakeElement('div', { 'data-message-role': 'user' }, 'First question'));
  const assistant = scroll.appendChild(new FakeElement('div', { class: 'assistant-message' }));
  assistant.appendChild(new FakeElement('div', {}, 'Thought for 2s'));
  assistant.appendChild(new FakeElement('div', {}, 'Answer text'));
  assistant.appendChild(new FakeElement('button', {}, 'Copy'));
  scroll.appendChild(new FakeElement('div', { 'data-message-role': 'user' }, 'Follow up'));

  const composer = body.appendChild(new FakeElement('div', { id: 'antigravity.agentSidePanelInputBox' }));
  composer.appendChild(new FakeElement('div', { 'data-lexical-editor': 'true', contenteditable: 'true' }));
  composer.appendChild(new FakeElement('button', { 'aria-label': 'Send prompt', type: 'submit' }, 'Send'));

  const modelShell = body.appendChild(new FakeElement('div', { 'aria-haspopup': 'dialog' }));
  modelShell.appendChild(new FakeElement('div', { tabindex: '0' }, 'Claude Sonnet 4.6'));
  const dialog = body.appendChild(new FakeElement('div', { role: 'dialog' }));
  dialog.appendChild(new FakeElement('div', { class: 'cursor-pointer' })).appendChild(new FakeElement('span', {}, 'Claude Sonnet 4.6'));
  dialog.appendChild(new FakeElement('div', { class: 'cursor-pointer' })).appendChild(new FakeElement('span', {}, 'Gemini 3 Flash'));

  return new FakeDocument(body);
}

function createAntigravity206Fixture() {
  const body = new FakeElement('body');

  const conversation = body.appendChild(new FakeElement('div', { 'data-testid': 'conversation-view' }));
  const user = conversation.appendChild(new FakeElement('div', { role: 'article', 'aria-label': 'User message' }));
  user.appendChild(new FakeElement('div', { 'data-testid': 'user-input-step' }, 'OpenCLI smoke test. Reply exactly: OK'));
  const assistant = conversation.appendChild(new FakeElement('div', { role: 'article', 'aria-label': 'Agent response' }));
  assistant.appendChild(new FakeElement('button', {}, 'Thought for 1s'));
  assistant.appendChild(new FakeElement('p', {}, 'OK'));

  const composer = body.appendChild(new FakeElement('div', { id: 'antigravity.agentSidePanelInputBox' }));
  composer.appendChild(new FakeElement('div', { 'data-lexical-editor': 'true', contenteditable: 'true' }));
  composer.appendChild(new FakeElement('button', { 'data-testid': 'send-button', 'aria-label': 'Record voice memo' }));

  body.appendChild(new FakeElement('div', { role: 'button' }, 'New Conversation'));
  body.appendChild(new FakeElement('button', { 'aria-haspopup': 'dialog', 'aria-label': 'Display Options' }, 'Display Options'));

  const modelButton = body.appendChild(new FakeElement('button', {
    'aria-haspopup': 'dialog',
    'aria-label': 'Select model, current: Claude Opus 4.6 (Thinking)',
  }));
  modelButton.appendChild(new FakeElement('span', {}, 'Claude Opus 4.6 (Thinking)'));

  const dialog = body.appendChild(new FakeElement('div', { role: 'dialog' }));
  dialog.appendChild(new FakeElement('div', { class: 'cursor-pointer' })).appendChild(new FakeElement('span', {}, 'Claude Opus 4.6 (Thinking)'));
  const geminiOption = dialog.appendChild(new FakeElement('div', { class: 'cursor-pointer' }));
  geminiOption.appendChild(new FakeElement('span', {}, 'Gemini 3.5 Flash (High)'));
  geminiOption.click = () => {
    geminiOption.clicked = true;
    modelButton.textContent = 'Gemini 3.5 Flash (High)';
    modelButton.setAttribute('aria-label', 'Select model, current: Gemini 3.5 Flash (High)');
  };

  return new FakeDocument(body);
}

function createPage(document, options = {}) {
  return {
    evaluate: async (js) => {
      if (js === 'window.location.href') {
        return options.url || 'https://127.0.0.1:60857/c/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      }
      if (js === 'document.title') {
        return options.title || 'Active Session';
      }
      return Function('document', `return ${js}`)(document);
    },
    snapshot: async () => options.snapshot || '',
    wait: async () => {},
    nativeKeyPress: async () => {},
  };
}

describe('antigravity DOM helpers', () => {
  it('extracts structured messages and honors the last option', () => {
    const document = createConversationFixture();

    const snapshot = extractConversationSnapshotFromDocument(document, { last: 2 });

    expect(snapshot.messageCount).toBe(3);
    expect(snapshot.messages).toEqual([
      { index: 1, role: 'assistant', content: 'Thought for 2s\nAnswer text' },
      { index: 2, role: 'user', content: 'Follow up' },
    ]);
    expect(snapshot.currentModel).toBe('Claude Sonnet 4.6');
    expect(snapshot.hasEditor).toBe(true);
    expect(snapshot.hasSendButton).toBe(true);
  });

  it('supports Antigravity 2.0.6 conversation-view and article markup', () => {
    const document = createAntigravity206Fixture();

    const snapshot = extractConversationSnapshotFromDocument(document);

    expect(snapshot.available).toBe(true);
    expect(snapshot.hasSendButton).toBe(true);
    expect(snapshot.messages).toEqual([
      { index: 0, role: 'user', content: 'OpenCLI smoke test. Reply exactly: OK' },
      { index: 1, role: 'assistant', content: 'Thought for 1s\nOK' },
    ]);
  });

  it('targets the Antigravity 2.0.6 model selector before generic dialog buttons', async () => {
    const document = createAntigravity206Fixture();

    const result = await setModelInDocument(document, 'gemini 3.5 flash high');

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.selectedModel).toBe('Gemini 3.5 Flash (High)');
    expect(result.availableModels).toContain('Gemini 3.5 Flash (High)');
  });

  it('extracts the last assistant reply and strips echoed boilerplate', () => {
    const reply = extractLastAssistantReply({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello\nThought for 3s\nDone\nCopy' },
      ],
    }, 'Hello');

    expect(reply).toBe('Done');
  });

  it('does not strip natural assistant greetings that start with the user text', () => {
    const reply = extractLastAssistantReply({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hello! I am ready to help.' },
      ],
    }, 'Hello');

    expect(reply).toBe('Hello! I am ready to help.');
  });

  it('selects models from the dropdown using shared selectors', async () => {
    const document = createConversationFixture();

    const result = await setModelInDocument(document, 'gemini 3 flash');

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.selectedModel).toBe('Gemini 3 Flash');
    expect(result.availableModels).toContain('Gemini 3 Flash');
  });

  it('clears controlled composer text before native send to avoid repeated prompts', async () => {
    const document = createAntigravity206Fixture();
    const editor = document.querySelector('[contenteditable="true"]');
    const sendButton = document.querySelector('[data-testid="send-button"]');
    const conversation = document.querySelector('[data-testid="conversation-view"]');
    editor.textContent = 'HelloHelloHello';
    sendButton.disabled = true;
    let selectedAll = false;

    const page = {
      evaluate: async (js) => {
        if (js === 'window.location.href') {
          return 'https://127.0.0.1:60857/c/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
        }
        if (js === 'document.title') {
          return 'Active Session';
        }
        const evaluateDocument = document;
        return Function('document', `return ${js}`)(evaluateDocument);
      },
      wait: async () => {},
      nativeKeyPress: async (key, modifiers = []) => {
        if (key === 'a' && (modifiers.includes('Meta') || modifiers.includes('Ctrl'))) {
          selectedAll = true;
          return;
        }
        if (key === 'Backspace' && selectedAll) {
          editor.textContent = '';
          selectedAll = false;
        }
        if (key === 'Enter') {
          conversation.appendChild(new FakeElement('div', { role: 'article', 'aria-label': 'User message' }, editor.textContent));
          editor.textContent = '';
        }
      },
      nativeType: async (text) => {
        if (selectedAll) {
          editor.textContent = text;
          selectedAll = false;
        } else {
          editor.textContent = `${editor.textContent}${text}`;
        }
      },
    };

    const result = await sendAntigravityMessage(page, 'Hello');

    expect(result).toBe('native-enter');
    expect(editor.textContent).toBe('');
    expect(sendButton.clicked).toBe(false);
  });

  it('does not report sent when Antigravity does not accept the composer text', async () => {
    const document = createAntigravity206Fixture();
    const sendButton = document.querySelector('[data-testid="send-button"]');
    sendButton.disabled = true;
    const page = createPage(document);

    await expect(sendAntigravityMessage(page, 'Hello')).rejects.toThrow(/send was not verified/);
    expect(sendButton.clicked).toBe(false);
  });

  it('extracts visible sidebar conversations from an Antigravity snapshot', () => {
    const snapshot = `
url: https://127.0.0.1:60857/c/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa?section=1
title: Active Session
viewport: 1352x847
---
  [10]<div role=button tabindex=0 aria-expanded=true />
    <div />
      <div>zhangjian-skills</div>
  [12]<span data-testid=convo-pill-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa>Active Session</span>
    <div />
      <span>12m</span>
  [14]<span data-testid=convo-pill-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb>Older &amp; Escaped</span>
    <div />
      <span>1d</span>
  [15]<button>See all (32)</button>
  [20]<div role=button tabindex=0 aria-expanded=true />
    <div />
      <div>lingxi-ai-framework</div>
  [22]<span data-testid=convo-pill-cccccccc-cccc-4ccc-cccc-cccccccccccc>Reviewing PRs</span>
    <div />
      <span>2d</span>
  [30]<button aria-label=Select model, current: Gemini 3.5 Flash Medium />
`;

    const result = extractAntigravityConversationsFromSnapshotText(JSON.stringify(snapshot));

    expect(result.ok).toBe(true);
    expect(result.current.conversation_id).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    expect(result.current.model).toBe('Gemini 3.5 Flash Medium');
    expect(result.visible_conversation_count).toBe(3);
    expect(result.projects[0].name).toBe('zhangjian-skills');
    expect(result.projects[0].see_all_count).toBe(32);
    expect(result.projects[0].conversations[0].current).toBe(true);
    expect(result.projects[0].conversations[1].title).toBe('Older & Escaped');
  });

  it('returns compact page state for one-shot control', async () => {
    const document = createAntigravity206Fixture();
    const page = createPage(document, {
      url: 'https://127.0.0.1:60857/c/bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
      title: 'State Test',
    });

    const state = await getAntigravityPageState(page, { last: 1 });

    expect(state.ok).toBe(true);
    expect(state.title).toBe('State Test');
    expect(state.conversation_id).toBe('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
    expect(state.model).toBe('Claude Opus 4.6 (Thinking)');
    expect(state.has_editor).toBe(true);
    expect(state.has_send_button).toBe(true);
    expect(state.messages).toHaveLength(1);
  });

  it('lists visible models without changing the selected model', async () => {
    const document = createAntigravity206Fixture();
    const page = createPage(document);

    const result = await listAntigravityModels(page);

    expect(result.ok).toBe(true);
    expect(result.currentModel).toBe('Claude Opus 4.6 (Thinking)');
    expect(result.availableModels).toContain('Gemini 3.5 Flash (High)');
  });

  it('opens a visible conversation by id or title', () => {
    const body = new FakeElement('body');
    const row = body.appendChild(new FakeElement('div', { role: 'button' }));
    const pill = row.appendChild(new FakeElement('span', {
      'data-testid': 'convo-pill-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    }, 'Target Conversation'));
    const document = new FakeDocument(body);

    const result = openConversationInDocument(document, 'Target');

    expect(result.ok).toBe(true);
    expect(result.id).toBe('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
    expect(pill.clicked || row.clicked).toBe(true);
  });

  it('stops generation via the visible stop button and reports before/after state', async () => {
    const document = createAntigravity206Fixture();
    const stopButton = document.body.appendChild(new FakeElement('button', { 'aria-label': 'Stop generation' }, 'Stop'));
    const generating = document.querySelector('[data-testid="conversation-view"]');
    generating.appendChild(new FakeElement('div', { role: 'status' }, 'Generating response'));
    const page = createPage(document);

    const result = await stopAntigravityGeneration(page);

    expect(result.ok).toBe(true);
    expect(result.stopped).toBe(true);
    expect(stopButton.clicked).toBe(true);
    expect(result.state_before.ok).toBe(true);
    expect(result.state_after.ok).toBe(true);
  });

  it('treats stop as a no-op when Antigravity is already idle', async () => {
    const document = createAntigravity206Fixture();
    const page = createPage(document);

    const result = await stopAntigravityGeneration(page);

    expect(result.ok).toBe(true);
    expect(result.stopped).toBe(false);
    expect(result.reason).toBe('not_generating');
    expect(result.state_before.ok).toBe(true);
    expect(result.state_after).toEqual(result.state_before);
  });

  it('runs ask as new -> model -> send -> wait and returns the reply', async () => {
    const document = createAntigravity206Fixture();
    const conversation = document.querySelector('[data-testid="conversation-view"]');
    const sendButton = document.querySelector('[data-testid="send-button"]');
    const editor = document.querySelector('[contenteditable="true"]');
    sendButton.click = () => {
      sendButton.clicked = true;
      conversation.appendChild(new FakeElement('div', { role: 'article', 'aria-label': 'User message' }, editor.textContent));
      conversation.appendChild(new FakeElement('div', { role: 'article', 'aria-label': 'Agent response' }, 'Done response'));
    };
    const page = createPage(document);

    const result = await askAntigravity(page, {
      message: 'Hello',
      model: 'gemini 3.5 flash high',
      'new-conversation': true,
      wait: true,
      timeout: 2,
      'read-last': 4,
    });

    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => step.name)).toEqual(['new', 'model', 'send', 'wait']);
    expect(result.reply).toBe('Done response');
    expect(result.messages.at(-1).content).toBe('Done response');
  });
});

describe('antigravity session state helpers', () => {
  it('validates a continued session when request history and UI fingerprints match', () => {
    const state = createAntigravitySessionState();
    const afterSnapshot = {
      textFingerprint: fingerprintConversationEntries([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ], { includeRoles: false }),
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      currentModel: 'Claude Sonnet 4.6',
    };

    applyAntigravitySessionReply({
      sessionState: state,
      bodyMessages: [{ role: 'user', content: 'Hello' }],
      afterSnapshot,
      replyText: 'Hi there',
      model: 'Claude Sonnet 4.6',
    });

    const validation = validateAntigravitySessionRequest({
      bodyMessages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Follow up' },
      ],
      currentSnapshot: afterSnapshot,
      sessionState: state,
    });

    expect(validation.mode).toBe('continue');
  });

  it('raises a 409-style conflict when the UI drifted from tracked state', () => {
    const state = createAntigravitySessionState();
    state.active = true;
    state.apiHistoryTextFingerprint = fingerprintConversationEntries([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ], { includeRoles: false });
    state.uiTextFingerprint = fingerprintConversationEntries([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ], { includeRoles: false });

    expect(() => validateAntigravitySessionRequest({
      bodyMessages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Follow up' },
      ],
      currentSnapshot: {
        messages: [{ role: 'user', content: 'Manual edit happened' }],
        textFingerprint: fingerprintConversationEntries([
          { role: 'user', content: 'Manual edit happened' },
        ], { includeRoles: false }),
      },
      sessionState: state,
    })).toThrow(AntigravitySessionConflictError);
  });

  it('maps serve model aliases through a centralized resolver', () => {
    expect(resolveAntigravityModelTarget('claude-sonnet-4')).toEqual({
      requested: 'claude-sonnet-4',
      target: 'claude sonnet 4.6',
      matched: true,
    });
    expect(resolveAntigravityModelTarget('Gemini 3.5 Flash Medium')).toEqual({
      requested: 'Gemini 3.5 Flash Medium',
      target: 'gemini 3.5 flash (medium)',
      matched: true,
    });
    expect(resolveAntigravityModelTarget('unknown-custom-model')).toEqual({
      requested: 'unknown-custom-model',
      target: 'unknown-custom-model',
      matched: false,
    });
  });
});

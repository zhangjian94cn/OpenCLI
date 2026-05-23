import { createHash } from 'node:crypto';

const CONVERSATION_SELECTORS = [
  '#conversation',
  '[data-testid="conversation"]',
  '[data-testid="conversation-view"]',
];
const MODEL_TRIGGER_SELECTORS = [
  'button[aria-label^="Select model" i]',
  'button[aria-label*="select model" i]',
  'button[aria-label*="current:" i]',
  '[data-testid="model-selector"]',
  '[aria-label*="model" i]',
  'div[aria-haspopup="dialog"] > div[tabindex="0"]',
  '[aria-haspopup="dialog"] > div[tabindex="0"]',
  'button[aria-haspopup="dialog"]',
];
const COMPOSER_SELECTORS = [
  '#antigravity\\.agentSidePanelInputBox',
  '[id="antigravity.agentSidePanelInputBox"]',
  '[data-testid="composer"]',
  '[data-testid="chat-composer"]',
];
const EDITOR_SELECTORS = [
  '[data-lexical-editor="true"]',
  '[contenteditable="true"]',
  'textarea',
  'input[type="text"]',
];
const SEND_BUTTON_SELECTORS = [
  '[data-testid="send-button"]',
  'button[aria-label*="send" i]',
  'button[title*="send" i]',
  'button[type="submit"]',
];
const STOP_BUTTON_SELECTORS = [
  'button[aria-label*="cancel" i]',
  'button[aria-label*="stop" i]',
  'button[title*="cancel" i]',
  'button[title*="stop" i]',
];
const NEW_CONVERSATION_SELECTORS = [
  '[data-tooltip-id="new-conversation-tooltip"]',
  'button[aria-label*="new conversation" i]',
  'button[title*="new conversation" i]',
  '[data-testid="new-conversation"]',
];

const MODEL_ALIASES = [
  { pattern: /sonnet/i, target: 'claude sonnet 4.6' },
  { pattern: /opus/i, target: 'claude opus 4.6' },
  { pattern: /gemini.*pro/i, target: 'gemini 3.1 pro (high)' },
  { pattern: /gemini.*3\.?5.*flash.*high/i, target: 'gemini 3.5 flash (high)' },
  { pattern: /gemini.*3\.?5.*flash.*medium/i, target: 'gemini 3.5 flash (medium)' },
  { pattern: /gemini.*flash/i, target: 'gemini 3.5 flash' },
  { pattern: /gpt/i, target: 'gpt-oss 120b' },
];

export class AntigravitySessionConflictError extends Error {
  constructor(message, code = 'history_conflict') {
    super(message);
    this.name = 'AntigravitySessionConflictError';
    this.code = code;
    this.statusCode = 409;
  }
}

export function serializePageFunction(fn, ...args) {
  const serializedArgs = args.length > 0 ? `, ${args.map((arg) => JSON.stringify(arg)).join(', ')}` : '';
  return `(${fn.toString()})(document${serializedArgs})`;
}

export function extractTextFromApiContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function normalizeApiMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message, index) => ({
      index,
      role: String(message?.role || 'user').toLowerCase(),
      content: extractTextFromApiContent(message?.content).trim(),
    }))
    .filter((entry) => entry.content.length > 0);
}

export function fingerprintConversationEntries(entries, { includeRoles = false } = {}) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const role = String(entry?.role || 'unknown').toLowerCase();
      const content = String(entry?.content || '').replace(/\r/g, '').trim();
      return includeRoles ? `${role}::${content}` : content;
    })
    .filter(Boolean)
    .join('\n\n');
  return createHash('sha1').update(normalized).digest('hex');
}

export function resolveAntigravityModelTarget(requestedModel) {
  const requested = String(requestedModel || '').trim();
  if (!requested) {
    return { requested: '', target: '', matched: false };
  }
  const lower = requested.toLowerCase();
  const match = MODEL_ALIASES.find((item) => item.pattern.test(lower));
  if (match) {
    return { requested, target: match.target, matched: true };
  }
  return { requested, target: requested.toLowerCase(), matched: false };
}

export function createAntigravitySessionState() {
  return {
    active: false,
    apiHistoryTextFingerprint: '',
    uiTextFingerprint: '',
    lastModel: '',
    requestCount: 0,
  };
}

export function resetAntigravitySessionState(sessionState) {
  sessionState.active = false;
  sessionState.apiHistoryTextFingerprint = '';
  sessionState.uiTextFingerprint = '';
  sessionState.lastModel = '';
  sessionState.requestCount = 0;
}

export function validateAntigravitySessionRequest({ bodyMessages, currentSnapshot, sessionState }) {
  const historyEntries = normalizeApiMessages((Array.isArray(bodyMessages) ? bodyMessages : []).slice(0, -1));
  const requestHistoryTextFingerprint = fingerprintConversationEntries(historyEntries, { includeRoles: false });
  const isExplicitNewConversation = (Array.isArray(bodyMessages) ? bodyMessages : []).length <= 1;

  if (isExplicitNewConversation) {
    return {
      mode: 'reset',
      historyEntries,
      requestHistoryTextFingerprint,
    };
  }

  if (sessionState?.active) {
    if (requestHistoryTextFingerprint !== sessionState.apiHistoryTextFingerprint) {
      throw new AntigravitySessionConflictError(
        'Requested history does not match the last completed Antigravity session state.',
        'history_mismatch',
      );
    }
    if ((currentSnapshot?.textFingerprint || '') !== (sessionState.uiTextFingerprint || '')) {
      throw new AntigravitySessionConflictError(
        'Current Antigravity UI content has drifted from the tracked session state.',
        'ui_state_drift',
      );
    }
    return {
      mode: 'continue',
      historyEntries,
      requestHistoryTextFingerprint,
    };
  }

  if (!currentSnapshot?.messages?.length) {
    throw new AntigravitySessionConflictError(
      'No active Antigravity UI session is loaded for the requested history.',
      'missing_ui_history',
    );
  }

  if ((currentSnapshot?.textFingerprint || '') !== requestHistoryTextFingerprint) {
    throw new AntigravitySessionConflictError(
      'Requested history does not match the current Antigravity UI state.',
      'ui_history_mismatch',
    );
  }

  return {
    mode: 'attach',
    historyEntries,
    requestHistoryTextFingerprint,
  };
}

export function applyAntigravitySessionReply({ sessionState, bodyMessages, afterSnapshot, replyText, model }) {
  const nextHistoryEntries = normalizeApiMessages([
    ...(Array.isArray(bodyMessages) ? bodyMessages : []),
    { role: 'assistant', content: replyText },
  ]);
  sessionState.active = true;
  sessionState.apiHistoryTextFingerprint = fingerprintConversationEntries(nextHistoryEntries, { includeRoles: false });
  sessionState.uiTextFingerprint = afterSnapshot?.textFingerprint || '';
  sessionState.lastModel = String(model || afterSnapshot?.currentModel || '').trim();
  sessionState.requestCount = (sessionState.requestCount || 0) + 1;
}

export function extractConversationSnapshotFromDocument(doc, options = {}) {
  const win = doc?.defaultView || globalThis.window;
  const HTMLElementCtor = win?.HTMLElement;
  const conversationSelectors = [
    '#conversation',
    '[data-testid="conversation"]',
    '[data-testid="conversation-view"]',
  ];
  const modelTriggerSelectors = [
    'button[aria-label^="Select model" i]',
    'button[aria-label*="select model" i]',
    'button[aria-label*="current:" i]',
    '[data-testid="model-selector"]',
    '[aria-label*="model" i]',
    'div[aria-haspopup="dialog"] > div[tabindex="0"]',
    '[aria-haspopup="dialog"] > div[tabindex="0"]',
    'button[aria-haspopup="dialog"]',
  ];
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const editorSelectors = [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];
  const sendButtonSelectors = [
    '[data-testid="send-button"]',
    'button[aria-label*="send" i]',
    'button[title*="send" i]',
    'button[type="submit"]',
  ];
  const stopButtonSelectors = [
    'button[aria-label*="cancel" i]',
    'button[aria-label*="stop" i]',
    'button[title*="cancel" i]',
    'button[title*="stop" i]',
  ];

  const normalizeText = (value) =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

  const isElement = (value) => !!HTMLElementCtor && value instanceof HTMLElementCtor;
  const isVisible = (element) => {
    if (!isElement(element)) return false;
    if (element.hidden) return false;
    if ((element.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return false;
    if (win?.getComputedStyle) {
      const style = win.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };

  const getText = (element) => {
    if (!isElement(element)) return '';
    return normalizeText(element.innerText || element.textContent || '');
  };

  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (isElement(node) && isVisible(node)) return node;
    }
    return null;
  };

  const candidateChildren = (root) =>
    Array.from(root?.children || []).filter((child) => isVisible(child) && getText(child).length > 0);

  const findMessageContainer = (root, depth = 0) => {
    if (!isElement(root) || depth > 12) return null;
    const children = candidateChildren(root);
    if (children.length >= 2) return root;
    if (children.length === 1) return findMessageContainer(children[0], depth + 1);
    const descendants = Array.from(root.querySelectorAll('*')).filter((node) => isVisible(node));
    for (const descendant of descendants) {
      const nestedChildren = candidateChildren(descendant);
      if (nestedChildren.length >= 2) return descendant;
    }
    return root;
  };

  const guessRole = (node, index) => {
    const metadata = normalizeText([
      node.getAttribute('data-message-role'),
      node.getAttribute('data-role'),
      node.getAttribute('data-testid'),
      node.getAttribute('aria-label'),
      node.className,
    ].join(' ')).toLowerCase();
    if (/\b(user|human|prompt)\b|user message/.test(metadata)) return 'user';
    if (/\b(assistant|ai|model|response|agent)\b|agent response/.test(metadata)) return 'assistant';
    const text = getText(node);
    if (/thought for/i.test(text) || /\bcopy\b/i.test(text)) return 'assistant';
    return index % 2 === 0 ? 'user' : 'assistant';
  };

  const conversationRoot = queryFirst(doc, conversationSelectors);
  const scrollRoot = conversationRoot?.querySelector('.overflow-y-auto, [data-radix-scroll-area-viewport], [data-testid="conversation-scroll"]')
    || conversationRoot?.firstElementChild
    || conversationRoot;
  const messageContainer = findMessageContainer(scrollRoot);
  const articleNodes = Array.from(conversationRoot?.querySelectorAll('[role="article"]') || [])
    .filter((node) => isVisible(node) && getText(node).length > 0);
  const messageNodes = articleNodes.length > 0 ? articleNodes : candidateChildren(messageContainer);
  let messages = messageNodes.map((node, index) => {
    const role = guessRole(node, index);
    let content = getText(node);
    if (role === 'assistant') {
      content = content
        .replace(/\n+\s*Copy\s*$/m, '')
        .replace(/\n+\s*Good response\s*$/m, '')
        .replace(/\n+\s*Bad response\s*$/m, '')
        .trim();
    }
    return { index, role, content };
  }).filter((message) => message.content.length > 0);

  const last = Number(options?.last || 0);
  if (Number.isFinite(last) && last > 0) {
    messages = messages.slice(-last);
  }

  const composer = queryFirst(doc, composerSelectors);
  const editor = composer ? queryFirst(composer, editorSelectors) : queryFirst(doc, editorSelectors);
  const sendButton = composer ? queryFirst(composer, sendButtonSelectors) : queryFirst(doc, sendButtonSelectors);
  const modelTrigger = queryFirst(doc, modelTriggerSelectors);
  const stopButton = queryFirst(doc, stopButtonSelectors);

  return {
    available: !!conversationRoot,
    conversationText: messages.map((message) => `${message.role}: ${message.content}`).join('\n\n'),
    currentModel: normalizeText(modelTrigger?.textContent || ''),
    hasEditor: !!editor,
    hasSendButton: !!sendButton,
    isGenerating: !!stopButton,
    messageCount: messages.length,
    messages,
  };
}

export function prepareComposerInDocument(doc, options = {}) {
  const win = doc?.defaultView || globalThis.window;
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const editorSelectors = [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];
  const normalizeText = (value) => String(value || '').replace(/\r/g, '').trim();
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const composer = queryFirst(doc, composerSelectors) || doc;
  const editor = queryFirst(composer, editorSelectors);
  if (!editor) {
    return { ok: false, reason: 'Could not find Antigravity input box' };
  }
  editor.focus?.();
  if (options?.clear) {
    try {
      if ('select' in editor) {
        editor.select();
      } else if (win?.getSelection && doc.createRange) {
        const range = doc.createRange();
        range.selectNodeContents(editor);
        const selection = win.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      doc.execCommand?.('delete', false, null);
    } catch {
      // Fall back to direct value/text mutation below.
    }
    if (normalizeText('value' in editor ? editor.value : editor.textContent || '')) {
      if ('value' in editor) {
        editor.value = '';
      } else if ('replaceChildren' in editor) {
        editor.replaceChildren();
      } else {
        editor.textContent = '';
      }
    }
    const inputEvent = win.InputEvent
      ? new win.InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward',
      })
      : new win.Event('input', { bubbles: true });
    editor.dispatchEvent?.(inputEvent);
    editor.dispatchEvent?.(new win.Event('change', { bubbles: true }));
  }
  return {
    ok: true,
    text: normalizeText('value' in editor ? editor.value : editor.textContent || ''),
  };
}

export function clearComposerInDocument(doc) {
  const win = doc?.defaultView || globalThis.window;
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const editorSelectors = [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];
  const normalizeText = (value) =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .trim();
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const composer = queryFirst(doc, composerSelectors) || doc;
  const editor = queryFirst(composer, editorSelectors);
  if (!editor) return { ok: false, reason: 'Could not find Antigravity input box', hasText: false, text: '' };

  editor.focus?.();
  try {
    if ('select' in editor) {
      editor.select();
    } else if (win?.getSelection && doc.createRange) {
      const range = doc.createRange();
      range.selectNodeContents(editor);
      const selection = win.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    doc.execCommand?.('delete', false, null);
  } catch {
    // Direct mutation below is a fallback for DOM implementations without Selection APIs.
  }

  let text = normalizeText('value' in editor ? editor.value : editor.textContent || '');
  if (text) {
    if ('value' in editor) {
      editor.value = '';
    } else if ('replaceChildren' in editor) {
      editor.replaceChildren();
    } else {
      editor.textContent = '';
    }
  }

  const inputEvent = win.InputEvent
    ? new win.InputEvent('input', {
      bubbles: true,
      inputType: 'deleteContentBackward',
    })
    : new win.Event('input', { bubbles: true });
  editor.dispatchEvent?.(inputEvent);
  editor.dispatchEvent?.(new win.Event('change', { bubbles: true }));

  text = normalizeText('value' in editor ? editor.value : editor.textContent || '');
  return {
    ok: true,
    hasText: text.length > 0,
    text,
  };
}

export function composerStateInDocument(doc) {
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const editorSelectors = [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];
  const normalizeText = (value) =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .trim();
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const composer = queryFirst(doc, composerSelectors) || doc;
  const editor = queryFirst(composer, editorSelectors);
  if (!editor) return { hasText: false, text: '' };
  const text = normalizeText('value' in editor ? editor.value : editor.textContent || '');
  return {
    hasText: text.length > 0,
    text,
  };
}

export function composerRectInDocument(doc) {
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const editorSelectors = [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const composer = queryFirst(doc, composerSelectors) || doc;
  const editor = queryFirst(composer, editorSelectors);
  if (!editor?.getBoundingClientRect) return null;
  const rect = editor.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function fillComposerInDocument(doc, text) {
  const win = doc?.defaultView || globalThis.window;
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const editorSelectors = [
    '[data-lexical-editor="true"]',
    '[contenteditable="true"]',
    'textarea',
    'input[type="text"]',
  ];
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const composer = queryFirst(doc, composerSelectors) || doc;
  const editor = queryFirst(composer, editorSelectors);
  if (!editor) return { hasText: false, text: '', ok: false };
  editor.focus?.();
  if ('value' in editor) {
    editor.value = text;
  } else if (editor.isContentEditable) {
    let inserted = false;
    try {
      if (win?.getSelection && doc.createRange) {
        const range = doc.createRange();
        range.selectNodeContents(editor);
        const selection = win.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      inserted = !!doc.execCommand?.('insertText', false, text);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      if ('replaceChildren' in editor) {
        const paragraph = doc.createElement('p');
        paragraph.textContent = text;
        editor.replaceChildren(paragraph);
      } else {
        editor.textContent = text;
      }
    }
  } else {
    editor.textContent = text;
  }
  editor.dispatchEvent?.(new win.InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: text,
  }));
  editor.dispatchEvent?.(new win.Event('change', { bubbles: true }));
  
  // Inline composerStateInDocument logic to avoid serialization dependency
  const normalizeText = (value) =>
    String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .trim();
  const stateText = normalizeText('value' in editor ? editor.value : editor.textContent || '');
  return {
    ok: true,
    hasText: stateText.length > 0,
    text: stateText,
  };
}

export function clickSendButtonInDocument(doc) {
  const composerSelectors = [
    '#antigravity\\.agentSidePanelInputBox',
    '[id="antigravity.agentSidePanelInputBox"]',
    '[data-testid="composer"]',
    '[data-testid="chat-composer"]',
  ];
  const sendButtonSelectors = [
    '[data-testid="send-button"]',
    'button[aria-label*="send" i]',
    'button[title*="send" i]',
    'button[type="submit"]',
  ];
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const composer = queryFirst(doc, composerSelectors) || doc;
  const button = queryFirst(composer, sendButtonSelectors) || queryFirst(doc, sendButtonSelectors);
  if (!button) return false;
  if (button.disabled || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') return false;
  button.click?.();
  return true;
}

export function startNewConversationInDocument(doc) {
  const newConversationSelectors = [
    '[data-tooltip-id="new-conversation-tooltip"]',
    'button[aria-label*="new conversation" i]',
    'button[title*="new conversation" i]',
    '[data-testid="new-conversation"]',
  ];
  for (const selector of newConversationSelectors) {
    const button = doc.querySelector(selector);
    if (!button) continue;
    button.click?.();
    return { ok: true };
  }
  const fallback = Array.from(doc.querySelectorAll('[role="button"], button, div'))
    .find((node) => String(node?.textContent || '').trim().toLowerCase() === 'new conversation');
  if (fallback) {
    fallback.click?.();
    return { ok: true };
  }
  return { ok: false, reason: 'Could not find New Conversation button' };
}

export function openModelMenuInDocument(doc, targetName = '') {
  const modelTriggerSelectors = [
    'button[aria-label^="Select model" i]',
    'button[aria-label*="select model" i]',
    'button[aria-label*="current:" i]',
    '[data-testid="model-selector"]',
    '[aria-label*="model" i]',
    'div[aria-haspopup="dialog"] > div[tabindex="0"]',
    '[aria-haspopup="dialog"] > div[tabindex="0"]',
    'button[aria-haspopup="dialog"]',
  ];
  const normalizeText = (value) => String(value || '').replace(/\r/g, '').trim();
  const normalizeModelSearch = (value) => normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const queryFirst = (root, selectors) => {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    return null;
  };
  const existingDialog = doc.querySelector('[role="dialog"]') || doc.querySelector('[role="listbox"]');
  const existingOptions = existingDialog
    ? Array.from(existingDialog.querySelectorAll('button, [role="option"], li, .cursor-pointer, span'))
      .map((node) => normalizeText(node.textContent || ''))
      .filter(Boolean)
    : [];
  const trigger = queryFirst(doc, modelTriggerSelectors);
  if (!trigger) {
    if (existingOptions.length > 0) {
      return { ok: true, opened: true, currentModel: '', availableModels: [...new Set(existingOptions)] };
    }
    return { ok: false, reason: 'Could not find the model selector trigger in the UI', availableModels: [] };
  }
  const currentModel = normalizeText(trigger.textContent || '');
  const normalizedTarget = String(targetName || '').trim().toLowerCase();
  const normalizedTargetSearch = normalizeModelSearch(targetName);

  if (normalizedTarget && normalizeModelSearch(currentModel).includes(normalizedTargetSearch)) {
    return { ok: true, changed: false, currentModel, availableModels: [currentModel].filter(Boolean) };
  }

  if (existingOptions.length > 0) {
    return { ok: true, opened: true, currentModel, availableModels: [...new Set(existingOptions)] };
  }

  trigger.click?.();
  return { ok: true, opened: true, currentModel, availableModels: [currentModel].filter(Boolean) };
}

export function selectModelOptionInDocument(doc, targetName) {
  const normalizeText = (value) => String(value || '').replace(/\r/g, '').trim();
  const normalizedTarget = String(targetName || '').trim().toLowerCase();
  const normalizeModelSearch = (value) => normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedTargetSearch = normalizeModelSearch(normalizedTarget);
  const targetTokens = normalizedTargetSearch.split(' ').filter(Boolean);
  const dialogRoot = doc.querySelector('[role="dialog"]') || doc.querySelector('[role="listbox"]');
  if (!dialogRoot) {
    return {
      ok: false,
      reason: 'Model dropdown has not opened yet.',
      availableModels: [],
    };
  }

  let candidates = Array.from(dialogRoot.querySelectorAll('button, [role="option"], li, .cursor-pointer'))
    .map((node) => ({
      node,
      text: normalizeText(node.textContent || ''),
    }))
    .filter((item) => item.text.length > 0);
  if (candidates.length === 0) {
    candidates = Array.from(dialogRoot.querySelectorAll('span, div'))
      .map((node) => ({
        node,
        text: normalizeText(node.textContent || ''),
      }))
      .filter((item) => item.text.length > 0);
  }

  const availableModels = [...new Set(candidates.map((item) => item.text))];
  const target = candidates.find((item) => {
    const text = normalizeModelSearch(item.text);
    return text.includes(normalizedTargetSearch) || targetTokens.every((token) => text.includes(token));
  });
  if (!target) {
    return {
      ok: false,
      reason: `Model matching "${targetName}" was not found in the dropdown list.`,
      availableModels,
    };
  }
  const optionNode = target.node.closest?.('button, [role="option"], li, .cursor-pointer') || target.node.closest?.('div') || target.node;
  optionNode.click?.();
  return {
    ok: true,
    changed: true,
    selectedModel: target.text,
    availableModels,
  };
}

export async function setModelInDocument(doc, targetName) {
  const opened = openModelMenuInDocument(doc, targetName);
  if (!opened?.ok || opened.changed === false) return opened;
  let lastResult = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    lastResult = selectModelOptionInDocument(doc, targetName);
    if (lastResult?.ok || lastResult?.availableModels?.length > 0) break;
  }
  return {
    currentModel: opened.currentModel,
    ...(lastResult || {
      ok: false,
      reason: `Model matching "${targetName}" was not found in the dropdown list.`,
      availableModels: [],
    }),
  };
}

export async function getAntigravityConversationSnapshot(page, options = {}) {
  const snapshot = await page.evaluate(serializePageFunction(extractConversationSnapshotFromDocument, options));
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  return {
    ...snapshot,
    messages,
    textFingerprint: fingerprintConversationEntries(messages, { includeRoles: false }),
    roleFingerprint: fingerprintConversationEntries(messages, { includeRoles: true }),
  };
}

export async function prepareAntigravityComposer(page, options = {}) {
  return page.evaluate(serializePageFunction(prepareComposerInDocument, options));
}

export async function clearAntigravityComposer(page, { bridge } = {}) {
  const prepared = await prepareAntigravityComposer(page, { clear: false });
  if (!prepared?.ok) {
    return prepared;
  }

  const keyPress = async (key, modifiers = []) => {
    if (bridge) {
      let modifierFlags = 0;
      for (const mod of modifiers) {
        if (mod === 'Alt') modifierFlags |= 1;
        if (mod === 'Ctrl') modifierFlags |= 2;
        if (mod === 'Meta') modifierFlags |= 4;
        if (mod === 'Shift') modifierFlags |= 8;
      }
      await bridge.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        modifiers: modifierFlags,
      });
      await bridge.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        modifiers: modifierFlags,
      });
      return true;
    }
    if (page.nativeKeyPress) {
      await page.nativeKeyPress(key, modifiers);
      return true;
    }
    return false;
  };

  const wait = async (seconds) => {
    if (typeof page.wait === 'function') {
      await page.wait(seconds);
    } else {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  };

  let state = await getAntigravityComposerState(page);
  if (!state?.hasText) return { ok: true, method: 'already-empty', text: '' };

  if (bridge || page.nativeKeyPress) {
    for (const modifiers of [['Meta'], ['Ctrl']]) {
      await keyPress('a', modifiers);
      await keyPress('Backspace');
      await wait(0.15);
      state = await getAntigravityComposerState(page);
      if (!state?.hasText) {
        return { ok: true, method: `native-${modifiers[0].toLowerCase()}-a`, text: '' };
      }
    }
  }

  const cleared = await page.evaluate(serializePageFunction(clearComposerInDocument));
  await wait(0.15);
  state = await getAntigravityComposerState(page);
  if (!state?.hasText) return { ok: true, method: 'dom-clear', text: '' };
  return {
    ok: false,
    method: 'clear-failed',
    reason: cleared?.reason || 'Failed to clear Antigravity composer',
    text: state?.text || '',
  };
}

export async function getAntigravityComposerState(page) {
  return page.evaluate(serializePageFunction(composerStateInDocument));
}

export async function fillAntigravityComposer(page, text) {
  return page.evaluate(serializePageFunction(fillComposerInDocument, text));
}

export async function clickAntigravitySendButton(page) {
  return page.evaluate(serializePageFunction(clickSendButtonInDocument));
}

export async function startNewAntigravityConversation(page) {
  return page.evaluate(serializePageFunction(startNewConversationInDocument));
}

export async function setAntigravityModel(page, targetName) {
  const opened = await page.evaluate(serializePageFunction(openModelMenuInDocument, targetName));
  if (!opened?.ok || opened.changed === false) return opened;

  let lastResult = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (typeof page.wait === 'function') {
      await page.wait(0.1);
    } else {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    lastResult = await page.evaluate(serializePageFunction(selectModelOptionInDocument, targetName));
    if (lastResult?.ok) {
      return {
        currentModel: opened.currentModel,
        ...lastResult,
      };
    }
    if (lastResult?.availableModels?.length > 0) break;
  }

  return {
    currentModel: opened.currentModel,
    ...(lastResult || {
      ok: false,
      reason: `Model matching "${targetName}" was not found in the dropdown list.`,
      availableModels: [],
    }),
  };
}

export function extractLastAssistantReply(snapshot, userText = '') {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant') || messages[messages.length - 1];
  let reply = String(assistant?.content || '').trim();
  if (userText && reply.startsWith(userText)) {
    reply = reply.slice(userText.length).trim();
  }
  reply = reply.replace(/^Thought for[^\n]*\n+/i, '').trim();
  reply = reply.replace(/\s*\bCopy\b\s*$/m, '').trim();
  const half = Math.floor(reply.length / 2);
  const firstHalf = reply.slice(0, half).trim();
  const secondHalf = reply.slice(half).trim();
  if (firstHalf && firstHalf === secondHalf) {
    reply = firstHalf;
  }
  return reply;
}

export async function sendAntigravityMessage(page, text, { bridge } = {}) {
  const expectedText = String(text || '').replace(/\r/g, '').trim();
  const prepared = await prepareAntigravityComposer(page, { clear: false });
  if (!prepared?.ok) {
    throw new Error(prepared?.reason || 'Could not find Antigravity input box');
  }

  const wait = async (seconds) => {
    if (typeof page.wait === 'function') {
      await page.wait(seconds);
    } else {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  };

  const clearBeforeInsert = async () => {
    const cleared = await clearAntigravityComposer(page, { bridge });
    if (!cleared?.ok) {
      throw new Error(`Failed to clear Antigravity composer before sending. Current text: ${String(cleared?.text || '').slice(0, 200)}`);
    }
  };

  const verifyInserted = async () => {
    const state = await getAntigravityComposerState(page);
    return {
      ok: !!state?.hasText && state.text === expectedText,
      state,
    };
  };

  let hasText = false;
  let lastState = null;
  await clearBeforeInsert();

  if (bridge) {
    const rect = await page.evaluate(serializePageFunction(composerRectInDocument));
    if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
      await bridge.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
      await bridge.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
      await bridge.send('Input.insertText', { text });
      await wait(0.2);
      const verification = await verifyInserted();
      hasText = verification.ok;
      lastState = verification.state;
    }
  }

  if (!hasText && page.nativeType) {
    try {
      await clearBeforeInsert();
      await page.nativeType(text);
      await wait(0.2);
      const verification = await verifyInserted();
      hasText = verification.ok;
      lastState = verification.state;
    } catch {
      hasText = false;
    }
  }

  if (!hasText) {
    await clearBeforeInsert();
    const state = await fillAntigravityComposer(page, text);
    hasText = !!state?.hasText && state.text === expectedText;
    lastState = state;
  }

  if (!hasText) {
    const currentText = String(lastState?.text || '').slice(0, 200);
    throw new Error(`Failed to insert text into Antigravity composer. Current text: ${currentText}`);
  }

  const clicked = await clickAntigravitySendButton(page);
  if (clicked) return 'button';

  if (bridge) {
    await bridge.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    await bridge.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    });
    return 'bridge-enter';
  }

  if (page.nativeKeyPress) {
    try {
      await page.nativeKeyPress('Enter');
      return 'native-enter';
    } catch {
      // Fall through to generic key press.
    }
  }
  await page.pressKey('Enter');
  return 'enter';
}

export async function waitForAntigravityReply(page, beforeSnapshot, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollIntervalMs = opts.pollIntervalMs ?? 500;
  const stableThreshold = opts.stableThreshold ?? 4;
  const deadline = Date.now() + timeoutMs;
  const beforeFingerprint = beforeSnapshot?.textFingerprint || '';

  await page.wait(1);
  let hasStartedGenerating = !!beforeSnapshot?.isGenerating;
  let lastFingerprint = beforeFingerprint;
  let stableCount = 0;

  while (Date.now() < deadline) {
    const snapshot = await getAntigravityConversationSnapshot(page);
    const textChanged = snapshot.textFingerprint !== beforeFingerprint && snapshot.messages.length > 0;

    if (snapshot.isGenerating) {
      hasStartedGenerating = true;
      stableCount = 0;
      lastFingerprint = snapshot.textFingerprint;
    } else {
      if (hasStartedGenerating && textChanged) {
        await page.wait(0.5);
        return getAntigravityConversationSnapshot(page);
      }
      if (textChanged) {
        if (snapshot.textFingerprint === lastFingerprint) {
          stableCount += 1;
          if (stableCount >= stableThreshold) {
            return snapshot;
          }
        } else {
          stableCount = 0;
          lastFingerprint = snapshot.textFingerprint;
        }
      }
    }

    await page.wait(pollIntervalMs / 1000);
  }

  throw new Error('Timeout waiting for Antigravity reply');
}

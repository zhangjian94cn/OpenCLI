import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFns = vi.hoisted(() => ({
  getAntigravityConversationSnapshot: vi.fn(),
  sendAntigravityMessage: vi.fn(),
  waitForAntigravityReply: vi.fn(),
  startNewAntigravityConversation: vi.fn(),
  setAntigravityModel: vi.fn(),
}));

vi.mock('@jackwener/opencli/browser/cdp', () => ({
  CDPBridge: class CDPBridge {},
}));

vi.mock('@jackwener/opencli/launcher', () => ({
  resolveElectronEndpoint: vi.fn(),
}));

vi.mock('@jackwener/opencli/errors', () => ({
  EXIT_CODES: { SUCCESS: 0 },
  getErrorMessage: (error) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('./utils.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAntigravityConversationSnapshot: mockFns.getAntigravityConversationSnapshot,
    sendAntigravityMessage: mockFns.sendAntigravityMessage,
    waitForAntigravityReply: mockFns.waitForAntigravityReply,
    startNewAntigravityConversation: mockFns.startNewAntigravityConversation,
    setAntigravityModel: mockFns.setAntigravityModel,
  };
});

import {
  AntigravitySessionConflictError,
  createAntigravitySessionState,
  fingerprintConversationEntries,
} from './utils.js';
import { handleMessages } from './serve.js';

function createSnapshot(messages, extra = {}) {
  return {
    available: true,
    hasEditor: true,
    hasSendButton: true,
    isGenerating: false,
    currentModel: 'Claude Sonnet 4.6',
    messages,
    textFingerprint: fingerprintConversationEntries(messages, { includeRoles: false }),
    ...extra,
  };
}

function primeSessionState(sessionState, historyMessages, snapshot) {
  sessionState.active = true;
  sessionState.apiHistoryTextFingerprint = fingerprintConversationEntries(historyMessages, { includeRoles: false });
  sessionState.uiTextFingerprint = snapshot.textFingerprint;
  sessionState.lastModel = snapshot.currentModel;
}

function createPage() {
  return {
    wait: vi.fn().mockResolvedValue(undefined),
  };
}

describe('antigravity serve handleMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFns.startNewAntigravityConversation.mockResolvedValue({ ok: true });
    mockFns.setAntigravityModel.mockResolvedValue({ ok: true, selectedModel: 'Claude Sonnet 4.6' });
  });

  it('starts a fresh UI session for single-message requests and returns the reply', async () => {
    const page = createPage();
    const bridge = { send: vi.fn() };
    const sessionState = createAntigravitySessionState();
    const emptySnapshot = createSnapshot([]);
    const afterSnapshot = createSnapshot([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);

    mockFns.getAntigravityConversationSnapshot
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(emptySnapshot);
    mockFns.waitForAntigravityReply.mockResolvedValue(afterSnapshot);

    const response = await handleMessages({
      messages: [{ role: 'user', content: 'Hello' }],
    }, page, bridge, sessionState);

    expect(mockFns.startNewAntigravityConversation).toHaveBeenCalledTimes(1);
    expect(mockFns.sendAntigravityMessage).toHaveBeenCalledWith(page, 'Hello', { bridge });
    expect(response.content).toEqual([{ type: 'text', text: 'Hi there' }]);
    expect(sessionState.active).toBe(true);
    expect(sessionState.uiTextFingerprint).toBe(afterSnapshot.textFingerprint);
  });

  it('continues an existing tracked session when request history matches the UI', async () => {
    const page = createPage();
    const bridge = { send: vi.fn() };
    const sessionState = createAntigravitySessionState();
    const historyMessages = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
    ];
    const currentSnapshot = createSnapshot(historyMessages);
    const afterSnapshot = createSnapshot([
      ...historyMessages,
      { role: 'user', content: 'Follow up' },
      { role: 'assistant', content: 'Second answer' },
    ]);
    primeSessionState(sessionState, historyMessages, currentSnapshot);

    mockFns.getAntigravityConversationSnapshot
      .mockResolvedValueOnce(currentSnapshot)
      .mockResolvedValueOnce(currentSnapshot);
    mockFns.waitForAntigravityReply.mockResolvedValue(afterSnapshot);

    const response = await handleMessages({
      messages: [
        ...historyMessages,
        { role: 'user', content: 'Follow up' },
      ],
    }, page, bridge, sessionState);

    expect(mockFns.startNewAntigravityConversation).not.toHaveBeenCalled();
    expect(mockFns.sendAntigravityMessage).toHaveBeenCalledWith(page, 'Follow up', { bridge });
    expect(response.content[0].text).toBe('Second answer');
  });

  it('returns a 409-style conflict when the tracked UI state has drifted', async () => {
    const page = createPage();
    const sessionState = createAntigravitySessionState();
    const historyMessages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ];
    const trackedSnapshot = createSnapshot(historyMessages);
    const driftedSnapshot = createSnapshot([
      { role: 'user', content: 'Manual edit happened' },
    ]);
    primeSessionState(sessionState, historyMessages, trackedSnapshot);
    mockFns.getAntigravityConversationSnapshot.mockResolvedValueOnce(driftedSnapshot);

    await expect(handleMessages({
      messages: [
        ...historyMessages,
        { role: 'user', content: 'Follow up' },
      ],
    }, page, undefined, sessionState)).rejects.toMatchObject({
      name: 'AntigravitySessionConflictError',
      statusCode: 409,
      code: 'ui_state_drift',
    });

    expect(mockFns.sendAntigravityMessage).not.toHaveBeenCalled();
  });

  it('switches models through the centralized resolver before sending', async () => {
    const page = createPage();
    const sessionState = createAntigravitySessionState();
    const emptySnapshot = createSnapshot([]);
    const afterSnapshot = createSnapshot([
      { role: 'user', content: 'Model test' },
      { role: 'assistant', content: 'Model switched' },
    ], {
      currentModel: 'Claude Sonnet 4.6',
    });

    mockFns.getAntigravityConversationSnapshot
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(emptySnapshot);
    mockFns.waitForAntigravityReply.mockResolvedValue(afterSnapshot);

    await handleMessages({
      model: 'claude sonnet',
      messages: [{ role: 'user', content: 'Model test' }],
    }, page, undefined, sessionState);

    expect(mockFns.setAntigravityModel).toHaveBeenCalledWith(page, 'claude sonnet 4.6');
    expect(sessionState.lastModel).toBe('Claude Sonnet 4.6');
  });

  it('propagates wait timeouts instead of returning a partial response', async () => {
    const page = createPage();
    const sessionState = createAntigravitySessionState();
    const emptySnapshot = createSnapshot([]);

    mockFns.getAntigravityConversationSnapshot
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(emptySnapshot)
      .mockResolvedValueOnce(emptySnapshot);
    mockFns.waitForAntigravityReply.mockRejectedValue(new Error('Timeout waiting for Antigravity reply'));

    await expect(handleMessages({
      messages: [{ role: 'user', content: 'Hello' }],
    }, page, undefined, sessionState)).rejects.toThrow('Timeout waiting for Antigravity reply');

    expect(mockFns.sendAntigravityMessage).toHaveBeenCalledTimes(1);
  });
});

/**
 * antigravity serve — Anthropic-compatible `/v1/messages` proxy server.
 *
 * Starts an HTTP server that accepts Anthropic Messages API requests,
 * forwards them to a running Antigravity app via CDP, polls for the response,
 * and returns it in Anthropic format.
 *
 * Usage:
 *   opencli antigravity serve --port 8082
 *   ANTHROPIC_BASE_URL=http://localhost:8082 claude
 */
import { createServer } from 'node:http';
import { CDPBridge } from '@jackwener/opencli/browser/cdp';
import { resolveElectronEndpoint } from '@jackwener/opencli/launcher';
import { EXIT_CODES, getErrorMessage } from '@jackwener/opencli/errors';
import {
  AntigravitySessionConflictError,
  applyAntigravitySessionReply,
  createAntigravitySessionState,
  extractLastAssistantReply,
  getAntigravityConversationSnapshot,
  normalizeApiMessages,
  resolveAntigravityModelTarget,
  resetAntigravitySessionState,
  sendAntigravityMessage,
  setAntigravityModel,
  startNewAntigravityConversation,
  validateAntigravitySessionRequest,
  waitForAntigravityReply,
} from './utils.js';

function generateMsgId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = 'msg_';
  for (let index = 0; index < 24; index += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 3));
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content
        .filter((block) => block && typeof block === 'object' && block.type === 'text' && block.text)
        .map((block) => block.text)
        .join('\n')
    : '';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, Authorization',
  });
  res.end(body);
}

async function switchModelIfRequested(page, requestedModel) {
  if (!requestedModel) return '';

  const resolution = resolveAntigravityModelTarget(requestedModel);
  if (!resolution.matched) {
    console.error(`[serve] Model "${requestedModel}" is not mapped to a known Antigravity target. Keeping the current UI model.`);
    return '';
  }

  const result = await setAntigravityModel(page, resolution.target);
  if (!result?.ok) {
    const reason = result?.reason || 'unknown error';
    console.error(`[serve] Warning: failed to switch model to "${resolution.target}": ${reason}`);
    return '';
  }

  return result.selectedModel || resolution.target;
}

export async function handleMessages(body, page, bridge, sessionState) {
  const requestMessages = Array.isArray(body?.messages) ? body.messages : [];
  const normalizedMessages = normalizeApiMessages(requestMessages);
  const userMessages = normalizedMessages.filter((message) => message.role === 'user');
  if (userMessages.length === 0) {
    throw new Error('No user message found in request');
  }

  const userText = userMessages[userMessages.length - 1].content;
  if (!userText.trim()) {
    throw new Error('Empty user message');
  }

  let currentSnapshot = await getAntigravityConversationSnapshot(page);
  const validation = validateAntigravitySessionRequest({
    bodyMessages: requestMessages,
    currentSnapshot,
    sessionState,
  });

  if (validation.mode === 'reset') {
    console.error('[serve] Starting a fresh Antigravity conversation for a new request history.');
    const result = await startNewAntigravityConversation(page);
    if (!result?.ok) {
      throw new Error(result?.reason || 'Could not start a new Antigravity conversation');
    }
    resetAntigravitySessionState(sessionState);
    await page.wait(1);
    currentSnapshot = await getAntigravityConversationSnapshot(page);
  } else if (currentSnapshot.isGenerating) {
    throw new AntigravitySessionConflictError(
      'Antigravity is currently generating another response. Wait until it finishes before sending a new request.',
      'ui_busy',
    );
  }

  const selectedModel = await switchModelIfRequested(page, body.model);
  const beforeSnapshot = await getAntigravityConversationSnapshot(page);

  console.error(`[serve] Sending: "${userText.slice(0, 80)}${userText.length > 80 ? '...' : ''}"`);
  await sendAntigravityMessage(page, userText, { bridge });
  console.error('[serve] Waiting for reply...');

  const afterSnapshot = await waitForAntigravityReply(page, beforeSnapshot);
  const replyText = extractLastAssistantReply(afterSnapshot, userText);
  if (!replyText) {
    throw new Error('Antigravity reply was empty after generation completed');
  }

  applyAntigravitySessionReply({
    sessionState,
    bodyMessages: requestMessages,
    afterSnapshot,
    replyText,
    model: selectedModel || body.model || afterSnapshot.currentModel || '',
  });

  console.error(`[serve] Got reply: "${replyText.slice(0, 80)}${replyText.length > 80 ? '...' : ''}"`);
  return {
    id: generateMsgId(),
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: replyText }],
    model: body.model ?? 'antigravity',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: estimateTokens(userText),
      output_tokens: estimateTokens(replyText),
    },
  };
}

export async function startServe(opts = {}) {
  const port = opts.port ?? 8082;
  let cdp = null;
  let page = null;
  let requestInFlight = false;
  const sessionState = createAntigravitySessionState();

  async function ensureConnected() {
    if (page) {
      try {
        await page.evaluate('1+1');
        return page;
      } catch {
        console.error('[serve] CDP connection lost, reconnecting...');
        await cdp?.close().catch(() => {});
        cdp = null;
        page = null;
        resetAntigravitySessionState(sessionState);
      }
    }

    const endpoint = await resolveElectronEndpoint('antigravity');
    if (process.env.OPENCLI_CDP_TARGET) {
      console.error(`[serve] Using OPENCLI_CDP_TARGET=${process.env.OPENCLI_CDP_TARGET}`);
    }

    try {
      const res = await fetch(`${endpoint.replace(/\/$/, '')}/json`);
      const targets = await res.json();
      const pages = targets.filter((target) => target.type === 'page');
      console.error(`[serve] Available targets: ${pages.map((target) => `"${target.title}"`).join(', ')}`);
    } catch {
      // Ignore debug listing failures.
    }

    console.error(`[serve] Connecting via CDP (target pattern: "${process.env.OPENCLI_CDP_TARGET || ''}")...`);
    cdp = new CDPBridge();
    try {
      page = await cdp.connect({ timeout: 15_000, cdpEndpoint: endpoint });
    } catch (error) {
      cdp = null;
      const errorMessage = getErrorMessage(error);
      const cause = error instanceof Error ? error.cause : undefined;
      const isRefused = cause?.code === 'ECONNREFUSED' || errorMessage.includes('ECONNREFUSED');
      throw new Error(isRefused
        ? `Cannot connect to Antigravity at ${endpoint}.\n  1. Make sure Antigravity is running\n  2. Launch with: --remote-debugging-port=9234`
        : `CDP connection failed: ${errorMessage}`);
    }

    console.error('[serve] ✅ CDP connected.');
    const snapshot = await getAntigravityConversationSnapshot(page);
    if (!snapshot.available && !snapshot.hasEditor) {
      console.error('[serve] ⚠️  Warning: chat UI elements not found in this target. Try setting OPENCLI_CDP_TARGET to the correct window title.');
    }
    return page;
  }

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version, Authorization',
      });
      res.end();
      return;
    }

    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    try {
      if (req.method === 'GET' && pathname === '/v1/models') {
        jsonResponse(res, 200, {
          data: [
            {
              id: 'antigravity',
              object: 'model',
              created: Math.floor(Date.now() / 1000),
              owned_by: 'antigravity',
            },
          ],
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/messages') {
        if (requestInFlight) {
          jsonResponse(res, 429, {
            type: 'error',
            error: {
              type: 'rate_limit_error',
              message: 'Another request is currently being processed. Antigravity can only handle one request at a time.',
            },
          });
          return;
        }

        requestInFlight = true;
        try {
          const rawBody = await readBody(req);
          const body = JSON.parse(rawBody);
          if (body.stream) {
            jsonResponse(res, 400, {
              type: 'error',
              error: {
                type: 'invalid_request_error',
                message: 'Streaming is not supported. Set "stream": false.',
              },
            });
            return;
          }

          const activePage = await ensureConnected();
          const response = await handleMessages(body, activePage, cdp ?? undefined, sessionState);
          jsonResponse(res, 200, response);
        } finally {
          requestInFlight = false;
        }
        return;
      }

      if (req.method === 'GET' && (pathname === '/' || pathname === '/health')) {
        jsonResponse(res, 200, {
          ok: true,
          cdpConnected: page !== null,
          sessionActive: sessionState.active,
        });
        return;
      }

      jsonResponse(res, 404, {
        type: 'error',
        error: { type: 'not_found_error', message: `Not found: ${pathname}` },
      });
    } catch (error) {
      const statusCode = error instanceof AntigravitySessionConflictError ? error.statusCode : 500;
      const errorType = error instanceof AntigravitySessionConflictError ? 'invalid_request_error' : 'api_error';
      console.error('[serve] Error:', error instanceof Error ? error.message : error);
      jsonResponse(res, statusCode, {
        type: 'error',
        error: {
          type: errorType,
          message: error instanceof Error ? error.message : 'Internal server error',
        },
      });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.error(`\n[serve] ✅ Antigravity API proxy running at http://127.0.0.1:${port}`);
    console.error('[serve] Compatible with Anthropic /v1/messages API');
    console.error('[serve] CDP connection will be established on first request.');
    console.error(`\n[serve] Usage with Claude Code:\n  ANTHROPIC_BASE_URL=http://localhost:${port} claude\n`);
  });

  const shutdown = () => {
    console.error('\n[serve] Shutting down...');
    cdp?.close().catch(() => {});
    server.close();
    process.exit(EXIT_CODES.SUCCESS);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await new Promise(() => {});
}

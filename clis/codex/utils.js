import { createHash } from 'node:crypto';
import { ArgumentError, selectorError } from '@jackwener/opencli/errors';
import {
    openCodexConversation,
    openCodexProject,
    readCodexProjects,
} from './sidebar.js';

export function serializePageFunction(fn, ...args) {
    const serializedArgs = args.length > 0 ? `, ${args.map((arg) => JSON.stringify(arg)).join(', ')}` : '';
    return `(${fn.toString()})(document${serializedArgs})`;
}

function boolValue(value) {
    return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function cleanText(value) {
    return String(value || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\r/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function clipCompactText(value, limit = 140) {
    const text = cleanText(value);
    if (text.length <= limit) {
        return { text, length: text.length, truncated: false };
    }
    return {
        text: `${text.slice(0, Math.max(0, limit - 3))}...`,
        length: text.length,
        truncated: true,
    };
}

function parseOptionalPositiveInteger(raw, label) {
    if (raw == null || cleanText(raw) === '') return null;
    const value = cleanText(raw);
    if (!/^\d+$/.test(value)) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    return parsed;
}

function normalizeModelSearch(value) {
    return cleanText(value)
        .toLowerCase()
        .replace(/^gpt[-\s]*/i, '')
        .replace(/\bgpt[-\s]*/gi, '')
        .replace(/[^a-z0-9.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function codexProjectMatchesState(state, projectQuery) {
    const needle = cleanText(projectQuery).toLowerCase();
    if (!needle) return true;
    const label = cleanText(state?.project || '').toLowerCase();
    const projectPath = cleanText(state?.project_path || '').toLowerCase();
    return label === needle
        || label.includes(needle)
        || projectPath === needle
        || projectPath.endsWith(`/${needle}`);
}

function requireCodexProjectMatch(result, projectQuery) {
    const requested = cleanText(projectQuery);
    if (!requested || !result?.ok) return result;
    const stateAfter = result.state_after || null;
    if (codexProjectMatchesState(stateAfter, requested)) return result;
    return {
        ...result,
        ok: false,
        changed: false,
        reason: `New Codex conversation did not bind requested project "${requested}". Actual project_path: ${cleanText(stateAfter?.project_path || '') || '(empty)'}`,
    };
}

export function normalizeCodexModelLabel(value) {
    const label = cleanText(value);
    if (!label) return '';
    if (/^gpt[-\s]/i.test(label)) {
        return label.toLowerCase().replace(/\s+/g, '-');
    }
    if (/^\d+(?:\.\d+)?(?:[-\w.]*)?$/i.test(label)) {
        return `gpt-${label.toLowerCase()}`;
    }
    return label;
}

export function fingerprintCodexMessages(messages, { includeRoles = false } = {}) {
    const normalized = (Array.isArray(messages) ? messages : [])
        .map((message) => {
            const role = cleanText(message?.role || 'unknown').toLowerCase();
            const content = String(message?.content || '').replace(/\r/g, '').trim();
            return includeRoles ? `${role}::${content}` : content;
        })
        .filter(Boolean)
        .join('\n\n');
    return createHash('sha1').update(normalized).digest('hex');
}

export function extractCodexStateFromDocument(doc, options = {}) {
    const win = doc?.defaultView || globalThis.window;
    const HTMLElementCtor = win?.HTMLElement;
    const normalizeText = (value) =>
        String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    const compactText = (value) => normalizeText(value).replace(/\s+/g, ' ').trim();
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
    const queryFirst = (root, selectors) => {
        for (const selector of selectors) {
            const node = root.querySelector(selector);
            if (isElement(node) && isVisible(node)) return node;
        }
        return null;
    };
    const getText = (element) => isElement(element) ? normalizeText(element.innerText || element.textContent || '') : '';
    const normalizeModelLabelInDocument = (value) => {
        const label = compactText(value);
        if (!label) return '';
        if (/^gpt[-\s]/i.test(label)) return label.toLowerCase().replace(/\s+/g, '-');
        if (/^\d+(?:\.\d+)?(?:[-\w.]*)?$/i.test(label)) return `gpt-${label.toLowerCase()}`;
        return label;
    };
    const unitNodes = Array.from(doc.querySelectorAll('[data-content-search-unit-key]'))
        .filter((node) => isVisible(node) && getText(node));
    let messages = unitNodes.map((node, index) => {
        const key = String(node.getAttribute('data-content-search-unit-key') || '');
        const role = key.split(':').pop() || (node.querySelector('[data-local-conversation-user-anchor]') ? 'user' : 'assistant');
        let content = getText(node);
        if (role === 'assistant') {
            content = content
                .replace(/\n+\s*复制消息\s*$/m, '')
                .replace(/\n+\s*Copy\s*$/m, '')
                .trim();
        }
        return { index, role, content };
    }).filter((message) => message.content.length > 0);
    const last = Number(options?.last || 0);
    if (Number.isFinite(last) && last > 0) {
        messages = messages.slice(-last);
    }

    const composer = queryFirst(doc, [
        '[data-codex-composer="true"]',
        '.ProseMirror[contenteditable="true"]',
        '[contenteditable="true"]',
        'textarea',
    ]);
    const composerText = composer
        ? normalizeText('value' in composer ? composer.value : composer.textContent || '')
        : '';
    const stopButton = Array.from(doc.querySelectorAll('button'))
        .find((button) => /^(停止|stop|cancel)$/i.test(compactText(button.getAttribute('aria-label') || button.getAttribute('title') || getText(button))));
    const sendButton = Array.from(doc.querySelectorAll('button'))
        .find((button) => /^(发送|提交|send)$/i.test(compactText(button.getAttribute('aria-label') || button.getAttribute('title') || getText(button))));

    const modelTrigger = queryFirst(doc, ['[data-codex-intelligence-trigger="true"]']);
    const modelText = compactText(modelTrigger?.textContent || '');
    const effortLabel = compactText(
        modelTrigger?.querySelector?.('.composer-footer__label--sm')?.textContent
        || modelTrigger?.getAttribute?.('data-selected-reasoning-effort')
        || ''
    );
    const modelLabel = compactText(
        modelTrigger?.querySelector?.('.tabular-nums')?.textContent
        || (effortLabel ? modelText.replace(effortLabel, '') : modelText)
    );
    const currentModel = normalizeModelLabelInDocument(modelLabel);

    const permissionButton = Array.from(doc.querySelectorAll('button'))
        .find((button) => /(完全访问权限|只读|workspace|approval|sandbox|full access|read only)/i.test(getText(button)));
    const permissionLabel = compactText(permissionButton?.textContent || '');

    const headerSurface = queryFirst(doc, ['[data-testid="app-shell-header-context-menu-surface"]']);
    const activeConversationTitle = compactText(headerSurface?.textContent || '');
    const conversationId = doc.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';

    return {
        currentModel,
        modelLabel,
        reasoningEffort: modelTrigger?.getAttribute?.('data-selected-reasoning-effort') || '',
        reasoningEffortLabel: effortLabel,
        permissionLabel,
        sandbox: /完全访问权限|full access/i.test(permissionLabel)
            ? 'danger-full-access'
            : /只读|read only/i.test(permissionLabel)
                ? 'read-only'
                : '',
        composer: {
            available: !!composer,
            hasText: composerText.length > 0,
            text: composerText,
        },
        hasEditor: !!composer,
        hasSendButton: !!sendButton,
        hasStopButton: !!stopButton,
        isGenerating: !!stopButton,
        conversationId,
        activeConversationTitle,
        messageCount: unitNodes.length,
        messages,
    };
}

export function composerStateInDocument(doc) {
    const normalizeText = (value) =>
        String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .trim();
    const editor = doc.querySelector('[data-codex-composer="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"], textarea');
    if (!editor) return { available: false, hasText: false, text: '' };
    const text = normalizeText('value' in editor ? editor.value : editor.textContent || '');
    return {
        available: true,
        hasText: text.length > 0,
        text,
    };
}

export function clearComposerInDocument(doc) {
    const win = doc?.defaultView || globalThis.window;
    const normalizeText = (value) =>
        String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .trim();
    const editor = doc.querySelector('[data-codex-composer="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"], textarea');
    if (!editor) return { ok: false, reason: 'Could not find Codex composer', text: '' };
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
        // Direct mutation below handles DOM implementations without Selection APIs.
    }
    if ('value' in editor) {
        editor.value = '';
    } else if ('replaceChildren' in editor) {
        editor.replaceChildren();
    } else {
        editor.textContent = '';
    }
    const event = win.InputEvent
        ? new win.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
        : new win.Event('input', { bubbles: true });
    editor.dispatchEvent?.(event);
    editor.dispatchEvent?.(new win.Event('change', { bubbles: true }));
    const text = normalizeText('value' in editor ? editor.value : editor.textContent || '');
    return { ok: text.length === 0, available: true, hasText: text.length > 0, text };
}

export function fillComposerInDocument(doc, text) {
    const win = doc?.defaultView || globalThis.window;
    const normalizeText = (value) =>
        String(value || '')
            .replace(/\u00a0/g, ' ')
            .replace(/\r/g, '')
            .trim();
    const editor = doc.querySelector('[data-codex-composer="true"], .ProseMirror[contenteditable="true"], [contenteditable="true"], textarea');
    if (!editor) return { ok: false, reason: 'Could not find Codex composer', text: '' };
    const expectedText = normalizeText(text);
    const directReplace = () => {
        if ('value' in editor) {
            editor.value = text;
        } else if ('replaceChildren' in editor) {
            const paragraph = doc.createElement('p');
            paragraph.textContent = text;
            editor.replaceChildren(paragraph);
        } else {
            editor.textContent = text;
        }
    };
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
        const insertedText = normalizeText(editor.textContent || '');
        if (!inserted || insertedText !== expectedText) {
            directReplace();
        }
    } else {
        editor.textContent = text;
    }
    const event = win.InputEvent
        ? new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })
        : new win.Event('input', { bubbles: true });
    editor.dispatchEvent?.(event);
    editor.dispatchEvent?.(new win.Event('change', { bubbles: true }));
    const stateText = normalizeText('value' in editor ? editor.value : editor.textContent || '');
    const state = { available: true, hasText: stateText.length > 0, text: stateText };
    return { ok: state.hasText && state.text === expectedText, ...state };
}

export function clickCodexSendButtonInDocument(doc) {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const buttons = Array.from(doc.querySelectorAll('button'));
    const stopButton = buttons.find((button) => /^(停止|stop|cancel)$/i.test(normalizeText(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '')));
    if (stopButton) return { ok: false, reason: 'Codex is currently generating' };
    const sendButton = buttons.find((button) => /^(发送|提交|send)$/i.test(normalizeText(button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent || '')));
    if (!sendButton) return { ok: false, reason: 'Could not find Codex send button' };
    if (sendButton.disabled || String(sendButton.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        return { ok: false, reason: 'Codex send button is disabled' };
    }
    sendButton.click?.();
    return { ok: true, method: 'button' };
}

export function openCodexModelMenuInDocument(doc, targetName = '', preferNativeClick = false) {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeSearch = (value) => normalizeText(value)
        .toLowerCase()
        .replace(/^gpt[-\s]*/i, '')
        .replace(/\bgpt[-\s]*/gi, '')
        .replace(/[^a-z0-9.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const trigger = doc.querySelector('[data-codex-intelligence-trigger="true"]');
    const currentLabel = normalizeText(trigger?.querySelector?.('.tabular-nums')?.textContent || trigger?.textContent || '');
    const requested = normalizeSearch(targetName);
    if (requested && normalizeSearch(currentLabel).includes(requested)) {
        return { ok: true, changed: false, currentModel: currentLabel, availableModels: [currentLabel].filter(Boolean) };
    }
    if (!trigger) {
        return { ok: false, reason: 'Could not find Codex model selector trigger', availableModels: [] };
    }
    const rect = trigger.getBoundingClientRect?.();
    const point = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : {};
    if (!preferNativeClick) {
        trigger.click?.();
    }
    return {
        ok: true,
        opened: !preferNativeClick,
        needsNativeClick: !!preferNativeClick,
        currentModel: currentLabel,
        availableModels: [currentLabel].filter(Boolean),
        ...point,
    };
}

export function openCodexModelSubmenuInDocument(doc, preferNativeClick = false) {
    const win = doc?.defaultView || globalThis.window;
    const HTMLElementCtor = win?.HTMLElement;
    const isElement = (value) => !!HTMLElementCtor && value instanceof HTMLElementCtor;
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
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
    const modelPattern = /^gpt[-\s]?\d+(?:\.\d+)?(?:[-\s]?(?:mini|codex|spark))*$/i;
    const actionableSelector = 'button, [role="menuitem"], [role="option"], [data-radix-collection-item], [tabindex]';
    const actionableAncestor = (node) => node?.closest?.(actionableSelector) || node?.closest?.('li') || node;
    const roots = Array.from(doc.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'))
        .filter((root) => isVisible(root) && normalizeText(root.textContent || ''));
    const items = roots.flatMap((root) =>
        Array.from(root.querySelectorAll('button, [role="menuitem"], [role="option"], [aria-haspopup="menu"], li, div, span'))
            .filter(isVisible)
            .map((node) => {
                const text = normalizeText(node.textContent || '');
                const ownText = normalizeText(Array.from(node.childNodes || [])
                    .filter((child) => child.nodeType === 3)
                    .map((child) => child.textContent || '')
                    .join(' '));
                const label = normalizeText(node.getAttribute?.('aria-label') || node.getAttribute?.('title') || ownText || text);
                return { node, text, label };
            })
            .filter((item) => item.text.length <= 120 || item.label.length <= 120)
    );
    const submenuTrigger = items.find((item) =>
        item.node.getAttribute?.('aria-haspopup') === 'menu'
        && modelPattern.test(item.label || item.text)
    );
    if (!submenuTrigger) {
        const modelItems = items
            .filter((item) => modelPattern.test(item.label) || modelPattern.test(item.text))
            .map((item) => normalizeText(item.label || item.text))
            .filter(Boolean);
        const availableModels = [...new Set(modelItems)];
        if (availableModels.length >= 2) {
            return {
                ok: true,
                opened: false,
                alreadyOpen: true,
                availableModels,
            };
        }
    }
    const submenu = submenuTrigger || items.find((item) => modelPattern.test(item.label) || modelPattern.test(item.text));
    if (!submenu?.node) {
        return { ok: false, reason: 'Could not find Codex model submenu trigger' };
    }
    const clickable = actionableAncestor(submenu.node);
    const rect = clickable.getBoundingClientRect?.();
    const point = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : {};
    if (!preferNativeClick) {
        clickable.click?.();
    }
    return {
        ok: true,
        opened: !preferNativeClick,
        needsNativeClick: !!preferNativeClick,
        label: submenu.label || submenu.text,
        ...point,
    };
}

export function codexModelOptionsInDocument(doc) {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const modelPattern = /^gpt[-\s]?\d+(?:\.\d+)?(?:[-\s]?(?:mini|codex|spark))*$/i;
    const normalizeModel = (value) => normalizeText(value)
        .replace(/\s+/g, '-')
        .replace(/^gpt-/i, 'gpt-')
        .toLowerCase();
    const cleanModelCandidate = (value) => {
        const text = normalizeText(value);
        if (!text || /^(model|模型|reasoning|effort)$/i.test(text)) return '';
        if (text.length > 80) return '';
        if (!modelPattern.test(text)) return '';
        return text;
    };
    const trigger = doc.querySelector('[data-codex-intelligence-trigger="true"]');
    const triggerModelLabel = normalizeText(trigger?.querySelector?.('.tabular-nums')?.textContent || trigger?.textContent || '');
    const currentModel = triggerModelLabel
        ? (/^gpt[-\s]/i.test(triggerModelLabel) ? triggerModelLabel.toLowerCase().replace(/\s+/g, '-') : `gpt-${triggerModelLabel}`)
        : '';
    const roots = Array.from(doc.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'))
        .filter((root) => normalizeText(root.textContent || ''));
    const candidates = roots.flatMap((root) =>
        Array.from(root.querySelectorAll('button, [role="menuitem"], [role="option"], li, div, span'))
            .map((node) => cleanModelCandidate(node.textContent || ''))
            .filter(Boolean)
    );
    const availableModels = [...new Set(candidates.map(normalizeModel))];
    if (currentModel && !availableModels.includes(currentModel)) availableModels.unshift(currentModel);
    return {
        ok: true,
        currentModel,
        availableModels,
        rawOptions: [...new Set(candidates)],
    };
}

export function selectCodexModelOptionInDocument(doc, targetName, preferNativeClick = false) {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeSearch = (value) => normalizeText(value)
        .toLowerCase()
        .replace(/^gpt[-\s]*/i, '')
        .replace(/\bgpt[-\s]*/gi, '')
        .replace(/[^a-z0-9.]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const modelPattern = /^gpt[-\s]?\d+(?:\.\d+)?(?:[-\s]?(?:mini|codex|spark))*$/i;
    const actionableSelector = 'button, [role="menuitem"], [role="option"], [data-radix-collection-item], [tabindex]';
    const actionableAncestor = (node) => node?.closest?.(actionableSelector) || node?.closest?.('li') || node;
    const normalizeModel = (value) => normalizeText(value)
        .replace(/\s+/g, '-')
        .replace(/^gpt-/i, 'gpt-')
        .toLowerCase();
    const normalizedTarget = normalizeSearch(targetName);
    if (!normalizedTarget) return { ok: false, reason: 'model target is required', availableModels: [] };
    const roots = Array.from(doc.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], [data-radix-menu-content], [data-radix-popper-content-wrapper]'))
        .filter((item) => normalizeText(item.textContent || ''));
    if (roots.length === 0) {
        return {
            ok: false,
            reason: 'Codex model menu is not open.',
            availableModels: [],
        };
    }
    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll('button, [role="menuitem"], [role="option"], [data-radix-collection-item], li, div, span')))
        .map((node) => ({ node, clickable: actionableAncestor(node), text: normalizeText(node.textContent || '') }))
        .filter((item) => item.text && item.text.length <= 80 && modelPattern.test(item.text));
    const availableModels = [...new Set(candidates.map((item) => normalizeModel(item.text)))];
    const targetTokens = normalizedTarget.split(' ').filter(Boolean);
    const match = candidates.find((item) => {
        const haystack = normalizeSearch(item.text);
        return haystack === normalizedTarget
            || haystack.includes(normalizedTarget)
            || targetTokens.every((token) => haystack.includes(token));
    });
    if (!match) {
        return {
            ok: false,
            reason: `Model matching "${targetName}" was not found in the Codex model menu.`,
            availableModels,
        };
    }
    const clickable = match.clickable || match.node;
    const rect = clickable.getBoundingClientRect?.();
    const point = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : {};
    if (!preferNativeClick) {
        clickable.click?.();
    }
    return {
        ok: true,
        selectedModel: match.text,
        availableModels,
        needsNativeClick: !!preferNativeClick,
        ...point,
    };
}

export function clickStopButtonInDocument(doc) {
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const button = Array.from(doc.querySelectorAll('button'))
        .find((candidate) => /^(停止|stop|cancel)$/i.test(normalizeText(candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.textContent || '')));
    if (!button) return { ok: false, reason: 'Could not find a visible Codex stop button' };
    if (button.disabled || String(button.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        return { ok: false, reason: 'Codex stop button is disabled' };
    }
    button.click?.();
    return { ok: true };
}

export async function getCodexConversationSnapshot(page, options = {}) {
    const snapshot = await page.evaluate(serializePageFunction(extractCodexStateFromDocument, options));
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    return {
        ...snapshot,
        messages,
        textFingerprint: fingerprintCodexMessages(messages, { includeRoles: false }),
        roleFingerprint: fingerprintCodexMessages(messages, { includeRoles: true }),
    };
}

export async function getCodexPageState(page, options = {}) {
    const last = Number.isFinite(Number(options.last)) ? Number(options.last) : 5;
    const [url, title, snapshot, projects] = await Promise.all([
        page.evaluate('window.location.href'),
        page.evaluate('document.title'),
        getCodexConversationSnapshot(page, { last }),
        readCodexProjects(page).catch(() => []),
    ]);
    const activeProject = (Array.isArray(projects) ? projects : [])
        .map((project) => ({
            ...project,
            activeConversation: (project.conversations || []).find((conversation) => conversation.active) || null,
        }))
        .find((project) => project.activeConversation) || null;
    const activeConversation = activeProject?.activeConversation || null;
    return {
        ok: true,
        url,
        title,
        project: activeProject?.project || '',
        project_path: activeProject?.projectPath || '',
        conversation: activeConversation?.title || snapshot.activeConversationTitle || '',
        thread_id: activeConversation?.threadId || (snapshot.conversationId ? `local:${snapshot.conversationId}` : ''),
        conversation_id: snapshot.conversationId || String(activeConversation?.threadId || '').replace(/^local:/, ''),
        model: snapshot.currentModel || '',
        model_label: snapshot.modelLabel || '',
        reasoning_effort: snapshot.reasoningEffort || '',
        reasoning_effort_label: snapshot.reasoningEffortLabel || '',
        permission_label: snapshot.permissionLabel || '',
        sandbox: snapshot.sandbox || '',
        is_generating: !!snapshot.isGenerating,
        composer: snapshot.composer || { available: false, hasText: false, text: '' },
        has_editor: !!snapshot.hasEditor,
        has_send_button: !!snapshot.hasSendButton,
        has_stop_button: !!snapshot.hasStopButton,
        message_count: snapshot.messageCount || 0,
        messages: snapshot.messages || [],
    };
}

export async function listCodexConversations(page, opts = {}) {
    const projects = await readCodexProjects(page);
    const limit = parseOptionalPositiveInteger(opts.limit, 'codex conversations --limit');
    const compactProjects = projects.map((project) => ({
        index: project.index,
        name: project.project,
        project: project.project,
        projectPath: project.projectPath,
        collapsed: project.collapsed,
        conversations: (limit ? (project.conversations || []).slice(0, limit) : (project.conversations || []))
            .map((conversation) => {
                const title = clipCompactText(conversation.title);
                return {
                    index: conversation.index,
                    title: title.text,
                    ...(title.truncated ? { titleTruncated: true, titleFullLength: title.length } : {}),
                    updated: conversation.updated,
                    active: !!conversation.active,
                    pinned: !!conversation.pinned,
                    threadId: conversation.threadId,
                    hostId: conversation.hostId,
                    kind: conversation.kind,
                };
            }),
    }));
    return {
        ok: true,
        project_count: compactProjects.length,
        conversation_count: compactProjects.reduce((sum, project) => sum + project.conversations.length, 0),
        projects: compactProjects,
        note: 'Only Codex projects and conversations visible in the sidebar are listed.',
    };
}

export async function listCodexModels(page) {
    const preferNativeClick = typeof page.nativeClick === 'function';
    const opened = await page.evaluate(serializePageFunction(openCodexModelMenuInDocument, '', preferNativeClick));
    if (preferNativeClick && Number.isFinite(opened?.x) && Number.isFinite(opened?.y)) {
        await page.nativeClick(opened.x, opened.y);
    }
    if (typeof page.wait === 'function') await page.wait(0.3);
    let submenu = await page.evaluate(serializePageFunction(openCodexModelSubmenuInDocument, preferNativeClick));
    if (preferNativeClick && Number.isFinite(submenu?.x) && Number.isFinite(submenu?.y)) {
        await page.nativeClick(submenu.x, submenu.y);
    }
    if (typeof page.wait === 'function') await page.wait(0.4);
    let listed = await page.evaluate(serializePageFunction(codexModelOptionsInDocument));
    if ((!Array.isArray(listed?.rawOptions) || listed.rawOptions.length <= 1)
        && typeof page.nativeClick === 'function'
        && Number.isFinite(submenu?.x)
        && Number.isFinite(submenu?.y)) {
        await page.nativeClick(submenu.x, submenu.y);
        if (typeof page.wait === 'function') await page.wait(0.4);
        listed = await page.evaluate(serializePageFunction(codexModelOptionsInDocument));
    }
    if ((!Array.isArray(listed?.rawOptions) || listed.rawOptions.length === 0)
        && typeof page.nativeClick === 'function'
        && Number.isFinite(opened?.x)
        && Number.isFinite(opened?.y)) {
        if (typeof page.pressKey === 'function') {
            await page.pressKey('Escape').catch?.(() => {});
        }
        await page.nativeClick(opened.x, opened.y);
        if (typeof page.wait === 'function') await page.wait(0.3);
        submenu = await page.evaluate(serializePageFunction(openCodexModelSubmenuInDocument, true));
        if (Number.isFinite(submenu?.x) && Number.isFinite(submenu?.y)) {
            await page.nativeClick(submenu.x, submenu.y);
        }
        if (typeof page.wait === 'function') await page.wait(0.4);
        listed = await page.evaluate(serializePageFunction(codexModelOptionsInDocument));
    }
    if (typeof page.pressKey === 'function') {
        await page.pressKey('Escape').catch?.(() => {});
    }
    const availableModels = [...new Set([
        ...(Array.isArray(opened?.availableModels) ? opened.availableModels.map(normalizeCodexModelLabel) : []),
        ...(Array.isArray(listed?.availableModels) ? listed.availableModels.map(normalizeCodexModelLabel) : []),
    ].filter(Boolean))];
    return {
        ok: opened?.ok !== false || availableModels.length > 0,
        currentModel: normalizeCodexModelLabel(listed?.currentModel || opened?.currentModel || ''),
        availableModels,
        rawOptions: listed?.rawOptions || [],
        ...(opened?.ok === false && availableModels.length === 0 ? { reason: opened.reason } : {}),
    };
}

export async function setCodexModel(page, targetName) {
    const requested = String(targetName || '').trim();
    if (!requested) return { ok: false, reason: 'model target is required' };
    const before = await getCodexPageState(page);
    if (before.is_generating) {
        return {
            ok: false,
            changed: false,
            currentModel: before.model,
            availableModels: [],
            state: before,
            reason: 'Codex is currently generating. Use wait or stop before switching models.',
        };
    }
    if (normalizeModelSearch(before.model).includes(normalizeModelSearch(requested))) {
        return { ok: true, changed: false, currentModel: before.model, state: before };
    }
    const preferNativeClick = typeof page.nativeClick === 'function';
    const opened = await page.evaluate(serializePageFunction(openCodexModelMenuInDocument, requested, preferNativeClick));
    if (!opened?.ok || opened.changed === false) {
        return {
            ...opened,
            currentModel: normalizeCodexModelLabel(opened?.currentModel || before.model || ''),
            state: before,
        };
    }
    if (preferNativeClick && Number.isFinite(opened?.x) && Number.isFinite(opened?.y)) {
        await page.nativeClick(opened.x, opened.y);
    }
    if (typeof page.wait === 'function') await page.wait(0.3);
    const submenu = await page.evaluate(serializePageFunction(openCodexModelSubmenuInDocument, preferNativeClick));
    if (preferNativeClick && Number.isFinite(submenu?.x) && Number.isFinite(submenu?.y)) {
        await page.nativeClick(submenu.x, submenu.y);
    }
    if (typeof page.wait === 'function') await page.wait(0.4);
    let selected = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
        if (typeof page.wait === 'function') await page.wait(0.1);
        selected = await page.evaluate(serializePageFunction(selectCodexModelOptionInDocument, requested, false));
        if (selected?.ok) {
            break;
        }
    }
    if (!selected?.ok
        && typeof page.nativeClick === 'function'
        && Number.isFinite(submenu?.x)
        && Number.isFinite(submenu?.y)) {
        await page.nativeClick(submenu.x, submenu.y);
        if (typeof page.wait === 'function') await page.wait(0.4);
        for (let attempt = 0; attempt < 60; attempt += 1) {
            if (typeof page.wait === 'function') await page.wait(0.1);
            selected = await page.evaluate(serializePageFunction(selectCodexModelOptionInDocument, requested, true));
            if (selected?.ok) {
                if (Number.isFinite(selected?.x) && Number.isFinite(selected?.y)) {
                    await page.nativeClick(selected.x, selected.y);
                }
                break;
            }
        }
    }
    if (!selected?.ok
        && (!selected?.availableModels || selected.availableModels.length === 0)
        && typeof page.nativeClick === 'function'
        && Number.isFinite(opened?.x)
        && Number.isFinite(opened?.y)) {
        await page.nativeClick(opened.x, opened.y);
        if (typeof page.wait === 'function') await page.wait(0.3);
        const nativeSubmenu = await page.evaluate(serializePageFunction(openCodexModelSubmenuInDocument));
        if (typeof page.wait === 'function') await page.wait(0.4);
        if (typeof page.nativeClick === 'function'
            && Number.isFinite(nativeSubmenu?.x)
            && Number.isFinite(nativeSubmenu?.y)) {
            await page.nativeClick(nativeSubmenu.x, nativeSubmenu.y);
            if (typeof page.wait === 'function') await page.wait(0.4);
        }
        for (let attempt = 0; attempt < 60; attempt += 1) {
            if (typeof page.wait === 'function') await page.wait(0.1);
            selected = await page.evaluate(serializePageFunction(selectCodexModelOptionInDocument, requested, true));
            if (selected?.ok) {
                if (Number.isFinite(selected?.x) && Number.isFinite(selected?.y)) {
                    await page.nativeClick(selected.x, selected.y);
                }
                break;
            }
        }
    }
    if (!selected?.ok) {
        return {
            ok: false,
            reason: selected?.reason || `Model matching "${requested}" was not found in the Codex model menu.`,
            currentModel: before.model,
            availableModels: selected?.availableModels || [],
            state: before,
        };
    }
    let after = await getCodexPageState(page);
    let verified = normalizeModelSearch(after.model).includes(normalizeModelSearch(requested));
    for (let attempt = 0; !verified && attempt < 20; attempt += 1) {
        if (typeof page.wait === 'function') await page.wait(0.2);
        after = await getCodexPageState(page);
        verified = normalizeModelSearch(after.model).includes(normalizeModelSearch(requested));
    }
    return {
        ok: verified,
        changed: verified,
        clicked: true,
        selectedModel: selected.selectedModel,
        currentModel: after.model,
        state_before: before,
        state_after: after,
        ...(verified ? {} : { reason: `Model switch was not verified. Current model: ${after.model || '(unknown)'}` }),
        availableModels: selected.availableModels || [],
    };
}

function flattenCodexConversationRows(projects) {
    return (Array.isArray(projects) ? projects : []).flatMap((project) =>
        (project.conversations || []).map((conversation) => ({
            ...conversation,
            project: project.project,
            projectPath: project.projectPath,
        }))
    );
}

function sameCodexConversationId(left, right) {
    const normalize = (value) => cleanText(value).replace(/^local:/, '');
    return !!normalize(left) && normalize(left) === normalize(right);
}

function chooseCreatedCodexConversation(beforeProjects, afterProjects, stateBefore) {
    const beforeIds = new Set(flattenCodexConversationRows(beforeProjects).map((item) => cleanText(item.threadId)).filter(Boolean));
    const created = flattenCodexConversationRows(afterProjects)
        .filter((item) => cleanText(item.threadId) && !beforeIds.has(cleanText(item.threadId)));
    if (created.length === 0) return null;
    const beforeProjectPath = cleanText(stateBefore?.project_path || '');
    const beforeProject = cleanText(stateBefore?.project || '');
    return created.find((item) => cleanText(item.projectPath) === beforeProjectPath)
        || created.find((item) => cleanText(item.project) === beforeProject)
        || created[0];
}

function isBlankNewCodexState(state) {
    return !!state?.composer?.available
        && !cleanText(state.thread_id)
        && !cleanText(state.conversation_id)
        && !cleanText(state.conversation)
        && Number(state.message_count || 0) === 0;
}

function looksLikeBlankNewCodexState(beforeState, afterState) {
    if (!afterState?.composer?.available) return false;
    if (afterState.thread_id && !sameCodexConversationId(afterState.thread_id, beforeState?.thread_id)) return true;
    if (afterState.conversation_id && !sameCodexConversationId(afterState.conversation_id, beforeState?.conversation_id)) return true;
    return isBlankNewCodexState(afterState) && !isBlankNewCodexState(beforeState);
}

export function clickCodexNewConversationButtonInDocument(doc) {
    const win = doc?.defaultView || globalThis.window;
    const HTMLElementCtor = win?.HTMLElement;
    const isElement = (value) => !!HTMLElementCtor && value instanceof HTMLElementCtor;
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const visibleText = (element) => normalizeText(element?.innerText || element?.textContent || '');
    const labelText = (element) => normalizeText(
        element?.getAttribute?.('aria-label')
        || element?.getAttribute?.('title')
        || visibleText(element)
    );
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
    const candidates = Array.from(doc.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .map((node) => ({ node, label: labelText(node), text: visibleText(node) }));
    const button = candidates.find((candidate) => /^(新对话|新建对话|new conversation|new chat)$/i.test(candidate.label))
        || candidates.find((candidate) => /^(新对话|新建对话|new conversation|new chat)$/i.test(candidate.text))
        || candidates.find((candidate) =>
            /(⌘\s*N|Cmd\+N|Ctrl\+N)/i.test(candidate.text)
            && /(新对话|新建对话|new conversation|new chat)/i.test(candidate.text)
        );
    if (!button?.node) {
        return { ok: false, reason: 'Could not find Codex new conversation button' };
    }
    if (button.node.disabled || String(button.node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        return { ok: false, reason: 'Codex new conversation button is disabled' };
    }
    button.node.scrollIntoView?.({ block: 'center' });
    const rect = button.node.getBoundingClientRect?.();
    const point = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : {};
    button.node.click?.();
    return {
        ok: true,
        method: 'new-button',
        label: button.label || button.text,
        ...point,
    };
}

export function clickCodexProjectNewConversationButtonInDocument(doc, projectQuery) {
    const win = doc?.defaultView || globalThis.window;
    const HTMLElementCtor = win?.HTMLElement;
    const isElement = (value) => !!HTMLElementCtor && value instanceof HTMLElementCtor;
    const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const normalizeMatch = (value) => normalizeText(value).toLowerCase();
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
    const labelText = (element) => normalizeText(
        element?.getAttribute?.('aria-label')
        || element?.getAttribute?.('title')
        || element?.innerText
        || element?.textContent
        || ''
    );
    const requested = normalizeMatch(projectQuery);
    if (!requested) return { ok: false, reason: 'Project target is required for project new conversation' };
    const projectRows = Array.from(doc.querySelectorAll('[data-app-action-sidebar-project-row]'));
    const matchesProject = (row) => {
        const label = normalizeMatch(row.getAttribute('data-app-action-sidebar-project-label') || row.getAttribute('aria-label') || row.textContent || '');
        const path = normalizeMatch(row.getAttribute('data-app-action-sidebar-project-id') || '');
        return label === requested || label.includes(requested) || path === requested || path.endsWith(`/${requested}`);
    };
    const projectRow = projectRows.find(matchesProject);
    if (!projectRow) {
        return {
            ok: false,
            reason: `Project not found: ${projectQuery}`,
            projects: projectRows.map((row) => normalizeText(row.getAttribute('data-app-action-sidebar-project-label') || row.getAttribute('aria-label') || row.textContent || '')).filter(Boolean),
        };
    }
    const projectLabel = normalizeText(projectRow.getAttribute('data-app-action-sidebar-project-label') || projectRow.getAttribute('aria-label') || projectRow.textContent || '');
    const projectPath = normalizeText(projectRow.getAttribute('data-app-action-sidebar-project-id') || '');
    const buttons = Array.from(doc.querySelectorAll('button, [role="button"]'))
        .filter(isVisible)
        .map((node) => ({ node, label: labelText(node) }))
        .filter((item) => item.label);
    const button = buttons.find((item) => item.label === `在 ${projectLabel} 中开始新对话`)
        || buttons.find((item) => item.label === `Start new conversation in ${projectLabel}`)
        || buttons.find((item) => item.label === `Start new chat in ${projectLabel}`)
        || buttons.find((item) =>
            /开始新对话|new conversation|new chat/i.test(item.label)
            && normalizeMatch(item.label).includes(normalizeMatch(projectLabel))
        );
    if (!button?.node) {
        return {
            ok: false,
            reason: `Could not find project new conversation button for ${projectLabel}`,
            project: projectLabel,
            projectPath,
            availableProjectNewButtons: buttons
                .map((item) => item.label)
                .filter((label) => /开始新对话|new conversation|new chat/i.test(label))
                .slice(0, 20),
        };
    }
    if (button.node.disabled || String(button.node.getAttribute('aria-disabled') || '').toLowerCase() === 'true') {
        return { ok: false, reason: 'Codex project new conversation button is disabled', project: projectLabel, projectPath };
    }
    button.node.scrollIntoView?.({ block: 'center' });
    const rect = button.node.getBoundingClientRect?.();
    const point = rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)
        ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        : {};
    button.node.click?.();
    return {
        ok: true,
        method: 'project-new-button',
        label: button.label,
        project: projectLabel,
        projectPath,
        ...point,
    };
}

export async function startNewCodexConversation(page, opts = {}) {
    let selectedProject = null;
    const project = cleanText(opts.project || '');
    if (project) {
        selectedProject = await openCodexProject(page, project);
    }
    const stateBefore = await getCodexPageState(page, { last: 1 }).catch(() => null);
    const projectsBefore = await readCodexProjects(page).catch(() => []);
    if (isBlankNewCodexState(stateBefore) && (!project || codexProjectMatchesState(stateBefore, project))) {
        return requireCodexProjectMatch({
            ok: true,
            changed: false,
            selected_project: selectedProject || undefined,
            method: 'already-blank',
            state_before: stateBefore,
            state_after: stateBefore,
            reason: 'Codex is already showing a blank new conversation.',
        }, project);
    }
    const isMac = process.platform === 'darwin';

    let stateAfter = null;
    let projectsAfter = [];
    let createdConversation = null;
    const detectNewConversation = async (method, attempts = 8) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            stateAfter = await getCodexPageState(page, { last: 1 }).catch(() => null);
            if (looksLikeBlankNewCodexState(stateBefore, stateAfter)) {
                return {
                    ok: true,
                    changed: true,
                    selected_project: selectedProject || undefined,
                    method,
                    state_before: stateBefore,
                    state_after: stateAfter,
                };
            }

            projectsAfter = await readCodexProjects(page).catch(() => []);
            createdConversation = chooseCreatedCodexConversation(projectsBefore, projectsAfter, stateBefore);
            if (createdConversation?.threadId) break;

            if (typeof page.wait === 'function') await page.wait(0.25);
        }

        if (!createdConversation?.threadId) return null;
        try {
            const selected = await openCodexConversation(page, {
                project: createdConversation.projectPath || createdConversation.project || project,
                'thread-id': createdConversation.threadId,
            });
            const finalState = await getCodexPageState(page, { last: 1 }).catch(() => null);
            const activated = sameCodexConversationId(finalState?.thread_id, createdConversation.threadId);
            return {
                ok: activated,
                changed: activated,
                selected_project: selectedProject || undefined,
                selected,
                created_conversation: {
                    title: createdConversation.title,
                    threadId: createdConversation.threadId,
                    project: createdConversation.project,
                    projectPath: createdConversation.projectPath,
                },
                state_before: stateBefore,
                state_after: finalState,
                method,
                ...(activated ? {} : { reason: 'Codex created a new conversation row, but it did not become active after selection.' }),
            };
        } catch (error) {
            return {
                ok: false,
                changed: false,
                selected_project: selectedProject || undefined,
                created_conversation: {
                    title: createdConversation.title,
                    threadId: createdConversation.threadId,
                    project: createdConversation.project,
                    projectPath: createdConversation.projectPath,
                },
                state_before: stateBefore,
                state_after: await getCodexPageState(page, { last: 1 }).catch(() => stateAfter),
                method,
                reason: error?.message || String(error),
            };
        }
    };

    if (project) {
        const projectClicked = await page.evaluate(serializePageFunction(clickCodexProjectNewConversationButtonInDocument, project));
        if (projectClicked?.ok) {
            if (typeof page.wait === 'function') await page.wait(0.7);
            const projectButtonResult = await detectNewConversation(projectClicked.method || 'project-new-button');
            if (projectButtonResult) {
                return {
                    ...projectButtonResult,
                    selected_project: selectedProject || projectButtonResult.selected_project,
                    requested_project: project,
                    pending_project_binding: isBlankNewCodexState(projectButtonResult.state_after),
                    method: projectClicked.method || projectButtonResult.method,
                };
            }

            if (typeof page.nativeClick === 'function' && Number.isFinite(projectClicked.x) && Number.isFinite(projectClicked.y)) {
                await page.nativeClick(projectClicked.x, projectClicked.y);
                if (typeof page.wait === 'function') await page.wait(0.7);
                const nativeProjectButtonResult = await detectNewConversation('native-project-new-button');
                if (nativeProjectButtonResult) {
                    return {
                        ...nativeProjectButtonResult,
                        selected_project: selectedProject || nativeProjectButtonResult.selected_project,
                        requested_project: project,
                        pending_project_binding: isBlankNewCodexState(nativeProjectButtonResult.state_after),
                    };
                }
            }
        }
    }

    await page.pressKey(isMac ? 'Meta+N' : 'Control+N');
    if (typeof page.wait === 'function') await page.wait(0.7);
    const shortcutResult = await detectNewConversation(isMac ? 'Meta+N' : 'Control+N');
    if (shortcutResult) return requireCodexProjectMatch(shortcutResult, project);

    const clicked = await page.evaluate(serializePageFunction(clickCodexNewConversationButtonInDocument));
    if (clicked?.ok) {
        if (typeof page.wait === 'function') await page.wait(0.7);
        const buttonResult = await detectNewConversation(clicked.method || 'new-button');
        if (buttonResult) return requireCodexProjectMatch(buttonResult, project);

        if (typeof page.nativeClick === 'function' && Number.isFinite(clicked.x) && Number.isFinite(clicked.y)) {
            await page.nativeClick(clicked.x, clicked.y);
            if (typeof page.wait === 'function') await page.wait(0.7);
            const nativeButtonResult = await detectNewConversation('native-new-button');
            if (nativeButtonResult) return requireCodexProjectMatch(nativeButtonResult, project);
        }
    }

    return requireCodexProjectMatch({
        ok: false,
        changed: false,
        selected_project: selectedProject || undefined,
        state_before: stateBefore,
        state_after: stateAfter,
        reason: clicked?.ok
            ? 'Codex new shortcut/button did not activate a new conversation and no new sidebar conversation was detected.'
            : `Codex new shortcut did not activate a new conversation; ${clicked?.reason || 'new conversation button was not found'}.`,
    }, project);
}

export async function openCodexTarget(page, opts = {}) {
    const target = String(opts.target || '').trim();
    const kwargs = { ...opts };
    if (target && !kwargs.conversation && !kwargs['thread-id'] && !kwargs.thread_id && !kwargs.project) {
        if (target.startsWith('local:')) {
            kwargs['thread-id'] = target;
        } else {
            kwargs.conversation = target;
        }
    }
    if (kwargs.thread_id && !kwargs['thread-id']) {
        kwargs['thread-id'] = kwargs.thread_id;
    }
    const hasConversation = !!(kwargs.conversation || kwargs.index || kwargs['thread-id']);
    const selected = hasConversation
        ? await openCodexConversation(page, kwargs)
        : kwargs.project
            ? await openCodexProject(page, kwargs.project)
            : null;
    return {
        ok: true,
        selected,
        state: await getCodexPageState(page),
    };
}

export async function sendCodexMessage(page, text) {
    const expectedText = String(text || '').replace(/\r/g, '').trim();
    if (!expectedText) throw new Error('message cannot be empty');
    const beforeState = await getCodexPageState(page, { last: 1 });
    if (beforeState.is_generating) {
        throw new Error('Codex is currently generating. Use wait or stop before sending another message.');
    }
    const verifyAccepted = async (method) => {
        let afterState = null;
        for (let attempt = 0; attempt < 16; attempt += 1) {
            if (typeof page.wait === 'function') await page.wait(0.25);
            afterState = await getCodexPageState(page, { last: 3 }).catch(() => null);
            const messageCountIncreased = Number(afterState?.message_count || 0) > Number(beforeState.message_count || 0);
            const composerCleared = afterState?.composer?.available && !afterState.composer.hasText;
            if (afterState?.is_generating || messageCountIncreased || composerCleared) {
                return method;
            }
        }
        const currentText = String(afterState?.composer?.text || '').slice(0, 200);
        throw new Error(`Codex send was not verified after ${method}. Current composer text: ${currentText || '(empty)'}`);
    };
    let state = await page.evaluate(serializePageFunction(composerStateInDocument));
    if (!state?.available) throw selectorError('Codex composer');
    await page.evaluate(serializePageFunction(clearComposerInDocument));
    const preferDomFill = expectedText.length > 200 || expectedText.includes('\n');
    if (page.nativeType && !preferDomFill) {
        try {
            await page.nativeType(expectedText);
            if (typeof page.wait === 'function') await page.wait(0.2);
            state = await page.evaluate(serializePageFunction(composerStateInDocument));
        } catch {
            state = { hasText: false };
        }
    }
    if (!state?.hasText || state.text !== expectedText) {
        state = await page.evaluate(serializePageFunction(fillComposerInDocument, expectedText));
    }
    if (!state?.hasText || state.text !== expectedText) {
        throw new Error(`Failed to insert text into Codex composer. Current text: ${String(state?.text || '').slice(0, 200)}`);
    }
    const clicked = await page.evaluate(serializePageFunction(clickCodexSendButtonInDocument));
    if (clicked?.ok) return verifyAccepted(clicked.method || 'button');
    if (page.nativeKeyPress) {
        try {
            await page.nativeKeyPress('Enter');
            return verifyAccepted('native-enter');
        } catch {
            // Fall through to generic key press.
        }
    }
    await page.pressKey('Enter');
    return verifyAccepted('enter');
}

export function extractLastCodexReply(snapshot, userText = '') {
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    const assistant = [...messages].reverse().find((message) => message.role === 'assistant') || messages[messages.length - 1];
    let reply = String(assistant?.content || '').trim();
    if (userText && (reply === userText || reply.startsWith(`${userText}\n`) || reply.startsWith(`${userText}\r\n`))) {
        reply = reply.slice(userText.length).trim();
    }
    reply = reply.replace(/\s*\bCopy\b\s*$/m, '').trim();
    reply = reply.replace(/\s*复制消息\s*$/m, '').trim();
    return reply;
}

export async function waitForCodexReply(page, beforeSnapshot, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollIntervalMs = opts.pollIntervalMs ?? 500;
    const stableThreshold = opts.stableThreshold ?? 4;
    const deadline = Date.now() + timeoutMs;
    const beforeFingerprint = beforeSnapshot?.textFingerprint || '';
    if (typeof page.wait === 'function') await page.wait(0.5);
    let hasStartedGenerating = !!beforeSnapshot?.isGenerating;
    let lastFingerprint = beforeFingerprint;
    let stableCount = 0;
    while (Date.now() < deadline) {
        const snapshot = await getCodexConversationSnapshot(page);
        const textChanged = snapshot.textFingerprint !== beforeFingerprint && snapshot.messages.length > 0;
        if (snapshot.isGenerating) {
            hasStartedGenerating = true;
            stableCount = 0;
            lastFingerprint = snapshot.textFingerprint;
        } else {
            if (hasStartedGenerating && textChanged) {
                if (typeof page.wait === 'function') await page.wait(0.5);
                return getCodexConversationSnapshot(page);
            }
            if (textChanged) {
                if (snapshot.textFingerprint === lastFingerprint) {
                    stableCount += 1;
                    if (stableCount >= stableThreshold) return snapshot;
                } else {
                    stableCount = 0;
                    lastFingerprint = snapshot.textFingerprint;
                }
            }
            if (!hasStartedGenerating && textChanged) {
                return snapshot;
            }
        }
        if (typeof page.wait === 'function') await page.wait(pollIntervalMs / 1000);
    }
    throw new Error('Timeout waiting for Codex reply');
}

export async function waitForCodexIdle(page, opts = {}) {
    const timeoutMs = Math.max(1, Number(opts.timeoutSeconds || opts.timeout || 120)) * 1000;
    const readLast = Math.max(1, Number(opts.readLast || opts.last || 5));
    const before = await getCodexConversationSnapshot(page, { last: readLast });
    const snapshot = before.isGenerating
        ? await waitForCodexReply(page, before, { timeoutMs })
        : before;
    return {
        ok: true,
        is_generating: !!snapshot.isGenerating,
        message_count: snapshot.messageCount,
        messages: snapshot.messages.slice(-readLast),
        reply: extractLastCodexReply(snapshot),
    };
}

export async function stopCodexGeneration(page) {
    const stateBefore = await getCodexPageState(page);
    const stopped = await page.evaluate(serializePageFunction(clickStopButtonInDocument));
    if (typeof page.wait === 'function') await page.wait(0.5);
    const stateAfter = await getCodexPageState(page);
    return {
        ok: !!stopped?.ok,
        stopped: !!stopped?.ok,
        error: stopped?.ok ? undefined : stopped?.reason,
        state_before: stateBefore,
        state_after: stateAfter,
    };
}

export async function askCodex(page, opts = {}) {
    const message = String(opts.message || opts.text || '').trim();
    if (!message) return { ok: false, action: 'ask', error: 'message is required' };
    const readLast = Math.max(1, Number(opts.readLast || opts['read-last'] || 5));
    const timeoutMs = Math.max(1, Number(opts.timeout || 120)) * 1000;
    const shouldWait = boolValue(opts.wait);
    const shouldStartNew = boolValue(opts.newConversation) || boolValue(opts['new-conversation']) || boolValue(opts.new_conversation);
    const steps = [];
    const stateBefore = await getCodexPageState(page, { last: readLast });
    const runStep = async (name, fn) => {
        try {
            const result = await fn();
            const ok = result?.ok !== false;
            steps.push({ name, ok, ...(ok ? {} : { error: result?.reason || result?.error || 'step failed' }) });
            return result;
        } catch (error) {
            steps.push({ name, ok: false, error: error?.message || String(error) });
            throw error;
        }
    };
    try {
        if (opts.project && shouldStartNew) {
            const requestedProject = String(opts.project).trim();
            const selectedProject = await runStep('project', () => openCodexProject(page, requestedProject));
            if (!selectedProject?.ok) throw new Error(selectedProject?.reason || 'Could not select Codex project');
        } else if (!shouldStartNew && (opts.project || opts.conversation || opts.index || opts['thread-id'] || opts.thread_id)) {
            await runStep('open', () => openCodexTarget(page, opts));
        }
        if (shouldStartNew) {
            const result = await runStep('new', () => startNewCodexConversation(page, { project: opts.project || '' }));
            if (!result?.ok) throw new Error(result?.reason || 'Could not start a new Codex conversation');
        }
        if (String(opts.model || '').trim()) {
            const result = await runStep('model', () => setCodexModel(page, String(opts.model).trim()));
            if (!result?.ok) throw new Error(result?.reason || 'Could not switch Codex model');
        }
        const beforeSend = await getCodexConversationSnapshot(page, { last: readLast });
        const sendMethod = await runStep('send', async () => ({ ok: true, method: await sendCodexMessage(page, message) }));
        let messages = undefined;
        let reply = undefined;
        if (shouldWait) {
            const afterSnapshot = await runStep('wait', () => waitForCodexReply(page, beforeSend, { timeoutMs }));
            messages = Array.isArray(afterSnapshot?.messages) ? afterSnapshot.messages.slice(-readLast) : [];
            reply = extractLastCodexReply(afterSnapshot, message);
        }
        const stateAfter = await getCodexPageState(page, { last: readLast });
        const projectMismatch = shouldStartNew
            && opts.project
            && !codexProjectMatchesState(stateAfter, String(opts.project).trim());
        return {
            ok: steps.every((step) => step.ok) && !projectMismatch,
            action: 'ask',
            steps,
            state_before: stateBefore,
            state_after: stateAfter,
            send_method: sendMethod?.method,
            ...(messages ? { messages } : {}),
            ...(reply !== undefined ? { reply } : {}),
            ...(projectMismatch ? {
                error: `New Codex conversation did not bind requested project "${String(opts.project).trim()}". Actual project_path: ${cleanText(stateAfter?.project_path || '') || '(empty)'}`,
            } : {}),
        };
    } catch (error) {
        return {
            ok: false,
            action: 'ask',
            error: error?.message || String(error),
            steps,
            state_before: stateBefore,
            state_after: await getCodexPageState(page, { last: readLast }).catch(() => null),
        };
    }
}

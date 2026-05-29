import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
    askCodex,
    codexModelOptionsInDocument,
    extractCodexStateFromDocument,
    listCodexModels,
    listCodexConversations,
    normalizeCodexModelLabel,
    openCodexModelSubmenuInDocument,
    selectCodexModelOptionInDocument,
    sendCodexMessage,
    setCodexModel,
    startNewCodexConversation,
    fillComposerInDocument,
} from './utils.js';

function createCodexDom(options = {}) {
    const dom = new JSDOM(`
      <!doctype html>
      <html>
        <head><title>Codex</title></head>
        <body>
          <aside>
            <button type="button" id="new-conversation"><span>新对话</span><kbd>⌘N</kbd></button>
            <div role="list">
              <div role="listitem" aria-label="zhangjian-skills">
                <div
                  role="button"
                  aria-expanded="true"
                  data-app-action-sidebar-project-row
                  data-app-action-sidebar-project-label="zhangjian-skills"
                  data-app-action-sidebar-project-id="/Users/zjah/Documents/code/zhangjian-skills"
                >zhangjian-skills</div>
                <button type="button" id="project-new-conversation" aria-label="在 zhangjian-skills 中开始新对话"></button>
                <div role="list" aria-label="zhangjian-skills conversations">
                  <div
                    role="button"
                    data-app-action-sidebar-thread-row
                    data-app-action-sidebar-thread-title="Current task"
                    data-app-action-sidebar-thread-id="local:thread-1"
                    data-app-action-sidebar-thread-active="true"
                    data-app-action-sidebar-thread-pinned="false"
                  >
                    <span>Current task</span><span class="tabular-nums">1m</span>
                  </div>
                </div>
              </div>
            </div>
          </aside>
          <main>
            <div data-testid="app-shell-header-context-menu-surface"><span>Current task</span></div>
            <section id="messages">
              <div data-content-search-unit-key="turn-1:0:user">Hi</div>
              <div data-content-search-unit-key="turn-1:1:assistant">Hello from Codex</div>
            </section>
            <div data-above-composer-conversation-id="thread-1"></div>
            <div class="composer-footer">
              <button type="button"><span class="composer-footer__label--xs">完全访问权限</span></button>
              <button
                id="model-trigger"
                type="button"
                data-codex-intelligence-trigger="true"
                data-selected-reasoning-effort="xhigh"
              >
                <span class="tabular-nums">5.5</span>
                <span class="composer-footer__label--sm">超高</span>
              </button>
              <div data-codex-composer="true" contenteditable="true"><p></p></div>
              <button id="send" type="button" aria-label="发送">Send</button>
            </div>
          </main>
        </body>
      </html>
    `, { url: 'app://-/index.html', runScripts: 'outside-only' });
    const { document } = dom.window;
    document.execCommand = () => false;
    let pendingProjectPath = '';
    const enterBlankConversation = ({ projectPath = '' } = {}) => {
        pendingProjectPath = projectPath;
        for (const item of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
            item.setAttribute('data-app-action-sidebar-thread-active', 'false');
        }
        document.querySelector('[data-testid="app-shell-header-context-menu-surface"] span').textContent = '';
        document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id', '');
        document.getElementById('messages').replaceChildren();
    };
    const createNewThreadRow = ({ active = false, title = 'New conversation', threadId = 'local:thread-2' } = {}) => {
        if (document.querySelector(`[data-app-action-sidebar-thread-id="${threadId}"]`)) return;
        const row = document.createElement('div');
        row.setAttribute('role', 'button');
        row.setAttribute('data-app-action-sidebar-thread-row', '');
        row.setAttribute('data-app-action-sidebar-thread-title', title);
        row.setAttribute('data-app-action-sidebar-thread-id', threadId);
        row.setAttribute('data-app-action-sidebar-thread-active', active ? 'true' : 'false');
        row.setAttribute('data-app-action-sidebar-thread-pinned', 'false');
        row.textContent = title;
        row.addEventListener('click', () => {
            activateThread(row);
        });
        const list = document.querySelector('[aria-label="zhangjian-skills conversations"]');
        list.insertBefore(row, list.firstChild);
        if (active) activateThread(row);
    };
    const activateThread = (row) => {
        for (const item of document.querySelectorAll('[data-app-action-sidebar-thread-row]')) {
            item.setAttribute('data-app-action-sidebar-thread-active', item === row ? 'true' : 'false');
        }
        const title = row.getAttribute('data-app-action-sidebar-thread-title') || row.textContent.trim();
        const threadId = row.getAttribute('data-app-action-sidebar-thread-id') || '';
        document.querySelector('[data-testid="app-shell-header-context-menu-surface"] span').textContent = title;
        document.querySelector('[data-above-composer-conversation-id]').setAttribute(
            'data-above-composer-conversation-id',
            threadId.replace(/^local:/, '')
        );
        if (threadId === 'local:thread-2' || threadId === 'local:thread-3') {
            document.getElementById('messages').replaceChildren();
        }
    };
    document.getElementById('new-conversation').addEventListener('click', () => {
        enterBlankConversation();
    });
    document.getElementById('project-new-conversation').addEventListener('click', () => {
        enterBlankConversation({ projectPath: '/Users/zjah/Documents/code/zhangjian-skills' });
    });
    document.querySelector('[data-app-action-sidebar-thread-row]').addEventListener('click', (event) => {
        activateThread(event.currentTarget);
    });
    document.getElementById('model-trigger').addEventListener('click', () => {
        if (document.getElementById('model-menu')) return;
        const menu = document.createElement('div');
        menu.id = 'model-menu';
        menu.setAttribute('role', 'menu');
        for (const label of ['智能', '低', '中', '高', '超高']) {
            const item = document.createElement('button');
            item.type = 'button';
            item.textContent = label;
            menu.appendChild(item);
        }
        const modelSubmenu = document.createElement('button');
        modelSubmenu.id = 'model-submenu-trigger';
        modelSubmenu.type = 'button';
        modelSubmenu.setAttribute('aria-haspopup', 'menu');
        modelSubmenu.textContent = 'GPT-5.5';
        modelSubmenu.addEventListener('click', () => {
            if (document.getElementById('model-submenu')) return;
            const submenu = document.createElement('div');
            submenu.id = 'model-submenu';
            submenu.setAttribute('role', 'menu');
            for (const label of ['GPT-5.5', 'GPT-5.4', 'GPT-5.4-Mini', 'GPT-5.3-Codex']) {
                const item = document.createElement('button');
                item.type = 'button';
                item.textContent = label;
                if (options.modelOptionClicks !== false) {
                    item.addEventListener('click', () => {
                        document.querySelector('[data-codex-intelligence-trigger] .tabular-nums').textContent = label.replace(/^GPT-/i, '');
                        document.getElementById('model-submenu')?.remove();
                        document.getElementById('model-menu')?.remove();
                    });
                }
                submenu.appendChild(item);
            }
            document.body.appendChild(submenu);
        });
        menu.appendChild(modelSubmenu);
        const speedSubmenu = document.createElement('button');
        speedSubmenu.type = 'button';
        speedSubmenu.setAttribute('aria-haspopup', 'menu');
        speedSubmenu.textContent = '速度';
        menu.appendChild(speedSubmenu);
        document.body.appendChild(menu);
    });
    document.getElementById('send').addEventListener('click', () => {
        const composer = document.querySelector('[data-codex-composer]');
        const text = composer.textContent.trim();
        const currentConversationId = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id') || '';
        if (!currentConversationId && pendingProjectPath === '/Users/zjah/Documents/code/zhangjian-skills') {
            createNewThreadRow({ active: true, title: text, threadId: 'local:thread-3' });
            pendingProjectPath = '';
        }
        const messages = document.getElementById('messages');
        const user = document.createElement('div');
        user.setAttribute('data-content-search-unit-key', 'turn-2:0:user');
        user.textContent = text;
        const assistant = document.createElement('div');
        assistant.setAttribute('data-content-search-unit-key', 'turn-2:1:assistant');
        assistant.textContent = `Reply to ${text}`;
        messages.append(user, assistant);
        composer.textContent = '';
    });
    dom.createNewThreadRow = createNewThreadRow;
    return dom;
}

function createPage(dom, options = {}) {
    const shortcutCreatesNew = options.shortcutCreatesNew !== false;
    let nativeClickCount = 0;
    return {
        evaluate: async (script) => {
            if (script === 'window.location.href') return dom.window.location.href;
            if (script === 'document.title') return dom.window.document.title;
            return dom.window.eval(script);
        },
        wait: async () => {},
        pressKey: async (key) => {
            if (key === 'Escape') {
                dom.window.document.getElementById('model-submenu')?.remove();
                dom.window.document.getElementById('model-menu')?.remove();
                return;
            }
            if (key === 'Meta+N' || key === 'Control+N') {
                if (shortcutCreatesNew) {
                    dom.createNewThreadRow({ active: false });
                }
            }
        },
        ...(options.nativeModelClicks ? {
            nativeClick: async () => {
                nativeClickCount += 1;
                if (nativeClickCount === 1) {
                    dom.window.document.querySelector('[data-codex-intelligence-trigger]').click();
                } else if (nativeClickCount === 2) {
                    dom.window.document.getElementById('model-submenu-trigger')?.click();
                } else {
                    if (!options.ignoreNativeModelSelection) {
                        Array.from(dom.window.document.querySelectorAll('[role="menu"] button'))
                            .find((button) => button.textContent.trim() === 'GPT-5.4')
                            ?.click();
                    }
                }
            },
        } : {}),
    };
}

describe('codex app utils', () => {
    it('normalizes compact Codex model labels', () => {
        expect(normalizeCodexModelLabel('5.5')).toBe('gpt-5.5');
        expect(normalizeCodexModelLabel('gpt 5.4')).toBe('gpt-5.4');
    });

    it('extracts state from the Codex document', () => {
        const dom = createCodexDom();

        const state = extractCodexStateFromDocument(dom.window.document, { last: 1 });

        expect(state.currentModel).toBe('gpt-5.5');
        expect(state.reasoningEffort).toBe('xhigh');
        expect(state.permissionLabel).toContain('完全访问权限');
        expect(state.sandbox).toBe('danger-full-access');
        expect(state.composer.available).toBe(true);
        expect(state.isGenerating).toBe(false);
        expect(state.messages).toEqual([
            expect.objectContaining({ role: 'assistant', content: 'Hello from Codex' }),
        ]);
    });

    it('lists model options from the opened Codex model menu', () => {
        const dom = createCodexDom();
        dom.window.document.querySelector('[data-codex-intelligence-trigger]').click();
        openCodexModelSubmenuInDocument(dom.window.document);

        const models = codexModelOptionsInDocument(dom.window.document);

        expect(models.currentModel).toBe('gpt-5.5');
        expect(models.availableModels).toEqual(expect.arrayContaining(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini']));
    });

    it('selects a requested Codex model option', () => {
        const dom = createCodexDom();
        dom.window.document.querySelector('[data-codex-intelligence-trigger]').click();
        openCodexModelSubmenuInDocument(dom.window.document);

        const selected = selectCodexModelOptionInDocument(dom.window.document, 'gpt-5.4');

        expect(selected.ok).toBe(true);
        expect(extractCodexStateFromDocument(dom.window.document).currentModel).toBe('gpt-5.4');
    });

    it('clicks the actionable Radix menu ancestor for nested model text', () => {
        const dom = createCodexDom();
        const { document } = dom.window;
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        const item = document.createElement('div');
        item.setAttribute('role', 'menuitem');
        item.setAttribute('data-radix-collection-item', '');
        const wrapper = document.createElement('div');
        const label = document.createElement('span');
        label.textContent = 'GPT-5.4';
        wrapper.appendChild(label);
        item.appendChild(wrapper);
        item.addEventListener('click', () => {
            document.querySelector('[data-codex-intelligence-trigger] .tabular-nums').textContent = '5.4';
        });
        menu.appendChild(item);
        document.body.appendChild(menu);

        const selected = selectCodexModelOptionInDocument(document, 'gpt-5.4');

        expect(selected.ok).toBe(true);
        expect(extractCodexStateFromDocument(document).currentModel).toBe('gpt-5.4');
    });

    it('uses native clicks for the nested Codex model menu when available', async () => {
        const page = createPage(createCodexDom(), { nativeModelClicks: true });

        const models = await listCodexModels(page);

        expect(models.availableModels).toEqual(expect.arrayContaining(['gpt-5.4', 'gpt-5.4-mini']));
    });

    it('uses native clicks to switch a real nested Codex model menu', async () => {
        const page = createPage(createCodexDom(), { nativeModelClicks: true });

        const result = await setCodexModel(page, 'gpt-5.4');

        expect(result.ok).toBe(true);
        expect(result.currentModel).toBe('gpt-5.4');
    });

    it('does not report changed when a model click is not verified', async () => {
        const page = createPage(createCodexDom({ modelOptionClicks: false }), {
            nativeModelClicks: true,
            ignoreNativeModelSelection: true,
        });

        const result = await setCodexModel(page, 'gpt-5.4');

        expect(result.ok).toBe(false);
        expect(result.changed).toBe(false);
        expect(result.clicked).toBe(true);
        expect(result.selectedModel).toBe('GPT-5.4');
        expect(result.currentModel).toBe('gpt-5.5');
        expect(result.reason).toContain('not verified');
    });

    it('does not report sent when Codex does not accept the composer text', async () => {
        const dom = createCodexDom();
        dom.window.document.getElementById('send').remove();
        const page = createPage(dom);

        await expect(sendCodexMessage(page, 'Hello')).rejects.toThrow('send was not verified');
    });

    it('falls back to direct composer replacement when insertText truncates text', () => {
        const dom = createCodexDom();
        const editor = dom.window.document.querySelector('[data-codex-composer]');
        dom.window.document.execCommand = (_command, _showUi, value) => {
            editor.textContent = String(value).slice(0, 8);
            return true;
        };

        const result = fillComposerInDocument(
            dom.window.document,
            'line one\nline two with a longer message'
        );

        expect(result.ok).toBe(true);
        expect(result.text).toBe('line one\nline two with a longer message');
    });

    it('uses DOM fill for long multiline Codex messages instead of native typing', async () => {
        const dom = createCodexDom();
        let nativeTyped = false;
        const page = {
            ...createPage(dom),
            nativeType: async () => {
                nativeTyped = true;
            },
        };

        await sendCodexMessage(page, 'A long request\n'.repeat(30));

        expect(nativeTyped).toBe(false);
    });

    it('does not try to switch models while Codex is generating', async () => {
        const dom = createCodexDom();
        const stop = dom.window.document.createElement('button');
        stop.setAttribute('aria-label', '停止');
        dom.window.document.body.appendChild(stop);
        const page = createPage(dom, { nativeModelClicks: true });

        const result = await setCodexModel(page, 'gpt-5.4');

        expect(result.ok).toBe(false);
        expect(result.changed).toBe(false);
        expect(result.reason).toContain('currently generating');
        expect(extractCodexStateFromDocument(dom.window.document).currentModel).toBe('gpt-5.5');
    });

    it('does not select model text from the transcript when the model menu is closed', () => {
        const dom = createCodexDom();
        const assistant = dom.window.document.createElement('div');
        assistant.setAttribute('data-content-search-unit-key', 'turn-3:1:assistant');
        assistant.textContent = 'The requested gpt-5.4 model is mentioned in this transcript.';
        dom.window.document.getElementById('messages').appendChild(assistant);

        const selected = selectCodexModelOptionInDocument(dom.window.document, 'gpt-5.4');

        expect(selected.ok).toBe(false);
        expect(selected.reason).toContain('model menu is not open');
        expect(extractCodexStateFromDocument(dom.window.document).currentModel).toBe('gpt-5.5');
    });

    it('lists compact visible projects and conversations', async () => {
        const page = createPage(createCodexDom());

        const result = await listCodexConversations(page);

        expect(result).toMatchObject({
            ok: true,
            project_count: 1,
            conversation_count: 1,
        });
        expect(result.projects[0].conversations[0]).toMatchObject({
            title: 'Current task',
            active: true,
            threadId: 'local:thread-1',
        });
    });

    it('clips long conversation titles while preserving thread ids', async () => {
        const dom = createCodexDom();
        const row = dom.window.document.querySelector('[data-app-action-sidebar-thread-row]');
        const longTitle = 'Long Codex title '.repeat(20);
        row.setAttribute('data-app-action-sidebar-thread-title', longTitle);
        row.textContent = longTitle;
        const page = createPage(dom);

        const result = await listCodexConversations(page);
        const conversation = result.projects[0].conversations[0];

        expect(conversation.title.length).toBeLessThanOrEqual(140);
        expect(conversation.title).toMatch(/\.\.\.$/);
        expect(conversation.titleTruncated).toBe(true);
        expect(conversation.titleFullLength).toBe(longTitle.trim().length);
        expect(conversation.threadId).toBe('local:thread-1');
    });

    it('activates the new sidebar conversation after the Codex new shortcut', async () => {
        const page = createPage(createCodexDom());

        const result = await askCodex(page, {
            message: 'Hello',
            model: 'gpt-5.4',
            new_conversation: true,
            wait: true,
            timeout: 1,
            readLast: 3,
        });

        expect(result.ok).toBe(true);
        expect(result.steps.map((step) => step.name)).toEqual(['new', 'model', 'send', 'wait']);
        expect(result.state_after.thread_id).toBe('local:thread-2');
        expect(result.state_after.conversation).toBe('New conversation');
    });

    it('falls back to the visible new conversation button when the shortcut is ignored', async () => {
        const page = createPage(createCodexDom(), { shortcutCreatesNew: false });

        const result = await startNewCodexConversation(page);

        expect(result.ok).toBe(true);
        expect(result.method).toBe('new-button');
        expect(result.state_after.thread_id).toBe('');
        expect(result.state_after.message_count).toBe(0);
        expect(result.state_after.composer.available).toBe(true);
    });

    it('treats an existing blank composer as a usable new conversation', async () => {
        const dom = createCodexDom();
        dom.window.document.getElementById('new-conversation').click();
        const page = createPage(dom, { shortcutCreatesNew: false });

        const result = await startNewCodexConversation(page);

        expect(result.ok).toBe(true);
        expect(result.changed).toBe(false);
        expect(result.method).toBe('already-blank');
    });

    it('runs ask as new -> model -> send -> wait and returns a structured result', async () => {
        const page = createPage(createCodexDom());

        const result = await askCodex(page, {
            message: 'Hello',
            project: 'zhangjian-skills',
            model: 'gpt-5.4',
            new_conversation: true,
            wait: true,
            timeout: 1,
            readLast: 3,
        });

        expect(result.ok).toBe(true);
        expect(result.action).toBe('ask');
        expect(result.steps.map((step) => step.name)).toEqual(['project', 'new', 'model', 'send', 'wait']);
        expect(result.state_after.model).toBe('gpt-5.4');
        expect(result.reply).toBe('Reply to Hello');
    });
});

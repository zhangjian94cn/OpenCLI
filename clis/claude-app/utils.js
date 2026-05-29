import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    CLAUDE_DOMAIN,
    COMPOSER_SELECTOR,
    ensureClaudeComposer,
    ensureClaudeLogin,
    getPageState,
    isOnClaude,
} from '../claude/utils.js';

export const CLAUDE_APP_SITE = 'claude-app';
export const CLAUDE_APP_LABEL = 'Claude App';
export const CLAUDE_APP_PROJECTS_URL = 'https://claude.ai/projects';
export const CLAUDE_APP_CODE_URL = 'https://claude.ai/epitaxy';
export const CLAUDE_APP_DEFAULT_MODE = 'code';
export const CLAUDE_APP_MODES = ['chat', 'cowork', 'code'];
export const CLAUDE_APP_MODE_LABELS = {
    chat: 'Chat',
    cowork: 'Cowork',
    code: 'Code',
};
export const CLAUDE_APP_CODE_MODEL_LABELS = {
    sonnet: 'Sonnet 4.6',
    opus: 'Opus 4.7',
    haiku: 'Haiku 4.5',
};
export const CLAUDE_APP_CODE_EFFORT_LABELS = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    extra_high: 'Extra high',
    max: 'Max',
};

export function normalizeClaudeAppMode(value, defaultMode = CLAUDE_APP_DEFAULT_MODE) {
    const raw = String(value ?? '').trim().toLowerCase();
    const normalized = ({
        co_work: 'cowork',
        'co-work': 'cowork',
        co_working: 'cowork',
        'co-working': 'cowork',
        coding: 'code',
    })[raw] || raw || defaultMode;
    if (!CLAUDE_APP_MODES.includes(normalized)) {
        throw new ArgumentError(
            `Unsupported Claude App mode: ${value}`,
            'Use one of: chat, cowork, code. Default is code.',
        );
    }
    return normalized;
}

function normalizeLooseOptionKey(value) {
    return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeClaudeAppCodeModel(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const key = normalizeLooseOptionKey(raw);
    if (CLAUDE_APP_CODE_MODEL_LABELS[key]) return CLAUDE_APP_CODE_MODEL_LABELS[key];
    if (key.includes('sonnet')) return CLAUDE_APP_CODE_MODEL_LABELS.sonnet;
    if (key.includes('opus')) return CLAUDE_APP_CODE_MODEL_LABELS.opus;
    if (key.includes('haiku')) return CLAUDE_APP_CODE_MODEL_LABELS.haiku;
    if (/^(sonnet|opus|haiku)\s+\d/i.test(raw)) return raw;
    throw new ArgumentError(
        `Unsupported Claude App Code model: ${value}`,
        'Use one of: sonnet, opus, haiku, or an exact visible Code model label.',
    );
}

export function normalizeClaudeAppCodeEffort(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const key = normalizeLooseOptionKey(raw);
    const normalized = ({
        xhigh: 'extra_high',
        extra: 'extra_high',
        extra_high: 'extra_high',
        maximum: 'max',
    })[key] || key;
    if (CLAUDE_APP_CODE_EFFORT_LABELS[normalized]) return CLAUDE_APP_CODE_EFFORT_LABELS[normalized];
    throw new ArgumentError(
        `Unsupported Claude App Code effort: ${value}`,
        'Use one of: low, medium, high, extra_high, or max.',
    );
}

export async function ensureClaudeAppPage(page, message = 'Claude App requires a visible claude.ai session.') {
    if (!(await isOnClaude(page))) {
        const url = await page.evaluate('window.location.href').catch(() => '');
        throw new CommandExecutionError(
            message,
            `Connected desktop window is not on ${CLAUDE_DOMAIN}. Current URL: ${url || '(unknown)'}`,
        );
    }
    return ensureClaudeLogin(page, message);
}

export async function ensureClaudeAppComposer(page, message = 'Claude App requires a visible composer.') {
    await ensureClaudeAppPage(page, message);
    return ensureClaudeComposer(page, message);
}

export async function waitForClaudeAppComposer(page, timeout = 8) {
    try {
        await page.wait({ selector: COMPOSER_SELECTOR, timeout });
    } catch {
        // Callers run ensureClaudeAppComposer afterwards to surface a typed error.
    }
}

export async function getClaudeAppMode(page) {
    const result = await page.evaluate(`(() => {
        function normalizeMode(value) {
            var text = String(value || '').trim().toLowerCase();
            if (text === 'co-work' || text === 'co_work' || text === 'co working') return 'cowork';
            if (text === 'coding') return 'code';
            if (['chat', 'cowork', 'code'].indexOf(text) >= 0) return text;
            return '';
        }
        var frameMode = normalizeMode((document.querySelector('.dframe-root') || {}).getAttribute?.('data-frame-mode'));
        var group = document.querySelector('[role="group"][aria-label="Mode"]');
        var buttons = Array.from(group ? group.querySelectorAll('button') : []);
        var options = buttons.map(function(button) {
            var label = (button.getAttribute('aria-label') || button.innerText || '').trim();
            var mode = normalizeMode(label);
            var disabled = button.getAttribute('aria-disabled') === 'true' || button.getAttribute('data-disabled') === 'true' || !!button.disabled;
            var active = button.getAttribute('data-active') === 'true' || button.getAttribute('aria-current') === 'page';
            return { mode: mode, label: label, disabled: disabled, active: active };
        }).filter(function(item) { return !!item.mode; });
        var active = options.find(function(item) { return item.active; }) || options.find(function(item) { return item.mode === frameMode; }) || null;
        var mode = (active && active.mode) || frameMode || '';
        var labels = { chat: 'Chat', cowork: 'Cowork', code: 'Code' };
        return {
            Mode: mode,
            ModeLabel: labels[mode] || '',
            ModeOptions: options,
        };
    })()`).catch(() => null);
    if (!result || typeof result !== 'object') {
        return { Mode: '', ModeLabel: '', ModeOptions: [] };
    }
    return result;
}

function normalizeComparableText(value) {
    return String(value ?? '').trim().toLowerCase();
}

function sessionTimeValue(session) {
    return Number(session.LastFocusedAt || session.LastActivityAt || session.CreatedAt || 0) || 0;
}

export async function readClaudeAppCodeSessionsFromDisk() {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.default.join(process.env.HOME || '', 'Library/Application Support/Claude/claude-code-sessions');
    const rows = [];
    if (!root || !fs.default.existsSync(root)) return rows;

    function walk(dir) {
        for (const entry of fs.default.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            try {
                const data = JSON.parse(fs.default.readFileSync(fullPath, 'utf8'));
                const id = data.sessionId || data.id || path.default.basename(entry.name, '.json');
                if (!id) continue;
                rows.push({
                    Id: id,
                    Title: data.title || '',
                    Cwd: data.cwd || '',
                    OriginCwd: data.originCwd || '',
                    Model: data.model || '',
                    Effort: data.effort || '',
                    CreatedAt: data.createdAt || 0,
                    LastActivityAt: data.lastActivityAt || 0,
                    LastFocusedAt: data.lastFocusedAt || 0,
                    CompletedTurns: data.completedTurns || 0,
                    Archived: data.isArchived ? 'Yes' : 'No',
                    SourcePath: fullPath,
                    Url: CLAUDE_APP_CODE_URL,
                });
            } catch {
                // Ignore partial or foreign JSON files in Claude's app support tree.
            }
        }
    }

    walk(root);
    rows.sort((a, b) => sessionTimeValue(b) - sessionTimeValue(a));
    return rows.map((row, index) => ({ Index: index + 1, ...row }));
}

export async function getClaudeAppVisibleCodeSessions(page) {
    const items = await page.evaluate(`(() => {
        var rows = Array.from(document.querySelectorAll('[data-row-key^="code:"]'));
        return rows.map(function(row, i) {
            var key = row.getAttribute('data-row-key') || '';
            var button = row.querySelector('[data-row-main-button]') || row.querySelector('button');
            var rawTitle = ((button && button.innerText) || row.innerText || '').trim();
            var title = rawTitle.split('\\n').map(function(line) {
                return line.trim();
            }).filter(Boolean)[0] || '';
            var selected = !!row.querySelector('[aria-current="page"], [data-selected="focused"], [data-selected="open"]');
            return {
                Index: i + 1,
                Id: key.replace(/^code:/, ''),
                Title: title,
                Visible: 'Yes',
                Selected: selected ? 'Yes' : 'No',
                Url: window.location.href,
            };
        });
    })()`).catch(() => []);
    return Array.isArray(items) ? items : [];
}

export async function getClaudeAppCodeSessionList(page) {
    const diskRows = await readClaudeAppCodeSessionsFromDisk();
    const visibleRows = await getClaudeAppVisibleCodeSessions(page);
    const visibleById = new Map(visibleRows.map((row) => [String(row.Id || ''), row]));
    const seen = new Set();
    const merged = diskRows.map((row) => {
        seen.add(row.Id);
        const visible = visibleById.get(row.Id);
        return {
            ...row,
            Title: row.Title || visible?.Title || '',
            Visible: visible?.Visible || 'No',
            Selected: visible?.Selected || 'No',
            Url: visible?.Url || row.Url || CLAUDE_APP_CODE_URL,
        };
    });
    for (const row of visibleRows) {
        if (seen.has(row.Id)) continue;
        merged.push({
            ...row,
            Cwd: '',
            OriginCwd: '',
            Model: '',
            Effort: '',
            CreatedAt: 0,
            LastActivityAt: 0,
            LastFocusedAt: 0,
            CompletedTurns: 0,
            Archived: '',
            SourcePath: '',
        });
    }
    merged.sort((a, b) => sessionTimeValue(b) - sessionTimeValue(a));
    return merged.map((row, index) => ({ ...row, Index: index + 1 }));
}

export function findClaudeAppCodeSession(sessions, selector) {
    const wanted = requireClaudeAppProjectSelector(selector);
    const normalized = normalizeComparableText(wanted);
    const path = String(wanted).includes('/') ? String(wanted).replace(/\/+$/, '') : '';
    const basename = path ? path.split('/').filter(Boolean).pop().toLowerCase() : normalized;
    const list = Array.isArray(sessions) ? sessions : [];
    if (list.length === 0) {
        throw new EmptyResultError('claude-app code sessions', 'No Claude App Code sessions were found locally or in the sidebar.');
    }

    const scored = list.map((session) => {
        const id = normalizeComparableText(session.Id);
        const title = normalizeComparableText(session.Title);
        const cwd = normalizeComparableText(session.Cwd);
        const originCwd = normalizeComparableText(session.OriginCwd);
        const cwdBase = cwd.split('/').filter(Boolean).pop() || '';
        const originBase = originCwd.split('/').filter(Boolean).pop() || '';
        let score = 0;
        if (id === normalized) score = Math.max(score, 100);
        if (path && (cwd === path.toLowerCase() || originCwd === path.toLowerCase())) score = Math.max(score, 95);
        if (cwdBase === basename || originBase === basename) score = Math.max(score, 90);
        if (title === normalized) score = Math.max(score, 85);
        if (cwd.includes(normalized) || originCwd.includes(normalized)) score = Math.max(score, 75);
        if (title.includes(normalized)) score = Math.max(score, 65);
        if (id.includes(normalized)) score = Math.max(score, 60);
        return { session, score };
    }).filter((item) => item.score > 0);

    if (scored.length === 0) {
        throw new ArgumentError(
            `Claude App Code session not found: ${wanted}`,
            'Use opencli claude-app history --mode code --format json to pick a visible session id/title/cwd.',
        );
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return sessionTimeValue(b.session) - sessionTimeValue(a.session);
    });
    return scored[0].session;
}

export async function selectClaudeAppCodeSession(page, selector) {
    await selectClaudeAppMode(page, 'code');
    const sessions = await getClaudeAppCodeSessionList(page);
    const session = findClaudeAppCodeSession(sessions, selector);

    const clicked = await page.evaluate(`(() => {
        var rowKey = ${JSON.stringify(`code:${session.Id}`)};
        var escaped = (window.CSS && CSS.escape) ? CSS.escape(rowKey) : rowKey.replace(/"/g, '\\\\"');
        var row = document.querySelector('[data-row-key="' + escaped + '"]');
        if (!row) {
            row = Array.from(document.querySelectorAll('[data-row-key^="code:"]')).find(function(candidate) {
                return candidate.getAttribute('data-row-key') === rowKey;
            });
        }
        if (!row) return { ok: false, reason: 'code session row not visible' };
        var button = row.querySelector('[data-row-main-button]') || row.querySelector('button') || row;
        button.click();
        return { ok: true };
    })()`);

    if (!clicked?.ok) {
        throw new CommandExecutionError(
            `Claude App Code session is not visible in the sidebar: ${session.Id}`,
            'Switch to Code mode, use View all if needed, or select another session from opencli claude-app history --mode code.',
        );
    }

    await waitForClaudeAppComposer(page, 10);
    await ensureClaudeAppPage(page, 'Claude App Code session requires a logged-in Claude session.');
    return {
        ...session,
        Mode: 'Code',
        ModeKey: 'code',
        CodeSession: session.Title || session.Id,
        CodeSessionId: session.Id,
        CodeCwd: session.Cwd || session.OriginCwd || '',
    };
}

function codeFolderBasename(value) {
    return String(value ?? '').trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
}

async function closeClaudeAppMenus(page) {
    await page.evaluate(`(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    })()`).catch(() => null);
    await page.wait(0.15);
}

export async function getClaudeAppCodeDraftState(page) {
    const result = await page.evaluate(`(() => {
        function text(el) {
            return ((el && (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title'))) || '').trim();
        }
        var primary = document.querySelector('[role="region"][aria-label="Primary pane"]') || document.querySelector('main') || document.body;
        var buttons = Array.from(primary.querySelectorAll('button')).map(function(button) {
            return {
                text: text(button),
                aria: button.getAttribute('aria-label') || '',
                title: button.getAttribute('title') || '',
                expanded: button.getAttribute('aria-expanded') || '',
                disabled: !!button.disabled,
            };
        }).filter(function(item) { return item.text || item.aria || item.title; });
        var localIndex = buttons.findIndex(function(item) { return item.text === 'Local'; });
        var folderButton = localIndex >= 0 ? buttons[localIndex + 1] : null;
        var branchButton = localIndex >= 0 ? buttons[localIndex + 2] : null;
        var modelButton = buttons.slice().reverse().find(function(item) {
            return /\\b(Opus|Sonnet|Haiku)\\b/.test(item.text);
        }) || null;
        var modelText = modelButton ? modelButton.text.replace(/\\s+/g, ' ').trim() : '';
        var permissionButton = buttons.find(function(item) {
            return /permissions/i.test(item.text || item.aria);
        }) || null;
        var prompt = document.querySelector('[contenteditable="true"][aria-label="Prompt"]');
        return {
            Url: window.location.href,
            IsDraft: /\\/epitaxy\\/?$/.test(window.location.pathname),
            HasPrompt: !!prompt,
            Folder: folderButton ? folderButton.text : '',
            FolderPath: folderButton ? folderButton.title : '',
            Branch: branchButton ? branchButton.text : '',
            Model: modelText,
            Effort: modelText && /·\\s*([^·]+)$/.test(modelText) ? modelText.replace(/^.*·\\s*/, '').trim() : '',
            Permission: permissionButton ? permissionButton.text : '',
        };
    })()`).catch(() => null);
    return result && typeof result === 'object' ? result : {};
}

export async function selectClaudeAppCodeFolder(page, selector) {
    const wanted = String(selector ?? '').trim();
    if (!wanted) return getClaudeAppCodeDraftState(page);
    const wantedBase = codeFolderBasename(wanted);
    const current = await getClaudeAppCodeDraftState(page);
    if (
        current.Folder === wanted ||
        current.Folder === wantedBase ||
        current.FolderPath === wanted ||
        (current.FolderPath && current.FolderPath.replace(/\/+$/, '') === wanted.replace(/\/+$/, ''))
    ) {
        return { ok: true, changed: false, ...current };
    }

    const opened = await page.evaluate(`(() => {
        function text(el) {
            return ((el && (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title'))) || '').trim();
        }
        var primary = document.querySelector('[role="region"][aria-label="Primary pane"]') || document.querySelector('main') || document.body;
        var buttons = Array.from(primary.querySelectorAll('button'));
        var localIndex = buttons.findIndex(function(button) { return text(button) === 'Local'; });
        var folderButton = localIndex >= 0 ? buttons[localIndex + 1] : null;
        if (!folderButton) {
            folderButton = buttons.find(function(button) {
                var title = button.getAttribute('title') || '';
                var label = text(button);
                return title.indexOf('/') >= 0 || label === ${JSON.stringify(wanted)} || label === ${JSON.stringify(wantedBase)};
            });
        }
        if (!folderButton) return { ok: false, reason: 'folder button not found' };
        folderButton.click();
        return { ok: true };
    })()`);
    if (!opened?.ok) {
        throw new CommandExecutionError(`Could not open Claude App Code folder menu: ${opened?.reason || 'unknown error'}`);
    }

    try {
        await page.wait({ selector: '[role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitem"]', timeout: 3 });
    } catch {
        // The next evaluate returns an actionable not-found result.
    }

    const clicked = await page.evaluate(`(() => {
        var wanted = ${JSON.stringify(wanted)};
        var wantedBase = ${JSON.stringify(wantedBase)};
        var items = Array.from(document.querySelectorAll('[role="menu"] [role="menuitemradio"], [role="menu"] [role="menuitem"]'));
        function clean(value) { return String(value || '').trim(); }
        function normalizedPath(value) { return clean(value).replace(/\\/+$/, ''); }
        var target = items.find(function(item) {
            var label = clean(item.innerText).split('\\n').map(function(line) { return line.trim(); }).filter(Boolean)[0] || '';
            var title = clean(item.getAttribute('title'));
            return label === wanted || label === wantedBase || normalizedPath(title) === normalizedPath(wanted) || title.endsWith('/' + wantedBase);
        });
        if (!target) {
            var available = items.map(function(item) {
                var label = clean(item.innerText).split('\\n').map(function(line) { return line.trim(); }).filter(Boolean)[0] || '';
                var title = clean(item.getAttribute('title'));
                return title ? (label + ' (' + title + ')') : label;
            }).filter(Boolean).slice(0, 8);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            return { ok: false, available: available };
        }
        var label = clean(target.innerText).split('\\n').map(function(line) { return line.trim(); }).filter(Boolean)[0] || '';
        var title = clean(target.getAttribute('title'));
        var checked = target.getAttribute('aria-checked') === 'true';
        if (!checked) target.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        return { ok: true, changed: !checked, label: label, title: title };
    })()`);

    if (!clicked?.ok) {
        throw new ArgumentError(
            `Claude App Code folder is not available in the recent-folder menu: ${wanted}`,
            `Open the folder once in Claude App or use the App UI's Add another folder control. Available: ${(clicked?.available || []).join(', ') || '(none)'}`,
        );
    }

    await page.wait(0.5);
    const next = await getClaudeAppCodeDraftState(page);
    return { ok: true, ...clicked, ...next };
}

async function openClaudeAppCodeModelMenu(page) {
    await closeClaudeAppMenus(page);
    const opened = await page.evaluate(`(() => {
        var primary = document.querySelector('[role="region"][aria-label="Primary pane"]') || document.querySelector('main') || document.body;
        var buttons = Array.from(primary.querySelectorAll('button'));
        var target = buttons.slice().reverse().find(function(button) {
            return /\\b(Opus|Sonnet|Haiku)\\b/.test((button.innerText || '').trim());
        });
        if (!target) return { ok: false, reason: 'model button not found' };
        target.click();
        return { ok: true };
    })()`);
    if (!opened?.ok) {
        throw new CommandExecutionError(`Could not open Claude App Code model menu: ${opened?.reason || 'unknown error'}`);
    }
    try {
        await page.wait({ selector: '[role="menu"]', timeout: 3 });
    } catch {
        // The selecting evaluate below reports a useful not-found result.
    }
}

async function clickClaudeAppCodeMenuItem(page, label, sectionName) {
    return page.evaluate(`(() => {
        var label = ${JSON.stringify(label)};
        var sectionName = ${JSON.stringify(sectionName)};
        var menus = Array.from(document.querySelectorAll('[role="menu"]'));
        var menu = menus[menus.length - 1];
        if (!menu) return { ok: false, reason: 'menu not found' };
        var items = Array.from(menu.querySelectorAll('[role="menuitemradio"], [role="menuitem"], button, div'));
        function clean(el) { return ((el && (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title'))) || '').replace(/\\s+/g, ' ').trim(); }
        function visible(el) {
            var rect = el.getBoundingClientRect();
            return rect && rect.width > 0 && rect.height > 0;
        }
        var target = items.find(function(item) {
            var itemText = clean(item);
            if (!itemText || !visible(item)) return false;
            if (itemText === label || itemText.indexOf(label + ' ·') === 0) return true;
            return sectionName === 'model' && itemText.indexOf(label) >= 0 && /^\\b(Opus|Sonnet|Haiku)\\b/.test(itemText);
        });
        if (!target) {
            var available = items.map(clean).filter(Boolean).slice(0, 20);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            return { ok: false, reason: sectionName + ' item not found', available: available };
        }
        var checked = target.getAttribute('aria-checked') === 'true';
        if (!checked) target.click();
        else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        return { ok: true, changed: !checked, label: clean(target) };
    })()`);
}

export async function selectClaudeAppCodeModel(page, model) {
    const label = normalizeClaudeAppCodeModel(model);
    if (!label) return getClaudeAppCodeDraftState(page);
    const current = await getClaudeAppCodeDraftState(page);
    if (current.Model && current.Model.indexOf(label) >= 0) {
        return { ok: true, changed: false, ...current };
    }
    await openClaudeAppCodeModelMenu(page);
    const clicked = await clickClaudeAppCodeMenuItem(page, label, 'model');
    if (!clicked?.ok) {
        throw new ArgumentError(
            `Claude App Code model is not available: ${label}`,
            `Visible menu options: ${(clicked?.available || []).join(', ') || '(none)'}`,
        );
    }
    await page.wait(0.5);
    const next = await getClaudeAppCodeDraftState(page);
    return { ok: true, ...clicked, ...next };
}

export async function selectClaudeAppCodeEffort(page, effort) {
    const label = normalizeClaudeAppCodeEffort(effort);
    if (!label) return getClaudeAppCodeDraftState(page);
    const current = await getClaudeAppCodeDraftState(page);
    if (current.Effort && current.Effort.toLowerCase() === label.toLowerCase()) {
        return { ok: true, changed: false, ...current };
    }
    await openClaudeAppCodeModelMenu(page);
    const clicked = await clickClaudeAppCodeMenuItem(page, label, 'effort');
    if (!clicked?.ok) {
        throw new ArgumentError(
            `Claude App Code effort is not available: ${label}`,
            `Visible menu options: ${(clicked?.available || []).join(', ') || '(none)'}`,
        );
    }
    await page.wait(0.5);
    const next = await getClaudeAppCodeDraftState(page);
    return { ok: true, ...clicked, ...next };
}

export async function setClaudeAppCodeBranch(page, branch) {
    const value = String(branch ?? '').trim();
    if (!value) return getClaudeAppCodeDraftState(page);
    const current = await getClaudeAppCodeDraftState(page);
    if (current.Branch === value) return { ok: true, changed: false, ...current };
    const selected = await page.evaluate(`(() => {
        var value = ${JSON.stringify(value)};
        var primary = document.querySelector('[role="region"][aria-label="Primary pane"]') || document.querySelector('main') || document.body;
        var inputs = Array.from(primary.querySelectorAll('input'));
        var target = inputs.find(function(input) { return input.value || input.placeholder; });
        if (!target) return { ok: false, reason: 'branch input not found' };
        target.focus();
        target.value = value;
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true };
    })()`);
    if (!selected?.ok) {
        throw new CommandExecutionError(`Could not set Claude App Code branch: ${selected?.reason || 'unknown error'}`);
    }
    await page.wait(0.5);
    const next = await getClaudeAppCodeDraftState(page);
    return { ok: true, changed: true, ...next };
}

export async function startClaudeAppNewCodeSession(page, options = {}) {
    await selectClaudeAppMode(page, 'code');
    await closeClaudeAppMenus(page);

    const clicked = await page.evaluate(`(() => {
        var buttons = Array.from(document.querySelectorAll('button'));
        var target = buttons.find(function(button) {
            var label = ((button.innerText || button.getAttribute('aria-label') || '')).trim();
            return label === 'New session' || label === 'New chat' || label.indexOf('New session') >= 0 || label.indexOf('New chat') >= 0;
        });
        if (!target) return { ok: false, reason: 'New session button not found' };
        target.click();
        return { ok: true };
    })()`);
    if (!clicked?.ok) {
        throw new CommandExecutionError(`Could not start a Claude App Code new session: ${clicked?.reason || 'unknown error'}`);
    }

    try {
        await page.wait({ selector: '[contenteditable="true"][aria-label="Prompt"]', timeout: 10 });
    } catch {
        // ensureClaudeAppPage and draft-state checks below produce the typed failure.
    }
    await ensureClaudeAppPage(page, 'Claude App Code new session requires a logged-in Claude session.');

    const folderSelector = String(options.folder || options.cwd || options.workspace || options.project || '').trim();
    if (folderSelector) {
        await selectClaudeAppCodeFolder(page, folderSelector);
    }
    if (options.branch) {
        await setClaudeAppCodeBranch(page, options.branch);
    }
    if (options.model) {
        await selectClaudeAppCodeModel(page, options.model);
    }
    if (options.effort) {
        await selectClaudeAppCodeEffort(page, options.effort);
    }

    const state = await getClaudeAppCodeDraftState(page);
    if (!state.HasPrompt) {
        throw new CommandExecutionError('Claude App Code new session composer was not visible after setup.');
    }
    return {
        ...state,
        Mode: 'Code',
        ModeKey: 'code',
        CodeSession: '',
        CodeSessionId: '',
        CodeCwd: state.FolderPath || folderSelector || state.Folder || '',
        Folder: state.Folder || '',
        FolderPath: state.FolderPath || '',
    };
}

export async function selectClaudeAppMode(page, mode = CLAUDE_APP_DEFAULT_MODE) {
    const wanted = normalizeClaudeAppMode(mode);
    const wantedLabel = CLAUDE_APP_MODE_LABELS[wanted];
    await ensureClaudeAppPage(page, 'Claude App mode selection requires a logged-in Claude session.');

    const clickResult = await page.evaluate(`(() => {
        function normalizeMode(value) {
            var text = String(value || '').trim().toLowerCase();
            if (text === 'co-work' || text === 'co_work' || text === 'co working') return 'cowork';
            if (text === 'coding') return 'code';
            if (['chat', 'cowork', 'code'].indexOf(text) >= 0) return text;
            return '';
        }
        var wanted = ${JSON.stringify(wanted)};
        var group = document.querySelector('[role="group"][aria-label="Mode"]');
        var buttons = Array.from(group ? group.querySelectorAll('button') : []);
        var target = buttons.find(function(button) {
            var label = button.getAttribute('aria-label') || button.innerText || '';
            return normalizeMode(label) === wanted;
        });
        if (!target) return { ok: false, reason: 'mode button not found' };
        var disabled = target.getAttribute('aria-disabled') === 'true' || target.getAttribute('data-disabled') === 'true' || !!target.disabled;
        if (disabled) return { ok: false, disabled: true, reason: 'mode disabled' };
        var alreadyActive = target.getAttribute('data-active') === 'true' || target.getAttribute('aria-current') === 'page';
        if (alreadyActive) return { ok: true, changed: false };
        target.click();
        return { ok: true, changed: true };
    })()`);

    if (!clickResult?.ok) {
        if (clickResult?.disabled) {
            throw new ArgumentError(
                `Claude App ${wantedLabel} mode is currently disabled.`,
                'Pick --mode chat or --mode code, or enable the mode manually in Claude App.',
            );
        }
        throw new CommandExecutionError(`Could not select Claude App ${wantedLabel} mode: ${clickResult?.reason || 'unknown error'}`);
    }

    for (let attempt = 0; attempt < 16; attempt++) {
        const current = await getClaudeAppMode(page);
        if (current.Mode === wanted) {
            return { ok: true, requested: wanted, changed: !!clickResult.changed, ...current };
        }
        await page.wait(0.25);
    }

    const current = await getClaudeAppMode(page);
    throw new CommandExecutionError(
        `Claude App did not switch to ${wantedLabel} mode.`,
        `Current mode: ${current.ModeLabel || current.Mode || '(unknown)'}`,
    );
}

export async function getClaudeAppStatus(page) {
    const url = await page.evaluate('window.location.href').catch(() => '');
    const title = await page.evaluate('document.title').catch(() => '');
    const project = await page.evaluate(`(() => {
        var match = window.location.pathname.match(/\\/projects?\\/([^/?#]+)/);
        if (!match) {
            var projectLink = document.querySelector('a[href*="/project/"]');
            var href = projectLink ? (projectLink.getAttribute('href') || '') : '';
            match = href.match(/\\/projects?\\/([^/?#]+)/);
            if (!match) match = href.match(/\\/project\\/([^/?#]+)/);
            var projectButton = document.querySelector('button[aria-label^="Project:"]');
            var buttonTitle = projectButton ? (projectButton.getAttribute('aria-label') || '').replace(/^Project:\\s*/, '').trim() : '';
            if (match) {
                var linkTitle = projectLink ? (projectLink.innerText || '').trim().split('\\n')[0].trim() : '';
                return { id: decodeURIComponent(match[1]), title: linkTitle || buttonTitle };
            }
            if (buttonTitle) return { id: '', title: buttonTitle };
            return null;
        }
        var heading = document.querySelector('h1, h2, [data-testid*="project"]');
        var title = heading ? (heading.innerText || '').trim().split('\\n')[0].trim() : '';
        return { id: decodeURIComponent(match[1]), title: title };
    })()`).catch(() => null);
    const mode = await getClaudeAppMode(page);
    let codeSession = null;
    if (mode.Mode === 'code') {
        const sessions = await getClaudeAppCodeSessionList(page).catch(() => []);
        codeSession = sessions.find((session) => session.Selected === 'Yes') || null;
    }
    let state = null;
    try {
        state = await getPageState(page);
    } catch {
        state = null;
    }
    return {
        Status: state?.hasComposer ? 'Connected' : 'Page not ready',
        Login: state?.isLoggedIn ? 'Yes' : 'No',
        HasComposer: state?.hasComposer ? 'Yes' : 'No',
        Url: state?.url || url,
        Title: title,
        Mode: mode.ModeLabel || mode.Mode || '',
        ModeKey: mode.Mode || '',
        Project: project?.title || '',
        ProjectId: project?.id || '',
        CodeSession: codeSession?.Title || codeSession?.Id || '',
        CodeSessionId: codeSession?.Id || '',
        CodeCwd: codeSession?.Cwd || codeSession?.OriginCwd || '',
    };
}

export function requireClaudeAppProjectSelector(value) {
    const selector = String(value ?? '').trim();
    if (!selector) {
        throw new ArgumentError(
            'claude-app project selector cannot be empty',
            'Example: opencli claude-app project "My Project"',
        );
    }
    return selector;
}

export async function getClaudeAppProjectList(page) {
    await page.goto(CLAUDE_APP_PROJECTS_URL);
    try {
        await page.wait({ selector: 'a[href*="/project"]', timeout: 8 });
    } catch {
        // Empty projects, login wall, or a changed Claude DOM. ensure/login and
        // the returned empty list below provide the typed failure.
    }
    await ensureClaudeAppPage(page, 'Claude App projects requires a logged-in Claude session.');
    const items = await page.evaluate(`(() => {
        var links = Array.from(document.querySelectorAll('a[href*="/project"]'));
        var seen = new Set();
        return links.map(function(link) {
            var href = link.getAttribute('href') || '';
            var match = href.match(/\\/projects?\\/([^/?#]+)/);
            if (!match) return null;
            var id = decodeURIComponent(match[1]);
            if (!id || id === 'new') return null;
            var url = href.startsWith('http') ? href : ('https://claude.ai' + href);
            if (seen.has(id)) return null;
            seen.add(id);
            var titleNode = link.querySelector('[data-testid*="project"], h1, h2, h3');
            var rawTitle = ((titleNode && titleNode.innerText) || link.innerText || '').trim();
            var title = rawTitle.split('\\n').map(function(line) {
                return line.trim();
            }).filter(Boolean)[0] || '(untitled)';
            return { Id: id, Title: title, Url: url };
        }).filter(Boolean).map(function(item, i) {
            return { Index: i + 1, Id: item.Id, Title: item.Title, Url: item.Url };
        });
    })()`);
    return Array.isArray(items) ? items : [];
}

export function findClaudeAppProject(projects, selector) {
    const wanted = requireClaudeAppProjectSelector(selector);
    const normalized = wanted.toLowerCase();
    const list = Array.isArray(projects) ? projects : [];
    if (list.length === 0) {
        throw new EmptyResultError('claude-app projects', 'No Claude App projects were visible on /projects.');
    }

    const exact = list.find((project) => {
        const id = String(project.Id || '').toLowerCase();
        const title = String(project.Title || '').toLowerCase();
        return id === normalized || title === normalized;
    });
    if (exact) return exact;

    const partial = list.filter((project) => String(project.Title || '').toLowerCase().includes(normalized));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
        const matches = partial.slice(0, 5).map((project) => `${project.Title} (${project.Id})`).join(', ');
        throw new ArgumentError(
            `Project selector matched multiple Claude App projects: ${wanted}`,
            `Use an exact project id or title. Matches: ${matches}`,
        );
    }

    throw new ArgumentError(
        `Claude App project not found: ${wanted}`,
        'Run opencli claude-app projects --format json, then retry with an exact project id or title.',
    );
}

export async function openClaudeAppProject(page, selector, options = {}) {
    const mode = normalizeClaudeAppMode(options.mode);
    if (mode === 'code') {
        return selectClaudeAppCodeSession(page, selector);
    }
    const projects = await getClaudeAppProjectList(page);
    const project = findClaudeAppProject(projects, selector);
    await page.goto(project.Url);
    try {
        await page.wait({ selector: COMPOSER_SELECTOR, timeout: 8 });
    } catch {
        // Some project pages lazy-load or use a changed composer selector. The
        // caller will enforce composer presence before send/ask.
    }
    await ensureClaudeAppPage(page, 'Claude App project requires a logged-in Claude session.');
    const modeResult = await selectClaudeAppMode(page, mode);
    return { ...project, Mode: modeResult.ModeLabel || modeResult.Mode || '', ModeKey: modeResult.Mode || mode };
}

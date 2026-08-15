import { beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { listConversations } from './_actions.js';
import './audit-extras.js';
import './delete.js';
import './history.js';
import './mark-read.js';
import './model.js';
import './models.js';
import './rename.js';
import './storage.js';

function makePage(evaluateResults = []) {
    const queue = [...evaluateResults];
    return {
        evaluate: vi.fn(async () => (queue.length ? queue.shift() : null)),
        wait: vi.fn(async () => {}),
    };
}

describe('antigravity command registration', () => {
    it('classifies commands by maximum side effect', () => {
        const expected = {
            history: 'read',
            delete: 'write',
            'mark-read': 'write',
            model: 'write',
            rename: 'write',
            'copy-message': 'write',
            'copy-code': 'read',
            'state-keys': 'read',
            'state-get': 'read',
            'recent-paths': 'read',
            'workspaces-list': 'read',
            'settings-read': 'read',
        };
        for (const [name, access] of Object.entries(expected)) {
            const command = getRegistry().get(`antigravity/${name}`);
            expect(command, `antigravity/${name}`).toBeDefined();
            expect(command.access).toBe(access);
        }
    });
});

describe('antigravity Browser Bridge envelopes', () => {
    it('unwraps conversation listings returned as { session, data }', async () => {
        const page = makePage([
            { session: { id: 's1' }, data: [{ index: 1, id: 'abc', title: 'Demo' }] },
        ]);

        await expect(listConversations(page)).resolves.toEqual([
            { index: 1, id: 'abc', title: 'Demo' },
        ]);
    });
});

describe('antigravity write postconditions', () => {
    let deleteCommand;
    let markReadCommand;
    let modelCommand;
    let storageKeysCommand;

    beforeAll(() => {
        deleteCommand = getRegistry().get('antigravity/delete');
        markReadCommand = getRegistry().get('antigravity/mark-read');
        modelCommand = getRegistry().get('antigravity/model');
        storageKeysCommand = getRegistry().get('antigravity/storage-keys');
    });

    it('delete fails closed when the conversation remains visible after confirmation', async () => {
        const page = makePage([
            { ok: true, clicked: 'Delete Conversation' },
            { ok: true, confirmed: 'Delete' },
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
        ]);

        await expect(deleteCommand.func(page, { id: 'abc', yes: true }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('mark-read refuses to toggle already-read rows back to unread', async () => {
        const page = makePage([
            { ok: true, labels: ['Mark as Unread', 'Rename', 'Delete Conversation'] },
        ]);

        await expect(markReadCommand.func(page, { id: 'abc' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('model reports a missing match with the available model list', async () => {
        const page = makePage([
            'https://127.0.0.1:9234/c/abc',
            'Antigravity',
            { currentModel: 'Gemini 3.5 Flash', messageCount: 2, messages: [] },
            {},
            { ok: true, changed: true, currentModel: 'Gemini 3.5 Flash' },
            { ok: false, reason: 'Model matching "qwen" was not found in the dropdown list.', availableModels: ['Gemini 3.5 Flash', 'Qwen 2.5'] },
            'https://127.0.0.1:9234/c/abc',
            'Antigravity',
            { currentModel: 'Gemini 3.5 Flash', messageCount: 2, messages: [] },
            {},
        ]);

        await expect(modelCommand.func(page, { name: 'qwen' }))
            .rejects.toThrow(/not found in the dropdown list.*Available: Gemini 3.5 Flash, Qwen 2\.5/);
    });

    it('model list mode never switches: the read-only models command reports options without clicking them', async () => {
        const modelsCommand = getRegistry().get('antigravity/models');
        expect(modelsCommand).toBeDefined();
        expect(modelsCommand.access).toBe('read');
        const page = makePage([
            { ok: true, currentModel: 'Gemini 3.5 Flash', availableModels: ['Gemini 3.5 Flash'] },
            { ok: true, currentModel: 'Gemini 3.5 Flash', availableModels: ['Gemini 3.5 Flash', 'Claude Sonnet'] },
        ]);

        await expect(modelsCommand.func(page, {})).resolves.toEqual({
            ok: true,
            currentModel: 'Gemini 3.5 Flash',
            availableModels: ['Gemini 3.5 Flash', 'Claude Sonnet'],
        });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('model switches when the dropdown select succeeds and read-back verifies the target', async () => {
        const page = makePage([
            'https://127.0.0.1:9234/c/abc',
            'Antigravity',
            { currentModel: 'Gemini 3.5 Flash', messageCount: 2, messages: [] },
            {},
            { ok: true, changed: true, currentModel: 'Gemini 3.5 Flash' },
            { ok: true, changed: true, selectedModel: 'Qwen 2.5', availableModels: ['Gemini 3.5 Flash', 'Qwen 2.5'] },
            'https://127.0.0.1:9234/c/abc',
            'Antigravity',
            { currentModel: 'Qwen 2.5', messageCount: 2, messages: [] },
            {},
        ]);

        const result = await modelCommand.func(page, { name: 'qwen' });
        expect(result.ok).toBe(true);
        expect(result.changed).toBe(true);
        expect(result.model).toBe('Qwen 2.5');
    });

    it('model fails closed when read-back does not prove the target is active', async () => {
        const page = makePage([
            'https://127.0.0.1:9234/c/abc',
            'Antigravity',
            { currentModel: 'Gemini 3.5 Flash', messageCount: 2, messages: [] },
            {},
            { ok: true, changed: true, currentModel: 'Gemini 3.5 Flash' },
            { ok: true, changed: true, selectedModel: 'Qwen 2.5', availableModels: ['Gemini 3.5 Flash', 'Qwen 2.5'] },
            'https://127.0.0.1:9234/c/abc',
            'Antigravity',
            { currentModel: 'Gemini 3.5 Flash', messageCount: 2, messages: [] },
            {},
        ]);

        await expect(modelCommand.func(page, { name: 'qwen' }))
            .rejects.toThrow(/not verified/i);
    });

    it('storage-keys unwraps Browser Bridge envelopes before shaping rows', async () => {
        const page = makePage([
            { session: { id: 's1' }, data: [{ k: 'alpha', bytes: 12 }] },
        ]);

        await expect(storageKeysCommand.func(page, { storage: 'local' })).resolves.toEqual([
            { Index: 1, Key: 'alpha', Bytes: 12 },
        ]);
    });

    it('copy-message click-button fails closed when the in-UI copy click fails', async () => {
        const copyMessageCommand = getRegistry().get('antigravity/copy-message');
        const page = makePage([
            { text: 'assistant response' },
            { ok: false, reason: 'No matching visible element.' },
        ]);

        await expect(copyMessageCommand.func(page, { 'click-button': true }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});

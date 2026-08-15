import { cli, Strategy } from '@jackwener/opencli/registry';
import { startNewCodexConversation } from './utils.js';

export const newCommand = cli({
    site: 'codex',
    name: 'new',
    access: 'write',
    description: 'Start a new Codex conversation and verify it becomes active',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', required: false, help: 'Optional project label or path to select before creating the conversation' },
    ],
    columns: ['ok', 'changed', 'reason'],
    func: async (page, kwargs) => startNewCodexConversation(page, kwargs),
});

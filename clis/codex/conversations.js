import { cli, Strategy } from '@jackwener/opencli/registry';
import { listCodexConversations } from './utils.js';

export const conversationsCommand = cli({
    site: 'codex',
    name: 'conversations',
    aliases: ['list'],
    access: 'read',
    description: 'List visible Codex sidebar projects and conversations as compact JSON',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', required: false, help: 'Maximum visible conversations to return per project' },
    ],
    columns: ['ok', 'project_count', 'conversation_count'],
    func: async (page, kwargs) => listCodexConversations(page, kwargs),
});

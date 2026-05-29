import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs } from './sidebar.js';
import { openCodexTarget } from './utils.js';

export const openCommand = cli({
    site: 'codex',
    name: 'open',
    access: 'write',
    description: 'Open a visible Codex project or conversation by project, title, index, or thread id',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'target', required: false, positional: true, help: 'Conversation title or thread id when no explicit selector is provided' },
        ...conversationSelectionArgs,
    ],
    columns: ['ok', 'selected', 'state'],
    func: async (page, kwargs) => openCodexTarget(page, kwargs),
});

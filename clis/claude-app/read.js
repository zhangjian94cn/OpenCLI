import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { getVisibleMessages } from '../claude/utils.js';
import { CLAUDE_APP_SITE, ensureClaudeAppPage } from './utils.js';

export const readCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'read',
    access: 'read',
    description: 'Read the current Claude desktop App conversation',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Index', 'Role', 'Text'],
    func: async (page) => {
        await ensureClaudeAppPage(page, 'Claude App read requires a logged-in Claude session.');
        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        throw new EmptyResultError('claude-app read', 'No visible Claude App messages were found in the current conversation.');
    },
});

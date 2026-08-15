import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    MESSAGE_SELECTOR,
    getVisibleMessages,
    requireConversationId,
} from '../claude/utils.js';
import { CLAUDE_APP_SITE, ensureClaudeAppPage } from './utils.js';

export const detailCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'detail',
    access: 'read',
    description: 'Open a Claude desktop App conversation by ID and read its messages',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'id', positional: true, required: true, help: 'Conversation ID (UUID from /chat/<id>)' },
    ],
    columns: ['Index', 'Role', 'Text'],
    func: async (page, kwargs) => {
        const id = requireConversationId(kwargs.id);
        await page.goto(`https://claude.ai/chat/${id}`);
        try {
            await page.wait({ selector: MESSAGE_SELECTOR, timeout: 10 });
        } catch {
            // Empty conversation, missing access, or login redirect is handled below.
        }
        await ensureClaudeAppPage(page, 'Claude App detail requires a logged-in Claude session.');
        const messages = await getVisibleMessages(page);
        if (messages.length > 0) return messages;
        throw new EmptyResultError('claude-app detail', `No visible Claude App messages were found for conversation ${id}.`);
    },
});

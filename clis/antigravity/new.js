import { cli, Strategy } from '@jackwener/opencli/registry';
import { startNewAntigravityConversation } from './utils.js';

export const newCommand = cli({
    site: 'antigravity',
    name: 'new',
    access: 'write',
    description: 'Start a new conversation / clear context in Antigravity and verify the resulting state',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['ok', 'changed', 'reason'],
    func: async (page) => {
        const result = await startNewAntigravityConversation(page);
        if (!result?.ok) {
            throw new Error(result?.reason || 'Could not find New Conversation button');
        }
        return result;
    },
});

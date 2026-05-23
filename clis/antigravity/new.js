import { cli, Strategy } from '@jackwener/opencli/registry';
import { startNewAntigravityConversation } from './utils.js';

export const newCommand = cli({
    site: 'antigravity',
    name: 'new',
    access: 'read',
    description: 'Start a new conversation / clear context in Antigravity',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['status'],
    func: async (page) => {
        const result = await startNewAntigravityConversation(page);
        if (!result?.ok) {
            throw new Error(result?.reason || 'Could not find New Conversation button');
        }
        // Give it a moment to reset the UI
        await page.wait(0.5);
        return [{ status: 'Successfully started a new conversation' }];
    },
});

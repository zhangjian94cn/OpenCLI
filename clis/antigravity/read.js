import { cli, Strategy } from '@jackwener/opencli/registry';
import { getAntigravityConversationSnapshot } from './utils.js';

export const readCommand = cli({
    site: 'antigravity',
    name: 'read',
    access: 'read',
    description: 'Read the latest chat messages from Antigravity AI',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'last', help: 'Number of recent messages to read from the current Antigravity conversation' }
    ],
    columns: ['role', 'content'],
    func: async (page, kwargs) => {
        const parsedLast = Number.parseInt(String(kwargs.last || '0'), 10);
        const last = Number.isFinite(parsedLast) && parsedLast > 0 ? parsedLast : 0;
        const snapshot = await getAntigravityConversationSnapshot(page, { last });
        if (snapshot.messages.length > 0) {
            return snapshot.messages.map((message) => ({
                role: message.role,
                content: message.content,
            }));
        }
        if (snapshot.conversationText) {
            return [{
                    role: 'history',
                    content: snapshot.conversationText
                }];
        }
        return [];
    },
});

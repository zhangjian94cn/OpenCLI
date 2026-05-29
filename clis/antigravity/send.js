import { cli, Strategy } from '@jackwener/opencli/registry';
import { getAntigravityPageState, sendAntigravityMessage } from './utils.js';

export const sendCommand = cli({
    site: 'antigravity',
    name: 'send',
    access: 'write',
    description: 'Send a message to Antigravity AI via the internal Lexical editor',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'message', help: 'The message text to send', required: true, positional: true }
    ],
    columns: ['ok', 'action', 'send_method', 'message_count'],
    func: async (page, kwargs) => {
        const text = kwargs.message;
        const stateBefore = await getAntigravityPageState(page, { last: 1 }).catch(() => null);
        const method = await sendAntigravityMessage(page, text);
        const stateAfter = await getAntigravityPageState(page, { last: 5 }).catch(() => null);
        return {
            ok: true,
            action: 'send',
            send_method: method,
            message: text,
            message_count: stateAfter?.message_count || 0,
            state_before: stateBefore,
            state_after: stateAfter,
        };
    },
});

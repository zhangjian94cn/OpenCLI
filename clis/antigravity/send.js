import { cli, Strategy } from '@jackwener/opencli/registry';
import { sendAntigravityMessage } from './utils.js';

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
    columns: ['Status', 'Message'],
    func: async (page, kwargs) => {
        const text = kwargs.message;
        await sendAntigravityMessage(page, text);
        return [{ Status: 'Sent successfully', Message: text }];
    },
});

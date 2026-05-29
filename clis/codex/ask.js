import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { conversationSelectionArgs } from './sidebar.js';
import { askCodex } from './utils.js';
export const askCommand = cli({
    site: 'codex',
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to the current or selected Codex conversation and wait for the AI response',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'message', required: true, positional: true, help: 'Prompt to send' },
        { name: 'model', valueRequired: true, help: 'Optional target model before sending' },
        { name: 'new-conversation', type: 'boolean', default: false, help: 'Start a new conversation before sending' },
        { name: 'wait', type: 'boolean', default: false, help: 'Wait for the reply before returning' },
        { name: 'timeout', type: 'int', required: false, help: 'Max seconds to wait for response (default: 60)', default: 60 },
        { name: 'read-last', type: 'int', default: 5, help: 'Number of recent messages to return when waiting' },
        ...conversationSelectionArgs,
    ],
    columns: ['ok', 'action', 'reply', 'error'],
    func: async (page, kwargs) => {
        const timeout = kwargs.timeout;
        if (!Number.isInteger(timeout) || timeout < 1) {
            throw new ArgumentError('--timeout must be a positive integer (seconds)');
        }
        return askCodex(page, kwargs);
    },
});

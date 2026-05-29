import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs, openCodexConversation } from './sidebar.js';
import { sendCodexMessage } from './utils.js';
export const sendCommand = cli({
    site: 'codex',
    name: 'send',
    access: 'write',
    description: 'Send text/commands to the current or selected Codex AI composer',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', required: true, positional: true, help: 'Text, command (e.g. /review), or skill (e.g. $imagegen)' },
        ...conversationSelectionArgs,
    ],
    columns: ['Status', 'Project', 'Conversation', 'Method', 'InjectedText'],
    func: async (page, kwargs) => {
        const textToInsert = kwargs.text;
        const selected = await openCodexConversation(page, kwargs);
        const method = await sendCodexMessage(page, textToInsert);
        return [
            {
                Status: 'Success',
                Project: selected?.project || '',
                Conversation: selected?.conversation || '',
                Method: method,
                InjectedText: textToInsert,
            },
        ];
    },
});

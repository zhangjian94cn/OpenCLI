import { cli, Strategy } from '@jackwener/opencli/registry';
import { conversationSelectionArgs, openCodexConversation } from './sidebar.js';
import { getCodexPageState } from './utils.js';

export const readCommand = cli({
    site: 'codex',
    name: 'read',
    access: 'read',
    description: 'Read the contents of the current or selected Codex conversation thread',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'last', type: 'int', default: 5, help: 'Number of recent messages to include' },
        ...conversationSelectionArgs,
    ],
    columns: ['ok', 'project', 'conversation', 'message_count'],
    func: async (page, kwargs) => {
        const selected = await openCodexConversation(page, kwargs);
        const state = await getCodexPageState(page, { last: kwargs.last });
        const messages = Array.isArray(state.messages) ? state.messages : [];
        return {
            ok: true,
            project: selected?.project || state.project || '',
            project_path: selected?.projectPath || state.project_path || '',
            conversation: selected?.conversation || state.conversation || '',
            thread_id: selected?.threadId || state.thread_id || '',
            conversation_id: state.conversation_id || '',
            message_count: state.message_count || 0,
            messages,
            content: messages.map((message) => message.content).filter(Boolean).join('\n\n---\n\n'),
        };
    },
});

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ensureClaudeLogin,
    getConversationList,
    requirePositiveInt,
} from '../claude/utils.js';
import {
    CLAUDE_APP_SITE,
    getClaudeAppCodeSessionList,
    normalizeClaudeAppMode,
    selectClaudeAppMode,
} from './utils.js';

export const historyCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'history',
    access: 'read',
    description: 'List conversation history from the Claude desktop App',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max conversations to show' },
        { name: 'mode', default: 'code', choices: ['chat', 'cowork', 'code'], help: 'Claude App mode to list (default: code)' },
    ],
    columns: ['Index', 'Mode', 'Id', 'Title', 'Cwd', 'Url'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 20),
            'claude-app history --limit',
            'Example: opencli claude-app history --limit 20',
        );
        const mode = normalizeClaudeAppMode(kwargs.mode);
        const modeResult = await selectClaudeAppMode(page, mode);
        if (mode === 'code') {
            const sessions = await getClaudeAppCodeSessionList(page);
            await ensureClaudeLogin(page, 'Claude App history requires a logged-in Claude session.');
            if (sessions.length === 0) {
                throw new EmptyResultError('claude-app code history', 'No Claude App Code sessions were found locally or in the sidebar.');
            }
            return sessions.slice(0, limit).map((session) => ({
                ...session,
                Mode: modeResult?.ModeLabel || modeResult?.Mode || mode,
                Cwd: session.Cwd || session.OriginCwd || '',
            }));
        }
        const conversations = await getConversationList(page);
        await ensureClaudeLogin(page, 'Claude App history requires a logged-in Claude session.');
        if (conversations.length === 0) {
            throw new EmptyResultError('claude-app history', 'No Claude App conversation history was visible on /recents.');
        }
        return conversations.slice(0, limit).map((conversation) => ({
            ...conversation,
            Mode: modeResult?.ModeLabel || modeResult?.Mode || mode,
        }));
    },
});

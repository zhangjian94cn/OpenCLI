import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLAUDE_APP_LABEL, CLAUDE_APP_SITE, getClaudeAppStatus } from './utils.js';

export const statusCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'status',
    access: 'read',
    description: 'Check CDP connection to the Claude desktop App',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['Status', 'Login', 'HasComposer', 'Mode', 'Project', 'ProjectId', 'CodeSession', 'CodeSessionId', 'CodeCwd', 'Url', 'Title'],
    func: async (page) => {
        return [{ App: CLAUDE_APP_LABEL, ...(await getClaudeAppStatus(page)) }];
    },
});

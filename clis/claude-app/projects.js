import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { requirePositiveInt } from '../claude/utils.js';
import { CLAUDE_APP_SITE, getClaudeAppProjectList } from './utils.js';

export const projectsCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'projects',
    access: 'read',
    description: 'List Claude desktop App projects',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max projects to show' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 20),
            'claude-app projects --limit',
            'Example: opencli claude-app projects --limit 20',
        );
        const projects = await getClaudeAppProjectList(page);
        if (projects.length === 0) {
            throw new EmptyResultError('claude-app projects', 'No Claude App projects were visible on /projects.');
        }
        return projects.slice(0, limit);
    },
});

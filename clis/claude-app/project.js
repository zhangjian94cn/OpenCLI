import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLAUDE_APP_SITE, normalizeClaudeAppMode, openClaudeAppProject } from './utils.js';

export const projectCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'project',
    access: 'write',
    description: 'Open a Claude desktop App project by id or title',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', positional: true, required: true, help: 'Project id or title' },
        { name: 'mode', default: 'code', choices: ['chat', 'cowork', 'code'], help: 'Claude App mode to use (default: code)' },
    ],
    columns: ['Status', 'Mode', 'Id', 'Title', 'Cwd', 'CodeSessionId', 'Url'],
    func: async (page, kwargs) => {
        const mode = normalizeClaudeAppMode(kwargs.mode);
        const project = await openClaudeAppProject(page, kwargs.project, { mode });
        return [{
            Status: 'Project opened',
            Mode: project.Mode || project.ModeKey || mode,
            Id: project.Id,
            Title: project.Title,
            Cwd: project.Cwd || project.OriginCwd || '',
            CodeSessionId: project.CodeSessionId || '',
            Url: project.Url,
        }];
    },
});

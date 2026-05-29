import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLAUDE_URL } from '../claude/utils.js';
import {
    CLAUDE_APP_SITE,
    ensureClaudeAppComposer,
    normalizeClaudeAppMode,
    openClaudeAppProject,
    selectClaudeAppMode,
    startClaudeAppNewCodeSession,
    waitForClaudeAppComposer,
} from './utils.js';

export const newCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'new',
    access: 'write',
    description: 'Start a new conversation in the Claude desktop App',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'project', help: 'Open this Claude project before starting the chat; in Code mode this is also accepted as a folder selector' },
        { name: 'folder', help: 'Local folder path/name for a new Claude App Code session' },
        { name: 'cwd', help: 'Alias for --folder when starting a new Claude App Code session' },
        { name: 'workspace', help: 'Alias for --folder when starting a new Claude App Code session' },
        { name: 'branch', help: 'Branch/worktree label for a new Claude App Code session' },
        { name: 'model', choices: ['sonnet', 'opus', 'haiku'], help: 'Claude App Code model to select for the new session' },
        { name: 'effort', choices: ['low', 'medium', 'high', 'extra_high', 'xhigh', 'max'], help: 'Claude App Code effort to select for the new session' },
        { name: 'mode', default: 'code', choices: ['chat', 'cowork', 'code'], help: 'Claude App mode to use (default: code)' },
    ],
    columns: ['Status', 'Mode', 'Project', 'ProjectId', 'Folder', 'FolderPath', 'Model', 'Effort', 'Branch', 'CodeSession', 'CodeSessionId', 'CodeCwd', 'Url'],
    func: async (page, kwargs) => {
        const mode = normalizeClaudeAppMode(kwargs.mode);
        let project = null;
        let modeResult = null;
        if (mode === 'code') {
            project = await startClaudeAppNewCodeSession(page, {
                folder: kwargs.folder || kwargs.cwd || kwargs.workspace || kwargs.project,
                branch: kwargs.branch,
                model: kwargs.model,
                effort: kwargs.effort,
            });
            modeResult = { Mode: project.ModeKey || mode, ModeLabel: project.Mode || '' };
        } else if (kwargs.project) {
            project = await openClaudeAppProject(page, kwargs.project, { mode });
            modeResult = { Mode: project.ModeKey || mode, ModeLabel: project.Mode || '' };
        } else {
            await page.goto(CLAUDE_URL);
            await waitForClaudeAppComposer(page);
        }
        if (!modeResult) {
            modeResult = await selectClaudeAppMode(page, mode);
        }
        await ensureClaudeAppComposer(page, 'Claude App new requires a logged-in Claude session with a visible composer.');
        const url = await page.evaluate('window.location.href').catch(() => '');
        return [{
            Status: mode === 'code' ? 'New Code session draft started' : 'New chat started',
            Mode: modeResult?.ModeLabel || modeResult?.Mode || mode,
            Project: project?.Title || '',
            ProjectId: project?.Id || '',
            Folder: project?.Folder || '',
            FolderPath: project?.FolderPath || '',
            Model: project?.Model || '',
            Effort: project?.Effort || '',
            Branch: project?.Branch || '',
            CodeSession: project?.CodeSession || '',
            CodeSessionId: project?.CodeSessionId || '',
            CodeCwd: project?.CodeCwd || '',
            Url: url,
        }];
    },
});

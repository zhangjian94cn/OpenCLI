import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    CLAUDE_URL,
    parseBoolFlag,
    requireNonEmptyPrompt,
    sendMessage,
    withRetry,
} from '../claude/utils.js';
import {
    CLAUDE_APP_SITE,
    ensureClaudeAppComposer,
    getClaudeAppStatus,
    normalizeClaudeAppMode,
    openClaudeAppProject,
    selectClaudeAppCodeSession,
    selectClaudeAppMode,
    startClaudeAppNewCodeSession,
    waitForClaudeAppComposer,
} from './utils.js';

export const sendCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'send',
    access: 'write',
    description: 'Send a prompt to the Claude desktop App without waiting for the response',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'conversation', help: 'Open this conversation/session id before sending' },
        { name: 'project', help: 'Open this Claude project before sending; with --new --mode code this is also accepted as a folder selector' },
        { name: 'folder', help: 'Local folder path/name for a new Claude App Code session' },
        { name: 'cwd', help: 'Alias for --folder when starting a new Claude App Code session' },
        { name: 'workspace', help: 'Alias for --folder when starting a new Claude App Code session' },
        { name: 'branch', help: 'Branch/worktree label for a new Claude App Code session' },
        { name: 'model', choices: ['sonnet', 'opus', 'haiku'], help: 'Claude App Code model to select for a new Code session' },
        { name: 'effort', choices: ['low', 'medium', 'high', 'extra_high', 'xhigh', 'max'], help: 'Claude App Code effort to select for a new Code session' },
        { name: 'mode', default: 'code', choices: ['chat', 'cowork', 'code'], help: 'Claude App mode to use (default: code)' },
    ],
    columns: ['Status', 'SubmittedBy', 'Mode', 'Project', 'ProjectId', 'Folder', 'FolderPath', 'Model', 'Effort', 'Branch', 'CodeSession', 'CodeSessionId', 'CodeCwd', 'InjectedText'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'claude-app send');
        const mode = normalizeClaudeAppMode(kwargs.mode);
        let project = null;
        let modeResult = null;
        if (kwargs.conversation && mode === 'code') {
            project = await selectClaudeAppCodeSession(page, kwargs.conversation);
            modeResult = { Mode: project.ModeKey || mode, ModeLabel: project.Mode || '' };
        } else if (kwargs.conversation) {
            await page.goto(`https://claude.ai/chat/${kwargs.conversation}`);
            await waitForClaudeAppComposer(page);
        } else if (parseBoolFlag(kwargs.new) && mode === 'code') {
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
        } else if (parseBoolFlag(kwargs.new)) {
            await page.goto(CLAUDE_URL);
            await waitForClaudeAppComposer(page);
        }
        if (!modeResult) {
            modeResult = await selectClaudeAppMode(page, mode);
        }
        await withRetry(() => ensureClaudeAppComposer(page, 'Claude App send requires a visible composer on the current page.'));
        const sendResult = await withRetry(() => sendMessage(page, prompt));
        if (!sendResult?.ok) {
            throw new CommandExecutionError(sendResult?.reason || 'Failed to send message to Claude App');
        }
        if ((modeResult?.Mode || mode) === 'code') {
            const status = await getClaudeAppStatus(page).catch(() => null);
            if (status && project) {
                project.CodeSession = status.CodeSession || project.CodeSession || '';
                project.CodeSessionId = status.CodeSessionId || project.CodeSessionId || '';
                project.CodeCwd = status.CodeCwd || project.CodeCwd || '';
            }
        }
        return [{
            Status: 'Success',
            SubmittedBy: sendResult.method || 'send-button',
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
            InjectedText: prompt,
        }];
    },
});

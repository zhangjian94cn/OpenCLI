import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    CLAUDE_URL,
    getBubbleCount,
    parseBoolFlag,
    requireNonEmptyPrompt,
    requirePositiveInt,
    selectModel,
    sendMessage,
    sendWithFile,
    setAdaptiveThinking,
    waitForResponse,
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

export const askCommand = cli({
    site: CLAUDE_APP_SITE,
    name: 'ask',
    access: 'write',
    description: 'Send a prompt to the Claude desktop App and get the response',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'prompt', positional: true, required: true, help: 'Prompt to send' },
        { name: 'timeout', type: 'int', default: 120, help: 'Max seconds to wait for response' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending' },
        { name: 'model', default: 'sonnet', choices: ['sonnet', 'opus', 'haiku'], help: 'Model to use: sonnet, opus, or haiku' },
        { name: 'think', type: 'boolean', default: false, help: 'Enable Adaptive thinking' },
        { name: 'file', help: 'Attach a file (image, PDF, text) with the prompt' },
        { name: 'conversation', help: 'Open this conversation/session id before asking' },
        { name: 'project', help: 'Open this Claude project before sending; with --new --mode code this is also accepted as a folder selector' },
        { name: 'folder', help: 'Local folder path/name for a new Claude App Code session' },
        { name: 'cwd', help: 'Alias for --folder when starting a new Claude App Code session' },
        { name: 'workspace', help: 'Alias for --folder when starting a new Claude App Code session' },
        { name: 'branch', help: 'Branch/worktree label for a new Claude App Code session' },
        { name: 'effort', choices: ['low', 'medium', 'high', 'extra_high', 'xhigh', 'max'], help: 'Claude App Code effort to select for a new Code session' },
        { name: 'mode', default: 'code', choices: ['chat', 'cowork', 'code'], help: 'Claude App mode to use (default: code)' },
    ],
    columns: ['response', 'Mode', 'Project', 'ProjectId', 'Folder', 'FolderPath', 'Model', 'Effort', 'Branch', 'CodeSession', 'CodeSessionId', 'CodeCwd'],
    func: async (page, kwargs) => {
        const prompt = requireNonEmptyPrompt(kwargs.prompt, 'claude-app ask');
        const timeoutSeconds = requirePositiveInt(
            Number(kwargs.timeout ?? 120),
            'claude-app ask --timeout',
            'Example: opencli claude-app ask "hello" --timeout 120',
        );
        const timeoutMs = timeoutSeconds * 1000;
        const wantThink = parseBoolFlag(kwargs.think);
        const mode = normalizeClaudeAppMode(kwargs.mode);
        const modelExplicit = kwargs.__opencliOptionSources?.model === 'cli';

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
                model: modelExplicit ? kwargs.model : undefined,
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
        await withRetry(() => ensureClaudeAppComposer(page, 'Claude App ask requires a visible composer on the current page.'));

        const currentUrl = await page.evaluate('window.location.href') || '';
        const inConversation = currentUrl.includes('/chat/');
        const isCodeMode = (modeResult?.Mode || mode) === 'code';
        const wantModel = kwargs.model || 'sonnet';
        if (inConversation && modelExplicit) {
            throw new ArgumentError(
                `Cannot switch to ${wantModel} model inside an existing Claude App conversation.`,
                'Re-run with --new to start a fresh chat before selecting a model.',
            );
        }

        if (!inConversation && !isCodeMode) {
            const modelResult = await withRetry(() => selectModel(page, wantModel));
            if (!modelResult?.ok) {
                if (modelResult?.upgrade) {
                    throw new ArgumentError(
                        `${wantModel} model requires a paid Claude plan.`,
                        'Pick --model sonnet or --model haiku, or upgrade your account.',
                    );
                }
                throw new CommandExecutionError(`Could not switch Claude App to ${wantModel} model`);
            }
        }

        if (!isCodeMode) {
            const thinkResult = await withRetry(() => setAdaptiveThinking(page, wantThink));
            if (!thinkResult?.ok && wantThink) {
                throw new CommandExecutionError('Could not enable Adaptive thinking in Claude App');
            }
        } else if (wantThink) {
            throw new ArgumentError(
                'Claude App Code mode does not use the Chat Adaptive thinking toggle.',
                'Use --mode chat for Adaptive thinking, or leave --think false in Code mode.',
            );
        }

        const baseline = await withRetry(() => getBubbleCount(page));
        if (kwargs.file) {
            const fileResult = await sendWithFile(page, kwargs.file, prompt);
            if (fileResult && !fileResult.ok) {
                throw new CommandExecutionError(fileResult.reason || 'Failed to attach file in Claude App');
            }
        } else {
            const sendResult = await withRetry(() => sendMessage(page, prompt));
            if (!sendResult?.ok) {
                throw new CommandExecutionError(sendResult?.reason || 'Failed to send message to Claude App');
            }
        }

        const result = await waitForResponse(page, baseline, prompt, timeoutMs);
        if (!result) {
            throw new EmptyResultError(
                'claude-app ask',
                `No Claude App response appeared within ${timeoutSeconds}s. Re-run with a higher --timeout if the model is still generating.`,
            );
        }
        if (isCodeMode) {
            const status = await getClaudeAppStatus(page).catch(() => null);
            if (status && project) {
                project.CodeSession = status.CodeSession || project.CodeSession || '';
                project.CodeSessionId = status.CodeSessionId || project.CodeSessionId || '';
                project.CodeCwd = status.CodeCwd || project.CodeCwd || '';
            }
        }
        return [{
            response: result,
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
        }];
    },
});

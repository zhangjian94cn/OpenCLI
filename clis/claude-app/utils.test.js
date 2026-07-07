import { describe, expect, it } from 'vitest';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    findClaudeAppProject,
    findClaudeAppCodeSession,
    isClaudeAppUrl,
    CLAUDE_APP_CODE_MODEL_FALLBACK_LABELS,
    normalizeClaudeAppCodeEffort,
    normalizeClaudeAppCodeModel,
    normalizeClaudeAppMode,
    requireClaudeAppProjectSelector,
} from './utils.js';

describe('claude-app project helpers', () => {
    const projects = [
        { Index: 1, Id: 'proj-alpha', Title: 'Alpha Project', Url: 'https://claude.ai/project/proj-alpha' },
        { Index: 2, Id: 'proj-beta', Title: 'Beta Project', Url: 'https://claude.ai/project/proj-beta' },
    ];

    it('rejects blank project selectors', () => {
        expect(() => requireClaudeAppProjectSelector('   ')).toThrow(ArgumentError);
    });

    it('matches projects by exact id', () => {
        expect(findClaudeAppProject(projects, 'proj-beta')).toEqual(projects[1]);
    });

    it('matches projects by title substring when unique', () => {
        expect(findClaudeAppProject(projects, 'alpha')).toEqual(projects[0]);
    });

    it('rejects missing projects with actionable guidance', () => {
        expect(() => findClaudeAppProject(projects, 'gamma')).toThrow(ArgumentError);
    });

    it('throws EmptyResultError when no projects are visible', () => {
        expect(() => findClaudeAppProject([], 'alpha')).toThrow(EmptyResultError);
    });
});

describe('claude-app mode helpers', () => {
    it('recognizes Claude web and desktop app URLs', () => {
        expect(isClaudeAppUrl('https://claude.ai/new')).toBe(true);
        expect(isClaudeAppUrl('https://api.claude.ai/debug')).toBe(true);
        expect(isClaudeAppUrl('app://localhost/task/new')).toBe(true);
        expect(isClaudeAppUrl('app://localhost/epitaxy')).toBe(true);
        expect(isClaudeAppUrl('http://localhost:9242/json')).toBe(false);
        expect(isClaudeAppUrl('https://example.com')).toBe(false);
    });

    it('defaults Claude App operations to code mode', () => {
        expect(normalizeClaudeAppMode(undefined)).toBe('code');
        expect(normalizeClaudeAppMode('')).toBe('code');
    });

    it('accepts explicit chat/cowork/code modes', () => {
        expect(normalizeClaudeAppMode('chat')).toBe('chat');
        expect(normalizeClaudeAppMode('cowork')).toBe('cowork');
        expect(normalizeClaudeAppMode('co-work')).toBe('cowork');
        expect(normalizeClaudeAppMode('coding')).toBe('code');
    });

    it('rejects unsupported modes with actionable guidance', () => {
        expect(() => normalizeClaudeAppMode('agent')).toThrow(ArgumentError);
    });
});

describe('claude-app code new-session helpers', () => {
    it('normalizes Code mode model aliases to visible menu labels', () => {
        expect(normalizeClaudeAppCodeModel('haiku')).toBe('Haiku 4.5');
        expect(normalizeClaudeAppCodeModel('Claude Haiku 4.5')).toBe('Haiku 4.5');
        expect(normalizeClaudeAppCodeModel('opus')).toBe('Opus 4.7');
        expect(normalizeClaudeAppCodeModel('sonnet')).toBe('Sonnet 4.6');
    });

    it('keeps local Code mode model fallbacks for CC Switch menus', () => {
        expect(CLAUDE_APP_CODE_MODEL_FALLBACK_LABELS['Haiku 4.5']).toContain('deepseek-v4-flash');
        expect(CLAUDE_APP_CODE_MODEL_FALLBACK_LABELS['Sonnet 4.6']).toContain('deepseek-v4-pro');
    });

    it('normalizes Code mode effort aliases to visible menu labels', () => {
        expect(normalizeClaudeAppCodeEffort('high')).toBe('High');
        expect(normalizeClaudeAppCodeEffort('xhigh')).toBe('Extra high');
        expect(normalizeClaudeAppCodeEffort('extra-high')).toBe('Extra high');
        expect(normalizeClaudeAppCodeEffort('max')).toBe('Max');
    });

    it('rejects unsupported Code mode model and effort values', () => {
        expect(() => normalizeClaudeAppCodeModel('gpt')).toThrow(ArgumentError);
        expect(() => normalizeClaudeAppCodeEffort('turbo')).toThrow(ArgumentError);
    });
});

describe('claude-app code session helpers', () => {
    const sessions = [
        {
            Id: 'local-old',
            Title: 'Old task',
            Cwd: '/Users/zjah/Documents/code/zhangjian-skills',
            OriginCwd: '/Users/zjah/Documents/code/zhangjian-skills',
            LastFocusedAt: 10,
        },
        {
            Id: 'local-new',
            Title: 'New task',
            Cwd: '/Users/zjah/Documents/code/zhangjian-skills',
            OriginCwd: '/Users/zjah/Documents/code/zhangjian-skills',
            LastFocusedAt: 20,
        },
        {
            Id: 'local-other',
            Title: 'Other task',
            Cwd: '/tmp/other-project',
            OriginCwd: '/tmp/other-project',
            LastFocusedAt: 30,
        },
    ];

    it('matches a Code session by exact session id', () => {
        expect(findClaudeAppCodeSession(sessions, 'local-old').Id).toBe('local-old');
    });

    it('uses the latest Code session when matching by cwd basename', () => {
        expect(findClaudeAppCodeSession(sessions, 'zhangjian-skills').Id).toBe('local-new');
    });

    it('rejects missing Code sessions with guidance', () => {
        expect(() => findClaudeAppCodeSession(sessions, 'missing-project')).toThrow(ArgumentError);
    });
});

import { cli, Strategy } from '@jackwener/opencli/registry';
import { getCodexPageState } from './utils.js';

export const stateCommand = cli({
    site: 'codex',
    name: 'state',
    access: 'read',
    description: 'Read compact Codex page, project, conversation, model, composer, and generation state',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'last', type: 'int', default: 5, help: 'Number of recent messages to include' },
    ],
    columns: ['ok', 'project', 'conversation', 'model', 'reasoning_effort', 'is_generating', 'message_count'],
    func: async (page, kwargs) => getCodexPageState(page, { last: kwargs.last }),
});

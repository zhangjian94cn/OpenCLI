import { cli, Strategy } from '@jackwener/opencli/registry';
import { listCodexModels } from './utils.js';

export const modelsCommand = cli({
    site: 'codex',
    name: 'models',
    access: 'read',
    description: 'List visible Codex model options and the current model',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['ok', 'currentModel', 'availableModels'],
    func: async (page) => listCodexModels(page),
});

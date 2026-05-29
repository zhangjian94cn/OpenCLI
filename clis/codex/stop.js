import { cli, Strategy } from '@jackwener/opencli/registry';
import { stopCodexGeneration } from './utils.js';

export const stopCommand = cli({
    site: 'codex',
    name: 'stop',
    access: 'write',
    description: 'Stop the current Codex generation if a stop button is visible',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [],
    columns: ['ok', 'stopped', 'error'],
    func: async (page) => stopCodexGeneration(page),
});

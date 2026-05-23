import { cli, Strategy } from '@jackwener/opencli/registry';
import { setAntigravityModel } from './utils.js';

export const modelCommand = cli({
    site: 'antigravity',
    name: 'model',
    access: 'read',
    description: 'Switch the active LLM model in Antigravity',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'name', help: 'Target model name (e.g. claude, gemini, o1)', required: true, positional: true }
    ],
    columns: ['Status'],
    func: async (page, kwargs) => {
        const result = await setAntigravityModel(page, kwargs.name.toLowerCase());
        if (!result?.ok) {
            const available = Array.isArray(result?.availableModels) && result.availableModels.length > 0
                ? ` Available: ${result.availableModels.join(', ')}`
                : '';
            throw new Error(`${result?.reason || 'Unable to switch model.'}${available}`);
        }
        await page.wait(0.5);
        return [{ Status: `Model switched to: ${kwargs.name}` }];
    },
});

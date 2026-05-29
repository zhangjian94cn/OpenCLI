import { cli, Strategy } from '@jackwener/opencli/registry';
import { listCodexModels, setCodexModel } from './utils.js';
export const modelCommand = cli({
    site: 'codex',
    name: 'model',
    access: 'read',
    description: 'Get or switch the currently active AI model in Codex Desktop',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'model-name', required: false, positional: true, help: 'The ID of the model to switch to (e.g. gpt-4)' }
    ],
    columns: ['ok', 'status', 'currentModel', 'availableModels', 'reason'],
    func: async (page, kwargs) => {
        const desiredModel = kwargs['model-name'];
        if (!desiredModel) {
            const result = await listCodexModels(page);
            return {
                ok: result.ok,
                status: result.ok ? 'Active' : 'Unknown',
                currentModel: result.currentModel,
                availableModels: result.availableModels,
                rawOptions: result.rawOptions,
                ...(result.reason ? { error: result.reason } : {}),
            };
        }
        return setCodexModel(page, desiredModel);
    },
});

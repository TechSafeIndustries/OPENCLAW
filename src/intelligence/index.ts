/**
 * Intelligence Module — Model Router
 *
 * Selects the active AI provider based on environment config.
 * Supports runtime switching via the ACTIVE_AI_PROVIDER env var.
 *
 * Supported values for ACTIVE_AI_PROVIDER:
 *   - "gemini"  (default)
 *   - "kimi"    (Moonshot AI / Kimi K series)
 *
 * You can also call getProvider() with an explicit name to bypass the env var.
 */

import { GeminiProvider } from './gemini.provider';
import { KimiProvider } from './kimi.provider';
import type { AIProvider } from './types';

export type ProviderName = 'gemini' | 'kimi';

const providerCache = new Map<ProviderName, AIProvider>();

/**
 * Returns (and caches) an AIProvider instance by name.
 * Falls back to the ACTIVE_AI_PROVIDER env var, then to 'gemini'.
 */
export function getProvider(name?: ProviderName): AIProvider {
    const resolved: ProviderName =
        name ??
        (process.env['ACTIVE_AI_PROVIDER'] as ProviderName | undefined) ??
        'gemini';

    if (providerCache.has(resolved)) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return providerCache.get(resolved)!;
    }

    let provider: AIProvider;

    switch (resolved) {
        case 'kimi':
            provider = new KimiProvider();
            break;
        case 'gemini':
        default:
            provider = new GeminiProvider();
            break;
    }

    providerCache.set(resolved, provider);
    console.log(`🧠 AI Provider initialised: ${provider.name} (${provider.model})`);
    return provider;
}

/**
 * Run health checks on all configured providers and log results.
 */
export async function checkAllProviders(): Promise<void> {
const providers: ProviderName[] = [
...(process.env['GEMINI_API_KEY'] ? (['gemini'] as ProviderName[]) : []),
...(process.env['MOONSHOT_API_KEY'] ? (['kimi'] as ProviderName[]) : []),
];

    const results = await Promise.allSettled(
        providers.map(async (name) => {
            try {
                const provider = getProvider(name);
                const ok = await provider.healthCheck();
                return { name, ok };
            } catch (err) {
                return { name, ok: false };
            }
        }),
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            const status = result.value.ok ? '✅' : '❌';
            console.log(`${status} Provider [${result.value.name}] health check: ${result.value.ok ? 'PASS' : 'FAIL'}`);
        }
    }
}

// Re-export types and providers for convenience
export type { AIProvider, ChatMessage, ChatOptions, ChatResponse } from './types';
export { GeminiProvider } from './gemini.provider';
export { KimiProvider } from './kimi.provider';

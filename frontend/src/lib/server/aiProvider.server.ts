import OpenAI from 'openai';
import { env } from '$env/dynamic/private';
import { observeOpenAIClient } from './langfuse.server';

export type AIProvider = 'openai' | 'deepseek' | 'anthropic' | 'google' | 'minimax';
export type AIModel =
    | 'gpt-4o'
    | 'gpt-4o-mini'
    | 'o3-mini'
    | 'deepseek'
    | 'deepseek-r1'
    | 'claude-sonnet'
    | 'claude-haiku'
    | 'gemini-2.5-flash'
    | 'gemini-2.5-pro'
    | 'minimax-text-01'
    | 'minimax-m1'
    | 'minimax-m2.5'
    | 'minimax-m2.5-highspeed';

type ModelConfig = {
    provider: AIProvider;
    apiModel: string;
    supportsImageInput: boolean;
};

const MODEL_CONFIG: Record<AIModel, ModelConfig> = {
    'gpt-4o': { provider: 'openai', apiModel: 'gpt-4o', supportsImageInput: true },
    'gpt-4o-mini': { provider: 'openai', apiModel: 'gpt-4o-mini', supportsImageInput: true },
    'o3-mini': { provider: 'openai', apiModel: 'o3-mini', supportsImageInput: false },
    // DeepSeek default chat model.
    'deepseek': { provider: 'deepseek', apiModel: 'deepseek-chat', supportsImageInput: false },
    // DeepSeek API model name for R1 is `deepseek-reasoner`.
    'deepseek-r1': { provider: 'deepseek', apiModel: 'deepseek-reasoner', supportsImageInput: false },
    // Anthropic via OpenAI-compatible endpoint
    'claude-sonnet': { provider: 'anthropic', apiModel: 'claude-sonnet-4-20250514', supportsImageInput: true },
    'claude-haiku': { provider: 'anthropic', apiModel: 'claude-haiku-4-5-20251001', supportsImageInput: true },
    // Google Gemini via OpenAI-compatible endpoint
    'gemini-2.5-flash': { provider: 'google', apiModel: 'gemini-2.5-flash', supportsImageInput: true },
    'gemini-2.5-pro': { provider: 'google', apiModel: 'gemini-2.5-pro', supportsImageInput: true },
    // MiniMax via OpenAI-compatible endpoint
    'minimax-text-01': { provider: 'minimax', apiModel: 'MiniMax-Text-01', supportsImageInput: false },
    'minimax-m1': { provider: 'minimax', apiModel: 'MiniMax-M1', supportsImageInput: false },
    'minimax-m2.5': { provider: 'minimax', apiModel: 'MiniMax-M2.5', supportsImageInput: false },
    'minimax-m2.5-highspeed': { provider: 'minimax', apiModel: 'MiniMax-M2.5-highspeed', supportsImageInput: false }
};

export const AI_MODEL_LIST: AIModel[] = Object.keys(MODEL_CONFIG) as AIModel[];

/**
 * Stateful streaming filter that strips <think>...</think> and <thinking>...</thinking>
 * blocks from chunked AI output. Must create one instance per stream.
 */
export class StreamingThinkFilter {
    private buffer = '';
    private inside = false;

    process(chunk: string): string {
        this.buffer += chunk;
        let output = '';

        while (true) {
            if (this.inside) {
                const c1 = this.buffer.indexOf('</think>');
                const c2 = this.buffer.indexOf('</thinking>');
                let closeIdx = -1, closeLen = 0;
                if (c1 !== -1 && (c2 === -1 || c1 <= c2)) { closeIdx = c1; closeLen = 8; }
                else if (c2 !== -1)                         { closeIdx = c2; closeLen = 11; }

                if (closeIdx !== -1) {
                    this.buffer = this.buffer.slice(closeIdx + closeLen);
                    this.inside = false;
                } else {
                    this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - 11));
                    break;
                }
            } else {
                const openIdx = this.buffer.indexOf('<think');
                if (openIdx !== -1) {
                    output += this.buffer.slice(0, openIdx);
                    const gtIdx = this.buffer.indexOf('>', openIdx);
                    if (gtIdx !== -1) {
                        this.buffer = this.buffer.slice(gtIdx + 1);
                        this.inside = true;
                    } else {
                        this.buffer = this.buffer.slice(openIdx);
                        break;
                    }
                } else {
                    output += this.buffer.slice(0, Math.max(0, this.buffer.length - 6));
                    this.buffer = this.buffer.slice(Math.max(0, this.buffer.length - 6));
                    break;
                }
            }
        }
        return output;
    }

    flush(): string {
        const out = this.inside ? '' : this.buffer;
        this.buffer = '';
        this.inside = false;
        return out;
    }
}

export function isAIModel(value: unknown): value is AIModel {
    return typeof value === 'string' && value in MODEL_CONFIG;
}

export function resolveDefaultAIModel(): AIModel {
    const configured = env.AI_MODEL?.trim();

    if (configured === 'deepseek-chat') return 'deepseek';
    if (configured && isAIModel(configured)) return configured;
    return 'gpt-4o';
}

export function getModelConfig(model: AIModel): ModelConfig {
    return MODEL_CONFIG[model];
}

/** Provider-specific base URLs and API key env var names */
const PROVIDER_CONFIG: Record<AIProvider, { baseURL?: string; envKey: string; envLabel: string }> = {
    openai: { envKey: 'OPENAI_API_KEY', envLabel: 'OPENAI_API_KEY' },
    deepseek: { baseURL: 'https://api.deepseek.com', envKey: 'DEEPSEEK_API_KEY', envLabel: 'DEEPSEEK_API_KEY' },
    anthropic: { baseURL: 'https://api.anthropic.com/v1/', envKey: 'ANTHROPIC_API_KEY', envLabel: 'ANTHROPIC_API_KEY' },
    google: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', envKey: 'GOOGLE_AI_API_KEY', envLabel: 'GOOGLE_AI_API_KEY' },
    minimax: { baseURL: 'https://api.minimax.io/v1', envKey: 'MINIMAX_API_KEY', envLabel: 'MINIMAX_API_KEY' }
};

export function getClientForModel(model: AIModel): {
    client: OpenAI;
    apiModel: string;
    provider: AIProvider;
    supportsImageInput: boolean;
} {
    const config = MODEL_CONFIG[model];
    const providerCfg = PROVIDER_CONFIG[config.provider];

    const key = (env as Record<string, string | undefined>)[providerCfg.envKey];
    if (!key) throw new Error(`${providerCfg.envLabel} is not configured in .env`);

    const clientOpts: ConstructorParameters<typeof OpenAI>[0] = {
        apiKey: key,
        timeout: 120_000,
        maxRetries: 1,
    };
    if (providerCfg.baseURL) {
        clientOpts.baseURL = providerCfg.baseURL;
    }

    const client = observeOpenAIClient(new OpenAI(clientOpts), {
        provider: config.provider,
        apiModel: config.apiModel,
        baseURL: providerCfg.baseURL
    });

    return {
        client,
        apiModel: config.apiModel,
        provider: config.provider,
        supportsImageInput: config.supportsImageInput
    };
}

/**
 * Try the primary model, fall back to alternates on error.
 * Returns the first successful client+model pair.
 */
export function getClientWithFallback(primary: AIModel, fallbacks: AIModel[]): {
    client: OpenAI;
    apiModel: string;
    provider: AIProvider;
    supportsImageInput: boolean;
    model: AIModel;
} {
    const chain = [primary, ...fallbacks];
    for (const model of chain) {
        try {
            const result = getClientForModel(model);
            return { ...result, model };
        } catch {
            // API key not configured, try next
            continue;
        }
    }
    throw new Error(`No AI provider available. Tried: ${chain.join(', ')}. Check your API keys in .env`);
}

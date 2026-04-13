/**
 * BigLot.ai - Environment Variable Validator
 * Validates required environment variables on startup
 */

import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export type EnvValidationResult = {
    valid: boolean;
    errors: string[];
    warnings: string[];
};

function getEnv(key: string): string | undefined {
    if (key.startsWith('PUBLIC_')) {
        return (publicEnv as Record<string, string | undefined>)[key];
    }
    return (env as Record<string, string | undefined>)[key];
}

const VALID_MODELS = [
	'gpt-4o',
	'gpt-4o-mini',
	'o3-mini',
	'deepseek',
	'deepseek-r1',
	'claude-sonnet',
	'claude-haiku',
	'gemini-2.5-flash',
	'gemini-2.5-pro',
	'minimax-text-01',
	'minimax-m1',
	'minimax-m2.5',
	'minimax-m2.5-highspeed'
];

function validateModelEnv(
    key: string,
    warnings: string[],
    fallbackLabel: string
): void {
    const value = getEnv(key) ?? '';
    if (!value) return;

    if (value === 'deepseek-chat') {
        warnings.push(`${key} uses legacy value "deepseek-chat" — prefer "deepseek"`);
        return;
    }

    if (!VALID_MODELS.includes(value)) {
        warnings.push(`${key} "${value}" is not recognized, falling back to ${fallbackLabel}`);
    }
}

export function validateEnvironment(): EnvValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required for AI features
	const openaiKey = getEnv('OPENAI_API_KEY') ?? '';
	const deepseekKey = getEnv('DEEPSEEK_API_KEY') ?? '';
	const minimaxKey = getEnv('MINIMAX_API_KEY') ?? '';
	const hasOpenAI = !!openaiKey.trim();
	const hasDeepSeek = !!deepseekKey.trim();
	const hasMiniMax = !!minimaxKey.trim();

	if (!hasOpenAI && !hasDeepSeek && !hasMiniMax) {
		errors.push('Either OPENAI_API_KEY, DEEPSEEK_API_KEY, or MINIMAX_API_KEY is required');
	}

    if (hasOpenAI && !openaiKey.startsWith('sk-')) {
        warnings.push('OPENAI_API_KEY may not be valid (should start with sk-)');
    }

	if (hasDeepSeek && !deepseekKey.startsWith('sk-')) {
		warnings.push('DEEPSEEK_API_KEY may not be valid (should start with sk-)');
	}

	if (hasMiniMax && !minimaxKey.startsWith('sk-')) {
		warnings.push('MINIMAX_API_KEY may not be valid (should start with sk-)');
	}

    // Required for Supabase
    const supabaseUrl = getEnv('PUBLIC_SUPABASE_URL') ?? '';
    const supabaseAnonKey = getEnv('PUBLIC_SUPABASE_ANON_KEY') ?? '';
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl.trim()) {
        errors.push('PUBLIC_SUPABASE_URL is required');
    }

    if (!supabaseAnonKey.trim()) {
        errors.push('PUBLIC_SUPABASE_ANON_KEY is required');
    }

    if (!serviceRoleKey.trim()) {
        warnings.push('SUPABASE_SERVICE_ROLE_KEY is recommended for admin operations');
    }

    // Anthropic (optional)
    const anthropicKey = getEnv('ANTHROPIC_API_KEY') ?? '';
    if (anthropicKey.trim() && !anthropicKey.startsWith('sk-ant-')) {
        warnings.push('ANTHROPIC_API_KEY may not be valid (should start with sk-ant-)');
    }

    // Google AI (optional)
    const googleAIKey = getEnv('GOOGLE_AI_API_KEY') ?? '';
    if (googleAIKey.trim() && !googleAIKey.startsWith('AI')) {
        warnings.push('GOOGLE_AI_API_KEY may not be valid (should start with AI)');
    }

    // AI Model validation
    validateModelEnv('AI_MODEL', warnings, 'gpt-4o');
    validateModelEnv('NORMAL_AI_MODEL', warnings, 'AI_MODEL/gpt-4o');
    validateModelEnv('AGENT_AI_MODEL', warnings, 'AI_MODEL/gpt-4o');
    validateModelEnv('RESEARCH_AI_MODEL', warnings, 'AI_MODEL/gpt-4o');

    // Discussion model overrides (optional)
    for (const key of ['DISCUSSION_BULL_MODEL', 'DISCUSSION_BEAR_MODEL', 'DISCUSSION_MODERATOR_MODEL']) {
        const val = getEnv(key) ?? '';
        if (val === 'deepseek-chat') {
            warnings.push(`${key} uses legacy value "deepseek-chat" — prefer "deepseek"`);
        } else if (val && !VALID_MODELS.includes(val)) {
            warnings.push(`${key} "${val}" is not recognized — will fall back to auto-detection`);
        }
    }

    const deepResearchIterations = getEnv('DEEP_RESEARCH_MAX_ITERATIONS') ?? '';
    if (deepResearchIterations) {
        const parsed = Number.parseInt(deepResearchIterations, 10);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
            warnings.push('DEEP_RESEARCH_MAX_ITERATIONS should be an integer between 1 and 20');
        }
    }

    const difyAgentEnabled = ['1', 'true'].includes((getEnv('DIFY_AGENT_ENABLED') ?? '').toLowerCase());
    const difyResearchEnabled = ['1', 'true'].includes((getEnv('DIFY_RESEARCH_ENABLED') ?? '').toLowerCase());
    const difyBaseUrl = getEnv('DIFY_BASE_URL') ?? '';
    if (difyAgentEnabled || difyResearchEnabled) {
        if (!difyBaseUrl.trim()) {
            warnings.push('DIFY_BASE_URL is required when Dify integration is enabled');
        } else if (!/^https?:\/\//.test(difyBaseUrl)) {
            warnings.push('DIFY_BASE_URL should be a full http/https URL');
        }
    }
    if (difyAgentEnabled && !(getEnv('DIFY_AGENT_API_KEY') ?? '').trim()) {
        warnings.push('DIFY_AGENT_API_KEY is required when DIFY_AGENT_ENABLED is on');
    }
    if (difyResearchEnabled && !(getEnv('DIFY_RESEARCH_API_KEY') ?? '').trim()) {
        warnings.push('DIFY_RESEARCH_API_KEY is required when DIFY_RESEARCH_ENABLED is on');
    }
    const difyTimeoutMs = getEnv('DIFY_TIMEOUT_MS') ?? '';
    if (difyTimeoutMs) {
        const parsed = Number.parseInt(difyTimeoutMs, 10);
        if (!Number.isFinite(parsed) || parsed < 1000) {
            warnings.push('DIFY_TIMEOUT_MS should be an integer >= 1000');
        }
    }

    // Telegram (optional but warn if partially configured)
    const telegramToken = getEnv('TELEGRAM_BOT_TOKEN') ?? '';
    const telegramUsername = getEnv('TELEGRAM_BOT_USERNAME') ?? '';
    const hasTelegramToken = !!telegramToken.trim();
    const hasTelegramUsername = !!telegramUsername.trim();

    if (hasTelegramToken && !hasTelegramUsername) {
        warnings.push('TELEGRAM_BOT_USERNAME is recommended when using Telegram');
    }

    // Tavily Web Search (optional)
    const tavilyKey = getEnv('TAVILY_API_KEY') ?? '';
    if (!tavilyKey.trim()) {
        warnings.push('TAVILY_API_KEY is not set — web search tool will be unavailable');
    } else if (!tavilyKey.startsWith('tvly-')) {
        warnings.push('TAVILY_API_KEY may not be valid (should start with tvly-)');
    }

    // Production warnings
    const nodeEnv = getEnv('NODE_ENV') ?? '';
    const webhookSecret = getEnv('TELEGRAM_WEBHOOK_SECRET') ?? '';
    if (nodeEnv === 'production') {
        if (!webhookSecret.trim()) {
            warnings.push('TELEGRAM_WEBHOOK_SECRET is recommended in production');
        }
    }

    const supabaseServerUrl = getEnv('SUPABASE_URL') ?? '';
    if (supabaseServerUrl.trim() && !/^https?:\/\//.test(supabaseServerUrl)) {
        warnings.push('SUPABASE_URL should be a full https URL');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

export function logEnvStatus(): void {
    const result = validateEnvironment();

    if (result.errors.length > 0) {
        console.error('[BigLot.ai] ❌ Environment Configuration Errors:');
        result.errors.forEach(e => console.error(`  - ${e}`));
    }

    if (result.warnings.length > 0) {
        console.warn('[BigLot.ai] ⚠️ Environment Warnings:');
        result.warnings.forEach(w => console.warn(`  - ${w}`));
    }

    if (result.valid && result.warnings.length === 0) {
        console.log('[BigLot.ai] ✅ Environment configured correctly');
    }
}

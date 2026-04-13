import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { validateEnvironment, logEnvStatus } from './envValidator.server';

// Helper to set env vars for test
function setEnv(vars: Record<string, string>) {
	for (const [key, value] of Object.entries(vars)) {
		if (key.startsWith('PUBLIC_')) {
			(publicEnv as Record<string, string>)[key] = value;
		} else {
			(privateEnv as Record<string, string>)[key] = value;
		}
	}
}

// Minimal valid config
function setMinimalValid() {
	setEnv({
		OPENAI_API_KEY: 'sk-test123',
		PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
		PUBLIC_SUPABASE_ANON_KEY: 'eyJ...',
		SUPABASE_SERVICE_ROLE_KEY: 'eyJ...'
	});
}

describe('validateEnvironment', () => {
	// --- AI Provider validation ---

	it('errors when both OpenAI and DeepSeek keys are missing', () => {
		setEnv({ PUBLIC_SUPABASE_URL: 'url', PUBLIC_SUPABASE_ANON_KEY: 'key' });
		const result = validateEnvironment();
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Either OPENAI_API_KEY, DEEPSEEK_API_KEY, or MINIMAX_API_KEY is required');
	});

	it('passes with only OpenAI key', () => {
		setMinimalValid();
		const result = validateEnvironment();
		expect(result.valid).toBe(true);
	});

	it('passes with only DeepSeek key', () => {
		setEnv({
			DEEPSEEK_API_KEY: 'sk-deep123',
			PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
			PUBLIC_SUPABASE_ANON_KEY: 'key',
			SUPABASE_SERVICE_ROLE_KEY: 'role'
		});
		const result = validateEnvironment();
		expect(result.valid).toBe(true);
	});

	it('passes with only MiniMax key', () => {
		setEnv({
			MINIMAX_API_KEY: 'sk-minimax123',
			PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
			PUBLIC_SUPABASE_ANON_KEY: 'key',
			SUPABASE_SERVICE_ROLE_KEY: 'role'
		});
		const result = validateEnvironment();
		expect(result.valid).toBe(true);
	});

	it('warns when OpenAI key does not start with sk-', () => {
		setEnv({
			OPENAI_API_KEY: 'invalid-key',
			PUBLIC_SUPABASE_URL: 'url',
			PUBLIC_SUPABASE_ANON_KEY: 'key'
		});
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('OPENAI_API_KEY may not be valid'));
	});

	it('warns when DeepSeek key does not start with sk-', () => {
		setEnv({
			DEEPSEEK_API_KEY: 'bad-key',
			PUBLIC_SUPABASE_URL: 'url',
			PUBLIC_SUPABASE_ANON_KEY: 'key'
		});
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('DEEPSEEK_API_KEY may not be valid'));
	});

	it('warns when MiniMax key does not start with sk-', () => {
		setEnv({
			MINIMAX_API_KEY: 'bad-key',
			PUBLIC_SUPABASE_URL: 'url',
			PUBLIC_SUPABASE_ANON_KEY: 'key'
		});
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('MINIMAX_API_KEY may not be valid'));
	});

	// --- Supabase validation ---

	it('errors when PUBLIC_SUPABASE_URL is missing', () => {
		setEnv({ OPENAI_API_KEY: 'sk-test', PUBLIC_SUPABASE_ANON_KEY: 'key' });
		const result = validateEnvironment();
		expect(result.errors).toContain('PUBLIC_SUPABASE_URL is required');
	});

	it('errors when PUBLIC_SUPABASE_ANON_KEY is missing', () => {
		setEnv({ OPENAI_API_KEY: 'sk-test', PUBLIC_SUPABASE_URL: 'url' });
		const result = validateEnvironment();
		expect(result.errors).toContain('PUBLIC_SUPABASE_ANON_KEY is required');
	});

	it('warns when SUPABASE_SERVICE_ROLE_KEY is missing', () => {
		setEnv({
			OPENAI_API_KEY: 'sk-test',
			PUBLIC_SUPABASE_URL: 'url',
			PUBLIC_SUPABASE_ANON_KEY: 'key'
		});
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY is recommended'));
	});

	// --- Optional providers ---

	it('warns when Anthropic key does not start with sk-ant-', () => {
		setMinimalValid();
		setEnv({ ANTHROPIC_API_KEY: 'bad-key' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('ANTHROPIC_API_KEY may not be valid'));
	});

	it('no warning for valid Anthropic key', () => {
		setMinimalValid();
		setEnv({ ANTHROPIC_API_KEY: 'sk-ant-valid' });
		const result = validateEnvironment();
		const anthropicWarnings = result.warnings.filter(w => w.includes('ANTHROPIC'));
		expect(anthropicWarnings).toHaveLength(0);
	});

	it('warns when Google AI key does not start with AI', () => {
		setMinimalValid();
		setEnv({ GOOGLE_AI_API_KEY: 'bad-key' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('GOOGLE_AI_API_KEY may not be valid'));
	});

	// --- AI Model validation ---

	it('warns for unrecognized AI_MODEL', () => {
		setMinimalValid();
		setEnv({ AI_MODEL: 'gpt-99' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('"gpt-99" is not recognized'));
	});

	it('no warning for valid AI_MODEL', () => {
		setMinimalValid();
		setEnv({ AI_MODEL: 'gpt-4o' });
		const result = validateEnvironment();
		const modelWarnings = result.warnings.filter(w => w.includes('AI_MODEL'));
		expect(modelWarnings).toHaveLength(0);
	});

	it('warns for unrecognized RESEARCH_AI_MODEL', () => {
		setMinimalValid();
		setEnv({ RESEARCH_AI_MODEL: 'gpt-99' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('RESEARCH_AI_MODEL'));
	});

	// --- Discussion model overrides ---

	it('warns for invalid discussion model', () => {
		setMinimalValid();
		setEnv({ DISCUSSION_BULL_MODEL: 'invalid-model' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('DISCUSSION_BULL_MODEL'));
	});

	it('no warning for valid discussion models', () => {
		setMinimalValid();
		setEnv({
			DISCUSSION_BULL_MODEL: 'gpt-4o',
			DISCUSSION_BEAR_MODEL: 'deepseek',
			DISCUSSION_MODERATOR_MODEL: 'gpt-4o-mini'
		});
		const result = validateEnvironment();
		const discWarnings = result.warnings.filter(w => w.includes('DISCUSSION_'));
		expect(discWarnings).toHaveLength(0);
	});

	it('accepts MiniMax discussion models as valid', () => {
		setMinimalValid();
		setEnv({
			DISCUSSION_BULL_MODEL: 'minimax-text-01',
			DISCUSSION_BEAR_MODEL: 'minimax-m2.5',
			DISCUSSION_MODERATOR_MODEL: 'minimax-m1'
		});
		const result = validateEnvironment();
		const discWarnings = result.warnings.filter(w => w.includes('DISCUSSION_'));
		expect(discWarnings).toHaveLength(0);
	});

	// --- Tavily ---

	it('warns when TAVILY_API_KEY is missing', () => {
		setMinimalValid();
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('TAVILY_API_KEY is not set'));
	});

	it('warns when TAVILY_API_KEY has wrong prefix', () => {
		setMinimalValid();
		setEnv({ TAVILY_API_KEY: 'bad-key' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('TAVILY_API_KEY may not be valid'));
	});

	it('warns when Dify is enabled without base URL or API key', () => {
		setMinimalValid();
		setEnv({ DIFY_AGENT_ENABLED: '1' });
		const result = validateEnvironment();
		expect(result.warnings).toContain('DIFY_BASE_URL is required when Dify integration is enabled');
		expect(result.warnings).toContain('DIFY_AGENT_API_KEY is required when DIFY_AGENT_ENABLED is on');
	});

	it('warns when DIFY_TIMEOUT_MS is invalid', () => {
		setMinimalValid();
		setEnv({
			DIFY_BASE_URL: 'http://localhost:5001/v1',
			DIFY_RESEARCH_ENABLED: '1',
			DIFY_RESEARCH_API_KEY: 'app-key',
			DIFY_TIMEOUT_MS: '250'
		});
		const result = validateEnvironment();
		expect(result.warnings).toContain('DIFY_TIMEOUT_MS should be an integer >= 1000');
	});

	it('no Tavily warning for valid key', () => {
		setMinimalValid();
		setEnv({ TAVILY_API_KEY: 'tvly-test123' });
		const result = validateEnvironment();
		const tavilyWarnings = result.warnings.filter(w => w.includes('TAVILY'));
		expect(tavilyWarnings).toHaveLength(0);
	});

	// --- Telegram ---

	it('warns when Telegram token is set but username is missing', () => {
		setMinimalValid();
		setEnv({ TELEGRAM_BOT_TOKEN: 'token123' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('TELEGRAM_BOT_USERNAME is recommended'));
	});

	// --- Production ---

	it('warns in production when webhook secret is missing', () => {
		setMinimalValid();
		setEnv({ NODE_ENV: 'production' });
		const result = validateEnvironment();
		expect(result.warnings).toContainEqual(expect.stringContaining('TELEGRAM_WEBHOOK_SECRET is recommended'));
	});

	// --- Fully valid ---

	it('returns valid with no errors for complete config', () => {
		setMinimalValid();
		setEnv({ TAVILY_API_KEY: 'tvly-key' });
		const result = validateEnvironment();
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

describe('logEnvStatus', () => {
	it('calls console.error for errors', () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		logEnvStatus();
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});

	it('calls console.log when fully valid', () => {
		setMinimalValid();
		setEnv({ TAVILY_API_KEY: 'tvly-key' });
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		logEnvStatus();
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('configured correctly'));
		logSpy.mockRestore();
		warnSpy.mockRestore();
	});
});

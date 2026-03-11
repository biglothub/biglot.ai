import { describe, expect, it } from 'vitest';
import { env } from '$env/dynamic/private';
import { resolveChatModelRuntime } from './chatModelRuntime.server';

function setEnv(vars: Record<string, string>) {
	for (const [key, value] of Object.entries(vars)) {
		(env as Record<string, string>)[key] = value;
	}
}

describe('resolveChatModelRuntime', () => {
	it('does not require a single-model client for discussion mode', () => {
		setEnv({
			MINIMAX_API_KEY: 'sk-minimax',
			DISCUSSION_BULL_MODEL: 'minimax-m2.5',
			DISCUSSION_BEAR_MODEL: 'minimax-m2.5',
			DISCUSSION_MODERATOR_MODEL: 'minimax-m2.5'
		});

		const result = resolveChatModelRuntime('discussion');

		expect(result.clientBundle).toBeNull();
		expect(result.runProviderLabel).toBe('minimax');
		expect(result.runModelLabel).toContain('bull=minimax-m2.5');
		expect(result.runModelLabel).toContain('bear=minimax-m2.5');
		expect(result.runModelLabel).toContain('moderator=minimax-m2.5');
	});

	it('still validates configured provider keys for normal chat', () => {
		expect(() => resolveChatModelRuntime('normal')).toThrow('OPENAI_API_KEY is not configured');
	});

	it('uses the configured agent model for agent chat', () => {
		setEnv({
			MINIMAX_API_KEY: 'sk-minimax',
			AGENT_AI_MODEL: 'minimax-m2.5'
		});

		const result = resolveChatModelRuntime('agent');

		expect(result.selectedModel).toBe('minimax-m2.5');
		expect(result.clientBundle?.provider).toBe('minimax');
		expect(result.runModelLabel).toBe('minimax-m2.5');
	});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$lib/__mocks__/$env.dynamic.private';
import {
	chunkTelegramText,
	formatTelegramOutput,
	parseTelegramUpdate,
	sendTelegramAssistantReply
} from './adapter';

describe('telegram adapter', () => {
	beforeEach(() => {
		env.TELEGRAM_BOT_TOKEN = 'test-token';
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('parses a threaded Telegram update into an inbound envelope', () => {
		const parsed = parseTelegramUpdate({
			update_id: 77,
			message: {
				message_id: 15,
				message_thread_id: 333,
				date: 1_710_000_000,
				text: '/help',
				chat: { id: -100123, type: 'supergroup' },
				from: { id: 9, username: 'alice', first_name: 'Alice' }
			}
		});

		expect(parsed.kind).toBe('message');
		if (parsed.kind !== 'message') return;
		expect(parsed.command).toBe('help');
		expect(parsed.envelope.conversationId).toBe('-100123:333');
		expect(parsed.envelope.threadId).toBe('333');
		expect(parsed.envelope.message.externalMessageId).toBe('15');
	});

	it('chunks long replies on whitespace boundaries', () => {
		const chunks = chunkTelegramText('alpha beta gamma delta epsilon zeta eta theta', 12);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((chunk) => chunk.length <= 12)).toBe(true);
	});

	it('formats markdown-like output for Telegram HTML', () => {
		const formatted = formatTelegramOutput('## Title\n- item\n**bold** and `code`');
		expect(formatted).toContain('<b>Title</b>');
		expect(formatted).toContain('• item');
		expect(formatted).toContain('<b>bold</b>');
		expect(formatted).toContain('<code>code</code>');
	});

	it('sends chunked replies with thread and reply bindings', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true
		});
		vi.stubGlobal('fetch', fetchMock);

		await sendTelegramAssistantReply({
			chatId: 123,
			threadId: 456,
			replyToMessageId: 789,
			reply: {
				plainText: 'alpha beta gamma delta epsilon zeta eta theta',
				blocks: [],
				toolEvents: [],
				final: true,
				citations: []
			}
		});

		expect(fetchMock).toHaveBeenCalled();
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(body.chat_id).toBe(123);
		expect(body.reply_to_message_id).toBe(789);
		expect(body.message_thread_id).toBe(456);
	});
});

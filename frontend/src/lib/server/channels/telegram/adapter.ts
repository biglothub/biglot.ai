import {
	getTelegramWebhookSecret,
	sendTelegramChatAction,
	sendTelegramMessage
} from '$lib/server/telegram.server';
import type { AssistantReply, ChannelConversation, InboundEnvelope } from '../types';

export type TelegramUser = {
	id: number;
	is_bot?: boolean;
	first_name?: string;
	last_name?: string;
	username?: string;
	language_code?: string;
};

export type TelegramChat = {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
};

export type TelegramMessage = {
	message_id: number;
	message_thread_id?: number;
	date: number;
	text?: string;
	chat: TelegramChat;
	from?: TelegramUser;
};

export type TelegramUpdate = {
	update_id: number;
	message?: TelegramMessage;
};

export type ParsedTelegramInbound =
	| {
			kind: 'ignored';
			updateId: number;
			reason: string;
	  }
	| {
			kind: 'message';
			updateId: number;
			message: TelegramMessage;
			sender: TelegramUser;
			incomingText: string;
			command: 'start' | 'unlink' | 'help' | null;
			envelope: InboundEnvelope;
	  };

export function verifyTelegramWebhookRequest(headers: Headers): void {
	const expectedSecret = getTelegramWebhookSecret();
	if (!expectedSecret) return;
	const actualSecret = headers.get('x-telegram-bot-api-secret-token');
	if (actualSecret !== expectedSecret) {
		throw new Error('Unauthorized webhook request');
	}
}

export function buildTelegramConversationId(chatId: number, threadId?: number): string {
	return typeof threadId === 'number' ? `${chatId}:${threadId}` : String(chatId);
}

export function parseTelegramUpdate(update: TelegramUpdate): ParsedTelegramInbound {
	if (typeof update.update_id !== 'number') {
		return { kind: 'ignored', updateId: -1, reason: 'Missing update_id' };
	}

	const message = update.message;
	if (!message?.chat?.id || !message.from?.id) {
		return { kind: 'ignored', updateId: update.update_id, reason: 'No message payload' };
	}

	const incomingText = typeof message.text === 'string' ? message.text.trim() : '';
	const command = parseTelegramCommand(incomingText);
	const threadId = typeof message.message_thread_id === 'number' ? String(message.message_thread_id) : undefined;

	return {
		kind: 'message',
		updateId: update.update_id,
		message,
		sender: message.from,
		incomingText,
		command,
		envelope: {
			channel: 'telegram',
			conversationId: buildTelegramConversationId(message.chat.id, message.message_thread_id),
			threadId,
			sender: {
				externalUserId: String(message.from.id),
				username: message.from.username ?? null,
				displayName: [message.from.first_name, message.from.last_name].filter(Boolean).join(' ') || message.from.username || null
			},
			message: {
				externalMessageId: String(message.message_id),
				text: incomingText
			},
			attachments: [],
			receivedAt: message.date * 1000,
			raw: update
		}
	};
}

export function parseTelegramCommand(text: string): 'start' | 'unlink' | 'help' | null {
	const command = text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
	if (!command.startsWith('/')) return null;
	const commandBase = command.slice(1).split('@')[0] ?? '';
	if (commandBase === 'start' || commandBase === 'unlink' || commandBase === 'help') {
		return commandBase;
	}
	return null;
}

export function chunkTelegramText(rawText: string, limit = 3000): string[] {
	const text = rawText.trim();
	if (!text) return ['(empty response)'];
	if (text.length <= limit) return [text];

	const chunks: string[] = [];
	let cursor = 0;

	while (cursor < text.length) {
		const maxEnd = Math.min(cursor + limit, text.length);
		let splitAt = text.lastIndexOf('\n', maxEnd);
		if (splitAt <= cursor) splitAt = text.lastIndexOf(' ', maxEnd);
		if (splitAt <= cursor) splitAt = maxEnd;

		const piece = text.slice(cursor, splitAt).trim();
		if (piece.length > 0) chunks.push(piece);
		cursor = splitAt;
	}

	return chunks.length > 0 ? chunks : [text.slice(0, limit)];
}

export function formatTelegramOutput(rawText: string): string {
	const trimmed = rawText.trim();
	if (!trimmed) return '(empty response)';

	const sections: string[] = [];
	const codeBlockPattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;
	let cursor = 0;

	while (true) {
		const match = codeBlockPattern.exec(trimmed);
		if (!match) break;

		const plainPart = trimmed.slice(cursor, match.index);
		if (plainPart.trim().length > 0) sections.push(formatPlainMarkdownLikeText(plainPart));

		const language = typeof match[1] === 'string' ? match[1].trim() : '';
		const code = typeof match[2] === 'string' ? match[2].trimEnd() : '';
		const escapedCode = escapeTelegramHtml(code);
		sections.push(
			language
				? `<b>${escapeTelegramHtml(language.toUpperCase())}</b>\n<pre><code>${escapedCode}</code></pre>`
				: `<pre><code>${escapedCode}</code></pre>`
		);

		cursor = match.index + match[0].length;
	}

	const tail = trimmed.slice(cursor);
	if (tail.trim().length > 0) sections.push(formatPlainMarkdownLikeText(tail));

	const formatted = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
	return formatted.length > 0 ? formatted : escapeTelegramHtml(trimmed);
}

export async function sendTelegramAssistantReply(input: {
	chatId: number;
	threadId?: number;
	replyToMessageId?: number;
	reply: AssistantReply;
}): Promise<void> {
	const chunks = chunkTelegramText(input.reply.plainText, 3000);
	for (const chunk of chunks) {
		const pretty = formatTelegramOutput(chunk);
		try {
			await sendTelegramMessage(input.chatId, pretty, {
				parseMode: 'HTML',
				replyToMessageId: input.replyToMessageId,
				messageThreadId: input.threadId
			});
		} catch {
			await sendTelegramMessage(input.chatId, chunk, {
				replyToMessageId: input.replyToMessageId,
				messageThreadId: input.threadId
			});
		}
	}
}

export function startTelegramProgress(input: { chatId: number; threadId?: number }): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setInterval> | null = null;

	const sendTyping = async () => {
		if (stopped) return;
		try {
			await sendTelegramChatAction(input.chatId, 'typing');
		} catch (error) {
			console.warn('[Telegram typing indicator warning]', error);
		}
	};

	void sendTyping();
	timer = setInterval(() => {
		void sendTyping();
	}, 4000);

	return () => {
		stopped = true;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
	};
}

export function buildTelegramConversationTitle(label: string, conversation: ChannelConversation): string {
	return conversation.externalConversationId.includes(':') ? `${label} • Thread` : label;
}

function formatPlainMarkdownLikeText(input: string): string {
	const lines = input.split('\n');
	const mappedLines = lines.map((line) => {
		const heading = line.match(/^#{1,6}\s+(.+)$/);
		if (heading) return `<b>${escapeTelegramHtml(heading[1].trim())}</b>`;

		const bullet = line.match(/^\s*[-*]\s+(.+)$/);
		if (bullet) return `• ${escapeTelegramHtml(bullet[1])}`;

		const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
		if (numbered) return `${numbered[1]}. ${escapeTelegramHtml(numbered[2])}`;

		return escapeTelegramHtml(line);
	});

	let formatted = mappedLines.join('\n');
	formatted = formatted.replace(/`([^`\n]+)`/g, '<code>$1</code>');
	formatted = formatted.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, '<b>$1</b>');
	formatted = formatted.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1<i>$2</i>');
	formatted = formatted.replace(
		/(^|[\s(])(https?:\/\/[^\s<]+)/g,
		(_, prefix: string, url: string) => `${prefix}<a href="${url}">${url}</a>`
	);

	return formatted;
}

function escapeTelegramHtml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

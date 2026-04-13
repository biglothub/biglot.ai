import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';

export type TelegramLinkRecord = {
    id: string;
    biglot_user_id: string;
    telegram_user_id: number;
    telegram_chat_id: number;
    telegram_username: string | null;
    telegram_first_name: string | null;
    telegram_last_name: string | null;
    is_active: boolean;
    linked_at: string;
    unlinked_at: string | null;
    created_at: string;
    updated_at: string;
};

type TelegramSendOptions = {
    parseMode?: 'HTML' | 'MarkdownV2';
    disableWebPagePreview?: boolean;
    replyToMessageId?: number;
    messageThreadId?: number;
};

export type TelegramChatAction = 'typing';

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

export function isValidBigLotUserId(value: unknown): value is string {
    return typeof value === 'string' && USER_ID_PATTERN.test(value);
}

export function createLinkToken(): string {
    return randomBytes(24).toString('base64url');
}

export function hashLinkToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
}

export function getTelegramBotToken(): string {
    const token = env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
    return token;
}

export function getTelegramBotUsername(): string {
    const username = env.TELEGRAM_BOT_USERNAME?.trim();
    if (!username) throw new Error('TELEGRAM_BOT_USERNAME is not configured.');
    return username;
}

export function getTelegramWebhookSecret(): string | null {
    const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
    return secret && secret.length > 0 ? secret : null;
}

export async function sendTelegramMessage(chatId: number, text: string, options: TelegramSendOptions = {}): Promise<void> {
    const token = getTelegramBotToken();
    const parseMode = options.parseMode;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            text,
            disable_web_page_preview: options.disableWebPagePreview ?? true,
            ...(typeof options.replyToMessageId === 'number' ? { reply_to_message_id: options.replyToMessageId } : {}),
            ...(typeof options.messageThreadId === 'number' ? { message_thread_id: options.messageThreadId } : {}),
            ...(parseMode ? { parse_mode: parseMode } : {})
        })
    });

    if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Telegram sendMessage failed (${response.status}): ${raw}`);
    }
}

export async function sendTelegramChatAction(chatId: number, action: TelegramChatAction = 'typing'): Promise<void> {
    const token = getTelegramBotToken();
    const response = await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            action
        })
    });

    if (!response.ok) {
        const raw = await response.text();
        throw new Error(`Telegram sendChatAction failed (${response.status}): ${raw}`);
    }
}

export function toDisplayName(link: Pick<TelegramLinkRecord, 'telegram_username' | 'telegram_first_name' | 'telegram_last_name'>): string {
    if (link.telegram_username) return `@${link.telegram_username}`;
    const parts = [link.telegram_first_name, link.telegram_last_name].filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0
    );
    return parts.join(' ').trim() || 'Telegram user';
}

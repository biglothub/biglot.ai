import { supabase } from '$lib/supabase';
import { parseSSEStream } from '$lib/utils/sseParser';
import { applyDiscussionStreamEvent } from './discussionStream';
import type {
    AgentRouteType,
    ContentBlock,
    ToolCallStatus,
    PlanBlock,
    DiscussionBlock
} from '$lib/types/contentBlock';

export type AgentMode = 'coach' | 'recovery' | 'analyst' | 'pinescript' | 'gold' | 'macro' | 'portfolio';
export type ChatMode = 'normal' | 'agent' | 'discussion' | 'research';
export type ChatChannel = 'web' | 'telegram';

export type FileAttachment = {
    name: string;
    content: string;
    mimeType: string;
};

export type Message = {
    id?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    contentBlocks?: ContentBlock[];
    toolCalls?: ToolCallStatus[];
    image_url?: string;
    file_name?: string;
    mode?: AgentMode;
    channel?: ChatChannel;
    runId?: string | null;
    routeType?: AgentRouteType;
    feedback?: 'up' | 'down' | null;
};

export type Chat = {
    id: string;
    title: string;
    created_at: string;
};

export type TelegramLinkStatus = {
    linked: boolean;
    displayName?: string;
    linkedAt?: string;
};

type LinkTokenResponse = {
    deepLink: string;
    expiresAt: string;
};

type JsonObject = Record<string, unknown>;

const AGENT_MODES: AgentMode[] = ['coach', 'recovery', 'analyst', 'pinescript', 'gold', 'macro', 'portfolio'];
const CHAT_MODES: ChatMode[] = ['normal', 'agent', 'discussion', 'research'];
const CHAT_CHANNELS: ChatChannel[] = ['web', 'telegram'];

// ── Auto-detect AgentMode from prompt keywords ─────────────────────
// Order matters: more-specific modes checked first to avoid false positives.
const MODE_SIGNALS: [AgentMode, string[]][] = [
    ['gold', [
        'ทอง', 'ทองคำ', 'xau', 'xauusd', 'gold', 'gc=f', 'ราคาทอง',
        'ทองขึ้น', 'ทองลง', 'gold spot', 'gold price', 'ทองวันนี้',
        'ออมทอง', 'ทองแท่ง', 'ทองรูปพรรณ'
    ]],
    ['pinescript', [
        'pinescript', 'pine script', 'indicator', 'strategy alert',
        'เขียน indicator', 'สร้าง indicator', 'tradingview', 'ta.',
        'pine', 'สร้าง strategy', 'backtest'
    ]],
    ['recovery', [
        'ขาดทุน', 'เสียเงิน', 'drawdown', 'เครียด', 'หมดตัว', 'ล้างพอร์ต',
        'ฟื้นพอร์ต', 'losing streak', 'revenge trade', 'overtrade',
        'cut loss', 'เลิกเทรด', 'ท้อ', 'ติดดอย'
    ]],
    ['portfolio', [
        'portfolio', 'จัดพอร์ต', 'ปรับพอร์ต', 'พอร์ตลงทุน', 'asset allocation',
        'diversif', 'rebalance', 'สัดส่วนพอร์ต', 'แบ่งพอร์ต'
    ]],
    ['macro', [
        'macro', 'dxy', 'fomc', 'nfp', 'cpi', 'gdp', 'treasury',
        'เศรษฐกิจ', 'inflation', 'ดอลลาร์', 'recession', 'interest rate',
        'อัตราดอกเบี้ย', 'ธนาคารกลาง', 'fed'
    ]],
    ['analyst', [
        'วิเคราะห์', 'analysis', 'technical', 'แนวรับ', 'แนวต้าน',
        'support', 'resistance', 'breakout', 'bearish', 'bullish',
        'candlestick', 'elliott', 'fibonacci', 'แนวโน้ม'
    ]]
    // coach is the fallback — no signals needed
];

const LATIN_SIGNAL_RE = /^[a-z0-9]/i;

function detectAgentMode(text: string): AgentMode | null {
    const lower = text.toLowerCase().trim();
    if (!lower) return null;

    for (const [mode, signals] of MODE_SIGNALS) {
        for (const signal of signals) {
            // Short Latin keywords use word-boundary matching to avoid false positives
            if (signal.length <= 4 && LATIN_SIGNAL_RE.test(signal)) {
                const re = new RegExp(
                    `(?:^|[\\s,;:.!?()\\[\\]{}"\\/'#@])${signal}(?:$|[\\s,;:.!?()\\[\\]{}"\\/'#@])`,
                    'i'
                );
                if (re.test(lower)) return mode;
            } else {
                if (lower.includes(signal)) return mode;
            }
        }
    }

    return null;
}
const AGENT_ROUTE_TYPES: AgentRouteType[] = ['direct_answer', 'single_tool', 'plan_then_execute', 'discussion', 'deep_research'];
const CONTENT_BLOCK_TYPES = new Set([
    'text',
    'image',
    'chart',
    'table',
    'metric_card',
    'news_list',
    'embed',
    'error',
    'plan',
    'gauge',
    'heatmap',
    'trade_setup',
    'sources',
    'discussion',
    'research_report'
] as const);
const PLAN_STEP_STATUSES = new Set(['pending', 'running', 'complete', 'error', 'skipped'] as const);
const PLAN_STATUSES = new Set(['planning', 'executing', 'complete', 'error'] as const);
const DISCUSSION_PANELIST_IDS = new Set(['bull', 'bear', 'moderator'] as const);

function isRecord(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null;
}

function isMessageRole(value: unknown): value is Message['role'] {
    return value === 'user' || value === 'assistant' || value === 'system';
}

function isAgentMode(value: unknown): value is AgentMode {
    return typeof value === 'string' && AGENT_MODES.includes(value as AgentMode);
}

function isChatMode(value: unknown): value is ChatMode {
    return typeof value === 'string' && CHAT_MODES.includes(value as ChatMode);
}

function isChatChannel(value: unknown): value is ChatChannel {
    return typeof value === 'string' && CHAT_CHANNELS.includes(value as ChatChannel);
}

function isAgentRouteType(value: unknown): value is AgentRouteType {
    return typeof value === 'string' && AGENT_ROUTE_TYPES.includes(value as AgentRouteType);
}

function isContentBlock(value: unknown): value is ContentBlock {
    return isRecord(value) && typeof value.type === 'string' && CONTENT_BLOCK_TYPES.has(value.type as ContentBlock['type']);
}

function isPlanBlock(value: unknown): value is PlanBlock {
    return (
        isRecord(value) &&
        value.type === 'plan' &&
        typeof value.planId === 'string' &&
        Array.isArray(value.steps) &&
        typeof value.title === 'string' &&
        PLAN_STATUSES.has(value.status as PlanBlock['status'])
    );
}

function isDiscussionBlock(value: unknown): value is DiscussionBlock {
    return (
        isRecord(value) &&
        value.type === 'discussion' &&
        typeof value.discussionId === 'string' &&
        Array.isArray(value.turns) &&
        Array.isArray(value.panelists)
    );
}

function parseJsonObject(raw: string): JsonObject | null {
    try {
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseStoredMessageRow(row: unknown): Message | null {
    if (!isRecord(row) || !isMessageRole(row.role)) return null;

    const message: Message = {
        id: typeof row.id === 'string' ? row.id : undefined,
        role: row.role,
        content: typeof row.content === 'string' ? row.content : '',
        image_url: typeof row.image_url === 'string' ? row.image_url : undefined,
        file_name: typeof row.file_name === 'string' ? row.file_name : undefined,
        channel: isChatChannel(row.channel) ? row.channel : undefined,
        runId: typeof row.run_id === 'string' ? row.run_id : undefined,
        mode: isAgentMode(row.mode) ? row.mode : undefined
    };

    if (Array.isArray(row.content_blocks)) {
        message.contentBlocks = row.content_blocks.filter(isContentBlock);
    }

    return message;
}

async function readApiError(response: Response, fallback: string): Promise<string> {
    try {
        const body = await response.clone().json();
        if (body && typeof body.error === 'string' && body.error.trim().length > 0) {
            return body.error;
        }
    } catch {
        // ignore JSON parse error and fallback to text
    }

    try {
        const text = (await response.text()).trim();
        if (text.length > 0) return text;
    } catch {
        // ignore text read error
    }

    return fallback;
}

class ChatState {
    messages = $state<Message[]>([]);
    allChats = $state<Chat[]>([]);
    currentChatId = $state<string | null>(null);
    isLoading = $state(false);
    selectedImage = $state<string | null>(null);
    selectedFile = $state<FileAttachment | null>(null);
    agentMode = $state<AgentMode>('coach');
    chatMode = $state<ChatMode>('normal');
    lastDbError = $state<string | null>(null);
    private abortController: AbortController | null = null;

    biglotUserId = $state<string>('anonymous');

    activeBotId = $state<string | null>(null);

    telegramLinkStatus = $state<TelegramLinkStatus>({ linked: false });
    isTelegramLinkLoading = $state(false);
    telegramError = $state<string | null>(null);

    private static readonly AGENT_MODE_STORAGE_KEY = 'biglot.agentMode';
    private static readonly CHAT_MODE_STORAGE_KEY = 'biglot.chatMode';
    private static readonly USER_ID_STORAGE_KEY = 'biglot.userId';

    constructor() {
        if (typeof localStorage === 'undefined') return;

        const savedMode = localStorage.getItem(ChatState.AGENT_MODE_STORAGE_KEY);
        if (isAgentMode(savedMode)) {
            this.agentMode = savedMode;
        }

        const savedChatMode = localStorage.getItem(ChatState.CHAT_MODE_STORAGE_KEY);
        if (isChatMode(savedChatMode)) {
            this.chatMode = savedChatMode;
        }

        const savedUserId = localStorage.getItem(ChatState.USER_ID_STORAGE_KEY);
        if (savedUserId && savedUserId.length >= 8) {
            this.biglotUserId = savedUserId;
        } else {
            const generated = this.generateBrowserUserId();
            this.biglotUserId = generated;
            localStorage.setItem(ChatState.USER_ID_STORAGE_KEY, generated);
        }
    }

    setAgentMode(mode: AgentMode) {
        this.agentMode = mode;
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(ChatState.AGENT_MODE_STORAGE_KEY, mode);
    }

    setChatMode(mode: ChatMode) {
        this.chatMode = mode;
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(ChatState.CHAT_MODE_STORAGE_KEY, mode);
    }

    stopGeneration() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.isLoading = false;
    }

    private generateBrowserUserId(): string {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        const randomPart = Math.random().toString(36).slice(2, 12);
        const timestamp = Date.now().toString(36);
        return `u_${timestamp}_${randomPart}`;
    }

    async refreshTelegramLinkStatus() {
        this.isTelegramLinkLoading = true;
        this.telegramError = null;

        try {
            const url = `/api/telegram/link?biglotUserId=${encodeURIComponent(this.biglotUserId)}`;
            const response = await fetch(url, { method: 'GET' });
            if (!response.ok) {
                const message = await readApiError(response, 'Failed to load Telegram link status');
                throw new Error(message);
            }

            const data = (await response.json()) as {
                linked?: unknown;
                displayName?: unknown;
                linkedAt?: unknown;
            };

            this.telegramLinkStatus = {
                linked: data.linked === true,
                displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
                linkedAt: typeof data.linkedAt === 'string' ? data.linkedAt : undefined
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to load Telegram link status';
            this.telegramError = message;
        } finally {
            this.isTelegramLinkLoading = false;
        }
    }

    async createTelegramLink(): Promise<LinkTokenResponse | null> {
        this.isTelegramLinkLoading = true;
        this.telegramError = null;

        try {
            const response = await fetch('/api/telegram/link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ biglotUserId: this.biglotUserId })
            });

            if (!response.ok) {
                const message = await readApiError(response, 'Failed to create Telegram link');
                throw new Error(message);
            }

            const data = (await response.json()) as {
                deepLink?: unknown;
                expiresAt?: unknown;
            };

            if (typeof data.deepLink !== 'string' || typeof data.expiresAt !== 'string') {
                throw new Error('Invalid response from Telegram link API');
            }

            return { deepLink: data.deepLink, expiresAt: data.expiresAt };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to create Telegram link';
            this.telegramError = message;
            return null;
        } finally {
            this.isTelegramLinkLoading = false;
        }
    }

    async unlinkTelegram(): Promise<boolean> {
        this.isTelegramLinkLoading = true;
        this.telegramError = null;

        try {
            const response = await fetch('/api/telegram/unlink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ biglotUserId: this.biglotUserId })
            });

            if (!response.ok) {
                const message = await readApiError(response, 'Failed to unlink Telegram account');
                throw new Error(message);
            }

            const data = (await response.json()) as { ok?: unknown };
            void data;

            await this.refreshTelegramLinkStatus();
            return true;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to unlink Telegram account';
            this.telegramError = message;
            return false;
        } finally {
            this.isTelegramLinkLoading = false;
        }
    }

    // Load list of chats for sidebar
    async loadAllChats() {
        let data: Chat[] | null = null;
        let error: { message: string } | null = null;

        ({ data, error } = await supabase
            .from('chats')
            .select('*')
            .eq('biglot_user_id', this.biglotUserId)
            .order('created_at', { ascending: false }));

        // Backward compatibility for older schema without biglot_user_id.
        if (error && typeof error.message === 'string' && /biglot_user_id/i.test(error.message)) {
            ({ data, error } = await supabase
                .from('chats')
                .select('*')
                .order('created_at', { ascending: false }));
        }

        if (error && typeof error.message === 'string' && error.message.includes('created_at')) {
            ({ data, error } = await supabase
                .from('chats')
                .select('*')
                .eq('biglot_user_id', this.biglotUserId));

            if (error && /biglot_user_id/i.test(error.message)) {
                ({ data, error } = await supabase
                    .from('chats')
                    .select('*'));
            }
        }

        if (error) {
            console.error('Error loading chats:', error);
            this.lastDbError = error.message ?? 'Failed to load chats';
            return;
        }

        if (data) {
            this.allChats = data;
            this.lastDbError = null;
        }
    }

    // Load messages for a specific chat
    async loadChat(chatId: string) {
        this.isLoading = true;
        this.lastDbError = null;

        try {
            let data: JsonObject[] | null = null;
            let error: { message: string } | null = null;

            ({ data, error } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('created_at', { ascending: true }));

            if (error && typeof error.message === 'string' && error.message.includes('created_at')) {
                ({ data, error } = await supabase
                    .from('messages')
                    .select('*')
                    .eq('chat_id', chatId));
            }

            if (error) {
                console.error('Error loading chat messages:', error);
                this.lastDbError = error.message ?? 'Failed to load chat';
                throw new Error(this.lastDbError ?? 'Failed to load chat');
            }

            this.currentChatId = chatId;
            this.messages = (data ?? []).flatMap((row) => {
                const message = parseStoredMessageRow(row);
                return message ? [message] : [];
            });
        } finally {
            this.isLoading = false;
        }
    }

    async newChat() {
        this.messages = [];
        this.currentChatId = null;
    }

    async deleteChat(chatId: string) {
        const { error } = await supabase.from('chats').delete().eq('id', chatId);

        if (error) {
            console.error('Error deleting chat:', error);
            return;
        }

        this.allChats = this.allChats.filter((c) => c.id !== chatId);

        if (this.currentChatId === chatId) {
            this.newChat();
        }
    }

    async sendMessage(content: string, imageUrl?: string, fileAttachment?: FileAttachment) {
        if (!content.trim() && !imageUrl && !fileAttachment) return;

        // Auto-detect mode from prompt keywords
        const detected = detectAgentMode(content);
        if (detected) {
            this.setAgentMode(detected);
        }

        const modeUsed = this.agentMode;

        // 1. Create chat session in Supabase if it doesn't exist.
        if (!this.currentChatId) {
            const titleText = content || fileAttachment?.name || 'Image Analysis';
            let data: Chat | null = null;
            let error: { message: string } | null = null;

            ({ data, error } = await supabase
                .from('chats')
                .insert({
                    title: titleText.slice(0, 30) + (titleText.length > 30 ? '...' : ''),
                    biglot_user_id: this.biglotUserId
                })
                .select()
                .single());

            if (error && typeof error.message === 'string' && /biglot_user_id/i.test(error.message)) {
                ({ data, error } = await supabase
                    .from('chats')
                    .insert({ title: titleText.slice(0, 30) + (titleText.length > 30 ? '...' : '') })
                    .select()
                    .single());
            }

            if (error || !data) {
                console.error('Error creating chat:', error);
                return;
            }

            this.currentChatId = data.id;
            this.allChats = [data, ...this.allChats];
        }

        const chatId = this.currentChatId;

        // 2. Add and save user message.
        const userMsg: Message = {
            role: 'user',
            content,
            image_url: imageUrl,
            file_name: fileAttachment?.name,
            mode: modeUsed,
            channel: 'web'
        };
        this.messages.push(userMsg);
        this.selectedImage = null;
        this.selectedFile = null;

        {
            const basePayload: Record<string, unknown> = {
                chat_id: chatId,
                role: 'user',
                content,
                channel: 'web'
            };
            if (imageUrl) basePayload.image_url = imageUrl;
            if (fileAttachment?.name) basePayload.file_name = fileAttachment.name;
            basePayload.mode = modeUsed;

            let payload = { ...basePayload };
            let insertError: { message: string } | null = null;

            for (let i = 0; i < 4; i += 1) {
                const { error } = await supabase.from('messages').insert(payload);
                if (!error) {
                    insertError = null;
                    break;
                }

                insertError = error;

                if (/image_url/i.test(error.message)) {
                    delete payload.image_url;
                    continue;
                }
                if (/file_name/i.test(error.message)) {
                    delete payload.file_name;
                    continue;
                }
                if (/\bmode\b/i.test(error.message)) {
                    delete payload.mode;
                    continue;
                }
                if (/\bchannel\b/i.test(error.message)) {
                    delete payload.channel;
                    continue;
                }

                break;
            }

            if (insertError) {
                console.error('Error saving user message:', insertError);
                this.lastDbError = insertError.message ?? 'Failed to save message';
            } else {
                this.lastDbError = null;
            }
        }

        this.isLoading = true;

        try {
            this.abortController = new AbortController();

            // Build messages for API — inject file_content into the last user message if a file was attached.
            const apiMessages = fileAttachment
                ? this.messages.map((m, idx) =>
                      idx === this.messages.length - 1 && m.role === 'user'
                          ? { ...m, file_content: fileAttachment.content }
                          : m
                  )
                : this.messages;

            const fetchBody: Record<string, unknown> = {
                chatId,
                biglotUserId: this.biglotUserId,
                messages: apiMessages,
                mode: this.agentMode,
                chatMode: this.chatMode
            };
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(fetchBody),
                signal: this.abortController.signal
            });

            if (!response.ok) throw new Error('Failed to fetch');
            if (!response.body) throw new Error('No response body');

            // Add empty assistant message
            this.messages.push({
                role: 'assistant',
                content: '',
                contentBlocks: [],
                toolCalls: [],
                mode: modeUsed,
                channel: 'web'
            });
            const msgIdx = this.messages.length - 1;

            let fullText = '';
            let allBlocks: ContentBlock[] = [];

            // Parse SSE stream
            for await (const event of parseSSEStream(response.body)) {
                const data = parseJsonObject(event.data);
                if (!data) {
                    continue;
                }

                switch (event.event) {
                    case 'run_start': {
                        this.messages[msgIdx].runId = typeof data.runId === 'string' ? data.runId : null;
                        this.messages[msgIdx].routeType = isAgentRouteType(data.routeType) ? data.routeType : undefined;
                        break;
                    }
                    case 'run_id': {
                        if (typeof data.runId === 'string') {
                            this.messages[msgIdx].runId = data.runId;
                        }
                        break;
                    }
                    case 'text_delta': {
                        const chunk = typeof data.content === 'string' ? data.content : '';
                        if (!chunk) break;
                        fullText += chunk;
                        this.messages[msgIdx].content = fullText;
                        break;
                    }
                    case 'tool_start': {
                        if (typeof data.toolCallId !== 'string' || typeof data.tool !== 'string') {
                            break;
                        }

                        const toolCall: ToolCallStatus = {
                            id: data.toolCallId,
                            name: data.tool,
                            args: isRecord(data.args) ? data.args : undefined,
                            status: 'running',
                            startedAt: Date.now()
                        };
                        this.messages[msgIdx].toolCalls = [
                            ...(this.messages[msgIdx].toolCalls || []),
                            toolCall
                        ];
                        break;
                    }
                    case 'tool_result': {
                        if (typeof data.toolCallId !== 'string') {
                            break;
                        }

                        const toolCalls = this.messages[msgIdx].toolCalls || [];
                        const tc = toolCalls.find((toolCall) => toolCall.id === data.toolCallId);
                        if (tc) {
                            tc.status = data.success === true ? 'complete' : 'error';
                            tc.latencyMs = Date.now() - tc.startedAt;
                            tc.resultSummary =
                                typeof data.textSummary === 'string' ? data.textSummary : undefined;
                        }
                        this.messages[msgIdx].toolCalls = [...toolCalls];

                        const blocks = Array.isArray(data.blocks) ? data.blocks.filter(isContentBlock) : [];
                        if (blocks.length > 0) {
                            allBlocks.push(...blocks);
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'error': {
                        const runningTools = this.messages[msgIdx].toolCalls || [];
                        for (const toolCall of runningTools) {
                            if (toolCall.status === 'running') toolCall.status = 'error';
                        }
                        this.messages[msgIdx].toolCalls = [...runningTools];
                        break;
                    }
                    case 'plan_create': {
                        if (isPlanBlock(data.plan)) {
                            allBlocks.push(data.plan);
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'plan_update': {
                        if (
                            typeof data.planId !== 'string' ||
                            typeof data.stepId !== 'string' ||
                            !PLAN_STEP_STATUSES.has(data.status as PlanBlock['steps'][number]['status'])
                        ) {
                            break;
                        }
                        const nextStatus = data.status as PlanBlock['steps'][number]['status'];

                        const planBlock = allBlocks.find(
                            (block): block is PlanBlock => isPlanBlock(block) && block.planId === data.planId
                        );
                        if (planBlock) {
                            const step = planBlock.steps.find((planStep) => planStep.id === data.stepId);
                            if (step) {
                                step.status = nextStatus;
                                if (typeof data.result === 'string') step.result = data.result;
                                if (nextStatus === 'running') step.startedAt = Date.now();
                                if (nextStatus === 'complete' || nextStatus === 'error') {
                                    step.completedAt = Date.now();
                                }
                            }
                            planBlock.updatedAt = Date.now();
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'plan_complete': {
                        if (
                            typeof data.planId !== 'string' ||
                            (data.status !== 'complete' && data.status !== 'error')
                        ) {
                            break;
                        }

                        const completedPlan = allBlocks.find(
                            (block): block is PlanBlock => isPlanBlock(block) && block.planId === data.planId
                        );
                        if (completedPlan) {
                            completedPlan.status = data.status;
                            completedPlan.updatedAt = Date.now();
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'discussion_start': {
                        if (isDiscussionBlock(data.block)) {
                            allBlocks.push(data.block);
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'discussion_turn_start': {
                        if (
                            typeof data.discussionId !== 'string' ||
                            typeof data.turnId !== 'string' ||
                            typeof data.panelistId !== 'string' ||
                            !DISCUSSION_PANELIST_IDS.has(data.panelistId as DiscussionBlock['turns'][number]['panelistId']) ||
                            typeof data.round !== 'number' ||
                            typeof data.model !== 'string'
                        ) {
                            break;
                        }
                        const nextBlocks = applyDiscussionStreamEvent(allBlocks, {
                            event: 'discussion_turn_start',
                            discussionId: data.discussionId,
                            turnId: data.turnId,
                            panelistId: data.panelistId as DiscussionBlock['turns'][number]['panelistId'],
                            round: data.round,
                            model: data.model
                        }, Date.now());
                        if (nextBlocks !== allBlocks) {
                            allBlocks = nextBlocks;
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'discussion_text_delta': {
                        if (
                            typeof data.discussionId !== 'string' ||
                            typeof data.turnId !== 'string' ||
                            typeof data.panelistId !== 'string' ||
                            !DISCUSSION_PANELIST_IDS.has(data.panelistId as DiscussionBlock['turns'][number]['panelistId']) ||
                            typeof data.round !== 'number' ||
                            typeof data.content !== 'string'
                        ) {
                            break;
                        }

                        const nextBlocks = applyDiscussionStreamEvent(allBlocks, {
                            event: 'discussion_text_delta',
                            discussionId: data.discussionId,
                            turnId: data.turnId,
                            panelistId: data.panelistId as DiscussionBlock['turns'][number]['panelistId'],
                            round: data.round,
                            content: data.content
                        }, Date.now());
                        if (nextBlocks !== allBlocks) {
                            allBlocks = nextBlocks;
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'discussion_turn_end': {
                        if (
                            typeof data.discussionId !== 'string' ||
                            typeof data.turnId !== 'string' ||
                            typeof data.panelistId !== 'string' ||
                            !DISCUSSION_PANELIST_IDS.has(data.panelistId as DiscussionBlock['turns'][number]['panelistId']) ||
                            typeof data.round !== 'number'
                        ) {
                            break;
                        }

                        const nextBlocks = applyDiscussionStreamEvent(allBlocks, {
                            event: 'discussion_turn_end',
                            discussionId: data.discussionId,
                            turnId: data.turnId,
                            panelistId: data.panelistId as DiscussionBlock['turns'][number]['panelistId'],
                            round: data.round
                        }, Date.now());
                        if (nextBlocks !== allBlocks) {
                            allBlocks = nextBlocks;
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'discussion_round_skipped': {
                        if (typeof data.round !== 'number') {
                            break;
                        }

                        const disc = allBlocks.find(isDiscussionBlock);
                        if (disc) {
                            disc.skippedRounds = [...(disc.skippedRounds ?? []), data.round];
                            disc.updatedAt = Date.now();
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'research_report': {
                        if (isContentBlock(data.report) && data.report.type === 'research_report') {
                            allBlocks.push(data.report);
                            this.messages[msgIdx].contentBlocks = [...allBlocks];
                        }
                        break;
                    }
                    case 'done': {
                        if (typeof data.runId === 'string') {
                            this.messages[msgIdx].runId = data.runId;
                        }
                        if (isAgentRouteType(data.routeType)) {
                            this.messages[msgIdx].routeType = data.routeType;
                        }
                        const blocks = Array.isArray(data.contentBlocks)
                            ? data.contentBlocks.filter(isContentBlock)
                            : [];
                        if (blocks.length > 0) {
                            this.messages[msgIdx].contentBlocks = blocks;
                        }
                        break;
                    }
                }
            }

            // 3. Save assistant message after stream finishes.
            {
                const finalBlocks = this.messages[msgIdx].contentBlocks;
                let payload: Record<string, unknown> = {
                    chat_id: chatId,
                    role: 'assistant',
                    content: fullText,
                    mode: modeUsed,
                    channel: 'web'
                };

                // Include content_blocks if we have structured data
                if (finalBlocks && finalBlocks.length > 0) {
                    payload.content_blocks = finalBlocks;
                }
                if (this.messages[msgIdx].runId) {
                    payload.run_id = this.messages[msgIdx].runId;
                }

                let insertError: { message: string } | null = null;
                let insertedId: string | undefined;

                for (let i = 0; i < 4; i += 1) {
                    const { data, error } = await supabase
                        .from('messages')
                        .insert(payload)
                        .select('id')
                        .single();
                    if (!error) {
                        insertedId = typeof data?.id === 'string' ? data.id : undefined;
                        insertError = null;
                        break;
                    }

                    insertError = error;
                    if (/content_blocks/i.test(error.message)) {
                        delete payload.content_blocks;
                        continue;
                    }
                    if (/\bmode\b/i.test(error.message)) {
                        delete payload.mode;
                        continue;
                    }
                    if (/\bchannel\b/i.test(error.message)) {
                        delete payload.channel;
                        continue;
                    }
                    if (/run_id/i.test(error.message)) {
                        delete payload.run_id;
                        continue;
                    }
                    break;
                }

                if (insertError) {
                    console.error('Error saving assistant message:', insertError);
                    this.lastDbError = insertError.message ?? 'Failed to save assistant message';
                } else {
                    if (insertedId) {
                        this.messages[msgIdx].id = insertedId;
                    }
                    this.lastDbError = null;
                }
            }
        } catch (error) {
            // Don't show error message if user intentionally stopped
            if (error instanceof DOMException && error.name === 'AbortError') {
                // Mark discussion block as complete if it was running
                const last = this.messages[this.messages.length - 1];
                if (last?.role === 'assistant' && last.contentBlocks) {
                    const disc = last.contentBlocks.find(
                        (b): b is DiscussionBlock => b.type === 'discussion'
                    );
                    if (disc && disc.status === 'running') {
                        disc.status = 'complete';
                        disc.updatedAt = Date.now();
                        last.contentBlocks = [...last.contentBlocks];
                    }
                }
            } else {
                console.error(error);
                const last = this.messages[this.messages.length - 1];
                if (last?.role === 'assistant' && last.content === '' && (!last.contentBlocks || last.contentBlocks.length === 0)) {
                    last.content = 'Sorry, I encountered an error.';
                } else if (!last || last.role !== 'assistant') {
                    this.messages.push({ role: 'assistant', content: 'Sorry, I encountered an error.', channel: 'web' });
                }
            }
        } finally {
            this.abortController = null;
            this.isLoading = false;
        }
    }

    clearSelectedImage() {
        this.selectedImage = null;
    }

    clearSelectedFile() {
        this.selectedFile = null;
    }

    async submitFeedback(messageIndex: number, feedback: 'up' | 'down'): Promise<boolean> {
        const message = this.messages[messageIndex];
        if (!message || message.role !== 'assistant' || !message.id) return false;

        try {
            const response = await fetch('/api/chat/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messageId: message.id,
                    runId: message.runId,
                    biglotUserId: this.biglotUserId,
                    feedback
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save feedback');
            }

            this.messages[messageIndex].feedback = feedback;
            this.messages = [...this.messages];
            return true;
        } catch (error) {
            console.error('Feedback error:', error);
            return false;
        }
    }
}

export const chatState = new ChatState();

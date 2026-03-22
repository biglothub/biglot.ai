// Scheduled Morning Briefing Tool — T-1208
// Tool: configure_briefing
// Store delivery config in Supabase; deliver via Telegram at scheduled time.

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { assembleDailyBriefing, formatBriefingTelegram } from '../briefing/dailyBriefing';
import { sendTelegramMessage } from '../telegram.server';
import {
	isValidBriefingSection,
	isValidBriefingChannel,
	isValidDeliveryTime,
	normaliseDeliveryTime,
	mapScheduledBriefingRow,
	formatNextDelivery,
	SECTION_DESCRIPTIONS,
	type ScheduledBriefing,
	type ScheduledBriefingRow,
	type CreateBriefingInput,
} from '../data/scheduledBriefing.data';
import type { MetricCardBlock, TableBlock, TextBlock } from '$lib/types/contentBlock';

const DEFAULT_USER     = 'default';
const DEFAULT_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_SECTIONS: ScheduledBriefing['sections'] = ['crypto', 'portfolio'];

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function dbUpsertBriefing(
	userId: string,
	input: CreateBriefingInput
): Promise<ScheduledBriefing | null> {
	const db = getSupabaseAdminClient();

	// Upsert on user_id — one config per user
	const { data, error } = await db
		.from('scheduled_briefings')
		.upsert(
			{
				user_id:       userId,
				delivery_time: input.deliveryTime,
				timezone:      input.timezone     ?? DEFAULT_TIMEZONE,
				watchlist:     input.watchlist    ?? [],
				sections:      input.sections     ?? DEFAULT_SECTIONS,
				channel:       input.channel      ?? 'both',
				active:        true,
				updated_at:    new Date().toISOString(),
			},
			{ onConflict: 'user_id' }
		)
		.select()
		.single();

	if (error || !data) return null;
	return mapScheduledBriefingRow(data as ScheduledBriefingRow);
}

async function dbGetBriefing(userId: string): Promise<ScheduledBriefing | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('scheduled_briefings')
		.select()
		.eq('user_id', userId)
		.maybeSingle();
	if (error || !data) return null;
	return mapScheduledBriefingRow(data as ScheduledBriefingRow);
}

async function dbSetActive(userId: string, active: boolean): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('scheduled_briefings')
		.update({ active, updated_at: new Date().toISOString() })
		.eq('user_id', userId);
	return !error;
}

async function dbMarkSent(userId: string): Promise<void> {
	const db = getSupabaseAdminClient();
	await db
		.from('scheduled_briefings')
		.update({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
		.eq('user_id', userId);
}

async function getTelegramChatId(userId: string): Promise<number | null> {
	try {
		const db = getSupabaseAdminClient();
		const { data } = await db
			.from('telegram_links')
			.select('telegram_chat_id')
			.eq('biglot_user_id', userId)
			.eq('is_active', true)
			.limit(1);
		const chatId = (data as { telegram_chat_id: number }[] | null)?.[0]?.telegram_chat_id;
		return typeof chatId === 'number' ? chatId : null;
	} catch {
		return null;
	}
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

async function deliverBriefing(
	briefing: ScheduledBriefing,
	markSent = true
): Promise<{ telegramSent: boolean; preview: string }> {
	// Build the briefing content
	const dailyBriefing = await assembleDailyBriefing(briefing.userId, 5);
	const preview = formatBriefingTelegram(dailyBriefing);

	let telegramSent = false;

	const shouldSendTelegram = briefing.channel === 'telegram' || briefing.channel === 'both';
	if (shouldSendTelegram) {
		const chatId = await getTelegramChatId(briefing.userId);
		if (chatId) {
			try {
				await sendTelegramMessage(chatId, preview, { parseMode: 'HTML' });
				telegramSent = true;
			} catch {
				// Telegram send failed — continue silently
			}
		}
	}

	if (markSent) {
		await dbMarkSent(briefing.userId);
	}

	return { telegramSent, preview };
}

// ─── Content Block Builders ───────────────────────────────────────────────────

function buildStatusCard(briefing: ScheduledBriefing): MetricCardBlock {
	return {
		type:  'metric_card',
		title: 'Morning Briefing Schedule',
		metrics: [
			{
				label:     'Next Delivery',
				value:     formatNextDelivery(briefing),
				direction: 'neutral',
			},
			{
				label:     'Status',
				value:     briefing.active ? 'Active' : 'Paused',
				direction: briefing.active ? 'up' : 'neutral',
			},
			{
				label:     'Channel',
				value:     briefing.channel === 'both' ? 'In-App + Telegram' : briefing.channel === 'telegram' ? 'Telegram only' : 'In-App only',
				direction: 'neutral',
			},
			{
				label:     'Last Sent',
				value:     briefing.lastSentAt
					? briefing.lastSentAt.slice(0, 16).replace('T', ' ') + ' UTC'
					: 'Never',
				direction: 'neutral',
			},
		],
	};
}

function buildSectionsTable(briefing: ScheduledBriefing): TableBlock {
	return {
		type:    'table',
		title:   'Configured Sections',
		headers: ['Section', 'Description', 'Enabled'],
		rows:    (['crypto', 'macro', 'gold', 'portfolio'] as const).map(s => [
			s,
			SECTION_DESCRIPTIONS[s],
			briefing.sections.includes(s) ? 'Yes' : 'No',
		]),
	};
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'configure_briefing',
	description:
		'Configure an automated daily morning briefing with scheduled Telegram delivery. Actions: configure (set delivery time, timezone, sections, channel), status (view current config and next delivery time), pause (stop deliveries), resume (restart deliveries), deliver_now (send immediately as a test). The briefing covers crypto top movers, macro indicators, gold price, and paper portfolio PnL.',
	parameters: {
		type: 'object',
		properties: {
			action: {
				type:        'string',
				enum:        ['configure', 'status', 'pause', 'resume', 'deliver_now'],
				description: 'Action to perform',
			},
			delivery_time: {
				type:        'string',
				description: 'Delivery time in HH:MM 24h format e.g. "07:00". Required for configure.',
			},
			timezone: {
				type:        'string',
				description: 'IANA timezone e.g. "Asia/Bangkok" (ICT), "UTC", "America/New_York". Default: Asia/Bangkok.',
			},
			sections: {
				type:        'array',
				items:       { type: 'string', enum: ['crypto', 'macro', 'gold', 'portfolio'] },
				description: 'Briefing sections to include. Default: ["crypto", "portfolio"].',
			},
			channel: {
				type:        'string',
				enum:        ['in_app', 'telegram', 'both'],
				description: 'Delivery channel. Default: "both".',
			},
			watchlist: {
				type:        'array',
				items:       { type: 'string' },
				description: 'Custom symbols to watch (e.g. ["BTCUSDT", "ETHUSDT"]).',
			},
			user_id: {
				type:        'string',
				description: 'User ID (defaults to "default")',
			},
		},
		required: ['action'],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		const action = String(args.action ?? '');
		const userId = typeof args.user_id === 'string' && args.user_id ? args.user_id : DEFAULT_USER;

		// ── CONFIGURE ─────────────────────────────────────────────────────────
		if (action === 'configure') {
			const rawTime = args.delivery_time;
			if (!rawTime || typeof rawTime !== 'string' || !isValidDeliveryTime(rawTime)) {
				return {
					success:       false,
					contentBlocks: [{ type: 'error', message: 'delivery_time is required in HH:MM format (e.g. "07:00").', tool: 'configure_briefing' }],
					textSummary:   'Error: delivery_time required in HH:MM format.',
				};
			}

			const deliveryTime = normaliseDeliveryTime(rawTime);
			const timezone     = typeof args.timezone === 'string' && args.timezone ? args.timezone : DEFAULT_TIMEZONE;

			const rawSections = Array.isArray(args.sections) ? args.sections : DEFAULT_SECTIONS;
			const sections    = rawSections.filter(isValidBriefingSection);
			if (sections.length === 0) {
				return {
					success:       false,
					contentBlocks: [{ type: 'error', message: 'At least one valid section required: crypto, macro, gold, portfolio.', tool: 'configure_briefing' }],
					textSummary:   'Error: no valid sections provided.',
				};
			}

			const channel   = isValidBriefingChannel(args.channel) ? args.channel : 'both';
			const watchlist = Array.isArray(args.watchlist)
				? (args.watchlist as unknown[]).filter((s): s is string => typeof s === 'string').map(s => s.toUpperCase())
				: [];

			const input: CreateBriefingInput = { deliveryTime, timezone, sections, channel, watchlist };
			const briefing = await dbUpsertBriefing(userId, input);

			if (!briefing) {
				return {
					success:       false,
					contentBlocks: [{ type: 'error', message: 'Failed to save briefing config. Make sure the scheduled_briefings table exists in Supabase.', tool: 'configure_briefing' }],
					textSummary:   'Error: could not save briefing config.',
				};
			}

			toolCache.set(toolCache.generateKey('configure_briefing_status', { userId }), null as unknown as ToolResult, 0);

			return {
				success:       true,
				contentBlocks: [buildStatusCard(briefing), buildSectionsTable(briefing)],
				textSummary:   `Morning briefing configured: ${deliveryTime} ${timezone}, sections: ${sections.join(', ')}, channel: ${channel}. Next delivery: ${formatNextDelivery(briefing)}.`,
			};
		}

		// ── STATUS ────────────────────────────────────────────────────────────
		if (action === 'status') {
			const cacheKey = toolCache.generateKey('configure_briefing_status', { userId });
			const cached   = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const briefing = await dbGetBriefing(userId);

			if (!briefing) {
				return {
					success:       true,
					contentBlocks: [{ type: 'text', content: 'No briefing configured. Use `configure_briefing` with action=configure to set one up.' }],
					textSummary:   'No briefing configured. Use configure_briefing action=configure to set a delivery schedule.',
				};
			}

			const result: ToolResult = {
				success:       true,
				contentBlocks: [buildStatusCard(briefing), buildSectionsTable(briefing)],
				textSummary:   `Briefing ${briefing.active ? 'active' : 'paused'}. Scheduled: ${briefing.deliveryTime} ${briefing.timezone}, sections: ${briefing.sections.join(', ')}. Next: ${formatNextDelivery(briefing)}.`,
			};
			toolCache.set(cacheKey, result, 60_000); // 1 min cache
			return result;
		}

		// ── PAUSE ─────────────────────────────────────────────────────────────
		if (action === 'pause') {
			const ok = await dbSetActive(userId, false);
			toolCache.set(toolCache.generateKey('configure_briefing_status', { userId }), null as unknown as ToolResult, 0);

			if (!ok) {
				return {
					success:       false,
					contentBlocks: [{ type: 'error', message: 'Failed to pause briefing. No config found for this user.', tool: 'configure_briefing' }],
					textSummary:   'Error: could not pause briefing.',
				};
			}

			return {
				success:       true,
				contentBlocks: [{ type: 'metric_card', title: 'Morning Briefing', metrics: [{ label: 'Status', value: 'Paused', direction: 'neutral' }] }],
				textSummary:   'Morning briefing paused. Use action=resume to restart deliveries.',
			};
		}

		// ── RESUME ────────────────────────────────────────────────────────────
		if (action === 'resume') {
			const ok = await dbSetActive(userId, true);
			toolCache.set(toolCache.generateKey('configure_briefing_status', { userId }), null as unknown as ToolResult, 0);

			if (!ok) {
				return {
					success:       false,
					contentBlocks: [{ type: 'error', message: 'Failed to resume briefing. No config found — use action=configure first.', tool: 'configure_briefing' }],
					textSummary:   'Error: could not resume briefing.',
				};
			}

			const briefing = await dbGetBriefing(userId);
			return {
				success:       true,
				contentBlocks: [
					{ type: 'metric_card', title: 'Morning Briefing', metrics: [
						{ label: 'Status', value: 'Active', direction: 'up' },
						...(briefing ? [{ label: 'Next Delivery', value: formatNextDelivery(briefing), direction: 'neutral' as const }] : []),
					]},
				],
				textSummary:   `Morning briefing resumed.${briefing ? ` Next delivery: ${formatNextDelivery(briefing)}.` : ''}`,
			};
		}

		// ── DELIVER_NOW ───────────────────────────────────────────────────────
		if (action === 'deliver_now') {
			const briefing = await dbGetBriefing(userId);

			if (!briefing) {
				return {
					success:       false,
					contentBlocks: [{ type: 'error', message: 'No briefing configured. Use action=configure first.', tool: 'configure_briefing' }],
					textSummary:   'Error: no briefing config found.',
				};
			}

			const { telegramSent, preview } = await deliverBriefing(briefing, true);

			const metricCard: MetricCardBlock = {
				type:  'metric_card',
				title: 'Briefing Delivered',
				metrics: [
					{ label: 'Sections',       value: briefing.sections.join(', '),        direction: 'neutral' },
					{ label: 'Telegram',       value: telegramSent ? 'Sent' : 'Not linked', direction: telegramSent ? 'up' : 'neutral' },
					{ label: 'Delivered At',   value: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', direction: 'neutral' },
				],
			};

			const previewBlock: TextBlock = {
				type:    'text',
				content: `**Briefing Preview:**\n\n${preview.replace(/<[^>]+>/g, '')}`,
			};

			toolCache.set(toolCache.generateKey('configure_briefing_status', { userId }), null as unknown as ToolResult, 0);

			return {
				success:       true,
				contentBlocks: [metricCard, previewBlock],
				textSummary:   `Morning briefing delivered.${telegramSent ? ' Telegram message sent.' : ' No Telegram linked.'} Sections: ${briefing.sections.join(', ')}.`,
			};
		}

		// ── Unknown action ────────────────────────────────────────────────────
		return {
			success:       false,
			contentBlocks: [{ type: 'error', message: `Unknown action: "${action}". Use configure, status, pause, resume, or deliver_now.`, tool: 'configure_briefing' }],
			textSummary:   `Error: unknown action "${action}".`,
		};
	},
});

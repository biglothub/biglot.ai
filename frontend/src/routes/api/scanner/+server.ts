// Scanner API endpoint — T-402
// POST /api/scanner — trigger a watchlist scan; returns hits as JSON
// Can be called by Vercel cron (vercel.json: { "crons": [{ "path": "/api/scanner", "schedule": "0 */4 * * *" }] })

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scanWatchlist, DEFAULT_WATCHLIST } from '$lib/server/scanner/signalScanner';
import { sendTelegramMessage } from '$lib/server/telegram.server';

const SCANNER_SECRET = process.env.SCANNER_SECRET ?? '';

export const POST: RequestHandler = async ({ request }) => {
	// Optional: protect endpoint with a shared secret
	const authHeader = request.headers.get('x-scanner-secret') ?? '';
	if (SCANNER_SECRET && authHeader !== SCANNER_SECRET) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let body: {
		symbols?: string[];
		interval?: string;
		minConfluenceScore?: number;
		telegramChatId?: number;
	} = {};

	try {
		body = await request.json();
	} catch {
		// Use defaults if no body
	}

	const config = {
		symbols: Array.isArray(body.symbols) && body.symbols.length > 0
			? body.symbols
			: DEFAULT_WATCHLIST,
		interval: body.interval ?? '4h',
		minConfluenceScore: body.minConfluenceScore ?? 4,
	};

	const report = await scanWatchlist(config);

	// Optionally notify via Telegram
	if (body.telegramChatId && report.hits.length > 0) {
		const hitSummaries = report.hits.map(h =>
			`<b>${h.symbol}</b> ${h.direction.toUpperCase()} (score ${h.confluenceScore}) on ${h.interval}`
		);
		const msg = `🔔 <b>Signal Scanner</b>\n${hitSummaries.join('\n')}\n\nScanned ${report.scanned} assets in ${report.durationMs}ms`;
		try {
			await sendTelegramMessage(body.telegramChatId, msg, { parseMode: 'HTML' });
		} catch {
			// Non-fatal: Telegram send failure doesn't break the response
		}
	}

	return json({
		hits: report.hits.length,
		scanned: report.scanned,
		durationMs: report.durationMs,
		timestamp: report.timestamp,
		results: report.hits.map(h => ({
			symbol: h.symbol,
			direction: h.direction,
			confluenceScore: h.confluenceScore,
			interval: h.interval,
		})),
		errors: report.errors,
	});
};

// GET returns scanner status / last config
export const GET: RequestHandler = async () => {
	return json({
		status: 'ready',
		defaultWatchlist: DEFAULT_WATCHLIST,
		defaultInterval: '4h',
		defaultMinScore: 4,
	});
};

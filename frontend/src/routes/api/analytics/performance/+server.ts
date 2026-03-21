// Performance Analytics API — T-403
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listClosedTrades } from '$lib/server/portfolio/tracker';
import { buildPerformanceData } from '$lib/server/analytics/performanceData';

export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get('user_id') ?? 'default';
	const startEquity = Number(url.searchParams.get('start_equity') ?? '10000');
	const limit = Math.min(500, Number(url.searchParams.get('limit') ?? '200'));

	const trades = await listClosedTrades(userId, limit);
	const data = buildPerformanceData(trades, startEquity);

	return json(data);
};

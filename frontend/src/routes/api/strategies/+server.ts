// Strategy Marketplace API — T-504
// GET  /api/strategies           — list published strategies
// POST /api/strategies           — publish a strategy
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPublished, publishStrategy } from '$lib/server/marketplace/marketplace';

export const GET: RequestHandler = async ({ url }) => {
	const tag = url.searchParams.get('tag') ?? undefined;
	const search = url.searchParams.get('search') ?? undefined;
	const sortBy = (url.searchParams.get('sort') ?? 'newest') as 'newest' | 'top_rated' | 'most_forked';
	const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '50')));

	try {
		const strategies = await listPublished({ tag, search, sortBy, limit });
		return json({ strategies });
	} catch (err) {
		console.error('[api/strategies GET]', err);
		throw error(500, 'Failed to fetch strategies');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { userId, strategyId, title, description, tags } = body as Record<string, unknown>;
	if (typeof userId !== 'string' || !userId) throw error(400, 'userId is required');
	if (typeof strategyId !== 'string' || !strategyId) throw error(400, 'strategyId is required');

	try {
		const published = await publishStrategy(userId, {
			strategyId,
			title: typeof title === 'string' ? title : undefined,
			description: typeof description === 'string' ? description : undefined,
			tags: Array.isArray(tags) ? (tags as string[]) : [],
		});
		return json({ published }, { status: 201 });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Failed to publish strategy';
		throw error(400, msg);
	}
};

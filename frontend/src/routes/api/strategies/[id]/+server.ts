// Strategy Marketplace API — T-504
// GET  /api/strategies/[id]         — get published strategy
// POST /api/strategies/[id]/fork    — handled below via action param
// POST /api/strategies/[id]/rate    — handled below via action param
// DELETE /api/strategies/[id]       — unpublish
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getPublished,
	forkStrategy,
	rateStrategy,
	unpublishStrategy,
	listRatings,
} from '$lib/server/marketplace/marketplace';

export const GET: RequestHandler = async ({ params, url }) => {
	const action = url.searchParams.get('action');
	const { id } = params;

	if (action === 'ratings') {
		const ratings = await listRatings(id);
		return json({ ratings });
	}

	const strategy = await getPublished(id);
	if (!strategy) throw error(404, 'Strategy not found');
	return json({ strategy });
};

export const POST: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const { action, userId, rating, review } = body as Record<string, unknown>;
	if (typeof userId !== 'string' || !userId) throw error(400, 'userId is required');

	if (action === 'fork') {
		try {
			const strategy = await forkStrategy(userId, id);
			return json({ strategy }, { status: 201 });
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Fork failed';
			throw error(400, msg);
		}
	}

	if (action === 'rate') {
		if (typeof rating !== 'number') throw error(400, 'rating (1-5) is required');
		try {
			const result = await rateStrategy(
				userId,
				id,
				rating,
				typeof review === 'string' ? review : undefined
			);
			return json({ rating: result });
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Rating failed';
			throw error(400, msg);
		}
	}

	throw error(400, 'action must be "fork" or "rate"');
};

export const DELETE: RequestHandler = async ({ params, request }) => {
	const { id } = params;
	const body = await request.json().catch(() => null);
	const userId = typeof body?.userId === 'string' ? body.userId : null;
	if (!userId) throw error(400, 'userId is required');

	try {
		await unpublishStrategy(userId, id);
		return json({ success: true });
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Unpublish failed';
		throw error(400, msg);
	}
};

// Strategy Marketplace — T-504
// Publish, browse, fork, and rate community strategies

import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { createStrategy, getStrategy } from '../strategy.server';
import type { Strategy } from '$lib/types/strategy';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PublishedStrategy = {
	id: string;
	strategyId: string;
	authorUserId: string;
	title: string;
	description: string | null;
	tags: string[];
	forkCount: number;
	avgRating: number | null;
	ratingCount: number;
	definition: Strategy;
	createdAt: string;
};

export type StrategyRating = {
	id: string;
	publishedStrategyId: string;
	userId: string;
	rating: number;
	review: string | null;
	createdAt: string;
};

export type PublishInput = {
	strategyId: string;
	title?: string;
	description?: string;
	tags?: string[];
};

export type ListPublishedOptions = {
	tag?: string;
	search?: string;
	sortBy?: 'newest' | 'top_rated' | 'most_forked';
	limit?: number;
};

// ─── Row mappers ──────────────────────────────────────────────────────────────

type PublishedRow = {
	id: string;
	strategy_id: string;
	author_user_id: string;
	title: string;
	description: string | null;
	tags: string[];
	fork_count: number;
	avg_rating: string | null;
	rating_count: number;
	definition: Strategy;
	created_at: string;
};

type RatingRow = {
	id: string;
	published_strategy_id: string;
	user_id: string;
	rating: number;
	review: string | null;
	created_at: string;
};

function rowToPublished(row: PublishedRow): PublishedStrategy {
	return {
		id: row.id,
		strategyId: row.strategy_id,
		authorUserId: row.author_user_id,
		title: row.title,
		description: row.description,
		tags: row.tags ?? [],
		forkCount: row.fork_count,
		avgRating: row.avg_rating !== null ? Number(row.avg_rating) : null,
		ratingCount: row.rating_count,
		definition: row.definition,
		createdAt: row.created_at,
	};
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Recompute the average rating from a list of individual ratings.
 * Returns null when there are no ratings.
 */
export function computeAvgRating(ratings: number[]): number | null {
	if (ratings.length === 0) return null;
	return ratings.reduce((s, r) => s + r, 0) / ratings.length;
}

/**
 * Format a tag array for display: lowercase, sorted, max 10 tags, max 32 chars each.
 */
export function normaliseTags(raw: string[]): string[] {
	return raw
		.map(t => t.toLowerCase().trim().slice(0, 32))
		.filter(t => t.length > 0)
		.slice(0, 10);
}

// ─── Publish ──────────────────────────────────────────────────────────────────

/**
 * Publish a private strategy to the marketplace.
 * Fails if the strategy does not belong to the user.
 */
export async function publishStrategy(
	userId: string,
	input: PublishInput
): Promise<PublishedStrategy> {
	const strategy = await getStrategy(userId, input.strategyId);
	if (!strategy) throw new Error(`Strategy not found or access denied: ${input.strategyId}`);

	const title = input.title ?? strategy.name;
	if (!title || title.trim().length === 0) throw new Error('Title is required.');

	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('published_strategies')
		.insert({
			strategy_id: input.strategyId,
			author_user_id: userId,
			title: title.trim().slice(0, 100),
			description: input.description ?? strategy.description ?? null,
			tags: normaliseTags(input.tags ?? []),
			definition: strategy,
		})
		.select('*')
		.single();

	if (error || !data) throw new Error(`Failed to publish strategy: ${error?.message ?? 'no data'}`);
	return rowToPublished(data as PublishedRow);
}

// ─── Browse ───────────────────────────────────────────────────────────────────

export async function listPublished(opts: ListPublishedOptions = {}): Promise<PublishedStrategy[]> {
	const { tag, search, sortBy = 'newest', limit = 50 } = opts;

	const supabase = getSupabaseAdminClient();
	let query = supabase
		.from('published_strategies')
		.select('*');

	if (tag) {
		query = query.contains('tags', [tag]);
	}
	if (search) {
		query = query.ilike('title', `%${search}%`);
	}

	if (sortBy === 'top_rated') {
		query = query.order('avg_rating', { ascending: false, nullsFirst: false });
	} else if (sortBy === 'most_forked') {
		query = query.order('fork_count', { ascending: false });
	} else {
		query = query.order('created_at', { ascending: false });
	}

	const { data, error } = await query.limit(limit);
	if (error) throw new Error(`Failed to list published strategies: ${error.message}`);
	return ((data as PublishedRow[]) ?? []).map(rowToPublished);
}

export async function getPublished(id: string): Promise<PublishedStrategy | null> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('published_strategies')
		.select('*')
		.eq('id', id)
		.single();

	if (error || !data) return null;
	return rowToPublished(data as PublishedRow);
}

// ─── Fork ─────────────────────────────────────────────────────────────────────

/**
 * Fork a published strategy into the user's private strategies.
 * Returns the new private Strategy.
 */
export async function forkStrategy(userId: string, publishedId: string): Promise<Strategy> {
	const published = await getPublished(publishedId);
	if (!published) throw new Error(`Published strategy not found: ${publishedId}`);

	const forked: Strategy = {
		...published.definition,
		id: undefined,
		biglotUserId: userId,
		name: `${published.title} (fork)`,
		version: 1,
		isActive: false,
		createdAt: undefined,
		updatedAt: undefined,
	};

	const newStrategy = await createStrategy(forked);

	// Increment fork count
	const supabase = getSupabaseAdminClient();
	await supabase
		.from('published_strategies')
		.update({ fork_count: published.forkCount + 1 })
		.eq('id', publishedId);

	return newStrategy;
}

// ─── Unpublish ────────────────────────────────────────────────────────────────

export async function unpublishStrategy(userId: string, publishedId: string): Promise<void> {
	const supabase = getSupabaseAdminClient();
	const { error } = await supabase
		.from('published_strategies')
		.delete()
		.eq('id', publishedId)
		.eq('author_user_id', userId);

	if (error) throw new Error(`Failed to unpublish strategy: ${error.message}`);
}

// ─── Rate ─────────────────────────────────────────────────────────────────────

/**
 * Submit or update a rating (1-5) for a published strategy.
 * Recomputes avg_rating + rating_count on the parent row.
 */
export async function rateStrategy(
	userId: string,
	publishedId: string,
	rating: number,
	review?: string
): Promise<StrategyRating> {
	if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
		throw new Error('Rating must be an integer between 1 and 5.');
	}

	const supabase = getSupabaseAdminClient();

	// Upsert rating
	const { data: ratingData, error: ratingError } = await supabase
		.from('strategy_ratings')
		.upsert({
			published_strategy_id: publishedId,
			user_id: userId,
			rating,
			review: review ?? null,
		}, { onConflict: 'published_strategy_id,user_id' })
		.select('*')
		.single();

	if (ratingError || !ratingData) {
		throw new Error(`Failed to save rating: ${ratingError?.message ?? 'no data'}`);
	}

	// Recompute avg from all ratings for this strategy
	const { data: allRatings, error: allErr } = await supabase
		.from('strategy_ratings')
		.select('rating')
		.eq('published_strategy_id', publishedId);

	if (!allErr && allRatings) {
		const values = (allRatings as { rating: number }[]).map(r => r.rating);
		const avg = computeAvgRating(values);
		await supabase
			.from('published_strategies')
			.update({ avg_rating: avg, rating_count: values.length })
			.eq('id', publishedId);
	}

	const r = ratingData as RatingRow;
	return {
		id: r.id,
		publishedStrategyId: r.published_strategy_id,
		userId: r.user_id,
		rating: r.rating,
		review: r.review,
		createdAt: r.created_at,
	};
}

export async function listRatings(publishedId: string): Promise<StrategyRating[]> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('strategy_ratings')
		.select('*')
		.eq('published_strategy_id', publishedId)
		.order('created_at', { ascending: false });

	if (error) return [];
	return ((data as RatingRow[]) ?? []).map(r => ({
		id: r.id,
		publishedStrategyId: r.published_strategy_id,
		userId: r.user_id,
		rating: r.rating,
		review: r.review,
		createdAt: r.created_at,
	}));
}

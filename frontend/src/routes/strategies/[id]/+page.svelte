<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import type { PublishedStrategy, StrategyRating } from '$lib/server/marketplace/marketplace';

	const id = $derived($page.params.id);

	let strategy = $state<PublishedStrategy | null>(null);
	let ratings = $state<StrategyRating[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let userRating = $state(0);
	let userReview = $state('');
	let submittingRating = $state(false);

	async function load() {
		loading = true;
		error = null;
		try {
			const [stratRes, ratingsRes] = await Promise.all([
				fetch(`/api/strategies/${id}`),
				fetch(`/api/strategies/${id}?action=ratings`),
			]);
			if (!stratRes.ok) throw new Error('Strategy not found');
			const stratJson = await stratRes.json() as { strategy: PublishedStrategy };
			strategy = stratJson.strategy;
			if (ratingsRes.ok) {
				const rJson = await ratingsRes.json() as { ratings: StrategyRating[] };
				ratings = rJson.ratings;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load strategy';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function handleFork() {
		const userId = 'default';
		const res = await fetch(`/api/strategies/${id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'fork', userId }),
		});
		if (res.ok) alert('Strategy forked successfully!');
		else alert('Fork failed.');
	}

	async function submitRating() {
		if (userRating < 1 || userRating > 5) return;
		submittingRating = true;
		try {
			const res = await fetch(`/api/strategies/${id}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'rate', userId: 'default', rating: userRating, review: userReview }),
			});
			if (res.ok) { await load(); userRating = 0; userReview = ''; }
			else alert('Failed to submit rating.');
		} finally {
			submittingRating = false;
		}
	}

	function stars(n: number): string {
		return '★'.repeat(n) + '☆'.repeat(5 - n);
	}
</script>

<svelte:head>
	<title>{strategy?.title ?? 'Strategy'} — BigLot.ai Marketplace</title>
</svelte:head>

<main class="min-h-screen bg-[#0d0d1a] text-white p-6">
	<div class="max-w-3xl mx-auto">
		<a href="/strategies" class="text-white/40 hover:text-white/70 text-sm mb-6 inline-block">← Back to Marketplace</a>

		{#if loading}
			<div class="flex items-center justify-center py-16">
				<div class="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
			</div>
		{:else if error}
			<div class="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400">{error}</div>
		{:else if strategy}
			<!-- Strategy header -->
			<div class="bg-[#1a1a2e] border border-white/10 rounded-xl p-6 mb-6">
				<div class="flex items-start justify-between gap-4 mb-4">
					<div>
						<h1 class="text-xl font-bold text-white">{strategy.title}</h1>
						<p class="text-white/40 text-sm mt-1">by {strategy.authorUserId.slice(0, 12)}… · {strategy.definition.timeframe} · {strategy.forkCount} forks</p>
					</div>
					<button
						onclick={handleFork}
						class="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
					>
						Fork Strategy
					</button>
				</div>

				{#if strategy.description}
					<p class="text-white/70 text-sm mb-4">{strategy.description}</p>
				{/if}

				{#if strategy.tags.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each strategy.tags as tag}
							<span class="bg-white/5 text-white/50 text-xs px-2 py-0.5 rounded-full">{tag}</span>
						{/each}
					</div>
				{/if}

				<div class="mt-4 pt-4 border-t border-white/5 flex items-center gap-4 text-sm">
					<span class="text-yellow-400">{stars(Math.round(strategy.avgRating ?? 0))}</span>
					<span class="text-white/40">{strategy.avgRating?.toFixed(2) ?? '—'} ({strategy.ratingCount} ratings)</span>
				</div>
			</div>

			<!-- Rate this strategy -->
			<div class="bg-[#1a1a2e] border border-white/10 rounded-xl p-5 mb-6">
				<h2 class="text-white font-semibold mb-3">Rate this Strategy</h2>
				<div class="flex gap-1 mb-3">
					{#each [1, 2, 3, 4, 5] as n}
						<button
							onclick={() => { userRating = n; }}
							class="text-2xl transition-colors {userRating >= n ? 'text-yellow-400' : 'text-white/20 hover:text-yellow-400/60'}"
						>★</button>
					{/each}
				</div>
				<textarea
					bind:value={userReview}
					placeholder="Write a review (optional)"
					rows="2"
					class="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-blue-500/50 resize-none mb-3"
				></textarea>
				<button
					onclick={submitRating}
					disabled={userRating === 0 || submittingRating}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg text-sm transition-colors"
				>
					{submittingRating ? 'Submitting...' : 'Submit Rating'}
				</button>
			</div>

			<!-- Reviews -->
			{#if ratings.length > 0}
				<div class="bg-[#1a1a2e] border border-white/10 rounded-xl p-5">
					<h2 class="text-white font-semibold mb-4">Reviews ({ratings.length})</h2>
					<div class="flex flex-col gap-3">
						{#each ratings as r (r.id)}
							<div class="border-b border-white/5 pb-3 last:border-0">
								<div class="flex items-center gap-2 mb-1">
									<span class="text-yellow-400 text-sm">{stars(r.rating)}</span>
									<span class="text-white/30 text-xs">{r.userId.slice(0, 8)}…</span>
								</div>
								{#if r.review}
									<p class="text-white/60 text-sm">{r.review}</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>
</main>

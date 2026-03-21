<script lang="ts">
	import type { PublishedStrategy } from '$lib/server/marketplace/marketplace';

	let { strategy, onFork }: {
		strategy: PublishedStrategy;
		onFork?: (id: string) => void;
	} = $props();

	function stars(rating: number | null): string {
		if (rating === null) return '—';
		const full = Math.round(rating);
		return '★'.repeat(full) + '☆'.repeat(5 - full);
	}
</script>

<div class="bg-[#1a1a2e] border border-white/10 rounded-xl p-4 flex flex-col gap-3 hover:border-white/20 transition-colors">
	<!-- Header -->
	<div class="flex items-start justify-between gap-2">
		<div class="flex-1 min-w-0">
			<h3 class="text-white font-semibold truncate">{strategy.title}</h3>
			<p class="text-white/40 text-xs mt-0.5">by {strategy.authorUserId.slice(0, 8)}…</p>
		</div>
		<div class="flex flex-col items-end gap-1 shrink-0">
			<span class="text-yellow-400 text-sm font-mono">{stars(strategy.avgRating)}</span>
			<span class="text-white/30 text-xs">{strategy.ratingCount} ratings</span>
		</div>
	</div>

	<!-- Description -->
	{#if strategy.description}
		<p class="text-white/60 text-sm line-clamp-2">{strategy.description}</p>
	{/if}

	<!-- Tags -->
	{#if strategy.tags.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each strategy.tags as tag}
				<span class="bg-white/5 text-white/50 text-xs px-2 py-0.5 rounded-full">{tag}</span>
			{/each}
		</div>
	{/if}

	<!-- Meta + action -->
	<div class="flex items-center justify-between pt-1 border-t border-white/5">
		<div class="flex gap-3 text-white/30 text-xs">
			<span>{strategy.definition.timeframe}</span>
			<span>{strategy.forkCount} forks</span>
		</div>
		{#if onFork}
			<button
				onclick={() => onFork?.(strategy.id)}
				class="text-xs bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 px-3 py-1 rounded-lg transition-colors"
			>
				Fork
			</button>
		{/if}
	</div>
</div>

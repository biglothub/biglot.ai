<script lang="ts">
	import type { PublishedStrategy } from '$lib/server/marketplace/marketplace';
	import StrategyCard from './StrategyCard.svelte';

	let { strategies, loading = false, onFork }: {
		strategies: PublishedStrategy[];
		loading?: boolean;
		onFork?: (id: string) => void;
	} = $props();
</script>

{#if loading}
	<div class="flex items-center justify-center py-16">
		<div class="w-6 h-6 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
	</div>
{:else if strategies.length === 0}
	<div class="text-center py-16 text-white/30">
		<p class="text-4xl mb-3">📭</p>
		<p>No strategies found</p>
	</div>
{:else}
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each strategies as strategy (strategy.id)}
			<StrategyCard {strategy} {onFork} />
		{/each}
	</div>
{/if}

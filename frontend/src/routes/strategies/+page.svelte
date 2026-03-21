<script lang="ts">
	import { onMount } from 'svelte';
	import StrategyList from '$lib/components/strategies/StrategyList.svelte';
	import type { PublishedStrategy } from '$lib/server/marketplace/marketplace';

	let strategies = $state<PublishedStrategy[]>([]);
	let loading = $state(true);
	let search = $state('');
	let sortBy = $state<'newest' | 'top_rated' | 'most_forked'>('newest');
	let error = $state<string | null>(null);

	async function load() {
		loading = true;
		error = null;
		try {
			const params = new URLSearchParams({ sort: sortBy, limit: '50' });
			if (search.trim()) params.set('search', search.trim());
			const res = await fetch(`/api/strategies?${params}`);
			if (!res.ok) throw new Error('Failed to load strategies');
			const json = await res.json() as { strategies: PublishedStrategy[] };
			strategies = json.strategies;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Error loading strategies';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function handleFork(id: string) {
		const userId = 'default'; // placeholder — replace with real auth context
		const res = await fetch(`/api/strategies/${id}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ action: 'fork', userId }),
		});
		if (res.ok) {
			alert('Strategy forked! Find it in your private strategies.');
		} else {
			const data = await res.json().catch(() => ({})) as Record<string, unknown>;
			alert(`Fork failed: ${data.message ?? 'unknown error'}`);
		}
	}
</script>

<svelte:head>
	<title>Strategy Marketplace — BigLot.ai</title>
</svelte:head>

<main class="min-h-screen bg-[#0d0d1a] text-white p-6">
	<div class="max-w-6xl mx-auto">
		<!-- Header -->
		<div class="mb-8">
			<h1 class="text-2xl font-bold text-white mb-1">Strategy Marketplace</h1>
			<p class="text-white/40">Browse, fork, and rate community trading strategies</p>
		</div>

		<!-- Filters -->
		<div class="flex flex-wrap gap-3 mb-6">
			<input
				type="text"
				placeholder="Search strategies..."
				bind:value={search}
				onkeydown={(e) => e.key === 'Enter' && load()}
				class="bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/30 flex-1 min-w-48 focus:outline-none focus:border-blue-500/50"
			/>
			<div class="flex gap-2">
				{#each [['newest', 'Newest'], ['top_rated', 'Top Rated'], ['most_forked', 'Most Forked']] as [val, label]}
					<button
						onclick={() => { sortBy = val as typeof sortBy; load(); }}
						class="px-3 py-2 rounded-lg text-sm transition-colors {sortBy === val
							? 'bg-blue-600 text-white'
							: 'bg-white/5 text-white/50 hover:bg-white/10'}"
					>
						{label}
					</button>
				{/each}
			</div>
			<button
				onclick={load}
				class="px-4 py-2 bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 rounded-lg text-sm transition-colors"
			>
				Search
			</button>
		</div>

		{#if error}
			<div class="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm mb-6">
				{error}
			</div>
		{/if}

		<StrategyList {strategies} {loading} onFork={handleFork} />
	</div>
</main>

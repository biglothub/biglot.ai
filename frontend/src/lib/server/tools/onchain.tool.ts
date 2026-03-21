// On-Chain Data Tool — get_onchain_data
// Sources: CoinMetrics Community API + Blockchain.com
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	fetchOnChainData,
	classifyMVRV,
	classifyNVT,
	formatHashRate,
	type OnChainAsset,
} from '../data/onchain.data';

// ─── get_onchain_data ─────────────────────────────────────────────────────────

registerTool({
	name: 'get_onchain_data',
	description:
		'Fetch on-chain blockchain metrics for BTC or ETH: active addresses, hash rate, NVT ratio, MVRV (Market Value to Realized Value), and 24h transaction count. Use when user asks about on-chain data, blockchain metrics, MVRV, NVT, hash rate, network activity, or on-chain analysis.',
	parameters: {
		type: 'object',
		properties: {
			asset: {
				type: 'string',
				enum: ['btc', 'eth'],
				description: 'Which asset to fetch on-chain data for (default: btc)'
			}
		},
		required: []
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const asset: OnChainAsset = args.asset === 'eth' ? 'eth' : 'btc';

		const cacheKey = toolCache.generateKey('get_onchain_data', { asset });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const data = await fetchOnChainData(asset);

		if (data.source === 'unavailable') {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Failed to fetch on-chain data for ${asset.toUpperCase()}.`, tool: 'get_onchain_data' }],
				textSummary: `Error: Could not fetch on-chain data for ${asset.toUpperCase()}.`
			};
		}

		const ticker = asset.toUpperCase();
		const metrics: { label: string; value: string; change?: string; direction?: 'up' | 'down' | 'neutral' }[] = [];

		if (data.activeAddresses !== null) {
			metrics.push({
				label: 'Active Addresses (24h)',
				value: data.activeAddresses.toLocaleString('en-US'),
				direction: 'neutral'
			});
		}

		if (data.transactions24h !== null) {
			metrics.push({
				label: 'Transactions (24h)',
				value: data.transactions24h.toLocaleString('en-US'),
				direction: 'neutral'
			});
		}

		if (data.hashRateEH !== null) {
			metrics.push({
				label: asset === 'btc' ? 'Hash Rate' : 'Hash Rate',
				value: formatHashRate(data.hashRateEH, asset),
				direction: 'neutral'
			});
		}

		if (data.mvrv !== null) {
			const mvrvLabel = classifyMVRV(data.mvrv);
			const mvrvDir: 'up' | 'down' | 'neutral' =
				data.mvrv > 2.4 ? 'up' : data.mvrv < 1.0 ? 'down' : 'neutral';
			metrics.push({
				label: 'MVRV Ratio',
				value: `${data.mvrv.toFixed(2)} — ${mvrvLabel}`,
				direction: mvrvDir
			});
		}

		if (data.nvtRatio !== null) {
			const nvtLabel = classifyNVT(data.nvtRatio);
			metrics.push({
				label: 'NVT Ratio',
				value: `${data.nvtRatio.toFixed(1)} — ${nvtLabel}`,
				direction: 'neutral'
			});
		}

		if (data.supplyOnExchanges !== null) {
			metrics.push({
				label: 'Supply on Exchanges',
				value: `${data.supplyOnExchanges.toFixed(1)}%`,
				direction: 'neutral'
			});
		}

		const summaryParts: string[] = [];
		if (data.activeAddresses !== null) summaryParts.push(`Active addresses: ${data.activeAddresses.toLocaleString()}`);
		if (data.hashRateEH !== null) summaryParts.push(`Hash rate: ${formatHashRate(data.hashRateEH, asset)}`);
		if (data.mvrv !== null) summaryParts.push(`MVRV: ${data.mvrv.toFixed(2)} (${classifyMVRV(data.mvrv)})`);
		if (data.nvtRatio !== null) summaryParts.push(`NVT: ${data.nvtRatio.toFixed(1)} (${classifyNVT(data.nvtRatio)})`);
		if (data.transactions24h !== null) summaryParts.push(`Txns 24h: ${data.transactions24h.toLocaleString()}`);

		const result: ToolResult = {
			success: true,
			contentBlocks: [{
				type: 'metric_card',
				title: `${ticker} On-Chain Data — ${new Date().toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`,
				metrics
			}],
			textSummary: `${ticker} On-Chain: ${summaryParts.join(', ')}. Source: ${data.source}.`,
			sources: [{ name: data.source, url: 'https://community-api.coinmetrics.io', accessedAt: Date.now() }]
		};

		toolCache.set(cacheKey, result, 300_000); // 5 min cache — on-chain data is slow-moving
		return result;
	}
});

// Strategy Sharing Tool — T-1404
// Tool: share_strategy — publish, browse, view, clone strategies in community library

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import {
	isValidAssetClass,
	isValidStrategyType,
	isValidSortBy,
	mapSharedStrategyRow,
	formatStrategyTableRow,
	inferAssetClass,
	strategyToBacktestBlock,
	sortByToColumn,
	VALID_ASSET_CLASSES,
	VALID_STRATEGY_TYPES,
	VALID_SORT_BY,
	STRATEGY_TYPE_LABELS,
	ASSET_CLASS_LABELS,
	type SharedStrategy,
	type SharedStrategyRow,
	type BrowseSortBy,
	type AssetClass,
	type StrategyType,
} from '../data/strategySharing.data';
import type { MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

const DEFAULT_USER = 'default';
const BROWSE_LIMIT = 20;

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function dbShareStrategy(input: {
	userId: string;
	strategyName: string;
	description: string;
	symbol: string;
	timeframe: string;
	assetClass: AssetClass;
	strategyType: StrategyType;
	sharpe: number;
	winRate: number;
	maxDrawdown: number;
	totalReturn: number;
	totalTrades: number;
	profitFactor: number;
	isClone: boolean;
	sourceId: string | null;
}): Promise<SharedStrategy | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('shared_strategies')
		.insert({
			user_id: input.userId,
			strategy_name: input.strategyName,
			description: input.description,
			symbol: input.symbol.toUpperCase(),
			timeframe: input.timeframe,
			asset_class: input.assetClass,
			strategy_type: input.strategyType,
			sharpe: input.sharpe,
			win_rate: input.winRate,
			max_drawdown: input.maxDrawdown,
			total_return: input.totalReturn,
			total_trades: input.totalTrades,
			profit_factor: input.profitFactor,
			is_clone: input.isClone,
			source_id: input.sourceId,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapSharedStrategyRow(data as SharedStrategyRow);
}

async function dbBrowseStrategies(options: {
	sortBy: BrowseSortBy;
	filterAsset?: AssetClass;
	filterType?: StrategyType;
	minSharpe?: number;
	limit: number;
}): Promise<SharedStrategy[]> {
	const db = getSupabaseAdminClient();
	let q = db.from('shared_strategies').select();

	if (options.filterAsset) q = (q as typeof q).eq('asset_class', options.filterAsset);
	if (options.filterType) q = (q as typeof q).eq('strategy_type', options.filterType);
	if (options.minSharpe !== undefined) q = (q as typeof q).gte('sharpe', options.minSharpe);

	const col = sortByToColumn(options.sortBy);
	const { data, error } = await (q as typeof q)
		.order(col, { ascending: false })
		.limit(options.limit);

	if (error || !data) return [];
	return (data as SharedStrategyRow[]).map(mapSharedStrategyRow);
}

async function dbGetStrategy(id: string): Promise<SharedStrategy | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('shared_strategies')
		.select()
		.eq('id', id)
		.single();

	if (error || !data) return null;
	return mapSharedStrategyRow(data as SharedStrategyRow);
}

async function dbGetLibraryStats(): Promise<{ total: number; topRated: SharedStrategy | null }> {
	const db = getSupabaseAdminClient();

	const { count } = await db
		.from('shared_strategies')
		.select('id', { count: 'exact', head: true });

	const { data } = await db
		.from('shared_strategies')
		.select()
		.order('sharpe', { ascending: false })
		.limit(1);

	return {
		total: count ?? 0,
		topRated: data?.[0] ? mapSharedStrategyRow(data[0] as SharedStrategyRow) : null,
	};
}

// ─── Block Builders ───────────────────────────────────────────────────────────

function buildStatsMetricCard(total: number, topRated: SharedStrategy | null): MetricCardBlock {
	return {
		type: 'metric_card',
		title: 'Strategy Community Library',
		metrics: [
			{
				label: 'Strategies Shared',
				value: total.toString(),
				direction: total > 0 ? 'up' : 'neutral',
			},
			{
				label: 'Top-Rated Strategy',
				value: topRated ? topRated.strategyName : 'None yet',
				direction: 'neutral',
			},
			{
				label: 'Best Sharpe',
				value: topRated ? topRated.sharpe.toFixed(2) : '—',
				direction: topRated && topRated.sharpe > 1 ? 'up' : 'neutral',
			},
			{
				label: 'Best Win Rate',
				value: topRated ? `${topRated.winRate.toFixed(1)}%` : '—',
				direction: topRated && topRated.winRate > 50 ? 'up' : 'neutral',
			},
		],
	};
}

function buildStrategyTableBlock(strategies: SharedStrategy[], sortBy: BrowseSortBy): TableBlock {
	const sortLabel =
		sortBy === 'win_rate' ? 'Win Rate' :
		sortBy === 'total_return' ? 'Total Return' :
		sortBy === 'newest' ? 'Newest' : 'Sharpe';

	return {
		type: 'table',
		title: `Community Strategies — Sorted by ${sortLabel}`,
		headers: ['#', 'Name', 'Symbol', 'Asset', 'Type', 'TF', 'Sharpe', 'Win%', 'Return', 'MaxDD', 'Trades', 'Source'],
		rows: strategies.map((s, i) => formatStrategyTableRow(s, i + 1)),
	};
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'share_strategy',
	description:
		'Strategy Sharing & Community Library — publish backtested strategies to the community or browse strategies shared by others. ' +
		'Actions: "share" (publish your strategy with metrics), "browse" (list strategies sorted by Sharpe/win rate/return/newest, filter by asset class or type), ' +
		'"view" (detailed view of a specific strategy with full metrics), "clone" (save a copy of a community strategy to your own library). ' +
		'Returns MetricCard (library stats), TableBlock (strategy list), and BacktestBlock when viewing a specific strategy.',
	parameters: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['share', 'browse', 'view', 'clone'],
				description:
					'Action: "share" = publish strategy, "browse" = list community library, "view" = see specific strategy details, "clone" = copy to your library',
			},
			strategy_name: {
				type: 'string',
				description: 'Strategy name (required for share)',
			},
			description: {
				type: 'string',
				description: 'Brief description of the strategy logic and edge (required for share)',
			},
			symbol: {
				type: 'string',
				description: 'Trading symbol tested on, e.g. BTCUSDT, EURUSD, AAPL (required for share)',
			},
			timeframe: {
				type: 'string',
				description: 'Timeframe: 1h, 4h, 1d, 1w, etc. (required for share)',
			},
			asset_class: {
				type: 'string',
				enum: VALID_ASSET_CLASSES,
				description: 'Asset class (optional for share — auto-detected from symbol if omitted)',
			},
			strategy_type: {
				type: 'string',
				enum: VALID_STRATEGY_TYPES,
				description: `Strategy type (required for share): ${VALID_STRATEGY_TYPES.join(', ')}`,
			},
			sharpe: {
				type: 'number',
				description: 'Sharpe ratio from backtest (required for share)',
			},
			win_rate: {
				type: 'number',
				description: 'Win rate percentage, 0–100 (required for share)',
			},
			max_drawdown: {
				type: 'number',
				description: 'Max drawdown percentage as positive number, e.g. 15.5 (required for share)',
			},
			total_return: {
				type: 'number',
				description: 'Total return percentage, e.g. 85.3 (required for share)',
			},
			total_trades: {
				type: 'number',
				description: 'Total number of trades in backtest (required for share)',
			},
			profit_factor: {
				type: 'number',
				description: 'Profit factor (gross profit / gross loss) from backtest (required for share)',
			},
			strategy_id: {
				type: 'string',
				description: 'Strategy ID for view or clone actions',
			},
			sort_by: {
				type: 'string',
				enum: VALID_SORT_BY,
				description: 'Sort order for browse: sharpe (default), win_rate, total_return, newest',
			},
			filter_asset: {
				type: 'string',
				enum: VALID_ASSET_CLASSES,
				description: 'Filter by asset class for browse',
			},
			filter_type: {
				type: 'string',
				enum: VALID_STRATEGY_TYPES,
				description: 'Filter by strategy type for browse',
			},
			min_sharpe: {
				type: 'number',
				description: 'Minimum Sharpe ratio filter for browse (e.g. 1.0)',
			},
		},
		required: ['action'],
	},

	execute: async (args): Promise<ToolResult> => {
		const action = typeof args.action === 'string' ? args.action : 'browse';

		// ─── SHARE ────────────────────────────────────────────────────────────────
		if (action === 'share') {
			const strategyName = typeof args.strategy_name === 'string' ? args.strategy_name.trim() : '';
			const description = typeof args.description === 'string' ? args.description.trim() : '';
			const symbol = typeof args.symbol === 'string' ? args.symbol.trim() : '';
			const timeframe = typeof args.timeframe === 'string' ? args.timeframe.trim() : '';
			const strategyType = isValidStrategyType(args.strategy_type) ? args.strategy_type : null;

			// Validate required fields
			if (!strategyName || !symbol || !timeframe || !strategyType) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'Missing required fields for share: strategy_name, symbol, timeframe, strategy_type.',
						tool: 'share_strategy',
					}],
					textSummary: 'Error: Missing required fields for share action.',
				};
			}

			const sharpe = typeof args.sharpe === 'number' ? args.sharpe : null;
			const winRate = typeof args.win_rate === 'number' ? args.win_rate : null;
			const maxDrawdown = typeof args.max_drawdown === 'number' ? args.max_drawdown : null;
			const totalReturn = typeof args.total_return === 'number' ? args.total_return : null;
			const totalTrades = typeof args.total_trades === 'number' ? Math.round(args.total_trades) : null;
			const profitFactor = typeof args.profit_factor === 'number' ? args.profit_factor : null;

			if (sharpe === null || winRate === null || maxDrawdown === null ||
				totalReturn === null || totalTrades === null || profitFactor === null) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'Missing backtest metrics for share: sharpe, win_rate, max_drawdown, total_return, total_trades, profit_factor.',
						tool: 'share_strategy',
					}],
					textSummary: 'Error: Missing backtest metrics. Run a backtest first then share the results.',
				};
			}

			// Auto-detect asset class
			const assetClass: AssetClass = isValidAssetClass(args.asset_class)
				? args.asset_class
				: inferAssetClass(symbol);

			const shared = await dbShareStrategy({
				userId: DEFAULT_USER,
				strategyName,
				description,
				symbol,
				timeframe,
				assetClass,
				strategyType,
				sharpe,
				winRate,
				maxDrawdown,
				totalReturn,
				totalTrades,
				profitFactor,
				isClone: false,
				sourceId: null,
			});

			if (!shared) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'Failed to publish strategy to community library. Please try again.',
						tool: 'share_strategy',
					}],
					textSummary: 'Error: Failed to save strategy to Supabase.',
				};
			}

			const stats = await dbGetLibraryStats();

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `Strategy Published: ${shared.strategyName}`,
				metrics: [
					{ label: 'Strategy ID', value: shared.id, direction: 'neutral' },
					{ label: 'Symbol', value: `${shared.symbol} (${shared.timeframe})`, direction: 'neutral' },
					{ label: 'Type', value: STRATEGY_TYPE_LABELS[shared.strategyType], direction: 'neutral' },
					{ label: 'Sharpe', value: shared.sharpe.toFixed(2), direction: shared.sharpe > 1 ? 'up' : 'neutral' },
					{ label: 'Win Rate', value: `${shared.winRate.toFixed(1)}%`, direction: shared.winRate > 50 ? 'up' : 'neutral' },
					{ label: 'Total Return', value: `${shared.totalReturn >= 0 ? '+' : ''}${shared.totalReturn.toFixed(1)}%`, direction: shared.totalReturn > 0 ? 'up' : 'down' },
					{ label: 'Max Drawdown', value: `${shared.maxDrawdown.toFixed(1)}%`, direction: 'neutral' },
					{ label: 'Community Size', value: `${stats.total} strategies`, direction: 'neutral' },
				],
			};

			return {
				success: true,
				contentBlocks: [metricCard],
				textSummary:
					`Strategy "${strategyName}" published to community library (ID: ${shared.id}). ` +
					`${symbol} ${timeframe}, ${STRATEGY_TYPE_LABELS[strategyType]}, ` +
					`Sharpe: ${sharpe.toFixed(2)}, Win Rate: ${winRate.toFixed(1)}%, ` +
					`Return: ${totalReturn >= 0 ? '+' : ''}${totalReturn.toFixed(1)}%, Max DD: ${maxDrawdown.toFixed(1)}%.`,
			};
		}

		// ─── BROWSE ───────────────────────────────────────────────────────────────
		if (action === 'browse') {
			const sortBy: BrowseSortBy = isValidSortBy(args.sort_by) ? args.sort_by : 'sharpe';
			const filterAsset = isValidAssetClass(args.filter_asset) ? args.filter_asset : undefined;
			const filterType = isValidStrategyType(args.filter_type) ? args.filter_type : undefined;
			const minSharpe = typeof args.min_sharpe === 'number' ? args.min_sharpe : undefined;

			const cacheKey = toolCache.generateKey('share_strategy_browse', {
				sortBy, filterAsset: filterAsset ?? '', filterType: filterType ?? '', minSharpe: minSharpe ?? 0,
			});
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const [strategies, stats] = await Promise.all([
				dbBrowseStrategies({ sortBy, filterAsset, filterType, minSharpe, limit: BROWSE_LIMIT }),
				dbGetLibraryStats(),
			]);

			const metricCard = buildStatsMetricCard(stats.total, stats.topRated);
			const tableBlock = buildStrategyTableBlock(strategies, sortBy);

			// Build filter description
			const filters: string[] = [];
			if (filterAsset) filters.push(ASSET_CLASS_LABELS[filterAsset]);
			if (filterType) filters.push(STRATEGY_TYPE_LABELS[filterType]);
			if (minSharpe !== undefined) filters.push(`Sharpe ≥ ${minSharpe}`);
			const filterDesc = filters.length > 0 ? ` (filters: ${filters.join(', ')})` : '';

			const result: ToolResult = {
				success: true,
				contentBlocks: [metricCard, tableBlock],
				textSummary:
					`Community Library: ${stats.total} total strategies${filterDesc}. ` +
					`Showing ${strategies.length} sorted by ${sortBy.replace('_', ' ')}. ` +
					(stats.topRated
						? `Top-rated: "${stats.topRated.strategyName}" (Sharpe ${stats.topRated.sharpe.toFixed(2)}, Win ${stats.topRated.winRate.toFixed(1)}%).`
						: 'No strategies shared yet.'),
			};

			toolCache.set(cacheKey, result, 60_000); // 1 min cache
			return result;
		}

		// ─── VIEW ─────────────────────────────────────────────────────────────────
		if (action === 'view') {
			const strategyId = typeof args.strategy_id === 'string' ? args.strategy_id.trim() : '';

			if (!strategyId) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'Please provide strategy_id to view a strategy.',
						tool: 'share_strategy',
					}],
					textSummary: 'Error: strategy_id is required for view action.',
				};
			}

			const strategy = await dbGetStrategy(strategyId);

			if (!strategy) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: `Strategy not found: ${strategyId}`,
						tool: 'share_strategy',
					}],
					textSummary: `Error: Strategy with ID "${strategyId}" not found in community library.`,
				};
			}

			const backtestBlock = strategyToBacktestBlock(strategy);

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: strategy.strategyName,
				metrics: [
					{ label: 'Symbol', value: `${strategy.symbol} (${strategy.timeframe})`, direction: 'neutral' },
					{ label: 'Type', value: `${STRATEGY_TYPE_LABELS[strategy.strategyType]} · ${ASSET_CLASS_LABELS[strategy.assetClass]}`, direction: 'neutral' },
					{ label: 'Sharpe', value: strategy.sharpe.toFixed(2), direction: strategy.sharpe > 1 ? 'up' : 'neutral' },
					{ label: 'Win Rate', value: `${strategy.winRate.toFixed(1)}%`, direction: strategy.winRate > 50 ? 'up' : 'neutral' },
					{ label: 'Total Return', value: `${strategy.totalReturn >= 0 ? '+' : ''}${strategy.totalReturn.toFixed(1)}%`, direction: strategy.totalReturn > 0 ? 'up' : 'down' },
					{ label: 'Max Drawdown', value: `${strategy.maxDrawdown.toFixed(1)}%`, direction: 'neutral' },
					{ label: 'Trades', value: strategy.totalTrades.toString(), direction: 'neutral' },
					{ label: 'Profit Factor', value: strategy.profitFactor.toFixed(2), direction: strategy.profitFactor > 1 ? 'up' : 'down' },
					{ label: 'Source', value: strategy.isClone ? 'Cloned' : 'Original', direction: 'neutral' },
				],
			};

			const descBlock = strategy.description ? {
				type: 'text' as const,
				content: `**Strategy: ${strategy.strategyName}**\n\n${strategy.description}`,
			} : null;

			return {
				success: true,
				contentBlocks: descBlock
					? [metricCard, descBlock, backtestBlock]
					: [metricCard, backtestBlock],
				textSummary:
					`Viewing strategy "${strategy.strategyName}" (${strategy.symbol} ${strategy.timeframe}). ` +
					`Type: ${STRATEGY_TYPE_LABELS[strategy.strategyType]}. ` +
					`Sharpe: ${strategy.sharpe.toFixed(2)}, Win Rate: ${strategy.winRate.toFixed(1)}%, ` +
					`Return: ${strategy.totalReturn >= 0 ? '+' : ''}${strategy.totalReturn.toFixed(1)}%, ` +
					`Max DD: ${strategy.maxDrawdown.toFixed(1)}%, Trades: ${strategy.totalTrades}.` +
					(strategy.description ? ` Description: ${strategy.description}` : ''),
			};
		}

		// ─── CLONE ────────────────────────────────────────────────────────────────
		if (action === 'clone') {
			const strategyId = typeof args.strategy_id === 'string' ? args.strategy_id.trim() : '';

			if (!strategyId) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'Please provide strategy_id to clone a strategy.',
						tool: 'share_strategy',
					}],
					textSummary: 'Error: strategy_id is required for clone action.',
				};
			}

			const source = await dbGetStrategy(strategyId);

			if (!source) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: `Strategy not found: ${strategyId}`,
						tool: 'share_strategy',
					}],
					textSummary: `Error: Strategy with ID "${strategyId}" not found.`,
				};
			}

			const cloned = await dbShareStrategy({
				userId: DEFAULT_USER,
				strategyName: `${source.strategyName} (Clone)`,
				description: source.description,
				symbol: source.symbol,
				timeframe: source.timeframe,
				assetClass: source.assetClass,
				strategyType: source.strategyType,
				sharpe: source.sharpe,
				winRate: source.winRate,
				maxDrawdown: source.maxDrawdown,
				totalReturn: source.totalReturn,
				totalTrades: source.totalTrades,
				profitFactor: source.profitFactor,
				isClone: true,
				sourceId: source.id,
			});

			if (!cloned) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'Failed to clone strategy. Please try again.',
						tool: 'share_strategy',
					}],
					textSummary: 'Error: Failed to clone strategy to library.',
				};
			}

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `Strategy Cloned: ${cloned.strategyName}`,
				metrics: [
					{ label: 'New ID', value: cloned.id, direction: 'neutral' },
					{ label: 'Original', value: source.strategyName, direction: 'neutral' },
					{ label: 'Symbol', value: `${cloned.symbol} (${cloned.timeframe})`, direction: 'neutral' },
					{ label: 'Type', value: STRATEGY_TYPE_LABELS[cloned.strategyType], direction: 'neutral' },
					{ label: 'Sharpe', value: cloned.sharpe.toFixed(2), direction: cloned.sharpe > 1 ? 'up' : 'neutral' },
					{ label: 'Win Rate', value: `${cloned.winRate.toFixed(1)}%`, direction: cloned.winRate > 50 ? 'up' : 'neutral' },
				],
			};

			return {
				success: true,
				contentBlocks: [metricCard],
				textSummary:
					`Strategy "${source.strategyName}" cloned to your library as "${cloned.strategyName}" (ID: ${cloned.id}). ` +
					`${cloned.symbol} ${cloned.timeframe}, Sharpe: ${cloned.sharpe.toFixed(2)}, Win Rate: ${cloned.winRate.toFixed(1)}%.`,
			};
		}

		// ─── Unknown Action ───────────────────────────────────────────────────────
		return {
			success: false,
			contentBlocks: [{
				type: 'error',
				message: `Unknown action: "${action}". Valid actions: share, browse, view, clone.`,
				tool: 'share_strategy',
			}],
			textSummary: `Error: Unknown action "${action}".`,
		};
	},
});

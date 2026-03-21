// Position Size Calculator Tool — calculate_position_size
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	validateInputs,
	calculatePositionSize,
	formatUSDAmount,
	type SizingInput,
} from '../risk/positionSizing';

registerTool({
	name: 'calculate_position_size',
	description:
		'Calculate optimal position size using Fixed Fractional, Kelly Criterion, Volatility-Adjusted (ATR), and Equal Risk Contribution methods. Use when user asks about position sizing, how much to buy, lot size, risk management, Kelly, ATR stop. Returns MetricCardBlock with all methods compared.',
	parameters: {
		type: 'object',
		properties: {
			account_size: {
				type: 'number',
				description: 'Total account size in USD'
			},
			risk_pct: {
				type: 'number',
				description: 'Maximum risk per trade as % of account (e.g. 1 = 1%). Typical: 0.5–2%.'
			},
			entry_price: {
				type: 'number',
				description: 'Entry price of the trade'
			},
			stop_price: {
				type: 'number',
				description: 'Stop-loss price'
			},
			instrument_type: {
				type: 'string',
				enum: ['crypto', 'forex', 'stock', 'futures', 'gold'],
				description: 'Instrument type (default: crypto)'
			},
			win_rate: {
				type: 'number',
				description: 'Historical win rate 0–1 (enables Kelly Criterion, e.g. 0.55 = 55%)'
			},
			avg_win_loss: {
				type: 'number',
				description: 'Average win / average loss ratio (for Kelly, e.g. 1.5 = wins average 1.5× losses)'
			},
			atr: {
				type: 'number',
				description: 'Average True Range of the instrument (enables volatility-adjusted sizing)'
			},
			atr_multiple: {
				type: 'number',
				description: 'ATR multiple for stop (default: 2)'
			},
			num_positions: {
				type: 'number',
				description: 'Number of concurrent positions (enables Equal Risk Contribution, e.g. 5)'
			}
		},
		required: ['account_size', 'risk_pct', 'entry_price', 'stop_price']
	},
	timeout: 5_000,
	execute: async (args): Promise<ToolResult> => {
		const input: SizingInput = {
			accountSize:     Number(args.account_size),
			riskPct:         Number(args.risk_pct),
			entryPrice:      Number(args.entry_price),
			stopPrice:       Number(args.stop_price),
			instrumentType:  typeof args.instrument_type === 'string' ? args.instrument_type as SizingInput['instrumentType'] : 'crypto',
			winRate:         args.win_rate !== undefined ? Number(args.win_rate) : undefined,
			avgWinLoss:      args.avg_win_loss !== undefined ? Number(args.avg_win_loss) : undefined,
			atr:             args.atr !== undefined ? Number(args.atr) : undefined,
			atrMultiple:     args.atr_multiple !== undefined ? Number(args.atr_multiple) : undefined,
			numPositions:    args.num_positions !== undefined ? Number(args.num_positions) : undefined,
		} as SizingInput & { winRate?: number; avgWinLoss?: number; atr?: number; atrMultiple?: number; numPositions?: number };

		const validationError = validateInputs(input);
		if (validationError) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: validationError, tool: 'calculate_position_size' }],
				textSummary: `Error: ${validationError}`
			};
		}

		const cacheKey = toolCache.generateKey('calculate_position_size', {
			accountSize: input.accountSize, riskPct: input.riskPct,
			entryPrice: input.entryPrice, stopPrice: input.stopPrice,
			winRate: input.winRate, avgWinLoss: input.avgWinLoss,
			atr: input.atr, atrMultiple: input.atrMultiple, numPositions: (input as { numPositions?: number }).numPositions
		});
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const sizing = calculatePositionSize(input as Parameters<typeof calculatePositionSize>[0]);
		const { recommended, recommendedMethod } = sizing;

		const isLong = input.entryPrice > input.stopPrice;
		const direction = isLong ? 'Long' : 'Short';

		// Build MetricCard with recommended method highlighted
		const metrics: { label: string; value: string; direction?: 'up' | 'down' | 'neutral' }[] = [
			{ label: 'Recommended Method', value: recommendedMethod, direction: 'neutral' },
			{ label: `Position Size (${direction})`, value: `${recommended.positionSizeUnits.toFixed(4)} units`, direction: 'up' },
			{ label: 'Position Value', value: formatUSDAmount(recommended.positionSizeUSD), direction: 'neutral' },
			{ label: 'Risk Amount', value: formatUSDAmount(recommended.riskAmount), direction: 'down' },
			{ label: 'Risk %', value: `${recommended.riskPct.toFixed(2)}% of account`, direction: 'neutral' },
			{ label: 'Stop Distance', value: `${recommended.stopDistance.toFixed(4)} (${recommended.stopDistancePct.toFixed(2)}%)`, direction: 'neutral' },
		];

		// Table rows comparing all methods
		const tableRows: (string | number)[][] = [
			['Fixed Fractional', sizing.fixedFractional.positionSizeUnits.toFixed(4), formatUSDAmount(sizing.fixedFractional.riskAmount), `${sizing.fixedFractional.riskPct.toFixed(2)}%`],
		];
		if (sizing.kelly) {
			tableRows.push(['Kelly (Half)', sizing.kelly.positionSizeUnits.toFixed(4), formatUSDAmount(sizing.kelly.riskAmount), `${sizing.kelly.riskPct.toFixed(2)}%`]);
		}
		if (sizing.volatilityAdjusted) {
			tableRows.push(['ATR-Adjusted', sizing.volatilityAdjusted.positionSizeUnits.toFixed(4), formatUSDAmount(sizing.volatilityAdjusted.riskAmount), `${sizing.volatilityAdjusted.riskPct.toFixed(2)}%`]);
		}
		if (sizing.equalRisk) {
			tableRows.push(['Equal Risk', sizing.equalRisk.positionSizeUnits.toFixed(4), formatUSDAmount(sizing.equalRisk.riskAmount), `${sizing.equalRisk.riskPct.toFixed(2)}%`]);
		}

		const result: ToolResult = {
			success: true,
			contentBlocks: [
				{
					type: 'metric_card',
					title: `Position Size — ${input.instrumentType?.toUpperCase() ?? 'CRYPTO'} | ${direction} @ ${input.entryPrice} → Stop ${input.stopPrice}`,
					metrics
				},
				{
					type: 'table',
					title: 'Method Comparison',
					headers: ['Method', 'Units', 'Risk $', 'Risk %'],
					rows: tableRows
				}
			],
			textSummary: `Position sizing (${direction} ${input.instrumentType ?? 'crypto'}): Recommended ${recommendedMethod} → ${recommended.positionSizeUnits.toFixed(4)} units (${formatUSDAmount(recommended.positionSizeUSD)}), risk ${formatUSDAmount(recommended.riskAmount)} (${recommended.riskPct.toFixed(2)}%). Stop distance: ${recommended.stopDistancePct.toFixed(2)}%.`
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	}
});

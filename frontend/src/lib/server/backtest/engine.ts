// Backtesting Engine - T-104
// Simulates trades from a Strategy + OHLCV[], returns BacktestResult.

import type { OHLCV } from '$lib/types/contentBlock';
import type {
	Strategy,
	IndicatorCondition,
	ConditionGroup,
	ExitCondition,
	IndicatorName,
	ComparisonOperator,
} from '$lib/types/strategy';
import type {
	Trade,
	BacktestResult,
	WalkForwardResult,
	BacktestConfig,
	ExitReason,
} from '$lib/types/backtest';
import {
	sma, ema, rsi, macd, bollingerBands, atr, stochastic, adx,
	obv, vwap, williamsR, cci, mfi, superTrend,
} from '../indicators/engine';
import { buildEquityCurve, calcMetrics } from './metrics';

// ─── Indicator Series Cache ───────────────────────────────────────────────────

/** time → value map for a single indicator series */
type SeriesMap = Map<number, number>;

/** Cache key: "indicator:param1=v1:param2=v2" */
function seriesKey(name: IndicatorName, params?: Record<string, number>): string {
	if (!params || Object.keys(params).length === 0) return name;
	const sorted = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join(':');
	return `${name}:${sorted}`;
}

function buildSeriesMap(
	ohlcv: OHLCV[],
	name: IndicatorName,
	params?: Record<string, number>
): SeriesMap {
	const map: SeriesMap = new Map();

	switch (name) {
		case 'close':  ohlcv.forEach((b) => map.set(b.time, b.close));  break;
		case 'open':   ohlcv.forEach((b) => map.set(b.time, b.open));   break;
		case 'high':   ohlcv.forEach((b) => map.set(b.time, b.high));   break;
		case 'low':    ohlcv.forEach((b) => map.set(b.time, b.low));    break;
		case 'volume': ohlcv.forEach((b) => map.set(b.time, b.volume)); break;

		case 'sma':
			sma(ohlcv, params?.period ?? 20).forEach((d) => map.set(d.time, d.value));
			break;
		case 'ema':
			ema(ohlcv, params?.period ?? 20).forEach((d) => map.set(d.time, d.value));
			break;
		case 'rsi':
			rsi(ohlcv, params?.period ?? 14).forEach((d) => map.set(d.time, d.value));
			break;
		case 'macd': {
			const r = macd(ohlcv, params?.fast ?? 12, params?.slow ?? 26, params?.signal ?? 9);
			r.macd.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'macd_signal': {
			const r = macd(ohlcv, params?.fast ?? 12, params?.slow ?? 26, params?.signal ?? 9);
			r.signal.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'macd_histogram': {
			const r = macd(ohlcv, params?.fast ?? 12, params?.slow ?? 26, params?.signal ?? 9);
			r.histogram.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'bollinger_upper': {
			const r = bollingerBands(ohlcv, params?.period ?? 20, params?.stdDev ?? 2);
			r.upper.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'bollinger_middle': {
			const r = bollingerBands(ohlcv, params?.period ?? 20, params?.stdDev ?? 2);
			r.middle.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'bollinger_lower': {
			const r = bollingerBands(ohlcv, params?.period ?? 20, params?.stdDev ?? 2);
			r.lower.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'atr':
			atr(ohlcv, params?.period ?? 14).forEach((d) => map.set(d.time, d.value));
			break;
		case 'stochastic_k': {
			const r = stochastic(ohlcv, params?.period ?? 14, params?.smooth ?? 3);
			r.k.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'stochastic_d': {
			const r = stochastic(ohlcv, params?.period ?? 14, params?.smooth ?? 3);
			r.d.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'adx': {
			const r = adx(ohlcv, params?.period ?? 14);
			r.adx.forEach((d) => map.set(d.time, d.value));
			break;
		}
		case 'obv':
			obv(ohlcv).forEach((d) => map.set(d.time, d.value));
			break;
		case 'vwap':
			vwap(ohlcv).forEach((d) => map.set(d.time, d.value));
			break;
		case 'williams_r':
			williamsR(ohlcv, params?.period ?? 14).forEach((d) => map.set(d.time, d.value));
			break;
		case 'cci':
			cci(ohlcv, params?.period ?? 20).forEach((d) => map.set(d.time, d.value));
			break;
		case 'mfi':
			mfi(ohlcv, params?.period ?? 14).forEach((d) => map.set(d.time, d.value));
			break;
		case 'supertrend': {
			const r = superTrend(ohlcv, params?.period ?? 10, params?.multiplier ?? 3);
			r.supertrend.forEach((d) => map.set(d.time, d.value));
			break;
		}
	}

	return map;
}

// ─── Indicator Catalogue ─────────────────────────────────────────────────────

class IndicatorCatalogue {
	private cache = new Map<string, SeriesMap>();

	constructor(private ohlcv: OHLCV[]) {}

	get(name: IndicatorName, params?: Record<string, number>): SeriesMap {
		const key = seriesKey(name, params);
		if (!this.cache.has(key)) {
			this.cache.set(key, buildSeriesMap(this.ohlcv, name, params));
		}
		return this.cache.get(key)!;
	}

	getValue(name: IndicatorName, time: number, params?: Record<string, number>): number | undefined {
		return this.get(name, params).get(time);
	}
}

// ─── Condition Evaluation ─────────────────────────────────────────────────────

function compareValues(lhs: number, op: ComparisonOperator, rhs: number): boolean {
	switch (op) {
		case '>':  return lhs > rhs;
		case '<':  return lhs < rhs;
		case '>=': return lhs >= rhs;
		case '<=': return lhs <= rhs;
		case '==': return Math.abs(lhs - rhs) < 1e-10;
		// crosses_ handled separately (needs prev bar)
		default:   return false;
	}
}

function evalCondition(
	cond: IndicatorCondition,
	catalogue: IndicatorCatalogue,
	time: number,
	prevTime: number | null
): boolean {
	const lhs = catalogue.getValue(cond.indicator, time, cond.params);
	if (lhs === undefined) return false;

	let rhs: number;
	if (typeof cond.threshold === 'number') {
		rhs = cond.threshold;
	} else {
		const rhsVal = catalogue.getValue(cond.threshold.indicator, time, cond.threshold.params);
		if (rhsVal === undefined) return false;
		rhs = rhsVal;
	}

	if (cond.operator === 'crosses_above' || cond.operator === 'crosses_below') {
		if (prevTime === null) return false;
		const prevLhs = catalogue.getValue(cond.indicator, prevTime, cond.params);
		if (prevLhs === undefined) return false;

		let prevRhs: number;
		if (typeof cond.threshold === 'number') {
			prevRhs = cond.threshold;
		} else {
			const pv = catalogue.getValue(cond.threshold.indicator, prevTime, cond.threshold.params);
			if (pv === undefined) return false;
			prevRhs = pv;
		}

		if (cond.operator === 'crosses_above') return prevLhs <= prevRhs && lhs > prevRhs;
		return prevLhs >= prevRhs && lhs < prevRhs;
	}

	return compareValues(lhs, cond.operator, rhs);
}

function evalGroup(
	group: ConditionGroup,
	catalogue: IndicatorCatalogue,
	time: number,
	prevTime: number | null
): boolean {
	if (group.logic === 'AND') {
		return group.conditions.every((c) => evalCondition(c, catalogue, time, prevTime));
	}
	return group.conditions.some((c) => evalCondition(c, catalogue, time, prevTime));
}

function evalEntry(
	strategy: Strategy,
	catalogue: IndicatorCatalogue,
	time: number,
	prevTime: number | null
): boolean {
	// All groups must pass (AND between groups)
	return strategy.entry.groups.every((g) => evalGroup(g, catalogue, time, prevTime));
}

// ─── Open Position ────────────────────────────────────────────────────────────

type OpenPosition = {
	direction: 'long' | 'short';
	entryTime: number;
	entryBarIndex: number;
	entryPrice: number;
	size: number;
	riskAmount: number; // absolute $ at risk (for R-multiple calc)
	stopPrice: number;
	takeProfitPrice: number | null;
	trailingOffsetPct: number | null; // % trail distance
	trailingOffsetAtr: number | null; // ATR trail distance
	trailingPeak: number; // best price reached for trailing
	maxBars: number | null; // time-based exit bar count
	barsHeld: number;
};

// ─── Position Sizing ──────────────────────────────────────────────────────────

function calcPositionSize(
	strategy: Strategy,
	equity: number,
	entryPrice: number,
	stopPrice: number
): number {
	const riskAmount = equity * (strategy.positionSizing.riskPerTrade / 100);
	const priceRisk = Math.abs(entryPrice - stopPrice);
	if (priceRisk <= 0 || entryPrice <= 0) return 0;

	let size = riskAmount / priceRisk;

	// Cap by maxPositionPct if set
	if (strategy.positionSizing.maxPositionPct) {
		const maxSize = (equity * (strategy.positionSizing.maxPositionPct / 100)) / entryPrice;
		size = Math.min(size, maxSize);
	}

	return size;
}

// ─── Stop Price Calculation ───────────────────────────────────────────────────

function calcStopPrice(
	strategy: Strategy,
	direction: 'long' | 'short',
	entryPrice: number,
	atrValue: number
): number {
	const stopExit = strategy.exit.find((e) => e.type === 'stop_loss');
	if (!stopExit || stopExit.type !== 'stop_loss') {
		// Fallback: 2% stop
		return direction === 'long' ? entryPrice * 0.98 : entryPrice * 1.02;
	}

	const { value, unit } = stopExit;
	if (unit === 'pct') {
		return direction === 'long'
			? entryPrice * (1 - value / 100)
			: entryPrice * (1 + value / 100);
	} else if (unit === 'atr_multiple') {
		return direction === 'long'
			? entryPrice - value * atrValue
			: entryPrice + value * atrValue;
	} else {
		// absolute
		return direction === 'long' ? entryPrice - value : entryPrice + value;
	}
}

function calcTakeProfitPrice(
	strategy: Strategy,
	direction: 'long' | 'short',
	entryPrice: number,
	stopPrice: number,
	atrValue: number
): number | null {
	const tpExit = strategy.exit.find((e) => e.type === 'take_profit');
	if (!tpExit || tpExit.type !== 'take_profit') return null;

	const { value, unit } = tpExit;
	if (unit === 'pct') {
		return direction === 'long'
			? entryPrice * (1 + value / 100)
			: entryPrice * (1 - value / 100);
	} else if (unit === 'atr_multiple') {
		return direction === 'long'
			? entryPrice + value * atrValue
			: entryPrice - value * atrValue;
	} else if (unit === 'r_multiple') {
		const riskDist = Math.abs(entryPrice - stopPrice);
		return direction === 'long'
			? entryPrice + value * riskDist
			: entryPrice - value * riskDist;
	} else {
		// absolute
		return direction === 'long' ? entryPrice + value : entryPrice - value;
	}
}

// ─── Exit Evaluation ──────────────────────────────────────────────────────────

type ExitSignal = { price: number; reason: ExitReason };

function evalExits(
	pos: OpenPosition,
	bar: OHLCV,
	prevTime: number | null,
	catalogue: IndicatorCatalogue,
	strategy: Strategy,
	currentDrawdown: number,
	maxDrawdownLimit: number
): ExitSignal | null {
	const { direction, stopPrice, takeProfitPrice } = pos;

	// 1. Max drawdown circuit breaker
	if (currentDrawdown >= maxDrawdownLimit) {
		return { price: bar.close, reason: 'max_drawdown' };
	}

	// 2. Stop loss
	if (direction === 'long' && bar.low <= stopPrice) {
		return { price: Math.min(bar.open, stopPrice), reason: 'stop_loss' };
	}
	if (direction === 'short' && bar.high >= stopPrice) {
		return { price: Math.max(bar.open, stopPrice), reason: 'stop_loss' };
	}

	// 3. Take profit
	if (takeProfitPrice !== null) {
		if (direction === 'long' && bar.high >= takeProfitPrice) {
			return { price: Math.max(bar.open, takeProfitPrice), reason: 'take_profit' };
		}
		if (direction === 'short' && bar.low <= takeProfitPrice) {
			return { price: Math.min(bar.open, takeProfitPrice), reason: 'take_profit' };
		}
	}

	// 4. Trailing stop
	if (pos.trailingOffsetPct !== null || pos.trailingOffsetAtr !== null) {
		// Update trailing peak
		if (direction === 'long') {
			if (bar.high > pos.trailingPeak) pos.trailingPeak = bar.high;
		} else {
			if (bar.low < pos.trailingPeak) pos.trailingPeak = bar.low;
		}

		let trailStop: number;
		if (pos.trailingOffsetPct !== null) {
			trailStop = direction === 'long'
				? pos.trailingPeak * (1 - pos.trailingOffsetPct / 100)
				: pos.trailingPeak * (1 + pos.trailingOffsetPct / 100);
		} else {
			const atrVal = pos.trailingOffsetAtr!;
			trailStop = direction === 'long'
				? pos.trailingPeak - atrVal
				: pos.trailingPeak + atrVal;
		}

		if (direction === 'long' && bar.low <= trailStop) {
			return { price: Math.min(bar.open, trailStop), reason: 'trailing_stop' };
		}
		if (direction === 'short' && bar.high >= trailStop) {
			return { price: Math.max(bar.open, trailStop), reason: 'trailing_stop' };
		}
	}

	// 5. Time-based exit
	if (pos.maxBars !== null && pos.barsHeld >= pos.maxBars) {
		return { price: bar.close, reason: 'time_based' };
	}

	// 6. Indicator-based exits
	for (const exitCond of strategy.exit) {
		if (exitCond.type !== 'indicator') continue;
		if (evalCondition(exitCond.condition, catalogue, bar.time, prevTime)) {
			return { price: bar.close, reason: 'indicator' };
		}
	}

	return null;
}

// ─── Core Simulation ──────────────────────────────────────────────────────────

function simulateTrades(
	ohlcv: OHLCV[],
	strategy: Strategy,
	initialCapital: number
): Trade[] {
	if (ohlcv.length < 2) return [];

	const catalogue = new IndicatorCatalogue(ohlcv);
	const trades: Trade[] = [];
	let equity = initialCapital;
	let peakEquity = initialCapital;

	let openPosition: OpenPosition | null = null;

	// Get ATR series for position sizing
	const atrSeries = catalogue.get('atr', { period: 14 });

	for (let i = 1; i < ohlcv.length; i++) {
		const bar = ohlcv[i];
		const prevBar = ohlcv[i - 1];
		const prevTime = prevBar.time;
		const currentDrawdown = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;

		// ── Manage open position ──────────────────────────────────────────────
		if (openPosition !== null) {
			openPosition.barsHeld++;

			const exitSignal = evalExits(
				openPosition,
				bar,
				prevTime,
				catalogue,
				strategy,
				currentDrawdown,
				strategy.risk.maxDrawdownPct
			);

			if (exitSignal) {
				const { price: exitPrice, reason } = exitSignal;
				const { direction, entryPrice, size, riskAmount } = openPosition;
				const pnl = direction === 'long'
					? (exitPrice - entryPrice) * size
					: (entryPrice - exitPrice) * size;
				const pnlPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 * (direction === 'long' ? 1 : -1) : 0;
				const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

				trades.push({
					entryTime: openPosition.entryTime,
					exitTime: bar.time,
					direction,
					entryPrice,
					exitPrice,
					size,
					pnl,
					pnlPct,
					rMultiple,
					exitReason: reason,
				});

				equity += pnl;
				if (equity > peakEquity) peakEquity = equity;
				openPosition = null;

				// Stop trading if max drawdown hit
				if (reason === 'max_drawdown') break;
			}
		}

		// ── Check entry if no position open ──────────────────────────────────
		if (openPosition === null && strategy.entry.direction !== 'short') {
			// Try long entry
			if (
				(strategy.entry.direction === 'long' || strategy.entry.direction === 'both') &&
				evalEntry(strategy, catalogue, bar.time, prevTime)
			) {
				const atrVal = atrSeries.get(bar.time) ?? bar.close * 0.02;
				const entryPrice = bar.close; // enter on close
				const stopPrice = calcStopPrice(strategy, 'long', entryPrice, atrVal);
				const takeProfitPrice = calcTakeProfitPrice(strategy, 'long', entryPrice, stopPrice, atrVal);

				const riskAmount = equity * (strategy.positionSizing.riskPerTrade / 100);
				const size = calcPositionSize(strategy, equity, entryPrice, stopPrice);
				if (size > 0) {
					// Trailing stop setup
					const trailExit = strategy.exit.find((e) => e.type === 'trailing_stop');
					const trailingOffsetPct = trailExit?.type === 'trailing_stop' && trailExit.unit === 'pct'
						? trailExit.value : null;
					const trailingOffsetAtr = trailExit?.type === 'trailing_stop' && trailExit.unit === 'atr_multiple'
						? trailExit.value * atrVal : null;

					const timeExit = strategy.exit.find((e) => e.type === 'time_based');
					const maxBars = timeExit?.type === 'time_based' ? timeExit.bars : null;

					openPosition = {
						direction: 'long',
						entryTime: bar.time,
						entryBarIndex: i,
						entryPrice,
						size,
						riskAmount,
						stopPrice,
						takeProfitPrice,
						trailingOffsetPct,
						trailingOffsetAtr,
						trailingPeak: entryPrice,
						maxBars,
						barsHeld: 0,
					};
				}
			}
		}

		if (openPosition === null && strategy.entry.direction !== 'long') {
			// Try short entry
			if (
				(strategy.entry.direction === 'short' || strategy.entry.direction === 'both') &&
				evalEntry(strategy, catalogue, bar.time, prevTime)
			) {
				const atrVal = atrSeries.get(bar.time) ?? bar.close * 0.02;
				const entryPrice = bar.close;
				const stopPrice = calcStopPrice(strategy, 'short', entryPrice, atrVal);
				const takeProfitPrice = calcTakeProfitPrice(strategy, 'short', entryPrice, stopPrice, atrVal);

				const riskAmount = equity * (strategy.positionSizing.riskPerTrade / 100);
				const size = calcPositionSize(strategy, equity, entryPrice, stopPrice);
				if (size > 0) {
					const trailExit = strategy.exit.find((e) => e.type === 'trailing_stop');
					const trailingOffsetPct = trailExit?.type === 'trailing_stop' && trailExit.unit === 'pct'
						? trailExit.value : null;
					const trailingOffsetAtr = trailExit?.type === 'trailing_stop' && trailExit.unit === 'atr_multiple'
						? trailExit.value * atrVal : null;

					const timeExit = strategy.exit.find((e) => e.type === 'time_based');
					const maxBars = timeExit?.type === 'time_based' ? timeExit.bars : null;

					openPosition = {
						direction: 'short',
						entryTime: bar.time,
						entryBarIndex: i,
						entryPrice,
						size,
						riskAmount,
						stopPrice,
						takeProfitPrice,
						trailingOffsetPct,
						trailingOffsetAtr,
						trailingPeak: entryPrice,
						maxBars,
						barsHeld: 0,
					};
				}
			}
		}
	}

	// Close any remaining open position at end of data
	if (openPosition !== null) {
		const lastBar = ohlcv[ohlcv.length - 1];
		const { direction, entryPrice, size, riskAmount } = openPosition;
		const exitPrice = lastBar.close;
		const pnl = direction === 'long'
			? (exitPrice - entryPrice) * size
			: (entryPrice - exitPrice) * size;
		const pnlPct = entryPrice > 0
			? ((exitPrice - entryPrice) / entryPrice) * 100 * (direction === 'long' ? 1 : -1)
			: 0;
		const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

		trades.push({
			entryTime: openPosition.entryTime,
			exitTime: lastBar.time,
			direction,
			entryPrice,
			exitPrice,
			size,
			pnl,
			pnlPct,
			rMultiple,
			exitReason: 'end_of_data',
		});
	}

	return trades;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function runBacktest(config: BacktestConfig): BacktestResult {
	const { strategy, ohlcv, symbol, initialCapital = 10_000 } = config;

	if (ohlcv.length === 0) {
		const empty = emptyResult(strategy, symbol, initialCapital);
		return empty;
	}

	const trades = simulateTrades(ohlcv, strategy, initialCapital);
	const finalCapital = trades.reduce((cap, t) => cap + t.pnl, initialCapital);
	const startTime = ohlcv[0].time;
	const endTime = ohlcv[ohlcv.length - 1].time;

	const equity = buildEquityCurve(initialCapital, trades, startTime, endTime);
	const metrics = calcMetrics(trades, equity, initialCapital, finalCapital, startTime, endTime);

	return { strategy, symbol, startTime, endTime, initialCapital, finalCapital, trades, equity, metrics };
}

export function runWalkForward(config: BacktestConfig): WalkForwardResult {
	const { ohlcv } = config;
	const splitIdx = Math.floor(ohlcv.length * 0.7);

	const inSample = runBacktest({ ...config, ohlcv: ohlcv.slice(0, splitIdx) });
	const outOfSample = runBacktest({ ...config, ohlcv: ohlcv.slice(splitIdx) });
	const combined = runBacktest(config);

	// Degradation: how much worse out-of-sample total return vs in-sample
	const inReturn = inSample.metrics.totalReturn;
	const outReturn = outOfSample.metrics.totalReturn;
	const degradationPct = inReturn !== 0 ? ((inReturn - outReturn) / Math.abs(inReturn)) * 100 : 0;

	return { inSample, outOfSample, combined, degradationPct };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyResult(strategy: Strategy, symbol: string, initialCapital: number): BacktestResult {
	return {
		strategy,
		symbol,
		startTime: 0,
		endTime: 0,
		initialCapital,
		finalCapital: initialCapital,
		trades: [],
		equity: [],
		metrics: {
			totalReturn: 0,
			cagr: 0,
			maxDrawdown: 0,
			sharpe: 0,
			sortino: 0,
			winRate: 0,
			avgRMultiple: 0,
			profitFactor: 0,
			maxConsecutiveLosses: 0,
			totalTrades: 0,
			profitableTrades: 0,
			losingTrades: 0,
			avgWin: 0,
			avgLoss: 0,
			expectancy: 0,
		},
	};
}

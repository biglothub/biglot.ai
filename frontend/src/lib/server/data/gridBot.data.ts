// Grid Bot Engine Data Layer — T-1204
// Paper grid bot: config types, level logic, execution records, performance math

// ─── Types ────────────────────────────────────────────────────────────────────

export type GridBot = {
	id: string;
	userId: string;
	symbol: string;
	upperPrice: number;
	lowerPrice: number;
	gridLevels: number;      // number of grid intervals (levels - 1 = gridLevels)
	investmentAmount: number; // total USDT allocated
	active: boolean;
	lastPrice: number | null; // last known price for crossing detection
	totalProfit: number;
	fillCount: number;
	createdAt: string;
};

export type GridExecution = {
	id: string;
	botId: string;
	userId: string;
	symbol: string;
	levelIndex: number;    // 0 = lowerPrice, gridLevels = upperPrice
	levelPrice: number;
	execType: 'buy' | 'sell';
	qty: number;           // base asset units
	amount: number;        // USDT value
	profit: number;        // 0 for buys, grid spacing * qty for sells
	executedAt: string;
};

export type GridLevel = {
	index: number;
	price: number;
	side: 'buy' | 'sell'; // relative to current price at time of creation
	status: 'pending' | 'filled';
};

export type GridPerformance = {
	totalProfit: number;
	fillCount: number;
	completedCycles: number; // matched buy-sell pairs
	fillRate: number;        // 0–1: filled levels / total levels
	estimatedAPY: number;    // annualised return % based on recent fills
	amountPerGrid: number;   // USDT per grid level
	gridSpacing: number;     // % spacing between adjacent levels
	gridSpacingAbs: number;  // absolute price spacing
};

export type CreateGridBotInput = {
	symbol: string;
	upperPrice: number;
	lowerPrice: number;
	gridLevels: number;
	investmentAmount: number;
};

// ─── DB Row Types (mirrors Supabase) ──────────────────────────────────────────

export type GridBotRow = {
	id: string;
	user_id: string;
	symbol: string;
	upper_price: number;
	lower_price: number;
	grid_levels: number;
	investment_amount: number;
	active: boolean;
	last_price: number | null;
	total_profit: number;
	fill_count: number;
	created_at: string;
};

export type GridExecutionRow = {
	id: string;
	bot_id: string;
	user_id: string;
	symbol: string;
	level_index: number;
	level_price: number;
	exec_type: string;
	qty: number;
	amount: number;
	profit: number;
	executed_at: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidGridConfig(
	upperPrice: number,
	lowerPrice: number,
	gridLevels: number,
	investmentAmount: number
): { valid: boolean; error?: string } {
	if (upperPrice <= lowerPrice) {
		return { valid: false, error: 'upper_price must be greater than lower_price.' };
	}
	if (gridLevels < 2 || gridLevels > 100) {
		return { valid: false, error: 'grid_levels must be between 2 and 100.' };
	}
	if (investmentAmount <= 0) {
		return { valid: false, error: 'investment_amount must be positive.' };
	}
	return { valid: true };
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export function mapGridBotRow(row: GridBotRow): GridBot {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		upperPrice: Number(row.upper_price),
		lowerPrice: Number(row.lower_price),
		gridLevels: Number(row.grid_levels),
		investmentAmount: Number(row.investment_amount),
		active: row.active,
		lastPrice: row.last_price !== null ? Number(row.last_price) : null,
		totalProfit: Number(row.total_profit),
		fillCount: Number(row.fill_count),
		createdAt: row.created_at,
	};
}

export function mapGridExecutionRow(row: GridExecutionRow): GridExecution {
	return {
		id: row.id,
		botId: row.bot_id,
		userId: row.user_id,
		symbol: row.symbol,
		levelIndex: Number(row.level_index),
		levelPrice: Number(row.level_price),
		execType: row.exec_type === 'sell' ? 'sell' : 'buy',
		qty: Number(row.qty),
		amount: Number(row.amount),
		profit: Number(row.profit),
		executedAt: row.executed_at,
	};
}

// ─── Pure Calculation Functions ───────────────────────────────────────────────

/**
 * Compute all grid price levels (gridLevels + 1 prices) evenly spaced
 * between lowerPrice and upperPrice, inclusive.
 * Returns levels annotated with side (buy/sell) relative to currentPrice.
 */
export function calcGridLevels(
	lowerPrice: number,
	upperPrice: number,
	gridLevels: number,
	currentPrice: number
): GridLevel[] {
	const levelCount = gridLevels + 1; // N intervals → N+1 price points
	const spacing = (upperPrice - lowerPrice) / gridLevels;
	const levels: GridLevel[] = [];

	for (let i = 0; i < levelCount; i++) {
		const price = lowerPrice + i * spacing;
		levels.push({
			index: i,
			price,
			side: price < currentPrice ? 'buy' : 'sell',
			status: 'pending',
		});
	}

	return levels;
}

/**
 * Given a price movement from lastPrice → currentPrice,
 * return the indices of grid levels that were crossed.
 * - Moving DOWN: buy levels at prices between currentPrice and lastPrice (exclusive) are crossed.
 * - Moving UP: sell levels at prices between lastPrice and currentPrice (exclusive) are crossed.
 */
export function detectGridCrossings(
	levels: GridLevel[],
	lastPrice: number,
	currentPrice: number
): GridLevel[] {
	if (lastPrice === currentPrice) return [];

	const movingDown = currentPrice < lastPrice;
	const lo = Math.min(lastPrice, currentPrice);
	const hi = Math.max(lastPrice, currentPrice);

	return levels.filter((level) => {
		// Exclude the exact boundaries (only cross, not touch-and-bounce)
		if (level.price <= lo || level.price >= hi) return false;
		return movingDown ? level.side === 'buy' : level.side === 'sell';
	});
}

/**
 * Calculate the profit for a single grid sell execution.
 * profit = qty × gridSpacingAbs  (each completed cycle earns one grid interval)
 */
export function calcGridProfit(qty: number, gridSpacingAbs: number): number {
	return qty * gridSpacingAbs;
}

/**
 * Amount of USDT allocated per single grid level.
 */
export function calcAmountPerGrid(investmentAmount: number, gridLevels: number): number {
	return investmentAmount / gridLevels;
}

/**
 * Absolute price spacing between adjacent grid levels.
 */
export function calcGridSpacingAbs(
	lowerPrice: number,
	upperPrice: number,
	gridLevels: number
): number {
	return (upperPrice - lowerPrice) / gridLevels;
}

/**
 * Percentage grid spacing relative to midpoint price.
 */
export function calcGridSpacingPct(
	lowerPrice: number,
	upperPrice: number,
	gridLevels: number
): number {
	const spacing = calcGridSpacingAbs(lowerPrice, upperPrice, gridLevels);
	const midpoint = (lowerPrice + upperPrice) / 2;
	return midpoint > 0 ? (spacing / midpoint) * 100 : 0;
}

/**
 * Estimate annualised APY from completed grid cycles.
 * APY = (totalProfit / investmentAmount) × (365 / daysSinceCreation) × 100
 */
export function calcEstimatedAPY(
	totalProfit: number,
	investmentAmount: number,
	createdAt: string
): number {
	if (investmentAmount <= 0 || totalProfit <= 0) return 0;
	const now = Date.now();
	const createdMs = new Date(createdAt).getTime();
	const daysSinceCreation = (now - createdMs) / (1000 * 60 * 60 * 24);
	if (daysSinceCreation < 1) return 0;
	return (totalProfit / investmentAmount) * (365 / daysSinceCreation) * 100;
}

/**
 * Count matched buy-sell pairs in execution history (completed cycles).
 */
export function countCompletedCycles(executions: GridExecution[]): number {
	return executions.filter((e) => e.execType === 'sell').length;
}

/**
 * Compute all GridPerformance metrics.
 */
export function calcGridPerformance(
	bot: GridBot,
	executions: GridExecution[]
): GridPerformance {
	const spacingAbs = calcGridSpacingAbs(bot.lowerPrice, bot.upperPrice, bot.gridLevels);
	const spacingPct = calcGridSpacingPct(bot.lowerPrice, bot.upperPrice, bot.gridLevels);
	const amountPerGrid = calcAmountPerGrid(bot.investmentAmount, bot.gridLevels);
	const totalLevels = bot.gridLevels + 1;
	const filledLevels = Math.min(executions.length, totalLevels);
	const fillRate = totalLevels > 0 ? filledLevels / totalLevels : 0;
	const completedCycles = countCompletedCycles(executions);
	const estimatedAPY = calcEstimatedAPY(bot.totalProfit, bot.investmentAmount, bot.createdAt);

	return {
		totalProfit: bot.totalProfit,
		fillCount: bot.fillCount,
		completedCycles,
		fillRate,
		estimatedAPY,
		amountPerGrid,
		gridSpacing: spacingPct,
		gridSpacingAbs: spacingAbs,
	};
}

/**
 * Human-readable description of a grid bot config.
 */
export function describeGridBot(bot: GridBot): string {
	return `${bot.gridLevels} grids on ${bot.symbol} [$${bot.lowerPrice.toFixed(2)} – $${bot.upperPrice.toFixed(2)}], $${bot.investmentAmount.toFixed(0)} total`;
}

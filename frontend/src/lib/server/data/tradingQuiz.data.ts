// Trading Quiz Data — T-1403
// Question bank + score management for the interactive trading quiz
// Chart questions use real OHLCV data; static questions are curated

import type { OHLCV } from '$lib/types/contentBlock';
import { fetchOHLCV } from './ohlcvProvider';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuizCategory =
	| 'technical_analysis'
	| 'risk_management'
	| 'market_microstructure'
	| 'psychology'
	| 'macro';

export type QuizDifficulty = 'beginner' | 'intermediate' | 'advanced';

export type StaticQuestion = {
	id: string;
	category: QuizCategory;
	difficulty: QuizDifficulty;
	question: string;
	options: [string, string, string, string];
	correctIndex: 0 | 1 | 2 | 3;
	explanation: string;
	requiresChart: false;
};

export type ChartQuestionGenerated = {
	question: string;
	options: [string, string, string, string];
	correctIndex: 0 | 1 | 2 | 3;
	explanation: string;
};

export type ChartQuestionTemplate = {
	id: string;
	category: QuizCategory;
	difficulty: QuizDifficulty;
	requiresChart: true;
	symbol: string;
	interval: string;
	generate: (ohlcv: OHLCV[]) => ChartQuestionGenerated;
};

export type QuizQuestionTemplate = StaticQuestion | ChartQuestionTemplate;

export type ResolvedQuestion = {
	id: string;
	category: QuizCategory;
	difficulty: QuizDifficulty;
	question: string;
	options: [string, string, string, string];
	correctIndex: 0 | 1 | 2 | 3;
	explanation: string;
	requiresChart: boolean;
	symbol?: string;
	interval?: string;
	ohlcv?: OHLCV[];
};

export type QuizScore = {
	totalAnswered: number;
	totalCorrect: number;
	streak: number;
	bestStreak: number;
	byCategory: Partial<Record<QuizCategory, { answered: number; correct: number }>>;
};

// ─── OHLCV helpers (pure, no imports) ─────────────────────────────────────────

function sma(candles: OHLCV[], period: number): number {
	if (candles.length < period) return candles.reduce((s, c) => s + c.close, 0) / candles.length;
	return candles.slice(-period).reduce((s, c) => s + c.close, 0) / period;
}

function countGreenCandles(candles: OHLCV[], lookback: number): number {
	return candles.slice(-lookback).filter(c => c.close > c.open).length;
}

function calcRsi(candles: OHLCV[], period = 14): number {
	if (candles.length < period + 1) return 50;
	let gains = 0, losses = 0;
	for (let i = candles.length - period; i < candles.length; i++) {
		const delta = candles[i].close - candles[i - 1].close;
		if (delta > 0) gains += delta;
		else losses += Math.abs(delta);
	}
	const avgGain = gains / period;
	const avgLoss = losses / period;
	if (avgLoss === 0) return 100;
	const rs = avgGain / avgLoss;
	return Math.round(100 - 100 / (1 + rs));
}

// ─── Chart Question Templates ─────────────────────────────────────────────────

const CHART_TEMPLATES: ChartQuestionTemplate[] = [
	{
		id: 'ta_chart_ma20_position',
		category: 'technical_analysis',
		difficulty: 'beginner',
		requiresChart: true,
		symbol: 'BTCUSDT',
		interval: '4h',
		generate(ohlcv) {
			if (ohlcv.length < 20) {
				return {
					question: 'Looking at the BTC/USDT 4h chart, where is price relative to the 20-period MA?',
					options: ['Above MA (bullish)', 'Below MA (bearish)', 'At MA (neutral)', 'Cannot determine'],
					correctIndex: 2,
					explanation: 'Insufficient data to determine MA position.',
				};
			}
			const ma20 = sma(ohlcv, 20);
			const last = ohlcv[ohlcv.length - 1].close;
			const pctDiff = ((last - ma20) / ma20) * 100;
			const isAbove = pctDiff > 1;
			const isBelow = pctDiff < -1;
			const correctIndex: 0 | 1 | 2 = isAbove ? 0 : isBelow ? 1 : 2;
			const pctStr = Math.abs(pctDiff).toFixed(1);
			return {
				question: `Looking at the BTC/USDT 4h chart, where is price currently relative to the 20-period moving average (MA20)?`,
				options: ['Above MA (bullish signal)', 'Below MA (bearish signal)', 'At MA (neutral / at-test)', 'Cannot determine from chart'],
				correctIndex,
				explanation: isAbove
					? `Correct! Price is ${pctStr}% above MA20 at $${last.toFixed(0)}, indicating bullish momentum. When price trades above a moving average, it generally signals an uptrend.`
					: isBelow
					? `Correct! Price is ${pctStr}% below MA20 at $${last.toFixed(0)}, indicating bearish momentum. Price trading below its moving average often signals a downtrend.`
					: `Price is within 1% of MA20 ($${ma20.toFixed(0)}), making this a neutral/test scenario. Watch for a clear break above or below.`,
			};
		},
	},
	{
		id: 'ta_chart_green_candles',
		category: 'technical_analysis',
		difficulty: 'beginner',
		requiresChart: true,
		symbol: 'BTCUSDT',
		interval: '1d',
		generate(ohlcv) {
			const lookback = 5;
			const green = countGreenCandles(ohlcv, lookback);
			const red = lookback - green;
			// Correct is whichever count is right
			const correctIndex: 0 | 1 | 2 | 3 = green === 5 ? 0 : green === 4 ? 1 : green === 3 ? 2 : green <= 2 ? 3 : 2;
			return {
				question: `Looking at the last ${lookback} daily BTC/USDT candles on the chart, how many are green (bullish / close > open)?`,
				options: ['5 green candles', '4 green candles', '3 green candles', '2 or fewer green candles'],
				correctIndex,
				explanation: `In the last ${lookback} daily candles, ${green} are green and ${red} are red. ${
					green >= 4 ? 'Strong bullish momentum!' : green >= 3 ? 'Slightly bullish bias.' : 'Bearish bias — more red than green candles recently.'
				}`,
			};
		},
	},
	{
		id: 'ta_chart_rsi_zone',
		category: 'technical_analysis',
		difficulty: 'intermediate',
		requiresChart: true,
		symbol: 'BTCUSDT',
		interval: '1d',
		generate(ohlcv) {
			const rsi = calcRsi(ohlcv, 14);
			const isOverbought = rsi >= 70;
			const isOversold = rsi <= 30;
			const correctIndex: 0 | 1 | 2 | 3 = isOverbought ? 0 : isOversold ? 1 : rsi > 50 ? 2 : 3;
			return {
				question: `Looking at the daily BTC/USDT chart, the RSI(14) is currently at ${rsi}. Which zone best describes this reading?`,
				options: ['Overbought (≥70) — potential reversal warning', 'Oversold (≤30) — potential bounce zone', 'Bullish momentum (50–70)', 'Bearish momentum (30–50)'],
				correctIndex,
				explanation: `RSI at ${rsi} is ${
					isOverbought ? 'overbought. This does NOT guarantee a reversal — assets can stay overbought in strong uptrends — but it signals caution for new longs.'
					: isOversold ? 'oversold. This signals potential exhaustion in selling pressure. Look for bullish divergence or candlestick confirmation before entering long.'
					: rsi > 50 ? 'in the bullish momentum zone (50–70). This is often the sweet spot for trend-following longs.'
					: 'in the bearish momentum zone (30–50). Bulls struggle to gain control here.'
				}`,
			};
		},
	},
];

// ─── Static Question Bank ─────────────────────────────────────────────────────

const STATIC_QUESTIONS: StaticQuestion[] = [
	// === Technical Analysis ===
	{
		id: 'ta_1',
		category: 'technical_analysis',
		difficulty: 'beginner',
		question: 'A "golden cross" occurs when:',
		options: [
			'The 50-period MA crosses above the 200-period MA',
			'Price breaks above a resistance level',
			'RSI crosses above 70',
			'Volume spikes 3x above average',
		],
		correctIndex: 0,
		explanation: 'A golden cross is a bullish signal where the 50-period moving average crosses above the 200-period MA. It indicates that short-term momentum is exceeding long-term momentum, attracting trend-following buyers.',
		requiresChart: false,
	},
	{
		id: 'ta_2',
		category: 'technical_analysis',
		difficulty: 'beginner',
		question: 'Which RSI reading signals an overbought condition?',
		options: ['Below 30', 'Between 40–60', 'Above 70', 'Above 50'],
		correctIndex: 2,
		explanation: 'RSI above 70 is traditionally considered overbought, suggesting the asset may be overextended to the upside. However, in strong trends RSI can stay above 70 for extended periods — always confirm with price action.',
		requiresChart: false,
	},
	{
		id: 'ta_3',
		category: 'technical_analysis',
		difficulty: 'intermediate',
		question: 'A head-and-shoulders pattern signals:',
		options: [
			'Trend continuation to the upside',
			'A bearish reversal from an uptrend',
			'A bullish reversal from a downtrend',
			'A sideways consolidation',
		],
		correctIndex: 1,
		explanation: 'The head-and-shoulders is a classic bearish reversal pattern. It has a left shoulder, a higher peak (head), and a right shoulder. A break below the neckline confirms the reversal. The price target is the height of the head projected downward from the neckline.',
		requiresChart: false,
	},
	{
		id: 'ta_4',
		category: 'technical_analysis',
		difficulty: 'intermediate',
		question: 'In an uptrend, a Fibonacci retracement to the 0.618 level is considered:',
		options: [
			'A strong resistance zone to short',
			'The "golden ratio" — a key support level for continuation',
			'A sign the uptrend has ended',
			'Less significant than the 0.236 level',
		],
		correctIndex: 1,
		explanation: 'The 0.618 Fibonacci level (the "golden ratio") is typically the deepest retracement before continuation in a healthy uptrend. Traders look for confluence (support + indicator confluence + volume) at this level to enter with the trend.',
		requiresChart: false,
	},
	{
		id: 'ta_5',
		category: 'technical_analysis',
		difficulty: 'advanced',
		question: 'Bearish divergence on RSI means:',
		options: [
			'Price makes a lower high while RSI makes a higher high',
			'Price makes a higher high while RSI makes a lower high',
			'Price and RSI both make higher highs',
			'RSI crosses below its signal line',
		],
		correctIndex: 1,
		explanation: 'Bearish divergence: price prints a new higher high, but RSI fails to confirm — it makes a lower high. This shows weakening momentum even as price rises, often preceding a reversal. The bigger the divergence, the stronger the signal.',
		requiresChart: false,
	},
	{
		id: 'ta_6',
		category: 'technical_analysis',
		difficulty: 'beginner',
		question: 'A breakout on HIGH volume compared to average is:',
		options: [
			'A sign the move is likely to reverse quickly',
			'Confirmation the move has institutional backing and is more reliable',
			'Irrelevant — volume does not confirm price moves',
			'Only valid for bearish breakouts',
		],
		correctIndex: 1,
		explanation: 'Volume confirms breakouts. High volume on a breakout indicates institutional participation and conviction. Low-volume breakouts often fail or become "fakeouts." Always look for volume expansion on the breakout candle.',
		requiresChart: false,
	},
	{
		id: 'ta_7',
		category: 'technical_analysis',
		difficulty: 'intermediate',
		question: 'The Exponential Moving Average (EMA) differs from the Simple Moving Average (SMA) because:',
		options: [
			'EMA uses only closing prices; SMA uses all OHLCV data',
			'EMA gives more weight to recent prices, making it more responsive',
			'EMA is calculated over a longer lookback period',
			'EMA is better for detecting reversals; SMA for trends',
		],
		correctIndex: 1,
		explanation: 'EMA applies an exponential weighting multiplier, giving more importance to recent data. This makes it react faster to new price movements compared to SMA. Traders often use EMA for faster signals (e.g., 9 EMA, 21 EMA) and SMA for longer-term trend filters (200 SMA).',
		requiresChart: false,
	},

	// === Risk Management ===
	{
		id: 'rm_1',
		category: 'risk_management',
		difficulty: 'beginner',
		question: 'You have a $10,000 account. Your max risk per trade is 1%. Your stop-loss is 5% away from entry. What is your maximum position size?',
		options: ['$500', '$2,000', '$1,000', '$10,000'],
		correctIndex: 1,
		explanation: 'Max risk amount = $10,000 × 1% = $100. Position size = $100 / 5% = $2,000. This ensures a 5% stop-loss only costs you $100 (1% of account). Formula: Position Size = (Account × Risk%) / Stop%.',
		requiresChart: false,
	},
	{
		id: 'rm_2',
		category: 'risk_management',
		difficulty: 'beginner',
		question: 'A trade has a 2:1 Risk-Reward ratio. If your stop-loss risk is $100, your minimum target profit should be:',
		options: ['$100', '$150', '$200', '$50'],
		correctIndex: 2,
		explanation: 'R:R 2:1 means for every $1 you risk, you target $2 profit. If you risk $100, your target is $200. A 2:1 R:R is the minimum recommended ratio because it allows you to be profitable even with a 50% win rate.',
		requiresChart: false,
	},
	{
		id: 'rm_3',
		category: 'risk_management',
		difficulty: 'intermediate',
		question: 'What is the primary purpose of the Kelly Criterion in trading?',
		options: [
			'Determining the optimal entry price',
			'Calculating the optimal position size based on edge and win rate',
			'Setting stop-loss levels',
			'Measuring portfolio correlation',
		],
		correctIndex: 1,
		explanation: 'The Kelly Criterion computes the optimal bet/position size to maximize long-term geometric growth: f* = (p × b - q) / b, where p = win probability, q = 1-p, b = win/loss ratio. In practice, traders use "half Kelly" or less to reduce volatility.',
		requiresChart: false,
	},
	{
		id: 'rm_4',
		category: 'risk_management',
		difficulty: 'intermediate',
		question: 'You lose 40% of your account. How much do you need to gain to return to breakeven?',
		options: ['40%', '50%', '66.7%', '80%'],
		correctIndex: 2,
		explanation: 'After a 40% loss: $10,000 → $6,000. To recover to $10,000 from $6,000 requires a gain of $4,000 / $6,000 = 66.7%. This asymmetry is why limiting drawdowns is critical — losses hurt more than equivalent gains help.',
		requiresChart: false,
	},
	{
		id: 'rm_5',
		category: 'risk_management',
		difficulty: 'advanced',
		question: 'Two highly correlated positions (correlation 0.95) in a portfolio are best described as:',
		options: [
			'Well-diversified — two independent sources of return',
			'Almost equivalent to one larger position — minimal diversification benefit',
			'Hedged — they cancel each other out',
			'Twice as risky as one position due to compounding',
		],
		correctIndex: 1,
		explanation: 'A correlation of 0.95 means the positions move almost identically. Holding both is essentially equivalent to one large position — you get almost no diversification benefit. True diversification requires low or negative correlations between assets.',
		requiresChart: false,
	},
	{
		id: 'rm_6',
		category: 'risk_management',
		difficulty: 'advanced',
		question: 'What does Value at Risk (VaR) at 95% confidence measure?',
		options: [
			'The maximum possible loss under any scenario',
			'The minimum loss you will experience 95% of the time',
			'The maximum loss expected 95% of the time (worst 5% excluded)',
			'Average daily loss over the past 95 days',
		],
		correctIndex: 2,
		explanation: 'VaR at 95% confidence means: there is a 5% chance of losing MORE than the VaR amount over the specified period. E.g., 1-day 95% VaR of $500 means on 5% of days, you can expect to lose more than $500. Importantly, VaR says nothing about HOW MUCH more you might lose in the worst 5%.',
		requiresChart: false,
	},

	// === Market Microstructure ===
	{
		id: 'mm_1',
		category: 'market_microstructure',
		difficulty: 'beginner',
		question: 'The "bid-ask spread" represents:',
		options: [
			'The difference between today\'s high and low price',
			'The difference between the highest buy order and lowest sell order',
			'The daily price change percentage',
			'The difference between spot and futures price',
		],
		correctIndex: 1,
		explanation: 'The bid is the highest price a buyer is willing to pay; the ask is the lowest price a seller is willing to accept. The spread between them is the transaction cost for market orders. Tighter spreads = more liquid market = lower cost to enter/exit.',
		requiresChart: false,
	},
	{
		id: 'mm_2',
		category: 'market_microstructure',
		difficulty: 'beginner',
		question: 'A "market order" differs from a "limit order" in that:',
		options: [
			'Market orders are cheaper to execute',
			'Market orders execute immediately at the best available price; limit orders only execute at a specified price',
			'Limit orders are always filled faster',
			'Market orders require margin; limit orders do not',
		],
		correctIndex: 1,
		explanation: 'Market orders execute immediately at the best available price (you are a price-taker). Limit orders only execute if price reaches your specified level (you are a price-maker). Market orders guarantee execution but not price; limit orders guarantee price but not execution.',
		requiresChart: false,
	},
	{
		id: 'mm_3',
		category: 'market_microstructure',
		difficulty: 'intermediate',
		question: 'In a thin (illiquid) market, large buy orders tend to:',
		options: [
			'Execute at better prices due to less competition',
			'Cause significant upward price impact (slippage)',
			'Reduce the bid-ask spread',
			'Have no effect on price if placed as limit orders',
		],
		correctIndex: 1,
		explanation: 'In illiquid markets, there aren\'t enough sell orders at current prices to fill a large buy order. The order "walks the book" — consuming sell orders at increasingly higher prices. This slippage is why professional traders use TWAP/VWAP algorithms to break large orders into smaller pieces.',
		requiresChart: false,
	},
	{
		id: 'mm_4',
		category: 'market_microstructure',
		difficulty: 'intermediate',
		question: 'The futures basis (futures price - spot price) is typically positive (futures > spot) because:',
		options: [
			'Futures markets are more liquid than spot markets',
			'It reflects the cost of carry: interest rates, storage costs, and convenience yield',
			'Futures prices always predict future spot prices accurately',
			'Exchanges charge a premium for leveraged products',
		],
		correctIndex: 1,
		explanation: 'The basis reflects cost of carry: to hold a position until futures expiry, you must fund it (interest cost). A positive basis (contango) means the market expects higher prices or cost of carry is positive. Negative basis (backwardation) occurs when spot demand is very high or convenience yield is large (e.g., oil, gold).',
		requiresChart: false,
	},
	{
		id: 'mm_5',
		category: 'market_microstructure',
		difficulty: 'advanced',
		question: 'What is "order flow toxicity" and why does it matter to market makers?',
		options: [
			'High-frequency orders that clog exchange systems',
			'Informed traders\' orders that consistently move against market makers',
			'Orders placed without proper authorization',
			'Orders that violate exchange rules',
		],
		correctIndex: 1,
		explanation: 'Order flow toxicity measures how often market makers get "picked off" by informed traders who know more than them. When toxicity is high, market makers widen their spreads to compensate. VPIN (Volume-synchronized Probability of Informed Trading) is a common toxicity measure — spikes in VPIN often precede volatility events.',
		requiresChart: false,
	},
	{
		id: 'mm_6',
		category: 'market_microstructure',
		difficulty: 'beginner',
		question: 'Funding rates in perpetual futures contracts are used to:',
		options: [
			'Pay daily profits to profitable traders',
			'Keep perpetual futures prices anchored to spot prices',
			'Fund exchange insurance funds',
			'Pay network fees to blockchain validators',
		],
		correctIndex: 1,
		explanation: 'Perpetual futures have no expiry, so funding rates are used to align futures price with spot. When perpetuals trade above spot (positive funding), longs pay shorts — incentivizing shorts to bring price down. When below spot (negative funding), shorts pay longs.',
		requiresChart: false,
	},

	// === Psychology ===
	{
		id: 'psy_1',
		category: 'psychology',
		difficulty: 'beginner',
		question: 'You enter a long trade at $100. It drops to $90 and you hold, hoping it recovers. This is an example of:',
		options: [
			'Sound risk management — waiting for a setup to develop',
			'Loss aversion — the pain of losses feels worse than equivalent gains',
			'Overconfidence bias',
			'Recency bias',
		],
		correctIndex: 1,
		explanation: 'Loss aversion (Kahneman & Tversky) shows humans feel losses ~2x more intensely than equivalent gains. Traders hold losers hoping for a recovery ("it will come back") rather than accepting a small loss. This leads to small losses becoming large losses. Solution: set stop-losses BEFORE entering.',
		requiresChart: false,
	},
	{
		id: 'psy_2',
		category: 'psychology',
		difficulty: 'beginner',
		question: 'You just lost 3 trades in a row and you increase your position size to "win it back." This is called:',
		options: ['Martingale strategy', 'Revenge trading', 'Pyramiding', 'Averaging down'],
		correctIndex: 1,
		explanation: 'Revenge trading is emotionally-driven trading to recoup losses quickly. It breaks your risk management rules, ignores your edge, and is driven by ego/frustration. It typically makes losses worse. Solution: step away from the screen after consecutive losses.',
		requiresChart: false,
	},
	{
		id: 'psy_3',
		category: 'psychology',
		difficulty: 'intermediate',
		question: 'You research a trade and only seek information that confirms your bullish view. This is:',
		options: ['Due diligence', 'Confirmation bias', 'Overconfidence', 'Availability bias'],
		correctIndex: 1,
		explanation: 'Confirmation bias is the tendency to search for and favor information that confirms existing beliefs while ignoring contradictory evidence. Solution: actively seek out the bearish case before entering. Ask: "Why am I wrong?" Good traders steelman the opposing view.',
		requiresChart: false,
	},
	{
		id: 'psy_4',
		category: 'psychology',
		difficulty: 'intermediate',
		question: 'A stock was at $200 last year. Now at $80 you think it\'s "cheap" because of that $200 reference. This cognitive error is:',
		options: ['Value investing', 'Anchoring bias', 'Mean reversion strategy', 'Contrarian analysis'],
		correctIndex: 1,
		explanation: 'Anchoring bias: using an irrelevant reference point ($200 peak) to judge current value. The stock could be fair value at $80 or headed to $20 — the old high is irrelevant. Valuations should be based on fundamentals and current market conditions, not arbitrary past prices.',
		requiresChart: false,
	},
	{
		id: 'psy_5',
		category: 'psychology',
		difficulty: 'advanced',
		question: 'The "disposition effect" in trading refers to traders\' tendency to:',
		options: [
			'Sell winning positions too early and hold losing positions too long',
			'Sell losing positions immediately and let winners run',
			'Trade more frequently during bull markets',
			'Avoid trading after a major news event',
		],
		correctIndex: 0,
		explanation: 'The disposition effect (Shefrin & Statman) is one of the most documented trading biases: traders sell winners to "lock in gains" (loss aversion in reverse) but hold losers to avoid realizing a loss. This is the opposite of good trading practice ("cut losers, let winners run").',
		requiresChart: false,
	},

	// === Macro ===
	{
		id: 'mac_1',
		category: 'macro',
		difficulty: 'beginner',
		question: 'When the Federal Reserve raises interest rates, what typically happens to stock prices in the short-term?',
		options: [
			'Stocks typically rise because higher rates signal economic strength',
			'Stocks typically fall because higher rates increase discount rates and reduce present value of future earnings',
			'Stocks are unaffected — rates only impact bonds',
			'Stocks rise because investors move from bonds to equities',
		],
		correctIndex: 1,
		explanation: 'Higher interest rates increase the discount rate used in DCF models, reducing the present value of future earnings. They also make bonds more attractive relative to stocks and increase borrowing costs. The typical reaction is a sell-off in growth stocks (long-duration assets) while value/dividend stocks are less affected.',
		requiresChart: false,
	},
	{
		id: 'mac_2',
		category: 'macro',
		difficulty: 'intermediate',
		question: 'An inverted yield curve (short-term rates > long-term rates) historically signals:',
		options: [
			'Accelerating economic growth',
			'A high likelihood of recession within 12–18 months',
			'Hyperinflation',
			'Currency devaluation',
		],
		correctIndex: 1,
		explanation: 'The inverted yield curve (specifically 2y10y or 3m10y) has preceded every U.S. recession since the 1960s. It indicates the market expects the Fed to cut rates in the future (recession response), and reflects tight monetary conditions. The lag between inversion and recession is typically 12–18 months.',
		requiresChart: false,
	},
	{
		id: 'mac_3',
		category: 'macro',
		difficulty: 'beginner',
		question: 'A strengthening U.S. Dollar (DXY rising) typically has what effect on commodity prices?',
		options: [
			'Commodities rise — strong dollar means strong demand',
			'Commodities fall — most commodities are priced in USD, making them more expensive for foreign buyers',
			'No effect — commodities trade independently of currencies',
			'Commodities rise because USD strength attracts capital inflows',
		],
		correctIndex: 1,
		explanation: 'Most commodities (gold, oil, copper, crypto) are priced in USD. When the dollar strengthens, foreign buyers need more of their local currency to buy commodities → demand drops → prices fall. This is why DXY and gold/oil often have an inverse relationship.',
		requiresChart: false,
	},
	{
		id: 'mac_4',
		category: 'macro',
		difficulty: 'intermediate',
		question: 'A PMI (Purchasing Managers\' Index) reading above 50 indicates:',
		options: [
			'Inflation above 50% annually',
			'Manufacturing/services sector is expanding',
			'Unemployment is above 50% of the population',
			'GDP is growing at 50% annually',
		],
		correctIndex: 1,
		explanation: 'PMI is a diffusion index: above 50 = more managers report expansion than contraction (expansion). Below 50 = contraction. It\'s a leading economic indicator released monthly and watched closely as an early signal for GDP direction. Flash PMI provides the first estimate.',
		requiresChart: false,
	},
	{
		id: 'mac_5',
		category: 'macro',
		difficulty: 'advanced',
		question: 'The "carry trade" involves:',
		options: [
			'Holding physical commodities to earn storage premiums',
			'Borrowing in a low-interest-rate currency and investing in a high-interest-rate currency',
			'Buying futures and rolling them forward each month',
			'Holding correlated assets to earn convergence profits',
		],
		correctIndex: 1,
		explanation: 'The carry trade borrows cheaply (e.g., Japanese Yen at ~0%) and invests in high-yield currencies or assets. It profits from interest rate differentials. The risk: a sudden unwinding (carry trade unwind) can cause violent moves — when risk-off hits, carry traders rush to repay loans, strengthening the funding currency (JPY) sharply.',
		requiresChart: false,
	},
];

// ─── Score helpers ─────────────────────────────────────────────────────────────

export function defaultScore(): QuizScore {
	return {
		totalAnswered: 0,
		totalCorrect: 0,
		streak: 0,
		bestStreak: 0,
		byCategory: {},
	};
}

export function getAdaptiveDifficulty(score: QuizScore): QuizDifficulty {
	if (score.totalAnswered < 5) return 'beginner';
	const accuracy = score.totalAnswered > 0 ? score.totalCorrect / score.totalAnswered : 0;
	if (accuracy >= 0.75) return 'advanced';
	if (accuracy >= 0.55) return 'intermediate';
	return 'beginner';
}

export function calcLevel(score: QuizScore): string {
	const diff = getAdaptiveDifficulty(score);
	const accuracy = score.totalAnswered > 0 ? Math.round((score.totalCorrect / score.totalAnswered) * 100) : 0;
	if (diff === 'advanced' && accuracy >= 80) return 'Expert Trader';
	if (diff === 'advanced') return 'Advanced Trader';
	if (diff === 'intermediate') return 'Intermediate Trader';
	return 'Developing Trader';
}

export function getCategoryAccuracy(score: QuizScore, category: QuizCategory): number {
	const cat = score.byCategory[category];
	if (!cat || cat.answered === 0) return 0;
	return Math.round((cat.correct / cat.answered) * 100);
}

export function getStrongestCategory(score: QuizScore): string {
	const cats = Object.entries(score.byCategory) as [QuizCategory, { answered: number; correct: number }][];
	const active = cats.filter(([, v]) => v.answered >= 2);
	if (active.length === 0) return 'N/A';
	const best = active.reduce((a, b) => (b[1].correct / b[1].answered > a[1].correct / a[1].answered ? b : a));
	return best[0].replace(/_/g, ' ');
}

// ─── Question selection ────────────────────────────────────────────────────────

export function getAllTemplates(): QuizQuestionTemplate[] {
	return [...STATIC_QUESTIONS, ...CHART_TEMPLATES];
}

export function getStaticQuestions(): StaticQuestion[] {
	return STATIC_QUESTIONS;
}

export function getChartTemplates(): ChartQuestionTemplate[] {
	return CHART_TEMPLATES;
}

/**
 * Select a question template based on category, difficulty, and used IDs.
 * Returns null if no eligible question found.
 */
export function selectTemplate(
	category: QuizCategory | 'random',
	difficulty: QuizDifficulty | 'adaptive',
	score: QuizScore,
	usedIds: string[] = [],
): QuizQuestionTemplate | null {
	const effectiveDiff = difficulty === 'adaptive' ? getAdaptiveDifficulty(score) : difficulty;
	const usedSet = new Set(usedIds);

	let pool = getAllTemplates().filter(q => !usedSet.has(q.id));

	if (category !== 'random') {
		pool = pool.filter(q => q.category === category);
	}

	// Try exact difficulty match first, then relax
	let candidates = pool.filter(q => q.difficulty === effectiveDiff);
	if (candidates.length === 0) candidates = pool;
	if (candidates.length === 0) return null;

	// Random pick
	const idx = Math.floor(Math.random() * candidates.length);
	return candidates[idx];
}

// ─── Question resolution ───────────────────────────────────────────────────────

/**
 * Resolves a question template to a ready-to-display ResolvedQuestion.
 * For chart templates, fetches real OHLCV and generates question dynamically.
 */
export async function resolveQuestion(template: QuizQuestionTemplate): Promise<ResolvedQuestion> {
	if (!template.requiresChart) {
		// Static question — already resolved
		return {
			id: template.id,
			category: template.category,
			difficulty: template.difficulty,
			question: template.question,
			options: template.options,
			correctIndex: template.correctIndex,
			explanation: template.explanation,
			requiresChart: false,
		};
	}

	// Chart template — fetch OHLCV and generate
	const ohlcvResult = await fetchOHLCV(template.symbol, template.interval, 100);
	if ('error' in ohlcvResult) {
		// Fallback: skip chart, return a static fallback
		return {
			id: template.id,
			category: template.category,
			difficulty: template.difficulty,
			question: `Chart data unavailable for ${template.symbol}. What does a rising 20-period MA generally indicate?`,
			options: ['Bearish trend', 'Bullish trend / upward momentum', 'Overbought condition', 'Divergence signal'],
			correctIndex: 1,
			explanation: 'A rising moving average indicates upward momentum in price over the lookback period.',
			requiresChart: false,
		};
	}

	const ohlcv = ohlcvResult.ohlcv;
	const generated = template.generate(ohlcv);

	return {
		id: template.id,
		category: template.category,
		difficulty: template.difficulty,
		question: generated.question,
		options: generated.options,
		correctIndex: generated.correctIndex,
		explanation: generated.explanation,
		requiresChart: true,
		symbol: template.symbol,
		interval: template.interval,
		ohlcv,
	};
}

// ─── Answer evaluation ─────────────────────────────────────────────────────────

export type EvaluateResult = {
	correct: boolean;
	selectedIndex: number;
	correctIndex: number;
	explanation: string;
	updatedScore: QuizScore;
};

export function evaluateAnswer(
	question: ResolvedQuestion,
	selectedIndex: number,
	prevScore: QuizScore,
): EvaluateResult {
	const correct = selectedIndex === question.correctIndex;

	// Update category stats
	const catStats = prevScore.byCategory[question.category] ?? { answered: 0, correct: 0 };
	const updatedCat = {
		answered: catStats.answered + 1,
		correct: catStats.correct + (correct ? 1 : 0),
	};

	const newStreak = correct ? prevScore.streak + 1 : 0;
	const newBestStreak = Math.max(prevScore.bestStreak, newStreak);

	const updatedScore: QuizScore = {
		totalAnswered: prevScore.totalAnswered + 1,
		totalCorrect: prevScore.totalCorrect + (correct ? 1 : 0),
		streak: newStreak,
		bestStreak: newBestStreak,
		byCategory: {
			...prevScore.byCategory,
			[question.category]: updatedCat,
		},
	};

	return {
		correct,
		selectedIndex,
		correctIndex: question.correctIndex,
		explanation: question.explanation,
		updatedScore,
	};
}

/** OHLCV candle. `time` is the bar open time in ms epoch (UTC-aligned). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Direction = "bull" | "bear" | "neutral";

export interface Signal {
  label: string;
  direction: Direction;
  detail?: string;
}

export interface PatternHit {
  name: string;
  direction: Direction;
}

export interface SmcEvent {
  type: string;
  direction: Direction;
  label: string;
}

/** Weighted category scores, each in the range -100 (max bearish) to +100 (max bullish). */
export interface CategoryScores {
  trend: number;
  momentum: number;
  volume: number;
  structure: number;
  confluence: number;
}

export type Recommendation = "UP" | "DOWN" | "WAIT";

/** Live PancakeSwap prize pool amounts for the round being predicted (BNB). */
export interface PoolInfo {
  bullBnb: number;
  bearBnb: number;
  totalBnb: number;
}

/**
 * Fifth Dimension engine output — the dimensions the base indicators can't see:
 * lock-gap vs remaining noise (a physics model of the close), time decay,
 * and payout-aware expected value from the live prize pools.
 */
export interface FifthDimension {
  /** Current price minus lock price, $. */
  gap: number;
  /** 1σ expected drift over the remaining seconds, $. */
  sigmaRemaining: number;
  /** Gap below this is statistically meaningless noise, $. */
  noiseFloor: number;
  /** Gap expressed in remaining-volatility standard deviations. */
  zScore: number;
  /** Probability of closing above lock from the gap/noise model alone (0..100). */
  gapProbUp: number;
  /** Weight of the gap model in the final blended probability (0..1), grows as time runs out. */
  blendWeight: number;
  /** True when the round outcome is inside random noise — no side has an edge. */
  coinFlip: boolean;
  /** Live payout multiplier for UP (null when pools unavailable). */
  payoutUp: number | null;
  /** Live payout multiplier for DOWN (null when pools unavailable). */
  payoutDown: number | null;
  /** Expected value per 1 staked on UP at the blended probability. */
  evUp: number;
  /** Expected value per 1 staked on DOWN at the blended probability. */
  evDown: number;
  /** True when EV uses the assumed 1.95x payout instead of live pools. */
  evEstimated: boolean;
  /** Which side the crowd is stacked on (thin payout side). */
  crowd: "up-heavy" | "down-heavy" | "balanced" | null;
  signals: Signal[];
  verdict: string;
}

/** Full snapshot produced by the prediction engine on every tick. */
export interface Analysis {
  time: number;
  price: number;
  candleDirection: "green" | "red" | "flat";
  consecGreen: number;
  consecRed: number;
  patterns: PatternHit[];
  priceAction: { bullScore: number; bearScore: number; signals: Signal[] };
  volume: {
    current: number;
    average: number;
    relative: number;
    spike: boolean;
    expansion: boolean;
    divergence: Direction;
    bullPressure: number;
    bearPressure: number;
    signals: Signal[];
  };
  trend: {
    ema9: number;
    ema20: number;
    ema50: number;
    ema200: number;
    aboveCount: number;
    cross: "golden" | "death" | null;
    strength: number;
    signals: Signal[];
  };
  momentum: {
    rsi: number;
    macd: number;
    macdSignal: number;
    macdHist: number;
    stochRsi: number;
    strength: number;
    bullCount: number;
    bearCount: number;
    neutralCount: number;
    signals: Signal[];
  };
  vwap: { value: number; distancePct: number; bias: Direction; signals: Signal[] };
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
    widthPct: number;
    state: "expansion" | "compression" | "normal";
    event: "breakout-up" | "breakout-down" | "rejection-upper" | "rejection-lower" | null;
    signals: Signal[];
  };
  smc: SmcEvent[];
  categories: CategoryScores;
  totalScore: number;
  upProbability: number;
  downProbability: number;
  confidence: number;
  expectedMovePct: number;
  expectedDirection: "up" | "down" | "flat";
  recommendation: Recommendation;
  narrative: string;
  fifth: FifthDimension;
}

/** Compact indicator snapshot stored per round for backtesting and replay. */
export interface RoundSnapshot {
  consecGreen: number;
  consecRed: number;
  rsi: number;
  stochRsi: number;
  macdHist: number;
  volumeRelative: number;
  volumeSpike: boolean;
  bullPressure: number;
  emaAboveCount: number;
  emaCross: "golden" | "death" | null;
  vwapSide: "above" | "below";
  bbEvent: string | null;
  patterns: string[];
  smc: string[];
  categories: CategoryScores;
  narrative: string;
  expectedMovePct: number;
  /** Fifth Dimension fields (absent on records saved before the engine existed). */
  gapZ?: number;
  coinFlip?: boolean;
  evUp?: number;
  evDown?: number;
}

export interface RoundRecord {
  id: number;
  startTime: number;
  lockPrice: number;
  closePrice: number;
  result: "UP" | "DOWN" | "FLAT";
  movePct: number;
  predictedUp: number;
  confidence: number;
  /** The LOGGED call — trend-regime gated. WAIT unless the tape was trending and the call rode the trend. */
  recommendation: Recommendation;
  /** What the indicators called before the trend-regime gate (absent on old records). */
  rawRecommendation?: Recommendation;
  /** Behavioral regime at lock time (absent on old records). */
  regimeKind?: "trend-up" | "trend-down" | "chop" | "storm";
  regimeLabel?: string;
  live: boolean;
  /** True when this round came from an imported PancakeSwap history CSV (real Chainlink prices). */
  imported?: boolean;
  /** The side the user actually bet in the imported round, if any. */
  userSide?: "UP" | "DOWN";
  /** The user's stake in that round (export units, usually BNB). */
  betAmount?: number;
  snapshot: RoundSnapshot;
}

export interface AlertItem {
  id: string;
  time: number;
  type: string;
  message: string;
  direction: Direction;
  severity: "info" | "high" | "critical";
}

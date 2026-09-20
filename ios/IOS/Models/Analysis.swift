import Foundation

nonisolated enum Direction: String, Sendable {
    case bull
    case bear
    case neutral
}

nonisolated struct Signal: Identifiable, Sendable {
    let label: String
    let direction: Direction
    var detail: String?

    var id: String { label }
}

nonisolated struct PatternHit: Identifiable, Sendable {
    let name: String
    let direction: Direction

    var id: String { name }
}

nonisolated struct SmcEvent: Identifiable, Sendable {
    let type: String
    let direction: Direction
    let label: String

    var id: String { type + label }
}

nonisolated enum Recommendation: String, Sendable {
    case up = "UP"
    case down = "DOWN"
    case wait = "WAIT"
}

nonisolated enum CandleDirection: String, Sendable {
    case green
    case red
    case flat
}

/// Weighted category scores, each −100 (max bearish) to +100 (max bullish).
nonisolated struct CategoryScores: Sendable {
    let trend: Double
    let momentum: Double
    let volume: Double
    let structure: Double
    let confluence: Double
}

/// Adaptive weights applied to each category before blending.
nonisolated struct CategoryWeights: Sendable {
    let trend: Double
    let momentum: Double
    let volume: Double
    let structure: Double
    let confluence: Double

    static let base = CategoryWeights(trend: 0.25, momentum: 0.20, volume: 0.20, structure: 0.15, confluence: 0.20)
}

/// Live PancakeSwap prize pool for the round being predicted, in BNB.
nonisolated struct PoolInfo: Sendable {
    let bullBnb: Double
    let bearBnb: Double
    let totalBnb: Double
}

/// The dimensions indicators can't see: gap physics, time decay, noise floor, payout EV.
nonisolated struct FifthDimension: Sendable {
    let gap: Double
    let sigmaRemaining: Double
    let noiseFloor: Double
    let zScore: Double
    let gapProbUp: Double
    let blendWeight: Double
    let coinFlip: Bool
    let payoutUp: Double?
    let payoutDown: Double?
    let evUp: Double
    let evDown: Double
    let evEstimated: Bool
    let crowd: Crowd?
    let signals: [Signal]
    let verdict: String

    nonisolated enum Crowd: String, Sendable {
        case upHeavy = "up-heavy"
        case downHeavy = "down-heavy"
        case balanced
    }
}

nonisolated struct PriceActionBlock: Sendable {
    let bullScore: Double
    let bearScore: Double
    let signals: [Signal]
}

nonisolated struct VolumeBlock: Sendable {
    let current: Double
    let average: Double
    let relative: Double
    let spike: Bool
    let expansion: Bool
    let divergence: Direction
    let bullPressure: Double
    let bearPressure: Double
    let signals: [Signal]
}

nonisolated struct TrendBlock: Sendable {
    let ema9: Double
    let ema20: Double
    let ema50: Double
    let ema200: Double
    let aboveCount: Int
    let cross: Cross?
    let strength: Double
    let signals: [Signal]

    nonisolated enum Cross: String, Sendable {
        case golden
        case death
    }
}

nonisolated struct MomentumBlock: Sendable {
    let rsi: Double
    let macd: Double
    let macdSignal: Double
    let macdHist: Double
    let stochRsi: Double
    let strength: Double
    let signals: [Signal]
}

nonisolated struct VwapBlock: Sendable {
    let value: Double
    let distancePct: Double
    let bias: Direction
    let signals: [Signal]
}

nonisolated struct BollingerBlock: Sendable {
    let upper: Double
    let middle: Double
    let lower: Double
    let widthPct: Double
    let state: State
    let event: Event?
    let signals: [Signal]

    nonisolated enum State: String, Sendable {
        case expansion
        case compression
        case normal
    }

    nonisolated enum Event: String, Sendable {
        case breakoutUp = "Breakout above upper band"
        case breakoutDown = "Breakdown below lower band"
        case rejectionUpper = "Rejection at upper band"
        case rejectionLower = "Rejection at lower band"
    }
}

/// Full snapshot produced by the prediction engine on every tick.
nonisolated struct Analysis: Sendable {
    let time: Date
    let price: Double
    let candleDirection: CandleDirection
    let consecGreen: Int
    let consecRed: Int
    let patterns: [PatternHit]
    let priceAction: PriceActionBlock
    let volume: VolumeBlock
    let trend: TrendBlock
    let momentum: MomentumBlock
    let vwap: VwapBlock
    let bollinger: BollingerBlock
    let smc: [SmcEvent]
    let categories: CategoryScores
    let totalScore: Double
    let upProbability: Int
    let downProbability: Int
    let confidence: Int
    let expectedMovePct: Double
    let recommendation: Recommendation
    let narrative: String
    let fifth: FifthDimension
}

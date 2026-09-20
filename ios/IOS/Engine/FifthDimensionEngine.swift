import Foundation

/// Models what the indicator stack cannot see:
/// 1. Gap physics — probability of closing above lock given gap, time and volatility.
/// 2. Time decay — the gap model's weight grows as the round runs out.
/// 3. Noise floor — a gap inside random noise makes the round a coin flip.
/// 4. Payout gravity — expected value per side from the live prize pools.
nonisolated enum FifthDimensionEngine {
    /// PancakeSwap treasury fee taken from the prize pool.
    static let treasuryFee = 0.03
    /// Payout multiplier assumed when live pools are unavailable.
    static let defaultPayout = 1.95
    /// Round length used for time-decay weighting, seconds.
    static let roundSeconds = 300.0

    /// Standard normal CDF (Abramowitz–Stegun 26.2.17).
    static func normCdf(_ z: Double) -> Double {
        let t = 1 / (1 + 0.2316419 * abs(z))
        let d = 0.3989422804014327 * exp((-z * z) / 2)
        let p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
        return z >= 0 ? 1 - p : p
    }

    struct Input {
        let candles: [Candle]
        /// Index of the last closed candle.
        let index: Int
        let price: Double
        let lockPrice: Double?
        let secondsLeft: Double?
        let atr: Double
        /// UP probability (0...100) from the indicator stack alone.
        let indicatorUpProb: Double
        let pool: PoolInfo?
    }

    struct Result {
        let fifth: FifthDimension
        /// Final UP probability (0...100) after blending in the gap model.
        let blendedUpProb: Double
    }

    static func compute(_ input: Input) -> Result {
        let candles = input.candles
        let index = input.index
        let price = input.price
        let secondsLeft = input.secondsLeft ?? roundSeconds

        // Realized 1-minute dollar volatility from recent closed bars.
        var diffs: [Double] = []
        let start = Swift.max(1, index - 44)
        if start <= index {
            for j in start...index { diffs.append(candles[j].close - candles[j - 1].close) }
        }
        var sigma1m = 0.0
        if diffs.count >= 8 {
            let mean = diffs.reduce(0, +) / Double(diffs.count)
            let variance = diffs.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(diffs.count)
            sigma1m = variance.squareRoot()
        }
        sigma1m = Swift.max(sigma1m, input.atr * 0.5, price * 0.00005)

        let sigmaRemaining = sigma1m * (Swift.max(secondsLeft, 5) / 60).squareRoot()
        let noiseFloor = 0.5 * sigmaRemaining

        let hasLock = (input.lockPrice ?? 0) > 0
        let lock = input.lockPrice ?? 0
        let gap = hasLock ? price - lock : 0
        let zScore = hasLock && sigmaRemaining > 0 ? gap / sigmaRemaining : 0
        let gapProbUp = clamp(normCdf(zScore) * 100, 2, 98)

        // Time decay: indicators dominate early, the gap model dominates late.
        let elapsedFrac = clamp(1 - secondsLeft / roundSeconds, 0, 1)
        let blendWeight = hasLock ? 0.12 + 0.78 * pow(elapsedFrac, 1.6) : 0
        let blendedUpProb = blendWeight * gapProbUp + (1 - blendWeight) * input.indicatorUpProb

        // Coin-flip zone: late in the round with the gap buried inside noise.
        let coinFlip = hasLock && secondsLeft <= 180 && abs(zScore) < 0.55

        var payoutUp: Double?
        var payoutDown: Double?
        var crowd: FifthDimension.Crowd?
        var evEstimated = true
        if let pool = input.pool, pool.totalBnb > 0, pool.bullBnb > 0, pool.bearBnb > 0 {
            payoutUp = (pool.totalBnb / pool.bullBnb) * (1 - treasuryFee)
            payoutDown = (pool.totalBnb / pool.bearBnb) * (1 - treasuryFee)
            crowd = pool.bullBnb > pool.bearBnb * 1.25
                ? .upHeavy
                : (pool.bearBnb > pool.bullBnb * 1.25 ? .downHeavy : .balanced)
            evEstimated = false
        }
        let pUp = blendedUpProb / 100
        let evUp = pUp * (payoutUp ?? defaultPayout) - 1
        let evDown = (1 - pUp) * (payoutDown ?? defaultPayout) - 1

        var signals: [Signal] = []
        if hasLock {
            let insideNoise = abs(gap) < noiseFloor
            signals.append(Signal(
                label: insideNoise
                    ? "Gap buried inside noise floor"
                    : String(format: "Gap %.1fσ %@ lock", abs(zScore), gap >= 0 ? "above" : "below"),
                direction: insideNoise ? .neutral : (gap >= 0 ? .bull : .bear),
                detail: String(format: "%@$%.2f vs ±$%.2f", gap >= 0 ? "+" : "−", abs(gap), noiseFloor)
            ))
            signals.append(Signal(
                label: "Physics close model",
                direction: gapProbUp >= 55 ? .bull : (gapProbUp <= 45 ? .bear : .neutral),
                detail: String(format: "%.0f%% UP", gapProbUp)
            ))
        }
        if crowd == .downHeavy, let payoutDown {
            signals.append(Signal(label: "Crowd stacked on DOWN — thin payout", direction: .neutral, detail: String(format: "%.2fx", payoutDown)))
        } else if crowd == .upHeavy, let payoutUp {
            signals.append(Signal(label: "Crowd stacked on UP — thin payout", direction: .neutral, detail: String(format: "%.2fx", payoutUp)))
        }
        if coinFlip {
            signals.append(Signal(label: "Coin-flip zone — stand down", direction: .neutral, detail: "\(Int(secondsLeft.rounded()))s left"))
        }

        let verdict: String
        if coinFlip {
            verdict = "Outcome is inside random noise — any bet here is a coin flip. Stand down."
        } else if evUp <= 0 && evDown <= 0 {
            verdict = evEstimated
                ? "Neither side clears the payout breakeven — no statistical edge."
                : "Crowd-skewed payouts: both sides carry negative expected value."
        } else {
            let side = evUp >= evDown ? "UP" : "DOWN"
            let ev = Swift.max(evUp, evDown)
            verdict = String(format: "%@ is the +EV side: %.1f%% expected value per bet%@.", side, ev * 100, evEstimated ? " (est. payout)" : "")
        }

        let fifth = FifthDimension(
            gap: gap,
            sigmaRemaining: sigmaRemaining,
            noiseFloor: noiseFloor,
            zScore: zScore,
            gapProbUp: gapProbUp,
            blendWeight: blendWeight,
            coinFlip: coinFlip,
            payoutUp: payoutUp,
            payoutDown: payoutDown,
            evUp: evUp,
            evDown: evDown,
            evEstimated: evEstimated,
            crowd: crowd,
            signals: signals,
            verdict: verdict
        )
        return Result(fifth: fifth, blendedUpProb: blendedUpProb)
    }
}

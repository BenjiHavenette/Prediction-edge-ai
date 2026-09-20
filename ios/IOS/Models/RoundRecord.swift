import Foundation

nonisolated enum RoundResult: String, Codable, Sendable {
    case up = "UP"
    case down = "DOWN"
    case flat = "FLAT"
}

/// A settled PancakeSwap round with the engine's call recorded at lock time.
/// Persisted so accuracy, learning weights and the regime audit survive relaunch.
nonisolated struct RoundRecord: Identifiable, Codable, Sendable {
    let id: Int
    let startTime: Date
    let lockPrice: Double
    let closePrice: Double
    let result: RoundResult
    let movePct: Double
    let predictedUp: Int
    let confidence: Int
    /// The LOGGED call — trend-regime gated. `.wait` unless the tape was
    /// trending and the call rode the trend with the 15m frame onside.
    let recommendation: String
    /// What the indicators called before the trend-regime gate.
    let rawRecommendation: String
    /// Behavioural regime at lock time.
    let regimeKind: String?
    let regimeLabel: String?
    /// False for rounds reconstructed from history at launch.
    let live: Bool
    let snapshot: RoundSnapshot

    var call: Recommendation { Recommendation(rawValue: recommendation) ?? .wait }
    var rawCall: Recommendation { Recommendation(rawValue: rawRecommendation) ?? .wait }

    /// True when the gated call was logged and matched the settled outcome.
    var isHit: Bool { call != .wait && call.rawValue == result.rawValue }
    /// True when a gated call was logged at all (i.e. graded).
    var isGraded: Bool { call != .wait && result != .flat }
}

/// Compact indicator snapshot stored per round for replay and learning.
nonisolated struct RoundSnapshot: Codable, Sendable {
    let consecGreen: Int
    let consecRed: Int
    let rsi: Double
    let stochRsi: Double
    let macdHist: Double
    let volumeRelative: Double
    let volumeSpike: Bool
    let bullPressure: Double
    let emaAboveCount: Int
    let vwapSide: String
    let patterns: [String]
    let smc: [String]
    let trendScore: Double
    let momentumScore: Double
    let volumeScore: Double
    let structureScore: Double
    let confluenceScore: Double
    let narrative: String
    let expectedMovePct: Double
    let gapZ: Double
    let coinFlip: Bool
}

nonisolated enum RoundFactory {
    /// Builds a settled record from the analysis captured at lock time,
    /// applying the trend-regime gate to the logged call.
    static func makeRecord(
        epoch: Int,
        startTime: Date,
        lockPrice: Double,
        closePrice: Double,
        analysis: Analysis,
        regime: RegimeState?,
        live: Bool
    ) -> RoundRecord {
        let result: RoundResult = closePrice > lockPrice ? .up : (closePrice < lockPrice ? .down : .flat)
        let gated = RegimeEngine.gate(analysis.recommendation, regime: regime)
        let snapshot = RoundSnapshot(
            consecGreen: analysis.consecGreen,
            consecRed: analysis.consecRed,
            rsi: analysis.momentum.rsi,
            stochRsi: analysis.momentum.stochRsi,
            macdHist: analysis.momentum.macdHist,
            volumeRelative: analysis.volume.relative,
            volumeSpike: analysis.volume.spike,
            bullPressure: analysis.volume.bullPressure,
            emaAboveCount: analysis.trend.aboveCount,
            vwapSide: analysis.vwap.distancePct >= 0 ? "above" : "below",
            patterns: analysis.patterns.map(\.name),
            smc: analysis.smc.map(\.label),
            trendScore: analysis.categories.trend,
            momentumScore: analysis.categories.momentum,
            volumeScore: analysis.categories.volume,
            structureScore: analysis.categories.structure,
            confluenceScore: analysis.categories.confluence,
            narrative: analysis.narrative,
            expectedMovePct: analysis.expectedMovePct,
            gapZ: analysis.fifth.zScore,
            coinFlip: analysis.fifth.coinFlip
        )
        return RoundRecord(
            id: epoch,
            startTime: startTime,
            lockPrice: lockPrice,
            closePrice: closePrice,
            result: result,
            movePct: lockPrice > 0 ? ((closePrice - lockPrice) / lockPrice) * 100 : 0,
            predictedUp: analysis.upProbability,
            confidence: analysis.confidence,
            recommendation: gated.rawValue,
            rawRecommendation: analysis.recommendation.rawValue,
            regimeKind: regime?.kind.rawValue,
            regimeLabel: regime?.label,
            live: live,
            snapshot: snapshot
        )
    }

    /// Replays the engine across the candle tape to reconstruct settled rounds
    /// at each five-minute boundary, so the app has history the moment it opens.
    /// Every call is made from data available BEFORE that round locked.
    static func seedRecords(candles: [Candle], anchorEpoch: Int, anchorStart: Date, limit: Int = 160) -> [RoundRecord] {
        guard candles.count >= PredictionEngine.minimumBars + 10 else { return [] }
        let bundle = SeriesBundle.build(candles)
        var out: [RoundRecord] = []
        var index = candles.count - 6

        while index > PredictionEngine.minimumBars, out.count < limit {
            let lockBar = candles[index]
            // Only anchor on five-minute boundaries — PancakeSwap round cadence.
            let minute = Int(lockBar.time.timeIntervalSince1970 / 60) % 5
            if minute != 0 {
                index -= 1
                continue
            }
            let closeIndex = index + 5
            guard closeIndex < candles.count else {
                index -= 1
                continue
            }
            let lockPrice = lockBar.close
            let closePrice = candles[closeIndex].close
            let regime = RegimeEngine.compute(candles, at: index - 1)
            let analysis = PredictionEngine.analyze(
                candles, bundle: bundle, at: index - 1,
                options: AnalyzeOptions(price: lockPrice, lockPrice: lockPrice, probShrink: regime.shrink)
            )
            let elapsed = anchorStart.timeIntervalSince(lockBar.time)
            let epoch = anchorEpoch - Int((elapsed / 300).rounded())
            out.append(makeRecord(
                epoch: epoch,
                startTime: lockBar.time,
                lockPrice: lockPrice,
                closePrice: closePrice,
                analysis: analysis,
                regime: regime,
                live: false
            ))
            index -= 5
        }
        return out.sorted { $0.startTime < $1.startTime }
    }
}

import Foundation

nonisolated struct CategoryPerformance: Identifiable, Sendable {
    let name: String
    /// Accuracy of this category taken alone, 0...100.
    let accuracy: Double
    let samples: Int
    /// Adaptive weight this category currently carries, 0...1.
    let weight: Double

    var id: String { name }
}

nonisolated struct PatternPerformance: Identifiable, Sendable {
    let name: String
    let wins: Int
    let total: Int

    var id: String { name }
    var accuracy: Double { total > 0 ? Double(wins) / Double(total) * 100 : 0 }
}

/// What the engine has learned from settled rounds.
nonisolated struct LearningState: Sendable {
    let weights: CategoryWeights
    let categories: [CategoryPerformance]
    let patterns: [PatternPerformance]
    /// Accuracy of gated calls only, 0...100.
    let gatedAccuracy: Double
    let gatedSamples: Int
    /// Accuracy of the raw ungated indicator calls, for comparison.
    let rawAccuracy: Double
    let rawSamples: Int
    /// Rolling accuracy of the last 10 gated calls.
    let last10: Double
    let last10Samples: Int
    /// Consecutive gated losses right now.
    let lossStreak: Int
    /// True when too few gated calls exist to trust the model yet.
    let isCold: Bool
    let summary: String

    static let empty = LearningState(
        weights: .base,
        categories: [],
        patterns: [],
        gatedAccuracy: 0,
        gatedSamples: 0,
        rawAccuracy: 0,
        rawSamples: 0,
        last10: 0,
        last10Samples: 0,
        lossStreak: 0,
        isCold: true,
        summary: "Collecting rounds — the model needs settled history before it will trust itself."
    )
}

/// Re-derives category weights from how each category actually performed.
/// Categories that called the settled outcome correctly gain weight; those that
/// were wrong lose it. Weights are always renormalised to sum to 1.
nonisolated enum LearningEngine {
    /// Gated calls required before the model stops treating itself as cold.
    static let warmThreshold = 12

    static func compute(_ records: [RoundRecord]) -> LearningState {
        let decided = records.filter { $0.result != .flat }
        guard decided.count >= 10 else { return .empty }

        // ---- Per-category standalone accuracy ----
        let names = ["Trend", "Momentum", "Volume", "Structure", "Confluence"]
        func score(_ r: RoundRecord, _ index: Int) -> Double {
            switch index {
            case 0: r.snapshot.trendScore
            case 1: r.snapshot.momentumScore
            case 2: r.snapshot.volumeScore
            case 3: r.snapshot.structureScore
            default: r.snapshot.confluenceScore
            }
        }

        var accuracies: [Double] = []
        var sampleCounts: [Int] = []
        for index in 0..<names.count {
            var hits = 0
            var total = 0
            for r in decided {
                let s = score(r, index)
                guard abs(s) >= 8 else { continue }
                total += 1
                let calledUp = s > 0
                if calledUp == (r.result == .up) { hits += 1 }
            }
            accuracies.append(total > 0 ? Double(hits) / Double(total) * 100 : 50)
            sampleCounts.append(total)
        }

        // Edge over a coin flip drives the weight adjustment, damped by sample size.
        let baseWeights = [0.25, 0.20, 0.20, 0.15, 0.20]
        var adjusted: [Double] = []
        for index in 0..<names.count {
            let edge = (accuracies[index] - 50) / 50
            let confidence = Swift.min(1.0, Double(sampleCounts[index]) / 40.0)
            let factor = clamp(1 + edge * confidence * 0.8, 0.45, 1.75)
            adjusted.append(baseWeights[index] * factor)
        }
        let sum = adjusted.reduce(0, +)
        let normalized = sum > 0 ? adjusted.map { $0 / sum } : baseWeights

        let weights = CategoryWeights(
            trend: normalized[0],
            momentum: normalized[1],
            volume: normalized[2],
            structure: normalized[3],
            confluence: normalized[4]
        )
        let categories = (0..<names.count).map { index in
            CategoryPerformance(
                name: names[index],
                accuracy: accuracies[index],
                samples: sampleCounts[index],
                weight: normalized[index]
            )
        }

        // ---- Pattern scoreboard ----
        var patternTally: [String: (wins: Int, total: Int)] = [:]
        for r in decided {
            for name in r.snapshot.patterns {
                var entry = patternTally[name] ?? (0, 0)
                entry.total += 1
                // Directional patterns are graded against the round outcome.
                let bullish = name.contains("Bullish") || name.contains("Hammer") || name.contains("Up")
                let bearish = name.contains("Bearish") || name.contains("Shooting") || name.contains("Down")
                if (bullish && r.result == .up) || (bearish && r.result == .down) { entry.wins += 1 }
                patternTally[name] = entry
            }
        }
        let patterns = patternTally
            .filter { $0.value.total >= 3 }
            .map { PatternPerformance(name: $0.key, wins: $0.value.wins, total: $0.value.total) }
            .sorted { $0.accuracy > $1.accuracy }

        // ---- Gated vs raw accuracy ----
        let gated = decided.filter { $0.call != .wait }
        let gatedHits = gated.filter(\.isHit).count
        let gatedAccuracy = gated.isEmpty ? 0 : Double(gatedHits) / Double(gated.count) * 100

        let raw = decided.filter { $0.rawCall != .wait }
        let rawHits = raw.filter { $0.rawCall.rawValue == $0.result.rawValue }.count
        let rawAccuracy = raw.isEmpty ? 0 : Double(rawHits) / Double(raw.count) * 100

        let recent = Array(gated.suffix(10))
        let recentHits = recent.filter(\.isHit).count
        let last10 = recent.isEmpty ? 0 : Double(recentHits) / Double(recent.count) * 100

        var lossStreak = 0
        for r in gated.reversed() {
            if r.isHit { break }
            lossStreak += 1
        }

        let isCold = gated.count < warmThreshold
        let summary: String
        if isCold {
            summary = "Model is cold — only \(gated.count) gated calls logged. Entry thresholds stay raised until \(warmThreshold) settle."
        } else if gatedAccuracy >= 70 {
            summary = String(format: "Gate is working: %.0f%% on %d trend-confirmed calls versus %.0f%% for the ungated indicators.", gatedAccuracy, gated.count, rawAccuracy)
        } else if lossStreak >= 3 {
            summary = "\(lossStreak) gated losses in a row — thresholds are raised until the tape proves itself again."
        } else {
            summary = String(format: "%.0f%% on %d trend-confirmed calls. Ungated indicators sit at %.0f%%.", gatedAccuracy, gated.count, rawAccuracy)
        }

        return LearningState(
            weights: weights,
            categories: categories,
            patterns: Array(patterns.prefix(8)),
            gatedAccuracy: gatedAccuracy,
            gatedSamples: gated.count,
            rawAccuracy: rawAccuracy,
            rawSamples: raw.count,
            last10: last10,
            last10Samples: recent.count,
            lossStreak: lossStreak,
            isCold: isCold,
            summary: summary
        )
    }
}

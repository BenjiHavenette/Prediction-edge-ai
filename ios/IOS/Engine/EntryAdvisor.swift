import Foundation

nonisolated enum EntryVerdict: String, Sendable {
    case enterUp = "ENTER UP"
    case enterDown = "ENTER DOWN"
    case stand = "STAND DOWN"
}

/// The final gate between the model and a real bet.
nonisolated struct EntryAdvice: Sendable {
    let verdict: EntryVerdict
    /// Probability the advised side wins, 0...100.
    let sideProbability: Double
    /// Probability the side had to clear to be advised.
    let requiredProbability: Double
    /// Ordered reasons the gate opened or stayed shut.
    let reasons: [String]
    /// One-line headline for the hero card.
    let headline: String

    var isEntry: Bool { verdict != .stand }
}

/// Decides whether a round is actually worth betting. Entry starts at 60% and
/// rises when the model is cold, the 15-minute frame is unconfirmed, or the
/// engine is on a losing streak — so the app only calls its very best setups.
nonisolated enum EntryAdvisor {
    /// The floor every advised entry must clear.
    static let baseThreshold = 60.0

    static func advise(analysis: Analysis, regime: RegimeState?, learning: LearningState) -> EntryAdvice {
        var reasons: [String] = []
        var required = baseThreshold

        if learning.isCold {
            required += 5
            reasons.append("Model is still cold (\(learning.gatedSamples)/\(LearningEngine.warmThreshold) graded calls) — threshold raised to \(Int(required))%.")
        }
        if learning.lossStreak >= 3 {
            required += 4
            reasons.append("\(learning.lossStreak) losses in a row — the gate tightened to \(Int(required))%.")
        }

        guard let regime else {
            return EntryAdvice(
                verdict: .stand,
                sideProbability: 50,
                requiredProbability: required,
                reasons: ["Regime engine is still warming up — no entry until the tape is classified."],
                headline: "Warming up"
            )
        }

        let upProb = Double(analysis.upProbability)
        let side: Recommendation = upProb >= 50 ? .up : .down
        let sideProbability = side == .up ? upProb : 100 - upProb

        // --- Hard vetoes ---
        if analysis.fifth.coinFlip {
            reasons.insert("Gap is buried inside the noise floor — the round is a coin flip.", at: 0)
            return stand(sideProbability, required, reasons, "Coin-flip round")
        }
        if !regime.kind.isTrend {
            reasons.insert("\(regime.label) — only confirmed trends are traded.", at: 0)
            return stand(sideProbability, required, reasons, regime.kind == .storm ? "Storm — no edge" : "Chop — no edge")
        }

        let trendSide: Recommendation = regime.kind == .trendUp ? .up : .down
        if side != trendSide {
            reasons.insert("The model leans \(side.rawValue) while the tape trends \(trendSide.rawValue) — never fade a confirmed trend.", at: 0)
            return stand(sideProbability, required, reasons, "Against the trend")
        }
        if regime.alignment == .conflict {
            reasons.insert("The 15-minute frame points the other way — this micro move is likely a pullback.", at: 0)
            return stand(sideProbability, required, reasons, "15m conflict")
        }
        if regime.alignment == .unconfirmed {
            required += 4
            reasons.append("15-minute frame has not confirmed — threshold raised to \(Int(required))%.")
        }

        let ev = side == .up ? analysis.fifth.evUp : analysis.fifth.evDown
        if ev < 0.03 {
            reasons.insert(String(format: "Expected value on %@ is only %.1f%% — the payout doesn't pay for the risk.", side.rawValue, ev * 100), at: 0)
            return stand(sideProbability, required, reasons, "Negative edge")
        }
        if analysis.confidence < 55 {
            reasons.insert("Confidence is \(analysis.confidence)% — below the 55% floor.", at: 0)
            return stand(sideProbability, required, reasons, "Low confidence")
        }
        if sideProbability < required {
            reasons.insert(String(format: "%@ sits at %.0f%%, under the %.0f%% entry bar.", side.rawValue, sideProbability, required), at: 0)
            return stand(sideProbability, required, reasons, "Below entry bar")
        }

        reasons.insert(regime.alignment == .aligned
            ? "Trend and the 15-minute frame agree — the engine's highest-accuracy condition."
            : "Trend is confirmed on the micro frame.", at: 0)
        reasons.append(String(format: "Expected value %.1f%% per unit staked.", ev * 100))
        reasons.append("Predictability \(regime.predictability)/100 with \(Int(regime.efficiency * 100))% path efficiency.")

        return EntryAdvice(
            verdict: side == .up ? .enterUp : .enterDown,
            sideProbability: sideProbability,
            requiredProbability: required,
            reasons: reasons,
            headline: side == .up ? "Ride the uptrend" : "Ride the downtrend"
        )
    }

    private static func stand(_ prob: Double, _ required: Double, _ reasons: [String], _ headline: String) -> EntryAdvice {
        EntryAdvice(
            verdict: .stand,
            sideProbability: prob,
            requiredProbability: required,
            reasons: reasons,
            headline: headline
        )
    }
}

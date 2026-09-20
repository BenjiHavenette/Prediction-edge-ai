import Foundation

nonisolated enum RegimeKind: String, Sendable {
    case trendUp = "trend-up"
    case trendDown = "trend-down"
    case chop
    case storm

    var isTrend: Bool { self == .trendUp || self == .trendDown }
}

nonisolated enum HtfBias: String, Sendable {
    case up
    case down
    case neutral
}

/// How the live micro trend relates to the 15-minute frame.
nonisolated enum HtfAlignment: String, Sendable {
    case aligned
    case unconfirmed
    case conflict
}

/// 15-minute higher-timeframe structure built from aggregated 1m candles.
nonisolated struct Htf15State: Sendable {
    let bars: Int
    let efficiency: Double
    let driftPerBar: Double
    let sigmaBar: Double
    let snr: Double
    let bias: HtfBias
    let label: String
}

nonisolated struct RegimeState: Sendable {
    let kind: RegimeKind
    /// Kaufman efficiency ratio over the last 30 bars (0 = noise, 1 = straight line).
    let efficiency: Double
    /// Least-squares drift of the last 15 closes, $ per minute.
    let driftPerMin: Double
    let sigma1m: Double
    /// |expected 5-min drift| / 5-min noise.
    let snr: Double
    /// Lag-1 autocorrelation of 1-minute moves (negative = mean-reverting).
    let autocorr: Double
    let meanReverting: Bool
    /// How predictable the next 5 minutes are, 0...100.
    let predictability: Int
    /// Factor applied to (probability − 50): 1 = trust indicators, →0 = coin flip.
    let shrink: Double
    let htf: Htf15State
    let alignment: HtfAlignment?
    let label: String
    let detail: String
}

/// Thinks like the market itself instead of trusting indicators. At the 5-minute
/// scale price is mostly noise: direction only carries when the path is
/// efficient, drift clears the noise, moves have memory, and the 15-minute
/// frame agrees. Otherwise every indicator forecast gets shrunk toward 50%.
nonisolated enum RegimeEngine {
    static let htfBarSeconds = 900.0

    /// Aggregates 1m candles into clock-aligned 15-minute bars and measures structure.
    static func computeHtf15(_ candles: [Candle], at index: Int) -> Htf15State {
        let i = Swift.max(0, Swift.min(index, candles.count - 1))
        let start = Swift.max(0, i - 419)
        var closes: [Double] = []
        var bucket = -1.0
        guard start <= i else {
            return Htf15State(bars: 0, efficiency: 0, driftPerBar: 0, sigmaBar: 0, snr: 0, bias: .neutral, label: "15m frame warming up")
        }
        for j in start...i {
            let b = (candles[j].time.timeIntervalSince1970 / htfBarSeconds).rounded(.down)
            if b != bucket {
                bucket = b
                closes.append(candles[j].close)
            } else {
                closes[closes.count - 1] = candles[j].close
            }
        }
        let bars = closes.count
        guard bars >= 6 else {
            return Htf15State(bars: bars, efficiency: 0, driftPerBar: 0, sigmaBar: 0, snr: 0, bias: .neutral, label: "15m frame warming up")
        }

        let effN = Swift.min(16, bars - 1)
        var path = 0.0
        for k in (bars - effN)..<bars { path += abs(closes[k] - closes[k - 1]) }
        let net = closes[bars - 1] - closes[bars - 1 - effN]
        let efficiency = path > 0 ? clamp(abs(net) / path, 0, 1) : 0

        let dN = Swift.min(8, bars)
        var sx = 0.0, sy = 0.0, sxy = 0.0, sxx = 0.0
        for k in 0..<dN {
            let x = Double(k)
            let y = closes[bars - dN + k]
            sx += x; sy += y; sxy += x * y; sxx += x * x
        }
        let denom = Double(dN) * sxx - sx * sx
        let driftPerBar = denom != 0 ? (Double(dN) * sxy - sx * sy) / denom : 0

        var diffs: [Double] = []
        for k in 1..<bars { diffs.append(closes[k] - closes[k - 1]) }
        let mean = diffs.reduce(0, +) / Double(diffs.count)
        let variance = diffs.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(diffs.count)
        let sigmaBar = Swift.max(variance.squareRoot(), closes[bars - 1] * 0.0001)
        let snr = sigmaBar > 0 ? abs(driftPerBar) / sigmaBar : 0
        let bias: HtfBias = efficiency >= 0.28 && snr >= 0.35 ? (driftPerBar >= 0 ? .up : .down) : .neutral

        let label: String
        switch bias {
        case .up:
            label = String(format: "15m uptrend (eff %.0f%%, +$%.0f/bar)", efficiency * 100, driftPerBar)
        case .down:
            label = String(format: "15m downtrend (eff %.0f%%, −$%.0f/bar)", efficiency * 100, abs(driftPerBar))
        case .neutral:
            label = String(format: "15m frame flat (eff %.0f%%)", efficiency * 100)
        }
        return Htf15State(bars: bars, efficiency: efficiency, driftPerBar: driftPerBar, sigmaBar: sigmaBar, snr: snr, bias: bias, label: label)
    }

    /// Classifies the live behavioural regime from the last closed candles.
    static func compute(_ candles: [Candle], at index: Int) -> RegimeState {
        let i = Swift.max(1, Swift.min(index, candles.count - 1))
        let price = candles[i].close

        let lo = Swift.max(1, i - 59)
        var diffs: [Double] = []
        for j in lo...i { diffs.append(candles[j].close - candles[j - 1].close) }
        let n = Double(Swift.max(diffs.count, 1))
        let mean = diffs.reduce(0, +) / n
        let variance = diffs.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / n
        let sigma1m = Swift.max(variance.squareRoot(), price * 0.00004)

        let erStart = Swift.max(1, i - 29)
        var path = 0.0
        for j in erStart...i { path += abs(candles[j].close - candles[j - 1].close) }
        let net = candles[i].close - candles[erStart - 1].close
        let efficiency = path > 0 ? clamp(abs(net) / path, 0, 1) : 0

        let dN = Swift.min(15, i + 1)
        var sx = 0.0, sy = 0.0, sxy = 0.0, sxx = 0.0
        for k in 0..<dN {
            let x = Double(k)
            let y = candles[i - dN + 1 + k].close
            sx += x; sy += y; sxy += x * y; sxx += x * x
        }
        let denom = Double(dN) * sxx - sx * sx
        let driftPerMin = denom != 0 ? (Double(dN) * sxy - sx * sy) / denom : 0

        let sigma5m = sigma1m * 5.0.squareRoot()
        let snr = sigma5m > 0 ? abs(driftPerMin * 5) / sigma5m : 0

        var acNum = 0.0
        var acDen = 0.0
        if diffs.count > 1 {
            for k in 1..<diffs.count { acNum += (diffs[k] - mean) * (diffs[k - 1] - mean) }
        }
        for d in diffs { acDen += (d - mean) * (d - mean) }
        let autocorr = acDen > 0 ? clamp(acNum / acDen, -1, 1) : 0
        let meanReverting = autocorr < -0.12

        let volPct = sigma1m / price
        let kind: RegimeKind
        if volPct > 0.0018 && efficiency < 0.3 {
            kind = .storm
        } else if efficiency >= 0.32 && snr >= 0.4 {
            kind = driftPerMin >= 0 ? .trendUp : .trendDown
        } else {
            kind = .chop
        }

        let htf = computeHtf15(candles, at: i)
        var alignment: HtfAlignment?
        if kind.isTrend {
            let microDir: HtfBias = kind == .trendUp ? .up : .down
            alignment = htf.bias == microDir ? .aligned : (htf.bias == .neutral ? .unconfirmed : .conflict)
        }

        var predictability = Int(clamp(
            efficiency * 80 + snr * 45 + (autocorr > 0.1 ? 8 : 0) - (meanReverting ? 15 : 0),
            0, 100
        ).rounded())
        if kind == .chop { predictability = Swift.min(predictability, 34) }
        if kind == .storm { predictability = Swift.min(predictability, 25) }
        if alignment == .aligned {
            predictability = Int(clamp(Double(predictability) + 12, 0, 100).rounded())
        } else if alignment == .conflict {
            predictability = Swift.min(predictability, 36)
        }

        var shrink: Double
        if kind.isTrend {
            shrink = clamp(0.45 + (Double(predictability) / 100) * 0.55, 0.45, 1)
        } else if kind == .storm {
            shrink = 0.18
        } else {
            shrink = 0.28
        }
        switch alignment {
        case .aligned: shrink = clamp(shrink + 0.1, 0.45, 1)
        case .unconfirmed: shrink = clamp(shrink * 0.85, 0.3, 1)
        case .conflict: shrink = clamp(shrink * 0.5, 0.2, 0.45)
        case nil: break
        }

        var label: String
        var detail: String
        if kind.isTrend {
            let up = kind == .trendUp
            label = up ? "Uptrend regime" : "Downtrend regime"
            detail = String(
                format: "Path efficiency %.0f%% with drift %@$%.2f/5min clearing the ±$%.2f noise — %@ follow-through is statistically favored.",
                efficiency * 100, up ? "+" : "−", abs(driftPerMin * 5), sigma5m, up ? "upside" : "downside"
            )
            switch alignment {
            case .aligned:
                label += " · 15m confirmed"
                detail += " The 15-minute frame confirms (\(htf.label)) — the highest-accuracy condition the engine knows."
            case .conflict:
                label += " · 15m conflict"
                detail += " But the 15-minute frame points the OTHER way (\(htf.label)) — this micro move is likely a pullback inside the bigger trend."
            default:
                label += " · 15m flat"
                detail += " The 15-minute frame has not confirmed yet (\(htf.label)) — partial trust only."
            }
        } else if kind == .storm {
            label = "Storm regime"
            detail = String(
                format: "Violent but directionless — ±$%.2f/min swings with only %.0f%% path efficiency. Big candles both ways, no follow-through. %@.",
                sigma1m, efficiency * 100, htf.label
            )
        } else {
            label = "Chop regime"
            detail = String(
                format: "Price is backtracking more than it travels (%.0f%% efficiency) and 1-minute moves %@ — 5-minute closes here are coin flips. %@.",
                efficiency * 100, meanReverting ? "actively snap back" : "carry no memory", htf.label
            )
        }

        return RegimeState(
            kind: kind,
            efficiency: efficiency,
            driftPerMin: driftPerMin,
            sigma1m: sigma1m,
            snr: snr,
            autocorr: autocorr,
            meanReverting: meanReverting,
            predictability: predictability,
            shrink: shrink,
            htf: htf,
            alignment: alignment,
            label: label,
            detail: detail
        )
    }

    /// The trend-regime gate: a call is only logged when the tape is trending,
    /// the call rides the trend, and the 15-minute frame is not in conflict.
    static func gate(_ raw: Recommendation, regime: RegimeState?) -> Recommendation {
        guard raw != .wait, let regime else { return .wait }
        guard regime.kind.isTrend else { return .wait }
        guard regime.alignment != .conflict else { return .wait }
        let rides = (regime.kind == .trendUp && raw == .up) || (regime.kind == .trendDown && raw == .down)
        return rides ? raw : .wait
    }
}

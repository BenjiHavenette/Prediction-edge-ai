import Foundation

/// Every indicator series computed once for a candle array. All series are
/// causal — index `i` never reads data from beyond bar `i`.
nonisolated struct SeriesBundle: Sendable {
    let ema9: [Double]
    let ema20: [Double]
    let ema50: [Double]
    let ema200: [Double]
    let rsi: [Double]
    let macd: MacdBundle
    let stochRsi: [Double]
    let vwap: [Double]
    let atr: [Double]
    let bb: BollingerBundle
    let volSma: [Double]

    static func build(_ candles: [Candle]) -> SeriesBundle {
        let closes = candles.closes
        return SeriesBundle(
            ema9: Indicators.ema(closes, period: 9),
            ema20: Indicators.ema(closes, period: 20),
            ema50: Indicators.ema(closes, period: 50),
            ema200: Indicators.ema(closes, period: 200),
            rsi: Indicators.rsi(closes, period: 14),
            macd: Indicators.macd(closes),
            stochRsi: Indicators.stochRsi(closes),
            vwap: Indicators.vwap(candles),
            atr: Indicators.atr(candles, period: 14),
            bb: Indicators.bollinger(closes, period: 20, mult: 2),
            volSma: Indicators.sma(candles.volumes, period: 20)
        )
    }
}

nonisolated struct AnalyzeOptions: Sendable {
    /// Current live/mark price.
    let price: Double
    /// Lock price of the active round, if any.
    var lockPrice: Double?
    /// The forming (not yet closed) candle, if live.
    var forming: Candle?
    /// Fraction of the forming candle elapsed, 0...1.
    var elapsedFraction: Double = 1
    /// Seconds remaining in the active round (nil = full round).
    var secondsLeft: Double?
    /// Live PancakeSwap prize pool, if known.
    var pool: PoolInfo?
    /// Adaptive category weights from the learning engine.
    var weights: CategoryWeights = .base
    /// Regime noise discount, 0...1. Pulls probability toward 50%.
    var probShrink: Double = 1
}

/// The weighted prediction engine.
/// Trend 25% · Momentum 20% · Volume 20% · Structure 15% · Confluence 20%,
/// then blended with the Fifth Dimension gap-physics model.
nonisolated enum PredictionEngine {
    /// Minimum closed bars required before any analysis can run.
    static let minimumBars = 240

    private static func dirSign(_ v: Double, dead: Double = 5) -> Int {
        v > dead ? 1 : (v < -dead ? -1 : 0)
    }

    private static func nz(_ v: Double, _ fallback: Double) -> Double {
        v.isFinite ? v : fallback
    }

    static func analyze(_ candles: [Candle], bundle b: SeriesBundle, at i: Int, options opts: AnalyzeOptions) -> Analysis {
        let price = opts.price

        let ema9 = nz(b.ema9[i], price)
        let ema20 = nz(b.ema20[i], price)
        let ema50 = nz(b.ema50[i], price)
        let ema200 = nz(b.ema200[i], price)
        let rsi = nz(b.rsi[i], 50)
        let prevRsi = i > 0 ? nz(b.rsi[i - 1], rsi) : rsi
        let macdLine = nz(b.macd.macd[i], 0)
        let macdSignal = nz(b.macd.signal[i], 0)
        let macdHist = nz(b.macd.hist[i], 0)
        let prevHist = i > 0 ? nz(b.macd.hist[i - 1], macdHist) : macdHist
        let stochRsi = nz(b.stochRsi[i], 50)
        let vwap = nz(b.vwap[i], price)
        let atr = nz(b.atr[i], price * 0.0006)
        let bbUpper = nz(b.bb.upper[i], price * 1.001)
        let bbMiddle = nz(b.bb.middle[i], price)
        let bbLower = nz(b.bb.lower[i], price * 0.999)
        let bbWidth = nz(b.bb.widthPct[i], 0.2)
        let volSma = Swift.max(nz(b.volSma[i], 1), 1e-9)

        let lastRef = opts.forming ?? candles[i]
        let candleDirection: CandleDirection = lastRef.close > lastRef.open
            ? .green
            : (lastRef.close < lastRef.open ? .red : .flat)

        // ---------- Price action ----------
        let run = Patterns.consecutiveRun(candles, endIndex: i)
        let patterns = Patterns.detect(candles, at: i, atr: atr)
        var paSignals: [Signal] = []
        var bullPA = 0.0
        var bearPA = 0.0
        let runCount = Swift.max(run.green, run.red)
        let runIsGreen = run.green >= run.red
        if runCount >= 2 {
            let pts: Double = runCount == 2 ? 15 : (runCount == 3 ? 25 : (runCount == 4 ? 12 : 0))
            let exhaustion = runCount >= 5
            if runIsGreen {
                bullPA += pts
                if exhaustion { bearPA += 18 }
            } else {
                bearPA += pts
                if exhaustion { bullPA += 18 }
            }
            paSignals.append(Signal(
                label: "\(runCount) consecutive \(runIsGreen ? "green" : "red") candles",
                direction: exhaustion ? (runIsGreen ? .bear : .bull) : (runIsGreen ? .bull : .bear),
                detail: exhaustion ? "Exhaustion risk — reversal watch" : "Momentum continuation"
            ))
        }
        for p in patterns {
            let w: Double = p.name.contains("Engulfing") || p.name.contains("Breakout")
                ? 25
                : (p.name == "Doji" ? 0 : 20)
            if p.direction == .bull { bullPA += w } else if p.direction == .bear { bearPA += w }
            paSignals.append(Signal(label: p.name, direction: p.direction))
        }
        bullPA = clamp(bullPA, 0, 100)
        bearPA = clamp(bearPA, 0, 100)
        let paScore = clamp(bullPA - bearPA, -100, 100)

        // ---------- Volume ----------
        let closedVol = candles[i].volume
        let formingVol = opts.forming.map { $0.volume / Swift.max(opts.elapsedFraction, 0.2) } ?? closedVol
        let currentVol = opts.forming != nil ? formingVol : closedVol
        let relative = currentVol / volSma
        let relClosed = closedVol / volSma
        let spike = Swift.max(relative, relClosed) >= 1.8
        let expansion = candles[i].volume > candles[i - 1].volume && candles[i - 1].volume > candles[i - 2].volume
        var bullVol = 0.0
        var bearVol = 0.0
        for j in Swift.max(0, i - 9)...i {
            let c = candles[j]
            if c.close >= c.open { bullVol += c.volume } else { bearVol += c.volume }
        }
        let totVol = Swift.max(bullVol + bearVol, 1e-9)
        let bullPressure = (bullVol / totVol) * 100
        let bearPressure = (bearVol / totVol) * 100
        let priceNet5 = candles[i].close - candles[i - 5].close
        let volNet5 = candles[i].volume + candles[i - 1].volume - (candles[i - 4].volume + candles[i - 5].volume)
        var divergence: Direction = .neutral
        if priceNet5 > 0 && volNet5 < 0 { divergence = .bear } else if priceNet5 < 0 && volNet5 < 0 { divergence = .bull }

        var volSignals: [Signal] = []
        if spike {
            volSignals.append(Signal(
                label: "Volume spike",
                direction: candleDirection == .green ? .bull : (candleDirection == .red ? .bear : .neutral),
                detail: String(format: "%.1fx average", Swift.max(relative, relClosed))
            ))
        }
        if expansion {
            volSignals.append(Signal(label: "Volume expansion", direction: priceNet5 >= 0 ? .bull : .bear, detail: "3 rising bars"))
        }
        if divergence != .neutral {
            volSignals.append(Signal(
                label: divergence == .bear ? "Bearish volume divergence" : "Bullish volume divergence",
                direction: divergence,
                detail: "Price/volume disagreement"
            ))
        }
        volSignals.append(Signal(
            label: bullPressure >= bearPressure ? "Buyers control tape" : "Sellers control tape",
            direction: bullPressure >= bearPressure ? .bull : .bear,
            detail: String(format: "%.0f%% of last 10 bars", Swift.max(bullPressure, bearPressure))
        ))
        var volScore = (bullPressure - bearPressure) * 0.8
        if spike { volScore += candleDirection == .green ? 25 : (candleDirection == .red ? -25 : 0) }
        if expansion { volScore += priceNet5 > 0 ? 10 : -10 }
        if divergence == .bear { volScore -= 15 } else if divergence == .bull { volScore += 15 }
        volScore = clamp(volScore, -100, 100)

        // ---------- Trend ----------
        let emas = [ema9, ema20, ema50, ema200]
        let aboveCount = emas.filter { price > $0 }.count
        var cross: TrendBlock.Cross?
        for j in Swift.max(1, i - 2)...i {
            let a9 = b.ema9[j], a20 = b.ema20[j], p9 = b.ema9[j - 1], p20 = b.ema20[j - 1]
            if a9.isFinite && a20.isFinite && p9.isFinite && p20.isFinite {
                if p9 <= p20 && a9 > a20 { cross = .golden } else if p9 >= p20 && a9 < a20 { cross = .death }
            }
        }
        let stackedBull = ema9 > ema20 && ema20 > ema50
        let stackedBear = ema9 < ema20 && ema20 < ema50
        var trendScore = Double(aboveCount - 2) * 30
        if stackedBull { trendScore += 20 }
        if stackedBear { trendScore -= 20 }
        if cross == .golden { trendScore += 20 }
        if cross == .death { trendScore -= 20 }
        trendScore = clamp(trendScore, -100, 100)
        var trendSignals: [Signal] = [
            Signal(
                label: "Price \(aboveCount >= 2 ? "above" : "below") \(aboveCount)/4 EMAs",
                direction: aboveCount >= 3 ? .bull : (aboveCount <= 1 ? .bear : .neutral)
            )
        ]
        if stackedBull { trendSignals.append(Signal(label: "Bullish EMA stack (9 > 20 > 50)", direction: .bull)) }
        if stackedBear { trendSignals.append(Signal(label: "Bearish EMA stack (9 < 20 < 50)", direction: .bear)) }
        if cross == .golden { trendSignals.append(Signal(label: "EMA 9/20 golden cross", direction: .bull, detail: "Fresh crossover")) }
        if cross == .death { trendSignals.append(Signal(label: "EMA 9/20 death cross", direction: .bear, detail: "Fresh crossover")) }

        // ---------- Momentum ----------
        var momSignals: [Signal] = []
        var momScore = 0.0
        if rsi >= 75 {
            momScore -= 8
            momSignals.append(Signal(label: String(format: "RSI overbought (%.0f)", rsi), direction: .bear, detail: "Mean reversion risk"))
        } else if rsi >= 60 {
            momScore += 25
            momSignals.append(Signal(label: String(format: "RSI bullish (%.0f)", rsi), direction: .bull))
        } else if rsi >= 50 {
            momScore += 10
            momSignals.append(Signal(label: String(format: "RSI mildly bullish (%.0f)", rsi), direction: .bull))
        } else if rsi >= 40 {
            momScore -= 10
            momSignals.append(Signal(label: String(format: "RSI mildly bearish (%.0f)", rsi), direction: .bear))
        } else if rsi > 25 {
            momScore -= 25
            momSignals.append(Signal(label: String(format: "RSI bearish (%.0f)", rsi), direction: .bear))
        } else {
            momScore += 8
            momSignals.append(Signal(label: String(format: "RSI oversold (%.0f)", rsi), direction: .bull, detail: "Bounce risk"))
        }
        if macdHist > 0 {
            momScore += 18
            momSignals.append(Signal(label: "MACD histogram positive", direction: .bull))
        } else if macdHist < 0 {
            momScore -= 18
            momSignals.append(Signal(label: "MACD histogram negative", direction: .bear))
        } else {
            momSignals.append(Signal(label: "MACD flat", direction: .neutral))
        }
        if macdHist > prevHist {
            momScore += 10
            momSignals.append(Signal(label: "MACD momentum rising", direction: .bull))
        } else if macdHist < prevHist {
            momScore -= 10
            momSignals.append(Signal(label: "MACD momentum falling", direction: .bear))
        }
        if stochRsi >= 85 {
            momScore -= 8
            momSignals.append(Signal(label: String(format: "Stoch RSI overbought (%.0f)", stochRsi), direction: .bear))
        } else if stochRsi <= 15 {
            momScore += 8
            momSignals.append(Signal(label: String(format: "Stoch RSI oversold (%.0f)", stochRsi), direction: .bull))
        } else if stochRsi >= 50 {
            momScore += 8
            momSignals.append(Signal(label: String(format: "Stoch RSI rising zone (%.0f)", stochRsi), direction: .bull))
        } else {
            momScore -= 8
            momSignals.append(Signal(label: String(format: "Stoch RSI falling zone (%.0f)", stochRsi), direction: .bear))
        }
        momScore = clamp(momScore, -100, 100)

        // ---------- VWAP ----------
        let distancePct = vwap != 0 ? ((price - vwap) / vwap) * 100 : 0
        let vwapBias: Direction = distancePct > 0.04 ? .bull : (distancePct < -0.04 ? .bear : .neutral)
        let vwapSignals: [Signal] = [
            Signal(
                label: vwapBias == .neutral ? "Price pinned to VWAP" : "Price \(distancePct > 0 ? "above" : "below") VWAP",
                direction: vwapBias,
                detail: String(format: "%@%.3f%%", distancePct >= 0 ? "+" : "", distancePct)
            )
        ]

        // ---------- Bollinger ----------
        var wSum = 0.0
        var wN = 0
        for j in Swift.max(0, i - 49)...i where b.bb.widthPct[j].isFinite {
            wSum += b.bb.widthPct[j]
            wN += 1
        }
        let avgW = wN > 0 ? wSum / Double(wN) : bbWidth
        let bbState: BollingerBlock.State = bbWidth > avgW * 1.3
            ? .expansion
            : (bbWidth < avgW * 0.7 ? .compression : .normal)
        let cClose = candles[i].close
        var bbEvent: BollingerBlock.Event?
        if cClose > bbUpper {
            bbEvent = .breakoutUp
        } else if cClose < bbLower {
            bbEvent = .breakoutDown
        } else if candles[i].high > bbUpper && cClose < bbUpper {
            bbEvent = .rejectionUpper
        } else if candles[i].low < bbLower && cClose > bbLower {
            bbEvent = .rejectionLower
        }
        var bbScore = 0.0
        var bbSignals: [Signal] = []
        switch bbEvent {
        case .breakoutUp:
            bbScore = 25
            bbSignals.append(Signal(label: "Breakout above upper band", direction: .bull))
        case .breakoutDown:
            bbScore = -25
            bbSignals.append(Signal(label: "Breakdown below lower band", direction: .bear))
        case .rejectionUpper:
            bbScore = -18
            bbSignals.append(Signal(label: "Rejection at upper band", direction: .bear))
        case .rejectionLower:
            bbScore = 18
            bbSignals.append(Signal(label: "Rejection at lower band", direction: .bull))
        case nil:
            break
        }
        bbSignals.append(Signal(
            label: bbState == .expansion
                ? "Bands expanding — volatility rising"
                : (bbState == .compression ? "Bands compressed — squeeze building" : "Bands in normal regime"),
            direction: .neutral,
            detail: String(format: "Width %.3f%%", bbWidth)
        ))

        // ---------- Smart money ----------
        let smc = SmartMoney.detect(candles, at: i, atr: atr)
        var smcScore = 0.0
        for e in smc { smcScore += e.direction == .bull ? 25 : (e.direction == .bear ? -25 : 0) }
        smcScore = clamp(smcScore, -60, 60)
        let structureScore = clamp(smcScore + bbScore * 0.8 + paScore * 0.35, -100, 100)

        // ---------- Confluence ----------
        let vwapSign = vwapBias == .bull ? 1 : (vwapBias == .bear ? -1 : 0)
        let signs = [
            dirSign(trendScore), dirSign(momScore), dirSign(volScore),
            dirSign(structureScore), dirSign(paScore), vwapSign,
        ]
        let bulls = signs.filter { $0 > 0 }.count
        let bears = signs.filter { $0 < 0 }.count
        let confluenceScore = clamp((Double(bulls - bears) / Double(signs.count)) * 100, -100, 100)

        // ---------- Weighted probability ----------
        let categories = CategoryScores(
            trend: trendScore.rounded(),
            momentum: momScore.rounded(),
            volume: volScore.rounded(),
            structure: structureScore.rounded(),
            confluence: confluenceScore.rounded()
        )
        let w = opts.weights
        let totalScore = w.trend * trendScore
            + w.momentum * momScore
            + w.volume * volScore
            + w.structure * structureScore
            + w.confluence * confluenceScore
        let probShrink = clamp(opts.probShrink, 0.1, 1)
        let indicatorUpProb = clamp(50 + totalScore * 0.45 * probShrink, 5, 95)

        // ---------- Fifth dimension ----------
        let fifthResult = FifthDimensionEngine.compute(.init(
            candles: candles,
            index: i,
            price: price,
            lockPrice: opts.lockPrice,
            secondsLeft: opts.secondsLeft,
            atr: atr,
            indicatorUpProb: indicatorUpProb,
            pool: opts.pool
        ))
        let fifth = fifthResult.fifth
        let upProbability = Int(clamp(fifthResult.blendedUpProb, 3, 97).rounded())
        let agreement = Double(abs(bulls - bears)) / Double(signs.count)
        var confidence = Int(clamp(28 + abs(totalScore) * 0.55 + agreement * 32, 12, 96).rounded())
        if fifth.coinFlip {
            confidence = Swift.min(confidence, 40)
        } else if let secondsLeft = opts.secondsLeft, secondsLeft <= 120, abs(fifth.zScore) >= 1.2 {
            confidence = Swift.max(confidence, Swift.min(93, Int((50 + abs(fifth.zScore) * 18).rounded())))
        }

        var recommendation: Recommendation = .wait
        if !fifth.coinFlip {
            if upProbability >= 58 && confidence >= 55 && fifth.evUp >= 0.03 {
                recommendation = .up
            } else if upProbability <= 42 && confidence >= 55 && fifth.evDown >= 0.03 {
                recommendation = .down
            }
        }

        let rsiReversal: Direction = prevRsi < 30 && rsi >= 30
            ? .bull
            : (prevRsi > 70 && rsi <= 70 ? .bear : .neutral)

        var narrative = buildNarrative(NarrativeInput(
            totalScore: totalScore,
            upProbability: upProbability,
            confidence: confidence,
            recommendation: recommendation,
            aboveCount: aboveCount,
            rsi: rsi,
            spike: spike,
            runCount: runCount,
            runIsGreen: runIsGreen,
            smcLabels: smc.map(\.label),
            cross: cross,
            vwapBias: vwapBias,
            bbState: bbState,
            divergence: divergence,
            rsiReversal: rsiReversal
        ))
        if fifth.coinFlip {
            narrative += String(
                format: " Price is only $%.2f from lock with a ±$%.2f noise floor — this round is statistically a coin flip.",
                abs(fifth.gap), fifth.noiseFloor
            )
        } else if let pu = fifth.payoutUp, let pd = fifth.payoutDown, fifth.evUp <= 0, fifth.evDown <= 0 {
            narrative += String(
                format: " Crowd-skewed payouts (UP %.2fx / DOWN %.2fx) leave no positive expected value on either side.",
                pu, pd
            )
        } else if recommendation != .wait {
            let ev = recommendation == .up ? fifth.evUp : fifth.evDown
            narrative += String(
                format: " %@ carries %.1f%% expected value%@.",
                recommendation.rawValue, ev * 100,
                fifth.evEstimated ? " (assuming a 1.95x payout)" : " at live pool payouts"
            )
        }

        return Analysis(
            time: opts.forming?.time ?? candles[i].time,
            price: price,
            candleDirection: candleDirection,
            consecGreen: run.green,
            consecRed: run.red,
            patterns: patterns,
            priceAction: PriceActionBlock(bullScore: bullPA, bearScore: bearPA, signals: paSignals),
            volume: VolumeBlock(
                current: currentVol, average: volSma, relative: relative, spike: spike,
                expansion: expansion, divergence: divergence,
                bullPressure: bullPressure, bearPressure: bearPressure, signals: volSignals
            ),
            trend: TrendBlock(
                ema9: ema9, ema20: ema20, ema50: ema50, ema200: ema200,
                aboveCount: aboveCount, cross: cross, strength: abs(trendScore), signals: trendSignals
            ),
            momentum: MomentumBlock(
                rsi: rsi, macd: macdLine, macdSignal: macdSignal, macdHist: macdHist,
                stochRsi: stochRsi, strength: abs(momScore), signals: momSignals
            ),
            vwap: VwapBlock(value: vwap, distancePct: distancePct, bias: vwapBias, signals: vwapSignals),
            bollinger: BollingerBlock(
                upper: bbUpper, middle: bbMiddle, lower: bbLower, widthPct: bbWidth,
                state: bbState, event: bbEvent, signals: bbSignals
            ),
            smc: smc,
            categories: categories,
            totalScore: totalScore,
            upProbability: upProbability,
            downProbability: 100 - upProbability,
            confidence: confidence,
            expectedMovePct: (atr / price) * 100 * 2.24,
            recommendation: recommendation,
            narrative: narrative,
            fifth: fifth
        )
    }

    private struct NarrativeInput {
        let totalScore: Double
        let upProbability: Int
        let confidence: Int
        let recommendation: Recommendation
        let aboveCount: Int
        let rsi: Double
        let spike: Bool
        let runCount: Int
        let runIsGreen: Bool
        let smcLabels: [String]
        let cross: TrendBlock.Cross?
        let vwapBias: Direction
        let bbState: BollingerBlock.State
        let divergence: Direction
        let rsiReversal: Direction
    }

    private static func buildNarrative(_ n: NarrativeInput) -> String {
        var head: String
        if n.totalScore >= 35 {
            head = "The tape is showing strong bullish momentum"
        } else if n.totalScore >= 12 {
            head = "The tape is leaning bullish"
        } else if n.totalScore <= -35 {
            head = "The tape is under strong bearish pressure"
        } else if n.totalScore <= -12 {
            head = "The tape is leaning bearish"
        } else {
            head = "Market conditions are mixed"
        }

        var drivers: [String] = []
        if n.aboveCount >= 3 {
            drivers.append("price holding above the major EMAs")
        } else if n.aboveCount <= 1 {
            drivers.append("price trapped below the major EMAs")
        }
        if n.cross == .golden { drivers.append("a fresh EMA golden cross") }
        if n.cross == .death { drivers.append("a fresh EMA death cross") }
        if n.spike { drivers.append("a volume spike on the tape") }
        if n.runCount >= 3 { drivers.append("\(n.runCount) consecutive \(n.runIsGreen ? "green" : "red") candles") }
        if n.rsi >= 60 {
            drivers.append(String(format: "RSI at %.0f", n.rsi))
        } else if n.rsi <= 40 {
            drivers.append(String(format: "RSI down at %.0f", n.rsi))
        }
        if n.vwapBias == .bull {
            drivers.append("trade above session VWAP")
        } else if n.vwapBias == .bear {
            drivers.append("trade below session VWAP")
        }
        if n.divergence == .bear { drivers.append("fading volume behind the move") }
        if n.rsiReversal == .bull { drivers.append("an RSI reversal out of oversold") }
        if n.rsiReversal == .bear { drivers.append("an RSI reversal out of overbought") }
        if let first = n.smcLabels.first { drivers.append(first.lowercased()) }
        if n.bbState == .compression { drivers.append("a Bollinger squeeze building energy") }

        if !drivers.isEmpty {
            head += " with " + drivers.prefix(3).joined(separator: ", ")
        }
        head += "."

        var parts = [head]
        parts.append("Estimated probability of closing above the lock price is \(n.upProbability)% (\(100 - n.upProbability)% below).")
        if n.recommendation == .wait {
            parts.append("Confidence is \(n.confidence < 45 ? "low" : "moderate") at \(n.confidence)% — waiting for a cleaner setup is recommended.")
        } else {
            parts.append("Confidence is \(n.confidence >= 75 ? "high" : "moderate") at \(n.confidence)% — model favors the \(n.recommendation.rawValue) side this round.")
        }
        return parts.joined(separator: " ")
    }
}

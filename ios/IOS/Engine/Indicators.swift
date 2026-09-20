import Foundation

nonisolated struct MacdBundle: Sendable {
    let macd: [Double]
    let signal: [Double]
    let hist: [Double]
}

nonisolated struct BollingerBundle: Sendable {
    let upper: [Double]
    let middle: [Double]
    let lower: [Double]
    let widthPct: [Double]
}

/// Causal technical indicator series. Warm-up values are `.nan` so no bar ever
/// reads a value that depends on data it could not have seen.
nonisolated enum Indicators {
    static func sma(_ values: [Double], period: Int) -> [Double] {
        var out = [Double](repeating: .nan, count: values.count)
        guard period > 0 else { return out }
        var sum = 0.0
        for i in values.indices {
            sum += values[i]
            if i >= period { sum -= values[i - period] }
            if i >= period - 1 { out[i] = sum / Double(period) }
        }
        return out
    }

    static func ema(_ values: [Double], period: Int) -> [Double] {
        var out = [Double](repeating: .nan, count: values.count)
        guard values.count >= period, period > 0 else { return out }
        let k = 2.0 / Double(period + 1)
        var seed = 0.0
        for i in 0..<period { seed += values[i] }
        var value = seed / Double(period)
        out[period - 1] = value
        for i in period..<values.count {
            value = values[i] * k + value * (1 - k)
            out[i] = value
        }
        return out
    }

    /// Wilder RSI.
    static func rsi(_ values: [Double], period: Int = 14) -> [Double] {
        var out = [Double](repeating: .nan, count: values.count)
        guard values.count > period else { return out }
        var avgGain = 0.0
        var avgLoss = 0.0
        for i in 1...period {
            let d = values[i] - values[i - 1]
            if d >= 0 { avgGain += d } else { avgLoss -= d }
        }
        avgGain /= Double(period)
        avgLoss /= Double(period)
        out[period] = avgLoss == 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
        guard values.count > period + 1 else { return out }
        for i in (period + 1)..<values.count {
            let d = values[i] - values[i - 1]
            let gain = d > 0 ? d : 0
            let loss = d < 0 ? -d : 0
            avgGain = (avgGain * Double(period - 1) + gain) / Double(period)
            avgLoss = (avgLoss * Double(period - 1) + loss) / Double(period)
            out[i] = avgLoss == 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
        }
        return out
    }

    /// MACD (12 / 26 / 9).
    static func macd(_ values: [Double]) -> MacdBundle {
        let ema12 = ema(values, period: 12)
        let ema26 = ema(values, period: 26)
        var macdLine = [Double](repeating: .nan, count: values.count)
        for i in values.indices where ema12[i].isFinite && ema26[i].isFinite {
            macdLine[i] = ema12[i] - ema26[i]
        }
        var signal = [Double](repeating: .nan, count: values.count)
        let k = 2.0 / 10.0
        var value = 0.0
        var seeded = false
        var seedSum = 0.0
        var seedCount = 0
        for i in values.indices {
            let m = macdLine[i]
            guard m.isFinite else { continue }
            if !seeded {
                seedSum += m
                seedCount += 1
                if seedCount == 9 {
                    value = seedSum / 9
                    signal[i] = value
                    seeded = true
                }
                continue
            }
            value = m * k + value * (1 - k)
            signal[i] = value
        }
        var hist = [Double](repeating: .nan, count: values.count)
        for i in values.indices where macdLine[i].isFinite && signal[i].isFinite {
            hist[i] = macdLine[i] - signal[i]
        }
        return MacdBundle(macd: macdLine, signal: signal, hist: hist)
    }

    /// Smoothed Stochastic RSI %K, 0...100.
    static func stochRsi(_ values: [Double], rsiPeriod: Int = 14, stochPeriod: Int = 14, smoothK: Int = 3) -> [Double] {
        let rsiValues = rsi(values, period: rsiPeriod)
        var raw = [Double](repeating: .nan, count: values.count)
        for i in values.indices {
            guard rsiValues[i].isFinite, i >= rsiPeriod + stochPeriod else { continue }
            var mn = Double.infinity
            var mx = -Double.infinity
            var ok = true
            for j in (i - stochPeriod + 1)...i {
                let r = rsiValues[j]
                if !r.isFinite { ok = false; break }
                mn = Swift.min(mn, r)
                mx = Swift.max(mx, r)
            }
            guard ok else { continue }
            raw[i] = mx == mn ? 50 : ((rsiValues[i] - mn) / (mx - mn)) * 100
        }
        var out = [Double](repeating: .nan, count: values.count)
        for i in values.indices {
            var sum = 0.0
            var n = 0
            for j in Swift.max(0, i - smoothK + 1)...i where raw[j].isFinite {
                sum += raw[j]
                n += 1
            }
            if n == smoothK { out[i] = sum / Double(n) }
        }
        return out
    }

    /// Session VWAP, anchored to the UTC day.
    static func vwap(_ candles: [Candle]) -> [Double] {
        var out = [Double](repeating: .nan, count: candles.count)
        var cumPV = 0.0
        var cumV = 0.0
        var day = -1.0
        for i in candles.indices {
            let c = candles[i]
            let d = (c.time.timeIntervalSince1970 / 86_400).rounded(.down)
            if d != day {
                day = d
                cumPV = 0
                cumV = 0
            }
            let tp = (c.high + c.low + c.close) / 3
            cumPV += tp * c.volume
            cumV += c.volume
            out[i] = cumV > 0 ? cumPV / cumV : c.close
        }
        return out
    }

    /// Wilder ATR.
    static func atr(_ candles: [Candle], period: Int = 14) -> [Double] {
        var out = [Double](repeating: .nan, count: candles.count)
        guard candles.count > period else { return out }
        var tr = [Double](repeating: 0, count: candles.count)
        tr[0] = candles[0].high - candles[0].low
        for i in 1..<candles.count {
            let c = candles[i]
            let pc = candles[i - 1].close
            tr[i] = Swift.max(c.high - c.low, abs(c.high - pc), abs(c.low - pc))
        }
        var value = 0.0
        for i in 0..<period { value += tr[i] }
        value /= Double(period)
        out[period - 1] = value
        for i in period..<candles.count {
            value = (value * Double(period - 1) + tr[i]) / Double(period)
            out[i] = value
        }
        return out
    }

    static func bollinger(_ values: [Double], period: Int = 20, mult: Double = 2) -> BollingerBundle {
        let middle = sma(values, period: period)
        var upper = [Double](repeating: .nan, count: values.count)
        var lower = [Double](repeating: .nan, count: values.count)
        var widthPct = [Double](repeating: .nan, count: values.count)
        guard values.count >= period else {
            return BollingerBundle(upper: upper, middle: middle, lower: lower, widthPct: widthPct)
        }
        for i in (period - 1)..<values.count {
            let m = middle[i]
            var variance = 0.0
            for j in (i - period + 1)...i {
                let d = values[j] - m
                variance += d * d
            }
            let sd = (variance / Double(period)).squareRoot()
            upper[i] = m + mult * sd
            lower[i] = m - mult * sd
            widthPct[i] = m != 0 ? ((upper[i] - lower[i]) / m) * 100 : .nan
        }
        return BollingerBundle(upper: upper, middle: middle, lower: lower, widthPct: widthPct)
    }

    /// Pearson correlation coefficient of two series, −1...1.
    static func pearson(_ a: [Double], _ b: [Double]) -> Double {
        let n = Swift.min(a.count, b.count)
        guard n >= 5 else { return 0 }
        var sa = 0.0
        var sb = 0.0
        for i in 0..<n {
            sa += a[i]
            sb += b[i]
        }
        let ma = sa / Double(n)
        let mb = sb / Double(n)
        var cov = 0.0
        var va = 0.0
        var vb = 0.0
        for i in 0..<n {
            let da = a[i] - ma
            let db = b[i] - mb
            cov += da * db
            va += da * da
            vb += db * db
        }
        guard va > 0, vb > 0 else { return 0 }
        return cov / (va * vb).squareRoot()
    }
}

/// Clamps a value into a closed range.
nonisolated func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    Swift.min(hi, Swift.max(lo, v))
}

import Foundation

nonisolated enum Patterns {
    /// Consecutive same-colour closed candles ending at `endIndex`.
    static func consecutiveRun(_ candles: [Candle], endIndex: Int) -> (green: Int, red: Int) {
        var green = 0
        var red = 0
        var i = endIndex
        while i >= 0 {
            let c = candles[i]
            if c.close > c.open {
                if red > 0 { break }
                green += 1
            } else if c.close < c.open {
                if green > 0 { break }
                red += 1
            } else {
                break
            }
            i -= 1
        }
        return (green, red)
    }

    /// Candlestick patterns present on the closed bar at index `i`.
    static func detect(_ candles: [Candle], at i: Int, atr: Double) -> [PatternHit] {
        guard i >= 12, i < candles.count else { return [] }
        var hits: [PatternHit] = []
        let c = candles[i]
        let p = candles[i - 1]
        let body = abs(c.close - c.open)
        let range = c.high - c.low
        let upperWick = c.high - Swift.max(c.open, c.close)
        let lowerWick = Swift.min(c.open, c.close) - c.low
        let green = c.close > c.open
        let red = c.close < c.open
        let pBody = abs(p.close - p.open)

        if range > 0, body <= range * 0.1 {
            hits.append(PatternHit(name: "Doji", direction: .neutral))
        }
        if body > 0, lowerWick >= body * 2, upperWick <= body, c.close >= c.low + range * 0.6 {
            hits.append(PatternHit(name: "Hammer", direction: .bull))
        }
        if body > 0, upperWick >= body * 2, lowerWick <= body, c.close <= c.high - range * 0.6 {
            hits.append(PatternHit(name: "Shooting Star", direction: .bear))
        }
        if green, p.close < p.open, c.close > p.open, c.open <= p.close, body > pBody {
            hits.append(PatternHit(name: "Bullish Engulfing", direction: .bull))
        }
        if red, p.close > p.open, c.close < p.open, c.open >= p.close, body > pBody {
            hits.append(PatternHit(name: "Bearish Engulfing", direction: .bear))
        }
        if atr > 0, body > atr * 1.4, range > 0, body / range > 0.7 {
            hits.append(PatternHit(name: "Momentum Candle", direction: green ? .bull : .bear))
        }

        var hh = -Double.infinity
        var ll = Double.infinity
        for j in (i - 10)..<i {
            hh = Swift.max(hh, candles[j].high)
            ll = Swift.min(ll, candles[j].low)
        }
        if c.close > hh { hits.append(PatternHit(name: "Breakout Candle (Up)", direction: .bull)) }
        if c.close < ll { hits.append(PatternHit(name: "Breakout Candle (Down)", direction: .bear)) }
        return hits
    }
}

nonisolated enum SmartMoney {
    /// Liquidity sweeps, traps and sharp reversals on the closed bar at index `i`.
    static func detect(_ candles: [Candle], at i: Int, atr: Double) -> [SmcEvent] {
        guard i >= 16, i < candles.count else { return [] }
        var events: [SmcEvent] = []
        let c = candles[i]
        let prev = candles[i - 1]

        var hh = -Double.infinity
        var ll = Double.infinity
        for j in (i - 10)..<i {
            hh = Swift.max(hh, candles[j].high)
            ll = Swift.min(ll, candles[j].low)
        }
        if c.high > hh, c.close < hh, c.close < c.open {
            events.append(SmcEvent(type: "sweep-high", direction: .bear, label: "Liquidity sweep above highs — stop hunt"))
        }
        if c.low < ll, c.close > ll, c.close > c.open {
            events.append(SmcEvent(type: "sweep-low", direction: .bull, label: "Liquidity sweep below lows — stop hunt"))
        }

        var hh2 = -Double.infinity
        var ll2 = Double.infinity
        for j in (i - 11)..<(i - 1) {
            hh2 = Swift.max(hh2, candles[j].high)
            ll2 = Swift.min(ll2, candles[j].low)
        }
        if prev.close > hh2, c.close < hh2 {
            events.append(SmcEvent(type: "bull-trap", direction: .bear, label: "Bull trap — fake breakout above range"))
        }
        if prev.close < ll2, c.close > ll2 {
            events.append(SmcEvent(type: "bear-trap", direction: .bull, label: "Bear trap — fake breakdown below range"))
        }

        let range = c.high - c.low
        if atr > 0, range > atr * 2.2, i >= 4 {
            let net3 = candles[i - 1].close - candles[i - 4].close
            if net3 > 0, c.close < c.open {
                events.append(SmcEvent(type: "sharp-reversal-bear", direction: .bear, label: "Sharp bearish reversal candle"))
            }
            if net3 < 0, c.close > c.open {
                events.append(SmcEvent(type: "sharp-reversal-bull", direction: .bull, label: "Sharp bullish reversal candle"))
            }
        }
        return events
    }
}

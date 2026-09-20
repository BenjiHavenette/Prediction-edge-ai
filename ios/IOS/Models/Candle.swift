import Foundation

/// A single OHLCV bar. `time` is the bar's open time.
nonisolated struct Candle: Identifiable, Hashable, Sendable {
    let time: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double

    var id: Double { time.timeIntervalSince1970 }

    var isGreen: Bool { close > open }
    var isRed: Bool { close < open }
    var body: Double { abs(close - open) }
    var range: Double { high - low }
}

extension Array where Element == Candle {
    var closes: [Double] { map(\.close) }
    var volumes: [Double] { map(\.volume) }
}

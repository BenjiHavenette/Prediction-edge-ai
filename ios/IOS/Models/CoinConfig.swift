import Foundation

nonisolated enum CoinID: String, CaseIterable, Identifiable, Sendable {
    case btc = "BTC"
    case bnb = "BNB"
    case eth = "ETH"

    var id: String { rawValue }
}

/// Per-market configuration: Binance symbol, PancakeSwap Prediction contract,
/// correlation peers and how prices should be formatted.
nonisolated struct CoinConfig: Sendable {
    let id: CoinID
    let name: String
    /// Binance kline/stream symbol, e.g. "BTCUSDT".
    let symbol: String
    /// Display pair, e.g. "BTC/USDT".
    let pair: String
    /// PancakeSwap Prediction V2 contract on BNB Chain.
    let contract: String
    /// Decimal places used when rendering the price.
    let decimals: Int

    static let all: [CoinID: CoinConfig] = [
        .btc: CoinConfig(
            id: .btc,
            name: "Bitcoin",
            symbol: "BTCUSDT",
            pair: "BTC/USDT",
            contract: "0x48781a7d35f6137a9135Bbb984AF65fd6AB25618",
            decimals: 2
        ),
        .bnb: CoinConfig(
            id: .bnb,
            name: "BNB",
            symbol: "BNBUSDT",
            pair: "BNB/USDT",
            contract: "0x18B2A687610328590Bc8F2e5fEdDe3b582A49cdA",
            decimals: 3
        ),
        .eth: CoinConfig(
            id: .eth,
            name: "Ethereum",
            symbol: "ETHUSDT",
            pair: "ETH/USDT",
            contract: "0x7451F994A8D510CBCB46cF57D50F31F188Ff58F5",
            decimals: 2
        ),
    ]

    static func config(for id: CoinID) -> CoinConfig {
        all[id] ?? all[.btc]!
    }
}

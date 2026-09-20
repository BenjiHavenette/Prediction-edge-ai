import Foundation

nonisolated enum MarketDataError: LocalizedError {
    case allEndpointsUnreachable
    case badResponse(Int)
    case decoding

    var errorDescription: String? {
        switch self {
        case .allEndpointsUnreachable: "No market data endpoint is reachable right now."
        case .badResponse(let code): "Market data request failed (HTTP \(code))."
        case .decoding: "Market data response could not be read."
        }
    }
}

nonisolated struct MarketEndpoint: Sendable {
    let name: String
    let rest: String
    let ws: String
}

nonisolated struct KlineUpdate: Sendable {
    let symbol: String
    let candle: Candle
    let closed: Bool
}

/// Binance market data with automatic endpoint failover.
/// `api.binance.com` is geo-blocked in some regions, so each host is probed and
/// the first reachable one is cached for both REST and the live stream.
actor MarketDataService {
    static let shared = MarketDataService()

    private static let endpoints: [MarketEndpoint] = [
        MarketEndpoint(name: "binance-vision", rest: "https://data-api.binance.vision/api/v3", ws: "wss://data-stream.binance.vision/stream"),
        MarketEndpoint(name: "binance-global", rest: "https://api.binance.com/api/v3", ws: "wss://stream.binance.com:9443/stream"),
        MarketEndpoint(name: "binance-us", rest: "https://api.binance.us/api/v3", ws: "wss://stream.binance.us:9443/stream"),
    ]

    private var active: MarketEndpoint?

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 15
        config.waitsForConnectivity = true
        return URLSession(configuration: config)
    }()

    func resolveEndpoint() async throws -> MarketEndpoint {
        if let active { return active }
        for ep in Self.endpoints {
            guard let url = URL(string: "\(ep.rest)/klines?symbol=BTCUSDT&interval=1m&limit=1") else { continue }
            do {
                let (_, response) = try await session.data(from: url)
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    active = ep
                    return ep
                }
            } catch {
                continue
            }
        }
        throw MarketDataError.allEndpointsUnreachable
    }

    func resetEndpoint() {
        active = nil
    }

    /// Fetches up to 1000 one-minute klines ending at `endTime`.
    func fetchKlines(symbol: String, interval: String = "1m", limit: Int, endTime: Date? = nil) async throws -> [Candle] {
        let ep = try await resolveEndpoint()
        var components = URLComponents(string: "\(ep.rest)/klines")
        var items = [
            URLQueryItem(name: "symbol", value: symbol),
            URLQueryItem(name: "interval", value: interval),
            URLQueryItem(name: "limit", value: String(Swift.min(limit, 1000))),
        ]
        if let endTime {
            items.append(URLQueryItem(name: "endTime", value: String(Int(endTime.timeIntervalSince1970 * 1000))))
        }
        components?.queryItems = items
        guard let url = components?.url else { throw MarketDataError.decoding }

        let (data, response) = try await session.data(from: url)
        guard let http = response as? HTTPURLResponse else { throw MarketDataError.decoding }
        guard http.statusCode == 200 else {
            active = nil
            throw MarketDataError.badResponse(http.statusCode)
        }
        guard let raw = try JSONSerialization.jsonObject(with: data) as? [[Any]] else {
            throw MarketDataError.decoding
        }
        return raw.compactMap(Self.mapKline)
    }

    /// Fetches `total` klines by paging backwards in batches of 1000.
    func fetchKlinesDeep(symbol: String, total: Int) async throws -> [Candle] {
        var out: [Candle] = []
        var endTime: Date?
        while out.count < total {
            let batch = try await fetchKlines(symbol: symbol, limit: total - out.count, endTime: endTime)
            if batch.isEmpty { break }
            out = batch + out
            endTime = batch[0].time.addingTimeInterval(-0.001)
            if batch.count < 1000 { break }
        }
        return out
    }

    private static func mapKline(_ k: [Any]) -> Candle? {
        func num(_ v: Any?) -> Double? {
            if let d = v as? Double { return d }
            if let i = v as? Int { return Double(i) }
            if let s = v as? String { return Double(s) }
            if let n = v as? NSNumber { return n.doubleValue }
            return nil
        }
        guard k.count >= 6,
              let t = num(k[0]), let o = num(k[1]), let h = num(k[2]),
              let l = num(k[3]), let c = num(k[4]), let v = num(k[5])
        else { return nil }
        return Candle(
            time: Date(timeIntervalSince1970: t / 1000),
            open: o, high: h, low: l, close: c, volume: v
        )
    }

    func streamURL(symbols: [String]) async throws -> URL {
        let ep = try await resolveEndpoint()
        let streams = symbols.map { "\($0.lowercased())@kline_1m" }.joined(separator: "/")
        guard let url = URL(string: "\(ep.ws)?streams=\(streams)") else { throw MarketDataError.decoding }
        return url
    }
}

/// Live 1-minute kline stream with exponential-backoff reconnection.
/// Exposed as an `AsyncStream` so the view model can simply `for await` updates.
nonisolated final class MarketStream: @unchecked Sendable {
    private var task: URLSessionWebSocketTask?
    private var runner: Task<Void, Never>?
    private let session = URLSession(configuration: .default)

    enum Event: Sendable {
        case status(Bool)
        case kline(KlineUpdate)
    }

    func start(symbols: [String]) -> AsyncStream<Event> {
        AsyncStream { continuation in
            runner = Task { [weak self] in
                guard let self else { return }
                var retry = 0
                while !Task.isCancelled {
                    do {
                        if retry >= 3 { await MarketDataService.shared.resetEndpoint() }
                        let url = try await MarketDataService.shared.streamURL(symbols: symbols)
                        let ws = session.webSocketTask(with: url)
                        self.task = ws
                        ws.resume()
                        continuation.yield(.status(true))
                        retry = 0
                        while !Task.isCancelled {
                            let message = try await ws.receive()
                            if case .string(let text) = message, let update = Self.parse(text) {
                                continuation.yield(.kline(update))
                            }
                        }
                        ws.cancel(with: .goingAway, reason: nil)
                    } catch {
                        if Task.isCancelled { break }
                        continuation.yield(.status(false))
                        let delay = Swift.min(15.0, pow(2.0, Double(retry)))
                        retry += 1
                        try? await Task.sleep(for: .seconds(delay))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { [weak self] _ in
                self?.stop()
            }
        }
    }

    func stop() {
        runner?.cancel()
        runner = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    private static func parse(_ text: String) -> KlineUpdate? {
        guard let data = text.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = root["data"] as? [String: Any],
              let symbol = payload["s"] as? String,
              let k = payload["k"] as? [String: Any]
        else { return nil }

        func num(_ v: Any?) -> Double? {
            if let d = v as? Double { return d }
            if let s = v as? String { return Double(s) }
            if let n = v as? NSNumber { return n.doubleValue }
            return nil
        }
        guard let t = num(k["t"]), let o = num(k["o"]), let h = num(k["h"]),
              let l = num(k["l"]), let c = num(k["c"]), let v = num(k["v"])
        else { return nil }
        let closed = (k["x"] as? Bool) ?? false
        return KlineUpdate(
            symbol: symbol,
            candle: Candle(time: Date(timeIntervalSince1970: t / 1000), open: o, high: h, low: l, close: c, volume: v),
            closed: closed
        )
    }
}

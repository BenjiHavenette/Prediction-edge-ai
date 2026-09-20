import Foundation

/// The round currently open for betting (locks when the live round closes).
nonisolated struct NextChainRound: Sendable {
    let epoch: Int
    let lockTime: Date
    let closeTime: Date
    let totalBnb: Double
    let bullBnb: Double
    let bearBnb: Double
}

nonisolated struct ChainRound: Sendable {
    /// PancakeSwap round number (epoch).
    let epoch: Int
    /// Live phase start (lockTimestamp).
    let startTime: Date
    /// Live phase end (closeTimestamp).
    let closeTime: Date
    /// Chainlink lock price in USD (0 when not yet recorded).
    let lockPrice: Double
    let totalBnb: Double
    let bullBnb: Double
    let bearBnb: Double
    /// The next round, currently open for betting.
    let next: NextChainRound?
    let fetchedAt: Date
    /// Correction to add to the device clock so it matches BNB Chain time.
    let clockOffset: TimeInterval
}

nonisolated enum PancakeError: LocalizedError {
    case allRpcFailed
    case badResponse
    case invalidEpoch

    var errorDescription: String? {
        switch self {
        case .allRpcFailed: "Could not reach any BNB Chain RPC endpoint."
        case .badResponse: "The PancakeSwap contract returned unreadable data."
        case .invalidEpoch: "The PancakeSwap contract returned an invalid round."
        }
    }
}

/// Reads live round data directly from a PancakeSwap Prediction V2 contract on
/// BNB Chain, so round number, lock price and countdown match pancakeswap.finance.
actor PancakeService {
    static let shared = PancakeService()

    /// keccak-256 selectors: currentEpoch() and rounds(uint256).
    private static let selCurrentEpoch = "0x76671808"
    private static let selRounds = "0x8c65c81f"

    private static let rpcURLs = [
        "https://bsc-rpc.publicnode.com",
        "https://bsc-dataseed.binance.org",
        "https://bsc-dataseed1.bnbchain.org",
        "https://bsc-dataseed2.bnbchain.org",
    ]

    private var rpcIndex = 0

    private let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 8
        return URLSession(configuration: config)
    }()

    private func rpc(method: String, params: [Any]) async throws -> Any {
        var lastError: Error = PancakeError.allRpcFailed
        for offset in 0..<Self.rpcURLs.count {
            let index = (rpcIndex + offset) % Self.rpcURLs.count
            guard let url = URL(string: Self.rpcURLs[index]) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: [String: Any] = ["jsonrpc": "2.0", "id": 1, "method": method, "params": params]
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    throw PancakeError.badResponse
                }
                guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let result = json["result"]
                else { throw PancakeError.badResponse }
                rpcIndex = index
                return result
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private func ethCall(contract: String, data: String) async throws -> String {
        let result = try await rpc(method: "eth_call", params: [["to": contract, "data": data], "latest"])
        guard let hex = result as? String, hex.hasPrefix("0x") else { throw PancakeError.badResponse }
        return hex
    }

    /// Splits an ABI-encoded response into 32-byte words.
    private func hexWords(_ result: String) -> [Double] {
        let hex = String(result.dropFirst(2))
        var words: [Double] = []
        var index = hex.startIndex
        while let end = hex.index(index, offsetBy: 64, limitedBy: hex.endIndex) {
            let word = String(hex[index..<end])
            // Round-struct values fit comfortably in Double precision for our use.
            words.append(Self.hexToDouble(word))
            index = end
        }
        return words
    }

    private static func hexToDouble(_ hex: String) -> Double {
        let trimmed = hex.drop(while: { $0 == "0" })
        guard !trimmed.isEmpty else { return 0 }
        var value = 0.0
        for ch in trimmed {
            guard let digit = ch.hexDigitValue else { return value }
            value = value * 16 + Double(digit)
        }
        return value
    }

    private struct RawRound {
        let epoch: Int
        let lockTime: Date
        let closeTime: Date
        let lockPrice: Double
        let totalBnb: Double
        let bullBnb: Double
        let bearBnb: Double
    }

    private func fetchRound(contract: String, epoch: Int) async throws -> RawRound {
        let arg = String(format: "%064x", epoch)
        let words = hexWords(try await ethCall(contract: contract, data: Self.selRounds + arg))
        guard words.count >= 14 else { throw PancakeError.badResponse }
        // [epoch, startTs, lockTs, closeTs, lockPrice(1e8), closePrice(1e8),
        //  lockOracleId, closeOracleId, totalAmount(1e18), bullAmount(1e18), bearAmount(1e18), ...]
        return RawRound(
            epoch: Int(words[0]),
            lockTime: Date(timeIntervalSince1970: words[2]),
            closeTime: Date(timeIntervalSince1970: words[3]),
            lockPrice: words[4] / 1e8,
            totalBnb: words[8] / 1e18,
            bullBnb: words[9] / 1e18,
            bearBnb: words[10] / 1e18
        )
    }

    /// Estimates how far the device clock is from BNB Chain time.
    private func fetchClockOffset() async -> TimeInterval {
        let t0 = Date()
        guard let block = try? await rpc(method: "eth_getBlockByNumber", params: ["latest", false]) as? [String: Any],
              let timestamp = block["timestamp"] as? String
        else { return 0 }
        let t1 = Date()
        let blockSeconds = Self.hexToDouble(String(timestamp.dropFirst(2)))
        guard blockSeconds > 0 else { return 0 }
        let localMid = (t0.timeIntervalSince1970 + t1.timeIntervalSince1970) / 2
        let offset = blockSeconds - localMid
        // Block timestamps lag real time by a few seconds; ignore tiny skews.
        return abs(offset) < 3 ? 0 : offset
    }

    /// Fetches the round currently in its LIVE phase, plus the bettable next round.
    func fetchLiveRound(contract: String) async throws -> ChainRound {
        async let epochHexTask = ethCall(contract: contract, data: Self.selCurrentEpoch)
        async let offsetTask = fetchClockOffset()
        let epochHex = try await epochHexTask
        let clockOffset = await offsetTask

        let currentEpoch = Int(hexWords(epochHex).first ?? 0)
        guard currentEpoch >= 2 else { throw PancakeError.invalidEpoch }

        let live = try await fetchRound(contract: contract, epoch: currentEpoch - 1)
        let betting = try? await fetchRound(contract: contract, epoch: currentEpoch)

        guard live.lockTime.timeIntervalSince1970 > 0, live.closeTime > live.lockTime else {
            throw PancakeError.invalidEpoch
        }

        var next: NextChainRound?
        if let betting, betting.lockTime.timeIntervalSince1970 > 0 {
            next = NextChainRound(
                epoch: betting.epoch,
                lockTime: betting.lockTime,
                closeTime: betting.closeTime,
                totalBnb: betting.totalBnb,
                bullBnb: betting.bullBnb,
                bearBnb: betting.bearBnb
            )
        }

        return ChainRound(
            epoch: live.epoch,
            startTime: live.lockTime,
            closeTime: live.closeTime,
            lockPrice: live.lockPrice,
            totalBnb: live.totalBnb,
            bullBnb: live.bullBnb,
            bearBnb: live.bearBnb,
            next: next,
            fetchedAt: Date(),
            clockOffset: clockOffset
        )
    }
}

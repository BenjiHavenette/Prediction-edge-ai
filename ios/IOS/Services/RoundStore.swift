import Foundation

/// Persists settled round records per coin so accuracy, learning weights and
/// the regime audit survive relaunch. Records are capped so storage stays small.
nonisolated struct RoundStore: Sendable {
    private static let cap = 400

    private let defaults = UserDefaults.standard

    private func key(for coin: CoinID) -> String {
        "pea.rounds.v1.\(coin.rawValue)"
    }

    func load(coin: CoinID) -> [RoundRecord] {
        guard let data = defaults.data(forKey: key(for: coin)) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        guard let records = try? decoder.decode([RoundRecord].self, from: data) else { return [] }
        return records
    }

    func save(_ records: [RoundRecord], coin: CoinID) {
        let trimmed = Array(records.suffix(Self.cap))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        guard let data = try? encoder.encode(trimmed) else { return }
        defaults.set(data, forKey: key(for: coin))
    }
}

/// Remembers which market the user last watched.
nonisolated struct CoinPreference: Sendable {
    private static let key = "pea.selectedCoin.v1"

    static func load() -> CoinID {
        guard let raw = UserDefaults.standard.string(forKey: key),
              let coin = CoinID(rawValue: raw)
        else { return .btc }
        return coin
    }

    static func save(_ coin: CoinID) {
        UserDefaults.standard.set(coin.rawValue, forKey: key)
    }
}

import Foundation
import Observation

@MainActor
@Observable
final class MarketViewModel {
    enum LoadState: Equatable {
        case loading(String)
        case ready
        case failed(String)
    }

    // MARK: - Published state

    private(set) var state: LoadState = .loading("Connecting to the market…")
    private(set) var streamConnected = false
    private(set) var candles: [Candle] = []
    private(set) var livePrice: Double = 0
    private(set) var analysis: Analysis?
    private(set) var regime: RegimeState?
    private(set) var advice: EntryAdvice?
    private(set) var learning: LearningState = .empty
    private(set) var records: [RoundRecord] = []
    private(set) var chainRound: ChainRound?
    private(set) var secondsLeft: Double = 0
    private(set) var lastUpdated: Date?

    var coin: CoinID = CoinPreference.load()

    var config: CoinConfig { CoinConfig.config(for: coin) }

    /// Rounds shown newest first.
    var recentRecords: [RoundRecord] { records.reversed() }

    /// The 240 most recent bars, for the chart.
    var chartCandles: [Candle] { Array(candles.suffix(120)) }

    // MARK: - Private

    private var bundle: SeriesBundle?
    private var stream: MarketStream?
    private var streamTask: Task<Void, Never>?
    private var tickerTask: Task<Void, Never>?
    private var chainTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?
    private let store = RoundStore()
    /// Lock-time analysis per epoch, so a round is graded with the call that
    /// was actually made before it locked — never with hindsight.
    private var pendingLocks: [Int: (analysis: Analysis, regime: RegimeState, lockPrice: Double, startTime: Date)] = [:]

    // MARK: - Lifecycle

    func start() {
        guard loadTask == nil else { return }
        loadTask = Task { await self.bootstrap() }
    }

    func stop() {
        streamTask?.cancel()
        tickerTask?.cancel()
        chainTask?.cancel()
        loadTask?.cancel()
        stream?.stop()
        streamTask = nil
        tickerTask = nil
        chainTask = nil
        loadTask = nil
        stream = nil
    }

    func retry() {
        stop()
        state = .loading("Reconnecting…")
        start()
    }

    /// Switches market and resets every engine so the brains never mix.
    func select(coin newCoin: CoinID) {
        guard newCoin != coin else { return }
        stop()
        coin = newCoin
        CoinPreference.save(newCoin)
        candles = []
        bundle = nil
        analysis = nil
        regime = nil
        advice = nil
        chainRound = nil
        livePrice = 0
        secondsLeft = 0
        pendingLocks = [:]
        records = store.load(coin: newCoin)
        learning = LearningEngine.compute(records)
        state = .loading("Loading \(newCoin.rawValue)…")
        start()
    }

    // MARK: - Bootstrap

    private func bootstrap() async {
        records = store.load(coin: coin)
        learning = LearningEngine.compute(records)

        state = .loading("Loading \(config.pair) history…")
        do {
            let history = try await MarketDataService.shared.fetchKlinesDeep(symbol: config.symbol, total: 1000)
            guard history.count >= PredictionEngine.minimumBars else {
                state = .failed("Only \(history.count) candles available — not enough history to run the engine.")
                return
            }
            candles = history
            bundle = SeriesBundle.build(history)
            livePrice = history.last?.close ?? 0
        } catch {
            state = .failed(error.localizedDescription)
            return
        }

        state = .loading("Syncing PancakeSwap rounds…")
        await refreshChainRound()

        if records.isEmpty, let chain = chainRound {
            let seeded = RoundFactory.seedRecords(
                candles: candles,
                anchorEpoch: chain.epoch,
                anchorStart: chain.startTime
            )
            if !seeded.isEmpty {
                records = seeded
                learning = LearningEngine.compute(records)
                store.save(records, coin: coin)
            }
        }

        recompute()
        state = .ready

        startStream()
        startTicker()
        startChainPolling()
    }

    // MARK: - Live stream

    private func startStream() {
        let market = MarketStream()
        stream = market
        let symbol = config.symbol
        streamTask = Task { [weak self] in
            for await event in market.start(symbols: [symbol]) {
                guard let self else { return }
                switch event {
                case .status(let connected):
                    self.streamConnected = connected
                case .kline(let update):
                    self.apply(update)
                }
            }
        }
    }

    private func apply(_ update: KlineUpdate) {
        guard update.symbol.uppercased() == config.symbol.uppercased() else { return }
        livePrice = update.candle.close
        lastUpdated = Date()

        if let last = candles.last, last.time == update.candle.time {
            candles[candles.count - 1] = update.candle
        } else if let last = candles.last, update.candle.time > last.time {
            candles.append(update.candle)
            if candles.count > 1200 { candles.removeFirst(candles.count - 1200) }
        } else {
            return
        }

        if update.closed {
            bundle = SeriesBundle.build(candles)
        }
        recompute()
    }

    // MARK: - Countdown

    private func startTicker() {
        tickerTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self else { return }
                self.updateCountdown()
            }
        }
    }

    private func updateCountdown() {
        guard let chain = chainRound else { return }
        let now = Date().addingTimeInterval(chain.clockOffset)
        secondsLeft = Swift.max(0, chain.closeTime.timeIntervalSince(now))
        // The round just closed — grade it and pull the next one.
        if secondsLeft <= 0, Date().timeIntervalSince(chain.fetchedAt) > 3 {
            Task { await self.refreshChainRound() }
        }
    }

    // MARK: - Chain polling

    private func startChainPolling() {
        chainTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(12))
                guard let self else { return }
                await self.refreshChainRound()
            }
        }
    }

    private func refreshChainRound() async {
        do {
            let fresh = try await PancakeService.shared.fetchLiveRound(contract: config.contract)
            let previous = chainRound
            chainRound = fresh
            updateCountdown()

            // A new live round means the previous one settled: grade it with the
            // analysis captured before it locked.
            if let previous, previous.epoch != fresh.epoch {
                gradeSettledRound(epoch: previous.epoch)
            }
            capturePendingLock(for: fresh)
            recompute()
        } catch {
            // Chain data is supplementary — the engine still runs on candles.
            if chainRound == nil, case .loading = state {
                // Keep loading; the next poll may succeed.
            }
        }
    }

    /// Stores the call being made for the currently live round, so it can be
    /// graded honestly once the round settles.
    private func capturePendingLock(for chain: ChainRound) {
        guard pendingLocks[chain.epoch] == nil, chain.lockPrice > 0 else { return }
        guard let analysis, let regime else { return }
        pendingLocks[chain.epoch] = (analysis, regime, chain.lockPrice, chain.startTime)
    }

    private func gradeSettledRound(epoch: Int) {
        guard let pending = pendingLocks.removeValue(forKey: epoch) else { return }
        guard !records.contains(where: { $0.id == epoch }) else { return }
        let closePrice = livePrice
        guard closePrice > 0 else { return }
        let record = RoundFactory.makeRecord(
            epoch: epoch,
            startTime: pending.startTime,
            lockPrice: pending.lockPrice,
            closePrice: closePrice,
            analysis: pending.analysis,
            regime: pending.regime,
            live: true
        )
        records.append(record)
        records.sort { $0.startTime < $1.startTime }
        if records.count > 400 { records.removeFirst(records.count - 400) }
        store.save(records, coin: coin)
        learning = LearningEngine.compute(records)
    }

    // MARK: - Engine

    private func recompute() {
        guard let bundle, candles.count > PredictionEngine.minimumBars else { return }
        // The last element may be a forming bar — analyse the last CLOSED one.
        let closedIndex = candles.count - 2
        guard closedIndex > 0 else { return }

        let forming = candles[candles.count - 1]
        let elapsed = clamp(Date().timeIntervalSince(forming.time) / 60, 0.05, 1)
        let newRegime = RegimeEngine.compute(candles, at: closedIndex)

        var pool: PoolInfo?
        if let next = chainRound?.next, next.totalBnb > 0 {
            pool = PoolInfo(bullBnb: next.bullBnb, bearBnb: next.bearBnb, totalBnb: next.totalBnb)
        }

        var options = AnalyzeOptions(price: livePrice > 0 ? livePrice : forming.close)
        options.lockPrice = (chainRound?.lockPrice).flatMap { $0 > 0 ? $0 : nil }
        options.forming = forming
        options.elapsedFraction = elapsed
        options.secondsLeft = chainRound != nil ? secondsLeft : nil
        options.pool = pool
        options.weights = learning.weights
        options.probShrink = newRegime.shrink

        let fresh = PredictionEngine.analyze(candles, bundle: bundle, at: closedIndex, options: options)
        analysis = fresh
        regime = newRegime
        advice = EntryAdvisor.advise(analysis: fresh, regime: newRegime, learning: learning)
        lastUpdated = Date()

        if let chain = chainRound { capturePendingLock(for: chain) }
    }
}

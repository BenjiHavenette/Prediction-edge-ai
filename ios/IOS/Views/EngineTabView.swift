import SwiftUI

/// Under the hood: the weighted category scores, every live signal the engine
/// is reading, and what it has learned from settled rounds.
struct EngineTabView: View {
    let model: MarketViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let analysis = model.analysis {
                    scorePanel(analysis)
                    learningPanel
                    signalsPanel(analysis)
                    patternsPanel
                } else {
                    Panel(title: "Engine", systemImage: "cpu") {
                        Text("Waiting for enough closed candles to run the weighted engine.")
                            .font(.label(12))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
    }

    // MARK: - Weighted scores

    private func scorePanel(_ analysis: Analysis) -> some View {
        let w = model.learning.weights
        return Panel(
            title: "Weighted Score",
            systemImage: "slider.horizontal.3",
            accessory: String(format: "total %.0f", analysis.totalScore)
        ) {
            VStack(spacing: 11) {
                ScoreBar(label: "Trend", score: analysis.categories.trend, weight: w.trend)
                ScoreBar(label: "Momentum", score: analysis.categories.momentum, weight: w.momentum)
                ScoreBar(label: "Volume", score: analysis.categories.volume, weight: w.volume)
                ScoreBar(label: "Structure", score: analysis.categories.structure, weight: w.structure)
                ScoreBar(label: "Confluence", score: analysis.categories.confluence, weight: w.confluence)
            }
            Text("Weights are re-derived from how each category actually called settled rounds — the ones that were right get louder.")
                .font(.label(11))
                .foregroundStyle(Theme.textFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Learning

    private var learningPanel: some View {
        let learning = model.learning
        return Panel(
            title: "What It Learned",
            systemImage: "brain",
            accessory: "\(learning.gatedSamples) graded"
        ) {
            HStack(spacing: 8) {
                StatTile(
                    label: "Gated Calls",
                    value: learning.gatedSamples > 0 ? String(format: "%.0f%%", learning.gatedAccuracy) : "—",
                    detail: "trend-confirmed only",
                    tint: learning.gatedAccuracy >= 60 ? Theme.up : (learning.gatedSamples > 0 ? Theme.down : Theme.textPrimary)
                )
                StatTile(
                    label: "Ungated",
                    value: learning.rawSamples > 0 ? String(format: "%.0f%%", learning.rawAccuracy) : "—",
                    detail: "\(learning.rawSamples) raw signals",
                    tint: Theme.neutral
                )
                StatTile(
                    label: "Last 10",
                    value: learning.last10Samples > 0 ? String(format: "%.0f%%", learning.last10) : "—",
                    detail: learning.lossStreak > 0 ? "\(learning.lossStreak) loss streak" : "no streak",
                    tint: learning.lossStreak >= 3 ? Theme.down : Theme.textPrimary
                )
            }

            if !learning.categories.isEmpty {
                VStack(spacing: 8) {
                    ForEach(learning.categories) { perf in
                        HStack {
                            Text(perf.name)
                                .font(.label(12, weight: .medium))
                                .foregroundStyle(Theme.textPrimary)
                            Spacer()
                            Text("\(perf.samples) samples")
                                .font(.tape(10))
                                .foregroundStyle(Theme.textFaint)
                            Text(String(format: "%.0f%%", perf.accuracy))
                                .font(.tape(12, weight: .bold))
                                .foregroundStyle(perf.accuracy >= 55 ? Theme.up : (perf.accuracy <= 45 ? Theme.down : Theme.neutral))
                                .frame(width: 44, alignment: .trailing)
                        }
                    }
                }
                .padding(.top, 2)
            }

            Text(learning.summary)
                .font(.label(12))
                .foregroundStyle(learning.isCold ? Theme.accent : Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: - Signals

    private func signalsPanel(_ analysis: Analysis) -> some View {
        Panel(title: "Live Signals", systemImage: "dot.radiowaves.up.forward") {
            signalGroup("Trend", analysis.trend.signals)
            signalGroup("Momentum", analysis.momentum.signals)
            signalGroup("Volume", analysis.volume.signals)
            signalGroup("VWAP", analysis.vwap.signals)
            signalGroup("Bollinger", analysis.bollinger.signals)
            if !analysis.priceAction.signals.isEmpty {
                signalGroup("Price Action", analysis.priceAction.signals)
            }
            if !analysis.smc.isEmpty {
                sectionHeader("Smart Money")
                ForEach(analysis.smc) { event in
                    SignalRow(signal: Signal(label: event.label, direction: event.direction))
                }
            }
        }
    }

    @ViewBuilder
    private func signalGroup(_ title: String, _ signals: [Signal]) -> some View {
        if !signals.isEmpty {
            sectionHeader(title)
            VStack(spacing: 6) {
                ForEach(Array(signals.enumerated()), id: \.offset) { _, signal in
                    SignalRow(signal: signal)
                }
            }
        }
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.label(9, weight: .bold))
            .kerning(1)
            .foregroundStyle(Theme.textFaint)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 4)
    }

    // MARK: - Patterns

    @ViewBuilder
    private var patternsPanel: some View {
        if !model.learning.patterns.isEmpty {
            Panel(title: "Pattern Scoreboard", systemImage: "square.grid.2x2", accessory: "graded on settled rounds") {
                ForEach(model.learning.patterns) { pattern in
                    HStack {
                        Text(pattern.name)
                            .font(.label(12, weight: .medium))
                            .foregroundStyle(Theme.textPrimary)
                        Spacer()
                        Text("\(pattern.wins)/\(pattern.total)")
                            .font(.tape(10))
                            .foregroundStyle(Theme.textFaint)
                        Text(String(format: "%.0f%%", pattern.accuracy))
                            .font(.tape(12, weight: .bold))
                            .foregroundStyle(pattern.accuracy >= 55 ? Theme.up : (pattern.accuracy <= 45 ? Theme.down : Theme.neutral))
                            .frame(width: 44, alignment: .trailing)
                    }
                }
            }
        }
    }
}

import SwiftUI

/// The desk: live price, the round countdown, the entry verdict and the
/// reasoning behind it.
struct LiveTabView: View {
    let model: MarketViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                priceHeader
                if let analysis = model.analysis, let advice = model.advice {
                    verdictCard(analysis: analysis, advice: advice)
                    chartPanel(analysis: analysis)
                    if let regime = model.regime { regimePanel(regime) }
                    fifthPanel(analysis.fifth)
                    narrativePanel(analysis.narrative)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
    }

    // MARK: - Price header

    private var priceHeader: some View {
        Panel(
            title: model.config.pair,
            systemImage: "chart.line.uptrend.xyaxis",
            accessory: model.streamConnected ? "live" : "reconnecting"
        ) {
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(model.livePrice.priceText(decimals: model.config.decimals))
                    .font(.tape(32, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Spacer(minLength: 4)
                countdown
            }
            .animation(.smooth(duration: 0.3), value: model.livePrice)

            if let chain = model.chainRound {
                HStack(spacing: 8) {
                    Badge(text: "round #\(chain.epoch)")
                    if chain.lockPrice > 0 {
                        let gap = model.livePrice - chain.lockPrice
                        Badge(
                            text: String(format: "gap %@%.2f", gap >= 0 ? "+" : "−", abs(gap)),
                            tint: gap >= 0 ? Theme.up : Theme.down
                        )
                    }
                    if let next = chain.next, next.totalBnb > 0 {
                        Badge(text: String(format: "pool %.1f BNB", next.totalBnb), tint: Theme.neutral)
                    }
                }
            }
        }
    }

    private var countdown: some View {
        let total = model.secondsLeft
        let minutes = Int(total) / 60
        let seconds = Int(total) % 60
        let urgent = total > 0 && total <= 60
        return VStack(alignment: .trailing, spacing: 1) {
            Text(String(format: "%d:%02d", minutes, seconds))
                .font(.tape(20, weight: .bold))
                .foregroundStyle(urgent ? Theme.down : Theme.accent)
                .monospacedDigit()
            Text("to close")
                .font(.label(9, weight: .semibold))
                .foregroundStyle(Theme.textFaint)
        }
        .opacity(urgent ? 0.55 : 1)
        .animation(urgent ? .easeInOut(duration: 0.6).repeatForever(autoreverses: true) : .default, value: urgent)
    }

    // MARK: - Verdict

    private func verdictCard(analysis: Analysis, advice: EntryAdvice) -> some View {
        let tint: Color = switch advice.verdict {
        case .enterUp: Theme.up
        case .enterDown: Theme.down
        case .stand: Theme.neutral
        }
        return VStack(spacing: 14) {
            HStack(alignment: .center, spacing: 16) {
                ProbabilityDial(
                    upProbability: analysis.upProbability,
                    confidence: analysis.confidence,
                    verdict: advice.verdict
                )
                .frame(width: 112, height: 112)

                VStack(alignment: .leading, spacing: 7) {
                    Text(advice.verdict.rawValue)
                        .font(.label(20, weight: .heavy))
                        .kerning(0.5)
                        .foregroundStyle(tint)
                    Text(advice.headline)
                        .font(.label(13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 6) {
                        Badge(text: String(format: "bar %.0f%%", advice.requiredProbability), tint: Theme.accent)
                        Badge(
                            text: String(format: "side %.0f%%", advice.sideProbability),
                            tint: advice.sideProbability >= advice.requiredProbability ? Theme.up : Theme.neutral
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(advice.reasons.prefix(4).enumerated()), id: \.offset) { _, reason in
                    HStack(alignment: .top, spacing: 7) {
                        Image(systemName: advice.isEntry ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(tint.opacity(0.85))
                            .padding(.top, 2)
                        Text(reason)
                            .font(.label(12))
                            .foregroundStyle(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 20)
                .fill(Theme.surface)
                .overlay {
                    RoundedRectangle(cornerRadius: 20)
                        .fill(
                            LinearGradient(
                                colors: [tint.opacity(0.14), .clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(tint.opacity(advice.isEntry ? 0.5 : 0.22), lineWidth: 1)
        }
        .animation(.smooth(duration: 0.4), value: advice.verdict)
    }

    // MARK: - Chart

    private func chartPanel(analysis: Analysis) -> some View {
        Panel(title: "Tape", systemImage: "waveform.path.ecg", accessory: "1m · last 120 bars") {
            PriceChartView(
                candles: model.chartCandles,
                lockPrice: model.chainRound.flatMap { $0.lockPrice > 0 ? $0.lockPrice : nil },
                noiseFloor: analysis.fifth.noiseFloor,
                decimals: model.config.decimals
            )
            .frame(height: 168)

            HStack(spacing: 8) {
                StatTile(
                    label: "RSI",
                    value: String(format: "%.0f", analysis.momentum.rsi),
                    detail: "stoch \(Int(analysis.momentum.stochRsi))",
                    tint: analysis.momentum.rsi >= 60 ? Theme.up : (analysis.momentum.rsi <= 40 ? Theme.down : Theme.textPrimary)
                )
                StatTile(
                    label: "EMAs",
                    value: "\(analysis.trend.aboveCount)/4",
                    detail: analysis.trend.cross?.rawValue ?? "no cross",
                    tint: analysis.trend.aboveCount >= 3 ? Theme.up : (analysis.trend.aboveCount <= 1 ? Theme.down : Theme.textPrimary)
                )
                StatTile(
                    label: "Volume",
                    value: String(format: "%.1fx", analysis.volume.relative),
                    detail: analysis.volume.spike ? "spike" : "normal",
                    tint: analysis.volume.spike ? Theme.accent : Theme.textPrimary
                )
            }
        }
    }

    // MARK: - Regime

    private func regimePanel(_ regime: RegimeState) -> some View {
        let tint: Color = switch regime.kind {
        case .trendUp: Theme.up
        case .trendDown: Theme.down
        case .storm: Theme.accent
        case .chop: Theme.neutral
        }
        return Panel(title: "Regime", systemImage: "antenna.radiowaves.left.and.right", accessory: regime.htf.label) {
            HStack(spacing: 8) {
                Badge(text: regime.label, tint: tint)
                if let alignment = regime.alignment {
                    Badge(
                        text: "15m \(alignment.rawValue)",
                        tint: alignment == .aligned ? Theme.up : (alignment == .conflict ? Theme.down : Theme.neutral)
                    )
                }
            }

            predictabilityBar(regime.predictability, tint: tint)

            HStack(spacing: 8) {
                StatTile(label: "Efficiency", value: "\(Int(regime.efficiency * 100))%", detail: "path travel")
                StatTile(label: "SNR", value: String(format: "%.2f", regime.snr), detail: "drift vs noise")
                StatTile(
                    label: "Memory",
                    value: String(format: "%.2f", regime.autocorr),
                    detail: regime.meanReverting ? "snaps back" : "carries",
                    tint: regime.meanReverting ? Theme.down : Theme.textPrimary
                )
            }

            Text(regime.detail)
                .font(.label(12))
                .foregroundStyle(Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func predictabilityBar(_ value: Int, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("Predictability")
                    .font(.label(11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                Text("\(value)/100")
                    .font(.tape(11, weight: .bold))
                    .foregroundStyle(tint)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surfaceHigh)
                    Capsule()
                        .fill(LinearGradient(colors: [tint.opacity(0.6), tint], startPoint: .leading, endPoint: .trailing))
                        .frame(width: Swift.max(3, geo.size.width * CGFloat(value) / 100))
                }
            }
            .frame(height: 7)
            .animation(.smooth(duration: 0.5), value: value)
        }
    }

    // MARK: - Fifth dimension

    private func fifthPanel(_ fifth: FifthDimension) -> some View {
        Panel(title: "Gap Physics", systemImage: "scope", accessory: fifth.evEstimated ? "est. payout" : "live pools") {
            HStack(spacing: 8) {
                StatTile(
                    label: "Gap",
                    value: String(format: "%@%.2f", fifth.gap >= 0 ? "+" : "−", abs(fifth.gap)),
                    detail: String(format: "%.1fσ", abs(fifth.zScore)),
                    tint: fifth.gap >= 0 ? Theme.up : Theme.down
                )
                StatTile(
                    label: "Noise Floor",
                    value: String(format: "±%.2f", fifth.noiseFloor),
                    detail: fifth.coinFlip ? "gap inside" : "gap clear",
                    tint: fifth.coinFlip ? Theme.down : Theme.up
                )
                StatTile(
                    label: "Best EV",
                    value: String(format: "%.1f%%", Swift.max(fifth.evUp, fifth.evDown) * 100),
                    detail: fifth.evUp >= fifth.evDown ? "on UP" : "on DOWN",
                    tint: Swift.max(fifth.evUp, fifth.evDown) >= 0.03 ? Theme.up : Theme.down
                )
            }

            ForEach(fifth.signals) { SignalRow(signal: $0) }

            Text(fifth.verdict)
                .font(.label(12, weight: .medium))
                .foregroundStyle(fifth.coinFlip ? Theme.down : Theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func narrativePanel(_ narrative: String) -> some View {
        Panel(title: "Read", systemImage: "text.alignleft") {
            Text(narrative)
                .font(.label(13))
                .foregroundStyle(Theme.textSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

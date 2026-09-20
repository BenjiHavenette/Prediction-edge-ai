import SwiftUI

/// Settled rounds with the call the engine made BEFORE each one locked,
/// so the hit rate on screen is the hit rate it actually earned.
struct HistoryTabView: View {
    let model: MarketViewModel

    private var graded: [RoundRecord] { model.records.filter(\.isGraded) }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                summaryPanel
                roundsPanel
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
    }

    private var summaryPanel: some View {
        let hits = graded.filter(\.isHit).count
        let accuracy = graded.isEmpty ? 0 : Double(hits) / Double(graded.count) * 100
        let waits = model.records.filter { $0.call == .wait }.count
        return Panel(
            title: "Scorecard",
            systemImage: "checkmark.seal",
            accessory: "\(model.records.count) rounds tracked"
        ) {
            HStack(spacing: 8) {
                StatTile(
                    label: "Hit Rate",
                    value: graded.isEmpty ? "—" : String(format: "%.0f%%", accuracy),
                    detail: "\(hits)W · \(graded.count - hits)L",
                    tint: accuracy >= 60 ? Theme.up : (graded.isEmpty ? Theme.textPrimary : Theme.down)
                )
                StatTile(
                    label: "Stood Down",
                    value: "\(waits)",
                    detail: "gate refused",
                    tint: Theme.neutral
                )
                StatTile(
                    label: "Selectivity",
                    value: model.records.isEmpty ? "—" : String(format: "%.0f%%", Double(graded.count) / Double(model.records.count) * 100),
                    detail: "rounds actually called",
                    tint: Theme.accent
                )
            }
            Text("Only trend-confirmed calls are graded. Every chop, storm and 15-minute conflict is deliberately skipped — that's how the hit rate stays high.")
                .font(.label(11))
                .foregroundStyle(Theme.textFaint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var roundsPanel: some View {
        Panel(title: "Settled Rounds", systemImage: "clock.arrow.circlepath") {
            if model.records.isEmpty {
                Text("No settled rounds yet. The engine reconstructs history from the tape the moment enough candles load.")
                    .font(.label(12))
                    .foregroundStyle(Theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(Array(model.recentRecords.prefix(60))) { record in
                        RoundRow(record: record, decimals: model.config.decimals)
                        if record.id != model.recentRecords.prefix(60).last?.id {
                            Divider().overlay(Theme.hairline)
                        }
                    }
                }
            }
        }
    }
}

private struct RoundRow: View {
    let record: RoundRecord
    let decimals: Int

    private var callTint: Color {
        record.call == .wait ? Theme.textFaint : Theme.tint(for: record.call)
    }

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("#\(record.id)")
                    .font(.tape(11, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                Text(record.startTime, format: .dateTime.hour().minute())
                    .font(.tape(9))
                    .foregroundStyle(Theme.textFaint)
            }
            .frame(width: 60, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(record.call == .wait ? "STOOD DOWN" : "CALLED \(record.call.rawValue)")
                    .font(.label(11, weight: .bold))
                    .foregroundStyle(callTint)
                Text(record.regimeLabel ?? "regime unknown")
                    .font(.label(9))
                    .foregroundStyle(Theme.textFaint)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .trailing, spacing: 2) {
                Text(record.result.rawValue)
                    .font(.tape(11, weight: .bold))
                    .foregroundStyle(record.result == .up ? Theme.up : (record.result == .down ? Theme.down : Theme.neutral))
                Text(record.movePct.signedPercent)
                    .font(.tape(9))
                    .foregroundStyle(Theme.textFaint)
            }

            Image(systemName: record.call == .wait ? "minus" : (record.isHit ? "checkmark" : "xmark"))
                .font(.system(size: 10, weight: .black))
                .foregroundStyle(record.call == .wait ? Theme.textFaint : (record.isHit ? Theme.up : Theme.down))
                .frame(width: 18, height: 18)
                .background(
                    (record.call == .wait ? Theme.textFaint : (record.isHit ? Theme.up : Theme.down)).opacity(0.14),
                    in: .circle
                )
        }
        .padding(.vertical, 9)
    }
}

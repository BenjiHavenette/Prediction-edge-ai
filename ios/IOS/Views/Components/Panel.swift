import SwiftUI

/// A titled card. Every section of the app sits in one of these so the layout
/// reads like a trading terminal rather than a stack of loose controls.
struct Panel<Content: View>: View {
    let title: String
    var systemImage: String
    var accessory: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.accent)
                Text(title.uppercased())
                    .font(.label(11, weight: .bold))
                    .kerning(1.1)
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 8)
                if let accessory {
                    Text(accessory)
                        .font(.tape(10, weight: .medium))
                        .foregroundStyle(Theme.textFaint)
                }
            }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: .rect(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(Theme.hairline, lineWidth: 1)
        }
    }
}

/// A compact labelled statistic used inside panels.
struct StatTile: View {
    let label: String
    let value: String
    var detail: String?
    var tint: Color = Theme.textPrimary

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.label(9, weight: .bold))
                .kerning(0.8)
                .foregroundStyle(Theme.textFaint)
            Text(value)
                .font(.tape(17, weight: .bold))
                .foregroundStyle(tint)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let detail {
                Text(detail)
                    .font(.tape(9, weight: .regular))
                    .foregroundStyle(Theme.textFaint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 9)
        .padding(.horizontal, 11)
        .background(Theme.surfaceHigh, in: .rect(cornerRadius: 12))
    }
}

/// A single signal row: coloured dot, label, optional trailing detail.
struct SignalRow: View {
    let signal: Signal

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle()
                .fill(Theme.tint(for: signal.direction))
                .frame(width: 6, height: 6)
                .offset(y: -1)
            Text(signal.label)
                .font(.label(12, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 6)
            if let detail = signal.detail {
                Text(detail)
                    .font(.tape(11))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// A horizontal meter for a −100...100 category score.
struct ScoreBar: View {
    let label: String
    /// −100...100
    let score: Double
    var weight: Double?

    private var fraction: Double { abs(score) / 100 }
    private var tint: Color { score > 5 ? Theme.up : (score < -5 ? Theme.down : Theme.neutral) }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(label)
                    .font(.label(11, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer()
                if let weight {
                    Text("\(Int((weight * 100).rounded()))% wt")
                        .font(.tape(9))
                        .foregroundStyle(Theme.textFaint)
                }
                Text("\(Int(score))")
                    .font(.tape(11, weight: .bold))
                    .foregroundStyle(tint)
                    .frame(width: 34, alignment: .trailing)
            }
            GeometryReader { geo in
                let half = geo.size.width / 2
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.surfaceHigh)
                    Rectangle()
                        .fill(Theme.hairline)
                        .frame(width: 1)
                        .offset(x: half)
                    Capsule()
                        .fill(tint)
                        .frame(width: Swift.max(2, half * fraction))
                        .offset(x: score >= 0 ? half : half - half * fraction)
                }
            }
            .frame(height: 6)
        }
    }
}

/// A pill badge.
struct Badge: View {
    let text: String
    var tint: Color = Theme.accent

    var body: some View {
        Text(text.uppercased())
            .font(.label(9, weight: .bold))
            .kerning(0.7)
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tint.opacity(0.14), in: .capsule)
            .overlay {
                Capsule().strokeBorder(tint.opacity(0.35), lineWidth: 1)
            }
    }
}

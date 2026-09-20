import SwiftUI

/// Terminal-desk aesthetic: near-black slate canvas, phosphor-amber accent,
/// and signal green / signal red reserved strictly for directional meaning.
nonisolated enum Theme {
    static let canvas = Color(red: 0.043, green: 0.047, blue: 0.059)
    static let surface = Color(red: 0.075, green: 0.082, blue: 0.098)
    static let surfaceHigh = Color(red: 0.106, green: 0.114, blue: 0.137)
    static let hairline = Color(red: 0.180, green: 0.196, blue: 0.231)

    static let accent = Color(red: 0.984, green: 0.749, blue: 0.290)
    static let accentDim = Color(red: 0.984, green: 0.749, blue: 0.290).opacity(0.16)

    static let up = Color(red: 0.180, green: 0.859, blue: 0.549)
    static let down = Color(red: 0.984, green: 0.353, blue: 0.404)
    static let neutral = Color(red: 0.549, green: 0.588, blue: 0.655)

    static let textPrimary = Color(red: 0.933, green: 0.945, blue: 0.965)
    static let textSecondary = Color(red: 0.580, green: 0.616, blue: 0.682)
    static let textFaint = Color(red: 0.376, green: 0.408, blue: 0.475)

    static func tint(for direction: Direction) -> Color {
        switch direction {
        case .bull: up
        case .bear: down
        case .neutral: neutral
        }
    }

    static func tint(for recommendation: Recommendation) -> Color {
        switch recommendation {
        case .up: up
        case .down: down
        case .wait: neutral
        }
    }

    /// Atmospheric background: a deep slate field lit from the top-left.
    struct Backdrop: View {
        var body: some View {
            ZStack {
                Theme.canvas
                RadialGradient(
                    colors: [Theme.accent.opacity(0.10), .clear],
                    center: .init(x: 0.12, y: 0.02),
                    startRadius: 4,
                    endRadius: 420
                )
                RadialGradient(
                    colors: [Color(red: 0.16, green: 0.32, blue: 0.52).opacity(0.22), .clear],
                    center: .init(x: 0.95, y: 0.88),
                    startRadius: 8,
                    endRadius: 500
                )
            }
            .ignoresSafeArea()
        }
    }
}

extension Font {
    /// Tabular monospaced digits — every number on screen stays column-aligned.
    static func tape(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static func label(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

extension Double {
    /// Formats a price with the market's natural precision.
    func priceText(decimals: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        formatter.groupingSeparator = ","
        return formatter.string(from: NSNumber(value: self)) ?? String(format: "%.\(decimals)f", self)
    }

    var signedPercent: String {
        String(format: "%@%.3f%%", self >= 0 ? "+" : "", self)
    }
}

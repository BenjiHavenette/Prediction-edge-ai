import SwiftUI

/// Maps prices to vertical positions inside a chart of a given height.
private struct PriceScale {
    let low: Double
    let span: Double
    let height: CGFloat

    func y(_ price: Double) -> CGFloat {
        height * CGFloat(1 - (price - low) / span)
    }
}

/// Candlestick tape with the lock-price line and a shaded noise band, so the
/// round's real question — "is the gap bigger than the noise?" — is visible.
struct PriceChartView: View {
    let candles: [Candle]
    let lockPrice: Double?
    let noiseFloor: Double
    let decimals: Int

    private var bounds: (low: Double, high: Double) {
        var low = candles.map(\.low).min() ?? 0
        var high = candles.map(\.high).max() ?? 1
        if let lockPrice, lockPrice > 0 {
            low = Swift.min(low, lockPrice - noiseFloor)
            high = Swift.max(high, lockPrice + noiseFloor)
        }
        let pad = Swift.max((high - low) * 0.08, high * 0.0002)
        return (low - pad, high + pad)
    }

    var body: some View {
        GeometryReader { geo in
            let (low, high) = bounds
            let span = Swift.max(high - low, 0.000_001)
            let scale = PriceScale(low: low, span: span, height: geo.size.height)
            let count = Swift.max(candles.count, 1)
            let slot = geo.size.width / CGFloat(count)
            let bodyWidth = Swift.max(1.2, slot * 0.62)

            ZStack(alignment: .topLeading) {
                // Noise band around the lock price.
                if let lockPrice, lockPrice > 0, noiseFloor > 0 {
                    let top = scale.y(lockPrice + noiseFloor)
                    let bottom = scale.y(lockPrice - noiseFloor)
                    Rectangle()
                        .fill(Theme.accent.opacity(0.10))
                        .frame(height: Swift.max(1, bottom - top))
                        .offset(y: top)
                }

                // Candles.
                Canvas { context, _ in
                    for (index, candle) in candles.enumerated() {
                        let x = CGFloat(index) * slot + slot / 2
                        let color = candle.isGreen ? Theme.up : (candle.isRed ? Theme.down : Theme.neutral)

                        var wick = Path()
                        wick.move(to: CGPoint(x: x, y: scale.y(candle.high)))
                        wick.addLine(to: CGPoint(x: x, y: scale.y(candle.low)))
                        context.stroke(wick, with: .color(color.opacity(0.55)), lineWidth: 1)

                        let openY = scale.y(candle.open)
                        let closeY = scale.y(candle.close)
                        let rect = CGRect(
                            x: x - bodyWidth / 2,
                            y: Swift.min(openY, closeY),
                            width: bodyWidth,
                            height: Swift.max(1, abs(closeY - openY))
                        )
                        context.fill(Path(roundedRect: rect, cornerRadius: bodyWidth > 3 ? 1 : 0), with: .color(color))
                    }
                }

                // Lock line.
                if let lockPrice, lockPrice > 0 {
                    let lockY = scale.y(lockPrice)
                    Path { path in
                        path.move(to: CGPoint(x: 0, y: lockY))
                        path.addLine(to: CGPoint(x: geo.size.width, y: lockY))
                    }
                    .stroke(Theme.accent.opacity(0.85), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))

                    Text("LOCK \(lockPrice.priceText(decimals: decimals))")
                        .font(.tape(9, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Theme.canvas.opacity(0.9), in: .rect(cornerRadius: 4))
                        .offset(x: 4, y: Swift.max(0, lockY - 16))
                }
            }
        }
    }
}

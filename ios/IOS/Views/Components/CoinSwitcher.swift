import SwiftUI

/// Segmented market selector. Switching wipes every engine so the three
/// markets never share a brain.
struct CoinSwitcher: View {
    let selected: CoinID
    let onSelect: (CoinID) -> Void

    @Namespace private var highlight

    var body: some View {
        HStack(spacing: 3) {
            ForEach(CoinID.allCases) { coin in
                Button {
                    guard coin != selected else { return }
                    onSelect(coin)
                } label: {
                    Text(coin.rawValue)
                        .font(.label(12, weight: .bold))
                        .kerning(0.6)
                        .foregroundStyle(coin == selected ? Theme.canvas : Theme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background {
                            if coin == selected {
                                Capsule()
                                    .fill(Theme.accent)
                                    .matchedGeometryEffect(id: "coin", in: highlight)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(Theme.surfaceHigh, in: .capsule)
        .overlay { Capsule().strokeBorder(Theme.hairline, lineWidth: 1) }
        .animation(.snappy(duration: 0.28), value: selected)
    }
}

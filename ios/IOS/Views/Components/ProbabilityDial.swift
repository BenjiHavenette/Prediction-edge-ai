import SwiftUI

/// Split arc showing UP versus DOWN probability with the advised side's number
/// in the middle. Animates whenever the engine revises its forecast.
struct ProbabilityDial: View {
    let upProbability: Int
    let confidence: Int
    let verdict: EntryVerdict

    private var favoursUp: Bool { upProbability >= 50 }
    private var sideProbability: Int { favoursUp ? upProbability : 100 - upProbability }
    private var tint: Color {
        switch verdict {
        case .enterUp: Theme.up
        case .enterDown: Theme.down
        case .stand: Theme.neutral
        }
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Theme.surfaceHigh, lineWidth: 11)

            Circle()
                .trim(from: 0, to: CGFloat(upProbability) / 100)
                .stroke(Theme.up.opacity(favoursUp ? 0.95 : 0.35), style: StrokeStyle(lineWidth: 11, lineCap: .round))
                .rotationEffect(.degrees(-90))

            Circle()
                .trim(from: CGFloat(upProbability) / 100, to: 1)
                .stroke(Theme.down.opacity(favoursUp ? 0.35 : 0.95), style: StrokeStyle(lineWidth: 11, lineCap: .round))
                .rotationEffect(.degrees(-90))

            VStack(spacing: 1) {
                Text("\(sideProbability)%")
                    .font(.tape(30, weight: .heavy))
                    .foregroundStyle(tint)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text(favoursUp ? "UP" : "DOWN")
                    .font(.label(11, weight: .bold))
                    .kerning(1.4)
                    .foregroundStyle(Theme.textSecondary)
                Text("conf \(confidence)%")
                    .font(.tape(9))
                    .foregroundStyle(Theme.textFaint)
                    .padding(.top, 2)
            }
        }
        .animation(.smooth(duration: 0.45), value: upProbability)
        .animation(.smooth(duration: 0.45), value: confidence)
    }
}

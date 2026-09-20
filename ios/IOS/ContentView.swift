import SwiftUI

struct ContentView: View {
    @State private var model = MarketViewModel()
    @State private var tab: Tab = .live

    enum Tab: String, CaseIterable, Identifiable {
        case live = "Desk"
        case engine = "Engine"
        case history = "History"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .live: "bolt.fill"
            case .engine: "cpu"
            case .history: "clock.arrow.circlepath"
            }
        }
    }

    var body: some View {
        ZStack {
            Theme.Backdrop()

            VStack(spacing: 12) {
                header

                switch model.state {
                case .loading(let message):
                    loadingView(message)
                case .failed(let message):
                    failureView(message)
                case .ready:
                    content
                }
            }
            .padding(.top, 6)
        }
        .preferredColorScheme(.dark)
        .task { model.start() }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: 10) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("PREDICTION EDGE")
                        .font(.label(15, weight: .heavy))
                        .kerning(1.6)
                        .foregroundStyle(Theme.textPrimary)
                    Text(model.config.name)
                        .font(.label(10, weight: .semibold))
                        .kerning(0.6)
                        .foregroundStyle(Theme.textFaint)
                }
                Spacer()
                connectionPip
            }

            CoinSwitcher(selected: model.coin) { model.select(coin: $0) }
        }
        .padding(.horizontal, 16)
    }

    private var connectionPip: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(model.streamConnected ? Theme.up : Theme.down)
                .frame(width: 6, height: 6)
                .shadow(color: (model.streamConnected ? Theme.up : Theme.down).opacity(0.8), radius: 4)
            Text(model.streamConnected ? "LIVE" : "OFFLINE")
                .font(.label(9, weight: .bold))
                .kerning(0.8)
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(Theme.surface, in: .capsule)
        .overlay { Capsule().strokeBorder(Theme.hairline, lineWidth: 1) }
        .animation(.smooth(duration: 0.3), value: model.streamConnected)
    }

    // MARK: - Content

    private var content: some View {
        VStack(spacing: 0) {
            Group {
                switch tab {
                case .live: LiveTabView(model: model)
                case .engine: EngineTabView(model: model)
                case .history: HistoryTabView(model: model)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            tabBar
        }
    }

    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(Tab.allCases) { item in
                Button {
                    withAnimation(.snappy(duration: 0.25)) { tab = item }
                } label: {
                    VStack(spacing: 3) {
                        Image(systemName: item.icon)
                            .font(.system(size: 14, weight: .semibold))
                        Text(item.rawValue)
                            .font(.label(9, weight: .bold))
                            .kerning(0.5)
                    }
                    .foregroundStyle(tab == item ? Theme.accent : Theme.textFaint)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.top, 4)
        .background(alignment: .top) {
            Rectangle()
                .fill(Theme.hairline)
                .frame(height: 1)
        }
        .background(Theme.surface.opacity(0.92))
    }

    // MARK: - States

    private func loadingView(_ message: String) -> some View {
        VStack(spacing: 14) {
            Spacer()
            ProgressView()
                .controlSize(.large)
                .tint(Theme.accent)
            Text(message)
                .font(.label(13, weight: .medium))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func failureView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 34, weight: .light))
                .foregroundStyle(Theme.down)
            Text("Can't reach the market")
                .font(.label(17, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            Text(message)
                .font(.label(12))
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Button {
                model.retry()
            } label: {
                Text("Try Again")
                    .font(.label(13, weight: .bold))
                    .foregroundStyle(Theme.canvas)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 11)
                    .background(Theme.accent, in: .capsule)
            }
            .buttonStyle(.plain)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    ContentView()
}

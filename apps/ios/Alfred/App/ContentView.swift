import SwiftUI

/// Root content view with tab navigation and onboarding gate.
struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab: Tab = .chat

    enum Tab: String, CaseIterable {
        case chat = "Chat"
        case canvas = "Canvas"
        case voice = "Voice"
        case settings = "Settings"

        var icon: String {
            switch self {
            case .chat: return "bubble.left.and.bubble.right.fill"
            case .canvas: return "rectangle.3.group.fill"
            case .voice: return "waveform"
            case .settings: return "gearshape.fill"
            }
        }
    }

    var body: some View {
        Group {
            if !appState.isOnboarded {
                OnboardingView()
            } else {
                mainTabView
            }
        }
        .background(BatcaveTheme.primaryBg.ignoresSafeArea())
    }

    // MARK: - Main Tab View

    private var mainTabView: some View {
        TabView(selection: $selectedTab) {
            ChatView()
                .tabItem {
                    Label(Tab.chat.rawValue, systemImage: Tab.chat.icon)
                }
                .tag(Tab.chat)

            CanvasView()
                .tabItem {
                    Label(Tab.canvas.rawValue, systemImage: Tab.canvas.icon)
                }
                .tag(Tab.canvas)

            TalkMode()
                .tabItem {
                    Label(Tab.voice.rawValue, systemImage: Tab.voice.icon)
                }
                .tag(Tab.voice)

            SettingsView()
                .tabItem {
                    Label(Tab.settings.rawValue, systemImage: Tab.settings.icon)
                }
                .tag(Tab.settings)
        }
        .accentColor(BatcaveTheme.accent)
        .onAppear {
            configureTabBarAppearance()
        }
    }

    // MARK: - Tab Bar Appearance

    private func configureTabBarAppearance() {
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(BatcaveTheme.secondaryBg)

        appearance.stackedLayoutAppearance.normal.iconColor = UIColor(BatcaveTheme.textMuted)
        appearance.stackedLayoutAppearance.normal.titleTextAttributes = [
            .foregroundColor: UIColor(BatcaveTheme.textMuted)
        ]
        appearance.stackedLayoutAppearance.selected.iconColor = UIColor(BatcaveTheme.accent)
        appearance.stackedLayoutAppearance.selected.titleTextAttributes = [
            .foregroundColor: UIColor(BatcaveTheme.accent)
        ]

        UITabBar.appearance().standardAppearance = appearance
        UITabBar.appearance().scrollEdgeAppearance = appearance
    }
}

// MARK: - Onboarding View

struct OnboardingView: View {
    @EnvironmentObject var appState: AppState
    @State private var currentPage = 0
    @State private var setupCode = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header
            Spacer()

            // Alfred Logo / Title
            VStack(spacing: 16) {
                Image(systemName: "shield.checkered")
                    .font(.system(size: 80))
                    .foregroundColor(BatcaveTheme.accent)

                Text("Alfred")
                    .font(AlfredFont.inter(40, weight: .bold))
                    .foregroundColor(BatcaveTheme.textPrimary)

                Text("Your Private AI Butler")
                    .font(AlfredFont.inter(18))
                    .foregroundColor(BatcaveTheme.textSecondary)
            }

            Spacer()

            // Onboarding Pages
            TabView(selection: $currentPage) {
                onboardingPage(
                    icon: "lock.shield.fill",
                    title: "Privacy First",
                    description: "Your data stays on your hardware. Alfred runs on your own infrastructure with zero cloud dependency."
                )
                .tag(0)

                onboardingPage(
                    icon: "bolt.fill",
                    title: "Local AI Power",
                    description: "Connect to your self-hosted Gateway for fast, private AI assistance."
                )
                .tag(1)

                pairingPage
                    .tag(2)
            }
            .tabViewStyle(PageTabViewStyle(indexDisplayMode: .always))
            .frame(height: 300)

            Spacer()

            // Continue / Skip button
            if currentPage < 2 {
                Button(action: {
                    withAnimation {
                        currentPage += 1
                    }
                }) {
                    Text("Continue")
                        .font(AlfredFont.interMedium(16))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(BatcaveTheme.accent)
                        .cornerRadius(12)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 16)

                Button("Skip Setup") {
                    appState.completeOnboarding()
                }
                .font(AlfredFont.inter(14))
                .foregroundColor(BatcaveTheme.textMuted)
                .padding(.bottom, 32)
            }
        }
        .background(BatcaveTheme.primaryBg.ignoresSafeArea())
    }

    // MARK: - Onboarding Page

    private func onboardingPage(icon: String, title: String, description: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: icon)
                .font(.system(size: 50))
                .foregroundColor(BatcaveTheme.accent)

            Text(title)
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textPrimary)

            Text(description)
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }

    // MARK: - Pairing Page

    private var pairingPage: some View {
        VStack(spacing: 20) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 50))
                .foregroundColor(BatcaveTheme.accent)

            Text("Connect to Gateway")
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textPrimary)

            Text("Enter your setup code or scan the QR code from your Gateway.")
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            // Setup code input
            TextField("Setup Code", text: $setupCode)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .font(AlfredFont.mono(18))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 60)
                .autocapitalization(.allCharacters)
                .disableAutocorrection(true)

            HStack(spacing: 16) {
                Button(action: {
                    appState.pair(code: setupCode)
                    appState.completeOnboarding()
                }) {
                    Text("Connect")
                        .font(AlfredFont.interMedium(16))
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(setupCode.isEmpty ? BatcaveTheme.textMuted : BatcaveTheme.accent)
                        .cornerRadius(12)
                }
                .disabled(setupCode.isEmpty)

                Button(action: {
                    appState.completeOnboarding()
                }) {
                    Text("Skip")
                        .font(AlfredFont.interMedium(16))
                        .foregroundColor(BatcaveTheme.textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(BatcaveTheme.tertiaryBg)
                        .cornerRadius(12)
                }
            }
            .padding(.horizontal, 32)
        }
    }
}

// MARK: - Previews

#if DEBUG
struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            .environmentObject(AppState())
    }
}
#endif

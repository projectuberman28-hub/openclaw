import SwiftUI

/// Settings screen with sections for connection, privacy, voice, appearance, and about.
struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var connectionManager = ConnectionManager.shared
    @StateObject private var pairingManager = PairingManager.shared
    @StateObject private var authManager = AuthManager.shared

    @State private var showGatewaySetup = false
    @State private var showPrivacyDashboard = false
    @State private var showResetConfirmation = false

    // Voice settings
    @AppStorage("wakeWordEnabled") private var wakeWordEnabled = false
    @AppStorage("sendOnReturn") private var sendOnReturn = true
    @AppStorage("ttsEnabled") private var ttsEnabled = true

    var body: some View {
        NavigationView {
            List {
                connectionSection
                privacySection
                voiceSection
                appearanceSection
                aboutSection
                dangerZone
            }
            .listStyle(InsetGroupedListStyle())
            .scrollContentBackground(.hidden)
            .background(BatcaveTheme.primaryBg)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showGatewaySetup) {
                GatewaySetup()
            }
            .sheet(isPresented: $showPrivacyDashboard) {
                PrivacyDashboard()
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    // MARK: - Connection Section

    private var connectionSection: some View {
        Section {
            // Connection status
            HStack {
                Circle()
                    .fill(connectionManager.connectionMode.isConnected ? BatcaveTheme.success : BatcaveTheme.error)
                    .frame(width: 10, height: 10)

                Text("Status")
                    .foregroundColor(BatcaveTheme.textPrimary)

                Spacer()

                Text(connectionManager.connectionMode.displayName)
                    .foregroundColor(BatcaveTheme.textSecondary)
                    .font(AlfredFont.caption)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)

            // Gateway URL
            if let info = pairingManager.pairingInfo {
                HStack {
                    Text("Gateway")
                        .foregroundColor(BatcaveTheme.textPrimary)
                    Spacer()
                    Text("\(info.host):\(info.port)")
                        .foregroundColor(BatcaveTheme.textSecondary)
                        .font(AlfredFont.mono(14))
                }
                .listRowBackground(BatcaveTheme.secondaryBg)
            }

            // Setup / Reconfigure button
            Button(action: { showGatewaySetup = true }) {
                HStack {
                    Image(systemName: pairingManager.isPaired ? "arrow.triangle.2.circlepath" : "link.badge.plus")
                    Text(pairingManager.isPaired ? "Reconfigure Gateway" : "Connect to Gateway")
                }
                .foregroundColor(BatcaveTheme.accent)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)

            // Connect / Disconnect
            if pairingManager.isPaired {
                Button(action: {
                    if connectionManager.connectionMode.isConnected {
                        connectionManager.disconnect()
                    } else {
                        connectionManager.autoConnect()
                    }
                }) {
                    HStack {
                        Image(systemName: connectionManager.connectionMode.isConnected ? "wifi.slash" : "wifi")
                        Text(connectionManager.connectionMode.isConnected ? "Disconnect" : "Connect")
                    }
                    .foregroundColor(connectionManager.connectionMode.isConnected ? BatcaveTheme.warning : BatcaveTheme.success)
                }
                .listRowBackground(BatcaveTheme.secondaryBg)
            }
        } header: {
            Text("CONNECTION")
                .foregroundColor(BatcaveTheme.textMuted)
        }
    }

    // MARK: - Privacy Section

    private var privacySection: some View {
        Section {
            Button(action: { showPrivacyDashboard = true }) {
                HStack {
                    Image(systemName: "shield.checkered")
                        .foregroundColor(BatcaveTheme.success)
                    Text("Privacy Dashboard")
                        .foregroundColor(BatcaveTheme.textPrimary)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundColor(BatcaveTheme.textMuted)
                        .font(.system(size: 14))
                }
            }
            .listRowBackground(BatcaveTheme.secondaryBg)

            // Biometric lock
            HStack {
                Image(systemName: authManager.biometricType.systemImage)
                    .foregroundColor(BatcaveTheme.accent)
                Text("Require \(authManager.biometricType.displayName)")
                    .foregroundColor(BatcaveTheme.textPrimary)
                Spacer()
                // TODO: Add toggle for biometric lock
            }
            .listRowBackground(BatcaveTheme.secondaryBg)
        } header: {
            Text("PRIVACY")
                .foregroundColor(BatcaveTheme.textMuted)
        }
    }

    // MARK: - Voice Section

    private var voiceSection: some View {
        Section {
            Toggle(isOn: $wakeWordEnabled) {
                HStack {
                    Image(systemName: "ear.fill")
                        .foregroundColor(BatcaveTheme.accent)
                    Text("\"Hey Alfred\" Wake Word")
                        .foregroundColor(BatcaveTheme.textPrimary)
                }
            }
            .toggleStyle(SwitchToggleStyle(tint: BatcaveTheme.accent))
            .listRowBackground(BatcaveTheme.secondaryBg)

            Toggle(isOn: $ttsEnabled) {
                HStack {
                    Image(systemName: "speaker.wave.2.fill")
                        .foregroundColor(BatcaveTheme.accent)
                    Text("Text-to-Speech Responses")
                        .foregroundColor(BatcaveTheme.textPrimary)
                }
            }
            .toggleStyle(SwitchToggleStyle(tint: BatcaveTheme.accent))
            .listRowBackground(BatcaveTheme.secondaryBg)

            Toggle(isOn: $sendOnReturn) {
                HStack {
                    Image(systemName: "return")
                        .foregroundColor(BatcaveTheme.accent)
                    Text("Send on Return Key")
                        .foregroundColor(BatcaveTheme.textPrimary)
                }
            }
            .toggleStyle(SwitchToggleStyle(tint: BatcaveTheme.accent))
            .listRowBackground(BatcaveTheme.secondaryBg)
        } header: {
            Text("VOICE & INPUT")
                .foregroundColor(BatcaveTheme.textMuted)
        }
    }

    // MARK: - Appearance Section

    private var appearanceSection: some View {
        Section {
            HStack {
                Image(systemName: "paintbrush.fill")
                    .foregroundColor(BatcaveTheme.accent)
                Text("Theme")
                    .foregroundColor(BatcaveTheme.textPrimary)
                Spacer()
                Text("Batcave Dark")
                    .foregroundColor(BatcaveTheme.textSecondary)
                    .font(AlfredFont.caption)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)

            // Theme preview swatches
            HStack(spacing: 8) {
                colorSwatch("Primary", color: BatcaveTheme.primaryBg)
                colorSwatch("Secondary", color: BatcaveTheme.secondaryBg)
                colorSwatch("Accent", color: BatcaveTheme.accent)
                colorSwatch("Text", color: BatcaveTheme.textPrimary)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)
        } header: {
            Text("APPEARANCE")
                .foregroundColor(BatcaveTheme.textMuted)
        }
    }

    private func colorSwatch(_ name: String, color: Color) -> some View {
        VStack(spacing: 4) {
            RoundedRectangle(cornerRadius: 6)
                .fill(color)
                .frame(width: 40, height: 30)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(BatcaveTheme.border, lineWidth: 1)
                )
            Text(name)
                .font(.system(size: 9))
                .foregroundColor(BatcaveTheme.textMuted)
        }
    }

    // MARK: - About Section

    private var aboutSection: some View {
        Section {
            HStack {
                Text("Version")
                    .foregroundColor(BatcaveTheme.textPrimary)
                Spacer()
                Text("\(NodeIdentity.shared.appVersion) (\(NodeIdentity.shared.buildNumber))")
                    .foregroundColor(BatcaveTheme.textSecondary)
                    .font(AlfredFont.caption)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)

            HStack {
                Text("Device ID")
                    .foregroundColor(BatcaveTheme.textPrimary)
                Spacer()
                Text(String(NodeIdentity.shared.deviceId.prefix(8)) + "...")
                    .foregroundColor(BatcaveTheme.textSecondary)
                    .font(AlfredFont.mono(12))
            }
            .listRowBackground(BatcaveTheme.secondaryBg)

            HStack {
                Text("Device")
                    .foregroundColor(BatcaveTheme.textPrimary)
                Spacer()
                Text(NodeIdentity.shared.deviceModel)
                    .foregroundColor(BatcaveTheme.textSecondary)
                    .font(AlfredFont.caption)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)
        } header: {
            Text("ABOUT")
                .foregroundColor(BatcaveTheme.textMuted)
        }
    }

    // MARK: - Danger Zone

    private var dangerZone: some View {
        Section {
            Button(action: { showResetConfirmation = true }) {
                HStack {
                    Image(systemName: "exclamationmark.triangle.fill")
                    Text("Reset All Data")
                }
                .foregroundColor(BatcaveTheme.error)
            }
            .listRowBackground(BatcaveTheme.secondaryBg)
            .confirmationDialog(
                "Reset all Alfred data?",
                isPresented: $showResetConfirmation,
                titleVisibility: .visible
            ) {
                Button("Reset Everything", role: .destructive) {
                    resetAllData()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will unpair from the Gateway, clear all tokens, and reset onboarding. This cannot be undone.")
            }
        } header: {
            Text("DANGER ZONE")
                .foregroundColor(BatcaveTheme.error)
        }
    }

    // MARK: - Actions

    private func resetAllData() {
        connectionManager.disconnect()
        pairingManager.unpair()
        authManager.clearTokens()
        KeychainHelper.shared.deleteAll()
        appState.resetOnboarding()
        appState.disconnect()
    }
}

// MARK: - Preview

#if DEBUG
struct SettingsView_Previews: PreviewProvider {
    static var previews: some View {
        SettingsView()
            .environmentObject(AppState())
    }
}
#endif

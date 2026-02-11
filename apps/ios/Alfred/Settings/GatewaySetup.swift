import SwiftUI

/// Gateway setup view for manual URL entry, QR scan, and connection testing.
struct GatewaySetup: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var pairingManager = PairingManager.shared

    @State private var setupCode = ""
    @State private var manualHost = ""
    @State private var manualPort = "3001"
    @State private var isTesting = false
    @State private var testResult: TestResult? = nil
    @State private var showQRScanner = false
    @State private var inputMode: InputMode = .setupCode

    enum InputMode: String, CaseIterable {
        case setupCode = "Setup Code"
        case manual = "Manual"
        case qrCode = "QR Code"
    }

    enum TestResult {
        case success
        case failure(String)

        var isSuccess: Bool {
            if case .success = self { return true }
            return false
        }
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: 24) {
                    // Header
                    headerView

                    // Input mode picker
                    Picker("Input Mode", selection: $inputMode) {
                        ForEach(InputMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(SegmentedPickerStyle())
                    .padding(.horizontal)

                    // Input content
                    switch inputMode {
                    case .setupCode:
                        setupCodeInput
                    case .manual:
                        manualInput
                    case .qrCode:
                        qrCodeInput
                    }

                    // Connection test result
                    if let result = testResult {
                        testResultView(result)
                    }

                    Spacer()
                }
                .padding()
            }
            .background(BatcaveTheme.primaryBg)
            .navigationTitle("Gateway Setup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(BatcaveTheme.textSecondary)
                }
            }
        }
    }

    // MARK: - Header

    private var headerView: some View {
        VStack(spacing: 12) {
            Image(systemName: "server.rack")
                .font(.system(size: 40))
                .foregroundColor(BatcaveTheme.accent)

            Text("Connect to Your Gateway")
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textPrimary)

            Text("Enter the setup code from your Gateway console, or configure the connection manually.")
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 16)
    }

    // MARK: - Setup Code Input

    private var setupCodeInput: some View {
        VStack(spacing: 16) {
            TextField("Enter setup code", text: $setupCode)
                .font(AlfredFont.mono(20))
                .multilineTextAlignment(.center)
                .padding()
                .background(BatcaveTheme.secondaryBg)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(BatcaveTheme.border, lineWidth: 1)
                )
                .autocapitalization(.allCharacters)
                .disableAutocorrection(true)

            Text("Find this code in your Gateway terminal or web UI")
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.textMuted)

            connectButton(action: connectWithSetupCode, enabled: !setupCode.isEmpty)
        }
        .padding(.horizontal)
    }

    // MARK: - Manual Input

    private var manualInput: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Host / IP Address")
                    .font(AlfredFont.caption)
                    .foregroundColor(BatcaveTheme.textSecondary)

                TextField("192.168.1.100 or hostname", text: $manualHost)
                    .font(AlfredFont.mono(16))
                    .padding()
                    .background(BatcaveTheme.secondaryBg)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(BatcaveTheme.border, lineWidth: 1)
                    )
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .keyboardType(.URL)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Port")
                    .font(AlfredFont.caption)
                    .foregroundColor(BatcaveTheme.textSecondary)

                TextField("3001", text: $manualPort)
                    .font(AlfredFont.mono(16))
                    .padding()
                    .background(BatcaveTheme.secondaryBg)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(BatcaveTheme.border, lineWidth: 1)
                    )
                    .keyboardType(.numberPad)
            }

            // Test connection button
            Button(action: testConnection) {
                HStack {
                    if isTesting {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "network")
                    }
                    Text(isTesting ? "Testing..." : "Test Connection")
                }
                .font(AlfredFont.interMedium(14))
                .foregroundColor(BatcaveTheme.textSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(BatcaveTheme.tertiaryBg)
                .cornerRadius(8)
            }
            .disabled(manualHost.isEmpty || isTesting)

            connectButton(action: connectManually, enabled: !manualHost.isEmpty)
        }
        .padding(.horizontal)
    }

    // MARK: - QR Code Input

    private var qrCodeInput: some View {
        VStack(spacing: 16) {
            // QR code scanner placeholder
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(BatcaveTheme.secondaryBg)
                    .frame(height: 250)

                VStack(spacing: 16) {
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 60))
                        .foregroundColor(BatcaveTheme.textMuted)

                    Text("Scan QR Code")
                        .font(AlfredFont.body)
                        .foregroundColor(BatcaveTheme.textSecondary)

                    Button(action: { showQRScanner = true }) {
                        Text("Open Camera")
                            .font(AlfredFont.interMedium(16))
                            .foregroundColor(.white)
                            .padding(.horizontal, 24)
                            .padding(.vertical, 12)
                            .background(BatcaveTheme.accent)
                            .cornerRadius(8)
                    }
                }
            }

            Text("Scan the QR code displayed on your Gateway setup screen")
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal)
        .sheet(isPresented: $showQRScanner) {
            // TODO: Present QR scanner camera view
            Text("QR Scanner")
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textPrimary)
        }
    }

    // MARK: - Connect Button

    private func connectButton(action: @escaping () -> Void, enabled: Bool) -> some View {
        Button(action: action) {
            Text("Connect")
                .font(AlfredFont.interMedium(16))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 16)
                .background(enabled ? BatcaveTheme.accent : BatcaveTheme.textMuted)
                .cornerRadius(12)
        }
        .disabled(!enabled)
    }

    // MARK: - Test Result View

    private func testResultView(_ result: TestResult) -> some View {
        HStack(spacing: 8) {
            Image(systemName: result.isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill")
            switch result {
            case .success:
                Text("Connection successful!")
            case .failure(let message):
                Text(message)
            }
        }
        .font(AlfredFont.caption)
        .foregroundColor(result.isSuccess ? BatcaveTheme.success : BatcaveTheme.error)
        .padding()
        .frame(maxWidth: .infinity)
        .background(
            (result.isSuccess ? BatcaveTheme.success : BatcaveTheme.error).opacity(0.1)
        )
        .cornerRadius(8)
        .padding(.horizontal)
    }

    // MARK: - Actions

    private func connectWithSetupCode() {
        Task {
            do {
                try await pairingManager.pair(code: setupCode)
                dismiss()
            } catch {
                testResult = .failure(error.localizedDescription)
            }
        }
    }

    private func connectManually() {
        let port = Int(manualPort) ?? 3001
        let code = "\(manualHost):\(port):manual-key"

        Task {
            do {
                try await pairingManager.pair(code: code)
                dismiss()
            } catch {
                testResult = .failure(error.localizedDescription)
            }
        }
    }

    private func testConnection() {
        isTesting = true
        testResult = nil

        let host = manualHost
        let port = Int(manualPort) ?? 3001

        Task {
            // TODO: Implement actual connection test to Gateway health endpoint
            // let url = URL(string: "http://\(host):\(port)/health")!
            // let (_, response) = try await URLSession.shared.data(from: url)
            // let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0

            // Simulate test for now
            try? await Task.sleep(nanoseconds: 1_500_000_000)

            await MainActor.run {
                isTesting = false
                if host.isEmpty {
                    testResult = .failure("Host cannot be empty")
                } else {
                    testResult = .success
                }
            }
        }
    }
}

// MARK: - Preview

#if DEBUG
struct GatewaySetup_Previews: PreviewProvider {
    static var previews: some View {
        GatewaySetup()
    }
}
#endif

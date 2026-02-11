import Foundation
import Combine

/// Central application state, injected as an EnvironmentObject throughout the app.
final class AppState: ObservableObject {
    // MARK: - Published Properties

    /// Whether the WebSocket connection to the Gateway is active
    @Published var isConnected: Bool = false

    /// Current chat session ID
    @Published var currentSession: String? = nil

    /// Gateway WebSocket URL (e.g., ws://192.168.1.100:3001)
    @Published var gatewayURL: String = ""

    /// Whether this device has been paired with a Gateway instance
    @Published var isPaired: Bool = false

    /// Whether the user has completed onboarding
    @Published var isOnboarded: Bool = false

    /// Connection status message for display
    @Published var connectionStatus: ConnectionStatus = .disconnected

    /// Current error message, if any
    @Published var errorMessage: String? = nil

    // MARK: - Dependencies

    private let keychain = KeychainHelper.shared
    private let logger = AlfredLogger.app
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Connection Status

    enum ConnectionStatus: Equatable {
        case disconnected
        case connecting
        case connected
        case reconnecting
        case error(String)

        var displayText: String {
            switch self {
            case .disconnected: return "Disconnected"
            case .connecting: return "Connecting..."
            case .connected: return "Connected"
            case .reconnecting: return "Reconnecting..."
            case .error(let msg): return "Error: \(msg)"
            }
        }

        var isActive: Bool {
            if case .connected = self { return true }
            return false
        }
    }

    // MARK: - Init

    init() {
        loadPersistedState()
    }

    // MARK: - State Persistence

    private func loadPersistedState() {
        // Check if pairing info exists in Keychain
        isPaired = keychain.exists(key: KeychainHelper.Keys.pairingInfo)

        // Load onboarding status from UserDefaults (non-sensitive)
        isOnboarded = UserDefaults.standard.bool(forKey: "alfred.onboarded")

        // Load gateway URL from pairing info if available
        if let pairingInfo = keychain.load(key: KeychainHelper.Keys.pairingInfo, as: PairingInfo.self) {
            gatewayURL = "ws://\(pairingInfo.host):\(pairingInfo.port)"
        }

        logger.info("State loaded: paired=\(isPaired), onboarded=\(isOnboarded)")
    }

    // MARK: - Connection

    /// Connect to the Gateway WebSocket
    func connect() {
        guard !gatewayURL.isEmpty else {
            logger.warning("Cannot connect: no gateway URL configured")
            connectionStatus = .error("No gateway URL configured")
            return
        }

        logger.info("Connecting to gateway: \(gatewayURL)")
        connectionStatus = .connecting

        // TODO: Use GatewayClient to establish WebSocket connection
        // let client = GatewayClient.shared
        // Task {
        //     do {
        //         try await client.connect(url: URL(string: gatewayURL)!, token: authToken)
        //         await MainActor.run {
        //             self.isConnected = true
        //             self.connectionStatus = .connected
        //         }
        //     } catch {
        //         await MainActor.run {
        //             self.connectionStatus = .error(error.localizedDescription)
        //         }
        //     }
        // }
    }

    /// Disconnect from the Gateway
    func disconnect() {
        logger.info("Disconnecting from gateway")

        // TODO: Use GatewayClient to close WebSocket connection
        // GatewayClient.shared.disconnect()

        isConnected = false
        connectionStatus = .disconnected
    }

    /// Pair with a Gateway using a setup code
    func pair(code: String) {
        logger.info("Pairing with code: \(code.prefix(3))***")

        // TODO: Parse pairing code, extract host/port/syncKey
        // TODO: Store PairingInfo in Keychain
        // TODO: Initiate connection

        isPaired = true
    }

    // MARK: - Onboarding

    /// Mark onboarding as complete
    func completeOnboarding() {
        isOnboarded = true
        UserDefaults.standard.set(true, forKey: "alfred.onboarded")
        logger.info("Onboarding completed")
    }

    /// Reset onboarding (for testing or re-setup)
    func resetOnboarding() {
        isOnboarded = false
        UserDefaults.standard.set(false, forKey: "alfred.onboarded")
        logger.info("Onboarding reset")
    }

    // MARK: - Session Management

    /// Start a new chat session
    func newSession() -> String {
        let sessionId = UUID().uuidString
        currentSession = sessionId
        logger.info("New session created: \(sessionId)")
        return sessionId
    }

    /// Clear current session
    func clearSession() {
        currentSession = nil
    }
}

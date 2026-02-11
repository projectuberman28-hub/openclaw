import Foundation
import Network
import Combine

/// Manages the connection lifecycle to the Alfred Gateway.
/// Handles auto-connect, network changes, and local/remote switching.
final class ConnectionManager: ObservableObject {
    static let shared = ConnectionManager()

    // MARK: - Published State

    @Published var connectionMode: ConnectionMode = .disconnected
    @Published var networkAvailable: Bool = true
    @Published var isLocalNetwork: Bool = false

    // MARK: - Properties

    private let gatewayClient = GatewayClient.shared
    private let pairingManager = PairingManager.shared
    private let authManager = AuthManager.shared
    private let logger = AlfredLogger.network

    private var pathMonitor: NWPathMonitor?
    private var monitorQueue = DispatchQueue(label: "com.alfred.network-monitor")
    private var cancellables = Set<AnyCancellable>()

    // mDNS for local discovery
    private var browser: NWBrowser?
    private var discoveredLocalGateway: NWEndpoint?

    // MARK: - Connection Mode

    enum ConnectionMode: Equatable {
        case disconnected
        case connectingLocal
        case connectingRemote
        case connectedLocal
        case connectedRemote
        case error(String)

        var displayName: String {
            switch self {
            case .disconnected: return "Disconnected"
            case .connectingLocal: return "Connecting (Local)..."
            case .connectingRemote: return "Connecting (Tailscale)..."
            case .connectedLocal: return "Connected (Local)"
            case .connectedRemote: return "Connected (Remote)"
            case .error(let msg): return "Error: \(msg)"
            }
        }

        var isConnected: Bool {
            switch self {
            case .connectedLocal, .connectedRemote: return true
            default: return false
            }
        }
    }

    // MARK: - Init

    private init() {
        startNetworkMonitoring()
    }

    deinit {
        stopNetworkMonitoring()
        stopLocalDiscovery()
    }

    // MARK: - Auto-Connect

    /// Attempt to connect to the Gateway on app launch
    func autoConnect() {
        guard pairingManager.isPaired, let info = pairingManager.pairingInfo else {
            logger.info("Skipping auto-connect: not paired")
            return
        }

        logger.info("Auto-connecting to Gateway...")

        Task {
            await connectWithFallback(info: info)
        }
    }

    /// Try local connection first, then fall back to Tailscale
    private func connectWithFallback(info: PairingInfo) async {
        // Try local (mDNS/direct) connection first
        if let localURL = info.websocketURL {
            await MainActor.run { connectionMode = .connectingLocal }

            do {
                let token = authManager.getToken() ?? ""
                try await gatewayClient.connect(url: localURL, token: token)
                await MainActor.run {
                    connectionMode = .connectedLocal
                    isLocalNetwork = true
                }
                logger.info("Connected via local network")
                return
            } catch {
                logger.warning("Local connection failed: \(error.localizedDescription)")
            }
        }

        // Fall back to Tailscale (remote)
        if let remoteURL = info.tailscaleWebSocketURL {
            await MainActor.run { connectionMode = .connectingRemote }

            do {
                let token = authManager.getToken() ?? ""
                try await gatewayClient.connect(url: remoteURL, token: token)
                await MainActor.run {
                    connectionMode = .connectedRemote
                    isLocalNetwork = false
                }
                logger.info("Connected via Tailscale")
                return
            } catch {
                logger.error("Tailscale connection failed: \(error.localizedDescription)")
            }
        }

        await MainActor.run {
            connectionMode = .error("Unable to connect to Gateway")
        }
    }

    /// Disconnect and reset state
    func disconnect() {
        gatewayClient.disconnect()
        connectionMode = .disconnected
        logger.info("Disconnected from Gateway")
    }

    // MARK: - Network Monitoring (NWPathMonitor)

    private func startNetworkMonitoring() {
        pathMonitor = NWPathMonitor()

        pathMonitor?.pathUpdateHandler = { [weak self] path in
            guard let self = self else { return }

            let available = path.status == .satisfied
            let isWifi = path.usesInterfaceType(.wifi)
            let isEthernet = path.usesInterfaceType(.wiredEthernet)

            DispatchQueue.main.async {
                self.networkAvailable = available
            }

            self.logger.debug(
                "Network status: \(available ? "available" : "unavailable"), " +
                "wifi=\(isWifi), ethernet=\(isEthernet)"
            )

            // If network regained and we're paired but disconnected, auto-reconnect
            if available && !self.connectionMode.isConnected && self.pairingManager.isPaired {
                self.logger.info("Network regained, attempting reconnection")
                Task {
                    if let info = self.pairingManager.pairingInfo {
                        await self.connectWithFallback(info: info)
                    }
                }
            }
        }

        pathMonitor?.start(queue: monitorQueue)
        logger.info("Network monitoring started")
    }

    private func stopNetworkMonitoring() {
        pathMonitor?.cancel()
        pathMonitor = nil
        logger.info("Network monitoring stopped")
    }

    // MARK: - Local Discovery (mDNS/Bonjour)

    /// Start browsing for Alfred Gateway on local network via mDNS
    func startLocalDiscovery() {
        // Browse for _alfred._tcp service type
        let descriptor = NWBrowser.Descriptor.bonjour(type: "_alfred._tcp", domain: nil)
        let params = NWParameters()
        params.includePeerToPeer = true

        browser = NWBrowser(for: descriptor, using: params)

        browser?.browseResultsChangedHandler = { [weak self] results, changes in
            guard let self = self else { return }

            for result in results {
                switch result.endpoint {
                case .service(let name, let type, let domain, _):
                    self.logger.info("Discovered Gateway: \(name) (\(type).\(domain))")
                    self.discoveredLocalGateway = result.endpoint
                default:
                    break
                }
            }
        }

        browser?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.logger.info("mDNS browser ready")
            case .failed(let error):
                self?.logger.error("mDNS browser failed: \(error)")
            default:
                break
            }
        }

        browser?.start(queue: monitorQueue)
        logger.info("Local discovery started")
    }

    func stopLocalDiscovery() {
        browser?.cancel()
        browser = nil
    }
}

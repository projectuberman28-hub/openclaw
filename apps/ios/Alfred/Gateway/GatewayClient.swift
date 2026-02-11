import Foundation
import Combine

/// WebSocket client for communicating with the Alfred Gateway.
/// Uses URLSessionWebSocketTask for native WebSocket support.
final class GatewayClient: ObservableObject {
    static let shared = GatewayClient()

    // MARK: - Published State

    @Published private(set) var isConnected: Bool = false
    @Published private(set) var connectionError: String? = nil

    // MARK: - Properties

    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession
    private var url: URL?
    private var token: String?

    private let logger = AlfredLogger.gateway
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    // Message stream
    private var messageContinuation: AsyncStream<ServerMessage>.Continuation?
    private(set) var messages: AsyncStream<ServerMessage>

    // Reconnection
    private var reconnectAttempts: Int = 0
    private let maxReconnectAttempts: Int = 10
    private var reconnectTask: Task<Void, Never>?
    private var shouldReconnect: Bool = true

    // Heartbeat
    private var heartbeatTimer: Timer?
    private let heartbeatInterval: TimeInterval = 30.0
    private var lastPongReceived: Date = Date()

    // MARK: - Init

    private init() {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        self.session = URLSession(configuration: config)

        // Initialize AsyncStream
        var continuation: AsyncStream<ServerMessage>.Continuation!
        self.messages = AsyncStream { cont in
            continuation = cont
        }
        self.messageContinuation = continuation
    }

    // MARK: - Connect

    /// Connect to the Gateway WebSocket
    /// - Parameters:
    ///   - url: WebSocket URL (e.g., ws://192.168.1.100:3001/ws)
    ///   - token: Authentication token
    func connect(url: URL, token: String) async throws {
        self.url = url
        self.token = token
        self.shouldReconnect = true
        self.reconnectAttempts = 0

        try await establishConnection()
    }

    private func establishConnection() throws {
        guard let url = self.url else {
            throw GatewayError.noURL
        }

        var request = URLRequest(url: url)
        if let token = self.token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        // Cancel existing task
        webSocketTask?.cancel(with: .goingAway, reason: nil)

        // Create new WebSocket task
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()

        logger.info("WebSocket connection initiated to \(url.absoluteString)")

        // Start receive loop
        startReceiving()

        // Start heartbeat
        startHeartbeat()

        DispatchQueue.main.async {
            self.isConnected = true
            self.connectionError = nil
        }
    }

    // MARK: - Disconnect

    /// Disconnect from the Gateway
    func disconnect() {
        shouldReconnect = false
        reconnectTask?.cancel()
        reconnectTask = nil
        stopHeartbeat()

        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil

        DispatchQueue.main.async {
            self.isConnected = false
        }

        logger.info("WebSocket disconnected")
    }

    // MARK: - Send

    /// Send a client message to the Gateway
    func send(message: ClientMessage) async throws {
        guard let webSocketTask = webSocketTask else {
            throw GatewayError.notConnected
        }

        let data = try encoder.encode(message)
        let wsMessage = URLSessionWebSocketTask.Message.data(data)

        try await webSocketTask.send(wsMessage)
        logger.debug("Sent message: type=\(message.type.rawValue), id=\(message.id)")
    }

    /// Send a chat message (convenience)
    func sendChat(_ text: String, sessionId: String? = nil) async throws {
        let message = ClientMessage.chat(text, sessionId: sessionId)
        try await send(message: message)
    }

    // MARK: - Receive Loop

    private func startReceiving() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let wsMessage):
                self.handleReceivedMessage(wsMessage)
                // Continue receiving
                self.startReceiving()

            case .failure(let error):
                self.logger.error("WebSocket receive error: \(error.localizedDescription)")
                self.handleDisconnection()
            }
        }
    }

    private func handleReceivedMessage(_ wsMessage: URLSessionWebSocketTask.Message) {
        let data: Data

        switch wsMessage {
        case .data(let d):
            data = d
        case .string(let text):
            guard let d = text.data(using: .utf8) else {
                logger.warning("Failed to convert string message to data")
                return
            }
            data = d
        @unknown default:
            logger.warning("Unknown WebSocket message type received")
            return
        }

        do {
            let serverMessage = try decoder.decode(ServerMessage.self, from: data)

            // Handle pong internally
            if serverMessage.type == .pong {
                lastPongReceived = Date()
                logger.debug("Pong received")
                return
            }

            // Emit to stream
            messageContinuation?.yield(serverMessage)
            logger.debug("Received message: type=\(serverMessage.type.rawValue)")
        } catch {
            logger.error("Failed to decode server message: \(error.localizedDescription)")
        }
    }

    // MARK: - Auto-Reconnect (Exponential Backoff)

    private func handleDisconnection() {
        DispatchQueue.main.async {
            self.isConnected = false
        }

        stopHeartbeat()

        guard shouldReconnect, reconnectAttempts < maxReconnectAttempts else {
            logger.warning("Max reconnect attempts reached or reconnection disabled")
            DispatchQueue.main.async {
                self.connectionError = "Connection lost. Please reconnect manually."
            }
            return
        }

        reconnectAttempts += 1
        let delay = calculateBackoff(attempt: reconnectAttempts)
        logger.info("Reconnecting in \(delay)s (attempt \(reconnectAttempts)/\(maxReconnectAttempts))")

        reconnectTask = Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

            guard !Task.isCancelled, self.shouldReconnect else { return }

            do {
                try self.establishConnection()
                self.reconnectAttempts = 0
                self.logger.info("Reconnected successfully")
            } catch {
                self.logger.error("Reconnection failed: \(error.localizedDescription)")
                self.handleDisconnection()
            }
        }
    }

    /// Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (capped)
    private func calculateBackoff(attempt: Int) -> TimeInterval {
        let base: TimeInterval = 1.0
        let maxDelay: TimeInterval = 30.0
        let delay = min(base * pow(2.0, Double(attempt - 1)), maxDelay)
        // Add jitter (0-25% random)
        let jitter = delay * Double.random(in: 0...0.25)
        return delay + jitter
    }

    // MARK: - Heartbeat (Ping/Pong)

    private func startHeartbeat() {
        stopHeartbeat()

        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: heartbeatInterval, repeats: true) { [weak self] _ in
            guard let self = self else { return }

            Task {
                do {
                    try await self.send(message: .ping())
                    self.logger.debug("Ping sent")
                } catch {
                    self.logger.warning("Failed to send ping: \(error.localizedDescription)")
                }
            }

            // Check if pong was received recently
            let timeSinceLastPong = Date().timeIntervalSince(self.lastPongReceived)
            if timeSinceLastPong > self.heartbeatInterval * 2 {
                self.logger.warning("No pong received for \(timeSinceLastPong)s, connection may be dead")
                self.handleDisconnection()
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    // MARK: - Recreate Message Stream

    /// Reset the message stream (e.g., after reconnection)
    func resetMessageStream() {
        messageContinuation?.finish()

        var continuation: AsyncStream<ServerMessage>.Continuation!
        self.messages = AsyncStream { cont in
            continuation = cont
        }
        self.messageContinuation = continuation
    }
}

// MARK: - Errors

enum GatewayError: LocalizedError {
    case noURL
    case notConnected
    case encodingFailed
    case decodingFailed
    case connectionFailed(String)
    case authenticationFailed
    case timeout

    var errorDescription: String? {
        switch self {
        case .noURL: return "No Gateway URL configured"
        case .notConnected: return "Not connected to Gateway"
        case .encodingFailed: return "Failed to encode message"
        case .decodingFailed: return "Failed to decode message"
        case .connectionFailed(let reason): return "Connection failed: \(reason)"
        case .authenticationFailed: return "Authentication failed"
        case .timeout: return "Connection timed out"
        }
    }
}

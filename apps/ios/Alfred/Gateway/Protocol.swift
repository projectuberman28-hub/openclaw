import Foundation

// MARK: - Client Messages (sent TO Gateway)

/// Message sent from the client to the Gateway
struct ClientMessage: Codable {
    let type: ClientMessageType
    let id: String
    let payload: ClientPayload?

    init(type: ClientMessageType, id: String = UUID().uuidString, payload: ClientPayload? = nil) {
        self.type = type
        self.id = id
        self.payload = payload
    }
}

/// Types of messages the client can send
enum ClientMessageType: String, Codable {
    case chat
    case command
    case subscribe
    case unsubscribe
    case ping
    case cancel
}

/// Payload for client messages
struct ClientPayload: Codable {
    var message: String?
    var sessionId: String?
    var attachments: [AttachmentInfo]?
    var command: String?
    var args: [String: AnyCodable]?
    var channel: String?
}

/// Info about an attachment (image, file, etc.)
struct AttachmentInfo: Codable, Identifiable {
    let id: String
    let type: AttachmentType
    let name: String
    let mimeType: String
    let size: Int64?
    let url: String?

    enum AttachmentType: String, Codable {
        case image
        case file
        case audio
        case video
    }
}

// MARK: - Server Messages (received FROM Gateway)

/// Message received from the Gateway
struct ServerMessage: Codable {
    let type: ServerMessageType
    let id: String?
    let payload: ServerPayload?
}

/// Types of messages the server can send
enum ServerMessageType: String, Codable {
    case text
    case toolUse = "tool_use"
    case toolResult = "tool_result"
    case thinking
    case error
    case done
    case pong
    case status
    case delta
    case sessionCreated = "session_created"
    case sessionList = "session_list"
}

/// Payload for server messages
struct ServerPayload: Codable {
    var text: String?
    var delta: String?
    var toolUse: ToolUsePayload?
    var toolResult: ToolResultPayload?
    var thinking: String?
    var error: ErrorPayload?
    var status: StatusPayload?
    var sessionId: String?
    var sessions: [SessionInfo]?
}

/// Tool use information from the assistant
struct ToolUsePayload: Codable {
    let id: String
    let name: String
    let input: [String: AnyCodable]?
}

/// Result of a tool execution
struct ToolResultPayload: Codable {
    let toolUseId: String
    let content: String?
    let isError: Bool?
}

/// Error information
struct ErrorPayload: Codable {
    let code: String?
    let message: String
    let details: String?
}

/// Gateway status information
struct StatusPayload: Codable {
    let connected: Bool?
    let activeModel: String?
    let nodeCount: Int?
    let uptime: TimeInterval?
}

/// Session metadata
struct SessionInfo: Codable, Identifiable {
    let id: String
    let title: String?
    let createdAt: Date?
    let updatedAt: Date?
    let messageCount: Int?
}

// MARK: - Pairing

/// Information received during pairing with a Gateway
struct PairingInfo: Codable {
    let host: String
    let port: Int
    let syncKey: String
    let tailscaleIP: String?
    let gatewayName: String?

    /// WebSocket URL for this pairing
    var websocketURL: URL? {
        URL(string: "ws://\(host):\(port)/ws")
    }

    /// Tailscale WebSocket URL (remote access)
    var tailscaleWebSocketURL: URL? {
        guard let ip = tailscaleIP else { return nil }
        return URL(string: "ws://\(ip):\(port)/ws")
    }
}

// MARK: - Chat Message Model

/// A single chat message for display
struct ChatMessage: Identifiable, Codable, Equatable {
    let id: String
    let role: MessageRole
    var content: String
    let timestamp: Date
    let sessionId: String
    var isStreaming: Bool
    var privacyLevel: PrivacyLevel
    var toolUses: [ToolUsePayload]?

    enum MessageRole: String, Codable {
        case user
        case assistant
        case system
    }

    enum PrivacyLevel: String, Codable {
        case local       // Processed entirely on-device
        case cloud       // Required cloud API call
        case unknown
    }

    init(
        id: String = UUID().uuidString,
        role: MessageRole,
        content: String,
        timestamp: Date = Date(),
        sessionId: String = "",
        isStreaming: Bool = false,
        privacyLevel: PrivacyLevel = .unknown,
        toolUses: [ToolUsePayload]? = nil
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.isStreaming = isStreaming
        self.privacyLevel = privacyLevel
        self.toolUses = toolUses
    }

    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - AnyCodable (Type-erased Codable for dynamic JSON)

/// Type-erased Codable wrapper for handling dynamic JSON payloads
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if container.decodeNil() {
            self.value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            self.value = dict.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "AnyCodable cannot decode value"
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            throw EncodingError.invalidValue(
                value,
                EncodingError.Context(
                    codingPath: container.codingPath,
                    debugDescription: "AnyCodable cannot encode value of type \(type(of: value))"
                )
            )
        }
    }
}

// MARK: - Helper Extensions

extension ClientMessage {
    /// Create a chat message
    static func chat(_ message: String, sessionId: String? = nil, attachments: [AttachmentInfo]? = nil) -> ClientMessage {
        ClientMessage(
            type: .chat,
            payload: ClientPayload(
                message: message,
                sessionId: sessionId,
                attachments: attachments
            )
        )
    }

    /// Create a ping message
    static func ping() -> ClientMessage {
        ClientMessage(type: .ping)
    }

    /// Create a cancel message
    static func cancel(id: String) -> ClientMessage {
        ClientMessage(type: .cancel, id: id)
    }

    /// Create a subscribe message
    static func subscribe(channel: String) -> ClientMessage {
        ClientMessage(
            type: .subscribe,
            payload: ClientPayload(channel: channel)
        )
    }
}

import XCTest
@testable import Alfred

final class GatewayClientTests: XCTestCase {

    // MARK: - Protocol Encoding Tests

    func testClientMessageEncoding() throws {
        let message = ClientMessage(
            type: .chat,
            id: "test-123",
            payload: ClientPayload(message: "Hello, Alfred!")
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(message)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertTrue(json.contains("\"type\":\"chat\""))
        XCTAssertTrue(json.contains("\"id\":\"test-123\""))
        XCTAssertTrue(json.contains("Hello, Alfred!"))
    }

    func testClientMessagePingEncoding() throws {
        let message = ClientMessage.ping()

        let encoder = JSONEncoder()
        let data = try encoder.encode(message)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertTrue(json.contains("\"type\":\"ping\""))
    }

    func testClientMessageChatHelper() throws {
        let message = ClientMessage.chat("Test message", sessionId: "session-456")

        XCTAssertEqual(message.type, .chat)
        XCTAssertEqual(message.payload?.message, "Test message")
        XCTAssertEqual(message.payload?.sessionId, "session-456")
    }

    func testClientMessageSubscribeHelper() throws {
        let message = ClientMessage.subscribe(channel: "notifications")

        XCTAssertEqual(message.type, .subscribe)
        XCTAssertEqual(message.payload?.channel, "notifications")
    }

    func testClientMessageCancelHelper() throws {
        let message = ClientMessage.cancel(id: "msg-789")

        XCTAssertEqual(message.type, .cancel)
        XCTAssertEqual(message.id, "msg-789")
    }

    // MARK: - Protocol Decoding Tests

    func testServerMessageTextDecoding() throws {
        let json = """
        {
            "type": "text",
            "id": "resp-001",
            "payload": {
                "text": "Hello from Alfred!"
            }
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .text)
        XCTAssertEqual(message.id, "resp-001")
        XCTAssertEqual(message.payload?.text, "Hello from Alfred!")
    }

    func testServerMessageDeltaDecoding() throws {
        let json = """
        {
            "type": "delta",
            "id": "resp-002",
            "payload": {
                "delta": " world"
            }
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .delta)
        XCTAssertEqual(message.payload?.delta, " world")
    }

    func testServerMessageErrorDecoding() throws {
        let json = """
        {
            "type": "error",
            "id": "err-001",
            "payload": {
                "error": {
                    "code": "RATE_LIMIT",
                    "message": "Too many requests",
                    "details": "Please slow down"
                }
            }
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .error)
        XCTAssertEqual(message.payload?.error?.code, "RATE_LIMIT")
        XCTAssertEqual(message.payload?.error?.message, "Too many requests")
        XCTAssertEqual(message.payload?.error?.details, "Please slow down")
    }

    func testServerMessageToolUseDecoding() throws {
        let json = """
        {
            "type": "tool_use",
            "id": "tool-001",
            "payload": {
                "toolUse": {
                    "id": "tu-001",
                    "name": "calculator",
                    "input": {
                        "expression": "2 + 2"
                    }
                }
            }
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .toolUse)
        XCTAssertEqual(message.payload?.toolUse?.id, "tu-001")
        XCTAssertEqual(message.payload?.toolUse?.name, "calculator")
    }

    func testServerMessagePongDecoding() throws {
        let json = """
        {
            "type": "pong",
            "id": null,
            "payload": null
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .pong)
    }

    func testServerMessageDoneDecoding() throws {
        let json = """
        {
            "type": "done",
            "id": "resp-003"
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .done)
        XCTAssertEqual(message.id, "resp-003")
    }

    func testServerMessageStatusDecoding() throws {
        let json = """
        {
            "type": "status",
            "id": null,
            "payload": {
                "status": {
                    "connected": true,
                    "activeModel": "claude-3-opus",
                    "nodeCount": 3
                }
            }
        }
        """

        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let message = try decoder.decode(ServerMessage.self, from: data)

        XCTAssertEqual(message.type, .status)
        XCTAssertEqual(message.payload?.status?.connected, true)
        XCTAssertEqual(message.payload?.status?.activeModel, "claude-3-opus")
        XCTAssertEqual(message.payload?.status?.nodeCount, 3)
    }

    // MARK: - AnyCodable Tests

    func testAnyCodableStringEncoding() throws {
        let value = AnyCodable("hello")
        let encoder = JSONEncoder()
        let data = try encoder.encode(value)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertEqual(json, "\"hello\"")
    }

    func testAnyCodableIntEncoding() throws {
        let value = AnyCodable(42)
        let encoder = JSONEncoder()
        let data = try encoder.encode(value)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertEqual(json, "42")
    }

    func testAnyCodableBoolEncoding() throws {
        let value = AnyCodable(true)
        let encoder = JSONEncoder()
        let data = try encoder.encode(value)
        let json = String(data: data, encoding: .utf8)!

        XCTAssertEqual(json, "true")
    }

    func testAnyCodableDecoding() throws {
        let json = "\"test string\""
        let decoder = JSONDecoder()
        let data = json.data(using: .utf8)!
        let value = try decoder.decode(AnyCodable.self, from: data)

        XCTAssertEqual(value.value as? String, "test string")
    }

    // MARK: - PairingInfo Tests

    func testPairingInfoWebSocketURL() {
        let info = PairingInfo(
            host: "192.168.1.100",
            port: 3001,
            syncKey: "abc123",
            tailscaleIP: "100.64.0.1",
            gatewayName: "my-gateway"
        )

        XCTAssertEqual(info.websocketURL?.absoluteString, "ws://192.168.1.100:3001/ws")
        XCTAssertEqual(info.tailscaleWebSocketURL?.absoluteString, "ws://100.64.0.1:3001/ws")
    }

    func testPairingInfoWithoutTailscale() {
        let info = PairingInfo(
            host: "192.168.1.100",
            port: 3001,
            syncKey: "abc123",
            tailscaleIP: nil,
            gatewayName: nil
        )

        XCTAssertNotNil(info.websocketURL)
        XCTAssertNil(info.tailscaleWebSocketURL)
    }

    func testPairingInfoCodable() throws {
        let info = PairingInfo(
            host: "192.168.1.100",
            port: 3001,
            syncKey: "test-key",
            tailscaleIP: "100.64.0.1",
            gatewayName: "test-gw"
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(info)

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(PairingInfo.self, from: data)

        XCTAssertEqual(decoded.host, info.host)
        XCTAssertEqual(decoded.port, info.port)
        XCTAssertEqual(decoded.syncKey, info.syncKey)
        XCTAssertEqual(decoded.tailscaleIP, info.tailscaleIP)
        XCTAssertEqual(decoded.gatewayName, info.gatewayName)
    }

    // MARK: - ChatMessage Tests

    func testChatMessageCreation() {
        let message = ChatMessage(
            role: .user,
            content: "Hello",
            privacyLevel: .local
        )

        XCTAssertEqual(message.role, .user)
        XCTAssertEqual(message.content, "Hello")
        XCTAssertFalse(message.isStreaming)
        XCTAssertEqual(message.privacyLevel, .local)
        XCTAssertFalse(message.id.isEmpty)
    }

    func testChatMessageEquality() {
        let id = "same-id"
        let msg1 = ChatMessage(id: id, role: .user, content: "Hello")
        let msg2 = ChatMessage(id: id, role: .assistant, content: "Different content")

        // Equality is based on ID only
        XCTAssertEqual(msg1, msg2)
    }

    // MARK: - AttachmentInfo Tests

    func testAttachmentInfoCreation() {
        let attachment = AttachmentInfo(
            id: "att-001",
            type: .image,
            name: "photo.jpg",
            mimeType: "image/jpeg",
            size: 1024,
            url: "https://example.com/photo.jpg"
        )

        XCTAssertEqual(attachment.id, "att-001")
        XCTAssertEqual(attachment.type, .image)
        XCTAssertEqual(attachment.name, "photo.jpg")
        XCTAssertEqual(attachment.mimeType, "image/jpeg")
        XCTAssertEqual(attachment.size, 1024)
    }

    // MARK: - Client Message Type Tests

    func testClientMessageTypeRawValues() {
        XCTAssertEqual(ClientMessageType.chat.rawValue, "chat")
        XCTAssertEqual(ClientMessageType.command.rawValue, "command")
        XCTAssertEqual(ClientMessageType.subscribe.rawValue, "subscribe")
        XCTAssertEqual(ClientMessageType.unsubscribe.rawValue, "unsubscribe")
        XCTAssertEqual(ClientMessageType.ping.rawValue, "ping")
        XCTAssertEqual(ClientMessageType.cancel.rawValue, "cancel")
    }

    func testServerMessageTypeRawValues() {
        XCTAssertEqual(ServerMessageType.text.rawValue, "text")
        XCTAssertEqual(ServerMessageType.toolUse.rawValue, "tool_use")
        XCTAssertEqual(ServerMessageType.toolResult.rawValue, "tool_result")
        XCTAssertEqual(ServerMessageType.thinking.rawValue, "thinking")
        XCTAssertEqual(ServerMessageType.error.rawValue, "error")
        XCTAssertEqual(ServerMessageType.done.rawValue, "done")
        XCTAssertEqual(ServerMessageType.pong.rawValue, "pong")
        XCTAssertEqual(ServerMessageType.status.rawValue, "status")
    }
}

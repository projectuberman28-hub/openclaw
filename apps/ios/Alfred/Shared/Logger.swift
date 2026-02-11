import Foundation
import os

/// Structured logging wrapper using Apple's os.Logger framework.
/// Provides category-based logging with appropriate privacy levels.
struct AlfredLogger {
    private let logger: os.Logger

    /// Create a logger for a specific category
    init(category: String) {
        self.logger = os.Logger(
            subsystem: Bundle.main.bundleIdentifier ?? "com.alfred.v3",
            category: category
        )
    }

    // MARK: - Log Levels

    /// Debug-level log (only visible in Console.app with debug enabled)
    func debug(_ message: String) {
        logger.debug("\(message, privacy: .public)")
    }

    /// Info-level log (standard informational messages)
    func info(_ message: String) {
        logger.info("\(message, privacy: .public)")
    }

    /// Warning-level log (potential issues that don't prevent operation)
    func warning(_ message: String) {
        logger.warning("\(message, privacy: .public)")
    }

    /// Error-level log (failures that need attention)
    func error(_ message: String) {
        logger.error("\(message, privacy: .public)")
    }

    /// Critical-level log (severe failures)
    func critical(_ message: String) {
        logger.critical("\(message, privacy: .public)")
    }

    /// Log with privacy-sensitive data (redacted in production logs)
    func sensitive(_ message: String) {
        logger.debug("\(message, privacy: .private)")
    }
}

// MARK: - Predefined Loggers

extension AlfredLogger {
    /// Logger for Gateway/WebSocket operations
    static let gateway = AlfredLogger(category: "Gateway")

    /// Logger for authentication and security
    static let auth = AlfredLogger(category: "Auth")

    /// Logger for chat and messaging
    static let chat = AlfredLogger(category: "Chat")

    /// Logger for voice operations
    static let voice = AlfredLogger(category: "Voice")

    /// Logger for camera operations
    static let camera = AlfredLogger(category: "Camera")

    /// Logger for canvas/A2UI rendering
    static let canvas = AlfredLogger(category: "Canvas")

    /// Logger for node identity and capabilities
    static let node = AlfredLogger(category: "Node")

    /// Logger for network/connection management
    static let network = AlfredLogger(category: "Network")

    /// Logger for general app lifecycle
    static let app = AlfredLogger(category: "App")
}

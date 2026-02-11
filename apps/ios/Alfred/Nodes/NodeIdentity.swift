import Foundation
import UIKit

/// Unique device identity for the Alfred node system.
/// UUID is stored in Keychain to persist across app reinstalls.
final class NodeIdentity: ObservableObject {
    static let shared = NodeIdentity()

    // MARK: - Properties

    /// Unique device identifier (persisted in Keychain)
    let deviceId: String

    /// Human-readable device name
    let deviceName: String

    /// Device model (e.g., "iPhone 15 Pro")
    let deviceModel: String

    /// iOS version string
    let osVersion: String

    /// App version
    let appVersion: String

    /// App build number
    let buildNumber: String

    private let keychain = KeychainHelper.shared
    private let logger = AlfredLogger.node

    // MARK: - Init

    private init() {
        // Load or generate device UUID
        if let existingId = keychain.loadString(key: KeychainHelper.Keys.deviceUUID) {
            deviceId = existingId
        } else {
            let newId = UUID().uuidString
            keychain.save(key: KeychainHelper.Keys.deviceUUID, string: newId)
            deviceId = newId
        }

        deviceName = UIDevice.current.name
        deviceModel = NodeIdentity.modelIdentifier()
        osVersion = UIDevice.current.systemVersion
        appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
        buildNumber = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0"

        logger.info("Node identity: \(deviceId) (\(deviceModel), iOS \(osVersion))")
    }

    // MARK: - Registration Payload

    /// Generate the node registration payload for the Gateway
    func registrationPayload() -> NodeRegistration {
        return NodeRegistration(
            deviceId: deviceId,
            deviceName: deviceName,
            deviceModel: deviceModel,
            platform: "ios",
            osVersion: osVersion,
            appVersion: appVersion,
            capabilities: NodeCapabilities.shared.currentCapabilities()
        )
    }

    // MARK: - Model Identifier

    /// Get the human-readable device model name
    private static func modelIdentifier() -> String {
        var systemInfo = utsname()
        uname(&systemInfo)

        let modelCode = withUnsafePointer(to: &systemInfo.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: 1) {
                String(validatingUTF8: $0)
            }
        }

        guard let model = modelCode else { return "Unknown" }

        // Map common model identifiers to names
        let modelMap: [String: String] = [
            "iPhone16,1": "iPhone 15 Pro",
            "iPhone16,2": "iPhone 15 Pro Max",
            "iPhone15,4": "iPhone 15",
            "iPhone15,5": "iPhone 15 Plus",
            "iPhone17,1": "iPhone 16 Pro",
            "iPhone17,2": "iPhone 16 Pro Max",
            "iPhone17,3": "iPhone 16",
            "iPhone17,4": "iPhone 16 Plus",
            "iPad16,3": "iPad Pro M4 11-inch",
            "iPad16,4": "iPad Pro M4 11-inch",
            "iPad16,5": "iPad Pro M4 13-inch",
            "iPad16,6": "iPad Pro M4 13-inch",
            "x86_64": "Simulator (x86_64)",
            "arm64": "Simulator (arm64)"
        ]

        return modelMap[model] ?? model
    }
}

// MARK: - Node Registration

struct NodeRegistration: Codable {
    let deviceId: String
    let deviceName: String
    let deviceModel: String
    let platform: String
    let osVersion: String
    let appVersion: String
    let capabilities: [String]
}

import Foundation
import AVFoundation
import CoreLocation
import UserNotifications
import Speech

/// Declares and checks device capabilities for the Alfred node system.
/// Reports what this device can do: camera, microphone, location, etc.
final class NodeCapabilities: ObservableObject {
    static let shared = NodeCapabilities()

    // MARK: - Published State

    @Published var capabilities: [Capability] = []

    // MARK: - Properties

    private let logger = AlfredLogger.node

    // MARK: - Capability Definition

    struct Capability: Identifiable, Codable {
        let id: String
        let name: String
        let description: String
        var isAvailable: Bool
        var permissionStatus: PermissionStatus

        enum PermissionStatus: String, Codable {
            case granted
            case denied
            case notDetermined
            case restricted
            case notApplicable
        }
    }

    // MARK: - Capability IDs

    enum CapabilityID {
        static let camera = "camera"
        static let microphone = "microphone"
        static let location = "location"
        static let notifications = "notifications"
        static let voice = "voice"
        static let haptics = "haptics"
        static let faceId = "face_id"
        static let nfc = "nfc"
        static let bluetooth = "bluetooth"
    }

    // MARK: - Init

    private init() {
        refreshCapabilities()
    }

    // MARK: - Refresh

    /// Check all capability statuses
    func refreshCapabilities() {
        capabilities = [
            checkCamera(),
            checkMicrophone(),
            checkLocation(),
            checkNotifications(),
            checkVoice(),
            checkHaptics(),
            checkBiometrics(),
        ]

        logger.info("Capabilities refreshed: \(capabilities.filter { $0.isAvailable }.count)/\(capabilities.count) available")
    }

    /// Return a list of available capability IDs
    func currentCapabilities() -> [String] {
        return capabilities
            .filter { $0.isAvailable && $0.permissionStatus != .denied }
            .map { $0.id }
    }

    // MARK: - Individual Checks

    private func checkCamera() -> Capability {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        return Capability(
            id: CapabilityID.camera,
            name: "Camera",
            description: "Photo and video capture",
            isAvailable: AVCaptureDevice.default(for: .video) != nil,
            permissionStatus: mapAVAuthStatus(status)
        )
    }

    private func checkMicrophone() -> Capability {
        let status = AVCaptureDevice.authorizationStatus(for: .audio)
        return Capability(
            id: CapabilityID.microphone,
            name: "Microphone",
            description: "Audio recording and voice input",
            isAvailable: true,
            permissionStatus: mapAVAuthStatus(status)
        )
    }

    private func checkLocation() -> Capability {
        let manager = CLLocationManager()
        let status: Capability.PermissionStatus

        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            status = .granted
        case .denied:
            status = .denied
        case .restricted:
            status = .restricted
        case .notDetermined:
            status = .notDetermined
        @unknown default:
            status = .notDetermined
        }

        return Capability(
            id: CapabilityID.location,
            name: "Location",
            description: "Device location services",
            isAvailable: CLLocationManager.locationServicesEnabled(),
            permissionStatus: status
        )
    }

    private func checkNotifications() -> Capability {
        // Notification status requires async check; default to notDetermined
        return Capability(
            id: CapabilityID.notifications,
            name: "Notifications",
            description: "Push and local notifications",
            isAvailable: true,
            permissionStatus: .notDetermined  // Updated async in checkNotificationStatus()
        )
    }

    private func checkVoice() -> Capability {
        let status = SFSpeechRecognizer.authorizationStatus()
        let permStatus: Capability.PermissionStatus

        switch status {
        case .authorized:
            permStatus = .granted
        case .denied:
            permStatus = .denied
        case .restricted:
            permStatus = .restricted
        case .notDetermined:
            permStatus = .notDetermined
        @unknown default:
            permStatus = .notDetermined
        }

        return Capability(
            id: CapabilityID.voice,
            name: "Voice Recognition",
            description: "On-device speech-to-text",
            isAvailable: SFSpeechRecognizer()?.isAvailable ?? false,
            permissionStatus: permStatus
        )
    }

    private func checkHaptics() -> Capability {
        return Capability(
            id: CapabilityID.haptics,
            name: "Haptics",
            description: "Haptic feedback and vibration",
            isAvailable: true,  // All modern iPhones support haptics
            permissionStatus: .notApplicable
        )
    }

    private func checkBiometrics() -> Capability {
        let authManager = AuthManager.shared
        return Capability(
            id: CapabilityID.faceId,
            name: authManager.biometricType.displayName,
            description: "Biometric authentication",
            isAvailable: authManager.biometricType != .none,
            permissionStatus: .notApplicable
        )
    }

    // MARK: - Async Permission Checks

    /// Check notification permission status (async)
    func checkNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let permStatus: Capability.PermissionStatus

        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            permStatus = .granted
        case .denied:
            permStatus = .denied
        case .notDetermined:
            permStatus = .notDetermined
        @unknown default:
            permStatus = .notDetermined
        }

        await MainActor.run {
            if let index = capabilities.firstIndex(where: { $0.id == CapabilityID.notifications }) {
                capabilities[index].permissionStatus = permStatus
            }
        }
    }

    // MARK: - Request Permission

    /// Request permission for a specific capability
    func requestPermission(for capabilityId: String) async {
        switch capabilityId {
        case CapabilityID.camera:
            await AVCaptureDevice.requestAccess(for: .video)
        case CapabilityID.microphone:
            await AVCaptureDevice.requestAccess(for: .audio)
        case CapabilityID.notifications:
            _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        case CapabilityID.voice:
            await withCheckedContinuation { continuation in
                SFSpeechRecognizer.requestAuthorization { _ in
                    continuation.resume()
                }
            }
        default:
            logger.warning("No permission request handler for capability: \(capabilityId)")
        }

        refreshCapabilities()
    }

    // MARK: - Helpers

    private func mapAVAuthStatus(_ status: AVAuthorizationStatus) -> Capability.PermissionStatus {
        switch status {
        case .authorized: return .granted
        case .denied: return .denied
        case .restricted: return .restricted
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }
}

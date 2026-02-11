import Foundation
import UIKit
import CoreLocation
import AVFoundation

/// Handles commands sent from the Gateway to this device node.
/// Routes and executes device-specific actions (take photo, get location, etc.).
final class NodeCommandHandler: ObservableObject {
    static let shared = NodeCommandHandler()

    // MARK: - Published State

    @Published var lastCommand: String? = nil
    @Published var isExecuting: Bool = false

    // MARK: - Properties

    private let logger = AlfredLogger.node
    private let cameraCapture = CameraCapture()
    private let mediaUploader = MediaUploader()
    private var locationManager: CLLocationManager?

    // MARK: - Command Types

    enum CommandType: String, CaseIterable {
        case takePhoto = "take_photo"
        case getLocation = "get_location"
        case playSound = "play_sound"
        case vibrate = "vibrate"
        case getDeviceInfo = "get_device_info"
        case getCapabilities = "get_capabilities"
        case setBrightness = "set_brightness"
        case openURL = "open_url"
        case sendNotification = "send_notification"
    }

    // MARK: - Init

    private init() {}

    // MARK: - Handle Command

    /// Handle an incoming command from the Gateway
    func handleCommand(_ command: ServerMessage) async -> CommandResult {
        guard let commandName = command.payload?.text else {
            return CommandResult(success: false, error: "Missing command name")
        }

        logger.info("Handling command: \(commandName)")
        await MainActor.run {
            lastCommand = commandName
            isExecuting = true
        }

        defer {
            Task { @MainActor in
                isExecuting = false
            }
        }

        guard let commandType = CommandType(rawValue: commandName) else {
            logger.warning("Unknown command: \(commandName)")
            return CommandResult(success: false, error: "Unknown command: \(commandName)")
        }

        return await executeCommand(commandType, payload: command.payload)
    }

    // MARK: - Execute Command

    private func executeCommand(_ type: CommandType, payload: ServerPayload?) async -> CommandResult {
        switch type {
        case .takePhoto:
            return await executeTakePhoto()

        case .getLocation:
            return await executeGetLocation()

        case .playSound:
            return executePlaySound(payload: payload)

        case .vibrate:
            return executeVibrate()

        case .getDeviceInfo:
            return executeGetDeviceInfo()

        case .getCapabilities:
            return executeGetCapabilities()

        case .setBrightness:
            return executeSetBrightness(payload: payload)

        case .openURL:
            return await executeOpenURL(payload: payload)

        case .sendNotification:
            return await executeSendNotification(payload: payload)
        }
    }

    // MARK: - Command Implementations

    private func executeTakePhoto() async -> CommandResult {
        do {
            let image = try await cameraCapture.takePhoto()
            let attachment = try await mediaUploader.uploadImage(image, sessionId: "")
            logger.info("Photo taken and uploaded: \(attachment.id)")
            return CommandResult(success: true, data: ["attachmentId": attachment.id])
        } catch {
            logger.error("Take photo failed: \(error.localizedDescription)")
            return CommandResult(success: false, error: error.localizedDescription)
        }
    }

    private func executeGetLocation() async -> CommandResult {
        return await withCheckedContinuation { continuation in
            // TODO: Implement full CLLocationManager delegate pattern
            // For now, return a placeholder
            let locationManager = CLLocationManager()
            self.locationManager = locationManager

            if let location = locationManager.location {
                let result = CommandResult(success: true, data: [
                    "latitude": location.coordinate.latitude,
                    "longitude": location.coordinate.longitude,
                    "altitude": location.altitude,
                    "accuracy": location.horizontalAccuracy,
                    "timestamp": location.timestamp.timeIntervalSince1970
                ])
                continuation.resume(returning: result)
            } else {
                let result = CommandResult(
                    success: false,
                    error: "Location not available. Ensure location services are enabled."
                )
                continuation.resume(returning: result)
            }
        }
    }

    private func executePlaySound(payload: ServerPayload?) -> CommandResult {
        // TODO: Play specific sound file or system sound
        // For now, play system sound
        AudioServicesPlaySystemSound(1007) // Default system sound
        logger.info("System sound played")
        return CommandResult(success: true)
    }

    private func executeVibrate() -> CommandResult {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
        logger.info("Haptic feedback triggered")
        return CommandResult(success: true)
    }

    private func executeGetDeviceInfo() -> CommandResult {
        let identity = NodeIdentity.shared
        let info: [String: Any] = [
            "deviceId": identity.deviceId,
            "deviceName": identity.deviceName,
            "deviceModel": identity.deviceModel,
            "osVersion": identity.osVersion,
            "appVersion": identity.appVersion,
            "batteryLevel": UIDevice.current.batteryLevel,
            "batteryState": batteryStateString()
        ]
        return CommandResult(success: true, data: info)
    }

    private func executeGetCapabilities() -> CommandResult {
        let caps = NodeCapabilities.shared.currentCapabilities()
        return CommandResult(success: true, data: ["capabilities": caps])
    }

    private func executeSetBrightness(payload: ServerPayload?) -> CommandResult {
        // TODO: Parse brightness value from payload
        // UIScreen.main.brightness = CGFloat(value)
        logger.warning("Set brightness not yet implemented")
        return CommandResult(success: false, error: "Not yet implemented")
    }

    private func executeOpenURL(payload: ServerPayload?) async -> CommandResult {
        guard let urlString = payload?.text,
              let url = URL(string: urlString) else {
            return CommandResult(success: false, error: "Invalid URL")
        }

        let opened = await UIApplication.shared.open(url)
        return CommandResult(success: opened)
    }

    private func executeSendNotification(payload: ServerPayload?) async -> CommandResult {
        let title = payload?.text ?? "Alfred"
        let body = payload?.delta ?? ""

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil // Deliver immediately
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
            logger.info("Local notification sent")
            return CommandResult(success: true)
        } catch {
            logger.error("Notification failed: \(error.localizedDescription)")
            return CommandResult(success: false, error: error.localizedDescription)
        }
    }

    // MARK: - Helpers

    private func batteryStateString() -> String {
        switch UIDevice.current.batteryState {
        case .charging: return "charging"
        case .full: return "full"
        case .unplugged: return "unplugged"
        case .unknown: return "unknown"
        @unknown default: return "unknown"
        }
    }
}

// MARK: - Command Result

struct CommandResult {
    let success: Bool
    var data: [String: Any]?
    var error: String?

    init(success: Bool, data: [String: Any]? = nil, error: String? = nil) {
        self.success = success
        self.data = data
        self.error = error
    }

    /// Encode result as JSON Data for sending back to Gateway
    func toJSONData() -> Data? {
        var dict: [String: Any] = ["success": success]
        if let data = data { dict["data"] = data }
        if let error = error { dict["error"] = error }
        return try? JSONSerialization.data(withJSONObject: dict)
    }
}

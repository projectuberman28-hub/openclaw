import Foundation
import AVFoundation
import Combine

/// Manages pairing with an Alfred Gateway instance via QR code or setup code.
final class PairingManager: ObservableObject {
    static let shared = PairingManager()

    // MARK: - Published State

    @Published var isPaired: Bool = false
    @Published var pairingInfo: PairingInfo? = nil
    @Published var pairingError: String? = nil
    @Published var isScanning: Bool = false

    // MARK: - Properties

    private let keychain = KeychainHelper.shared
    private let logger = AlfredLogger.auth

    // MARK: - Init

    private init() {
        loadPairingInfo()
    }

    // MARK: - Load Existing Pairing

    private func loadPairingInfo() {
        if let info = keychain.load(key: KeychainHelper.Keys.pairingInfo, as: PairingInfo.self) {
            pairingInfo = info
            isPaired = true
            logger.info("Loaded existing pairing: \(info.host):\(info.port)")
        }
    }

    // MARK: - Pair via Setup Code

    /// Pair with a Gateway using a setup code string.
    /// Expected format: "alfred://<host>:<port>/<syncKey>[?tailscale=<ip>]"
    func pair(code: String) async throws {
        logger.info("Attempting to pair with code")

        let info = try parseSetupCode(code)
        try await verifyAndStore(info: info)
    }

    /// Parse a setup code into PairingInfo
    private func parseSetupCode(_ code: String) throws -> PairingInfo {
        // Support multiple code formats:
        // 1. alfred://<host>:<port>/<syncKey>
        // 2. JSON encoded PairingInfo
        // 3. Simple "<host>:<port>:<syncKey>" format

        // Try JSON first
        if let data = code.data(using: .utf8),
           let info = try? JSONDecoder().decode(PairingInfo.self, from: data) {
            return info
        }

        // Try alfred:// URI scheme
        if code.hasPrefix("alfred://") {
            return try parseAlfredURI(code)
        }

        // Try simple colon-separated format
        let parts = code.split(separator: ":")
        guard parts.count >= 3 else {
            throw PairingError.invalidCode("Unrecognized setup code format")
        }

        let host = String(parts[0])
        guard let port = Int(parts[1]) else {
            throw PairingError.invalidCode("Invalid port number")
        }
        let syncKey = String(parts[2])
        let tailscaleIP: String? = parts.count > 3 ? String(parts[3]) : nil

        return PairingInfo(
            host: host,
            port: port,
            syncKey: syncKey,
            tailscaleIP: tailscaleIP,
            gatewayName: nil
        )
    }

    private func parseAlfredURI(_ uri: String) throws -> PairingInfo {
        guard let url = URL(string: uri) else {
            throw PairingError.invalidCode("Invalid alfred:// URI")
        }

        guard let host = url.host, !host.isEmpty else {
            throw PairingError.invalidCode("Missing host in URI")
        }

        let port = url.port ?? 3001
        let syncKey = String(url.path.dropFirst()) // Remove leading /

        guard !syncKey.isEmpty else {
            throw PairingError.invalidCode("Missing sync key in URI")
        }

        // Parse query parameters
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let tailscaleIP = components?.queryItems?.first(where: { $0.name == "tailscale" })?.value
        let gatewayName = components?.queryItems?.first(where: { $0.name == "name" })?.value

        return PairingInfo(
            host: host,
            port: port,
            syncKey: syncKey,
            tailscaleIP: tailscaleIP,
            gatewayName: gatewayName
        )
    }

    // MARK: - Pair via QR Code

    /// Pair using data decoded from a QR code
    func pair(qrData: String) async throws {
        logger.info("Pairing via QR code data")
        let info = try parseSetupCode(qrData)
        try await verifyAndStore(info: info)
    }

    // MARK: - QR Code Scanner

    /// Start QR code scanning session
    /// Returns an AVCaptureSession configured for QR code detection
    func createQRScannerSession() -> AVCaptureSession? {
        let session = AVCaptureSession()

        // TODO: Full AVCaptureSession setup for QR scanning
        // - Configure AVCaptureDevice for video
        // - Add AVCaptureDeviceInput
        // - Add AVCaptureMetadataOutput for .qr
        // - Set metadataObjectTypes to [.qr]
        // - Set delegate for AVCaptureMetadataOutputObjectsDelegate

        guard let device = AVCaptureDevice.default(for: .video) else {
            logger.error("No camera available for QR scanning")
            return nil
        }

        do {
            let input = try AVCaptureDeviceInput(device: device)
            if session.canAddInput(input) {
                session.addInput(input)
            }

            let output = AVCaptureMetadataOutput()
            if session.canAddOutput(output) {
                session.addOutput(output)
                output.metadataObjectTypes = [.qr]
            }

            return session
        } catch {
            logger.error("Failed to create QR scanner: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - Verify & Store

    private func verifyAndStore(info: PairingInfo) async throws {
        // TODO: Verify the connection by sending a test ping to the Gateway
        // let testURL = URL(string: "http://\(info.host):\(info.port)/health")!
        // let (_, response) = try await URLSession.shared.data(from: testURL)
        // guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        //     throw PairingError.gatewayUnreachable
        // }

        // Store pairing info in Keychain
        let success = keychain.save(key: KeychainHelper.Keys.pairingInfo, object: info)
        guard success else {
            throw PairingError.keychainSaveFailed
        }

        // Store sync key separately
        keychain.save(key: KeychainHelper.Keys.syncKey, string: info.syncKey)

        await MainActor.run {
            self.pairingInfo = info
            self.isPaired = true
            self.pairingError = nil
        }

        logger.info("Paired successfully with \(info.host):\(info.port)")
    }

    // MARK: - Unpair

    /// Remove pairing data and disconnect
    func unpair() {
        keychain.delete(key: KeychainHelper.Keys.pairingInfo)
        keychain.delete(key: KeychainHelper.Keys.syncKey)
        keychain.delete(key: KeychainHelper.Keys.authToken)

        pairingInfo = nil
        isPaired = false

        logger.info("Unpaired from Gateway")
    }
}

// MARK: - Errors

enum PairingError: LocalizedError {
    case invalidCode(String)
    case gatewayUnreachable
    case keychainSaveFailed
    case cameraNotAvailable
    case alreadyPaired

    var errorDescription: String? {
        switch self {
        case .invalidCode(let reason): return "Invalid setup code: \(reason)"
        case .gatewayUnreachable: return "Cannot reach the Gateway. Check the address and ensure it's running."
        case .keychainSaveFailed: return "Failed to save pairing data securely"
        case .cameraNotAvailable: return "Camera is not available for QR scanning"
        case .alreadyPaired: return "Already paired with a Gateway"
        }
    }
}

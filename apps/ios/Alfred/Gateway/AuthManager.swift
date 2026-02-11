import Foundation
import LocalAuthentication

/// Manages authentication tokens and biometric auth gate.
/// All tokens are stored in Keychain (NEVER UserDefaults).
final class AuthManager: ObservableObject {
    static let shared = AuthManager()

    // MARK: - Published State

    @Published var isAuthenticated: Bool = false
    @Published var biometricType: BiometricType = .none

    // MARK: - Properties

    private let keychain = KeychainHelper.shared
    private let logger = AlfredLogger.auth

    enum BiometricType {
        case none
        case faceID
        case touchID

        var displayName: String {
            switch self {
            case .none: return "None"
            case .faceID: return "Face ID"
            case .touchID: return "Touch ID"
            }
        }

        var systemImage: String {
            switch self {
            case .none: return "lock.fill"
            case .faceID: return "faceid"
            case .touchID: return "touchid"
            }
        }
    }

    // MARK: - Init

    private init() {
        checkBiometricAvailability()
    }

    // MARK: - Token Management

    /// Store authentication token in Keychain
    func saveToken(_ token: String) {
        keychain.save(key: KeychainHelper.Keys.authToken, string: token)
        logger.info("Auth token saved to Keychain")
    }

    /// Retrieve authentication token from Keychain
    func getToken() -> String? {
        return keychain.loadString(key: KeychainHelper.Keys.authToken)
    }

    /// Store refresh token in Keychain
    func saveRefreshToken(_ token: String) {
        keychain.save(key: KeychainHelper.Keys.refreshToken, string: token)
        logger.info("Refresh token saved to Keychain")
    }

    /// Retrieve refresh token from Keychain
    func getRefreshToken() -> String? {
        return keychain.loadString(key: KeychainHelper.Keys.refreshToken)
    }

    /// Delete all tokens
    func clearTokens() {
        keychain.delete(key: KeychainHelper.Keys.authToken)
        keychain.delete(key: KeychainHelper.Keys.refreshToken)
        isAuthenticated = false
        logger.info("All tokens cleared")
    }

    /// Check if a valid token exists
    var hasToken: Bool {
        return getToken() != nil
    }

    // MARK: - Token Refresh

    /// Refresh the auth token using the refresh token
    func refreshToken() async throws -> String {
        guard let refreshToken = getRefreshToken() else {
            throw AuthError.noRefreshToken
        }

        guard let pairingInfo = PairingManager.shared.pairingInfo else {
            throw AuthError.notPaired
        }

        // TODO: Implement actual token refresh with Gateway
        // let url = URL(string: "http://\(pairingInfo.host):\(pairingInfo.port)/auth/refresh")!
        // var request = URLRequest(url: url)
        // request.httpMethod = "POST"
        // request.addValue("Bearer \(refreshToken)", forHTTPHeaderField: "Authorization")
        // let (data, response) = try await URLSession.shared.data(for: request)
        // guard let httpResponse = response as? HTTPURLResponse,
        //       httpResponse.statusCode == 200 else {
        //     throw AuthError.refreshFailed
        // }
        // let tokenResponse = try JSONDecoder().decode(TokenResponse.self, from: data)
        // saveToken(tokenResponse.accessToken)
        // return tokenResponse.accessToken

        logger.warning("Token refresh not yet implemented, returning existing token")
        return getToken() ?? ""
    }

    // MARK: - Biometric Authentication (FaceID / TouchID)

    /// Check what biometric authentication is available
    private func checkBiometricAvailability() {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            biometricType = .none
            logger.info("No biometric authentication available: \(error?.localizedDescription ?? "unknown")")
            return
        }

        switch context.biometryType {
        case .faceID:
            biometricType = .faceID
        case .touchID:
            biometricType = .touchID
        case .opticID:
            biometricType = .faceID // Treat opticID like faceID for now
        @unknown default:
            biometricType = .none
        }

        logger.info("Biometric type: \(biometricType.displayName)")
    }

    /// Authenticate using biometrics (FaceID/TouchID)
    /// - Returns: true if authentication succeeded
    func authenticateWithBiometrics(reason: String = "Authenticate to access Alfred") async -> Bool {
        let context = LAContext()
        context.localizedCancelTitle = "Cancel"

        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            logger.warning("Biometric auth unavailable: \(error?.localizedDescription ?? "unknown")")
            // Fall back to device passcode
            return await authenticateWithPasscode(reason: reason)
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            )
            await MainActor.run {
                self.isAuthenticated = success
            }
            logger.info("Biometric auth result: \(success)")
            return success
        } catch {
            logger.error("Biometric auth failed: \(error.localizedDescription)")
            return false
        }
    }

    /// Fall back to device passcode authentication
    func authenticateWithPasscode(reason: String = "Enter passcode to access Alfred") async -> Bool {
        let context = LAContext()

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: reason
            )
            await MainActor.run {
                self.isAuthenticated = success
            }
            return success
        } catch {
            logger.error("Passcode auth failed: \(error.localizedDescription)")
            return false
        }
    }
}

// MARK: - Errors

enum AuthError: LocalizedError {
    case noRefreshToken
    case refreshFailed
    case notPaired
    case biometricFailed
    case tokenExpired

    var errorDescription: String? {
        switch self {
        case .noRefreshToken: return "No refresh token available"
        case .refreshFailed: return "Failed to refresh authentication token"
        case .notPaired: return "Not paired with a Gateway"
        case .biometricFailed: return "Biometric authentication failed"
        case .tokenExpired: return "Authentication token has expired"
        }
    }
}

import Foundation
import Security

/// Secure Keychain wrapper for storing sensitive data.
/// NEVER use UserDefaults for tokens, keys, or pairing data.
final class KeychainHelper {
    static let shared = KeychainHelper()

    private let serviceName = "com.alfred.v3"

    private init() {}

    // MARK: - Save

    /// Save data to Keychain for a given key
    @discardableResult
    func save(key: String, data: Data) -> Bool {
        // Delete existing item first to avoid duplicates
        delete(key: key)

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Save a string to Keychain
    @discardableResult
    func save(key: String, string: String) -> Bool {
        guard let data = string.data(using: .utf8) else { return false }
        return save(key: key, data: data)
    }

    /// Save a Codable object to Keychain
    @discardableResult
    func save<T: Encodable>(key: String, object: T) -> Bool {
        guard let data = try? JSONEncoder().encode(object) else { return false }
        return save(key: key, data: data)
    }

    // MARK: - Load

    /// Load data from Keychain for a given key
    func load(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    /// Load a string from Keychain
    func loadString(key: String) -> String? {
        guard let data = load(key: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Load a Codable object from Keychain
    func load<T: Decodable>(key: String, as type: T.Type) -> T? {
        guard let data = load(key: key) else { return nil }
        return try? JSONDecoder().decode(type, from: data)
    }

    // MARK: - Delete

    /// Delete an item from Keychain
    @discardableResult
    func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Delete all items for this service
    @discardableResult
    func deleteAll() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Exists

    /// Check if a key exists in Keychain
    func exists(key: String) -> Bool {
        return load(key: key) != nil
    }
}

// MARK: - Keychain Keys

extension KeychainHelper {
    enum Keys {
        static let authToken = "alfred.auth.token"
        static let refreshToken = "alfred.auth.refreshToken"
        static let pairingInfo = "alfred.pairing.info"
        static let deviceUUID = "alfred.device.uuid"
        static let syncKey = "alfred.sync.key"
    }
}

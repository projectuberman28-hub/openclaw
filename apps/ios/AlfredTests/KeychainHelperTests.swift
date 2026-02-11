import XCTest
@testable import Alfred

final class KeychainHelperTests: XCTestCase {

    private let keychain = KeychainHelper.shared
    private let testKey = "com.alfred.test.key"

    override func tearDown() {
        super.tearDown()
        // Clean up test keys
        keychain.delete(key: testKey)
        keychain.delete(key: "\(testKey).string")
        keychain.delete(key: "\(testKey).object")
    }

    // MARK: - Save & Load Data

    func testSaveAndLoadData() {
        let testData = "Hello, Keychain!".data(using: .utf8)!

        let saved = keychain.save(key: testKey, data: testData)
        XCTAssertTrue(saved, "Save should succeed")

        let loaded = keychain.load(key: testKey)
        XCTAssertNotNil(loaded, "Loaded data should not be nil")
        XCTAssertEqual(loaded, testData, "Loaded data should match saved data")
    }

    // MARK: - Save & Load String

    func testSaveAndLoadString() {
        let testString = "Alfred Test Value"
        let key = "\(testKey).string"

        let saved = keychain.save(key: key, string: testString)
        XCTAssertTrue(saved, "String save should succeed")

        let loaded = keychain.loadString(key: key)
        XCTAssertEqual(loaded, testString, "Loaded string should match saved string")
    }

    // MARK: - Save & Load Codable Object

    func testSaveAndLoadCodableObject() {
        let info = PairingInfo(
            host: "192.168.1.100",
            port: 3001,
            syncKey: "test-sync-key",
            tailscaleIP: "100.64.0.1",
            gatewayName: "test-gateway"
        )
        let key = "\(testKey).object"

        let saved = keychain.save(key: key, object: info)
        XCTAssertTrue(saved, "Object save should succeed")

        let loaded = keychain.load(key: key, as: PairingInfo.self)
        XCTAssertNotNil(loaded, "Loaded object should not be nil")
        XCTAssertEqual(loaded?.host, "192.168.1.100")
        XCTAssertEqual(loaded?.port, 3001)
        XCTAssertEqual(loaded?.syncKey, "test-sync-key")
        XCTAssertEqual(loaded?.tailscaleIP, "100.64.0.1")
        XCTAssertEqual(loaded?.gatewayName, "test-gateway")
    }

    // MARK: - Delete

    func testDelete() {
        let testData = "delete me".data(using: .utf8)!
        keychain.save(key: testKey, data: testData)

        XCTAssertNotNil(keychain.load(key: testKey), "Data should exist before delete")

        let deleted = keychain.delete(key: testKey)
        XCTAssertTrue(deleted, "Delete should succeed")

        XCTAssertNil(keychain.load(key: testKey), "Data should be nil after delete")
    }

    func testDeleteNonExistentKey() {
        let deleted = keychain.delete(key: "non.existent.key")
        // Should return true (errSecItemNotFound is acceptable)
        XCTAssertTrue(deleted, "Delete of non-existent key should succeed")
    }

    // MARK: - Exists

    func testExists() {
        XCTAssertFalse(keychain.exists(key: testKey), "Key should not exist initially")

        keychain.save(key: testKey, string: "value")
        XCTAssertTrue(keychain.exists(key: testKey), "Key should exist after save")

        keychain.delete(key: testKey)
        XCTAssertFalse(keychain.exists(key: testKey), "Key should not exist after delete")
    }

    // MARK: - Overwrite

    func testOverwrite() {
        keychain.save(key: testKey, string: "original")
        XCTAssertEqual(keychain.loadString(key: testKey), "original")

        keychain.save(key: testKey, string: "updated")
        XCTAssertEqual(keychain.loadString(key: testKey), "updated")
    }

    // MARK: - Empty Data

    func testSaveEmptyData() {
        let emptyData = Data()
        let saved = keychain.save(key: testKey, data: emptyData)
        XCTAssertTrue(saved, "Save empty data should succeed")

        let loaded = keychain.load(key: testKey)
        XCTAssertNotNil(loaded, "Loaded data should not be nil")
        XCTAssertEqual(loaded?.count, 0, "Loaded data should be empty")
    }

    // MARK: - Load Non-Existent Key

    func testLoadNonExistentKey() {
        let loaded = keychain.load(key: "definitely.does.not.exist")
        XCTAssertNil(loaded, "Loading non-existent key should return nil")
    }

    func testLoadStringNonExistentKey() {
        let loaded = keychain.loadString(key: "definitely.does.not.exist")
        XCTAssertNil(loaded, "Loading non-existent string key should return nil")
    }

    func testLoadObjectNonExistentKey() {
        let loaded = keychain.load(key: "definitely.does.not.exist", as: PairingInfo.self)
        XCTAssertNil(loaded, "Loading non-existent object key should return nil")
    }

    // MARK: - Keychain Keys Constants

    func testKeychainKeysExist() {
        XCTAssertFalse(KeychainHelper.Keys.authToken.isEmpty)
        XCTAssertFalse(KeychainHelper.Keys.refreshToken.isEmpty)
        XCTAssertFalse(KeychainHelper.Keys.pairingInfo.isEmpty)
        XCTAssertFalse(KeychainHelper.Keys.deviceUUID.isEmpty)
        XCTAssertFalse(KeychainHelper.Keys.syncKey.isEmpty)
    }

    func testKeychainKeysUnique() {
        let keys = [
            KeychainHelper.Keys.authToken,
            KeychainHelper.Keys.refreshToken,
            KeychainHelper.Keys.pairingInfo,
            KeychainHelper.Keys.deviceUUID,
            KeychainHelper.Keys.syncKey
        ]
        let uniqueKeys = Set(keys)
        XCTAssertEqual(keys.count, uniqueKeys.count, "All keychain keys should be unique")
    }

    // MARK: - Large Data

    func testSaveLargeData() {
        // Create 1MB of data
        let largeData = Data(repeating: 0xFF, count: 1_000_000)

        let saved = keychain.save(key: testKey, data: largeData)
        XCTAssertTrue(saved, "Save large data should succeed")

        let loaded = keychain.load(key: testKey)
        XCTAssertNotNil(loaded)
        XCTAssertEqual(loaded?.count, largeData.count, "Loaded large data size should match")
    }
}

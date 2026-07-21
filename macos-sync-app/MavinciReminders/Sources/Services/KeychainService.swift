import Foundation
import Security

// MARK: - Keychain Service

/// A service for securely storing and retrieving the CRM sync token
/// in the macOS Keychain using the Security framework.
final class KeychainService {
    static let shared = KeychainService()

    private let service = "com.mavinci.crm-reminders"
    private let account = "sync-token"

    private init() {}

    // MARK: - Public API

    /// Saves the sync token to the Keychain.
    /// If a token already exists, it will be updated.
    /// - Parameter token: The token string to store.
    /// - Returns: `true` if the save succeeded, `false` otherwise.
    @discardableResult
    func save(token: String) -> Bool {
        guard let data = token.data(using: .utf8) else { return false }

        // Attempt to update an existing item first.
        let updateQuery = baseQuery()
        let attributes: [String: Any] = [kSecValueData as String: data]

        let updateStatus = SecItemUpdate(updateQuery as CFDictionary, attributes as CFDictionary)

        if updateStatus == errSecSuccess {
            return true
        }

        if updateStatus == errSecItemNotFound {
            // Item doesn't exist yet — add it.
            var addQuery = baseQuery()
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            return addStatus == errSecSuccess
        }

        print("[KeychainService] Failed to save token. OSStatus: \(updateStatus)")
        return false
    }

    /// Loads the sync token from the Keychain.
    /// - Returns: The stored token string, or `nil` if not found.
    func loadToken() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = kCFBooleanTrue!
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else {
            if status != errSecItemNotFound {
                print("[KeychainService] Failed to load token. OSStatus: \(status)")
            }
            return nil
        }

        return String(data: data, encoding: .utf8)
    }

    /// Deletes the sync token from the Keychain.
    /// - Returns: `true` if deletion succeeded or the item did not exist, `false` otherwise.
    @discardableResult
    func deleteToken() -> Bool {
        let query = baseQuery()
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Private Helpers

    private func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

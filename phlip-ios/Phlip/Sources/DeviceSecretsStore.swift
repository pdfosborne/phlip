import Foundation
import Security

/// Device-bound Keychain store for identity secrets (`putDeviceSecret` / `getDeviceSecret`).
final class DeviceSecretsStore {
    private let service = "app.phlip.deviceSecrets"

    func get(alias: String) -> String? {
        let key = sanitize(alias)
        guard !key.isEmpty else { return nil }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    func put(alias: String, value: String) -> Bool {
        let key = sanitize(alias)
        guard !key.isEmpty, value.utf8.count <= 16_384 else { return false }
        guard let data = value.data(using: .utf8) else { return false }
        remove(alias: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    func remove(alias: String) {
        let key = sanitize(alias)
        guard !key.isEmpty else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func sanitize(_ alias: String) -> String {
        let filtered = alias.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
        return String(filtered.prefix(64))
    }
}

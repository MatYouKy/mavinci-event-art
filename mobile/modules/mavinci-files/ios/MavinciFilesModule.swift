import ExpoModulesCore
import FileProvider
import Foundation

// MARK: „Mavinci” w aplikacji Pliki — strona aplikacji (iPhone, iPad)
//
// Rozszerzenie File Provider (`ios/MavinciFiles`, kod z `desktop/mac/Sources/MavinciFileProvider`) działa jako osobny proces,
// także przy zamkniętej aplikacji. Ten moduł zapisuje w grupie aplikacji `group.com.mavinci.crm` adresy serwera
// (`connection.json`) i osobną sesję rozszerzenia (`session.json`, z `/bridge/native/v1/device-session`) — w formacie
// `FinderShared` — oraz rejestruje domenę „Mavinci”, która pojawia się w aplikacji Pliki obok iCloud Drive. Wylogowanie
// unieważnia sesję rozszerzenia na serwerze i usuwa domenę (razem z pobranymi kopiami plików). Wymaga iOS 16.
// Stałe jak w `FinderShared` (gałąź iOS) — rozszerzenie czyta te same pliki.

private enum MavinciFilesStore {
  static let appGroup = "group.com.mavinci.crm"
  static let domainIdentifier = "pl.mavinci.files"
  static let domainName = "Mavinci"

  static var container: URL? {
    guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  static func read(_ name: String) -> Data? {
    guard let url = container?.appendingPathComponent(name) else { return nil }
    return try? Data(contentsOf: url)
  }

  static func write(_ name: String, _ data: Data) throws {
    guard let base = container else { throw MavinciFilesException("Aplikacja nie ma grupy aplikacji dla rozszerzenia Plików.") }
    let url = base.appendingPathComponent(name)
    try data.write(to: url, options: [.atomic])
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
  }

  static func remove(_ name: String) {
    guard let url = container?.appendingPathComponent(name) else { return }
    try? FileManager.default.removeItem(at: url)
  }

  static func object(_ name: String) -> [String: Any]? {
    guard let data = read(name) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  /// Ta sama blokada pliku co `FinderShared.RefreshLock`: rozszerzenie odświeża token pod nią (i usuwa unieważnioną sesję),
  /// więc aplikacja zmienia `session.json` też tylko pod nią — inaczej odświeżenie starej sesji mogłoby skasować nową.
  static func locked<T>(_ work: () async throws -> T) async rethrows -> T {
    guard let url = container?.appendingPathComponent("session.lock") else { return try await work() }
    let fd = open(url.path, O_CREAT | O_RDWR, 0o600)
    guard fd >= 0 else { return try await work() }
    await Task.detached { _ = flock(fd, LOCK_EX) }.value
    defer {
      flock(fd, LOCK_UN)
      close(fd)
    }
    return try await work()
  }

  @available(iOS 16.0, *)
  static var domain: NSFileProviderDomain {
    NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier(rawValue: domainIdentifier), displayName: domainName)
  }

  static func status() async -> MavinciFilesStatus {
    var status = MavinciFilesStatus()
    guard #available(iOS 16.0, *), container != nil else { return status }
    status.available = true
    status.userId = (object("session.json")?["user"] as? [String: Any])?["id"] as? String
    if let domains = try? await NSFileProviderManager.domains() {
      status.enabled = domains.contains { $0.identifier.rawValue == domainIdentifier }
    }
    return status
  }

  /// Adresy serwera i sesja rozszerzenia, rejestracja domeny. Poprzednia sesja rozszerzenia (inne konto, stara) — unieważniona.
  static func enable(connection: String, session: String) async throws {
    guard #available(iOS 16.0, *) else { throw MavinciFilesException("Mavinci w aplikacji Pliki wymaga iOS 16 lub nowszego.") }
    guard let connectionData = connection.data(using: .utf8),
          let link = (try? JSONSerialization.jsonObject(with: connectionData)) as? [String: Any],
          link["url"] is String, link["publicKey"] is String, link["crm"] is String else {
      throw MavinciFilesException("Nieprawidłowe adresy serwera dla aplikacji Pliki.")
    }
    guard let sessionData = session.data(using: .utf8),
          var fields = (try? JSONSerialization.jsonObject(with: sessionData)) as? [String: Any],
          fields["access_token"] is String, fields["refresh_token"] is String, fields["user"] is [String: Any] else {
      throw MavinciFilesException("Nieprawidłowa sesja dla aplikacji Pliki.")
    }
    if fields["issuedAt"] == nil { fields["issuedAt"] = Date().timeIntervalSince1970 }
    let normalized = try JSONSerialization.data(withJSONObject: fields)
    try await locked {
      await revokeStoredSession()
      try write("connection.json", connectionData)
      try write("session.json", normalized)
    }
    try await NSFileProviderManager.add(domain)
    signal(driveChanged: false)
  }

  /// Wylogowanie: sesja rozszerzenia unieważniona na serwerze, pliki sesji i domena usunięte.
  static func disable() async {
    await locked {
      await revokeStoredSession()
      remove("session.json")
    }
    remove("drive-changed.txt")
    guard #available(iOS 16.0, *) else { return }
    try? await NSFileProviderManager.remove(domain)
  }

  /// Prośba do aplikacji Pliki o sprawdzenie zmian; `driveChanged` — plik dodany w aplikacji do Dysku (rozszerzenie wczyta Dysk od nowa).
  static func signal(driveChanged: Bool) {
    if driveChanged { try? write("drive-changed.txt", Data(String(Date().timeIntervalSince1970).utf8)) }
    guard #available(iOS 16.0, *), container != nil else { return }
    NSFileProviderManager(for: domain)?.signalEnumerator(for: .workingSet) { _ in }
  }

  /// Sesja rozszerzenia wylogowana na serwerze (Supabase Auth, tylko ta sesja) — bez błędów, gdy nie ma sieci albo sesji.
  /// Wywoływać pod `locked`.
  static func revokeStoredSession() async {
    guard let link = object("connection.json"), let base = link["url"] as? String, let key = link["publicKey"] as? String,
          let stored = object("session.json"), var token = stored["access_token"] as? String else { return }
    let root = base.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let expiresAt = (stored["expires_at"] as? Double) ?? 0
    if expiresAt < Date().timeIntervalSince1970 + 30 {
      // Token dostępu wygasł — świeży tylko po to, żeby zakończyć sesję.
      guard let refresh = stored["refresh_token"] as? String,
            let renewed = await post(root + "/auth/v1/token?grant_type=refresh_token", key: key, token: nil, body: ["refresh_token": refresh]),
            let fields = (try? JSONSerialization.jsonObject(with: renewed)) as? [String: Any],
            let access = fields["access_token"] as? String else { return }
      token = access
    }
    _ = await post(root + "/auth/v1/logout?scope=local", key: key, token: token, body: [:])
  }

  static func post(_ address: String, key: String, token: String?, body: [String: Any]) async -> Data? {
    guard let url = URL(string: address) else { return nil }
    var request = URLRequest(url: url, timeoutInterval: 15)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue(key, forHTTPHeaderField: "apikey")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    guard let result = try? await URLSession.shared.data(for: request),
          let http = result.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
    return result.0
  }
}

/// Stan „Mavinci” w Plikach: `available` — iOS 16 i grupa aplikacji (nowa wersja aplikacji), `enabled` — domena
/// zarejestrowana, `userId` — konto zapisanej sesji rozszerzenia (brak — sesji nie ma albo została unieważniona).
struct MavinciFilesStatus: Record {
  @Field var available: Bool = false
  @Field var enabled: Bool = false
  @Field var userId: String? = nil
}

final class MavinciFilesException: Exception {
  private let message: String
  init(_ message: String) {
    self.message = message
    super.init()
  }
  override var reason: String { message }
}

public class MavinciFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MavinciFiles")

    AsyncFunction("status") { () async -> MavinciFilesStatus in
      await MavinciFilesStore.status()
    }

    AsyncFunction("enable") { (connection: String, session: String) async throws in
      try await MavinciFilesStore.enable(connection: connection, session: session)
    }

    AsyncFunction("disable") { () async in
      await MavinciFilesStore.disable()
    }

    AsyncFunction("signal") { (driveChanged: Bool) in
      MavinciFilesStore.signal(driveChanged: driveChanged)
    }
  }
}

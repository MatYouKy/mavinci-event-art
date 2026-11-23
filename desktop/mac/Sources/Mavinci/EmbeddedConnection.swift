import Foundation

// MARK: Połączenie wbudowane w program
//
// `scripts/build-app.sh` (także `yarn dmg`) wbudowuje w program połączenie z `Resources/Configuration.json` (poza gitem — tworzy go
// `scripts/import-env.cjs`): źródło danych, adres serwera, publiczny klucz aplikacji i adres CRM. `scripts/embed-connection.cjs`
// zapisuje je do `EmbeddedConnection.generated.swift` (poza gitem, kompilowany z flagą MAVINCI_EMBEDDED_CONNECTION) jako bajty
// zamaskowane losowym kluczem — w pakiecie nie ma już pliku konfiguracji, a wartości nie są czytelnym tekstem w programie.
//
// Zainstalowana aplikacja (kompilacja release) łączy się wyłącznie z tym połączeniem: nie ma zakładki „Połączenie”, a dawne
// połączenie zapisane w pęku kluczy jest usuwane (`Connection.load`). Kompilacja deweloperska (Mavinci-Dev) ma dalej zakładkę
// „Połączenie” do testów z innym serwerem. Klucz publiczny (anon/publishable) jest z natury jawny dla aplikacji — dostęp do
// danych chronią logowanie pracownika i uprawnienia w bazie; maskowanie tylko nie wystawia go na widok.

#if !MAVINCI_EMBEDDED_CONNECTION
/// Kompilacja bez wbudowanego połączenia (np. `swift build` bez `scripts/build-app.sh`).
enum EmbeddedConnectionData {
    static let payload: [UInt8] = []
    static let mask: [UInt8] = []
}
#endif

extension Connection {
    /// Połączenie wbudowane w program; `nil` — kompilacja bez niego albo dane niepoprawne.
    static let embedded: Connection? = {
        let payload = EmbeddedConnectionData.payload
        let mask = EmbeddedConnectionData.mask
        guard !payload.isEmpty, payload.count == mask.count else { return nil }
        let bytes = zip(payload, mask).map { $0 ^ $1 }
        guard let connection = try? JSONDecoder().decode(Connection.self, from: Data(bytes)), connection.valid else { return nil }
        return connection
    }()
}

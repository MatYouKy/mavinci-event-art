import Foundation
import SwiftUI
import WidgetKit

// MARK: Wspólne dla widżetów Mavinci — Mac (pulpit, Centrum powiadomień) oraz iPhone i iPad (ekran główny, ekran blokady)
//
// Ten sam kod buduje rozszerzenie `MavinciWidgets.appex` na Macu (`desktop/mac/scripts/build-app.sh`) i na iPhonie / iPadzie
// (`mobile/plugins/withMavinciWidgets.js` — cel `MavinciWidgets`, iOS 17). Różnice w `#if os(iOS)`: adres aplikacji
// (`mavinci://…` na Macu, `mavinci-crm://…` na telefonie), rodziny widżetów (na telefonie także ekran blokady) i częstotliwość
// odświeżania. Dane: serwer CRM z tokenem ze wspólnej sesji (`FinderShared` — kontener grupy aplikacji; odświeżanie tokenu pod
// wspólną blokadą z aplikacją i rozszerzeniem Findera / Plików). Ostatnia odpowiedź zostaje w kontenerze (tylko dla tego samego
// konta) — bez internetu widżet pokazuje ją z dopiskiem „bez połączenia”.

enum WidgetState: String, Codable, Equatable {
    case ready
    /// Bez połączenia — dane z kopii (albo brak danych).
    case offline
    /// Brak zalogowania w aplikacji (albo sesja wygasła).
    case signedOut
}

enum WidgetPlatform {
    #if os(iOS)
    static let scheme = "mavinci-crm"
    static let userAgent = "MavinciPhone/1.0 (Widget)"
    /// Co ile pobierać dane (system i tak rozkłada odświeżenia według budżetu widżetu; aplikacja prosi o nie po zmianach).
    static let refresh: TimeInterval = 30 * 60
    static let families: [WidgetFamily] = [
        .systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryRectangular, .accessoryInline,
    ]
    static let signedOutText = "Otwórz aplikację Mavinci i zaloguj się — widżet użyje tego samego konta."
    #else
    static let scheme = "mavinci"
    static let userAgent = "MavinciDesktop/0.1 (Widget)"
    static let refresh: TimeInterval = 15 * 60
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
    static let signedOutText = "Zaloguj się w aplikacji Mavinci, żeby zobaczyć swoje dane."
    #endif
    /// Bez połączenia albo bez logowania — kolejna próba szybciej.
    static let retry: TimeInterval = 5 * 60

    /// Adres w aplikacji: `mavinci://task/<id>`, `mavinci://calendar` (na telefonie `mavinci-crm://…`).
    static func link(_ host: String, _ id: String? = nil) -> URL? {
        URL(string: "\(scheme)://\(host)" + (id.map { "/\($0)" } ?? ""))
    }
}

// MARK: Dane z serwera CRM

enum WidgetAPI {
    private enum Failure: Error { case signedOut, offline }

    private struct Cache<Reply: Codable>: Codable {
        let owner: String
        let savedAt: Date
        let reply: Reply
    }

    struct Loaded<Reply> {
        let reply: Reply?
        let state: WidgetState
        /// Kiedy pobrano dane z serwera (kopia — czas jej zapisu).
        let updatedAt: Date?
    }

    /// Odpowiedź serwera (z zapisem kopii w kontenerze), a bez połączenia — ostatnia kopia tego samego konta.
    static func load<Reply: Codable>(_ path: String, cache: String) async -> Loaded<Reply> {
        do {
            let reply: Reply = try await fetch(path)
            if let owner = FinderShared.owner(), let data = try? JSONEncoder().encode(Cache(owner: owner, savedAt: Date(), reply: reply)) {
                FinderShared.write(cache, data)
            }
            return Loaded(reply: reply, state: .ready, updatedAt: Date())
        } catch Failure.signedOut {
            FinderShared.remove(cache)
            return Loaded(reply: nil, state: .signedOut, updatedAt: nil)
        } catch {
            if let data = FinderShared.read(cache), let saved = try? JSONDecoder().decode(Cache<Reply>.self, from: data),
               saved.owner == FinderShared.owner() {
                return Loaded(reply: saved.reply, state: .offline, updatedAt: saved.savedAt)
            }
            return Loaded(reply: nil, state: .offline, updatedAt: nil)
        }
    }

    private static func fetch<Reply: Decodable>(_ path: String) async throws -> Reply {
        guard let connection = FinderShared.connection(), FinderShared.session() != nil else { throw Failure.signedOut }
        let base = connection.crm.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + path) else { throw Failure.offline }
        let token: String
        do { token = try await FinderShared.validAccessToken() } catch FinderShared.Failure.signedOut { throw Failure.signedOut } catch { throw Failure.offline }
        var request = URLRequest(url: url, timeoutInterval: 25)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(FinderShared.client, forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue(WidgetPlatform.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) } catch { throw Failure.offline }
        guard let http = response as? HTTPURLResponse else { throw Failure.offline }
        if http.statusCode == 401 { throw Failure.signedOut }
        guard (200..<300).contains(http.statusCode), let reply = try? JSONDecoder().decode(Reply.self, from: data) else {
            NSLog("[Mavinci Widget] %@ → HTTP %d", path, http.statusCode)
            throw Failure.offline
        }
        return reply
    }
}

// MARK: Czas polski

enum WidgetTime {
    static let zone = TimeZone(identifier: "Europe/Warsaw") ?? .current
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian); c.timeZone = zone; c.locale = Locale(identifier: "pl_PL"); return c
    }()
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain = ISO8601DateFormatter()
    private static func formatter(_ format: String) -> DateFormatter {
        let f = DateFormatter(); f.locale = Locale(identifier: "pl_PL"); f.timeZone = zone; f.dateFormat = format; return f
    }
    static let clock = formatter("HH:mm")
    /// „pon. 23.11”
    static let shortDay = formatter("EEE d.MM")
    /// „środa, 26.11”
    static let longDay = formatter("EEEE, d.MM")

    static func parse(_ value: String) -> Date? {
        let normalized = value.replacingOccurrences(of: " ", with: "T")
        return fractional.date(from: normalized) ?? plain.date(from: normalized)
    }

    /// „Dziś”, „Jutro”, „Wczoraj” albo „śr. 26.11”.
    static func day(_ date: Date, now: Date) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Dziś" }
        if let next = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: next) { return "Jutro" }
        if let previous = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: previous) { return "Wczoraj" }
        return shortDay.string(from: date)
    }

    /// Nagłówek dnia w terminarzu: „Dziś · pon. 23.11”, „Jutro · wt. 24.11”, „środa, 26.11”.
    static func dayTitle(_ date: Date, now: Date) -> String {
        if calendar.isDate(date, inSameDayAs: now) { return "Dziś · " + shortDay.string(from: date) }
        if let next = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(date, inSameDayAs: next) {
            return "Jutro · " + shortDay.string(from: date)
        }
        return longDay.string(from: date)
    }
}

// MARK: Wygląd — kolory CRM: złoto marki na granatowym tle

enum WidgetPalette {
    static let gold = Color(red: 0xd3 / 255, green: 0xbb / 255, blue: 0x73 / 255)
    static let ink = Color(red: 0xe5 / 255, green: 0xe4 / 255, blue: 0xe2 / 255)
    static let top = Color(red: 0x1c / 255, green: 0x1f / 255, blue: 0x33 / 255)
    static let bottom = Color(red: 0x0f / 255, green: 0x11 / 255, blue: 0x19 / 255)
    static let overdue = Color(red: 0xf8 / 255, green: 0x71 / 255, blue: 0x71 / 255)

    static func priority(_ value: String) -> Color {
        switch value {
        case "urgent": return Color(red: 0xef / 255, green: 0x44 / 255, blue: 0x44 / 255)
        case "high": return Color(red: 0xfb / 255, green: 0x92 / 255, blue: 0x3c / 255)
        case "low": return Color(red: 0x9c / 255, green: 0xa3 / 255, blue: 0xaf / 255)
        default: return Color(red: 0x60 / 255, green: 0xa5 / 255, blue: 0xfa / 255)
        }
    }

    /// Kolor z CRM (`#rgb`, `#rrggbb`, `#rrggbbaa`); inny zapis — `fallback`.
    static func hex(_ value: String?, fallback: Color = gold) -> Color {
        guard var digits = value?.trimmingCharacters(in: .whitespaces), digits.hasPrefix("#") else { return fallback }
        digits.removeFirst()
        if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
        guard digits.count == 6 || digits.count == 8, let number = UInt64(digits, radix: 16) else { return fallback }
        let rgb = digits.count == 8 ? number >> 8 : number
        let alpha = digits.count == 8 ? Double(number & 0xff) / 255 : 1
        return Color(red: Double((rgb >> 16) & 0xff) / 255, green: Double((rgb >> 8) & 0xff) / 255, blue: Double(rgb & 0xff) / 255)
            .opacity(alpha)
    }
}

extension View {
    /// Tło widżetów Mavinci (granatowy gradient jak pasek boczny CRM; na ekranie blokady system je pomija).
    func mavinciWidgetBackground() -> some View {
        containerBackground(for: .widget) {
            LinearGradient(colors: [WidgetPalette.top, WidgetPalette.bottom], startPoint: .top, endPoint: .bottom)
        }
    }
}

/// Nagłówek widżetu: ikona, tytuł wersalikami (jak nagłówki CRM) i dopisek po prawej.
struct WidgetHeader: View {
    let icon: String
    let title: String
    var trailing: String?

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11, weight: .semibold))
            Text(title.uppercased()).font(.system(size: 11, weight: .regular)).kerning(0.8).lineLimit(1)
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing).font(.system(size: 11, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(WidgetPalette.ink.opacity(0.7)).lineLimit(1)
            }
        }
        .foregroundStyle(WidgetPalette.gold)
        .widgetAccentable()
    }
}

/// Komunikat zamiast danych (np. brak logowania).
struct WidgetMessage: View {
    let header: WidgetHeader
    let icon: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            Spacer(minLength: 0)
            Image(systemName: icon).font(.system(size: 20)).foregroundStyle(WidgetPalette.gold)
            Text(text).font(.system(size: 11.5)).foregroundStyle(WidgetPalette.ink.opacity(0.8)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Stopka: „Bez połączenia · dane z 10:15” albo (duże rozmiary) „Zaktualizowano 10:15”.
struct WidgetFooter: View {
    let state: WidgetState
    let updatedAt: Date?
    let showUpdated: Bool

    var body: some View {
        if state == .offline {
            Text(updatedAt.map { "Bez połączenia · dane z \(WidgetTime.clock.string(from: $0))" } ?? "Bez połączenia")
                .font(.system(size: 9.5)).foregroundStyle(WidgetPalette.ink.opacity(0.45))
        } else if showUpdated, let updatedAt {
            Text("Zaktualizowano \(WidgetTime.clock.string(from: updatedAt))").font(.system(size: 9.5))
                .foregroundStyle(WidgetPalette.ink.opacity(0.4))
        }
    }
}

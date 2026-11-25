import SwiftUI
import Charts

// MARK: Social media → Statystyki → „Zainteresowanie marką” — 1:1 z CRM (`SocialBrandInterest.tsx`): wyszukiwania nazwy marki
// w Google (Search Console), wejścia na stronę Facebook i na profil Instagram — suma okresu wobec poprzedniego, dzień po dniu,
// frazy, którymi szukano marki w Google, i stan pobrania kanałów. Wyłącznie liczby — Google i Meta nie podają, kto szukał ani kto
// odwiedził profil. „Frazy marki” — zarządzający marketingiem albo akceptujący social media marki; „Odśwież” — każdy z dostępem.

enum SocialBrandChannel: String, CaseIterable, Identifiable {
    case google, facebook, instagram

    var id: String { rawValue }

    var label: String {
        switch self {
        case .google: return "Wyszukiwania nazwy w Google"
        case .facebook: return "Wejścia na stronę Facebook"
        case .instagram: return "Wejścia na profil Instagram"
        }
    }

    var shortLabel: String {
        switch self {
        case .google: return "Google"
        case .facebook: return "Facebook"
        case .instagram: return "Instagram"
        }
    }

    var hint: String {
        switch self {
        case .google:
            return "Ile razy nasza strona pokazała się w Google na frazy z nazwą marki — praktycznie tyle, ile razy ktoś wpisał naszą nazwę. Google podaje dane z 1–3-dniowym opóźnieniem i pomija bardzo rzadkie frazy."
        case .facebook:
            return "Ile razy ktoś otworzył stronę marki na Facebooku (zalogowani i niezalogowani). Meta nie podaje, kto to był."
        case .instagram:
            return "Ile razy ktoś wszedł na profil marki na Instagramie. Meta nie podaje, kto to był."
        }
    }

    /// Kolory serii wykresu — paleta wykresów CRM (`SOCIAL_BRAND_COLORS`).
    var color: Color {
        switch self {
        case .google: return CrmTheme.rgb(0xd3bb73)
        case .facebook: return CrmTheme.rgb(0x93c5fd)
        case .instagram: return CrmTheme.rgb(0xfda4af)
        }
    }
}

struct SocialBrandChannelState: Codable {
    var status: String
    var message: String?
    var syncedAt: String?
    var checkedAt: String?

    var statusLabel: String {
        switch status {
        case "ok": return "Pobrane"
        case "pending": return "Czeka na pobranie"
        case "unavailable": return "Niedostępne"
        case "error": return "Błąd pobrania"
        case "not_connected": return "Niepołączone"
        default: return status
        }
    }
}

/// `nil` — kanał bez danych (niepołączony albo Meta / Google nie podaje), 0 — dane są, ale zero.
struct SocialBrandValues: Codable {
    var google: Double?
    var googleClicks: Double?
    var facebook: Double?
    var instagram: Double?

    func value(_ channel: SocialBrandChannel) -> Double? {
        switch channel {
        case .google: return google
        case .facebook: return facebook
        case .instagram: return instagram
        }
    }
}

struct SocialBrandDay: Codable, Identifiable {
    var date: String
    var google: Double?
    var googleClicks: Double?
    var facebook: Double?
    var instagram: Double?

    var id: String { date }

    func value(_ channel: SocialBrandChannel) -> Double? {
        switch channel {
        case .google: return google
        case .facebook: return facebook
        case .instagram: return instagram
        }
    }
}

struct SocialBrandQuery: Codable, Identifiable {
    var query: String
    var searches: Double
    var clicks: Double

    var id: String { query }
}

struct SocialBrandRange: Codable {
    var from: String
    var to: String
    var previousFrom: String
    var previousTo: String
}

/// `op=stats` → `brand` (`nil` przed migracją bazy — karta ukryta).
struct SocialBrandInterest: Codable {
    var terms: [String]
    var defaultTerms: Bool
    var canEditTerms: Bool
    var canRefresh: Bool
    var range: SocialBrandRange
    var totals: SocialBrandValues
    var previous: SocialBrandValues
    var days: [SocialBrandDay]
    var queries: [SocialBrandQuery]
    var channels: [String: SocialBrandChannelState]
    /// Instagram: wejścia na profil konta (`account`) albo z postów opublikowanych z CRM (`posts`).
    var instagramSource: String?

    func state(_ channel: SocialBrandChannel) -> SocialBrandChannelState {
        channels[channel.rawValue] ?? SocialBrandChannelState(status: "pending", message: nil, syncedAt: nil, checkedAt: nil)
    }
}

/// Frazy marki z pola tekstowego — te same reguły co w CRM (`socialBrandTermsFromText`) i w bazie.
enum SocialBrandTerms {
    static let maxCount = 10
    static let minLength = 2
    static let maxLength = 60
    private static let pattern = "^[a-z0-9à-öø-ÿąćęłńśźż][a-z0-9à-öø-ÿąćęłńśźż &.'+-]*$"

    static func normalize(_ value: String) -> String {
        value.precomposedStringWithCanonicalMapping.lowercased()
            .replacingOccurrences(of: "’", with: "'")
            .replacingOccurrences(of: "[\\s\\u00a0]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    static func parse(_ text: String) -> (terms: [String], error: String?) {
        var terms: [String] = []
        for part in text.components(separatedBy: CharacterSet(charactersIn: "\n,;")) {
            let term = normalize(part)
            if term.isEmpty { continue }
            if term.count < minLength || term.count > maxLength {
                return (terms, "Fraza „\(term.prefix(40))” musi mieć od \(minLength) do \(maxLength) znaków.")
            }
            if term.range(of: pattern, options: .regularExpression) == nil {
                return (terms, "Fraza „\(term.prefix(40))” może zawierać tylko litery, cyfry, spacje i znaki & . ' + -.")
            }
            if !terms.contains(term) { terms.append(term) }
        }
        if terms.count > maxCount { return (terms, "Najwyżej \(maxCount) fraz.") }
        return (terms, nil)
    }
}

// MARK: Karta

struct SocialBrandInterestCard: View {
    let brand: SocialBrandInterest
    let days: Int
    let onRefresh: () -> Void
    let onSaveTerms: ([String]) async -> Bool
    @Environment(\.crmTheme) private var theme
    @State private var editingTerms = false

    private static let calendar = Calendar(identifier: .gregorian)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 10)], spacing: 10) {
                ForEach(SocialBrandChannel.allCases) { channel in tile(channel) }
            }
            problems
            chart
            HStack(alignment: .top, spacing: 18) {
                queriesList.frame(maxWidth: .infinity, alignment: .topLeading)
                termsInfo.frame(maxWidth: .infinity, alignment: .topLeading)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
        .sheet(isPresented: $editingTerms) {
            SocialBrandTermsSheet(brand: brand, onSave: onSaveTerms)
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Label("Zainteresowanie marką", systemImage: "magnifyingglass").font(.headline)
            Text("Ostatnie \(days) dni wobec \(days) dni wcześniej").font(.caption).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            if brand.canEditTerms {
                Button { editingTerms = true } label: { Label("Frazy marki", systemImage: "tag") }
            }
            if brand.canRefresh {
                Button(action: onRefresh) { Label("Odśwież", systemImage: "arrow.clockwise") }
            }
        }
    }

    private func changeLabel(_ current: Double?, _ previous: Double?) -> some View {
        let label = SocialNumbers.change(current, previous)
        let color: Color = label == nil || label == "0%" ? .secondary : (label?.hasPrefix("−") == true ? .red : .green)
        let symbol = label?.hasPrefix("−") == true ? "arrow.down.right" : "arrow.up.right"
        return Group {
            if let label {
                Label(label, systemImage: symbol).font(.caption).foregroundStyle(color).help("Wobec poprzedniego okresu")
            }
        }
    }

    private func note(_ channel: SocialBrandChannel) -> String? {
        if channel == .google, let clicks = brand.totals.googleClicks {
            return "Kliknięcia w wynikach: \(SocialNumbers.number(clicks))"
        }
        if channel == .instagram, brand.instagramSource == "posts" {
            return "Wejścia na profil z postów opublikowanych z CRM — Meta nie podaje wejść na profil całego konta."
        }
        return brand.totals.value(channel) == nil ? brand.state(channel).statusLabel : nil
    }

    private func tile(_ channel: SocialBrandChannel) -> some View {
        let value = brand.totals.value(channel)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(channel.color).frame(width: 8, height: 8)
                Text(channel.label).font(.caption).foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(SocialNumbers.number(value)).font(.title2.weight(.light)).monospacedDigit()
                changeLabel(value, brand.previous.value(channel))
            }
            if let note = note(channel) {
                Text(note).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
        .help(channel.hint)
    }

    @ViewBuilder private var problems: some View {
        let items = SocialBrandChannel.allCases.filter { brand.state($0).status != "ok" && !(brand.state($0).message ?? "").isEmpty }
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(items) { channel in
                    let state = brand.state(channel)
                    HStack(alignment: .top, spacing: 6) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(state.status == "error" ? Color.red : Color.orange)
                        Text("\(channel.shortLabel) — \(state.statusLabel): \(state.message ?? "")")
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .font(.caption)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(Color.orange.opacity(0.08)))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.orange.opacity(0.3)))
        }
    }

    /// „RRRR-MM-DD” → południe tego dnia (oś wykresu w kalendarzu użytkownika).
    private static func day(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(timeZone: TimeZone.current, year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    private var series: [SocialBrandChannel] {
        SocialBrandChannel.allCases.filter { channel in brand.days.contains { $0.value(channel) != nil } }
    }

    @ViewBuilder private var chart: some View {
        let visible = series
        if visible.isEmpty {
            Text("Brak danych w tym okresie — pojawią się po pobraniu z Google i Meta.")
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 120)
                .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.04)))
        } else {
            Chart {
                ForEach(visible) { channel in
                    ForEach(brand.days) { item in
                        if let value = item.value(channel), let date = Self.day(item.date) {
                            LineMark(x: .value("Dzień", date, unit: .day), y: .value("Liczba", value))
                                .foregroundStyle(by: .value("Kanał", channel.shortLabel))
                                .interpolationMethod(.linear)
                            PointMark(x: .value("Dzień", date, unit: .day), y: .value("Liczba", value))
                                .foregroundStyle(by: .value("Kanał", channel.shortLabel))
                                .symbolSize(days > 40 ? 8 : 20)
                        }
                    }
                }
            }
            .chartForegroundStyleScale(domain: visible.map(\.shortLabel), range: visible.map(\.color))
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 7)) { _ in
                    AxisGridLine()
                    AxisValueLabel(format: .dateTime.day(.twoDigits).month(.twoDigits))
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisValueLabel { if let number = value.as(Double.self) { Text(SocialNumbers.number(number)) } }
                }
            }
            .chartLegend(visible.count > 1 ? .visible : .hidden)
            .frame(height: 220)
            .accessibilityLabel("Zainteresowanie marką dzień po dniu")
        }
    }

    private var queriesList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("JAK NAS SZUKAJĄ W GOOGLE").font(.caption).foregroundStyle(.secondary)
            if brand.queries.isEmpty {
                Text(brand.state(.google).status == "not_connected"
                     ? (brand.state(.google).message ?? "")
                     : "Brak fraz z nazwą marki w tym okresie.")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            } else {
                ForEach(Array(brand.queries.enumerated()), id: \.element.id) { entry in
                    HStack(spacing: 8) {
                        Text("\(entry.offset + 1).").foregroundStyle(theme.accent).frame(width: 22, alignment: .leading)
                        Text(entry.element.query).lineLimit(1).truncationMode(.tail).help(entry.element.query)
                        Spacer(minLength: 6)
                        Text(SocialNumbers.number(entry.element.searches)).monospacedDigit()
                            .help("Wyszukiwania (wyświetlenia strony w wynikach)")
                        Text("\(SocialNumbers.number(entry.element.clicks)) klik.").font(.caption).foregroundStyle(.secondary)
                            .monospacedDigit().frame(width: 76, alignment: .trailing)
                            .help("Kliknięcia w wynikach")
                    }
                    .font(.callout)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                }
            }
        }
    }

    private var termsInfo: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("LICZONE FRAZY").font(.caption).foregroundStyle(.secondary)
            if brand.terms.isEmpty {
                Text("Brak fraz.").font(.caption).foregroundStyle(.secondary)
            } else {
                Text(brand.terms.joined(separator: " · ")).font(.callout).foregroundStyle(theme.accent)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(termsNote).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Label("Google i Meta nie podają, kto szukał marki ani kto odwiedził profil — tylko liczby. Nazwiska widać wyłącznie przy osobach, które same zareagowały: komentarze, wiadomości, obserwacje.", systemImage: "info.circle")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 2) {
                ForEach(SocialBrandChannel.allCases) { channel in Text(stateLine(channel)) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func stateLine(_ channel: SocialBrandChannel) -> String {
        let state = brand.state(channel)
        var line = "\(channel.shortLabel): \(state.statusLabel)"
        if let synced = state.syncedAt { line += " · pobrano " + SocialDates.dateTime(synced) }
        return line
    }

    private var termsNote: String {
        var text = brand.defaultTerms ? "Frazy domyślne — z nazwy i adresu strony marki. " : ""
        text += "Google liczy każdą frazę zawierającą jedną z nich (np. „\(brand.terms.first ?? "nazwa") opinie”)."
        text += brand.canEditTerms
            ? " Zmienisz je przyciskiem „Frazy marki”."
            : " Frazy zmienia osoba zarządzająca marketingiem albo akceptująca social media."
        return text
    }
}

// MARK: Arkusz „Frazy marki”

struct SocialBrandTermsSheet: View {
    let brand: SocialBrandInterest
    let onSave: ([String]) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var text: String
    @State private var saving = false

    init(brand: SocialBrandInterest, onSave: @escaping ([String]) async -> Bool) {
        self.brand = brand
        self.onSave = onSave
        _text = State(initialValue: brand.defaultTerms ? "" : brand.terms.joined(separator: "\n"))
    }

    var body: some View {
        let parsed = SocialBrandTerms.parse(text)
        VStack(alignment: .leading, spacing: 12) {
            Text("Frazy marki").font(.title3)
            Text("Wyszukiwania w Google liczymy dla fraz zawierających jedną z poniższych — każda w osobnym wierszu, od \(SocialBrandTerms.minLength) do \(SocialBrandTerms.maxLength) znaków, najwyżej \(SocialBrandTerms.maxCount). Wielkość liter nie ma znaczenia, a spacja i łącznik między słowami są opcjonalne („event rulers” obejmuje też „eventrulers”).")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            TextEditor(text: $text)
                .font(.body)
                .frame(minHeight: 130)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.3)))
                .accessibilityLabel("Frazy marki")
            if brand.defaultTerms {
                Text("Teraz liczone są frazy domyślne: \(brand.terms.isEmpty ? "brak" : brand.terms.joined(separator: ", ")) (z nazwy i adresu strony marki).")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let error = parsed.error {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            Text("Po zapisaniu wyniki Google z 90 dni pobiorą się od nowa dla nowych fraz.").font(.caption).foregroundStyle(.secondary)
            HStack {
                if !brand.defaultTerms {
                    Button("Przywróć domyślne") { save([]) }.disabled(saving)
                }
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz frazy") { save(parsed.terms) }
                    .keyboardShortcut(.defaultAction)
                    .buttonStyle(.borderedProminent)
                    .disabled(parsed.error != nil || parsed.terms.isEmpty || saving)
            }
        }
        .padding(20)
        .frame(width: 500)
    }

    private func save(_ terms: [String]) {
        saving = true
        Task {
            let ok = await onSave(terms)
            saving = false
            if ok { dismiss() }
        }
    }
}

import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: „Pokaż portal hotelowi” — tryb pokazowy portalu sprzedawcy 1:1 z `/crm/salespeople/demo` (`HotelPortalDemo`):
// przygotowanie pokazu (`DemoSetup`: marka, hotel, logo z dysku — tylko w aplikacji, kolor akcentu, widoczność wynagrodzenia,
// opiekun) i pokaz (`DemoPresentation`: Pulpit, Kreator oferty, Oferta dla klienta, Wynagrodzenie, Jak to działa —
// `SellerDemoScreens.swift`). Dane tylko do odczytu z `/bridge/native/v1/sellers?op=demo` (`src/lib/native/sellerDemo.ts`);
// pokaz niczego nie zapisuje ani nie wysyła. Obliczenia i teksty jak `demoData.ts`.

/// Otwarcie trybu pokazowego (z kokpitu, karty organizacji albo kontaktu) — jak parametry adresu `/crm/salespeople/demo`.
struct SellerDemoRequest: Equatable {
    let id = UUID()
    var organization: String? = nil
    var contact: String? = nil
    var hotel: String? = nil
}

struct SellerDemoData: Decodable {
    struct Presenter: Decodable { let name: String; let email: String; let phone: String }
    struct Brand: Decodable, Identifiable, Hashable { let id: String; let name: String; let logoUrl: String? }
    struct Service: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let description: String
        let priceNet: Double?
        let unit: String
        let category: String?
        let imagePath: String?
        let imageUrl: String?
    }
    let presenter: Presenter
    let brands: [Brand]
    let brandsError: String?
    let services: [Service]
    let source: String
    let hotelName: String
}

/// Ustawienia pokazu — wyłącznie w pamięci aplikacji (logo z dysku nie jest nigdzie wysyłane).
struct SellerDemoConfig {
    var brand: SellerDemoData.Brand?
    var hotelName = ""
    var logo: NSImage?
    var accent = "#d3bb73"
    var showEarnings = true
    var presenterName = ""
    var presenterEmail = ""
    var presenterPhone = ""
    var hotel: String { hotelName.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "Twój hotel" }
    var brandName: String { brand?.name ?? "MAVINCI" }
}

struct SellerDemoDraft {
    struct Item: Equatable { let serviceID: String; var quantity: Int }
    var eventType = "wedding"
    var eventDate = Calendar.current.date(byAdding: .day, value: 45, to: Date()) ?? Date()
    var guests = 120
    var guestName = "Anna i Piotr Nowak"
    var guestCompany = ""
    var items: [Item] = []
    var markupPercent: Double = 15
}

/// `demoData.ts`: rodzaje wydarzeń, kolory, przeliczenia, formatowanie.
enum SellerDemo {
    struct EventType: Identifiable, Hashable { let id: String; let label: String }
    static let eventTypes: [EventType] = [
        EventType(id: "wedding", label: "Wesele"), EventType(id: "conference", label: "Konferencja"), EventType(id: "gala", label: "Gala"),
        EventType(id: "corporate", label: "Wydarzenie firmowe"), EventType(id: "party", label: "Impreza"),
    ]
    static let accents = ["#d3bb73", "#b08d57", "#8c1d40", "#1f6f5c", "#2f5d8a", "#6b4fa0", "#c2410c", "#111827"]
    /// Paleta pokazu (jak w CRM — niezależna od motywu aplikacji).
    static let page = CrmTheme.rgb(0x0f1119)
    static let card = CrmTheme.rgb(0x1c1f33)
    static let cardHover = CrmTheme.rgb(0x232741)
    static let text = CrmTheme.rgb(0xe5e4e2)
    static let ink = CrmTheme.rgb(0x111522)
    private static let locale = Locale(identifier: "pl_PL")

    static func color(_ hex: String) -> Color { CrmTheme.hex(hex) ?? CrmTheme.rgb(0xd3bb73) }

    /// Czytelny kolor tekstu na tle akcentu (biały / grafit) — `readableOn`.
    static func readable(_ hex: String) -> Color {
        var raw = hex.trimmingCharacters(in: .whitespaces)
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6, let value = Int(raw, radix: 16) else { return ink }
        let r = Double((value >> 16) & 255), g = Double((value >> 8) & 255), b = Double(value & 255)
        return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? ink : .white
    }

    static func initials(_ name: String) -> String {
        let parts = name.split(whereSeparator: { $0.isWhitespace }).prefix(2)
        let value = parts.compactMap { $0.first.map { String($0).uppercased(with: locale) } }.joined()
        return value.isEmpty ? "H" : value
    }

    /// `demoPln` — złote bez groszy (domyślnie).
    static func pln(_ value: Double, digits: Int = 0) -> String {
        value.formatted(.currency(code: "PLN").precision(.fractionLength(digits)).locale(locale))
    }

    static func longDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.dateStyle = .long
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    struct Line: Identifiable {
        let service: SellerDemoData.Service
        let quantity: Int
        let base: Double?
        let guest: Double?
        var id: String { service.id }
    }
    struct Totals {
        let lines: [Line]
        let baseNet: Double
        let guestNet: Double
        var markup: Double { guestNet - baseNet }
        var vat: Double { (guestNet * 0.23).rounded() }
        var gross: Double { (guestNet * 1.23).rounded() }
        var onRequest: Int { lines.filter { $0.base == nil }.count }
    }

    /// `demoTotals`: cena bazowa (cennik), narzut hotelu, cena dla klienta; pozycje bez ceny — wycena indywidualna.
    static func totals(_ draft: SellerDemoDraft, _ services: [SellerDemoData.Service]) -> Totals {
        let lines: [Line] = draft.items.compactMap { item -> Line? in
            guard let service = services.first(where: { $0.id == item.serviceID }) else { return nil }
            let base: Double? = (service.priceNet ?? 0) > 0 ? (service.priceNet ?? 0) * Double(item.quantity) : nil
            let guest: Double? = base.map { ($0 * (1 + draft.markupPercent / 100)).rounded() }
            return Line(service: service, quantity: item.quantity, base: base, guest: guest)
        }
        return Totals(lines: lines, baseNet: lines.reduce(0) { $0 + ($1.base ?? 0) }, guestNet: lines.reduce(0) { $0 + ($1.guest ?? 0) })
    }
}

/// Logo albo inicjały hotelu na białym tle.
struct SellerDemoLogo: View {
    let config: SellerDemoConfig
    var size: CGFloat = 48
    var corner: CGFloat = 12
    var body: some View {
        ZStack {
            Color.white.opacity(0.95)
            if let logo = config.logo {
                Image(nsImage: logo).resizable().scaledToFit().padding(size * 0.1)
            } else {
                Text(verbatim: SellerDemo.initials(config.hotel)).font(.system(size: size * 0.3, weight: .medium)).foregroundStyle(SellerDemo.ink.opacity(0.7))
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: corner))
    }
}

@MainActor struct SellerDemoView: View {
    @ObservedObject var store: SellersStore
    let request: SellerDemoRequest
    /// „Zaproś hotel do portalu” — kreator „Nowy sprzedawca” (jak `/crm/salespeople?new=1`).
    let onInvite: () -> Void
    let onExit: () -> Void
    @EnvironmentObject private var state: Workspace
    @State private var data: SellerDemoData?
    @State private var error: String?
    @State private var config = SellerDemoConfig()
    @State private var presenting = false
    @State private var logoError: String?

    var body: some View {
        Group {
            if presenting, let data {
                SellerDemoPresentation(config: config, services: data.services, fromCatalog: data.source == "catalog",
                                       onExit: { presenting = false }, onInvite: { presenting = false; onInvite() })
            } else {
                ScrollView { setup.padding(.horizontal, 32).padding(.vertical, 28).frame(maxWidth: 1180, alignment: .leading) }
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(SellerDemo.page)
        .foregroundStyle(SellerDemo.text)
        .environment(\.colorScheme, .dark)
        .tint(SellerDemo.color(config.accent))
        .task(id: request.id) { await load() }
    }

    private func load() async {
        guard let api = store.api else { error = "Brak połączenia z serwerem CRM."; return }
        var query = ["op": "demo"]
        if let organization = request.organization { query["organization"] = organization }
        if let contact = request.contact { query["contact"] = contact }
        if let hotel = request.hotel { query["hotel"] = hotel }
        do {
            let value = try JSONDecoder().decode(SellerDemoData.self, from: try await api.get("/sellers", query: query))
            guard !Task.isCancelled else { return }
            data = value
            error = nil
            // Prowadzący pokaz = zalogowany pracownik (wizytówka „Twój opiekun” w portalu).
            if config.presenterName.isEmpty {
                config.presenterName = value.presenter.name
                config.presenterEmail = value.presenter.email
                config.presenterPhone = value.presenter.phone
            }
            if config.brand == nil { config.brand = value.brands.first }
            if config.hotelName.isEmpty { config.hotelName = value.hotelName }
        } catch {
            guard !Task.isCancelled else { return }
            self.error = store.failureText(error, "Nie udało się przygotować pokazu.")
        }
    }

    // MARK: Przygotowanie pokazu (`DemoSetup`)

    private var setup: some View {
        VStack(alignment: .leading, spacing: 24) {
            Button { onExit() } label: { Label("Sprzedawcy", systemImage: "chevron.left") }.buttonStyle(.plain).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 8) {
                Text("TRYB POKAZOWY").font(.caption.weight(.semibold)).tracking(2).foregroundStyle(CrmTheme.rgb(0xd3bb73))
                Text("Pokaż portal hotelowi").font(.system(size: 34, weight: .light))
                Text("Przygotuj prezentację portalu sprzedawcy w barwach hotelu. Pokaz działa wyłącznie na tym urządzeniu — nie tworzy ofert, prowizji ani kontaktów i niczego nie wysyła.")
                    .font(.title3).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).frame(maxWidth: 720, alignment: .leading)
            }
            if let error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error).foregroundStyle(.orange)
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
            }
            HStack(alignment: .top, spacing: 24) {
                VStack(alignment: .leading, spacing: 18) {
                    brandSection
                    hotelSection
                    showSection
                }
                .frame(maxWidth: .infinity)
                preview.frame(width: 400)
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(verbatim: title).font(.callout.weight(.medium)).foregroundStyle(SellerDemo.text.opacity(0.8))
            content()
        }
        .padding(20).frame(maxWidth: .infinity, alignment: .leading)
        .background(SellerDemo.card, in: RoundedRectangle(cornerRadius: 18))
    }

    private var brandSection: some View {
        section("1. Marka, którą prezentujesz") {
            if data == nil && error == nil {
                ProgressView("Wczytywanie marek…").controlSize(.small)
            } else if let failure = data?.brandsError {
                Text(failure).font(.callout).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            } else if (data?.brands ?? []).isEmpty {
                Text("Brak dostępnych marek — pokaz użyje ogólnej nazwy MAVINCI.").font(.callout).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                    ForEach(data?.brands ?? []) { brand in
                        let selected = config.brand?.id == brand.id
                        Button { config.brand = brand } label: {
                            HStack(spacing: 12) {
                                brandLogo(brand)
                                Text(brand.name).font(.callout).lineLimit(1)
                                Spacer(minLength: 0)
                                if selected { Image(systemName: "checkmark") }
                            }
                            .padding(.horizontal, 14).frame(minHeight: 60)
                            .foregroundStyle(selected ? CrmTheme.rgb(0xd3bb73) : SellerDemo.text.opacity(0.7))
                            .background(selected ? CrmTheme.rgb(0xd3bb73).opacity(0.15) : SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    @ViewBuilder private func brandLogo(_ brand: SellerDemoData.Brand) -> some View {
        if let raw = brand.logoUrl, let url = URL(string: raw) {
            AsyncImage(url: url) { image in image.resizable().scaledToFit().padding(4) } placeholder: { Color.clear }
                .frame(width: 36, height: 36).background(Color.white.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
        } else {
            Text(verbatim: SellerDemo.initials(brand.name)).font(.caption)
                .frame(width: 36, height: 36).background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private var hotelSection: some View {
        section("2. Hotel") {
            VStack(alignment: .leading, spacing: 4) {
                Text("Nazwa hotelu").font(.caption).foregroundStyle(.secondary)
                TextField("np. Hotel Nad Jeziorem", text: Binding(get: { config.hotelName }, set: { config.hotelName = String($0.prefix(120)) }))
                    .textFieldStyle(.roundedBorder).font(.title3)
            }
            HStack(alignment: .center, spacing: 16) {
                SellerDemoLogo(config: config, size: 96, corner: 18)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        Button { pickLogo() } label: { Label(config.logo == nil ? "Dodaj logo hotelu" : "Zmień logo", systemImage: "photo.badge.plus") }
                        if config.logo != nil { Button { config.logo = nil } label: { Label("Usuń", systemImage: "trash") }.buttonStyle(.borderless) }
                    }
                    if let logoError { Text(logoError).font(.caption).foregroundStyle(.red) }
                    Label("Logo zostaje na tym urządzeniu — nie jest wysyłane ani zapisywane.", systemImage: "lock").font(.caption).foregroundStyle(.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Label("Kolor akcentu hotelu", systemImage: "paintpalette").font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    ForEach(SellerDemo.accents, id: \.self) { hex in
                        Button { config.accent = hex } label: {
                            Circle().fill(SellerDemo.color(hex)).frame(width: 40, height: 40)
                                .overlay { if config.accent == hex { Image(systemName: "checkmark").foregroundStyle(SellerDemo.readable(hex)) } }
                                .overlay(Circle().stroke(config.accent == hex ? SellerDemo.color(hex).opacity(0.7) : Color.clear, lineWidth: 3).padding(-5))
                        }
                        .buttonStyle(.plain).help(Text(verbatim: "Kolor \(hex)"))
                    }
                    ColorPicker("Własny", selection: Binding(get: { SellerDemo.color(config.accent) }, set: { config.accent = CrmTheme.hexString($0) }), supportsOpacity: false)
                        .font(.caption).padding(.leading, 6)
                }
            }
        }
    }

    /// Logo z dysku (obraz do 8 MB) — tylko w pamięci aplikacji, jak w CRM.
    private func pickLogo() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        if size > 8 * 1024 * 1024 { logoError = "Logo może mieć najwyżej 8 MB."; return }
        guard let image = NSImage(contentsOf: url) else { logoError = "Wybierz plik graficzny (PNG, JPG, SVG lub WEBP)."; return }
        logoError = nil
        config.logo = image
    }

    private var showSection: some View {
        section("3. Co pokazać") {
            Toggle(isOn: $config.showEarnings) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Pokaż wynagrodzenie", systemImage: "percent")
                    Text("Zakładka z kalkulatorem prowizji i kwoty w pulpicie. Wyłącz, jeśli z hotelem rozmawiasz najpierw o usługach, a o wynagrodzeniu — później.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.switch)
            .padding(14).background(SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 4) {
                Text("Opiekun widoczny w portalu").font(.caption).foregroundStyle(.secondary)
                TextField("Imię i nazwisko", text: Binding(get: { config.presenterName }, set: { config.presenterName = String($0.prefix(80)) }))
                    .textFieldStyle(.roundedBorder)
            }
        }
    }

    private var preview: some View {
        let accent = SellerDemo.color(config.accent)
        let onAccent = SellerDemo.readable(config.accent)
        let source = data?.source
        let count = data?.services.count ?? 0
        return VStack(alignment: .leading, spacing: 16) {
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    SellerDemoLogo(config: config, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(config.hotel).font(.headline).lineLimit(1)
                        Text(verbatim: "Portal sprzedawcy · \(config.brandName)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Text("TRYB POKAZOWY").font(.system(size: 9, weight: .semibold)).tracking(1).padding(.horizontal, 8).padding(.vertical, 4)
                        .background(Color.black.opacity(0.3), in: Capsule())
                }
                .padding(18)
                .background(LinearGradient(colors: [accent.opacity(0.35), accent.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing))
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        ForEach(["Oferty", "Wydarzenia", config.showEarnings ? "Wynagrodzenie" : "Zapytania"], id: \.self) { label in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(label.uppercased()).font(.system(size: 9)).foregroundStyle(.tertiary)
                                RoundedRectangle(cornerRadius: 3).fill(Color.white.opacity(0.1)).frame(width: 40, height: 18)
                            }
                            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                            .background(SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 10))
                        }
                    }
                    Text("Nowa oferta dla klienta →").font(.callout.weight(.medium)).foregroundStyle(onAccent)
                        .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(accent, in: RoundedRectangle(cornerRadius: 10))
                    Text(verbatim: source == nil ? "Wczytywanie katalogu usług…" : source == "catalog" ? "Usługi z katalogu: \(count) (tylko podgląd, ceny poglądowe)." : "Katalog jest pusty — pokaz użyje przykładowych usług.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(18)
            }
            .background(SellerDemo.card)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.45), radius: 30, y: 20)
            Button { presenting = true } label: {
                Label("Rozpocznij pokaz", systemImage: "play.fill").font(.title3.weight(.medium)).foregroundStyle(onAccent)
                    .frame(maxWidth: .infinity, minHeight: 56).background(accent, in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain).disabled(data == nil).opacity(data == nil ? 0.5 : 1)
            Text("Wskazówka: pełny ekran włączysz przyciskiem w prawym górnym rogu pokazu.").font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .center).multilineTextAlignment(.center)
        }
    }
}

extension Workspace {
    /// „Pokaż portal hotelowi” z karty organizacji lub kontaktu — ekran Sprzedawców w trybie pokazowym (nazwa hotelu
    /// z organizacji albo obecnej organizacji kontaktu); bez dostępu do ekranu Sprzedawców — strona CRM.
    func showSellerDemo(organization: String? = nil, contact: String? = nil, hotel: String? = nil) {
        guard navigation.flatMap(\.flattened).contains(where: { $0.href == "/crm/salespeople" }) else {
            var components = URLComponents()
            components.path = "/crm/salespeople/demo"
            components.queryItems = [("organization", organization), ("contact", contact), ("hotel", hotel)]
                .compactMap { item in item.1.map { URLQueryItem(name: item.0, value: $0) } }
            openCRM(components.string ?? "/crm/salespeople/demo")
            return
        }
        openHref("/crm/salespeople")
        sellers.demo = SellerDemoRequest(organization: organization, contact: contact, hotel: hotel)
    }
}

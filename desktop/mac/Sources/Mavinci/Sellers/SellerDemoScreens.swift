import SwiftUI
import AppKit

// MARK: Pokaz portalu w barwach hotelu 1:1 z `DemoPresentation` i jego zakładkami (`DemoDashboard`, `DemoOfferWizard`,
// `DemoGuestOffer`, `DemoEarnings`, `DemoHowItWorks`) — wyraźnie oznaczony jako tryb pokazowy, stan tylko w pamięci.

@MainActor struct SellerDemoPresentation: View {
    enum Tab: String, CaseIterable { case dashboard, wizard, guest, earnings, how }
    let config: SellerDemoConfig
    let services: [SellerDemoData.Service]
    let fromCatalog: Bool
    let onExit: () -> Void
    let onInvite: () -> Void
    @State private var tab: Tab = .dashboard
    @State private var draft = SellerDemoDraft()

    private var accent: Color { SellerDemo.color(config.accent) }
    private var onAccent: Color { SellerDemo.readable(config.accent) }
    private struct TabItem: Identifiable { let tab: Tab; let label: String; let symbol: String; var id: String { tab.rawValue } }
    private var tabs: [TabItem] {
        var list = [TabItem(tab: .dashboard, label: "Pulpit", symbol: "square.grid.2x2"), TabItem(tab: .wizard, label: "Kreator oferty", symbol: "wand.and.stars"),
                    TabItem(tab: .guest, label: "Oferta dla klienta", symbol: "doc.text")]
        if config.showEarnings { list.append(TabItem(tab: .earnings, label: "Wynagrodzenie", symbol: "percent")) }
        list.append(TabItem(tab: .how, label: "Jak to działa", symbol: "point.topleft.down.to.point.bottomright.curvepath"))
        return list
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        Color.clear.frame(height: 0).id("top")
                        Group {
                            switch tab {
                            case .dashboard: SellerDemoDashboard(config: config) { tab = $0 }
                            case .wizard: SellerDemoWizard(config: config, services: services, fromCatalog: fromCatalog, draft: $draft) { tab = .guest }
                            case .guest: SellerDemoGuestOffer(config: config, services: services, draft: draft) { tab = .wizard }
                            case .earnings: SellerDemoEarnings(config: config)
                            case .how: SellerDemoHowItWorks(config: config)
                            }
                        }
                        cta.padding(.top, 40)
                        Text(verbatim: "Tryb pokazowy — wszystkie dane są przykładowe. Nic nie zostało zapisane ani wysłane." + (fromCatalog ? " Usługi pochodzą z aktualnego katalogu; ceny są poglądowe." : ""))
                            .font(.caption).foregroundStyle(.tertiary).frame(maxWidth: .infinity).multilineTextAlignment(.center).padding(.top, 24).padding(.bottom, 16)
                    }
                    .padding(.horizontal, 24).padding(.vertical, 28).frame(maxWidth: 1180)
                    .frame(maxWidth: .infinity)
                }
                .onChange(of: tab) { _, _ in proxy.scrollTo("top", anchor: .top) }
            }
        }
        .onChange(of: config.showEarnings) { _, show in if !show && tab == .earnings { tab = .dashboard } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                SellerDemoLogo(config: config, size: 48)
                VStack(alignment: .leading, spacing: 2) {
                    Text(config.hotel).font(.title3.weight(.medium)).lineLimit(1)
                    Text(verbatim: "Portal sprzedawcy · w partnerstwie z \(config.brandName)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text("TRYB POKAZOWY").font(.caption2.weight(.semibold)).tracking(1.5).foregroundStyle(Color.orange.opacity(0.9))
                    .padding(.horizontal, 12).padding(.vertical, 6).background(Color.orange.opacity(0.15), in: Capsule())
                Button { NSApp.keyWindow?.toggleFullScreen(nil) } label: { Image(systemName: "arrow.up.left.and.arrow.down.right").frame(width: 40, height: 40) }
                    .buttonStyle(.plain).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10)).help("Pełny ekran")
                Button { onExit() } label: { Label("Zakończ pokaz", systemImage: "xmark").padding(.horizontal, 12).frame(height: 40) }
                    .buttonStyle(.plain).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
                    .keyboardShortcut(.cancelAction)
            }
            HStack(spacing: 4) {
                ForEach(tabs) { item in
                    let active = tab == item.tab
                    Button { tab = item.tab } label: {
                        Label { Text(item.label) } icon: { Image(systemName: item.symbol).foregroundStyle(active ? accent : Color.secondary) }
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .foregroundStyle(active ? Color.white : Color.secondary)
                            .background(active ? accent.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: 12))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
        .background(LinearGradient(colors: [accent.opacity(0.28), CrmTheme.rgb(0x151827)], startPoint: .leading, endPoint: .trailing))
    }

    private var cta: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Zaczynamy współpracę?").font(.system(size: 24, weight: .light))
                Text(verbatim: "Wyślemy zaproszenie do portalu osobie z hotelu. Pierwszą ofertę przygotujecie razem z opiekunem" + (config.presenterName.isEmpty ? "" : " — \(config.presenterName)") + ".")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Button { onInvite() } label: {
                Label("Zaproś hotel do portalu", systemImage: "paperplane").font(.title3.weight(.medium)).foregroundStyle(onAccent)
                    .padding(.horizontal, 24).frame(minHeight: 56).background(accent, in: RoundedRectangle(cornerRadius: 16))
            }
            .buttonStyle(.plain)
        }
        .padding(28)
        .background(LinearGradient(colors: [accent.opacity(0.3), accent.opacity(0.08)], startPoint: .leading, endPoint: .trailing), in: RoundedRectangle(cornerRadius: 24))
    }
}

/// Kafelek pokazu (karta w palecie CRM).
private struct DemoCard<Content: View>: View {
    var padding: CGFloat = 20
    var corner: CGFloat = 16
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content() }
            .padding(padding).frame(maxWidth: .infinity, alignment: .leading)
            .background(SellerDemo.card, in: RoundedRectangle(cornerRadius: corner))
    }
}

// MARK: Pulpit (`DemoDashboard`)

private struct SellerDemoDashboard: View {
    let config: SellerDemoConfig
    let navigate: (SellerDemoPresentation.Tab) -> Void

    private struct Offer: Identifiable { let title: String; let guest: String; let value: Double; let status: String; let tone: Color; var id: String { title } }
    private struct Event: Identifiable { let day: Int; let month: String; let title: String; let detail: String; var id: String { title } }
    private struct Tile: Identifiable { let label: String; let value: String; let helper: String; let symbol: String; let target: SellerDemoPresentation.Tab; var id: String { label } }
    private let offers = [
        Offer(title: "Wesele — sala balowa", guest: "Anna i Piotr", value: 18400, status: "Zaakceptowana przez klienta", tone: .green),
        Offer(title: "Konferencja firmy LogiTrans", guest: "LogiTrans sp. z o.o.", value: 12650, status: "PDF wysłany klientowi", tone: .cyan),
        Offer(title: "Jubileusz 40-lecia", guest: "Rodzina Kowalskich", value: 7900, status: "U opiekuna — sprawdzenie", tone: .orange),
        Offer(title: "Gala firmowa — grudzień", guest: "Nordic Pharma", value: 26300, status: "Szkic", tone: .secondary),
    ]
    private let events = [
        Event(day: 14, month: "lis", title: "Konferencja LogiTrans", detail: "Sala A · 80 os. · nagłośnienie, ekran LED"),
        Event(day: 23, month: "lis", title: "Wesele Anny i Piotra", detail: "Sala balowa · 120 os. · DJ, oświetlenie"),
        Event(day: 6, month: "gru", title: "Mikołajki dla dzieci", detail: "Restauracja · 40 os. · animacje"),
    ]
    private var accent: Color { SellerDemo.color(config.accent) }
    private var tiles: [Tile] {
        [
            Tile(label: "Oferty w tym miesiącu", value: "6", helper: "2 czekają na klienta", symbol: "doc.text", target: .guest),
            Tile(label: "Zaakceptowane", value: "3", helper: "skuteczność 50%", symbol: "sparkles", target: .guest),
            Tile(label: "Nadchodzące wydarzenia", value: "3", helper: "najbliższe za 9 dni", symbol: "calendar", target: .how),
            config.showEarnings
                ? Tile(label: "Twoje wynagrodzenie", value: SellerDemo.pln(4860), helper: "prognoza \(SellerDemo.pln(9420))", symbol: "percent", target: .earnings)
                : Tile(label: "Zapytania klientów", value: "4", helper: "1 nowe z kodu QR", symbol: "qrcode", target: .how),
        ]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Dzień dobry!").font(.callout).foregroundStyle(.secondary)
                    Text(verbatim: "Sprzedawaj wydarzenia w \(config.hotel)").font(.system(size: 28, weight: .light))
                    Text(verbatim: "Ofertę dla klienta przygotujesz w kilka minut — z logo hotelu, cenami i opisem usług. Opiekun z \(config.brandName) sprawdzi termin i zasoby.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).frame(maxWidth: 560, alignment: .leading)
                }
                Spacer()
                Button { navigate(.wizard) } label: {
                    Label("Nowa oferta", systemImage: "plus").font(.title3.weight(.medium)).foregroundStyle(SellerDemo.readable(config.accent))
                        .padding(.horizontal, 24).frame(minHeight: 56).background(accent, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
            }
            .padding(28)
            .background(LinearGradient(colors: [accent.opacity(0.25), accent.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: 4), spacing: 12) {
                ForEach(tiles) { tile in
                    Button { navigate(tile.target) } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack { Text(tile.label).font(.caption).foregroundStyle(.secondary); Spacer(); Image(systemName: tile.symbol).foregroundStyle(accent) }
                            Text(tile.value).font(.system(size: 28, weight: .light)).lineLimit(1).minimumScaleFactor(0.6)
                            Text(tile.helper).font(.caption).foregroundStyle(.tertiary)
                        }
                        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background(SellerDemo.card, in: RoundedRectangle(cornerRadius: 16)).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(alignment: .top, spacing: 16) {
                DemoCard {
                    HStack { Text("Ostatnie oferty").font(.headline); Spacer(); Text("przykładowe dane").font(.caption).foregroundStyle(.tertiary) }
                    ForEach(offers) { offer in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(offer.title).font(.callout).lineLimit(1)
                                Text(verbatim: "\(offer.guest) · \(SellerDemo.pln(offer.value)) netto").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Text(offer.status).font(.caption2).padding(.horizontal, 10).padding(.vertical, 4)
                                .foregroundStyle(offer.tone).background(offer.tone.opacity(0.12), in: Capsule())
                        }
                        .padding(12).background(SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
                .frame(maxWidth: .infinity)
                VStack(spacing: 16) {
                    DemoCard {
                        Text("Twój opiekun").font(.headline)
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().fill(accent.opacity(0.2))
                                if config.presenterName.isEmpty { Image(systemName: "person").foregroundStyle(accent) }
                                else { Text(verbatim: SellerDemo.initials(config.presenterName)).font(.callout.weight(.medium)).foregroundStyle(accent) }
                            }
                            .frame(width: 56, height: 56)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(config.presenterName.isEmpty ? "Opiekun MAVINCI" : config.presenterName).font(.callout).lineLimit(1)
                                Text(verbatim: "\(config.brandName) · odpowiada zwykle w ciągu godziny").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        if !config.presenterPhone.isEmpty { contactRow("phone", config.presenterPhone) }
                        if !config.presenterEmail.isEmpty { contactRow("envelope", config.presenterEmail) }
                        contactRow("bubble.left", "Czat z opiekunem w portalu")
                    }
                    DemoCard {
                        HStack(spacing: 16) {
                            SellerDemoQR(seed: config.hotel, color: accent).frame(width: 96, height: 96).padding(6).background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Zapytania z kodu QR").font(.callout.weight(.medium))
                                Text("Kod przy recepcji lub w pokoju. Gość hotelu zostawia zapytanie, a Ty i opiekun dostajecie powiadomienie.")
                                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .frame(width: 400)
            }
            DemoCard {
                Text("Nadchodzące wydarzenia").font(.headline)
                HStack(spacing: 10) {
                    ForEach(events) { event in
                        HStack(spacing: 12) {
                            VStack(spacing: 2) {
                                Text(verbatim: "\(event.day)").font(.title3.weight(.medium))
                                Text(event.month.uppercased()).font(.system(size: 10))
                            }
                            .foregroundStyle(accent).frame(width: 48).padding(.vertical, 6).background(accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.title).font(.callout).lineLimit(1)
                                Text(event.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12).frame(maxWidth: .infinity).background(SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
    }

    private func contactRow(_ symbol: String, _ text: String) -> some View {
        Label { Text(verbatim: text).lineLimit(1) } icon: { Image(systemName: symbol).foregroundStyle(accent) }
            .font(.callout).foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 9).frame(maxWidth: .infinity, alignment: .leading)
            .background(SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Pseudo-kod QR (dekoracyjny) — jak `DecorativeQr`: ten sam generator kratek z nazwy hotelu, narożniki w kolorze akcentu.
struct SellerDemoQR: View {
    let seed: String
    let color: Color

    /// Kratki 21×21 — arytmetyka jak w przeglądarce (`>>> 0`, mnożenie na liczbach zmiennoprzecinkowych).
    private var cells: [Bool] {
        var hash: UInt64 = 0
        for scalar in seed.unicodeScalars {
            let code = scalar.value > 0xFFFF ? UInt64(0xD800 + ((scalar.value - 0x10000) >> 10)) : UInt64(scalar.value)
            hash = (hash * 31 + code) & 0xFFFF_FFFF
        }
        var result: [Bool] = []
        result.reserveCapacity(441)
        for _ in 0..<441 {
            let next = Double(hash) * 1_103_515_245 + 12345
            hash = UInt64(UInt32(truncatingIfNeeded: Int64(next)))
            result.append(((hash >> 16) & 1) == 1)
        }
        return result
    }

    var body: some View {
        let cells = self.cells
        Canvas { context, size in
            let unit = min(size.width, size.height) / 21
            func square(_ x: Int, _ y: Int, _ width: Int, _ fill: Color) {
                context.fill(Path(CGRect(x: CGFloat(x) * unit, y: CGFloat(y) * unit, width: CGFloat(width) * unit, height: CGFloat(width) * unit)), with: .color(fill))
            }
            square(0, 0, 21, .white)
            for index in 0..<441 {
                let x = index % 21, y = index / 21
                let finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13)
                if !finder && cells[index] { square(x, y, 1, SellerDemo.ink) }
            }
            for (x, y) in [(0, 0), (14, 0), (0, 14)] {
                square(x, y, 7, color)
                square(x + 1, y + 1, 5, .white)
                square(x + 2, y + 2, 3, SellerDemo.ink)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: Kreator oferty (`DemoOfferWizard`)

private struct SellerDemoWizard: View {
    let config: SellerDemoConfig
    let services: [SellerDemoData.Service]
    let fromCatalog: Bool
    @Binding var draft: SellerDemoDraft
    let showGuestOffer: () -> Void
    @State private var step = 0
    @State private var category = ""
    @State private var query = ""

    private static let steps = ["Wydarzenie", "Usługi", "Cena dla klienta"]
    private var accent: Color { SellerDemo.color(config.accent) }
    private var onAccent: Color { SellerDemo.readable(config.accent) }
    private var categories: [String] {
        var seen = Set<String>()
        return services.compactMap(\.category).filter { seen.insert($0).inserted }.prefix(12).map { $0 }
    }
    private var visible: [SellerDemoData.Service] {
        let locale = Locale(identifier: "pl_PL")
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased(with: locale)
        return services.filter { service in
            (category.isEmpty || service.category == category)
                && (needle.isEmpty || "\(service.name) \(service.description)".lowercased(with: locale).contains(needle))
        }
    }
    private var canNext: Bool {
        step == 0 ? draft.guests > 0 && !draft.guestName.trimmingCharacters(in: .whitespaces).isEmpty : step == 1 ? !draft.items.isEmpty : true
    }
    private var nextHint: String {
        if step == 0 { return draft.guestName.trimmingCharacters(in: .whitespaces).isEmpty ? "Wpisz nazwę klienta lub firmy." : "" }
        if step == 1 { return draft.items.isEmpty ? "Dodaj co najmniej jedną usługę." : "Wybrane usługi: \(draft.items.count)" }
        return ""
    }

    private func quantity(_ id: String) -> Int { draft.items.first(where: { $0.serviceID == id })?.quantity ?? 0 }
    private func setQuantity(_ id: String, _ value: Int) {
        var rest = draft.items.filter { $0.serviceID != id }
        if value > 0 { rest.append(.init(serviceID: id, quantity: min(value, 99))) }
        draft.items = rest
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 8) {
                ForEach(Array(Self.steps.enumerated()), id: \.offset) { index, label in
                    let done = index < step, active = index == step
                    Button { if index <= step || canNext { step = index } } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                Circle().fill(done || active ? accent : Color.white.opacity(0.08))
                                if done { Image(systemName: "checkmark").foregroundStyle(onAccent) } else { Text(verbatim: "\(index + 1)").foregroundStyle(active ? onAccent : SellerDemo.text) }
                            }
                            .frame(width: 36, height: 36)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: "KROK \(index + 1)").font(.system(size: 10)).foregroundStyle(.tertiary)
                                Text(label).font(.callout).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(14).frame(maxWidth: .infinity)
                        .background(active ? accent.opacity(0.2) : SellerDemo.card, in: RoundedRectangle(cornerRadius: 16)).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            switch step {
            case 0: eventStep
            case 1: servicesStep
            default: priceStep
            }
            HStack {
                Button { step = max(0, step - 1) } label: { Label("Wstecz", systemImage: "chevron.left").padding(.horizontal, 18).frame(minHeight: 44) }
                    .buttonStyle(.plain).background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12)).disabled(step == 0).opacity(step == 0 ? 0.3 : 1)
                Spacer()
                Text(nextHint).font(.caption).foregroundStyle(.secondary)
                Spacer()
                if step < 2 {
                    Button { if canNext { step += 1 } } label: {
                        HStack(spacing: 6) { Text("Dalej"); Image(systemName: "chevron.right") }
                            .font(.callout.weight(.medium)).foregroundStyle(onAccent).padding(.horizontal, 22).frame(minHeight: 44)
                            .background(accent, in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain).disabled(!canNext).opacity(canNext ? 1 : 0.4)
                }
            }
        }
    }

    private var eventStep: some View {
        DemoCard(padding: 26, corner: 24) {
            Text("Jakie wydarzenie planuje klient?").font(.system(size: 22, weight: .light))
            Text("Rodzaj, termin i liczba gości — opiekun od razu sprawdzi dostępność zespołu i sprzętu.").font(.callout).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                ForEach(SellerDemo.eventTypes) { type in
                    let selected = draft.eventType == type.id
                    Button { draft.eventType = type.id } label: {
                        Text(type.label).padding(.horizontal, 20).frame(minHeight: 44)
                            .foregroundStyle(selected ? onAccent : SellerDemo.text)
                            .background(selected ? accent : SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                    }
                    .buttonStyle(.plain)
                }
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Termin wydarzenia").font(.caption).foregroundStyle(.secondary)
                    DatePicker("", selection: $draft.eventDate, displayedComponents: .date).labelsHidden().environment(\.locale, Locale(identifier: "pl_PL"))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Liczba gości").font(.caption).foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        Button { draft.guests = max(1, draft.guests - 10) } label: { Image(systemName: "minus").frame(width: 40, height: 36) }
                            .buttonStyle(.plain).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10)).help("Mniej gości")
                        TextField("", value: Binding(get: { draft.guests }, set: { draft.guests = max(0, min(2000, $0)) }), format: .number)
                            .textFieldStyle(.roundedBorder).multilineTextAlignment(.center).frame(width: 110)
                        Button { draft.guests = min(2000, draft.guests + 10) } label: { Image(systemName: "plus").frame(width: 40, height: 36) }
                            .buttonStyle(.plain).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10)).help("Więcej gości")
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Klient / zamawiający").font(.caption).foregroundStyle(.secondary)
                    TextField("np. Anna i Piotr Nowak", text: Binding(get: { draft.guestName }, set: { draft.guestName = String($0.prefix(80)) })).textFieldStyle(.roundedBorder)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Firma (opcjonalnie)").font(.caption).foregroundStyle(.secondary)
                    TextField("np. LogiTrans sp. z o.o.", text: Binding(get: { draft.guestCompany }, set: { draft.guestCompany = String($0.prefix(80)) })).textFieldStyle(.roundedBorder)
                }
            }
        }
    }

    private var servicesStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            DemoCard(padding: 20, corner: 24) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Wybierz usługi").font(.system(size: 22, weight: .light))
                        Text(verbatim: (fromCatalog ? "Aktualny katalog usług — opisy i zdjęcia przygotowuje zespół." : "Przykładowe usługi.") + " Ceny poglądowe.")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Szukaj usługi…", text: $query).textFieldStyle(.roundedBorder)
                    }
                    .frame(width: 280)
                }
            }
            if categories.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach([""] + categories, id: \.self) { value in
                            Button { category = value } label: {
                                Text(value.isEmpty ? "Wszystkie" : value).padding(.horizontal, 16).frame(minHeight: 36)
                                    .foregroundStyle(category == value ? Color.white : SellerDemo.text.opacity(0.6))
                                    .background(category == value ? accent.opacity(0.25) : SellerDemo.card, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 12)], spacing: 12) {
                ForEach(visible) { service in serviceCard(service) }
            }
            if visible.isEmpty {
                Text("Brak usług spełniających wyszukiwanie.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(32)
                    .background(SellerDemo.card, in: RoundedRectangle(cornerRadius: 16))
            }
        }
    }

    private func serviceCard(_ service: SellerDemoData.Service) -> some View {
        let count = quantity(service.id)
        return VStack(alignment: .leading, spacing: 0) {
            if service.imageUrl != nil {
                ProductThumb(path: service.imagePath ?? service.imageUrl, url: service.imageUrl, corner: 0).frame(height: 144).clipped()
            } else {
                ZStack {
                    LinearGradient(colors: [accent.opacity(0.22), accent.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    Image(systemName: "sparkles").font(.title2).foregroundStyle(accent)
                }
                .frame(height: 96)
            }
            VStack(alignment: .leading, spacing: 4) {
                if let category = service.category { Text(category.uppercased()).font(.system(size: 10)).foregroundStyle(.tertiary) }
                Text(service.name).font(.body)
                if !service.description.isEmpty { Text(service.description).font(.caption).foregroundStyle(.secondary).lineLimit(3) }
                Spacer(minLength: 12)
                HStack {
                    if let price = service.priceNet, price > 0 {
                        Text(verbatim: SellerDemo.pln(price)).font(.callout) + Text(verbatim: " netto / \(service.unit)").font(.caption).foregroundColor(.secondary)
                    } else {
                        Text("wycena indywidualna").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if count == 0 {
                        Button { setQuantity(service.id, 1) } label: {
                            Label("Dodaj", systemImage: "plus").font(.callout.weight(.medium)).foregroundStyle(onAccent)
                                .padding(.horizontal, 14).frame(minHeight: 38).background(accent, in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    } else {
                        HStack(spacing: 4) {
                            Button { setQuantity(service.id, count - 1) } label: { Image(systemName: "minus").frame(width: 32, height: 32) }.buttonStyle(.plain)
                                .help(Text(verbatim: "Mniej: \(service.name)"))
                            Text(verbatim: "\(count)").frame(width: 24)
                            Button { setQuantity(service.id, count + 1) } label: { Image(systemName: "plus").frame(width: 32, height: 32) }.buttonStyle(.plain)
                                .help(Text(verbatim: "Więcej: \(service.name)"))
                        }
                        .padding(3).background(SellerDemo.page, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            .padding(16).frame(maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, minHeight: 300, alignment: .top)
        .background(SellerDemo.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(count > 0 ? accent.opacity(0.7) : Color.clear, lineWidth: 2))
    }

    private var priceStep: some View {
        let totals = SellerDemo.totals(draft, services)
        return HStack(alignment: .top, spacing: 16) {
            DemoCard(padding: 26, corner: 24) {
                Text("Cena dla klienta").font(.system(size: 22, weight: .light))
                Text("Pracujesz na cenniku partnera. Narzut hotelu dodajesz sam — klient widzi jedną, końcową cenę.").font(.callout).foregroundStyle(.secondary)
                HStack {
                    Text("Narzut hotelu")
                    Spacer()
                    Text(verbatim: "\(Int(draft.markupPercent))%").font(.system(size: 24, weight: .light)).foregroundStyle(accent)
                }
                .padding(.top, 8)
                Slider(value: $draft.markupPercent, in: 0...40, step: 1).tint(accent)
                HStack { Text(verbatim: "0%"); Spacer(); Text(verbatim: "20%"); Spacer(); Text(verbatim: "40%") }.font(.caption2).foregroundStyle(.tertiary)
                ForEach(totals.lines) { line in
                    HStack {
                        Text(verbatim: line.service.name + (line.quantity > 1 ? " × \(line.quantity)" : "")).lineLimit(1)
                        Spacer()
                        if let guest = line.guest { Text(verbatim: SellerDemo.pln(guest)) } else { Text("do wyceny").font(.caption).foregroundStyle(.secondary) }
                    }
                    .font(.callout).padding(.horizontal, 12).padding(.vertical, 10)
                    .background(SellerDemo.page.opacity(0.7), in: RoundedRectangle(cornerRadius: 12))
                }
            }
            .frame(maxWidth: .infinity)
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("KLIENT ZAPŁACI").font(.caption).foregroundStyle(.secondary)
                    (Text(verbatim: SellerDemo.pln(totals.guestNet)).font(.system(size: 36, weight: .light)) + Text(verbatim: " netto").font(.callout).foregroundColor(.secondary))
                    Text(verbatim: "\(SellerDemo.pln(totals.gross)) brutto (VAT 23%)").font(.callout).foregroundStyle(.secondary)
                    if totals.onRequest > 0 {
                        Text(verbatim: "+ \(totals.onRequest == 1 ? "1 pozycja" : "\(totals.onRequest) pozycje") do indywidualnej wyceny przez opiekuna")
                            .font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                    }
                }
                .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                .background(LinearGradient(colors: [accent.opacity(0.3), accent.opacity(0.08)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
                HStack(spacing: 12) {
                    amountTile("CENNIK PARTNERA", SellerDemo.pln(totals.baseNet), color: SellerDemo.text)
                    amountTile("NARZUT HOTELU", SellerDemo.pln(totals.markup), color: accent)
                }
                Button { showGuestOffer() } label: {
                    Label("Zobacz ofertę dla klienta", systemImage: "doc.text").font(.body.weight(.medium)).foregroundStyle(onAccent)
                        .frame(maxWidth: .infinity, minHeight: 56).background(accent, in: RoundedRectangle(cornerRadius: 16))
                }
                .buttonStyle(.plain)
                Text("W portalu jednym kliknięciem powstaje PDF i link dla klienta, a opiekun sprawdza termin i zasoby.")
                    .font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: .infinity)
            }
            .frame(width: 400)
        }
    }

    private func amountTile(_ label: String, _ value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: label).font(.caption2).foregroundStyle(.tertiary)
            Text(verbatim: value).font(.title3.weight(.light)).foregroundStyle(color)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(SellerDemo.card, in: RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: Oferta dla klienta (`DemoGuestOffer`)

private struct SellerDemoGuestOffer: View {
    let config: SellerDemoConfig
    let services: [SellerDemoData.Service]
    let draft: SellerDemoDraft
    let edit: () -> Void
    @State private var accepted = false

    private struct Meta: Identifiable { let label: String; let value: String; var id: String { label } }
    private static let paper = CrmTheme.rgb(0xfaf7f2)
    private static let ink = CrmTheme.rgb(0x1d1b20)
    private var accent: Color { SellerDemo.color(config.accent) }
    private var onAccent: Color { SellerDemo.readable(config.accent) }

    var body: some View {
        let totals = SellerDemo.totals(draft, services)
        if totals.lines.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "wand.and.stars").font(.largeTitle).foregroundStyle(accent).padding(16).background(accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 16))
                Text("Najpierw wybierz usługi").font(.system(size: 22, weight: .light))
                Text("Oferta dla klienta powstaje z kreatora: rodzaj wydarzenia, termin, usługi i cena hotelu.").font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button { edit() } label: {
                    Label("Otwórz kreator oferty", systemImage: "wand.and.stars").font(.callout.weight(.medium)).foregroundStyle(onAccent)
                        .padding(.horizontal, 20).frame(minHeight: 44).background(accent, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
            .padding(40).frame(maxWidth: .infinity).background(SellerDemo.card, in: RoundedRectangle(cornerRadius: 24))
        } else {
            document(totals)
        }
    }

    private func document(_ totals: SellerDemo.Totals) -> some View {
        let eventLabel = SellerDemo.eventTypes.first(where: { $0.id == draft.eventType })?.label ?? "Wydarzenie"
        let validUntil = SellerDemo.longDate(Date().addingTimeInterval(14 * 86_400))
        let client = [draft.guestName.nonEmpty ?? "Klient", draft.guestCompany].filter { !$0.isEmpty }.joined(separator: " · ")
        let meta = [Meta(label: "Dla", value: client), Meta(label: "Wydarzenie", value: eventLabel), Meta(label: "Termin", value: SellerDemo.longDate(draft.eventDate)),
                    Meta(label: "Liczba gości", value: "\(draft.guests) os.")]
        return VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Klient otrzymuje PDF oraz link do oferty — z logo i kolorami hotelu.", systemImage: "link").font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button { edit() } label: { Label("Zmień ofertę", systemImage: "pencil").padding(.horizontal, 14).frame(minHeight: 40) }
                    .buttonStyle(.plain).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 28) {
                    HStack(alignment: .top) {
                        HStack(spacing: 16) {
                            SellerDemoLogo(config: config, size: 72, corner: 16)
                            VStack(alignment: .leading, spacing: 4) {
                                Text("OFERTA WYDARZENIA").font(.caption).tracking(2).opacity(0.75)
                                Text(config.hotel).font(.system(size: 28, weight: .light))
                            }
                        }
                        Spacer()
                        Text("TRYB POKAZOWY").font(.system(size: 10, weight: .semibold)).tracking(1).padding(.horizontal, 10).padding(.vertical, 4)
                            .background(Color.black.opacity(0.15), in: Capsule())
                    }
                    HStack(alignment: .top, spacing: 16) {
                        ForEach(meta) { item in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: item.label.uppercased()).font(.system(size: 10)).opacity(0.7)
                                Text(verbatim: item.value).font(.callout.weight(.medium))
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .foregroundStyle(onAccent)
                .padding(.horizontal, 36).padding(.top, 34).padding(.bottom, 30)
                .background(LinearGradient(colors: [accent, accent.opacity(0.78)], startPoint: .topLeading, endPoint: .bottomTrailing))
                VStack(alignment: .leading, spacing: 20) {
                    Text(verbatim: "Szanowni Państwo, z przyjemnością przedstawiamy propozycję oprawy wydarzenia w \(config.hotel). Realizację zapewnia nasz partner \(config.brandName) — zespół, sprzęt i koordynacja na miejscu.")
                        .font(.callout).foregroundStyle(Self.ink.opacity(0.7)).fixedSize(horizontal: false, vertical: true)
                    VStack(spacing: 0) {
                        HStack {
                            Text("USŁUGA").frame(maxWidth: .infinity, alignment: .leading)
                            Text("ILOŚĆ").frame(width: 140, alignment: .trailing)
                            Text("WARTOŚĆ NETTO").frame(width: 160, alignment: .trailing)
                        }
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(Self.ink.opacity(0.45)).padding(.bottom, 8)
                        ForEach(totals.lines) { line in
                            Divider().overlay(Self.ink.opacity(0.06))
                            HStack(alignment: .top) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(line.service.name).font(.callout.weight(.medium))
                                    if !line.service.description.isEmpty { Text(line.service.description).font(.caption).foregroundStyle(Self.ink.opacity(0.55)).lineLimit(2) }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(verbatim: "\(line.quantity) × \(line.service.unit)").font(.callout).foregroundStyle(Self.ink.opacity(0.7)).frame(width: 140, alignment: .trailing)
                                Group {
                                    if let guest = line.guest { Text(verbatim: SellerDemo.pln(guest)).font(.callout.weight(.medium)) }
                                    else { Text("wycena indywidualna").font(.caption).foregroundStyle(Self.ink.opacity(0.5)) }
                                }
                                .frame(width: 160, alignment: .trailing)
                            }
                            .padding(.vertical, 12)
                        }
                    }
                    .foregroundStyle(Self.ink)
                    VStack(alignment: .trailing, spacing: 4) {
                        (Text("Razem netto  ").font(.callout).foregroundColor(Self.ink.opacity(0.6)) + Text(verbatim: SellerDemo.pln(totals.guestNet)).font(.title3.weight(.medium)).foregroundColor(Self.ink))
                        Text(verbatim: "VAT 23%: \(SellerDemo.pln(totals.vat))").font(.caption).foregroundStyle(Self.ink.opacity(0.5))
                        (Text(verbatim: SellerDemo.pln(totals.gross)).font(.system(size: 24, weight: .light)).foregroundColor(Self.ink) + Text(verbatim: " brutto").font(.callout).foregroundColor(Self.ink.opacity(0.55)))
                        if totals.onRequest > 0 {
                            Text("Pozycje do indywidualnej wyceny zostaną potwierdzone przez opiekuna.").font(.caption).foregroundStyle(Self.ink.opacity(0.55))
                        }
                    }
                    .padding(20).frame(maxWidth: .infinity, alignment: .trailing)
                    .background(accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
                    HStack(alignment: .center) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: "Oferta ważna do \(validUntil). Termin i dostępność zasobów potwierdza opiekun \(config.brandName).")
                            Text(verbatim: "Kontakt: dział sprzedaży \(config.hotel).")
                        }
                        .font(.caption).foregroundStyle(Self.ink.opacity(0.55))
                        Spacer()
                        if accepted {
                            Label("Klient zaakceptował ofertę", systemImage: "checkmark.circle.fill").font(.callout.weight(.medium))
                                .foregroundStyle(CrmTheme.rgb(0x065f46)).padding(.horizontal, 18).padding(.vertical, 12)
                                .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
                        } else {
                            Button { accepted = true } label: {
                                Label("Akceptuję ofertę", systemImage: "checkmark.circle").font(.callout.weight(.medium)).foregroundStyle(onAccent)
                                    .padding(.horizontal, 22).frame(minHeight: 44).background(accent, in: RoundedRectangle(cornerRadius: 16))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 36).padding(.vertical, 28)
            }
            .background(Self.paper)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .shadow(color: .black.opacity(0.5), radius: 40, y: 24)
            .environment(\.colorScheme, .light)
            .frame(maxWidth: 900)
            .frame(maxWidth: .infinity)
            if accepted {
                Text("W portalu sprzedawca i opiekun dostają w tej chwili powiadomienie o akceptacji, a opiekun potwierdza termin i przygotowuje realizację. (Tryb pokazowy — nic nie zostało zapisane.)")
                    .font(.callout).multilineTextAlignment(.center).padding(16).frame(maxWidth: 900)
                    .background(Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 16)).frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: Wynagrodzenie (`DemoEarnings`)

private struct SellerDemoEarnings: View {
    let config: SellerDemoConfig
    @State private var events: Double = 12
    @State private var average: Double = 15000
    @State private var rate: Double = 10

    private static let weights: [Double] = [0.5, 0.6, 0.8, 1, 1.3, 1.5, 1.4, 1.2, 1.3, 1, 0.9, 1.5]
    private static let monthLabels = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"]
    private var accent: Color { SellerDemo.color(config.accent) }

    var body: some View {
        let yearly = events * average * (rate / 100)
        let perEvent = average * (rate / 100)
        let sum = Self.weights.reduce(0, +)
        let months = Self.weights.map { yearly * $0 / sum }
        let peak = max(months.max() ?? 1, 1)
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "Twoje wynagrodzenie z wydarzeń w \(config.hotelName.trimmingCharacters(in: .whitespaces).nonEmpty ?? "hotelu")").font(.callout).foregroundStyle(.secondary)
                (Text(verbatim: SellerDemo.pln(yearly)).font(.system(size: 52, weight: .light)) + Text(verbatim: "  rocznie").font(.title3).foregroundColor(.secondary))
                HStack(spacing: 10) {
                    chip("\(SellerDemo.pln(yearly / 12)) miesięcznie średnio")
                    chip("\(SellerDemo.pln(perEvent)) z jednego wydarzenia")
                }
            }
            .padding(28).frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [accent.opacity(0.28), accent.opacity(0.05)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 24))
            HStack(alignment: .top, spacing: 12) {
                slider("Wydarzenia w roku", "calendar", value: $events, range: 1...60, step: 1, suffix: nil) { "\(Int($0))" }
                slider("Średnia wartość netto", "banknote", value: $average, range: 2000...60000, step: 500, suffix: "zł") { SellerDemo.pln($0) }
                slider("Stawka", "percent", value: $rate, range: 1...20, step: 0.5, suffix: "%") { "\(SellerPricingFormat.number($0))%" }
            }
            DemoCard {
                Label { Text("Rozkład w roku (sezonowość poglądowa)") } icon: { Image(systemName: "chart.line.uptrend.xyaxis").foregroundStyle(accent) }.font(.headline)
                HStack(alignment: .bottom, spacing: 8) {
                    ForEach(0..<12, id: \.self) { index in
                        VStack(spacing: 4) {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 6)
                                .fill(LinearGradient(colors: [accent, accent.opacity(0.35)], startPoint: .top, endPoint: .bottom))
                                .frame(height: max(6, CGFloat(months[index] / peak) * 130))
                                .help(Text(verbatim: "\(Self.monthLabels[index]): \(SellerDemo.pln(months[index]))"))
                            Text(verbatim: Self.monthLabels[index]).font(.system(size: 10)).foregroundStyle(.tertiary)
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .frame(height: 160)
            }
            Label("Kalkulacja poglądowa. Wynagrodzenie liczymy od wartości netto wydarzenia bez usług zewnętrznych wykonawców i wypłacamy po rozliczeniu wydarzenia. Stawkę i zasady potwierdza umowa współpracy; w portalu sprzedawca widzi każde naliczenie i wypłatę.", systemImage: "info.circle")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                .padding(16).background(Color.white.opacity(0.03), in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func chip(_ text: String) -> some View {
        Text(verbatim: text).font(.callout).padding(.horizontal, 16).padding(.vertical, 8).background(Color.black.opacity(0.2), in: Capsule())
    }

    private func slider(_ label: String, _ symbol: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double, suffix: String?,
                        format: @escaping (Double) -> String) -> some View {
        DemoCard {
            HStack {
                Label { Text(verbatim: label) } icon: { Image(systemName: symbol).foregroundStyle(accent) }.font(.callout).foregroundStyle(.secondary)
                Spacer()
                HStack(spacing: 4) {
                    TextField("", value: Binding(get: { value.wrappedValue }, set: { value.wrappedValue = min(range.upperBound, max(range.lowerBound, $0)) }),
                              format: .number.precision(.fractionLength(0...1)).locale(Locale(identifier: "pl_PL")))
                        .textFieldStyle(.roundedBorder).multilineTextAlignment(.trailing).frame(width: 96)
                    if let suffix { Text(verbatim: suffix).font(.callout).foregroundStyle(.secondary) }
                }
            }
            Slider(value: value, in: range, step: step).tint(accent)
            HStack { Text(verbatim: format(range.lowerBound)); Spacer(); Text(verbatim: format(range.upperBound)) }.font(.caption2).foregroundStyle(.tertiary)
        }
    }
}

// MARK: Jak to działa (`DemoHowItWorks`)

private struct SellerDemoHowItWorks: View {
    let config: SellerDemoConfig
    @State private var active = 0

    private struct Step { let title: String; let who: String; let symbol: String; let text: String }
    private struct Benefit: Identifiable { let symbol: String; let title: String; let text: String; var id: String { title } }
    private var accent: Color { SellerDemo.color(config.accent) }
    private var onAccent: Color { SellerDemo.readable(config.accent) }
    private var hotel: String { config.hotelName.trimmingCharacters(in: .whitespaces).nonEmpty ?? "hotel" }
    private var steps: [Step] {
        let brand = config.brandName
        return [
            Step(title: "Wizyta", who: "Opiekun \(brand)", symbol: "hands.sparkles", text: "Poznajemy \(hotel), sale i typowe wydarzenia. Ustalamy, kto w hotelu będzie przygotowywał oferty."),
            Step(title: "Zaproszenie", who: "Opiekun → hotel", symbol: "envelope.badge", text: "Osoba z hotelu dostaje e-mail z zaproszeniem i sama ustawia hasło. Portal od razu ma logo i kolory hotelu."),
            Step(title: "Oferta i klient", who: "Hotel", symbol: "wand.and.stars", text: "Hotel przygotowuje ofertę w kreatorze i dołącza PDF do swojej oferty dla klienta. Może też wysłać link do akceptacji online."),
            Step(title: "U opiekuna", who: "Opiekun \(brand)", symbol: "checkmark.shield", text: "Po zgodzie klienta hotel wysyła ofertę do opiekuna. Opiekun sprawdza termin, zespół i sprzęt, a potem przyjmuje ofertę."),
            Step(title: "Wydarzenie", who: "Hotel + \(brand)", symbol: "party.popper", text: "Opiekun potwierdza termin. Hotel uzupełnia trzy krótkie kroki: osoba na miejscu, sala, materiały. \(brand) przygotowuje plan i obsługę."),
            Step(title: "Rozliczenie", who: "\(brand) → sprzedawca", symbol: "banknote", text: "Po rozliczeniu wydarzenia wynagrodzenie trafia do wypłaty. Opiekun pokazuje je w portalu — z podsumowaniem, skąd wzięła się kwota."),
        ]
    }
    private let benefits = [
        Benefit(symbol: "person", title: "Jeden opiekun", text: "Czat w portalu, telefon i pomoc przy każdej ofercie."),
        Benefit(symbol: "doc.text", title: "Oferta w kilka minut", text: "Gotowe opisy, zdjęcia i ceny — PDF jako wkładka do oferty hotelu."),
        Benefit(symbol: "sparkles", title: "Marka hotelu", text: "Logo i kolory hotelu na ofertach i w portalu."),
        Benefit(symbol: "checkmark.shield", title: "Bez ryzyka", text: "Termin i zasoby potwierdza opiekun, realizację prowadzi partner."),
    ]

    var body: some View {
        let list = steps
        let current = list[min(active, list.count - 1)]
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Jak to działa").font(.system(size: 28, weight: .light))
                Text(verbatim: "Dwa kroki startu, potem etapy każdej oferty — te same, które \(hotel) zobaczy w portalu. Przez cały czas hotel ma jednego opiekuna po stronie \(config.brandName).")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true).frame(maxWidth: 680, alignment: .leading)
            }
            HStack(spacing: 10) {
                ForEach(Array(list.enumerated()), id: \.offset) { index, step in
                    let selected = index == active, done = index < active
                    Button { active = index } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 8) {
                                Text(verbatim: "\(index + 1)").font(.callout.weight(.medium)).frame(width: 36, height: 36)
                                    .foregroundStyle(selected || done ? onAccent : SellerDemo.text)
                                    .background(selected || done ? accent : Color.white.opacity(0.08), in: Circle())
                                Image(systemName: step.symbol).foregroundStyle(selected ? accent : SellerDemo.text.opacity(0.4))
                            }
                            Text(step.title).font(.callout.weight(.medium))
                            Text(step.who).font(.caption2).foregroundStyle(.secondary)
                            Spacer(minLength: 0)
                        }
                        .padding(16).frame(maxWidth: .infinity, minHeight: 136, alignment: .topLeading)
                        .background(selected ? accent.opacity(0.22) : SellerDemo.card, in: RoundedRectangle(cornerRadius: 16)).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            HStack(alignment: .center, spacing: 20) {
                Image(systemName: current.symbol).font(.system(size: 30)).foregroundStyle(accent).frame(width: 64, height: 64)
                    .background(accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 16))
                VStack(alignment: .leading, spacing: 8) {
                    Text(verbatim: "KROK \(active + 1) Z \(list.count) · \(current.who.uppercased())").font(.caption).foregroundStyle(.tertiary)
                    Text(current.title).font(.system(size: 22, weight: .light))
                    Text(current.text).font(.body).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        Button { active = max(0, active - 1) } label: { Text("Poprzedni").padding(.horizontal, 16).frame(minHeight: 40) }
                            .buttonStyle(.plain).background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                            .disabled(active == 0).opacity(active == 0 ? 0.3 : 1)
                        Button { active = min(list.count - 1, active + 1) } label: {
                            Text("Następny krok").font(.callout.weight(.medium)).foregroundStyle(onAccent).padding(.horizontal, 16).frame(minHeight: 40)
                                .background(accent, in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain).disabled(active == list.count - 1).opacity(active == list.count - 1 ? 0.3 : 1)
                    }
                    .padding(.top, 6)
                }
            }
            .padding(28).frame(maxWidth: .infinity, alignment: .leading).background(SellerDemo.card, in: RoundedRectangle(cornerRadius: 24))
            HStack(alignment: .top, spacing: 12) {
                ForEach(benefits) { benefit in
                    DemoCard {
                        Image(systemName: benefit.symbol).font(.title3).foregroundStyle(accent)
                        Text(benefit.title).font(.callout.weight(.medium))
                        Text(benefit.text).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

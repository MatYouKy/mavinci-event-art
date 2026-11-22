import SwiftUI

// MARK: Sprzedawcy (`/crm/salespeople`) — kokpit opiekuna („Dziś”, oś w 5 etapach, wydarzenia, ostrzeżenia) i lista
// sprzedawców z kartą („Gotowość do pracy”, oferty na osi) i kreator „Nowy sprzedawca” (`NewSellerWizard.swift`). Tryb pokazowy
// „Pokaż portal hotelowi” (`/crm/salespeople/demo`) — `SellerDemoView.swift` w miejscu kokpitu.

@MainActor struct SellersView: View {
    enum Tab: String { case cockpit, sellers }
    @EnvironmentObject private var state: Workspace
    /// Okno tego widoku — rozmowa wskazana spoza ekranu otwiera się tylko w oknie, w którym pracuje użytkownik.
    @EnvironmentObject private var nav: WindowNavigation
    @Environment(\.crmTheme) private var theme
    @ObservedObject var store: SellersStore
    @State private var tab: Tab = .cockpit
    @State private var selectedSeller: String?
    @State private var helpShown = false
    @State private var query = ""
    @State private var responding: SellerCockpitState.Inquiry?
    @State private var converting: SellerCockpitState.Inquiry?
    @State private var newSellerShown = false
    /// Arkusz rozmów sprzedawcy otwarty z pozycji „Dziś”, powiadomienia albo karty kontaktu.
    @State private var chat: SellerChatRequest?

    var body: some View {
        VStack(spacing: 0) {
            if let request = store.demo {
                // „Zaproś hotel do portalu” z pokazu — kreator „Nowy sprzedawca” (jak `/crm/salespeople?new=1`).
                SellerDemoView(store: store, request: request, onInvite: { store.demo = nil; newSellerShown = true }, onExit: { store.demo = nil })
            } else {
                header
                Divider()
                if let data = store.cockpit {
                    switch tab {
                    case .cockpit: cockpit(data)
                    case .sellers: sellers(data)
                    }
                } else if let error = store.loadError {
                    ContentUnavailableView {
                        Label("Nie udało się wczytać sprzedawców", systemImage: "person.crop.circle.badge.exclamationmark")
                    } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.load() } } }
                } else {
                    ProgressView("Wczytywanie kokpitu opiekuna…").frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .navigationTitle("Sprzedawcy")
        .task {
            store.workspace = state
            chatRequested()
            if store.cockpit == nil { await store.load() }
            focusRequested()
            chatRequested()
        }
        .onChange(of: store.focusSellerContact) { _, _ in focusRequested() }
        .onChange(of: store.cockpit != nil) { _, loaded in if loaded { focusRequested() } }
        .onChange(of: store.chatRequest) { _, _ in chatRequested() }
        .onChange(of: store.loading) { _, loading in if !loading { chatRequested() } }
        .sheet(item: $chat) { request in
            SellerChatSheet(store: store, sellerID: request.sellerID ?? "", sellerName: request.name ?? "Sprzedawca", initialConversation: request.conversationID)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(isPresented: $helpShown) { SellersHelpSheet(store: store) }
        .sheet(isPresented: $newSellerShown) {
            NewSellerWizard(store: store) { result in
                Task {
                    await store.load()
                    if store.cockpit?.sellers.contains(where: { $0.id == result.id }) == true {
                        showSeller(result.id)
                    } else {
                        let card = result.contactId.map { "/crm/contacts/\($0)?tab=seller" } ?? "/crm/salespeople?seller=\(result.id)"
                        state.snack = Snack(kind: .info, text: "Sprzedawca dodany. Pojawi się na Twojej liście po przypisaniu opiekuna przez administratora.",
                                            action: Snack.Action(title: "Karta w CRM") { state.openCRM(card) })
                    }
                }
            }
        }
        .sheet(item: $responding) { inquiry in SellerInquiryRespondSheet(store: store, inquiry: inquiry) }
        .confirmationDialog("Utworzyć zapytanie CRM?", isPresented: Binding(get: { converting != nil }, set: { if !$0 { converting = nil } }), presenting: converting) { inquiry in
            Button("Utwórz zapytanie") {
                Task {
                    if let id = await store.convert(inquiry: inquiry.id) {
                        state.snack = Snack(kind: .success, text: "Utworzono zapytanie CRM dla klienta \(inquiry.guestName).",
                                            action: Snack.Action(title: "Otwórz") { state.open(.inquiries, id: id) })
                    }
                }
            }
            Button("Anuluj", role: .cancel) {}
        } message: { inquiry in
            Text("Powstanie zapytanie CRM z danymi klienta \(inquiry.guestName), przypisane do opiekuna sprzedawcy. Sprzedawca zobaczy status „Przekazane do zapytań”.")
        }
    }

    // MARK: Pasek

    private var header: some View {
        HStack(spacing: 12) {
            Picker("Widok", selection: $tab) {
                Text("Kokpit opiekuna").tag(Tab.cockpit)
                Text("Sprzedawcy").tag(Tab.sellers)
            }
            .pickerStyle(.segmented).labelsHidden().frame(maxWidth: 280)
            if let data = store.cockpit, data.viewer.isAdmin {
                Picker("Opiekun", selection: Binding(get: { store.managerFilter }, set: { value in
                    store.managerFilter = value
                    Task { await store.load() }
                })) {
                    Text("Wszyscy opiekunowie").tag("")
                    if let me = data.viewer.employeeId { Text("Przypisani do mnie").tag(me) }
                    ForEach(data.managers.filter { $0.id != data.viewer.employeeId }) { manager in
                        Text(manager.eligible ? manager.name : "\(manager.name) (bez uprawnień)").tag(manager.id)
                    }
                }
                .frame(maxWidth: 260)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
            Button { Task { await store.load(); if let id = selectedSeller { _ = try? await store.card(id) } } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                .disabled(store.loading).help("Odśwież kokpit")
            Button { helpShown = true } label: { Label("Instrukcja opiekuna", systemImage: "questionmark.circle") }
                .help("Instrukcja opiekuna sprzedawców — ta sama co znak „?” w CRM")
            Button { store.demo = SellerDemoRequest() } label: { Label("Pokaż portal hotelowi", systemImage: "rectangle.on.rectangle") }
                .help("Tryb pokazowy portalu sprzedawcy w barwach hotelu — niczego nie zapisuje ani nie wysyła")
            Button { newSellerShown = true } label: { Label("Dodaj sprzedawcę", systemImage: "person.badge.plus") }
                .help("Kreator „Nowy sprzedawca”: osoba, hotel i sale, warunki, opiekun, zaproszenie")
        }
        .labelStyle(.titleAndIcon)
        .padding(.horizontal, 14).frame(height: 48).crmBar()
    }

    // MARK: Kokpit

    private func cockpit(_ data: SellerCockpitState) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if data.empty {
                    emptyCockpit(data)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 12)], spacing: 12) {
                        ForEach(data.tiles) { tile in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(tile.label).font(.caption).foregroundStyle(.secondary)
                                Text(tile.value).font(.title2.weight(.light)).lineLimit(1).minimumScaleFactor(0.7)
                                Text(tile.helper).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).padding(14)
                            .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
                        }
                    }
                    if !data.warnings.isEmpty {
                        Label(data.warnings.count == 1 ? "1 ostrzeżenie wymaga uwagi — zobacz niżej" : "\(data.warnings.count) ostrzeżeń wymaga uwagi — zobacz niżej", systemImage: "exclamationmark.triangle")
                            .font(.callout).foregroundStyle(.orange)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                    }
                    if let error = data.priceRequestsError { Text(error).font(.caption).foregroundStyle(.orange) }
                    today(data)
                    stages(data)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 380), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                        upcoming(data)
                        warnings(data)
                    }
                }
            }
            .padding(20).frame(maxWidth: 1400, alignment: .leading)
        }
    }

    private func emptyCockpit(_ data: SellerCockpitState) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "building.2").font(.largeTitle).foregroundStyle(theme.accent)
            Text(data.viewer.isAdmin && !store.managerFilter.isEmpty ? "Ten opiekun nie ma jeszcze sprzedawców" : "Nie masz jeszcze przypisanych sprzedawców").font(.title3)
            Text(data.viewer.isAdmin
                 ? "Przypisz sprzedawców w ich karcie (Ustawienia → Opiekun i zastępca). Opiekun musi mieć uprawnienie do ofert i dostęp do marek sprzedawcy."
                 : "Sprzedawców zewnętrznych — pracowników hoteli i agencji — przypisuje Ci administrator. Gdy pozyskasz nowy hotel, pokaż mu portal i zaproś osobę kontaktową.")
                .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ForEach(Array(["Odwiedź hotel i pokaż portal w trybie pokazowym", "Dodaj osobę z hotelu jako sprzedawcę i wyślij zaproszenie",
                           "Administrator przypisuje Cię jako opiekuna", "Tu zobaczysz oferty, rozmowy i zapytania klientów"].enumerated()), id: \.offset) { index, step in
                HStack(alignment: .top, spacing: 10) {
                    Text("\(index + 1)").font(.caption.weight(.semibold)).frame(width: 22, height: 22).background(theme.accent.opacity(0.15), in: Circle()).foregroundStyle(theme.accent)
                    Text(step)
                }
            }
            HStack {
                Button("Pokaż portal hotelowi") { store.demo = SellerDemoRequest() }.buttonStyle(.borderedProminent)
                Button("Zaproś hotel do portalu") { newSellerShown = true }
            }
        }
        .padding(24).frame(maxWidth: 760, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func today(_ data: SellerCockpitState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Dziś").font(.title3.weight(.medium))
                countChip(data.todayCount, tone: "brand")
            }
            Text("Ceny do zgody, oferty do sprawdzenia, kroki realizacji, rozmowy i zapytania klientów od Twoich sprzedawców.")
                .font(.caption).foregroundStyle(.secondary)
            if data.todayCount == 0 {
                Label("Wszystko załatwione — żaden sprzedawca nie czeka teraz na Twoją decyzję ani odpowiedź.", systemImage: "checkmark.seal")
                    .foregroundStyle(.green).padding(16).frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                    ForEach(data.groups) { group in
                        SellerTodayGroupView(group: group, onOpen: { openTarget($0) }, respond: { responding = $0 }, convert: { converting = $0 })
                    }
                }
            }
        }
    }

    private func stages(_ data: SellerCockpitState) -> some View {
        let total = max(1, data.stages.reduce(0) { $0 + $1.count })
        return VStack(alignment: .leading, spacing: 10) {
            Text("Oferty na osi").font(.headline)
            Text("Te same pięć etapów widzi hotel w portalu: Oferta, U klienta, U opiekuna, Event (w portalu „Wydarzenie”), Rozliczenie.")
                .font(.caption).foregroundStyle(.secondary)
            GeometryReader { proxy in
                HStack(spacing: 2) {
                    ForEach(Array(data.stages.enumerated()), id: \.element.id) { index, stage in
                        if stage.count > 0 {
                            Rectangle().fill(theme.accent.opacity(0.35 + 0.13 * Double(index)))
                                .frame(width: max(6, proxy.size.width * CGFloat(stage.count) / CGFloat(total) - 2))
                                .help("\(stage.label): \(stage.count)")
                        }
                    }
                }
                .frame(width: proxy.size.width, alignment: .leading)
            }
            .frame(height: 10).background(Color.primary.opacity(0.06)).clipShape(Capsule())
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 10, alignment: .top)], alignment: .leading, spacing: 10) {
                ForEach(Array(data.stages.enumerated()), id: \.element.id) { index, stage in
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(index + 1). \(stage.label)").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                        Text("\(stage.count)").font(.title2.weight(.light))
                        Text(stage.detail).font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                    .help(stage.hint)
                }
            }
        }
        .padding(16).background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func upcoming(_ data: SellerCockpitState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Najbliższe eventy", systemImage: "calendar").font(.headline)
            Text("Realizacje sprzedawców w ciągu 14 dni.").font(.caption).foregroundStyle(.secondary)
            if data.upcoming.isEmpty {
                Text("Brak eventów w najbliższych dwóch tygodniach.").font(.callout).foregroundStyle(.secondary)
            } else {
                ForEach(data.upcoming) { event in
                    Button { state.showEvent(event.eventId, cardTab: nil) } label: {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.name).lineLimit(1)
                                Text("\(event.sellerName) · \(Labels.text(event.status))").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(Labels.date(event.date ?? "")).font(.caption).monospacedDigit()
                                Text(SellerDates.until(event.date)).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .padding(8).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func warnings(_ data: SellerCockpitState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Ostrzeżenia", systemImage: "exclamationmark.triangle").font(.headline)
            Text("Sprawy, które blokują sprzedaż albo wymagają kontaktu ze sprzedawcą.").font(.caption).foregroundStyle(.secondary)
            if data.warnings.isEmpty {
                Text("Brak ostrzeżeń — wszyscy sprzedawcy mają opiekuna, warunki i aktywne konto.").font(.callout).foregroundStyle(.green)
            } else {
                ForEach(Array(data.warnings.enumerated()), id: \.offset) { _, warning in
                    Button { showSeller(warning.sellerId) } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(warning.sellerName).font(.callout)
                                Text(warning.label).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Color.orange.opacity(0.12), in: Capsule()).foregroundStyle(.orange)
                            }
                            if !warning.message.isEmpty { Text(warning.message).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                        }
                        .padding(8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    .contextMenu { Button("Otwórz kartę w CRM") { state.openCRM(warning.href) } }
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Lista sprzedawców

    private func sellers(_ data: SellerCockpitState) -> some View {
        let term = query.trimmingCharacters(in: .whitespaces)
        let rows = data.sellers.filter { term.isEmpty || "\($0.name) \($0.organization ?? "") \($0.email ?? "")".localizedStandardContains(term) }
        return HStack(spacing: 0) {
            VStack(spacing: 0) {
                TextField("Szukaj sprzedawcy lub hotelu", text: $query).textFieldStyle(.roundedBorder).padding(10)
                List(rows, selection: $selectedSeller) { seller in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack {
                            Text(seller.name).font(.callout.weight(.medium)).lineLimit(1)
                            Spacer()
                            if !seller.warnings.isEmpty {
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.caption).help(seller.warnings.joined(separator: ", "))
                            }
                        }
                        Text(seller.organization ?? "Bez organizacji").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        Text("\(seller.portalLabel) · ofert: \(seller.offers.total)").font(.caption2).foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 3).tag(seller.id)
                }
                .overlay { if rows.isEmpty { ContentUnavailableView("Brak sprzedawców", systemImage: "person.2", description: Text(term.isEmpty ? "Nie masz przypisanych sprzedawców." : "Zmień wyszukiwanie.")) } }
            }
            .frame(width: 320)
            Divider()
            if let id = selectedSeller, let seller = data.sellers.first(where: { $0.id == id }) {
                SellerDetailView(store: store, seller: seller).id(id)
            } else {
                ContentUnavailableView("Wybierz sprzedawcę", systemImage: "person.crop.circle", description: Text("Karta pokaże gotowość do pracy, oferty na osi i realizacje."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    // MARK: Nawigacja

    private func showSeller(_ id: String) {
        tab = .sellers
        selectedSeller = id
    }

    /// Sprzedawca wskazany spoza ekranu (`Workspace.showSeller(contactID:)`): karta na liście; spoza listy opiekuna — karta w CRM.
    private func focusRequested() {
        guard let contactID = store.focusSellerContact, let data = store.cockpit else { return }
        store.focusSellerContact = nil
        if let seller = data.sellers.first(where: { $0.contactId == contactID }) {
            showSeller(seller.id)
        } else {
            state.snack = Snack(kind: .info, text: "Tego sprzedawcy nie ma na Twojej liście w kokpicie opiekuna.",
                                action: Snack.Action(title: "Karta w CRM") { state.openCRM("/crm/contacts/\(contactID)?tab=seller") })
        }
    }

    /// Rozmowa wskazana spoza karty (`SellerChatRequest`): arkusz rozmów w oknie, w którym pracuje użytkownik. Profil z żądania
    /// albo — dla odnośnika karty kontaktu — z listy kokpitu (czeka na jego wczytanie).
    private func chatRequested() {
        guard let request = store.chatRequest, state.activeNavigation === nav else { return }
        let sellers = store.cockpit?.sellers ?? []
        let ready = store.cockpit != nil || store.loadError != nil
        if let id = request.sellerID {
            // Nazwa do nagłówka — z żądania albo z kokpitu (po wczytaniu).
            if request.name == nil && !ready { return }
            store.chatRequest = nil
            var next = request
            next.name = request.name ?? sellers.first(where: { $0.id == id })?.name ?? "Sprzedawca"
            chat = next
        } else if let contactID = request.contactID {
            guard ready else { return }
            store.chatRequest = nil
            if let seller = sellers.first(where: { $0.contactId == contactID }) {
                chat = SellerChatRequest(sellerID: seller.id, contactID: contactID, name: seller.name, conversationID: request.conversationID)
            } else {
                let href = "/crm/contacts/\(contactID)?tab=seller&section=chat" + (request.conversationID.map { "&conversation=\($0)" } ?? "")
                state.snack = Snack(kind: .info, text: "Tego sprzedawcy nie ma na Twojej liście w kokpicie opiekuna.",
                                    action: Snack.Action(title: "Rozmowa w CRM") { state.openCRM(href) })
            }
        } else {
            store.chatRequest = nil
        }
    }

    private func openTarget(_ target: SellerCockpitState.Target) {
        switch target.kind {
        case "offer": if let id = target.id { state.open(.offers, id: id) } else { state.openCRM(target.href) }
        case "event": if let id = target.id { state.showEvent(id, cardTab: target.tab) } else { state.openCRM(target.href) }
        case "chat":
            // „Rozmowy czekające na odpowiedź” — arkusz rozmów sprzedawcy z tą rozmową (nazwa z pozycji „Dziś”).
            let name = store.cockpit?.groups.flatMap(\.items).first(where: { $0.target == target })?.title
            if let seller = target.seller, UUID(uuidString: seller) != nil {
                store.chatRequest = SellerChatRequest(sellerID: seller, contactID: nil, name: name, conversationID: target.id)
            } else if var request = SellerChatRequest(href: target.href) {
                request.name = name
                store.chatRequest = request
            } else {
                state.openCRM(target.href)
            }
        default:
            // Starszy serwer: rozmowa jako odnośnik CRM (`…&section=chat&conversation=…`) — także w aplikacji.
            if let request = SellerChatRequest(href: target.href) { store.chatRequest = request } else { state.openCRM(target.href) }
        }
    }

    private func countChip(_ count: Int, tone: String) -> some View {
        Text("\(count)").font(.caption.weight(.semibold)).monospacedDigit()
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(SellerTone.color(tone, accent: theme.accent).opacity(0.15), in: Capsule())
            .foregroundStyle(SellerTone.color(tone, accent: theme.accent))
    }
}

/// Grupa „Dziś” (karta z pierwszymi czterema sprawami i „Pokaż wszystkie”).
@MainActor struct SellerTodayGroupView: View {
    let group: SellerCockpitState.TodayGroup
    let onOpen: (SellerCockpitState.Target) -> Void
    let respond: (SellerCockpitState.Inquiry) -> Void
    let convert: (SellerCockpitState.Inquiry) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var expanded = false
    private let visible = 4

    var body: some View {
        let tone = SellerTone.color(group.tone, accent: theme.accent)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: group.symbol).foregroundStyle(tone).frame(width: 26, height: 26).background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
                Text(group.title).font(.callout.weight(.medium)).lineLimit(1)
                Spacer()
                Text("\(group.items.count)").font(.caption.weight(.semibold)).monospacedDigit().foregroundStyle(group.items.isEmpty ? .secondary : tone)
            }
            if group.items.isEmpty {
                Label(group.empty, systemImage: "checkmark").font(.caption).foregroundStyle(.secondary).padding(.vertical, 6)
            } else {
                ForEach(expanded ? group.items : Array(group.items.prefix(visible))) { item in row(item) }
                if group.items.count > visible {
                    Button(expanded ? "Zwiń" : "Pokaż wszystkie (\(group.items.count))") { expanded.toggle() }.buttonStyle(.link).font(.caption)
                }
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func row(_ item: SellerCockpitState.Item) -> some View {
        let content = HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title).font(.callout).lineLimit(1)
                ForEach(Array(item.meta.enumerated()), id: \.offset) { _, line in
                    if !line.isEmpty { Text(line).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                if let quote = item.quote, !quote.isEmpty { Text("„\(quote)”").font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                if let badges = item.badges, !badges.isEmpty {
                    HStack(spacing: 4) {
                        ForEach(badges, id: \.self) { badge in
                            Text(badge.text).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                                .background(SellerTone.color(badge.tone, accent: theme.accent).opacity(0.12), in: Capsule())
                                .foregroundStyle(SellerTone.color(badge.tone, accent: theme.accent))
                        }
                    }
                }
                if let inquiry = item.inquiry {
                    HStack(spacing: 8) {
                        Button("Odpowiedz") { respond(inquiry) }
                        Button("Utwórz zapytanie CRM") { convert(inquiry) }
                    }
                    .controlSize(.small).padding(.top, 4).disabled(!state.canWrite)
                }
            }
            Spacer(minLength: 4)
            if let side = item.side ?? sideDate(item) {
                Text(side).font(.caption2).foregroundStyle(SellerTone.color(item.sideTone, accent: theme.accent)).lineLimit(1)
            }
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
        if let target = item.target {
            Button { onOpen(target) } label: { content }
                .buttonStyle(.plain)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                .contextMenu { Button("Otwórz w CRM") { state.openCRM(target.href) } }
        } else {
            content.background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func sideDate(_ item: SellerCockpitState.Item) -> String? {
        guard let at = item.at, !at.isEmpty else { return nil }
        return item.atStyle == "until" ? SellerDates.until(at) : SellerDates.relative(at)
    }
}

/// Odpowiedź na zapytanie klienta od sprzedawcy — jak „Odpowiedz” w kokpicie CRM.
@MainActor struct SellerInquiryRespondSheet: View {
    @ObservedObject var store: SellersStore
    let inquiry: SellerCockpitState.Inquiry
    @Environment(\.dismiss) private var dismiss
    @State private var status = "answered"
    @State private var response = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Odpowiedz sprzedawcy").font(.title3)
            Text("Zapytanie klienta: \(inquiry.guestName). Sprzedawca dostanie powiadomienie z odpowiedzią.").foregroundStyle(.secondary)
            Picker("Status", selection: $status) {
                Text("Odpowiedziano").tag("answered")
                Text("W toku").tag("in_progress")
                Text("Zamknięte").tag("closed")
            }
            .frame(maxWidth: 280)
            VStack(alignment: .leading, spacing: 4) {
                Text(status == "answered" ? "Odpowiedź dla sprzedawcy" : "Odpowiedź dla sprzedawcy (opcjonalnie)").font(.caption).foregroundStyle(.secondary)
                TextEditor(text: $response).font(.body).frame(minHeight: 120)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
            }
            if let error { Text(error).foregroundStyle(.red).font(.callout) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz") {
                    let text = response.trimmingCharacters(in: .whitespacesAndNewlines)
                    if status == "answered" && text.isEmpty { error = "Wpisz odpowiedź, aby oznaczyć zapytanie jako odpowiedziane."; return }
                    saving = true
                    Task {
                        error = await store.respond(inquiry: inquiry.id, status: status, response: text)
                        saving = false
                        if error == nil { dismiss() }
                    }
                }
                .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(22).frame(width: 520)
    }
}

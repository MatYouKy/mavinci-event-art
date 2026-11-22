import SwiftUI

// MARK: Ustalenia ze sprzedawcą (1:1 z `EventSellerCorrespondence`): oferty sprzedawców powiązane z wydarzeniem (wyszukiwanie,
// nieprzeczytane), oferta źródłowa, przygotowanie wydarzenia z potwierdzeniem realizacji, kreator przygotowań krok po kroku,
// dodatkowe ustalenia realizacji (baza hotelu, dni i godziny, kontakty), prowizja opiekuna (Podsumowanie) i rozmowa o realizacji
// (wiadomości, starsze, wysyłka bez duplikatów, odczyt). Niezapisane dane kroku lub ustaleń chronione przy zmianie oferty.

struct SellerTabData: Decodable {
    struct Conversation: Decodable, Hashable { var id: String; var title: String; var brandName: String; var lastMessage: String?; var lastAt: String?; var unread: Int; var canSend: Bool }
    struct Offer: Decodable, Identifiable, Hashable {
        var id: String; var number: String?; var title: String?; var partnerId: String; var partnerName: String; var brandName: String
        var companyId: String; var canStart: Bool; var conversation: Conversation?
        var label: String { number?.nonEmpty ?? title?.nonEmpty ?? "Oferta" }
    }
    var error: String?
    var offers: [Offer]
}

private struct SellerMessages: Decodable {
    struct Message: Decodable, Identifiable, Hashable { var id: String; var seq: Int; var crm: Bool; var sender: String; var body: String; var createdAt: String; var own: Bool }
    var messages: [Message]
}

@MainActor struct EventSellerTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    /// Przejście do innej zakładki tej samej karty (bez ponownego otwierania wydarzenia).
    var navigate: ((String) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    /// Nawigacja okna, w którym jest widok (inne okna mają własną).
    @EnvironmentObject private var nav: WindowNavigation
    @Environment(\.crmTheme) private var theme
    @State private var selectedID: String?
    @State private var query = ""
    @State private var opening = false
    @State private var arrangementsDirty = false
    @State private var wizardDirty = false
    /// Odświeżenie kreatora i ustaleń po zapisie, potwierdzeniu realizacji albo powrocie do aplikacji (`seller-workspace-changed`).
    @State private var refreshKey = 0
    @State private var pendingOfferID: String?
    @State private var focusStep: String?
    /// „Dodatkowe ustalenia CRM” — zwinięte jak `<details>`; z niezapisanymi zmianami nie zwijamy (formularz zostaje).
    @State private var arrangementsExpanded = false

    private var data: SellerTabData? { store.tab(eventID, "seller-arrangements", as: SellerTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|seller-arrangements"] {
                ContentUnavailableView {
                    Label("Nie udało się wczytać ustaleń", systemImage: "bubble.left.and.bubble.right")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "seller-arrangements") } } }
            } else {
                VStack(spacing: 8) {
                    ProgressView()
                    Text("Wczytywanie ustaleń…").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) {
            await store.loadTab(eventID, "seller-arrangements")
            applyFocus()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if NSApplication.shared.isActive { await store.loadTab(eventID, "seller-arrangements") }
            }
        }
        .onChange(of: nav.sellerFocus) { _, _ in applyFocus() }
        .onChange(of: data?.offers.count) { _, _ in applyFocus() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in refreshKey += 1 }
        .alert("Zmienić ofertę i porzucić niezapisane dane przygotowań?", isPresented: Binding(get: { pendingOfferID != nil }, set: { if !$0 { pendingOfferID = nil } })) {
            Button("Zmień ofertę", role: .destructive) {
                arrangementsDirty = false
                wizardDirty = false
                selectedID = pendingOfferID
                pendingOfferID = nil
            }
            Button("Anuluj", role: .cancel) { pendingOfferID = nil }
        }
    }

    /// Zmiana oferty pyta o porzucenie niezapisanych danych kroku lub ustaleń (jak `selectOffer` w CRM).
    private func choose(_ id: String?, current: String?) {
        guard let id, id != current else { return }
        if arrangementsDirty || wizardDirty { pendingOfferID = id; return }
        selectedID = id
    }

    /// Oferta, rozmowa i krok wskazane w powiadomieniu — po wczytaniu listy ofert tej karty.
    private func applyFocus() {
        guard let focus = nav.sellerFocus, focus.eventID == eventID, let offers = data?.offers, !offers.isEmpty else { return }
        let target = offers.first { $0.id == focus.offerID } ?? offers.first { $0.conversation?.id != nil && $0.conversation?.id == focus.conversationID }
        nav.sellerFocus = nil
        guard let target else { return }
        focusStep = focus.step
        if arrangementsDirty || wizardDirty {
            if target.id != (selectedID ?? offers.first?.id) { pendingOfferID = target.id }
        } else {
            selectedID = target.id
        }
    }

    /// Oferty sprzedawców jako natywna lista z boku (gdy jest ich kilka), po prawej ustalenia z oferty i rozmowa.
    @ViewBuilder private func content(_ data: SellerTabData) -> some View {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let visible = data.offers.filter { offer in
            needle.isEmpty || [offer.number ?? "", offer.title ?? "", offer.partnerName, offer.brandName].joined(separator: " ").lowercased().contains(needle)
        }
        let selected = data.offers.first { $0.id == selectedID } ?? data.offers.first
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Ustalenia").font(.title2.weight(.semibold))
                Text("ustalenia z oferty sprzedawcy i rozmowa o realizacji").foregroundStyle(.secondary).lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 18).padding(.top, 12)
            if let error = data.error { Text(error).foregroundStyle(.red).padding(.horizontal, 18) }
            if data.error == nil && data.offers.isEmpty {
                ContentUnavailableView("Brak powiązanych ofert sprzedawców", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("Po powiązaniu oferty sprzedawcy z eventem jej ustalenia i korespondencja pojawią się tutaj automatycznie."))
            } else {
                HStack(spacing: 0) {
                    if data.offers.count > 1 {
                        VStack(spacing: 6) {
                            TextField("Szukaj oferty lub sprzedawcy…", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 10).padding(.top, 8)
                            List(visible, selection: Binding(get: { selected?.id }, set: { choose($0, current: selected?.id) })) { offer in
                                offerRow(offer).tag(offer.id)
                            }
                            .listStyle(.sidebar)
                            .scrollContentBackground(.hidden)
                        }
                        .frame(width: 280)
                        .background(Color.primary.opacity(0.03))
                    }
                    ScrollView {
                        VStack(alignment: .leading, spacing: 14) {
                            EventArrangementsCard(store: store, eventID: eventID)
                            if let selected { offerPanel(selected) }
                        }
                        .padding(18)
                    }
                }
            }
        }
    }

    private func offerRow(_ offer: SellerTabData.Offer) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Text(offer.label).fontWeight(.medium).lineLimit(1)
                Spacer(minLength: 4)
                if let unread = offer.conversation?.unread, unread > 0 {
                    Text("\(unread)").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1)
                        .background(theme.accent, in: Capsule()).foregroundStyle(.black).help("Nowe wiadomości")
                }
            }
            Text(offer.partnerName + " · " + offer.brandName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            Text(offer.conversation?.lastMessage ?? "Brak wiadomości").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
        }
        .padding(.vertical, 3)
    }

    private func picker(_ offers: [SellerTabData.Offer], _ selected: SellerTabData.Offer?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Szukaj oferty lub sprzedawcy…", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 360)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(offers) { offer in
                        Button { choose(offer.id, current: selected?.id) } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(offer.label).font(.callout.weight(.medium))
                                    if let unread = offer.conversation?.unread, unread > 0 {
                                        Text("\(unread)").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1).background(theme.accent, in: Capsule()).foregroundStyle(.black)
                                            .help("Nowe wiadomości")
                                    }
                                }
                                Text(offer.partnerName + " · " + offer.brandName).font(.caption).foregroundStyle(.secondary)
                                Text(offer.conversation?.lastMessage ?? "Brak wiadomości").font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                            }
                            .padding(10).frame(width: 240, alignment: .leading)
                            .background(selected?.id == offer.id ? theme.accent.opacity(0.18) : theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 10))
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    if offers.isEmpty { Text("Brak pasujących ofert.").font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private func offerPanel(_ offer: SellerTabData.Offer) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(offer.partnerName + " · " + offer.brandName).font(.callout).foregroundStyle(.secondary)
                    Button("Oferta źródłowa: " + offer.label) { openOffer(offer.id) }.buttonStyle(.link).linkCursor()
                    Text("Ustalenia są wspólne z ofertą — nie tworzymy osobnej kopii. Ich zapis nie cofa akceptacji i nie zmienia automatycznie harmonogramu eventu.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                SellerPreparationPanel(store: store, eventID: eventID, offerID: offer.id, go: go) {
                    refreshKey += 1
                    await store.loadTab(eventID, "seller-arrangements")
                    await store.load(eventID)
                    await store.loadDetails(eventID)
                }
                .id("preparation:" + offer.id)
                SellerRealizationWizardView(store: store, eventID: eventID, offerID: offer.id, refreshKey: refreshKey, blocked: arrangementsDirty,
                                            dirty: $wizardDirty, focusStep: focusStep, go: go) { refreshKey += 1 }
                    .id("wizard:" + offer.id)
                DisclosureGroup(isExpanded: Binding(get: { arrangementsExpanded }, set: { open in
                    if open || !arrangementsDirty { arrangementsExpanded = open }
                })) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Zmiany terminu, miejsca i wymagań mogą wymagać ponownego potwierdzenia odpowiednich kroków. Dane osoby na miejscu zatwierdzaj w kreatorze powyżej.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                        SellerOfferArrangementsView(store: store, eventID: eventID, offerID: offer.id, refreshKey: refreshKey, dirty: $arrangementsDirty, go: go) {
                            refreshKey += 1
                            await store.loadTab(eventID, "seller-arrangements")
                        }
                        .id("arrangements:" + offer.id)
                    }
                    .padding(.top, 8)
                } label: {
                    Text("Dodatkowe ustalenia CRM").font(.headline).foregroundStyle(theme.accent)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 6) {
                    Label("Prowizja opiekuna", systemImage: "function").font(.headline)
                    Text("Prowizję opiekuna liczy teraz zakładka Podsumowanie w evencie (udział sprzedawcy, 5% / 10% od zysku).").font(.caption).foregroundStyle(.secondary)
                    Button { go("summary") } label: { Label("Otwórz podsumowanie eventu", systemImage: "arrow.right") }.buttonStyle(.link).linkCursor()
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            conversation(offer).frame(width: 440)
        }
    }

    @ViewBuilder private func conversation(_ offer: SellerTabData.Offer) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Rozmowa o realizacji", systemImage: "message").font(.headline)
            Text("Kontynuujcie ten sam wątek — cała historia oferty pozostaje tutaj. Wiadomości nie zmieniają decyzji o akceptacji ani potwierdzeniu eventu.")
                .font(.caption).foregroundStyle(.secondary)
            if let conversation = offer.conversation {
                SellerConversationView(store: store, eventID: eventID, conversation: conversation).id(conversation.id)
            } else {
                Text("Nie ma jeszcze wiadomości. Rozmowa będzie wspólna dla oferty i tej realizacji.").font(.callout).foregroundStyle(.secondary)
                if offer.canStart {
                    Button { Task { await start(offer) } } label: { Label(opening ? "Otwieranie rozmowy…" : "Rozpocznij rozmowę", systemImage: "message") }
                        .buttonStyle(.borderedProminent).disabled(opening)
                } else {
                    Text("Masz dostęp tylko do odczytu. Rozmowę może rozpocząć sprzedawca lub uprawniony opiekun.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func start(_ offer: SellerTabData.Offer) async {
        opening = true
        defer { opening = false }
        do {
            try await store.tabAction(eventID, "seller-arrangements", "open", ["offerId": .string(offer.id)], reload: ["seller-arrangements"], success: nil, pending: "Otwieranie rozmowy…")
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć rozmowy. Sprawdź uprawnienia do tej marki i spróbuj ponownie.")
        }
    }

    private func go(_ tab: String) {
        if let navigate { navigate(tab) } else { state.showEvent(eventID, cardTab: tab) }
    }

    private func openOffer(_ id: String) {
        state.showOffer(id)
    }
}

/// Rozmowa (`ConversationMessages`): 50 ostatnich wiadomości, starsze na żądanie, odczyt po wyświetleniu, wysyłka z identyfikatorem
/// (ponowienie nie dubluje), Enter — wyślij, Shift+Enter — nowa linia.
@MainActor private struct SellerConversationView: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let conversation: SellerTabData.Conversation
    @Environment(\.crmTheme) private var theme
    @State private var messages: [SellerMessages.Message] = []
    @State private var loading = true
    @State private var hasOlder = false
    @State private var older = false
    @State private var text = ""
    @State private var sending = false
    @State private var error = ""
    @State private var pending: (id: String, text: String)?
    @State private var readThrough = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(conversation.brandName + " · Ustalenia realizacji · kontynuacja oferty").font(.caption).foregroundStyle(.secondary)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if hasOlder {
                            Button(older ? "Wczytywanie…" : "Pokaż starsze wiadomości") { Task { await loadOlder() } }.buttonStyle(.link).linkCursor().disabled(older)
                        }
                        if loading { Text("Wczytywanie rozmowy…").font(.caption).foregroundStyle(.secondary) }
                        if !loading && messages.isEmpty { Text("Napisz pierwszą wiadomość. Rozmowa pozostanie w historii sprzedawcy.").font(.caption).foregroundStyle(.secondary) }
                        ForEach(messages) { message in bubble(message).id(message.id) }
                    }
                    .padding(8)
                }
                .frame(minHeight: 320, maxHeight: 480)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
                .onChange(of: messages.last?.id) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } }
            }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
            if conversation.canSend {
                TextField("Odpowiedź widoczna dla sprzedawcy…", text: $text, axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.roundedBorder).disabled(sending)
                    .onSubmit { Task { await send() } }
                HStack {
                    Text("Enter — wyślij · Shift+Enter — nowa linia. Wiadomości zachowują autora i datę. Nie można ich edytować ani usuwać.").font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Button { Task { await send() } } label: { Label("Wyślij", systemImage: "paperplane") }
                        .buttonStyle(.borderedProminent).disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                Text("Masz dostęp do odczytu tej rozmowy.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .task {
            await reload()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if NSApplication.shared.isActive { await reload() }
            }
        }
    }

    private func bubble(_ message: SellerMessages.Message) -> some View {
        let tint: Color = message.crm ? theme.accent : CrmTheme.rgb(0x60a5fa)
        let when: String = MeetingDates.parse(message.createdAt).map { MeetingDates.format($0, "dd.MM.yyyy, HH:mm:ss") } ?? message.createdAt
        return HStack {
            if message.own { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 4) {
                (Text(message.sender).font(.caption.weight(.semibold)) + Text(" · " + (message.crm ? "MAVINCI" : "Sprzedawca")).font(.caption).foregroundColor(.secondary))
                Text(message.body).font(.callout).textSelection(.enabled)
                Text(when).font(.caption2).foregroundStyle(.secondary)
            }
            .padding(10).background(tint.opacity(message.own ? 0.18 : 0.08), in: RoundedRectangle(cornerRadius: 10))
            if !message.own { Spacer(minLength: 40) }
        }
    }

    /// Czynność bez paska postępu (wysyłka i odczyt dzieją się w tle rozmowy).
    private func quiet(_ action: String, _ body: [String: JSONValue]) async throws {
        guard let api = store.api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string("tabAction")
        payload["id"] = .string(eventID)
        payload["tab"] = .string("seller-arrangements")
        payload["action"] = .string(action)
        _ = try await api.post("/events/card", payload)
    }

    private func merge(_ rows: [SellerMessages.Message]) {
        var byID: [String: SellerMessages.Message] = [:]
        for message in messages + rows { byID[message.id] = message }
        messages = byID.values.sorted { $0.seq < $1.seq }
    }

    private func reload() async {
        do {
            let reply = try await store.tabQuery(eventID, "seller-arrangements", "messages", ["conversationId": conversation.id], as: SellerMessages.self)
            if loading { hasOlder = reply.messages.count == 50 }
            loading = false
            merge(reply.messages)
            error = ""
            let newest = messages.last?.seq ?? 0
            if newest > readThrough && NSApplication.shared.isActive {
                try? await quiet("read", ["conversationId": .string(conversation.id), "through": .number(Double(newest))])
                readThrough = newest
            }
        } catch {
            loading = false
            self.error = "Nie udało się wczytać rozmowy. Ponowimy za chwilę."
        }
    }

    private func loadOlder() async {
        guard let first = messages.first else { return }
        older = true
        defer { older = false }
        do {
            let reply = try await store.tabQuery(eventID, "seller-arrangements", "messages", ["conversationId": conversation.id, "before": String(first.seq)], as: SellerMessages.self)
            hasOlder = reply.messages.count == 50
            merge(reply.messages)
        } catch {
            self.error = "Nie udało się wczytać starszych wiadomości."
        }
    }

    private func send() async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending, conversation.canSend else { return }
        sending = true
        error = ""
        defer { sending = false }
        if pending == nil || pending?.text != body { pending = (id: UUID().uuidString.lowercased(), text: body) }
        guard let id = pending?.id else { return }
        do {
            try await quiet("send", ["conversationId": .string(conversation.id), "messageId": .string(id), "body": .string(body)])
            pending = nil
            text = ""
            await reload()
        } catch {
            self.error = store.failureText(error, "Nie potwierdzono wysyłki. Możesz ponowić; wiadomość nie zostanie zdublowana.")
        }
    }
}

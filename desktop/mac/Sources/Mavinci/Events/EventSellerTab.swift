import SwiftUI

// MARK: Ustalenia ze sprzedawcą (1:1 z `EventSellerCorrespondence`): oferty sprzedawców powiązane z wydarzeniem (wyszukiwanie,
// nieprzeczytane), oferta źródłowa, przygotowanie wydarzenia (przejścia do zakładek), prowizja opiekuna (Podsumowanie) i rozmowa
// o realizacji (wiadomości, starsze, wysyłka bez duplikatów, odczyt). Kreator realizacji i dodatkowe ustalenia — w CRM.

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
    @Environment(\.crmTheme) private var theme
    @State private var selectedID: String?
    @State private var query = ""
    @State private var opening = false

    private var data: SellerTabData? { store.tab(eventID, "seller-arrangements", as: SellerTabData.self) }

    private static let sections: [(String, String, String)] = [
        ("phases", "Timeline", "Godziny i etapy pracy"), ("team", "Zespół", "Pracownicy i zaproszenia"), ("equipment", "Sprzęt", "Plan, braki i rezerwacje"),
        ("agenda", "Agenda", "Program wydarzenia"), ("logistics", "Logistyka", "Transport, kierowcy i przejazdy"), ("finances", "Finanse i prowizje", "Planowane rozliczenia i wypłaty"),
    ]

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
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if NSApplication.shared.isActive { await store.loadTab(eventID, "seller-arrangements") }
            }
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
                                       description: Text("Po powiązaniu oferty sprzedawcy z wydarzeniem jej ustalenia i korespondencja pojawią się tutaj automatycznie."))
            } else {
                HStack(spacing: 0) {
                    if data.offers.count > 1 {
                        VStack(spacing: 6) {
                            TextField("Szukaj oferty lub sprzedawcy…", text: $query).textFieldStyle(.roundedBorder).padding(.horizontal, 10).padding(.top, 8)
                            List(visible, selection: Binding(get: { selected?.id }, set: { selectedID = $0 })) { offer in
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
                        Button { selectedID = offer.id } label: {
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
                    Text("Ustalenia są wspólne z ofertą — nie tworzymy osobnej kopii. Ich zapis nie cofa akceptacji i nie zmienia automatycznie harmonogramu wydarzenia.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                preparation(offer)
                VStack(alignment: .leading, spacing: 8) {
                    Text("Dodatkowe ustalenia CRM i kreator realizacji").font(.headline)
                    Text("Zmiany terminu, miejsca i wymagań mogą wymagać ponownego potwierdzenia odpowiednich kroków. Dane osoby na miejscu zatwierdzaj w kreatorze realizacji.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button { state.openCRM("/crm/events/\(eventID)?tab=seller-arrangements&offer=\(offer.id)") } label: { Label("Otwórz ustalenia w CRM", systemImage: "safari") }
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 6) {
                    Label("Prowizja opiekuna", systemImage: "function").font(.headline)
                    Text("Prowizję opiekuna liczy teraz zakładka Podsumowanie w wydarzeniu (udział sprzedawcy, 5% / 10% od zysku).").font(.caption).foregroundStyle(.secondary)
                    Button { go("summary") } label: { Label("Otwórz podsumowanie wydarzenia", systemImage: "arrow.right") }.buttonStyle(.link).linkCursor()
                }
                .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
            }
            .frame(maxWidth: .infinity, alignment: .topLeading)
            conversation(offer).frame(width: 440)
        }
    }

    private func preparation(_ offer: SellerTabData.Offer) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Przygotowanie wydarzenia z oferty", systemImage: "calendar").font(.headline)
            Text("Wydarzenie jest powiązane z ofertą. Dalsze przygotowanie prowadzisz w standardowych sekcjach CRM.").font(.callout).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 8)], spacing: 8) {
                ForEach(Self.sections, id: \.0) { section in
                    Button { go(section.0) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(section.1).font(.callout.weight(.medium))
                            Text(section.2).font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            Text("Zakres sprzętu pochodzi z produktów i konfiguracji oferty. Linie planowane nie rezerwują egzemplarzy. Zespół i pojazdy wybierasz w CRM; nie wysyłamy zaproszeń przy samej akceptacji. Prowizja jest planowana tylko przy włączonym modelu prowizyjnym — nie jest wypłatą.")
                .font(.caption2).foregroundStyle(.secondary)
            Button { state.openCRM("/crm/events/\(eventID)?tab=seller-arrangements&offer=\(offer.id)") } label: { Label("Potwierdzenie realizacji (gdy oczekuje) — w CRM", systemImage: "checkmark.seal") }
                .buttonStyle(.link).linkCursor().font(.caption)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func conversation(_ offer: SellerTabData.Offer) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Rozmowa o realizacji", systemImage: "message").font(.headline)
            Text("Kontynuujcie ten sam wątek — cała historia oferty pozostaje tutaj. Wiadomości nie zmieniają decyzji o akceptacji ani potwierdzeniu wydarzenia.")
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
        if state.native.meta("offers") != nil || state.native.records["offers"] != nil { state.showNative("offers", focus: id) }
        else { state.openCRM("/crm/offers/\(id)") }
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

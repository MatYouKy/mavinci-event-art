import SwiftUI
import AppKit

// MARK: Karta sprzedawcy — „Rozmowy ze sprzedawcą” 1:1 z `SellerChatPanel` w CRM (rozmowa ogólna z każdą marką i osobne wątki
// ofert / realizacji, nowe rozmowy dla marek z prawem pisania, wyszukiwanie, nieprzeczytane, 50 ostatnich wiadomości ze starszymi
// na żądanie, wysyłka bez dublowania, odczyt po wyświetleniu, odświeżanie co 15 s) oraz „Historia zmian” (`SellerAuditHistory`).
// Serwer: `/bridge/native/v1/sellers` (`conversations`, `messages`, `audit`, `chatOpen`, `chatSend`, `chatRead` —
// `src/lib/native/sellerChat.ts`).

struct SellerChatData: Decodable {
    struct Thread: Decodable, Identifiable, Equatable {
        var id: String
        var companyId: String
        var brandName: String
        var offerId: String?
        var title: String
        var offerTitle: String?
        var hasEvent: Bool
        var eventId: String?
        var eventName: String?
        var canViewEvent: Bool
        var lastMessage: String?
        var lastAt: String?
        var unread: Int
        var canSend: Bool
    }
    struct Brand: Decodable, Identifiable, Equatable { var id: String; var name: String; var canChat: Bool }
    struct Offer: Decodable, Identifiable, Equatable { var id: String; var companyId: String; var title: String?; var number: String? }
    var threads: [Thread]
    var brands: [Brand]
    var offers: [Offer]
}

struct SellerChatMessage: Decodable, Identifiable, Equatable { var id: String; var seq: Int; var crm: Bool; var sender: String; var body: String; var createdAt: String; var own: Bool }

@MainActor enum SellerChatAPI {
    static func get<T: Decodable>(_ store: SellersStore, _ query: [String: String], as type: T.Type) async throws -> T {
        guard let api = store.api else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/sellers", query: query))
    }
    @discardableResult static func post(_ store: SellersStore, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api = store.api else { throw AppError.configuration }
        let raw = try await api.post("/sellers", body)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: raw)) ?? [:]
    }
}

/// Licznik nowych wiadomości (`SellerCountBadge`).
private struct SellerUnreadBadge: View {
    let count: Int
    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)").font(.caption2.weight(.semibold)).monospacedDigit()
                .padding(.horizontal, 6).padding(.vertical, 1).foregroundStyle(.white).background(Color.red, in: Capsule())
                .help("Nowe wiadomości")
        }
    }
}

// MARK: Rozmowy

@MainActor struct SellerChatSheet: View {
    @ObservedObject var store: SellersStore
    let seller: SellerCockpitState.Seller
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    enum Layer: String { case general, offer }
    @State private var data: SellerChatData?
    @State private var loading = true
    @State private var error = ""
    @State private var layer: Layer = .general
    @State private var selectedID: String?
    @State private var companyID = ""
    @State private var offerID = ""
    @State private var query = ""
    @State private var starting = false

    private var threads: [SellerChatData.Thread] { data?.threads ?? [] }
    private var layerThreads: [SellerChatData.Thread] { threads.filter { ($0.offerId != nil) == (layer == .offer) } }
    private var visibleThreads: [SellerChatData.Thread] {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else { return layerThreads }
        return layerThreads.filter { "\($0.title) \($0.offerTitle ?? "") \($0.eventName ?? "") \($0.brandName)".lowercased().contains(needle) }
    }
    private var selected: SellerChatData.Thread? { layerThreads.first { $0.id == selectedID } ?? visibleThreads.first }
    private var writableBrands: [SellerChatData.Brand] { (data?.brands ?? []).filter(\.canChat) }
    private var brandOffers: [SellerChatData.Offer] { (data?.offers ?? []).filter { $0.companyId == companyID } }
    private var canStart: Bool {
        writableBrands.contains { $0.id == companyID } && (layer == .general || brandOffers.contains { $0.id == offerID })
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Rozmowy ze sprzedawcą", systemImage: "bubble.left.and.bubble.right").font(.title3.bold())
                    Text("\(seller.name) · Oddzielamy bieżący kontakt od ustaleń do konkretnych zleceń. Każda rozmowa pozostaje w obrębie swojej marki.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            HStack(alignment: .top, spacing: 0) {
                sidebar.frame(width: 320)
                Divider()
                Group {
                    if let thread = selected {
                        SellerConversationPane(store: store, thread: thread) { Task { await reload() } }.id(thread.id)
                    } else {
                        ContentUnavailableView("Wybierz rozmowę lub rozpocznij nową.", systemImage: "bubble.left")
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(minWidth: 940, idealWidth: 1080, minHeight: 620, idealHeight: 760)
        .background(theme.page)
        .task {
            await reload()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if NSApplication.shared.isActive { await reload() }
            }
        }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("", selection: Binding(get: { layer }, set: { layer = $0; selectedID = nil; query = "" })) {
                Text(label("Rozmowa ogólna", .general)).tag(Layer.general)
                Text(label("Oferty i realizacje", .offer)).tag(Layer.offer)
            }
            .pickerStyle(.segmented).labelsHidden()
            Text(layer == .general
                 ? "Jedna rozmowa ogólna dla każdej marki. Do ustaleń dotyczących konkretnego zlecenia użyj zakładki „Oferty i realizacje”."
                 : "Osobny wątek każdej oferty. Po powiązaniu oferty z wydarzeniem ten sam wątek pojawi się w jego zakładce „Ustalenia”, bez kopiowania ani utraty historii.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if !writableBrands.isEmpty { starter }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
            TextField("Szukaj rozmowy…", text: $query).textFieldStyle(.roundedBorder)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if loading && data == nil { Text("Wczytywanie rozmów…").font(.caption).foregroundStyle(.secondary) }
                    ForEach(visibleThreads) { thread in threadRow(thread) }
                    if !loading && visibleThreads.isEmpty {
                        Text(query.isEmpty ? "Nie ma jeszcze rozmów w tej sekcji." : "Brak pasujących rozmów.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(14)
    }

    private func label(_ text: String, _ value: Layer) -> String {
        let unread = threads.filter { ($0.offerId != nil) == (value == .offer) }.reduce(0) { $0 + $1.unread }
        return unread > 0 ? "\(text) (\(unread))" : text
    }

    private var starter: some View {
        VStack(alignment: .leading, spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(writableBrands) { brand in
                        Button { companyID = brand.id; offerID = "" } label: {
                            Text(brand.name).font(.caption).padding(.horizontal, 10).padding(.vertical, 4)
                                .foregroundStyle(companyID == brand.id ? theme.accent : .secondary)
                                .background(companyID == brand.id ? theme.accent.opacity(0.15) : Color.primary.opacity(0.05), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if layer == .offer {
                Picker("Oferta", selection: $offerID) {
                    Text("Wybierz lub wyszukaj ofertę…").tag("")
                    ForEach(brandOffers) { offer in Text(offer.number ?? offer.title ?? "Oferta").tag(offer.id) }
                }
                .labelsHidden()
            }
            Button { Task { await start() } } label: {
                Label(layer == .general ? "Otwórz rozmowę ogólną" : "Otwórz ustalenia oferty", systemImage: starting ? "hourglass" : "plus")
            }
            .disabled(starting || !canStart)
        }
    }

    private func threadRow(_ thread: SellerChatData.Thread) -> some View {
        let active = selected?.id == thread.id
        return Button { selectedID = thread.id } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack {
                    Text(thread.title).fontWeight(.medium).lineLimit(1)
                    Spacer()
                    SellerUnreadBadge(count: thread.unread)
                }
                Text(thread.brandName + (thread.offerId != nil ? " · \(thread.hasEvent ? "Realizacja" : "Oferta")" : "")).font(.caption).foregroundStyle(.secondary)
                Text(thread.lastMessage ?? "Brak wiadomości").font(.caption).foregroundStyle(.tertiary).lineLimit(1)
            }
            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? theme.accent.opacity(0.12) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func reload() async {
        do {
            let next = try await SellerChatAPI.get(store, ["op": "conversations", "id": seller.id], as: SellerChatData.self)
            data = next
            error = ""
            if companyID.isEmpty || !next.brands.contains(where: { $0.id == companyID }) { companyID = next.brands.first?.id ?? "" }
        } catch {
            self.error = store.failureText(error, "Nie udało się wczytać rozmów sprzedawcy.")
        }
        loading = false
    }

    private func start() async {
        guard canStart, !starting else { return }
        starting = true
        error = ""
        defer { starting = false }
        var body: [String: JSONValue] = ["op": .string("chatOpen"), "id": .string(seller.id), "companyId": .string(companyID)]
        if layer == .offer { body["offerId"] = .string(offerID) }
        do {
            let reply = try await SellerChatAPI.post(store, body)
            await reload()
            query = ""
            if let id = reply["conversationId"]?.text.nonEmpty { selectedID = id }
        } catch {
            self.error = store.failureText(error, "Nie udało się otworzyć rozmowy. Spróbuj ponownie.")
        }
    }
}

/// Rozmowa (`ConversationMessages` w trybie CRM).
@MainActor private struct SellerConversationPane: View {
    @ObservedObject var store: SellersStore
    let thread: SellerChatData.Thread
    let onRead: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var messages: [SellerChatMessage] = []
    @State private var loading = true
    @State private var hasOlder = false
    @State private var older = false
    @State private var text = ""
    @State private var sending = false
    @State private var error = ""
    @State private var pending: (id: String, text: String)?
    @State private var readThrough = 0

    private var realization: Bool { thread.offerId != nil && thread.hasEvent }

    struct Page: Decodable { var messages: [SellerChatMessage] }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(thread.title).font(.headline)
            if let offerTitle = thread.offerTitle, offerTitle != thread.title { Text(offerTitle).font(.callout).foregroundStyle(.secondary) }
            Text("\(thread.brandName) · \(thread.offerId != nil ? (realization ? "Ustalenia realizacji · kontynuacja oferty" : "Ustalenia do oferty") : "Rozmowa ogólna")")
                .font(.caption).foregroundStyle(.secondary)
            Text(thread.offerId != nil
                 ? "Cała historia tego wątku pozostaje przy ofercie i jest dostępna w powiązanym wydarzeniu. Tutaj kontynuujemy ustalenia dotyczące realizacji."
                 : "Luźne pytania i bieżący kontakt. Ta rozmowa nie jest dołączana do ofert ani wydarzeń.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                if let offerID = thread.offerId { Button("Otwórz ofertę") { state.open(.offers, id: offerID) }.buttonStyle(.link) }
                if thread.canViewEvent, let eventID = thread.eventId {
                    Button("Ustalenia realizacji" + (thread.eventName.map { " · \($0)" } ?? "")) { state.showEvent(eventID, cardTab: "seller-arrangements") }.buttonStyle(.link)
                }
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        if hasOlder {
                            Button(older ? "Wczytywanie…" : "Pokaż starsze wiadomości") { Task { await loadOlder() } }.buttonStyle(.link).disabled(older)
                        }
                        if loading { Text("Wczytywanie rozmowy…").font(.caption).foregroundStyle(.secondary) }
                        if !loading && messages.isEmpty { Text("Napisz pierwszą wiadomość. Rozmowa pozostanie w historii sprzedawcy.").font(.caption).foregroundStyle(.secondary) }
                        ForEach(messages) { message in bubble(message).id(message.id) }
                    }
                    .padding(8)
                }
                .frame(maxHeight: .infinity)
                .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 10))
                .onChange(of: messages.last?.id) { _, id in if let id { withAnimation { proxy.scrollTo(id, anchor: .bottom) } } }
            }
            if !error.isEmpty { Text(error).font(.caption).foregroundStyle(.red) }
            if thread.canSend {
                TextField("Odpowiedź widoczna dla sprzedawcy…", text: $text, axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.roundedBorder).disabled(sending)
                    .onSubmit { Task { await send() } }
                HStack {
                    Text("Enter — wyślij · Shift+Enter — nowa linia. Wiadomości zachowują autora i datę. Nie można ich edytować ani usuwać.")
                        .font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    Button { Task { await send() } } label: { Label("Wyślij", systemImage: "paperplane") }
                        .buttonStyle(.borderedProminent).disabled(sending || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            } else {
                Text("Masz dostęp do odczytu tej rozmowy.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .task {
            await reload()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                if NSApplication.shared.isActive { await reload() }
            }
        }
    }

    private func bubble(_ message: SellerChatMessage) -> some View {
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

    private func merge(_ rows: [SellerChatMessage]) {
        var byID: [String: SellerChatMessage] = [:]
        for message in messages + rows { byID[message.id] = message }
        messages = byID.values.sorted { $0.seq < $1.seq }
    }

    private func reload() async {
        do {
            let page = try await SellerChatAPI.get(store, ["op": "messages", "id": thread.id], as: Page.self)
            if loading { hasOlder = page.messages.count == 50 }
            loading = false
            merge(page.messages)
            error = ""
            let newest = messages.last?.seq ?? 0
            if newest > readThrough && NSApplication.shared.isActive {
                if (try? await SellerChatAPI.post(store, ["op": .string("chatRead"), "id": .string(thread.id), "through": .number(Double(newest))])) != nil {
                    readThrough = newest
                    onRead()
                }
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
            let page = try await SellerChatAPI.get(store, ["op": "messages", "id": thread.id, "before": String(first.seq)], as: Page.self)
            hasOlder = page.messages.count == 50
            merge(page.messages)
        } catch {
            self.error = "Nie udało się wczytać starszych wiadomości."
        }
    }

    private func send() async {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, !sending, thread.canSend else { return }
        sending = true
        error = ""
        defer { sending = false }
        if pending == nil || pending?.text != body { pending = (id: UUID().uuidString.lowercased(), text: body) }
        guard let id = pending?.id else { return }
        do {
            try await SellerChatAPI.post(store, ["op": .string("chatSend"), "id": .string(thread.id), "messageId": .string(id), "body": .string(body)])
            pending = nil
            text = ""
            await reload()
            onRead()
        } catch {
            self.error = store.failureText(error, "Nie potwierdzono wysyłki. Możesz ponowić; wiadomość nie zostanie zdublowana.")
        }
    }
}

// MARK: Historia zmian

struct SellerAuditData: Decodable {
    struct Change: Decodable, Hashable { var label: String; var from: String?; var to: String }
    struct Entry: Decodable, Identifiable {
        var id: String; var action: String; var title: String; var brandName: String?; var actor: String; var createdAt: String
        var changes: [Change]; var reason: String?
    }
    var entries: [Entry]
    var limit: Int
    var hasMore: Bool
}

@MainActor struct SellerAuditSheet: View {
    @ObservedObject var store: SellersStore
    let seller: SellerCockpitState.Seller
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: SellerAuditData?
    @State private var error: String?
    @State private var loading = false
    @State private var limit = 50

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Historia zmian").font(.title3.bold())
                    Text("Kto i kiedy zmienił opiekuna, warunki marek, widoczność wynagrodzenia lub konto portalu. Wpisów nie można edytować ani usuwać.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button { Task { await load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }.disabled(loading)
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(20)
            Divider()
            content
        }
        .frame(minWidth: 620, idealWidth: 720, minHeight: 520, idealHeight: 680)
        .background(theme.page)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if let data {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    if data.entries.isEmpty {
                        Label("Brak zapisanych zmian dla tego sprzedawcy.", systemImage: "clock.badge.questionmark").foregroundStyle(.secondary).padding(.vertical, 20)
                    }
                    ForEach(data.entries) { entry in row(entry) }
                    if data.hasMore {
                        Button("Pokaż starsze wpisy") { limit += 50; Task { await load() } }.disabled(loading)
                    }
                }
                .padding(20)
            }
        } else if let error {
            ContentUnavailableView {
                Label("Nie udało się wczytać historii zmian", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await load() } } }
        } else {
            ProgressView("Wczytywanie historii zmian…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func symbol(_ action: String) -> String {
        switch action {
        case "manager_changed": return "person.crop.circle.badge.checkmark"
        case "terms_created", "terms_updated", "terms_deleted": return "creditcard"
        case "visibility_changed": return "eye"
        case "portal_account_linked", "portal_account_unlinked": return "key"
        default: return "gearshape"
        }
    }

    private func row(_ entry: SellerAuditData.Entry) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol(entry.action)).foregroundStyle(theme.accent).frame(width: 28, height: 28)
                .background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 7))
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    (Text(entry.title).fontWeight(.medium) + Text(entry.brandName.map { " · \($0)" } ?? "").foregroundColor(.secondary))
                    Spacer()
                    Text(dateTime(entry.createdAt)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                Text(entry.actor).font(.caption).foregroundStyle(.secondary)
                ForEach(entry.changes, id: \.self) { change in
                    (Text("\(change.label): ").foregroundColor(.secondary)
                     + Text(change.from.map { "\($0) → " } ?? "").foregroundColor(.secondary)
                     + Text(change.to)).font(.callout)
                }
                if let reason = entry.reason { Text("Powód: \(reason)").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
    }

    /// `formatSellerDateTime` („18.11.2026, 14:05”).
    private func dateTime(_ raw: String) -> String {
        guard let date = SellerDates.date(raw) else { return "—" }
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "pl_PL"); formatter.dateFormat = "dd.MM.yyyy, HH:mm"
        return formatter.string(from: date)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            data = try await SellerChatAPI.get(store, ["op": "audit", "id": seller.id, "limit": String(limit)], as: SellerAuditData.self)
            error = nil
        } catch {
            self.error = store.failureText(error, "Nie udało się wczytać historii zmian.")
        }
    }
}

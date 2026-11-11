import Foundation
import SwiftUI

/// Karty wydarzeń na dysku (`event-cards-…`, AES-GCM): ostatnio otwierane i najbliższe wydarzenia. Karta pokazuje się od razu,
/// a w tle serwer porównuje skrót (`?hash=`) — dane wracają tylko po zmianie.
@MainActor final class EventCardStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var cards: [String: CachedEventCard] = [:]
    @Published var loading: Set<String> = []
    @Published var errors: [String: String] = [:]
    @Published var overviewLoading: Set<String> = []
    @Published var overviewErrors: [String: String] = [:]
    /// Pomoc kroków realizacji (ta sama treść co w CRM) — pobierana raz na sesję.
    @Published private(set) var stepsHelp: EventStepsHelp?
    @Published var detailsLoading: Set<String> = []
    @Published var teamLoading: Set<String> = []
    /// Zakładki w trakcie pobierania (`id|zakładka`) i błędy pobierania.
    @Published var tabLoading: Set<String> = []
    @Published var tabErrors: [String: String] = [:]
    /// Odczytane dane zakładek (według skrótu) — dekodowanie raz na zmianę danych.
    private var decodedTabs: [String: Any] = [:]
    /// Listy wyboru (firmy realizujące, lokalizacje) — raz na sesję.
    @Published private(set) var companies: [RealizationCompany]?
    @Published private(set) var locations: [EventLocationOption]?

    private var namespace: String?
    private var file: SealedFile<[String: CachedEventCard]>?
    private var saveTask: Task<Void, Never>?
    private var prefetching = false
    private let limit = 120

    var api: NativeAPI? { workspace?.nativeAPI() }
    func card(_ id: String) -> CachedEventCard? { cards[id] }

    /// Tablice zadań wydarzeń (zakładka „Zadania”) — każda z własną zaszyfrowaną kopią na dysku, jak tablice w module Zadania.
    private var taskStores: [String: TasksStore] = [:]
    func tasksStore(_ eventID: String) -> TasksStore {
        if let existing = taskStores[eventID] { return existing }
        let created = TasksStore(board: .event, eventID: eventID)
        created.workspace = workspace
        if let namespace { created.open(namespace: namespace) }
        taskStores[eventID] = created
        return created
    }

    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<[String: CachedEventCard]>(namespace: "event-cards-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved { cards = saved }
        }
    }
    // MARK: Katalog „Dodaj sprzęt” — kopia na dysku przy karcie, synchronizacja tylko zmienionych koszyków

    private var catalogMemo: [String: SyncedSet<EquipmentCatalogEntry>] = [:]

    private func catalogSet(_ id: String) -> SyncedSet<EquipmentCatalogEntry>? {
        if let memo = catalogMemo[id] { return memo }
        guard let cached = cards[id]?.tabs?["equipment-catalog"],
              let set = try? JSONDecoder().decode(SyncedSet<EquipmentCatalogEntry>.self, from: cached.data) else { return nil }
        catalogMemo[id] = set
        return set
    }

    /// Katalog z dysku (natychmiast, bez sieci); `nil` — wydarzenie nie ma jeszcze kopii katalogu.
    func equipmentCatalog(_ id: String) -> EquipmentCatalog? {
        guard let set = catalogSet(id) else { return nil }
        let byName: (String, String) -> Bool = { $0.localizedStandardCompare($1) == .orderedAscending }
        let items: [EquipmentCatalog.Item] = set.items.filter { $0.kind == "item" }.map { entry in
            EquipmentCatalog.Item(id: entry.id, name: entry.name, brand: entry.brand ?? "", model: entry.model ?? "", category: entry.category ?? "",
                                  thumbnail: entry.thumbnail, total: entry.total, reserved: entry.reserved, used: entry.used,
                                  availableInTerm: entry.availableInTerm, maxAdd: entry.maxAdd, maxSet: entry.maxSet)
        }
        let kits: [EquipmentCatalog.Kit] = set.items.filter { $0.kind == "kit" }.map { entry in
            EquipmentCatalog.Kit(id: entry.id, name: entry.name, description: entry.description ?? "", thumbnail: entry.thumbnail, total: entry.total,
                                 reserved: entry.reserved, used: entry.used, availableInTerm: entry.availableInTerm, maxAdd: entry.maxAdd,
                                 maxSet: entry.maxSet, contents: entry.contents ?? [])
        }
        return EquipmentCatalog(items: items.sorted { byName($0.name, $1.name) }, kits: kits.sorted { byName($0.name, $1.name) },
                                loaded: set.items.first?.loaded ?? false)
    }

    /// Pozycje katalogu z dysku (sprzęt i zestawy) w kolejności nazw — dla okna „Zarządzaj sprzętem”.
    func equipmentCatalogEntries(_ id: String) -> [EquipmentCatalogEntry] {
        guard let set = catalogSet(id) else { return [] }
        return set.items.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// Zapis zmian ilości sprzętu (jeden na wydarzenie, wspólny dla listy i okna „Zarządzaj sprzętem”).
    private var equipmentEditors: [String: EquipmentEditor] = [:]
    func equipmentEditor(_ eventID: String) -> EquipmentEditor {
        if let existing = equipmentEditors[eventID] { return existing }
        let created = EquipmentEditor(store: self, eventID: eventID)
        equipmentEditors[eventID] = created
        return created
    }

    var catalogSyncing: Set<String> { Set(tabLoading.filter { $0.hasSuffix("|equipment-catalog") }.map { String($0.dropLast("|equipment-catalog".count)) }) }

    /// Synchronizacja katalogu: skrót zbioru, a przy różnicy — wyłącznie zmienione koszyki (dostępność, nowe pozycje, zestawy).
    func syncEquipmentCatalog(_ id: String) async {
        let key = "\(id)|equipment-catalog"
        guard let api, cards[id] != nil, !tabLoading.contains(key) else { return }
        tabLoading.insert(key)
        defer { tabLoading.remove(key) }
        do {
            let current = catalogSet(id) ?? SyncedSet<EquipmentCatalogEntry>()
            let state = try JSONDecoder().decode(SyncedSetState.self, from: try await api.get("/events/card", query: ["op": "equipmentCatalog", "id": id, "hash": current.hash]))
            guard let next = try await current.merged(with: state, fetch: { try await self.fetchCatalogBuckets(id, $0) }) else {
                tabErrors[key] = nil
                return
            }
            catalogMemo[id] = next
            guard var card = cards[id] else { return }
            var tabs = card.tabs ?? [:]
            tabs["equipment-catalog"] = CachedEventTab(hash: next.hash, data: try JSONEncoder().encode(next), savedAt: Date())
            card.tabs = tabs
            cards[id] = card
            tabErrors[key] = nil
            scheduleSave()
        } catch {
            tabErrors[key] = failureText(error, "Nie udało się odświeżyć dostępności sprzętu.")
        }
    }

    private func fetchCatalogBuckets(_ id: String, _ buckets: [String]) async throws -> [EquipmentCatalogEntry] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable {
            struct Bucket: Decodable { var items: [EquipmentCatalogEntry] }
            var buckets: [String: Bucket]
            var more: [String]
        }
        var fetched: [EquipmentCatalogEntry] = []
        var pending = buckets
        while !pending.isEmpty {
            let data = try await api.post("/events/card", ["op": .string("equipmentCatalogItems"), "id": .string(id), "buckets": .array(pending.map { .string($0) })])
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            for bucket in reply.buckets.values { fetched += bucket.items }
            pending = reply.more
        }
        return fetched
    }

    func reset(clearDisk: Bool = true) {
        saveTask?.cancel(); saveTask = nil
        catalogMemo = [:]
        equipmentEditors = [:]
        for tasks in taskStores.values { tasks.reset(clearDisk: clearDisk) }
        taskStores = [:]
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; cards = [:]; loading = []; errors = [:]; overviewLoading = []; overviewErrors = [:]; stepsHelp = nil; detailsLoading = []; teamLoading = []; tabLoading = []; tabErrors = [:]; decodedTabs = [:]; companies = nil; locations = nil
    }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(800))
            guard !Task.isCancelled, let self, let file = self.file else { return }
            var snapshot = self.cards
            if snapshot.count > limit {
                for key in snapshot.sorted(by: { $0.value.savedAt < $1.value.savedAt }).prefix(snapshot.count - limit).map(\.key) { snapshot[key] = nil }
            }
            await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
        }
    }

    /// Pobranie karty: z serwera tylko gdy skrót się zmienił.
    func load(_ id: String) async {
        guard let api else { return }
        loading.insert(id)
        defer { loading.remove(id) }
        struct Reply: Decodable { let hash: String; let unchanged: Bool?; let page: EventCardPage? }
        do {
            let data = try await api.get("/events/card", query: ["id": id, "hash": cards[id]?.hash ?? ""])
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            if reply.unchanged == true, var cached = cards[id] {
                cached.savedAt = Date(); cards[id] = cached
            } else if let page = reply.page {
                cards[id] = CachedEventCard(hash: reply.hash, page: page, savedAt: Date(), overview: cards[id]?.overview, details: cards[id]?.details,
                                            team: cards[id]?.team, tabs: cards[id]?.tabs)
            }
            errors[id] = nil
            scheduleSave()
        } catch {
            errors[id] = failureText(error, "Nie udało się pobrać wydarzenia.")
        }
    }

    /// Wstępne pobranie kart najbliższych wydarzeń (praca bez sieci, natychmiastowe otwieranie).
    func prefetch(_ ids: [String]) async {
        guard !prefetching else { return }
        prefetching = true
        defer { prefetching = false }
        for id in ids.prefix(25) {
            if let cached = cards[id], Date().timeIntervalSince(cached.savedAt) < 900 { continue }
            await load(id)
            // Przegląd (kroki, „Najważniejsze”) też na dysku — karta otwiera się od razu, także bez sieci.
            await loadOverview(id)
        }
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM — pokazuję zapisaną kartę." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    /// Zapis z karty (`update`, `invitation`) z paskiem postępu; po sukcesie odświeża kartę i listę.
    @discardableResult func run(_ id: String, _ pending: String, _ op: String, _ body: [String: JSONValue], success: String) async -> Bool {
        guard let api else { return false }
        var ok = false
        await workspace?.withPending(pending) {
            do {
                var payload = body
                payload["op"] = .string(op)
                payload["id"] = .string(id)
                _ = try await api.post("/events/card", payload)
                workspace?.succeed(success)
                ok = true
            } catch { workspace?.error = failureText(error, "Nie udało się zapisać zmian.") }
        }
        if ok {
            await load(id)
            Task { await workspace?.events.sync(force: true) }
        }
        return ok
    }
    func update(_ id: String, _ changes: [String: JSONValue], success: String = "Wydarzenie zaktualizowane") async -> Bool {
        await run(id, "Zapisywanie…", "update", ["data": .object(changes)], success: success)
    }

    // MARK: Przegląd — kroki realizacji, kontrola przed wydarzeniem, „Najważniejsze”

    func overview(_ id: String) -> EventCardOverview? { cards[id]?.overview?.overview }

    /// Przegląd z serwera tylko po zmianie skrótu; kopia na dysku razem z kartą.
    func loadOverview(_ id: String) async {
        // Karta pełna — uprawnienia z flag; przestrzeń realizacji (ekipa) — same kroki, bez kontroli i kontaktów.
        guard let api, let page = cards[id]?.page, page.kind == "full" || page.kind == "realization", !overviewLoading.contains(id) else { return }
        let flags = page.flags
        overviewLoading.insert(id)
        defer { overviewLoading.remove(id) }
        struct Reply: Decodable { let hash: String; let unchanged: Bool?; let overview: EventCardOverview? }
        do {
            let data = try await api.get("/events/card", query: [
                "op": "overview", "id": id, "manage": flags?.canEventManage == true ? "1" : "0",
                "onsite": flags?.canViewOnsiteContact == true ? "1" : "0", "hash": cards[id]?.overview?.hash ?? "",
            ])
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            guard var card = cards[id] else { return }
            if reply.unchanged == true, var cached = card.overview {
                cached.savedAt = Date(); card.overview = cached
            } else if let overview = reply.overview {
                card.overview = CachedEventOverview(hash: reply.hash, overview: overview, savedAt: Date())
            }
            cards[id] = card
            overviewErrors[id] = nil
            scheduleSave()
        } catch {
            overviewErrors[id] = failureText(error, "Nie udało się pobrać przeglądu wydarzenia.")
        }
    }

    /// RPC karty jak `supabase.rpc` w przeglądarce (lista dozwolonych funkcji na serwerze). Zwraca pole `data`.
    func rpc(_ name: String, _ params: [String: JSONValue]) async throws -> Data {
        guard let api else { throw AppError.configuration }
        let reply = try await api.post("/events/card", ["op": .string("rpc"), "name": .string(name), "params": .object(params)])
        struct Wrapped: Decodable { let data: JSONValue? }
        let value = (try? JSONDecoder().decode(Wrapped.self, from: reply))?.data ?? .null
        return try JSONEncoder().encode(value)
    }

    /// Nowy stan kroków z odpowiedzi RPC — od razu na ekranie i na dysku; reszta przeglądu dociąga się w tle.
    func applySteps(_ id: String, _ snapshot: EventStepsSnapshot) {
        guard var card = cards[id], var cached = card.overview else { return }
        cached.overview.steps = EventStepsState(snapshot: snapshot, hidden: nil, unavailable: nil, error: nil)
        cached.hash = ""
        card.overview = cached
        cards[id] = card
        scheduleSave()
        Task { await loadOverview(id) }
    }

    /// Komunikat błędu kroku (`eventStepErrorMessage`).
    func stepError(_ error: Error) -> String {
        if error is URLError { return "Brak połączenia. Spróbuj ponownie za chwilę." }
        if let failure = error as? NativeFailure, !failure.message.isEmpty { return failure.message }
        return "Nie udało się zapisać kroku. Spróbuj ponownie."
    }

    func loadStepsHelp(_ id: String) async {
        guard stepsHelp == nil, let api else { return }
        if let data = try? await api.get("/events/card", query: ["op": "stepsHelp", "id": id]),
           let help = try? JSONDecoder().decode(EventStepsHelp.self, from: data) {
            stepsHelp = help
        }
    }

    // MARK: Szczegóły — firma realizująca, sale, potwierdzenie e-mail, checklista

    func details(_ id: String) -> EventCardDetails? { cards[id]?.details?.details }

    func loadDetails(_ id: String) async {
        guard let api, let flags = cards[id]?.page.flags, !detailsLoading.contains(id) else { return }
        detailsLoading.insert(id)
        defer { detailsLoading.remove(id) }
        struct Reply: Decodable { let hash: String; let unchanged: Bool?; let details: EventCardDetails? }
        do {
            let data = try await api.get("/events/card", query: [
                "op": "details", "id": id, "status": flags.canEventManage ? "1" : "0", "equipment": flags.canEquipment == true ? "1" : "0",
                "hash": cards[id]?.details?.hash ?? "",
            ])
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            guard var card = cards[id] else { return }
            if reply.unchanged == true, var cached = card.details {
                cached.savedAt = Date(); card.details = cached
            } else if let details = reply.details {
                card.details = CachedEventDetails(hash: reply.hash, details: details, savedAt: Date())
            }
            cards[id] = card
            scheduleSave()
        } catch {}
    }

    func loadCompanies(_ id: String) async throws {
        guard let api else { return }
        struct Reply: Decodable { let companies: [RealizationCompany] }
        companies = try JSONDecoder().decode(Reply.self, from: try await api.get("/events/card", query: ["op": "companies", "id": id])).companies
    }

    func loadLocations(_ id: String) async throws {
        guard let api else { return }
        struct Reply: Decodable { let locations: [EventLocationOption] }
        locations = try JSONDecoder().decode(Reply.self, from: try await api.get("/events/card", query: ["op": "locations", "id": id])).locations
    }

    func confirmationPreview(_ id: String) async throws -> EventConfirmationPreview {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let preview: EventConfirmationPreview }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/events/card", query: ["op": "confirmationPreview", "id": id])).preview
    }

    /// Zapis ze Szczegółów (`category`, `company`, `rooms`, `detailsStatus`…) — po sukcesie odświeża kartę, dodatki i listę.
    @discardableResult func detailsRun(_ id: String, _ op: String, _ body: [String: JSONValue], success: String?, pending: String = "Zapisywanie…") async throws -> Data {
        guard let api else { throw AppError.configuration }
        var body = body
        body["op"] = .string(op)
        body["id"] = .string(id)
        let payload = body
        let data: Data
        if let workspace {
            data = try await workspace.withPending(pending) { try await api.post("/events/card", payload) }
        } else {
            data = try await api.post("/events/card", payload)
        }
        if let success { workspace?.succeed(success) }
        Task {
            await load(id)
            await loadDetails(id)
            await workspace?.events.sync(force: true)
        }
        return data
    }

    // MARK: Przestrzeń realizacji — materiały lokalizacji i pliki operacyjne (linki podpisywane na żądanie)

    func realizationAssetURLs(_ id: String) async -> [String: String] {
        guard let api else { return [:] }
        struct Reply: Decodable { let urls: [String: String] }
        guard let data = try? await api.get("/events/card", query: ["op": "realizationAssets", "id": id]) else { return [:] }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.urls ?? [:]
    }

    func realizationFile(_ id: String, fileID: String) async throws -> (url: URL, name: String) {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let url: String; let name: String? }
        let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/events/card", query: ["op": "realizationFile", "id": id, "fileId": fileID]))
        guard let url = URL(string: reply.url) else { throw NativeFailure(status: 404, message: "Brak adresu pliku.", fieldErrors: [:]) }
        return (url, reply.name ?? "Plik")
    }

    // MARK: Zespół

    func team(_ id: String) -> EventTeam? { cards[id]?.team?.team }

    func loadTeam(_ id: String) async {
        guard let api, cards[id] != nil, !teamLoading.contains(id) else { return }
        teamLoading.insert(id)
        defer { teamLoading.remove(id) }
        struct Reply: Decodable { let hash: String; let unchanged: Bool?; let team: EventTeam? }
        do {
            let data = try await api.get("/events/card", query: ["op": "team", "id": id, "hash": cards[id]?.team?.hash ?? ""])
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            guard var card = cards[id] else { return }
            if reply.unchanged == true, var cached = card.team {
                cached.savedAt = Date(); card.team = cached
            } else if let team = reply.team {
                card.team = CachedEventTeam(hash: reply.hash, team: team, savedAt: Date())
            }
            cards[id] = card
            scheduleSave()
        } catch {}
    }

    func teamCandidates(_ id: String) async throws -> EventTeamCandidates {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(EventTeamCandidates.self, from: try await api.get("/events/card", query: ["op": "teamCandidates", "id": id]))
    }

    /// Zapis w zespole — po sukcesie odświeża zespół, kroki (zespół zamyka krok „Zespół”) i listę wydarzeń.
    @discardableResult func teamRun(_ id: String, _ op: String, _ body: [String: JSONValue], success: String?, pending: String = "Zapisywanie…") async throws -> Data {
        guard let api else { throw AppError.configuration }
        var body = body
        body["op"] = .string(op)
        body["id"] = .string(id)
        let payload = body
        let data: Data
        if let workspace {
            data = try await workspace.withPending(pending) { try await api.post("/events/card", payload) }
        } else {
            data = try await api.post("/events/card", payload)
        }
        if let success { workspace?.succeed(success) }
        await loadTeam(id)
        Task {
            await loadOverview(id)
            await workspace?.events.sync(force: true)
        }
        return data
    }

    // MARK: Zakładki (`op=tab`) — kopia na dysku ze skrótem, zapisy `mutate` / `rpc`

    func tab<T: Decodable>(_ id: String, _ tab: String, as type: T.Type) -> T? {
        guard let cached = cards[id]?.tabs?[tab] else { return nil }
        let key = "\(id)|\(tab)|\(cached.hash)"
        if let hit = decodedTabs[key] as? T { return hit }
        do {
            let value = try JSONDecoder().decode(T.self, from: cached.data)
            decodedTabs[key] = value
            return value
        } catch {
            tabErrors["\(id)|\(tab)"] = "Nie udało się odczytać danych zakładki (\(error.localizedDescription))."
            return nil
        }
    }

    func loadTab(_ id: String, _ tab: String) async {
        let key = "\(id)|\(tab)"
        guard let api, cards[id] != nil, !tabLoading.contains(key) else { return }
        tabLoading.insert(key)
        defer { tabLoading.remove(key) }
        do {
            let reply = try await api.get("/events/card", query: ["op": "tab", "tab": tab, "id": id, "hash": cards[id]?.tabs?[tab]?.hash ?? ""])
            guard let object = try JSONSerialization.jsonObject(with: reply) as? [String: Any], let hash = object["hash"] as? String else {
                throw AppError.invalidResponse
            }
            guard var card = cards[id] else { return }
            var tabs = card.tabs ?? [:]
            if object["unchanged"] as? Bool == true, var cached = tabs[tab] {
                cached.savedAt = Date()
                tabs[tab] = cached
            } else if let payload = object["data"] {
                // JSONSerialization zachowuje liczby całkowite i ułamkowe dokładnie jak z serwera.
                tabs[tab] = CachedEventTab(hash: hash, data: try JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]), savedAt: Date())
            }
            card.tabs = tabs
            cards[id] = card
            tabErrors[key] = nil
            scheduleSave()
        } catch {
            tabErrors[key] = failureText(error, "Nie udało się pobrać danych zakładki.")
        }
    }

    /// Zapis wiersza z zakładki (`op=mutate`: tabela, czynność, wiersz, dane) — po sukcesie odświeża zakładkę i kroki.
    @discardableResult func mutate(_ id: String, table: String, action: String, rowID: String? = nil, data: [String: JSONValue] = [:],
                                   reload tab: String, success: String?, pending: String = "Zapisywanie…") async throws -> Data {
        var body: [String: JSONValue] = ["table": .string(table), "action": .string(action), "data": .object(data)]
        if let rowID { body["id"] = .string(rowID) }
        return try await tabRun(id, "mutate", body, reload: tab, success: success, pending: pending)
    }

    /// Dowolna czynność zakładki (`op` z treścią) z paskiem postępu — po sukcesie odświeża zakładkę, kroki i listę.
    @discardableResult func tabRun(_ id: String, _ op: String, _ body: [String: JSONValue], reload tab: String, success: String?,
                                   pending: String = "Zapisywanie…") async throws -> Data {
        guard let api else { throw AppError.configuration }
        var body = body
        body["op"] = .string(op)
        body["id"] = .string(id)
        let payload = body
        let data: Data
        if let workspace {
            data = try await workspace.withPending(pending) { try await api.post("/events/card", payload) }
        } else {
            data = try await api.post("/events/card", payload)
        }
        if let success { workspace?.succeed(success) }
        await loadTab(id, tab)
        Task {
            await loadOverview(id)
            await workspace?.events.sync(force: true)
        }
        return data
    }

    /// RPC karty z paskiem postępu, odświeżeniem zakładki i kroków.
    @discardableResult func rpcRun(_ id: String, _ name: String, _ params: [String: JSONValue], reload tab: String, success: String?,
                                   pending: String = "Zapisywanie…") async throws -> Data {
        let data: Data
        if let workspace {
            data = try await workspace.withPending(pending) { try await rpc(name, params) }
        } else {
            data = try await rpc(name, params)
        }
        if let success { workspace?.succeed(success) }
        await loadTab(id, tab)
        Task {
            await loadOverview(id)
            await workspace?.events.sync(force: true)
        }
        return data
    }

    /// Odczyt pomocniczy zakładki (`GET op=…`) zdekodowany do typu.
    func fetch<T: Decodable>(_ id: String, _ op: String, _ query: [String: String] = [:], as type: T.Type) async throws -> T {
        guard let api else { throw AppError.configuration }
        var params = query
        params["op"] = op
        params["id"] = id
        return try JSONDecoder().decode(T.self, from: try await api.get("/events/card", query: params))
    }

    // MARK: Czynności i odczyty modułów zakładek (`op=tabAction` / `op=tabQuery`)

    /// Czynność zakładki z paskiem postępu — po sukcesie odświeża wskazane zakładki, kroki i listę wydarzeń.
    @discardableResult func tabAction(_ id: String, _ tab: String, _ action: String, _ body: [String: JSONValue] = [:], reload: [String],
                                      success: String?, pending: String? = "Zapisywanie…") async throws -> Data {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string("tabAction")
        payload["id"] = .string(id)
        payload["tab"] = .string(tab)
        payload["action"] = .string(action)
        let request = payload
        let data: Data
        if let workspace, let pending {
            data = try await workspace.withPending(pending) { try await api.post("/events/card", request) }
        } else {
            data = try await api.post("/events/card", request)
        }
        if let success { workspace?.succeed(success) }
        for name in reload { await loadTab(id, name) }
        Task {
            await loadOverview(id)
            await workspace?.events.sync(force: true)
        }
        return data
    }

    /// Odczyt pomocniczy modułu zakładki (`GET op=tabQuery&tab=…&query=…`).
    func tabQuery<T: Decodable>(_ id: String, _ tab: String, _ query: String, _ params: [String: String] = [:], as type: T.Type) async throws -> T {
        var all = params
        all["tab"] = tab
        all["query"] = query
        return try await fetch(id, "tabQuery", all, as: type)
    }

    /// Surowa odpowiedź odczytu modułu zakładki — np. treść żądania przekazywana bez zmian do trasy PDF.
    func tabQueryData(_ id: String, _ tab: String, _ query: String, _ params: [String: String] = [:]) async throws -> Data {
        guard let api else { throw AppError.configuration }
        var all = params
        all["op"] = "tabQuery"
        all["id"] = id
        all["tab"] = tab
        all["query"] = query
        return try await api.get("/events/card", query: all)
    }

    /// Dane zakładki z odpowiedzi zapisu (np. RPC zwracające całą checklistę) — bez ponownego pobierania; skrót wymusi odświeżenie.
    func applyTab(_ id: String, _ tab: String, _ payload: Any) {
        guard var card = cards[id], let data = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed]) else { return }
        var tabs = card.tabs ?? [:]
        tabs[tab] = CachedEventTab(hash: "local-\(UUID().uuidString)", data: data, savedAt: Date())
        card.tabs = tabs
        cards[id] = card
        tabErrors["\(id)|\(tab)"] = nil
        scheduleSave()
    }

    /// Zapisy checklisty sprzętu w toku (`line:<id>`, `stage:<czynność>`) — jak `busyKeys` w `useEquipmentChecklist`.
    @Published var checklistBusy: Set<String> = []

    /// `useEquipmentChecklist.run`: RPC checklisty → cała checklista od razu w zakładce. Zwraca komunikat błędu albo `nil`.
    func checklistRun(_ id: String, key: String, name: String, params: [String: JSONValue]) async -> String? {
        guard let api else { return "Brak połączenia z CRM." }
        checklistBusy.insert(key)
        defer { checklistBusy.remove(key) }
        do {
            let reply = try await api.post("/events/card", ["op": .string("tabAction"), "id": .string(id), "tab": .string("equipment"),
                                                            "action": .string("checklist"), "name": .string(name), "params": .object(params)])
            applyChecklist(id, reply)
            Task { await loadOverview(id) }
            return nil
        } catch {
            Task { await loadTab(id, "equipment-checklist") }
            return failureText(error, "Nie udało się zapisać checklisty. Spróbuj ponownie.")
        }
    }
    private func applyChecklist(_ id: String, _ reply: Data) {
        guard let object = try? JSONSerialization.jsonObject(with: reply) as? [String: Any], let checklist = object["checklist"] else { return }
        applyTab(id, "equipment-checklist", ["status": "ready", "checklist": checklist, "error": NSNull()] as [String: Any])
    }

    /// Zdjęcie zwrotu (`ReturnPhotos.add`) — multipart przez serwer CRM do `event-files`, potem zapis pozycji z nową listą zdjęć.
    func uploadReturnPhoto(_ id: String, line: String, file: URL, ok: Int?, damaged: Int, note: String?, photos: [String]) async throws {
        guard let workspace, let backend = workspace.eventAPI(), let base = workspace.connection.crm,
              let url = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/events/card?op=equipmentPhoto&id=\(id)") else {
            throw AppError.configuration
        }
        let access = file.startAccessingSecurityScopedResource()
        defer { if access { file.stopAccessingSecurityScopedResource() } }
        let content = try Data(contentsOf: file)
        guard content.count <= 15 * 1024 * 1024 else {
            throw NativeFailure(status: 400, message: "Zdjęcie „\(file.lastPathComponent)” ma więcej niż 15 MB.", fieldErrors: [:])
        }
        let ext = file.pathExtension.lowercased()
        let type = ext == "png" ? "image/png" : ext == "heic" ? "image/heic" : ext == "webp" ? "image/webp" : ext == "gif" ? "image/gif" : "image/jpeg"
        let boundary = "mavinci-\(UUID().uuidString)"
        var body = Data()
        func field(_ name: String, _ value: String) {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".utf8))
        }
        field("line", line)
        field("ok", ok.map { String($0) } ?? "")
        field("damaged", String(damaged))
        field("note", note ?? "")
        field("photos", String(data: (try? JSONSerialization.data(withJSONObject: photos)) ?? Data("[]".utf8), encoding: .utf8) ?? "[]")
        let fileName = file.lastPathComponent.replacingOccurrences(of: "\"", with: "")
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(fileName)\"\r\nContent-Type: \(type)\r\n\r\n".utf8))
        body.append(content)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await backend.token())", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się wysłać zdjęcia.", fieldErrors: [:])
        }
        applyChecklist(id, data)
    }
}

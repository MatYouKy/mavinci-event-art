import Foundation
import SwiftUI

/// Kopia kontaktów na dysku: lista, uprawnienia i skróty koszyków synchronizacji (`src/lib/native/sync.ts`).
struct ContactIndex: Codable {
    var hash = ""
    var width = 0
    var buckets: [String: String] = [:]
    var items: [ContactEntry] = []
    var access: ContactAccess?
    var syncedAt: Date?
}

/// Kontakty z kopii na dysku: widok czyta lokalne dane od razu, synchronizacja pobiera tylko zmienione koszyki.
/// Edycja i usuwanie idą przez `/bridge/native/v1/contacts` — RLS i walidacja jak w CRM.
@MainActor final class ContactsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var contacts: [ContactEntry] = []
    @Published private(set) var access: ContactAccess?
    @Published var syncing = false
    @Published var lastSync: Date?
    @Published var loadError: String?
    /// Kontakt wskazany z innej sekcji (np. spotkanie, zapytanie) — widok zaznacza go i otwiera szczegóły.
    @Published var focusID: String?
    /// Otwarta karta (organizacja, kontakt, osoba prywatna) zamiast listy — jak `/crm/contacts/[id]`.
    @Published var opened: ContactRef?
    /// Lista podwykonawców zamiast kontaktów (`/crm/subcontractors`) i otwarta karta podwykonawcy (`SubcontractorsView`).
    @Published var subcontractorsShown = false
    @Published var openedSubcontractor: SubcontractorRoute?
    /// Karty z serwera (tylko w pamięci — z PESEL-em i numerem dowodu osoby prywatnej, jak w przeglądarce).
    @Published private(set) var cards: [String: ContactCard] = [:]
    @Published private(set) var cardErrors: [String: String] = [:]
    @Published private(set) var cardLoading: Set<String> = []

    private var namespace: String?
    private var file: SealedFile<ContactIndex>?
    private var index = ContactIndex()
    private var recentLocal: [String: Date] = [:]
    private var syncTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var loaded: Bool { file != nil && (index.syncedAt != nil || !index.items.isEmpty) }
    var canManage: Bool { access?.canManage ?? false }
    func entry(_ id: String?) -> ContactEntry? { id.flatMap { id in contacts.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<ContactIndex>(namespace: "contacts-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if let saved {
                index = saved
                access = saved.access
                lastSync = saved.syncedAt
                publish()
            }
        }
    }
    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); saveTask?.cancel(); syncTask = nil; saveTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; index = ContactIndex(); recentLocal = [:]
        contacts = []; access = nil; syncing = false; lastSync = nil; loadError = nil; focusID = nil
        opened = nil; cards = [:]; cardErrors = [:]; cardLoading = []; subcontractorsShown = false; openedSubcontractor = nil
    }
    /// Kolejność jak na stronie: organizacje, potem kontakty — w obu grupach od najnowszych.
    private func publish() {
        contacts = index.items.sorted { a, b in
            if a.isOrganization != b.isOrganization { return a.isOrganization }
            return (a.createdAt ?? "") > (b.createdAt ?? "")
        }
    }
    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, let file = self.file else { return }
            let snapshot = self.index
            await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
        }
    }
    /// Zmiana lokalna od razu w widoku; synchronizacja nie cofa jej przez 20 s, zanim serwer jej nie potwierdzi.
    private func mutate(_ key: String, _ change: (inout ContactEntry) -> Void) {
        guard let i = index.items.firstIndex(where: { $0.key == key }) else { return }
        change(&index.items[i])
        recentLocal[key] = Date()
        publish(); scheduleSave()
    }

    // MARK: Synchronizacja
    func sync(force: Bool = false) async {
        if let syncTask { await syncTask.value; if !force { return } }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }
    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        guard file != nil else { return }
        await sync()
    }
    private func performSync() async {
        guard let api, file != nil else { return }
        syncing = true
        defer { syncing = false }
        struct State: Decodable { let hash: String; let width: Int; let buckets: [String: String]?; let access: ContactAccess? }
        struct Bucket: Decodable { let hash: String; let items: [ContactEntry] }
        struct Items: Decodable { let buckets: [String: Bucket]; let more: [String] }
        do {
            let state = try JSONDecoder().decode(State.self, from: try await api.get("/contacts", query: ["op": "state", "hash": index.hash]))
            if let next = state.access { index.access = next; access = next }
            if state.hash != index.hash, let server = state.buckets {
                let replaceAll = state.width != index.width
                let changed = Set(replaceAll ? Array(server.keys) : server.filter { index.buckets[$0.key] != $0.value }.map(\.key))
                let vanished = Set(index.buckets.keys).subtracting(server.keys)
                var fetched: [ContactEntry] = []
                var pending = changed.sorted()
                while !pending.isEmpty {
                    let data = try await api.post("/contacts", ["op": .string("items"), "buckets": .array(pending.map { .string($0) })])
                    let reply = try JSONDecoder().decode(Items.self, from: data)
                    for bucket in reply.buckets.values { fetched += bucket.items }
                    pending = reply.more
                }
                let now = Date()
                recentLocal = recentLocal.filter { now.timeIntervalSince($0.value) < 20 }
                let local = Dictionary(index.items.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
                var byKey: [String: ContactEntry] = [:]
                if !replaceAll {
                    for item in index.items {
                        let bucket = mailBucket(item.key, width: state.width)
                        if !changed.contains(bucket) && !vanished.contains(bucket) { byKey[item.key] = item }
                    }
                }
                var dirty = Set<String>()
                for item in fetched {
                    if recentLocal[item.key] != nil, let mine = local[item.key] {
                        byKey[item.key] = mine; dirty.insert(mailBucket(item.key, width: state.width)); continue
                    }
                    byKey[item.key] = item
                }
                index.items = Array(byKey.values)
                index.buckets = server
                for bucket in dirty { index.buckets[bucket] = "" }
                index.width = state.width
                index.hash = dirty.isEmpty ? state.hash : ""
                publish()
            }
            index.syncedAt = Date(); lastSync = index.syncedAt; loadError = nil
            scheduleSave()
        } catch {
            if index.items.isEmpty { loadError = failureText(error, "Nie udało się pobrać kontaktów.") }
        }
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    /// Zapis formularza (kontakt: pola karty „Dane kontaktowe”; organizacja: walidacja jak w CRM).
    /// Błędy pól wracają w `NativeFailure.fieldErrors`.
    func update(_ entry: ContactEntry, data: [String: JSONValue], local: (inout ContactEntry) -> Void) async throws {
        guard let api else { throw AppError.configuration }
        _ = try await api.post("/contacts", ["op": .string("update"), "kind": .string(entry.kind), "id": .string(entry.id), "data": .object(data)])
        mutate(entry.key, local)
        Task { await sync(force: true) }
    }

    func delete(_ entry: ContactEntry) async -> Bool {
        var ok = false
        await workspace?.withPending(entry.isOrganization ? "Usuwanie organizacji…" : "Usuwanie kontaktu…") {
            do {
                guard let api else { throw AppError.configuration }
                _ = try await api.post("/contacts", ["op": .string("delete"), "kind": .string(entry.kind), "id": .string(entry.id)])
                index.items.removeAll { $0.key == entry.key }
                publish(); scheduleSave()
                cards[entry.id] = nil
                if opened?.id == entry.id { opened = nil }
                workspace?.succeed(entry.isOrganization ? "Organizacja usunięta" : "Kontakt usunięty")
                ok = true
                Task { await sync(force: true) }
            } catch {
                workspace?.error = failureText(error, "Błąd podczas usuwania")
            }
        }
        return ok
    }
}

// MARK: Karta kontaktu i organizacji
extension ContactKind {
    /// Rodzaj w zapytaniach do serwera (`organization` albo `contact` — kontakt i osoba prywatna to jedna tabela).
    var apiKind: String { self == .organization ? "organization" : "contact" }
}

/// Możliwy duplikat kontaktu (`Customer360Panel`): ten sam e-mail lub telefon.
struct ContactDuplicate: Identifiable {
    let entry: ContactEntry
    let reason: String
    var id: String { entry.id }
}

extension ContactsStore {
    func card(_ id: String) -> ContactCard? { cards[id] }

    /// Karta z serwera (dane, powiązania, reprezentacja, notatki, faktury, realizacje, opiekun, segmentacja).
    func loadCard(_ ref: ContactRef) async {
        guard let api else { return }
        cardLoading.insert(ref.id)
        defer { cardLoading.remove(ref.id) }
        do {
            let data = try await api.get("/contacts", query: ["op": "card", "kind": ref.kind.apiKind, "id": ref.id])
            cards[ref.id] = try JSONDecoder().decode(ContactCard.self, from: data)
            cardErrors[ref.id] = nil
        } catch {
            cardErrors[ref.id] = failureText(error, "Nie udało się pobrać karty.")
        }
    }

    /// Operacja na serwerze (`/bridge/native/v1/contacts`, `op`); błąd — `NativeFailure` z błędami pól.
    func post(_ op: String, _ body: [String: JSONValue]) async throws -> [String: JSONValue] {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        let data = try await api.post("/contacts", payload)
        return (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
    }

    /// Czynność z karty z paskiem postępu: komunikat, odświeżenie karty i listy. `nil` przy błędzie (komunikat w snackbarze).
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], reload ref: ContactRef?) async -> [String: JSONValue]? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let reply = try await workspace.withPending(pending) { try await post(op, body) }
            if let message = reply["message"]?.text.nonEmpty { workspace.succeed(message) }
            if let warning = (reply["warnings"]?.array ?? []).map(\.text).first(where: { !$0.isEmpty }) { workspace.notice = warning }
            if let ref { await loadCard(ref) }
            Task { await sync(force: true) }
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            return nil
        }
    }

    /// Zapis formularza karty (`op=update`) i odświeżenie karty oraz listy; błędy pól w `NativeFailure.fieldErrors`.
    func save(_ ref: ContactRef, data: [String: JSONValue]) async throws {
        _ = try await post("update", ["kind": .string(ref.kind.apiKind), "id": .string(ref.id), "data": .object(data)])
        await loadCard(ref)
        Task { await sync(force: true) }
    }

    /// Dane firmy z GUS / KRS / CEIDG / białej listy VAT (`/bridge/gus/company`, jak przycisk „GUS / rejestry”).
    func registry(nip: String) async throws -> RegistryCompany {
        guard let api else { throw AppError.configuration }
        return RegistryCompany(try await api.bridge("/bridge/gus/company", ["nip": .string(nip)]))
    }

    /// Organizacje-klienci do wyboru nabywcy na fakturach.
    func invoiceBuyers() async throws -> [ContactInvoiceBuyerOption] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let buyers: [ContactInvoiceBuyerOption] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/contacts", query: ["op": "buyers"])).buyers
    }

    /// Lokalizacje pasujące do frazy (min. 2 znaki) — jak wyszukiwarka lokalizacji w karcie organizacji.
    func searchLocations(_ query: String) async throws -> [ContactCardLocation] {
        guard let api else { throw AppError.configuration }
        struct Reply: Decodable { let locations: [ContactCardLocation] }
        return try JSONDecoder().decode(Reply.self, from: try await api.get("/contacts", query: ["op": "locations", "q": query])).locations
    }

    /// Możliwe duplikaty kontaktu z kopii listy: ten sam e-mail lub telefon (bez prefiksu 48).
    func duplicates(of id: String) -> [ContactDuplicate] {
        guard let target = entry(id), !target.isOrganization else { return [] }
        let email = target.email.trimmingCharacters(in: .whitespaces).lowercased()
        let phones = Set([target.mobile, target.phone].map(ContactCardText.phoneKey).filter { !$0.isEmpty })
        return contacts.compactMap { candidate in
            guard candidate.id != id, !candidate.isOrganization else { return nil }
            let sameEmail = !email.isEmpty && candidate.email.trimmingCharacters(in: .whitespaces).lowercased() == email
            let candidatePhones = Set([candidate.mobile, candidate.phone].map(ContactCardText.phoneKey).filter { !$0.isEmpty })
            let samePhone = !phones.isDisjoint(with: candidatePhones)
            guard sameEmail || samePhone else { return nil }
            let reason = sameEmail && samePhone ? "ten sam e-mail i telefon" : sameEmail ? "ten sam e-mail" : "ten sam telefon"
            return ContactDuplicate(entry: candidate, reason: reason)
        }
    }

    /// Karta po zapisie nowego rekordu albo wskazana z innego miejsca.
    func open(_ id: String, kind: ContactKind) {
        opened = ContactRef(id: id, kind: kind)
    }
}

extension Workspace {
    /// Karta kontaktu lub organizacji (spotkanie, zapytanie, `/crm/contacts/<id>`) — jak strona `/crm/contacts/<id>`;
    /// rekord spoza kopii listy — po synchronizacji. Bez dostępu — komunikat.
    func showContact(_ id: String) {
        guard employee?.canView(.contacts) == true else { notice = "Nie masz dostępu do kontaktów."; return }
        switchSection(.contacts)
        if let entry = contacts.entry(id) { contacts.open(id, kind: entry.contactKind); return }
        contacts.focusID = id
        Task {
            await contacts.sync(force: true)
            if let entry = contacts.entry(id) { contacts.open(id, kind: entry.contactKind) }
        }
    }
    /// Zapytanie w lejku (z karty kontaktu).
    func showInquiry(_ id: String) {
        guard employee?.canView(.inquiries) == true else { notice = "Nie masz dostępu do zapytań."; return }
        switchSection(.inquiries)
        focusedID = id; focusToken = UUID()
    }
}

import Foundation
import SwiftUI
import AppKit

// MARK: Marketing → „Realizacje” (`/crm/marketing/portfolio`) — portfolio strony mavinci.pl: kopie robocze realizacji,
// zdjęcia (wersje WebP strony powstają na serwerze CRM), SEO, asystent AI i publikacja na stronie przez
// `/bridge/native/v1/portfolio` (token pracownika, te same reguły co CRM — dostęp: edycja strony).
// Lista i otwarte realizacje są na dysku (zaszyfrowane) — widok otwiera się od razu, także bez internetu. Niezapisane zmiany
// zostają w pamięci przy przejściu do innej realizacji lub sekcji.

enum PortfolioFilter: String, CaseIterable, Identifiable {
    case all, draft, published, attention
    var id: String { rawValue }

    func label(_ home: PortfolioHome?) -> String {
        switch self {
        case .all: return "Wszystkie (\(home?.items.count ?? 0))"
        case .draft: return "Szkic (\(home?.counts.draft ?? 0))"
        case .published: return "Na stronie (\(home?.counts.published ?? 0))"
        case .attention: return "Do opublikowania (\(home?.counts.changed ?? 0))"
        }
    }

    func matches(_ status: PortfolioStatus) -> Bool {
        switch self {
        case .all: return true
        case .draft: return status == .draft
        case .published: return status == .published
        case .attention: return status == .changed || status == .conflict
        }
    }
}

/// Kopia robocza w edytorze (niezapisane zmiany).
struct PortfolioDraft: Equatable {
    var content: PortfolioContent
    var eventID: String?
    var event: PortfolioEvent?
    /// Wersja realizacji, z której powstała kopia — zapis z inną wersją serwer odrzuca (zmiany z innego okna).
    var version: Int

    init(_ detail: PortfolioDetail) {
        content = detail.item.content
        eventID = detail.item.eventId
        event = detail.event
        version = detail.item.version
    }

    func differs(from detail: PortfolioDetail) -> Bool { content != detail.item.content || eventID != detail.item.eventId }
}

@MainActor final class PortfolioStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var home: PortfolioHome?
    @Published var loadError: String?
    @Published private(set) var loading = false
    /// Realizacja otwarta obok listy.
    @Published var openedID: String?
    @Published private(set) var details: [String: PortfolioDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    @Published var drafts: [String: PortfolioDraft] = [:]
    /// Notatka dla asystenta AI (na realizację) — wspólna dla „Podstaw”, przycisków AI przy sekcjach i panelu bocznego.
    @Published var briefs: [String: String] = [:]
    @Published var query = ""
    @Published var filter: PortfolioFilter = .all
    @Published var creating = false

    private var namespace: String?
    private var homeFile: SealedFile<PortfolioHome>?

    var api: NativeAPI? { workspace?.nativeAPI() }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<PortfolioHome>(namespace: "portfolio-home-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            homeFile = sealed
            if home == nil, let saved { home = saved }
        }
    }

    func reset(clearDisk: Bool = true) {
        if clearDisk, let homeFile { try? homeFile.clear() }
        if clearDisk { for id in details.keys { try? detailFile(id)?.clear() } }
        homeFile = nil; namespace = nil; home = nil; loadError = nil; loading = false; openedID = nil
        details = [:]; detailErrors = [:]; drafts = [:]; query = ""; filter = .all; creating = false
    }

    private func detailFile(_ id: String) -> SealedFile<PortfolioDetail>? {
        guard let namespace else { return nil }
        return SealedFile<PortfolioDetail>(namespace: "portfolio-item-\(namespace)-\(id)")
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    // MARK: Lista
    func load(quiet: Bool = false) async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        do {
            let data = try JSONDecoder().decode(PortfolioHome.self, from: try await api.get("/portfolio", query: ["op": "home"]))
            guard owner == workspace?.employee?.id else { return }
            home = data
            loadError = nil
            if let homeFile { let copy = data; Task.detached(priority: .utility) { try? homeFile.save(copy) } }
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if !quiet || home == nil { loadError = failureText(error, "Nie udało się pobrać realizacji.") }
        }
    }

    /// Lista po filtrze i wyszukiwaniu: najnowsze wydarzenia najpierw, potem tytuł (jak w CRM).
    var visibleItems: [PortfolioListItem] {
        let locale = Locale(identifier: "pl_PL")
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(with: locale)
        let current = filter
        return (home?.items ?? [])
            .filter { current.matches($0.status) }
            .filter { item in
                needle.isEmpty || [item.title, item.category, item.location, item.eventName ?? ""].contains { $0.lowercased(with: locale).contains(needle) }
            }
            .sorted { a, b in
                let first = a.eventDate ?? "", second = b.eventDate ?? ""
                if first != second { return first > second }
                return a.title.compare(b.title, locale: locale) == .orderedAscending
            }
    }

    // MARK: Realizacja
    func detail(_ id: String) -> PortfolioDetail? { details[id] }

    /// Niezapisane zmiany w kopii roboczej.
    func dirty(_ id: String) -> Bool {
        guard let draft = drafts[id], let detail = details[id] else { return false }
        return draft.differs(from: detail)
    }

    /// Kopia robocza powstała z wcześniejszej wersji (realizację zapisano w innym oknie albo na innym urządzeniu).
    func stale(_ id: String) -> Bool {
        guard let draft = drafts[id], let detail = details[id] else { return false }
        return draft.version != detail.item.version && draft.differs(from: detail)
    }

    func loadDetail(_ id: String) async {
        guard let api else { return }
        let owner = workspace?.employee?.id
        if details[id] == nil, let file = detailFile(id), let saved = await Task.detached(priority: .userInitiated, operation: { try? file.load() }).value {
            remember(saved, own: false)
        }
        do {
            let data = try JSONDecoder().decode(PortfolioDetail.self, from: try await api.get("/portfolio", query: ["op": "item", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            remember(data, own: false)
            detailErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if let failure = error as? NativeFailure, failure.status == 404 {
                details[id] = nil; drafts[id] = nil
                try? detailFile(id)?.clear()
            }
            detailErrors[id] = failureText(error, "Nie udało się otworzyć realizacji.")
        }
    }

    /// Nowa wersja realizacji z serwera. Kopia robocza bez zmian (albo odpowiedź na własną czynność) — od nowa; ze zmianami
    /// zostaje (edytor pokazuje, że realizację zapisano gdzie indziej).
    private func remember(_ detail: PortfolioDetail, own: Bool) {
        let id = detail.item.id
        let untouched: Bool
        if let draft = drafts[id], let previous = details[id] { untouched = !draft.differs(from: previous) } else { untouched = true }
        details[id] = detail
        if own || untouched || drafts[id] == nil { drafts[id] = PortfolioDraft(detail) }
        if let file = detailFile(id) { let copy = detail; Task.detached(priority: .utility) { try? file.save(copy) } }
    }

    /// Odrzuca niezapisane zmiany (kopia robocza = ostatnia wersja z serwera).
    func discardDraft(_ id: String) {
        guard let detail = details[id] else { return }
        drafts[id] = PortfolioDraft(detail)
    }

    /// Zachowuje niezapisane zmiany mimo nowszej wersji na serwerze — następny zapis ją zastąpi.
    func keepDraft(_ id: String) {
        guard let detail = details[id] else { return }
        drafts[id]?.version = detail.item.version
    }

    func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval = 120) async throws -> Data {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return try await api.post("/portfolio", payload, timeout: timeout)
    }

    /// Czynność z modalnym wskaźnikiem i komunikatem; odpowiedź z kartą realizacji zastępuje kopię roboczą.
    @discardableResult private func runDetail(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?,
                                              timeout: TimeInterval = 120) async -> PortfolioDetail? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let data = try await workspace.withPending(pending) { try await post(op, body, timeout: timeout) }
            let detail = try JSONDecoder().decode(PortfolioDetail.self, from: data)
            remember(detail, own: true)
            detailErrors[detail.item.id] = nil
            if let success { workspace.succeed(success) }
            Task { await load(quiet: true) }
            return detail
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się.")
            return nil
        }
    }

    /// Nowa realizacja (szkic): z wydarzenia (nazwa, data, miejsce, rodzaj) albo od zera z tytułem.
    func create(title: String?, eventID: String?) async {
        var body: [String: JSONValue] = [:]
        if let title, !title.isEmpty { body["title"] = .string(title) }
        if let eventID { body["eventId"] = .string(eventID) }
        creating = false
        if let detail = await runDetail("Tworzę realizację", "create", body, success: "Utworzono szkic realizacji") {
            openedID = detail.item.id
        }
    }

    @discardableResult func save(_ id: String, quiet: Bool = false) async -> PortfolioDetail? {
        guard let draft = drafts[id] else { return nil }
        let body: [String: JSONValue] = [
            "id": .string(id), "version": .number(Double(draft.version)), "content": draft.content.json,
            "eventId": draft.eventID.map { JSONValue.string($0) } ?? .null,
        ]
        return await runDetail("Zapisuję realizację", "save", body, success: quiet ? nil : "Zapisano realizację")
    }

    /// Publikacja kopii roboczej na stronie; przy zmianach także na stronie — tylko z `overwrite`.
    @discardableResult func publish(_ detail: PortfolioDetail, overwrite: Bool) async -> PortfolioDetail? {
        let onSite = detail.item.status.onSite
        return await runDetail(onSite ? "Publikuję zmiany" : "Publikuję realizację", "publish",
                               ["id": .string(detail.item.id), "version": .number(Double(detail.item.version)), "overwrite": .bool(overwrite)],
                               success: onSite ? "Zmiany są na stronie" : "Realizacja jest na stronie", timeout: 180)
    }

    /// Kopia robocza = wersja ze strony (odrzucenie niepublikowanych zmian albo rozwiązanie konfliktu).
    @discardableResult func discard(_ id: String) async -> PortfolioDetail? {
        await runDetail("Pobieram wersję ze strony", "discard", ["id": .string(id)], success: "Kopia robocza = wersja ze strony")
    }

    @discardableResult func unpublish(_ detail: PortfolioDetail) async -> PortfolioDetail? {
        await runDetail("Usuwam realizację ze strony", "unpublish",
                        ["id": .string(detail.item.id), "version": .number(Double(detail.item.version))], success: "Realizacja zniknęła ze strony")
    }

    /// Usunięcie realizacji (opublikowanej — razem ze stroną). Zdjęcia zostają w źródłach.
    func delete(_ detail: PortfolioDetail) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        let id = detail.item.id
        do {
            _ = try await workspace.withPending("Usuwam realizację") {
                try await post("delete", ["id": .string(id), "version": .number(Double(detail.item.version)), "removeFromSite": .bool(detail.item.status.onSite)])
            }
            try? detailFile(id)?.clear()
            if openedID == id { openedID = nil }
            details[id] = nil; drafts[id] = nil; detailErrors[id] = nil
            workspace.succeed("Usunięto realizację")
            await load(quiet: true)
        } catch {
            workspace.error = failureText(error, "Nie udało się usunąć realizacji.")
        }
    }

    // MARK: Zdjęcia
    /// Zdjęcia z Findera lub z okna wyboru (JPEG, PNG, WebP bez zmian; HEIC, TIFF i większe — JPEG) → serwer CRM zapisuje
    /// trzy wersje WebP strony. Zwraca zdjęcia do dodania w kopii roboczej.
    func upload(_ urls: [URL], itemID: String) async -> [PortfolioPhoto] {
        guard let workspace else { return [] }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return [] }
        var photos: [PortfolioPhoto] = []
        var errors: [String] = []
        for (index, url) in urls.enumerated() {
            do {
                let photo = try await workspace.withPending("Wgrywam zdjęcia (\(index + 1)/\(urls.count))") { () async throws -> PortfolioPhoto in
                    let prepared = try await Task.detached(priority: .userInitiated) { try SocialStore.prepare(url) }.value
                    return try await uploadBytes(prepared.0, mime: prepared.1, itemID: itemID)
                }
                photos.append(photo)
            } catch {
                errors.append(failureText(error, "Nie udało się wgrać „\(url.lastPathComponent)”."))
            }
        }
        if let first = errors.first { workspace.error = first }
        else if !photos.isEmpty { workspace.succeed("Dodano zdjęcia: \(photos.count) — zapisz realizację") }
        return photos
    }

    private func uploadBytes(_ data: Data, mime: String, itemID: String) async throws -> PortfolioPhoto {
        guard let api else { throw AppError.configuration }
        let id = itemID.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? itemID
        guard let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/portfolio?op=upload&id=\(id)") else { throw AppError.configuration }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 240
        request.setValue(mime, forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        let (body, response) = try await URLSession.shared.upload(for: request, from: data)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(status) else {
            let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
            throw NativeFailure(status: status, message: object?["error"] as? String ?? "Nie udało się wgrać zdjęcia.", fieldErrors: [:])
        }
        return try JSONDecoder().decode(PortfolioPhotoReply.self, from: body).photo
    }

    /// Zdjęcia z plików wydarzenia, Materiałów albo biblioteki social media → wersje WebP strony.
    func importPhotos(_ options: [PortfolioPhotoOption], source: PortfolioPhotoSource, itemID: String) async -> [PortfolioPhoto] {
        guard let workspace else { return [] }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return [] }
        var photos: [PortfolioPhoto] = []
        var errors: [String] = []
        for (index, option) in options.enumerated() {
            do {
                let data = try await workspace.withPending("Dodaję zdjęcia (\(index + 1)/\(options.count))") {
                    try await post("import", ["id": .string(itemID), "source": .string(source.rawValue), "fileId": .string(option.id)], timeout: 180)
                }
                photos.append(try JSONDecoder().decode(PortfolioPhotoReply.self, from: data).photo)
            } catch {
                errors.append(failureText(error, "Nie udało się dodać „\(option.name)”."))
            }
        }
        if let first = errors.first { workspace.error = first }
        else if !photos.isEmpty { workspace.succeed("Dodano zdjęcia: \(photos.count) — zapisz realizację") }
        return photos
    }

    /// Zdjęcia do wyboru: pliki wydarzenia, Materiały albo biblioteka social media (z wyszukiwaniem po nazwie).
    func photos(source: PortfolioPhotoSource, eventID: String?, query: String) async throws -> PortfolioPhotosReply {
        guard let api else { throw AppError.configuration }
        var params = ["op": "photos", "source": source.rawValue]
        if let eventID { params["event"] = eventID }
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if source != .event, !trimmed.isEmpty { params["q"] = trimmed }
        return try JSONDecoder().decode(PortfolioPhotosReply.self, from: try await api.get("/portfolio", query: params))
    }

    /// Wydarzenia do powiązania (wyszukiwanie po nazwie, najnowsze najpierw).
    func events(query: String) async throws -> [PortfolioEvent] {
        guard let api else { throw AppError.configuration }
        var params = ["op": "events"]
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { params["q"] = trimmed }
        return try JSONDecoder().decode(PortfolioEventsReply.self, from: try await api.get("/portfolio", query: params)).events
    }

    // MARK: Social media
    /// „Utwórz post”: zdjęcia realizacji trafiają do biblioteki social media marki, powstaje szkic posta (okładka z tytułem,
    /// karuzela, opis i hashtagi z realizacji) — otwiera się w Social media. Niezapisane zmiany realizacji najpierw się zapisują.
    func createSocialPost(_ id: String, photos: [String], channels: [SocialChannel]) async {
        guard let workspace else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        if dirty(id) { guard await save(id, quiet: true) != nil else { return } }
        struct Reply: Decodable { let postId: String; let photos: Int }
        let body: [String: JSONValue] = [
            "id": .string(id), "photos": .array(photos.map { JSONValue.string($0) }),
            "channels": .array(channels.map { JSONValue.string($0.rawValue) }),
        ]
        do {
            let data = try await workspace.withPending("Tworzę post social media") { try await post("socialPost", body, timeout: 300) }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            workspace.succeed("Utworzono szkic posta (\(reply.photos) zdj.) — otwieram Social media")
            workspace.showSocialPost(reply.postId)
        } catch {
            workspace.error = failureText(error, "Nie udało się utworzyć posta.")
        }
    }

    // MARK: Asystent AI
    /// Propozycje tekstów do bieżącej (także niezapisanej) treści — nic się nie zapisuje, dopóki ich nie użyjesz.
    func assist(_ id: String, brief: String, fields: [PortfolioAiField], usePhotos: Bool, pending: String = "Asystent AI pisze") async -> PortfolioAiResult? {
        guard let workspace, let draft = drafts[id] else { return nil }
        guard workspace.canWrite else { workspace.error = "Asystent AI wymaga połączenia z serwerem CRM."; return nil }
        let body: [String: JSONValue] = [
            "id": .string(id), "content": draft.content.json, "eventId": draft.eventID.map { JSONValue.string($0) } ?? .null,
            "brief": .string(String(brief.prefix(1500))), "fields": .array(fields.map { JSONValue.string($0.rawValue) }), "usePhotos": .bool(usePhotos),
        ]
        do {
            let data = try await workspace.withPending(pending) { try await post("assist", body, timeout: 180) }
            return try JSONDecoder().decode(PortfolioAiResult.self, from: data)
        } catch {
            workspace.error = failureText(error, "Asystent AI nie odpowiedział. Spróbuj ponownie.")
            return nil
        }
    }
}

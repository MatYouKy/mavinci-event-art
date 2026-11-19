import Foundation
import SwiftUI
import AppKit
import ImageIO
import UniformTypeIdentifiers

// MARK: Social media — stan ekranu Marketing → „Social media” (`/crm/marketing/social`): kalendarz marki, posty, biblioteka,
// szablony i AI, publikacja w Meta i komentarze przez `/bridge/native/v1/social` (token pracownika, te same reguły co CRM).
// Kopia kalendarza i otwartych postów na dysku (zaszyfrowana), obrazy w pamięci podręcznej na dysku — widok otwiera się
// natychmiast, także bez internetu.

enum SocialTab: String, CaseIterable, Identifiable {
    case calendar, review, library, comments
    var id: String { rawValue }
    var label: String {
        switch self {
        case .calendar: return "Kalendarz"
        case .review: return "Do akceptacji"
        case .library: return "Biblioteka"
        case .comments: return "Komentarze"
        }
    }
    var symbol: String {
        switch self {
        case .calendar: return "calendar"
        case .review: return "checklist"
        case .library: return "photo.on.rectangle.angled"
        case .comments: return "bubble.left.and.bubble.right"
        }
    }
}

struct SocialLibraryFilter: Equatable {
    var status = "ready"
    var consent = ""
    var used = ""
    var query = ""
    var eventID: String?
    var eventName: String?
    var offset = 0
}

/// Obrazy social media: pamięć i dysk (`~/Library/Caches/Mavinci/social`). Klucz — ścieżka pliku bez podpisu linku
/// (pliki w bibliotece i grafiki mają niezmienne nazwy), więc nowy podpisany link nie pobiera obrazu ponownie.
@MainActor final class SocialImageCache {
    static let shared = SocialImageCache()
    private var images: [String: NSImage] = [:]
    private var loading: [String: Task<NSImage?, Never>] = [:]
    private let directory: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/social", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return base
    }()

    static func key(_ url: String) -> String {
        guard let components = URLComponents(string: url) else { return url }
        return (components.host ?? "") + components.path
    }

    func cached(_ url: String?) -> NSImage? {
        guard let url, !url.isEmpty else { return nil }
        let key = Self.key(url)
        if let image = images[key] { return image }
        let file = directory.appendingPathComponent(digest(key))
        if let image = NSImage(contentsOf: file) { images[key] = image; return image }
        return nil
    }

    func image(_ url: String) async -> NSImage? {
        let key = Self.key(url)
        if let image = cached(url) { return image }
        if let task = loading[key] { return await task.value }
        let file = directory.appendingPathComponent(digest(key))
        let task = Task<NSImage?, Never> {
            guard let address = URL(string: url),
                  let (data, response) = try? await URLSession.shared.data(from: address),
                  (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
                  let image = NSImage(data: data) else { return nil }
            try? data.write(to: file, options: .atomic)
            return image
        }
        loading[key] = task
        let image = await task.value
        loading[key] = nil
        if let image {
            images[key] = image
            if images.count > 400 { images.removeAll() }
        }
        return image
    }

    func clear() {
        images = [:]
        try? FileManager.default.removeItem(at: directory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    }
}

/// Obraz z biblioteki lub grafika posta (z pamięci podręcznej).
@MainActor struct SocialImageView: View {
    let url: String?
    var contentMode: ContentMode = .fill
    @State private var image: NSImage?

    init(url: String?, contentMode: ContentMode = .fill) {
        self.url = url
        self.contentMode = contentMode
        _image = State(initialValue: SocialImageCache.shared.cached(url))
    }

    var body: some View {
        ZStack {
            if let image {
                Image(nsImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else {
                Rectangle().fill(Color.primary.opacity(0.06))
                    .overlay(Image(systemName: "photo").foregroundStyle(.tertiary))
            }
        }
        .task(id: url) {
            guard let url, !url.isEmpty else { image = nil; return }
            if let cached = SocialImageCache.shared.cached(url) { image = cached; return }
            image = await SocialImageCache.shared.image(url)
        }
    }
}

@MainActor final class SocialStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var home: SocialHome?
    @Published var loadError: String?
    @Published private(set) var loading = false
    @Published var companyID: String?
    @Published var month: Date = SocialStore.firstOfMonth(Date())
    @Published var tab: SocialTab = .calendar
    /// Post otwarty w kreatorze (zamiast kalendarza).
    @Published var openedPostID: String?
    @Published private(set) var details: [String: SocialPostDetail] = [:]
    @Published var detailErrors: [String: String] = [:]
    @Published private(set) var library: SocialLibraryPage?
    @Published var libraryFilter = SocialLibraryFilter()
    @Published var libraryError: String?
    @Published var settingsShown = false
    /// Komentarze: `post:<id>` — wątki posta, `company:<marka>` — skrzynka marki (filtr `commentsFilter`).
    @Published private(set) var comments: [String: SocialCommentsReply] = [:]
    @Published var commentsFilter = "unanswered"
    @Published var commentsError: String?
    /// Post otwarty z powiadomienia o komentarzach — kreator przewija do komentarzy.
    @Published var focusComments = false

    private var namespace: String?
    private var homeFile: SealedFile<SocialHome>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var access: SocialAccess? { home?.access }

    static func firstOfMonth(_ date: Date) -> Date {
        let calendar = Calendar.current
        return calendar.date(from: calendar.dateComponents([.year, .month], from: date)) ?? date
    }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<SocialHome>(namespace: "social-home-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            homeFile = sealed
            if home == nil, let saved { home = saved; companyID = companyID ?? saved.company.id }
        }
    }

    func reset(clearDisk: Bool = true) {
        if clearDisk, let homeFile { try? homeFile.clear() }
        if clearDisk {
            for id in details.keys { try? detailFile(id)?.clear() }
            SocialImageCache.shared.clear()
        }
        homeFile = nil; namespace = nil; home = nil; loadError = nil; loading = false; companyID = nil
        month = Self.firstOfMonth(Date()); tab = .calendar; openedPostID = nil; details = [:]; detailErrors = [:]
        library = nil; libraryFilter = SocialLibraryFilter(); libraryError = nil; settingsShown = false
        comments = [:]; commentsFilter = "unanswered"; commentsError = nil; focusComments = false
    }

    private func detailFile(_ id: String) -> SealedFile<SocialPostDetail>? {
        guard let namespace else { return nil }
        return SealedFile<SocialPostDetail>(namespace: "social-post-\(namespace)-\(id)")
    }

    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }

    // MARK: Kalendarz
    /// Dni siatki miesiąca (od poniedziałku do niedzieli) i zakres do pobrania.
    var gridDays: [Date] {
        let calendar = Calendar(identifier: .iso8601)
        let first = month
        let weekday = (calendar.component(.weekday, from: first) + 5) % 7
        guard let start = calendar.date(byAdding: .day, value: -weekday, to: first),
              let nextMonth = calendar.date(byAdding: .month, value: 1, to: first),
              let last = calendar.date(byAdding: .day, value: -1, to: nextMonth) else { return [] }
        let tail = 6 - (calendar.component(.weekday, from: last) + 5) % 7
        guard let end = calendar.date(byAdding: .day, value: tail, to: last) else { return [] }
        var days: [Date] = []
        var day = start
        while day <= end {
            days.append(day)
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return days
    }

    func load(quiet: Bool = false) async {
        guard let api else { loadError = "Brak połączenia z serwerem CRM."; return }
        let owner = workspace?.employee?.id
        let days = gridDays
        guard let first = days.first, let last = days.last, let to = Calendar.current.date(byAdding: .day, value: 1, to: last) else { return }
        var query = ["op": "home", "from": SocialDates.iso(first), "to": SocialDates.iso(to)]
        if let companyID { query["company"] = companyID }
        if !quiet { loading = true }
        defer { if !quiet { loading = false } }
        do {
            let data = try JSONDecoder().decode(SocialHome.self, from: try await api.get("/social", query: query))
            guard owner == workspace?.employee?.id else { return }
            home = data
            companyID = data.company.id
            loadError = nil
            if let homeFile { let copy = data; Task.detached(priority: .utility) { try? homeFile.save(copy) } }
        } catch {
            guard owner == workspace?.employee?.id else { return }
            if !quiet || home == nil { loadError = failureText(error, "Nie udało się załadować social media") }
        }
    }

    func posts(on day: Date) -> [SocialPostItem] {
        let calendar = Calendar.current
        return (home?.posts ?? []).filter { post in
            guard let date = post.scheduledDate else { return false }
            return calendar.isDate(date, inSameDayAs: day)
        }.sorted { ($0.scheduledDate ?? .distantPast) < ($1.scheduledDate ?? .distantPast) }
    }
    var undatedPosts: [SocialPostItem] { (home?.posts ?? []).filter { $0.scheduledAt == nil && $0.status.editable } }
    /// Do akceptacji, do poprawy i z błędem publikacji („Wymaga uwagi”).
    var reviewPosts: [SocialPostItem] { (home?.posts ?? []).filter { [.inReview, .changesRequested, .failed].contains($0.status) } }

    // MARK: Post
    func detail(_ id: String) -> SocialPostDetail? { details[id] }

    func loadDetail(_ id: String) async {
        guard let api else { return }
        let owner = workspace?.employee?.id
        if details[id] == nil, let file = detailFile(id), let saved = await Task.detached(priority: .userInitiated, operation: { try? file.load() }).value {
            details[id] = saved
        }
        do {
            let data = try JSONDecoder().decode(SocialPostDetail.self, from: try await api.get("/social", query: ["op": "post", "id": id]))
            guard owner == workspace?.employee?.id else { return }
            store(data)
            detailErrors[id] = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            detailErrors[id] = failureText(error, "Nie udało się otworzyć posta.")
        }
    }

    private func store(_ detail: SocialPostDetail) {
        details[detail.post.id] = detail
        if let file = detailFile(detail.post.id) { let copy = detail; Task.detached(priority: .utility) { try? file.save(copy) } }
    }

    func post(_ op: String, _ body: [String: JSONValue], timeout: TimeInterval = 180) async throws -> Data {
        guard let api else { throw AppError.configuration }
        var payload = body
        payload["op"] = .string(op)
        return try await api.post("/social", payload, timeout: timeout)
    }

    /// Czynność z modalnym wskaźnikiem i komunikatem; odpowiedź z kartą posta zapisuje się w pamięci i na dysku.
    @discardableResult func runDetail(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?,
                                      timeout: TimeInterval = 180) async -> SocialPostDetail? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let data = try await workspace.withPending(pending) { try await post(op, body, timeout: timeout) }
            let detail = try JSONDecoder().decode(SocialPostDetail.self, from: data)
            store(detail)
            if let success { workspace.succeed(success) }
            Task { await load(quiet: true) }
            return detail
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się")
            return nil
        }
    }

    /// Czynność bez karty posta w odpowiedzi (biblioteka, ustawienia); zwraca surową odpowiedź albo `nil` przy błędzie.
    @discardableResult func run(_ pending: String, _ op: String, _ body: [String: JSONValue], success: String?) async -> Data? {
        guard let workspace else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        do {
            let data = try await workspace.withPending(pending) { try await post(op, body) }
            if let success { workspace.succeed(success) }
            return data
        } catch {
            workspace.error = failureText(error, "Operacja nie powiodła się")
            return nil
        }
    }

    func selectCompany(_ id: String) async {
        guard id != companyID else { return }
        companyID = id
        library = nil
        libraryFilter = SocialLibraryFilter()
        openedPostID = nil
        await load()
    }

    func openPost(_ id: String?) {
        openedPostID = id
        if let id { Task { await loadDetail(id) } }
    }

    func createPost(scheduledAt: Date? = nil, assetID: String? = nil) async {
        guard let companyID = home?.company.id else { return }
        var body: [String: JSONValue] = [
            "companyId": .string(companyID),
            "channels": .array([.string(SocialChannel.instagramFeed.rawValue), .string(SocialChannel.facebookFeed.rawValue)]),
        ]
        if let scheduledAt { body["scheduledAt"] = .string(SocialDates.iso(scheduledAt)) }
        if let assetID { body["assetId"] = .string(assetID) }
        if let detail = await runDetail("Tworzę post", "createPost", body, success: assetID == nil ? "Utworzono szkic posta" : "Utworzono szkic posta ze zdjęciem") {
            tab = .calendar
            openedPostID = detail.post.id
        }
    }

    /// Termin z kalendarza (przeciągnięcie) — godzina zostaje (bez terminu — 18:00).
    func schedule(_ postID: String, to day: Date) async {
        guard let post = home?.posts.first(where: { $0.id == postID }), post.status.editable, let workspace else { return }
        if post.status == .scheduled && home?.access.publish != true {
            workspace.error = "Termin zaplanowanej publikacji zmienia osoba z uprawnieniem „Publikacja”."
            return
        }
        let calendar = Calendar.current
        let base = post.scheduledDate
        if let base, calendar.isDate(base, inSameDayAs: day) { return }
        var parts = calendar.dateComponents([.year, .month, .day], from: day)
        parts.hour = base.map { calendar.component(.hour, from: $0) } ?? 18
        parts.minute = base.map { calendar.component(.minute, from: $0) } ?? 0
        guard let target = calendar.date(from: parts) else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        do {
            _ = try await workspace.withPending("Zmieniam termin") {
                try await post("schedule", ["id": .string(post.id), "updatedAt": .string(post.updatedAt), "scheduledAt": .string(SocialDates.iso(target))])
            }
            workspace.succeed("Zmieniono termin publikacji")
        } catch {
            workspace.error = failureText(error, "Nie udało się zmienić terminu.")
        }
        await load(quiet: true)
    }

    func transition(_ detail: SocialPostDetail, _ action: SocialPostAction, note: String? = nil, url: String? = nil) async {
        var body: [String: JSONValue] = ["id": .string(detail.post.id), "action": .string(action.rawValue), "revision": .number(Double(detail.post.revision))]
        if let note, !note.isEmpty { body["note"] = .string(note) }
        if let url, !url.isEmpty { body["url"] = .string(url) }
        await runDetail(action.label, "transition", body, success: action.success)
    }

    // MARK: Publikacja w Meta
    /// „Opublikuj teraz” / „Ponów publikację” — serwer publikuje od razu i zwraca wynik (kanały już opublikowane pomija).
    @discardableResult func publishNow(_ detail: SocialPostDetail) async -> SocialPostDetail? {
        let retry = detail.post.status == .failed
        guard let result = await runDetail(retry ? "Ponawiam publikację" : "Publikuję w Meta", "publishNow",
                                           ["id": .string(detail.post.id), "revision": .number(Double(detail.post.revision))],
                                           success: nil, timeout: 300) else { return nil }
        switch result.publishResult?.status {
        case "published": workspace?.succeed("Post opublikowany w Meta")
        case "failed": workspace?.error = result.publishResult?.error ?? "Publikacja nie powiodła się."
        default: workspace?.notice = "Publikacja trwa — karta odświeży się sama."
        }
        return result
    }

    /// „Zaplanuj publikację” (albo zmiana terminu zaplanowanej) — publikacja w Meta w podanym terminie.
    @discardableResult func schedulePublication(_ detail: SocialPostDetail, at date: Date) async -> SocialPostDetail? {
        await runDetail("Planuję publikację", "schedulePublication", [
            "id": .string(detail.post.id), "revision": .number(Double(detail.post.revision)), "scheduledAt": .string(SocialDates.iso(date)),
        ], success: detail.post.status == .scheduled ? "Zmieniono termin publikacji" : SocialPostAction.schedule.success)
    }

    // MARK: Komentarze
    private func commentsKey(_ postID: String?) -> String? {
        if let postID { return "post:\(postID)" }
        return (home?.company.id ?? companyID).map { "company:\($0)" }
    }

    func comments(postID: String?) -> SocialCommentsReply? { commentsKey(postID).flatMap { comments[$0] } }

    func loadComments(postID: String?) async {
        guard let api, let key = commentsKey(postID) else { return }
        let owner = workspace?.employee?.id
        var query = ["op": "comments"]
        if let postID { query["post"] = postID } else if let companyID = home?.company.id ?? companyID {
            query["company"] = companyID
            query["filter"] = commentsFilter
        }
        do {
            let data = try JSONDecoder().decode(SocialCommentsReply.self, from: try await api.get("/social", query: query))
            guard owner == workspace?.employee?.id else { return }
            comments[key] = data
            commentsError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            commentsError = failureText(error, "Nie udało się pobrać komentarzy.")
        }
    }

    /// Komentarze prosto z Meta (przycisk „Odśwież”; harmonogram robi to co 15 minut).
    func refreshComments(postID: String?) async {
        guard let key = commentsKey(postID) else { return }
        var body: [String: JSONValue] = [:]
        if let postID { body["postId"] = .string(postID) } else if let companyID = home?.company.id ?? companyID {
            body["companyId"] = .string(companyID)
            body["filter"] = .string(commentsFilter)
        }
        guard let data = await run("Pobieram komentarze z Meta", "commentsRefresh", body, success: "Komentarze są aktualne") else { return }
        if let reply = try? JSONDecoder().decode(SocialCommentsReply.self, from: data) { comments[key] = reply }
        await load(quiet: true)
    }

    /// Odpowiedź marki (strona Facebook / profil Instagram) na komentarz.
    func reply(to thread: SocialCommentThread, message: String, postID: String?) async -> Bool {
        guard let key = commentsKey(postID) else { return false }
        let body: [String: JSONValue] = [
            "commentId": .string(thread.id), "message": .string(message),
            "scope": .string(postID == nil ? "company" : "post"), "filter": .string(commentsFilter),
        ]
        let success = thread.platform == "facebook" ? "Odpowiedź opublikowana na Facebooku" : "Odpowiedź opublikowana na Instagramie"
        guard let data = await run("Publikuję odpowiedź", "reply", body, success: success) else { return false }
        if let reply = try? JSONDecoder().decode(SocialCommentsReply.self, from: data) { comments[key] = reply }
        await load(quiet: true)
        return true
    }

    /// Paczka posta (grafiki JPEG i opis) — zapis w wybranym miejscu (domyślnie Pobrane).
    func savePackage(_ detail: SocialPostDetail) async {
        guard let api, let workspace else { return }
        do {
            let data = try await workspace.withPending("Przygotowuję paczkę") {
                try await api.get("/social", query: ["op": "package", "id": detail.post.id])
            }
            let panel = NSSavePanel()
            let base = detail.post.title.isEmpty ? "post" : detail.post.title
            panel.nameFieldStringValue = base.replacingOccurrences(of: "/", with: "-") + ".zip"
            panel.allowedContentTypes = [.zip]
            panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            guard panel.runModal() == .OK, let target = panel.url else { return }
            try data.write(to: target, options: .atomic)
            workspace.succeed("Zapisano paczkę: grafiki i opis")
        } catch {
            workspace.error = failureText(error, "Nie udało się przygotować paczki.")
        }
    }

    // MARK: Biblioteka
    func loadLibrary() async {
        guard let api, let companyID = home?.company.id ?? companyID else { return }
        let owner = workspace?.employee?.id
        let filter = libraryFilter
        var query: [String: String] = ["op": "library", "company": companyID, "status": filter.status, "offset": String(filter.offset), "limit": "60"]
        if !filter.consent.isEmpty { query["consent"] = filter.consent }
        if !filter.used.isEmpty { query["used"] = filter.used }
        if !filter.query.trimmingCharacters(in: .whitespaces).isEmpty { query["q"] = filter.query.trimmingCharacters(in: .whitespaces) }
        if let eventID = filter.eventID { query["event"] = eventID }
        do {
            let data = try JSONDecoder().decode(SocialLibraryPage.self, from: try await api.get("/social", query: query))
            guard owner == workspace?.employee?.id, filter == libraryFilter else { return }
            library = data
            libraryError = nil
        } catch {
            guard owner == workspace?.employee?.id else { return }
            libraryError = failureText(error, "Nie udało się pobrać biblioteki.")
        }
    }

    /// Zdjęcia z Findera lub z okna wyboru: JPEG, PNG i WebP bez zmian (do 24 MB), inne (HEIC, TIFF) i większe — JPEG
    /// z orientacją zapisaną w pikselach. Każde zdjęcie: wpis w bibliotece → plik przez serwer CRM → analiza.
    func upload(_ urls: [URL], eventID: String? = nil) async {
        guard let workspace, let companyID = home?.company.id else { return }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        var added = 0, duplicates = 0
        var errors: [String] = []
        for (index, url) in urls.enumerated() {
            do {
                try await workspace.withPending("Wgrywam zdjęcia (\(index + 1)/\(urls.count))") {
                    let (data, mime) = try Self.prepare(url)
                    var body: [String: JSONValue] = [
                        "companyId": .string(companyID), "fileName": .string(url.lastPathComponent), "mimeType": .string(mime),
                        "bytes": .number(Double(data.count)), "source": .string("mac"),
                    ]
                    if let eventID { body["eventId"] = .string(eventID) }
                    let ticket = try JSONDecoder().decode(SocialUploadTicket.self, from: try await post("assetCreate", body))
                    let reply = try await uploadBytes(data, mime: mime, assetID: ticket.assetId)
                    if reply.duplicateOf != nil { duplicates += 1 } else { added += 1 }
                }
            } catch {
                errors.append(failureText(error, "Nie udało się wgrać „\(url.lastPathComponent)”."))
            }
        }
        if added > 0 { workspace.succeed("Dodano do biblioteki: \(added)" + (duplicates > 0 ? " · już były: \(duplicates)" : "")) }
        else if duplicates > 0 { workspace.notice = "Te zdjęcia są już w bibliotece." }
        if let first = errors.first { workspace.error = first }
        libraryFilter.offset = 0
        await loadLibrary()
        await load(quiet: true)
    }

    private func uploadBytes(_ data: Data, mime: String, assetID: String) async throws -> SocialAssetDetail {
        guard let api else { throw AppError.configuration }
        guard let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/native/v1/social?op=upload&id=\(assetID)") else { throw AppError.configuration }
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
        return try JSONDecoder().decode(SocialAssetDetail.self, from: body)
    }

    /// Bajty i typ zdjęcia do wysłania (JPEG / PNG / WebP do 24 MB bez zmian; pozostałe — JPEG 92%, najwyżej 6000 px).
    nonisolated static func prepare(_ url: URL) throws -> (Data, String) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let data = try Data(contentsOf: url)
        let type = UTType(filenameExtension: url.pathExtension.lowercased())
        let direct: [(UTType, String)] = [(.jpeg, "image/jpeg"), (.png, "image/png"), (.webP, "image/webp")]
        if let type, let match = direct.first(where: { type.conforms(to: $0.0) }), data.count <= 24 * 1024 * 1024 {
            return (data, match.1)
        }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { throw NativeFailure(status: 415, message: "„\(url.lastPathComponent)” nie jest zdjęciem.", fieldErrors: [:]) }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 6000,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            throw NativeFailure(status: 415, message: "Nie udało się odczytać „\(url.lastPathComponent)”.", fieldErrors: [:])
        }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw AppError.server }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw AppError.server }
        let jpeg = output as Data
        guard jpeg.count <= 40 * 1024 * 1024 else { throw NativeFailure(status: 413, message: "„\(url.lastPathComponent)” jest za duże (ponad 40 MB).", fieldErrors: [:]) }
        return (jpeg, "image/jpeg")
    }

    func importEventFile(_ fileID: String) async -> Bool {
        guard let companyID = home?.company.id else { return false }
        guard let data = await run("Dodaję zdjęcie do biblioteki", "assetImport", ["companyId": .string(companyID), "eventFileId": .string(fileID)], success: nil) else { return false }
        let reply = try? JSONDecoder().decode(SocialAssetDetail.self, from: data)
        workspace?.succeed(reply?.duplicateOf != nil ? "To zdjęcie jest już w bibliotece" : "Dodano zdjęcie do biblioteki")
        await loadLibrary()
        return true
    }

    func importPortfolio(_ projectID: String, imageURL: String) async {
        guard let companyID = home?.company.id else { return }
        guard let data = await run("Dodaję zdjęcie do biblioteki", "assetImport", ["companyId": .string(companyID), "portfolioProjectId": .string(projectID), "imageUrl": .string(imageURL)], success: nil) else { return }
        let reply = try? JSONDecoder().decode(SocialAssetDetail.self, from: data)
        workspace?.succeed(reply?.duplicateOf != nil ? "To zdjęcie jest już w bibliotece" : "Dodano zdjęcie do biblioteki")
        await loadLibrary()
    }

    /// Zmiana zdjęcia w bibliotece (opis, powiązania, zgoda, status); zwraca nową kartę zdjęcia.
    func updateAsset(_ asset: SocialAsset, _ patch: [String: JSONValue], success: String) async -> SocialAssetDetail? {
        var body = patch
        body["id"] = .string(asset.id)
        body["updatedAt"] = .string(asset.updatedAt)
        guard let data = await run("Zapisuję zdjęcie", "assetUpdate", body, success: success) else { return nil }
        let detail = try? JSONDecoder().decode(SocialAssetDetail.self, from: data)
        await loadLibrary()
        return detail
    }

    func assetDetail(_ id: String) async -> SocialAssetDetail? {
        guard let api else { return nil }
        do {
            return try JSONDecoder().decode(SocialAssetDetail.self, from: try await api.get("/social", query: ["op": "asset", "id": id]))
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać zdjęcia.")
            return nil
        }
    }

    func deleteAsset(_ id: String) async -> Bool {
        guard await run("Usuwam zdjęcie", "assetDelete", ["id": .string(id)], success: "Usunięto zdjęcie z biblioteki") != nil else { return false }
        await loadLibrary()
        return true
    }

    func saveConsent(eventID: String?, organizationID: String?, status: String, channels: [String], note: String) async -> Bool {
        var body: [String: JSONValue] = ["status": .string(status), "channels": .array(channels.map(JSONValue.string)), "note": .string(note)]
        if let eventID { body["eventId"] = .string(eventID) } else if let organizationID { body["organizationId"] = .string(organizationID) }
        return await run("Zapisuję zgodę", "consent", body, success: "Zapisano zgodę klienta") != nil
    }

    func events(query: String) async -> [SocialEventOption] {
        guard let api else { return [] }
        var params = ["op": "events", "q": query]
        if let companyID = home?.company.id { params["company"] = companyID }
        do {
            return try JSONDecoder().decode(SocialEventsReply.self, from: try await api.get("/social", query: params)).events
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać wydarzeń.")
            return []
        }
    }

    func eventFiles(_ eventID: String) async -> [SocialEventFile] {
        guard let api else { return [] }
        do {
            return try JSONDecoder().decode(SocialEventFilesReply.self, from: try await api.get("/social", query: ["op": "eventImages", "event": eventID])).files
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać plików wydarzenia.")
            return []
        }
    }

    func portfolio(query: String) async -> [SocialPortfolioProject] {
        guard let api else { return [] }
        do {
            return try JSONDecoder().decode(SocialPortfolioReply.self, from: try await api.get("/social", query: ["op": "portfolio", "q": query])).projects
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać realizacji.")
            return []
        }
    }

    // MARK: Ustawienia i szablony
    func brandbook() async -> SocialBrandbook? {
        guard let api, let companyID = home?.company.id else { return nil }
        do {
            return try JSONDecoder().decode(SocialBrandbook.self, from: try await api.get("/social", query: ["op": "brandbook", "company": companyID]))
        } catch {
            workspace?.error = failureText(error, "Nie udało się pobrać księgi znaku.")
            return nil
        }
    }

    func saveSettings(ai: Bool, hashtags: [String], style: String) async {
        guard let companyID = home?.company.id else { return }
        let body: [String: JSONValue] = [
            "companyId": .string(companyID), "aiCaptionsEnabled": .bool(ai),
            "defaultHashtags": .array(hashtags.map(JSONValue.string)), "captionStyle": .string(style),
        ]
        if await run("Zapisuję ustawienia", "settings", body, success: "Zapisano ustawienia social media") != nil { await load(quiet: true) }
    }

    func saveTemplate(_ body: [String: JSONValue]) async -> [SocialTemplate]? {
        guard let companyID = home?.company.id else { return nil }
        var payload = body
        payload["companyId"] = .string(companyID)
        guard let data = await run("Zapisuję szablon", "template", payload, success: "Zapisano szablon grafik") else { return nil }
        struct Reply: Decodable { let templates: [SocialTemplate] }
        await load(quiet: true)
        return (try? JSONDecoder().decode(Reply.self, from: data))?.templates
    }
}

extension Workspace {
    /// Post w kreatorze Social media (`/crm/marketing/social?post=<id>`; `nil` — kalendarz); `comments` — powiadomienie
    /// o komentarzach (kreator przewija do komentarzy, bez posta — zakładka Komentarze). Bez ekranu na Macu — strona CRM.
    func showSocialPost(_ id: String?, comments: Bool = false) {
        guard navigation.flatMap(\.flattened).contains(where: { $0.path == "/crm/marketing/social" }) else {
            let tab: String? = comments ? "tab=comments" : nil
            let query = [id.map { "post=\($0)" }, tab].compactMap { $0 }.joined(separator: "&")
            openCRM("/crm/marketing/social" + (query.isEmpty ? "" : "?" + query))
            return
        }
        if let item = navigation.flatMap(\.flattened).first(where: { $0.path == "/crm/marketing/social" }) { openHref(item.href) }
        social.focusComments = comments && id != nil
        if comments && id == nil { social.tab = .comments }
        social.openPost(id)
        Task { await social.load(quiet: social.home != nil) }
    }
}

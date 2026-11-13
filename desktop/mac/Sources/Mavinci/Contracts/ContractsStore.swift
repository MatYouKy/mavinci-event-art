import AppKit
import Foundation
import PDFKit

// MARK: Umowy z klientami (`/crm/contracts`, `/crm/contract-templates`) — kopia na dysku, synchronizacja i czynności
// (`/bridge/native/v1/contracts`, `src/lib/native/contracts.ts`).

struct ContractListItem: Codable, Identifiable, Hashable {
    struct EventRef: Codable, Hashable {
        var id: String
        var name: String
        var date: String?
    }
    var id: String
    var number: String?
    var title: String
    var status: String
    var statusAt: String?
    var version: Int
    var createdAt: String?
    var client: String?
    var event: EventRef?
    var eventId: String?
    var template: String?
    var pdf: Bool
    var pdfAt: String?
    var modified: Bool
    var locked: Bool
    var companySigned: Bool

    var displayNumber: String { number?.isEmpty == false ? number! : "—" }
    var sortNumber: String { number ?? "" }
    var sortClient: String { client ?? "" }
    var sortEvent: String { event?.date ?? "" }
    var sortCreated: String { createdAt ?? "" }
    var statusText: String { ContractText.status(status) }
    var pdfState: String { !pdf ? "Brak PDF" : modified && status != "cancelled" ? "Nieaktualny" : "Aktualny" }
    var searchText: String { [number ?? "", title, client ?? "", event?.name ?? "", template ?? "", statusText].joined(separator: " ") }
}

struct ContractTemplateItem: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var description: String?
    var active: Bool
    var createdAt: String?
    var updatedAt: String?
    var categories: [String]
    var contracts: Int
    var format: String
    var pages: Int
    var conditions: Int
    var options: [String]
    var fields: Int

    var formatText: String { format == "word" ? "Edytor jak Word" : "Starszy format" }
    var sortUpdated: String { updatedAt ?? createdAt ?? "" }
    var categoriesText: String { categories.isEmpty ? "—" : categories.joined(separator: ", ") }
    var activeText: String { active ? "Aktywny" : "Nieaktywny" }
    var searchText: String { [name, description ?? "", categories.joined(separator: " ")].joined(separator: " ") }
}

struct ContractsState: Codable {
    var hash: String
    var canView: Bool
    var canManage: Bool
    var canCreate: Bool
    var isAdmin: Bool
    var contracts: [ContractListItem]
    var templates: [ContractTemplateItem]
    var syncedAt: Date?
}

@MainActor final class ContractsStore: ObservableObject {
    weak var workspace: Workspace?
    @Published private(set) var state: ContractsState?
    @Published var syncing = false
    @Published var loadError: String?
    @Published var selectedContractID: String?
    @Published var selectedTemplateID: String?
    /// Szablon otwarty w edytorze (ekran „Szablony umów” pokazuje wtedy kartkę zamiast listy).
    @Published var editingTemplateID: String?
    /// Otwarta edycja treści szablonu — zostaje (z niezapisanymi zmianami i historią cofania) przy przejściu do innej
    /// części aplikacji; zamyka ją powrót do listy szablonów.
    @Published var editorSession: ContractEditorController?

    private var namespace: String?
    private var file: SealedFile<ContractsState>?
    private var syncTask: Task<Void, Never>?

    var api: NativeAPI? { workspace?.nativeAPI() }
    var contracts: [ContractListItem] { state?.contracts ?? [] }
    var templates: [ContractTemplateItem] { state?.templates ?? [] }
    var loaded: Bool { state != nil }
    var canManage: Bool { state?.canManage ?? false }
    var canCreate: Bool { state?.canCreate ?? false }
    func contract(_ id: String?) -> ContractListItem? { id.flatMap { id in contracts.first { $0.id == id } } }
    func template(_ id: String?) -> ContractTemplateItem? { id.flatMap { id in templates.first { $0.id == id } } }

    // MARK: Kopia na dysku
    func open(namespace next: String) {
        guard namespace != next else { return }
        reset(clearDisk: false)
        namespace = next
        let sealed = SealedFile<ContractsState>(namespace: "contracts-\(next)")
        Task {
            let saved = await Task.detached(priority: .userInitiated) { try? sealed.load() }.value
            guard namespace == next else { return }
            file = sealed
            if state == nil, let saved { state = saved }
        }
    }

    func reset(clearDisk: Bool = true) {
        syncTask?.cancel(); syncTask = nil
        if clearDisk, let file { try? file.clear() }
        file = nil; namespace = nil; state = nil; syncing = false; loadError = nil
        selectedContractID = nil; selectedTemplateID = nil; editingTemplateID = nil; editorSession = nil
    }

    // MARK: Synchronizacja
    /// `force` — po zapisie: czeka na trwające pobieranie i pobiera jeszcze raz (żeby pokazać zmianę).
    func sync(force: Bool = false) async {
        if let syncTask {
            await syncTask.value
            if !force { return }
        }
        let task = Task { await performSync() }
        syncTask = task
        await task.value
        if syncTask == task { syncTask = nil }
    }

    func backgroundSync() async {
        for _ in 0..<20 where file == nil && namespace != nil { try? await Task.sleep(for: .milliseconds(100)) }
        await sync()
    }

    private func performSync() async {
        guard let api else { return }
        syncing = true
        defer { syncing = false }
        do {
            var next = try JSONDecoder().decode(ContractsState.self, from: try await api.get("/contracts?op=state"))
            next.syncedAt = Date()
            if state?.hash != next.hash { state = next } else { state?.syncedAt = next.syncedAt }
            loadError = nil
            if let file, let snapshot = state {
                await Task.detached(priority: .utility) { try? file.save(snapshot) }.value
            }
        } catch {
            if state == nil { loadError = failureText(error, "Nie udało się pobrać umów.") }
        }
    }

    // MARK: Czynności
    func failureText(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        return (error as? LocalizedError)?.errorDescription ?? fallback
    }

    /// Zapis na serwerze z oknem postępu i komunikatem; potem odświeżenie listy. Zwraca odpowiedź (np. `id` nowego szablonu).
    @discardableResult func run(_ pending: String, _ body: [String: JSONValue], success: String) async -> [String: JSONValue]? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/contracts", body) }
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            await sync(force: true)
            workspace.succeed(success)
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać zmian.")
            await sync(force: true)
            return nil
        }
    }

    /// Treść szablonu dla edytora (HTML, style dokumentu, opcje, nazwy pól i miejsc na klauzule).
    func templateDocument(_ id: String) async throws -> ContractTemplateDocumentPayload {
        guard let api else { throw AppError.configuration }
        return try JSONDecoder().decode(ContractTemplateDocumentPayload.self, from: try await api.get("/contracts?op=template&id=\(id)"))
    }

    /// Zapis treści szablonu z edytora na Macu (jak „Zapisz” w edytorze CRM) z kontrolą wersji. Zwraca nową wersję
    /// (`updated_at`) albo `nil` — wtedy komunikat błędu jest już w oknie.
    func saveTemplateContent(_ id: String, html: String, updatedAt: String?, layout: JSONValue, documentStyles: JSONValue) async -> String? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        struct Reply: Decodable { let updatedAt: String? }
        do {
            let body: [String: JSONValue] = [
                "op": .string("templateContent"), "id": .string(id), "html": .string(html),
                "updatedAt": updatedAt.map { JSONValue.string($0) } ?? JSONValue.null,
                "layout": layout, "documentStyles": documentStyles,
            ]
            let data = try await workspace.withPending("Zapisywanie szablonu…") { try await api.post("/contracts", body) }
            guard let next = (try? JSONDecoder().decode(Reply.self, from: data))?.updatedAt else { throw AppError.invalidResponse }
            workspace.succeed("Szablon zapisany")
            Task { await sync(force: true) }
            return next
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać szablonu.")
            return nil
        }
    }

    /// Obraz do treści szablonu (logo, grafika) — wysyłka do magazynu logotypów; zwraca publiczny adres albo `nil`
    /// (komunikat błędu w oknie).
    func uploadTemplateImage(_ data: Data) async -> String? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Wysłanie obrazu wymaga połączenia z serwerem CRM."
            return nil
        }
        struct Reply: Decodable { let url: String }
        do {
            let body: [String: JSONValue] = ["op": .string("templateImage"), "data": .string(data.base64EncodedString())]
            let reply = try await workspace.withPending("Wysyłanie obrazu…") { try await api.post("/contracts", body) }
            return try JSONDecoder().decode(Reply.self, from: reply).url
        } catch {
            workspace.error = failureText(error, "Nie udało się wysłać obrazu.")
            return nil
        }
    }

    /// Szablon stopki (nowy albo zmiana zapisanego) — zwraca jego identyfikator i odświeżoną listę albo `nil`.
    func saveFooterTemplate(id: String?, name: String, footer: ContractPageLayout.Footer, logoScale: Double)
        async -> (id: String, list: [ContractTemplateDocumentPayload.FooterTemplate])? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Zapis wymaga połączenia z serwerem CRM."
            return nil
        }
        struct Reply: Decodable { let id: String; let footerTemplates: [ContractTemplateDocumentPayload.FooterTemplate] }
        do {
            var body: [String: JSONValue] = [
                "op": .string("footerTemplateSave"), "name": .string(name), "companyName": .string(footer.companyName),
                "tagline": .string(footer.tagline), "website": .string(footer.website), "email": .string(footer.email),
                "phone": .string(footer.phone), "logoUrl": .string(footer.logoUrl), "logoScale": .number(logoScale),
            ]
            if let id { body["id"] = .string(id) }
            let data = try await workspace.withPending("Zapisywanie stopki…") { try await api.post("/contracts", body) }
            let reply = try JSONDecoder().decode(Reply.self, from: data)
            workspace.succeed(id == nil ? "Szablon stopki zapisany" : "Szablon stopki zaktualizowany")
            return (reply.id, reply.footerTemplates)
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać szablonu stopki.")
            return nil
        }
    }

    func deleteFooterTemplate(_ id: String) async -> [ContractTemplateDocumentPayload.FooterTemplate]? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Usunięcie wymaga połączenia z serwerem CRM."
            return nil
        }
        struct Reply: Decodable { let footerTemplates: [ContractTemplateDocumentPayload.FooterTemplate] }
        do {
            let body: [String: JSONValue] = ["op": .string("footerTemplateDelete"), "id": .string(id)]
            let data = try await workspace.withPending("Usuwanie szablonu stopki…") { try await api.post("/contracts", body) }
            workspace.succeed("Szablon stopki usunięty")
            return try JSONDecoder().decode(Reply.self, from: data).footerTemplates
        } catch {
            workspace.error = failureText(error, "Nie udało się usunąć szablonu stopki.")
            return nil
        }
    }

    /// PDF umowy z magazynu (podpisany adres z serwera).
    func pdf(_ id: String) async throws -> (data: Data, name: String) {
        guard let api else { throw AppError.configuration }
        struct Link: Decodable { let url: String; let name: String }
        let link = try JSONDecoder().decode(Link.self, from: try await api.get("/contracts?op=pdf&id=\(id)"))
        guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
        return (data, link.name)
    }
}

/// Plik do folderu Pobrane (bez nadpisywania: „nazwa (1).pdf”) i zaznaczenie w Finderze.
enum ContractFiles {
    static func saveToDownloads(_ data: Data, name: String) throws -> URL {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var target = folder.appendingPathComponent(name)
        var copy = 1
        while FileManager.default.fileExists(atPath: target.path) {
            target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
            copy += 1
        }
        try data.write(to: target)
        NSWorkspace.shared.activateFileViewerSelecting([target])
        return target
    }

    /// Druk PDF (dopasowanie do strony) — `false`, gdy plik nie jest poprawnym PDF.
    static func print(_ data: Data) -> Bool {
        guard let document = PDFDocument(data: data),
              let operation = document.printOperation(for: NSPrintInfo.shared, scalingMode: .pageScaleToFit, autoRotate: true) else { return false }
        operation.run()
        return true
    }
}

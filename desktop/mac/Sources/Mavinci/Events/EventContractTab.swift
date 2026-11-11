import AppKit
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Umowa wydarzenia (`EventContractTab`) — obsługa dokumentu na Macu: status z datami (zasady jak w CRM), wersja,
// blokada po podpisaniu, potwierdzenie podpisu firmy, PDF bieżący i wersje archiwalne (podgląd, pobranie, druk), podpisane
// dokumenty (lista, otwieranie, dodawanie PDF/JPG/PNG). Treść umowy składa i dzieli na strony edytor w CRM z aktualnych danych
// oferty, szablonu i klauzul — edycja, klauzule, szablon, depozyt, audyt AI, wystawienie szkicu, PDF, wysyłka i anulowanie
// otwierają się w CRM.

struct ContractTabData: Decodable {
    struct Dates: Decodable, Hashable {
        var issued: String?
        var sent: String?
        var accepted: String?
        var signedByClient: String?
        var signedReturned: String?
        var cancelled: String?
    }
    struct Contract: Decodable, Hashable {
        var id: String
        var number: String?
        var title: String
        var status: String
        var version: Int
        var lockedAt: String?
        var companySignedAt: String?
        var companySignedBy: String?
        var pdf: String?
        var pdfAt: String?
        var modified: Bool
        var createdAt: String?
        var ownContract: Bool
        var dates: Dates
    }
    struct Archived: Decodable, Identifiable, Hashable {
        var id: String
        var title: String
        var number: String?
        var version: Int
        var status: String?
        var createdAt: String?
        var pdf: String?
        var pdfAt: String?
    }
    struct SignedFile: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var size: Double
        var mime: String
        var createdAt: String?
    }
    struct Signed: Decodable, Hashable {
        var canView: Bool
        var canUpload: Bool
        var files: [SignedFile]
        var error: String?
    }
    var isAdmin: Bool
    var canManage: Bool
    var canChangeStatus: Bool
    var templateName: String?
    var contract: Contract?
    var history: [Archived]
    var signed: Signed
}

enum ContractText {
    static let statuses: [String] = ["draft", "issued", "sent", "accepted", "signed_by_client", "signed_returned", "cancelled"]

    /// `getStatusLabel`.
    static func status(_ value: String) -> String {
        switch value {
        case "draft": return "🟡 Szkic"
        case "issued": return "🟢 Wystawiona"
        case "sent": return "📤 Wysłana"
        case "accepted": return "Zaakceptowana"
        case "signed_by_client": return "✍️ Podpisana przez klienta"
        case "signed_returned": return "✅ Podpisana odesłana"
        case "cancelled": return "❌ Anulowana"
        default: return value
        }
    }

    /// `getStatusDate`: data zmiany na bieżący status („11 listopada 2026 o 14:05”).
    static func statusDate(_ contract: ContractTabData.Contract) -> String? {
        let raw: String?
        switch contract.status {
        case "issued": raw = contract.dates.issued
        case "sent": raw = contract.dates.sent
        case "accepted": raw = contract.dates.accepted
        case "signed_by_client": raw = contract.dates.signedByClient
        case "signed_returned": raw = contract.dates.signedReturned
        case "cancelled": raw = contract.dates.cancelled
        default: raw = nil
        }
        guard let raw, let date = MeetingDates.parse(raw) else { return nil }
        return MeetingDates.format(date, "d MMMM yyyy, HH:mm")
    }

    static func date(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "—" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }

    static func size(_ bytes: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}

private struct ContractLink: Decodable { var url: String; var name: String }
private struct ContractUploadSlot: Decodable { var id: String; var path: String; var url: String }

@MainActor struct EventContractTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var preview: NativePreview?
    @State private var pendingStatus: String?
    @State private var confirmingSignature = false
    @State private var importing = false
    @State private var uploading: String?

    private var data: ContractTabData? { store.tab(eventID, "contract", as: ContractTabData.self) }
    private var crmPath: String { "/crm/events/\(eventID)?tab=contract" }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|contract"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać umowy", systemImage: "signature")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "contract") } } }
            } else {
                ProgressView("Ładowanie danych umowy...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "contract") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "contract") } }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
        .confirmationDialog("Zmienić status umowy?", isPresented: Binding(get: { pendingStatus != nil }, set: { if !$0 { pendingStatus = nil } }), titleVisibility: .visible) {
            if let next = pendingStatus, let contract = data?.contract {
                Button("Zmień na „\(ContractText.status(next))”") { Task { await changeStatus(contract, next) } }
            }
            Button("Anuluj", role: .cancel) { pendingStatus = nil }
        } message: { Text(statusMessage) }
        .confirmationDialog("Potwierdzić podpis firmy?", isPresented: $confirmingSignature, titleVisibility: .visible) {
            if let contract = data?.contract { Button("Potwierdź podpis firmy") { Task { await confirmSignature(contract) } } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Umowa zostanie oznaczona jako podpisana przez firmę. Po podpisie klienta będzie można załączyć podpisany dokument.") }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png], allowsMultipleSelection: false) { result in
            guard case .success(let urls) = result, let url = urls.first, let contract = data?.contract else { return }
            Task { await upload(url, contract) }
        }
    }

    private var statusMessage: String {
        guard let next = pendingStatus else { return "" }
        if next == "draft" { return "Umowa wróci do szkicu. Dotychczasowy PDF zostanie oznaczony jako nieaktualny — przed wysyłką wygeneruj go ponownie w CRM." }
        return "Status zmieni się na „\(ContractText.status(next))” z bieżącą datą. Zmiana statusu nie wysyła wiadomości do klienta."
    }

    private func content(_ data: ContractTabData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Label("Umowa", systemImage: "signature").font(.title2.weight(.light))
                        if let name = data.templateName {
                            Text("Szablon: " + name).font(.callout).foregroundStyle(.secondary)
                        } else {
                            Text("Wybierz szablon umowy w CRM").font(.callout).foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Button { state.openCRM(crmPath) } label: { Label("Otwórz edytor umowy w CRM", systemImage: "safari") }
                        .buttonStyle(.borderedProminent)
                        .help("Dane klienta i osoby podpisujące, treść, klauzule, szablon, depozyt, audyt AI, generowanie PDF, wysyłka i anulowanie.")
                }
                if let contract = data.contract {
                    statusCard(contract, data)
                    documentCard(contract)
                    signedCard(contract, data.signed)
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "doc.text").font(.system(size: 40)).foregroundStyle(.tertiary)
                        Text("Umowa nie została jeszcze utworzona").font(.headline)
                        Text("Szkic powstaje w edytorze umowy w CRM z szablonu, oferty i danych wydarzenia.").font(.callout).foregroundStyle(.secondary)
                        Button("Przygotuj umowę w CRM") { state.openCRM(crmPath) }
                    }
                    .frame(maxWidth: .infinity).padding(36)
                    .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                }
                if !data.history.isEmpty { historyCard(data.history) }
                crmCard
            }
            .padding(18)
        }
    }

    // MARK: Status

    private func statusOptions(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> [String] {
        ContractText.statuses.filter { status in
            if status == contract.status { return true }
            if status == "cancelled" { return false }
            if contract.lockedAt != nil && ["draft", "issued", "sent", "accepted"].contains(status) { return false }
            if !data.isAdmin && status == "draft" { return false }
            return true
        }
    }

    private func statusCard(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let editable = data.canChangeStatus && contract.status != "cancelled" && contract.status != "draft"
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Text("Status umowy").font(.callout).foregroundStyle(.secondary)
                if editable {
                    Picker("", selection: Binding(get: { contract.status }, set: { value in if value != contract.status { pendingStatus = value } })) {
                        ForEach(statusOptions(contract, data), id: \.self) { status in Text(ContractText.status(status)).tag(status) }
                    }
                    .labelsHidden().fixedSize()
                } else {
                    Text(ContractText.status(contract.status)).font(.callout.weight(.medium))
                }
                Spacer()
                if data.isAdmin && contract.status != "cancelled" {
                    if contract.companySignedAt == nil && contract.status != "draft" {
                        Button("Potwierdź podpis firmy") { confirmingSignature = true }
                    }
                    Button("Anuluj umowę", role: .destructive) { state.openCRM(crmPath) }
                        .help("Anulowanie wymaga potwierdzenia hasłem administratora — otworzy się w CRM.")
                }
            }
            HStack(spacing: 8) {
                badge("Wersja \(contract.version)", theme.accent)
                if contract.lockedAt != nil { badge("Dokument zablokowany po podpisaniu", .green) }
                if contract.companySignedAt != nil {
                    let who: String = contract.companySignedBy.map { " · " + $0 } ?? ""
                    badge("Podpis firmy potwierdzony" + who, theme.accent)
                }
                if let date = ContractText.statusDate(contract) {
                    Text(date).font(.caption).foregroundStyle(.secondary).help("Data zmiany statusu")
                }
            }
            if contract.status == "draft" && data.canChangeStatus {
                Text("Szkic wystawisz w edytorze umowy w CRM — przed wystawieniem treść jest składana z aktualnych danych oferty i szablonu, a CRM sprawdza uwagi do umowy.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 3).background(color.opacity(0.12), in: Capsule())
    }

    // MARK: Dokument PDF

    private func documentCard(_ contract: ContractTabData.Contract) -> some View {
        let draft = contract.status == "draft"
        let cancelled = contract.status == "cancelled"
        let title: String = cancelled ? "Archiwalny PDF umowy" : draft ? "PDF draftu" : "PDF umowy"
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(title, systemImage: "doc.richtext").font(.headline)
                Spacer()
                if contract.pdf != nil {
                    Button { Task { await openPdf(contract.id, action: .preview) } } label: {
                        Label(cancelled ? "Pokaż archiwalny PDF" : draft ? "Pokaż PDF draftu" : "Pokaż / drukuj umowę", systemImage: "eye")
                    }
                    Button { Task { await openPdf(contract.id, action: .download) } } label: {
                        Label(cancelled ? "Pobierz archiwalny PDF" : "Pobierz PDF", systemImage: "arrow.down.circle")
                    }
                    Button { Task { await openPdf(contract.id, action: .print) } } label: { Label("Drukuj", systemImage: "printer") }
                }
            }
            if contract.pdf == nil {
                Text(draft ? "PDF draftu nie został jeszcze wygenerowany. Wygenerujesz go w edytorze umowy w CRM." : "PDF umowy nie został jeszcze wygenerowany. Wygenerujesz go w edytorze umowy w CRM.")
                    .font(.callout).foregroundStyle(.secondary)
            } else {
                Text("Wygenerowano: " + ContractText.date(contract.pdfAt)).font(.caption).foregroundStyle(.secondary)
                if contract.modified && !cancelled {
                    Label("Treść umowy zmieniła się od wygenerowania PDF. Przed wysyłką wygeneruj PDF ponownie w edytorze umowy w CRM.", systemImage: "exclamationmark.triangle")
                        .font(.callout).foregroundStyle(.orange)
                }
            }
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Podpisane dokumenty (`SignedContractAttachments`)

    @ViewBuilder private func signedCard(_ contract: ContractTabData.Contract, _ signed: ContractTabData.Signed) -> some View {
        if signed.canView {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(contract.status == "cancelled" ? "Archiwum podpisanych dokumentów" : "Podpisane dokumenty", systemImage: "checkmark.seal")
                        .font(.headline)
                    Spacer()
                    if signed.canUpload {
                        Button { importing = true } label: { Label(uploading ?? "Dodaj podpisany dokument", systemImage: "plus") }
                            .disabled(uploading != nil)
                    }
                }
                if let error = signed.error { Text(error).font(.callout).foregroundStyle(.orange) }
                if signed.files.isEmpty {
                    Text("Brak podpisanych dokumentów.").font(.callout).foregroundStyle(.secondary)
                } else {
                    ForEach(signed.files) { file in
                        HStack(spacing: 10) {
                            Image(systemName: file.mime == "application/pdf" ? "doc.richtext" : "photo").foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(file.name).lineLimit(1)
                                Text(ContractText.size(file.size) + " · " + ContractText.date(file.createdAt)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button { Task { await openSigned(contract.id, file, download: false) } } label: { Image(systemName: "eye") }
                                .buttonStyle(.borderless).help("Otwórz podpisaną umowę")
                            Button { Task { await openSigned(contract.id, file, download: true) } } label: { Image(systemName: "arrow.down.circle") }
                                .buttonStyle(.borderless).help("Pobierz podpisaną umowę")
                        }
                        .padding(.vertical, 4)
                    }
                }
                if ["signed_by_client", "signed_returned"].contains(contract.status) && contract.companySignedAt == nil {
                    Text("Aby załączyć podpisany dokument, administrator musi jeszcze potwierdzić podpis firmy przy statusie umowy.")
                        .font(.caption).foregroundStyle(.secondary)
                } else if !["signed_by_client", "signed_returned", "cancelled"].contains(contract.status) {
                    Text("Podpisany dokument dodasz po zmianie statusu na „Podpisana przez klienta” lub „Podpisana odesłana” i potwierdzeniu podpisu firmy. PDF, JPG lub PNG do 20 MB.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(14)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: Wcześniejsze wersje

    private func historyCard(_ history: [ContractTabData.Archived]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Wcześniejsze wersje umowy", systemImage: "clock.arrow.circlepath").font(.headline)
            ForEach(history) { item in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.number ?? item.title).lineLimit(1)
                        Text("Wersja \(item.version) · " + ContractText.status(item.status ?? "draft") + " · " + ContractText.date(item.createdAt))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if item.pdf != nil {
                        Button { Task { await openPdf(item.id, action: .preview) } } label: { Image(systemName: "eye") }
                            .buttonStyle(.borderless).help("Pokaż archiwalny PDF")
                        Button { Task { await openPdf(item.id, action: .download) } } label: { Image(systemName: "arrow.down.circle") }
                            .buttonStyle(.borderless).help("Pobierz archiwalny PDF")
                    } else {
                        Text("bez PDF").font(.caption).foregroundStyle(.tertiary)
                    }
                }
                .padding(.vertical, 3)
            }
        }
        .padding(14)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private var crmCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("W edytorze umowy w CRM").font(.callout.weight(.medium))
            Text("Dane klienta i osoby podpisujące · treść umowy · klauzule · zmiana szablonu · depozyt · audyt AI · wystawienie szkicu · generowanie PDF · wysyłka e-mailem · anulowanie z hasłem administratora. Treść umowy jest składana i dzielona na strony przez edytor CRM z aktualnych danych oferty, szablonu i klauzul.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Czynności

    private enum PdfAction { case preview, download, print }

    private func fetch(_ query: String, _ params: [String: String]) async throws -> (Data, String) {
        let link = try await store.tabQuery(eventID, "contract", query, params, as: ContractLink.self)
        guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
        return (data, link.name)
    }

    private func deliver(_ file: (Data, String), action: PdfAction) {
        switch action {
        case .preview:
            preview = NativePreview(name: file.1, data: file.0)
        case .download:
            do {
                let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
                let name = file.1
                let base = (name as NSString).deletingPathExtension
                let ext = (name as NSString).pathExtension
                var target = folder.appendingPathComponent(name)
                var copy = 1
                while FileManager.default.fileExists(atPath: target.path) {
                    target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
                    copy += 1
                }
                try file.0.write(to: target)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = store.failureText(error, "Błąd podczas pobierania PDF")
            }
        case .print:
            guard let document = PDFDocument(data: file.0),
                  let operation = document.printOperation(for: NSPrintInfo.shared, scalingMode: .pageScaleToFit, autoRotate: true) else {
                state.error = "Nie udało się przygotować wydruku."
                return
            }
            operation.run()
        }
    }

    private func openPdf(_ contractID: String, action: PdfAction) async {
        let pending: String = action == .download ? "Pobieranie PDF…" : "Otwieranie PDF…"
        let fetched: (Data, String)? = await state.withPending(pending) { () async -> (Data, String)? in
            do {
                return try await fetch("pdf", ["contractId": contractID])
            } catch {
                state.error = store.failureText(error, "Błąd podczas otwierania PDF")
                return nil
            }
        }
        guard let file = fetched else { return }
        deliver(file, action: action)
    }

    private func openSigned(_ contractID: String, _ file: ContractTabData.SignedFile, download: Bool) async {
        let fetched: (Data, String)? = await state.withPending(download ? "Pobieranie…" : "Otwieranie…") { () async -> (Data, String)? in
            do {
                return try await fetch("signedFile", ["contractId": contractID, "fileId": file.id])
            } catch {
                state.error = store.failureText(error, "Nie udało się otworzyć pliku.")
                return nil
            }
        }
        guard let loaded = fetched else { return }
        deliver(loaded, action: download ? .download : .preview)
    }

    private func changeStatus(_ contract: ContractTabData.Contract, _ next: String) async {
        pendingStatus = nil
        do {
            try await store.tabAction(eventID, "contract", "status",
                                      ["contractId": .string(contract.id), "status": .string(next), "expectedStatus": .string(contract.status)],
                                      reload: ["contract"], success: "Status umowy został zaktualizowany", pending: "Zmiana statusu…")
        } catch {
            state.error = store.failureText(error, "Błąd podczas aktualizacji statusu")
            await store.loadTab(eventID, "contract")
        }
    }

    private func confirmSignature(_ contract: ContractTabData.Contract) async {
        do {
            try await store.tabAction(eventID, "contract", "companySignature", ["contractId": .string(contract.id)], reload: ["contract"],
                                      success: "Podpis firmy został potwierdzony", pending: "Zapisywanie…")
        } catch {
            state.error = store.failureText(error, "Nie udało się potwierdzić podpisu firmy")
        }
    }

    /// Dodanie podpisanego dokumentu: adres wysyłki → plik z Maca prosto do magazynu → sprawdzenie i wpis na serwerze.
    private func upload(_ url: URL, _ contract: ContractTabData.Contract) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0, size <= 20 * 1024 * 1024 else {
            state.error = "Wybierz niepusty plik PDF, JPG lub PNG o rozmiarze do 20 MB."
            return
        }
        uploading = "Wysyłanie…"
        defer { uploading = nil }
        do {
            let reply = try await store.tabAction(eventID, "contract", "prepareSigned",
                                                  ["contractId": .string(contract.id), "name": .string(url.lastPathComponent), "size": .number(Double(size))],
                                                  reload: [], success: nil, pending: "Przygotowanie wysyłania…")
            let slot = try JSONDecoder().decode(ContractUploadSlot.self, from: reply)
            guard let target = URL(string: slot.url) else { throw AppError.invalidResponse }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            var request = URLRequest(url: target)
            request.httpMethod = "PUT"
            request.setValue(mime, forHTTPHeaderField: "Content-Type")
            request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
            request.setValue("false", forHTTPHeaderField: "x-upsert")
            let (_, response) = try await state.withPending("Wysyłanie pliku…") { try await URLSession.shared.upload(for: request, fromFile: url) }
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
            try await store.tabAction(eventID, "contract", "registerSigned",
                                      ["contractId": .string(contract.id), "id": .string(slot.id), "path": .string(slot.path), "name": .string(url.lastPathComponent)],
                                      reload: ["contract"], success: "Dodano podpisany dokument", pending: "Sprawdzanie pliku…")
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać pliku.")
            await store.loadTab(eventID, "contract")
        }
    }
}

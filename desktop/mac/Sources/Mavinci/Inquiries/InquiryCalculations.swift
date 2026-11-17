import SwiftUI
import AppKit

// MARK: Kalkulacje zapytania — natywny odpowiednik `InquiryCalculationsPanel` i `CalculationEditor` z `inquiryContext`
// w `/crm/inquiries/[id]`: lista (wybór kalkulacji, otwarcie, kopia, PDF), edytor jak w wydarzeniu (`CalculationEditorView`)
// z kontekstem zapytania po lewej (`InquirySourceContextPanel`). Serwer: `/bridge/native/v1/inquiries` — GET op=calcQuery,
// POST op=calcAction / calcEmail (`src/lib/native/eventCalculations.ts`), PDF: `/bridge/events/calculation-pdf` z `inquiryId`.

extension InquiriesStore {
    /// Odczyt modułu kalkulacji zapytania (`editor`, `catalog`, `pdf`, `pdfPayload`, `travel`, `importSources`, `emailSetup`,
    /// `consumption`, `fuel`).
    func calcQueryData(_ inquiryID: String, _ query: String, _ params: [String: String] = [:]) async throws -> Data {
        guard let api else { throw AppError.configuration }
        var all = params
        all["op"] = "calcQuery"
        all["id"] = inquiryID
        all["query"] = query
        return try await api.get("/inquiries", query: all)
    }

    /// Czynność kalkulacji zapytania z oknem postępu (jak `tabAction` kalkulacji wydarzenia — bez czekania na synchronizację).
    /// `id` w treści (kalkulacja) idzie jako `targetId` — `id` to zapytanie.
    @discardableResult
    func calcAction(_ inquiryID: String, _ action: String, _ body: [String: JSONValue], success: String?, pending: String?,
                    refresh: Bool = true) async throws -> Data {
        guard let api, let workspace else { throw AppError.configuration }
        var payload = body
        payload["targetId"] = body["id"] ?? .null
        payload["op"] = .string("calcAction")
        payload["id"] = .string(inquiryID)
        payload["action"] = .string(action)
        let request = payload
        let data: Data
        if let pending {
            data = try await workspace.withPending(pending) { try await api.post("/inquiries", request) }
        } else {
            data = try await api.post("/inquiries", request)
        }
        if let success { workspace.succeed(success) }
        if refresh { Task { await sync(force: true) } }
        return data
    }

    /// Podgląd wiadomości z kalkulacją ze stopką i szablonem skrzynki (bez zapisu).
    func calculationEmailPreview(_ inquiryID: String, _ draft: CalculationEmailDraft) async throws -> String {
        struct Reply: Decodable { let html: String }
        let body: [String: JSONValue] = [
            "calculationId": .string(draft.calculationID), "accountId": .string(draft.accountId),
            "subject": .string(draft.subject), "text": .string(draft.text),
        ]
        let data = try await calcAction(inquiryID, "emailPreview", body, success: nil, pending: nil, refresh: false)
        return try JSONDecoder().decode(Reply.self, from: data).html
    }

    /// Wysyłka albo zaplanowanie kalkulacji zapytania; komunikat jak w CRM.
    func sendCalculationEmail(_ inquiryID: String, _ draft: CalculationEmailDraft) async throws -> String {
        guard let api, let workspace, workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Wysyłka wymaga połączenia z serwerem CRM.", fieldErrors: [:])
        }
        struct Reply: Decodable { var scheduled: Bool; var scheduledAt: String? }
        let body: [String: JSONValue] = [
            "op": .string("calcEmail"), "id": .string(inquiryID), "calculationId": .string(draft.calculationID),
            "accountId": .string(draft.accountId), "to": .string(draft.to), "cc": .string(draft.cc), "bcc": .string(draft.bcc),
            "subject": .string(draft.subject), "text": .string(draft.text), "fileIds": .array(draft.fileIDs.map { JSONValue.string($0) }),
            "scheduledAt": draft.scheduledAt.map { JSONValue.string(MeetingDates.iso($0)) } ?? .null,
        ]
        let data = try await workspace.withPending(draft.scheduledAt == nil ? "Wysyłanie kalkulacji…" : "Planowanie wysyłki…") {
            try await api.post("/inquiries", body, timeout: 120)
        }
        let reply = try JSONDecoder().decode(Reply.self, from: data)
        Task { await sync(force: true) }
        return reply.scheduled ? "Kalkulacja zostanie wysłana \(OfferText.dayTime(reply.scheduledAt))" : "Kalkulacja wysłana przez email"
    }
}

extension CalculationBackend {
    /// Kalkulacje karty zapytania; `eventID` — wydarzenie zapytania, gdy już powstało (pliki wydarzenia w wysyłce e-mailem).
    @MainActor static func inquiry(_ store: InquiriesStore, _ inquiryID: String, eventID: String?) -> CalculationBackend {
        var owner = ["inquiryId": inquiryID]
        if let eventID { owner["eventId"] = eventID }
        return CalculationBackend(
            read: { query, params in try await store.calcQueryData(inquiryID, query, params) },
            act: { action, body, _, success, pending in
                try await store.calcAction(inquiryID, action, body, success: success, pending: pending)
            },
            logistics: { query, params in try await store.calcQueryData(inquiryID, query, params) },
            previewEmail: { draft in try await store.calculationEmailPreview(inquiryID, draft) },
            sendEmail: { draft in try await store.sendCalculationEmail(inquiryID, draft) },
            failure: { error, fallback in store.failureText(error, fallback) },
            owner: owner,
            isInquiry: true
        )
    }
}

// MARK: Lista kalkulacji zapytania (`InquiryCalculationsPanel`)

@MainActor struct InquiryCalculationsList: View {
    let backend: CalculationBackend
    let calculations: [InquiryWorkspaceData.Calculation]
    let canManage: Bool
    let onCreate: () -> Void
    let onOpen: (String) -> Void
    let onChanged: () -> Void
    @EnvironmentObject private var state: Workspace
    @State private var busy: String?
    @State private var preview: NativePreview?

    /// `accepted_calculation_id` zapytania.
    private var selectedID: String? { calculations.first { $0.selected ?? false }?.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Kalkulacje").font(.title3.weight(.semibold))
                Spacer()
                if canManage {
                    Button(action: onCreate) { Label("Utwórz kalkulację", systemImage: "plus") }
                        .buttonStyle(.borderedProminent).disabled(busy != nil)
                }
            }
            if calculations.isEmpty {
                Text("Nie przygotowano jeszcze kalkulacji.").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 18)
            }
            ForEach(calculations) { calculation in
                row(calculation)
            }
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    private func row(_ calculation: InquiryWorkspaceData.Calculation) -> some View {
        let hasPdf = calculation.pdf ?? false
        let summary = "\(calculation.itemsCount ?? 0) pozycji · \(CalculationMath.money(calculation.total)) zł netto · \(hasPdf ? "PDF gotowy" : "Robocza")"
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(calculation.name).font(.callout.weight(.medium)).lineLimit(2)
                    if selectedID == calculation.id {
                        Text("Wybrana kalkulacja").font(.caption).foregroundStyle(.green)
                    }
                }
                Text(summary).font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { if busy == nil { onOpen(calculation.id) } }
            if busy == calculation.id { ProgressView().controlSize(.small) }
            Button { onOpen(calculation.id) } label: { Label("Otwórz", systemImage: "pencil") }
                .disabled(busy != nil)
            Menu { actions(calculation) } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().disabled(busy != nil).help("Czynności")
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
        .contextMenu { actions(calculation) }
    }

    @ViewBuilder private func actions(_ calculation: InquiryWorkspaceData.Calculation) -> some View {
        let hasPdf = calculation.pdf ?? false
        if canManage {
            Button { Task { await select(calculation) } } label: { Label("Wybierz kalkulację", systemImage: "checkmark.seal") }
                .disabled(busy != nil || selectedID == calculation.id)
        }
        Button { onOpen(calculation.id) } label: { Label("Otwórz", systemImage: "pencil") }.disabled(busy != nil)
        if canManage {
            Button { Task { await duplicate(calculation) } } label: { Label("Duplikuj", systemImage: "plus.square.on.square") }
                .disabled(busy != nil)
            Button { Task { await generate(calculation) } } label: { Label("Generuj PDF", systemImage: "doc.text") }
                .disabled(busy != nil)
        }
        Divider()
        Button { Task { await showPdf(calculation, download: false) } } label: { Label("Pokaż PDF", systemImage: "eye") }
            .disabled(busy != nil || !hasPdf)
        Button { Task { await showPdf(calculation, download: true) } } label: { Label("Pobierz PDF", systemImage: "arrow.down.circle") }
            .disabled(busy != nil || !hasPdf)
    }

    // MARK: Czynności (`perform` w CRM)

    private func select(_ calculation: InquiryWorkspaceData.Calculation) async {
        guard busy == nil else { return }
        busy = calculation.id
        defer { busy = nil }
        do {
            try await backend.action("select", ["id": .string(calculation.id), "expected": selectedID.map { JSONValue.string($0) } ?? .null],
                                     reload: [], success: "Wybrano kalkulację. Wyceny zapisanych ofert pozostają zachowane.",
                                     pending: "Zapisywanie wyboru…")
            onChanged()
        } catch {
            state.error = backend.failureText(error, "Nie udało się wykonać operacji.")
        }
    }

    private func duplicate(_ calculation: InquiryWorkspaceData.Calculation) async {
        guard busy == nil else { return }
        busy = calculation.id
        defer { busy = nil }
        do {
            try await backend.action("duplicate", ["id": .string(calculation.id)], reload: [],
                                     success: "Kalkulacja została zduplikowana.", pending: "Duplikuję…")
            onChanged()
        } catch {
            state.error = backend.failureText(error, "Nie udało się wykonać operacji.")
        }
    }

    /// „Generuj PDF” z zapisanej treści — Chrome na Macu (albo serwer); plik przy zapytaniu albo w Plikach wydarzenia zapytania.
    private func generate(_ calculation: InquiryWorkspaceData.Calculation) async {
        guard busy == nil else { return }
        busy = calculation.id
        defer { busy = nil }
        let done: Bool = await state.withPending(ChromePdfEngine.available ? "Generuję PDF kalkulacji…" : "Generuję PDF kalkulacji na serwerze…") { () async -> Bool in
            do {
                let payload = try await backend.queryData("pdfPayload", ["calculationId": calculation.id])
                _ = try await state.generateStoredDocument(path: "/bridge/events/calculation-pdf", body: payload)
                return true
            } catch {
                state.error = backend.failureText(error, "Nie udało się wykonać operacji.")
                return false
            }
        }
        guard done else { return }
        state.succeed("PDF kalkulacji został wygenerowany.")
        onChanged()
    }

    /// „Pokaż PDF” / „Pobierz PDF” — ostatni zapisany dokument kalkulacji.
    private func showPdf(_ calculation: InquiryWorkspaceData.Calculation, download: Bool) async {
        guard busy == nil else { return }
        guard calculation.pdf ?? false else {
            state.snack = Snack(kind: .info, text: "Najpierw wygeneruj PDF.")
            return
        }
        busy = calculation.id
        defer { busy = nil }
        let fetched: (Data, String)? = await state.withPending(download ? "Pobieram PDF…" : "Otwieram PDF…") { () async -> (Data, String)? in
            do {
                return try await CalculationPdf.fetch(backend, calculation.id, current: false)
            } catch {
                state.error = backend.failureText(error, download ? "Nie udało się pobrać PDF." : "Nie udało się otworzyć PDF.")
                return nil
            }
        }
        guard let file = fetched else { return }
        if download {
            do {
                let target = try CalculationPdf.saveToDownloads(file.0, file.1)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = backend.failureText(error, "Nie udało się pobrać PDF.")
            }
        } else {
            preview = NativePreview(name: file.1, data: file.0)
        }
    }
}

// MARK: Kontekst zapytania obok edytora (`InquirySourceContextPanel`)

struct InquiryCalculationContextPanel: View {
    private struct Item: Identifiable {
        let label: String
        let value: String
        let symbol: String
        var id: String { label }
    }

    let data: InquiryWorkspaceData
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var expanded = true

    private var message: String {
        let clean = data.message.clean.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty ? data.message.full.trimmingCharacters(in: .whitespacesAndNewlines) : clean
    }

    private var items: [Item] {
        let all: [Item] = [
            Item(label: "Termin", value: data.summary.schedule, symbol: "calendar.badge.clock"),
            Item(label: "Miejsce", value: data.summary.location, symbol: "mappin.and.ellipse"),
            Item(label: "Zakres", value: data.summary.scope, symbol: "target"),
        ]
        return all.filter { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button { expanded.toggle() } label: {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 3) {
                        Label("Kontekst zapytania", systemImage: "text.bubble").font(.callout.weight(.medium)).foregroundStyle(.primary)
                        Text(data.inquiry.titleLabel).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: expanded ? "chevron.up" : "chevron.down").foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded { details }
        }
        .padding(14)
        .background(theme.accent.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.15)))
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            if !data.inquiry.sourceLabel.isEmpty {
                Text("Źródło: \(data.inquiry.sourceLabel)").font(.caption2).textCase(.uppercase).foregroundStyle(theme.accent)
            }
            client
            if !items.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(items) { item in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Image(systemName: item.symbol).foregroundStyle(theme.accent)
                            Text(item.label + ":").foregroundStyle(.secondary)
                            Text(item.value).fixedSize(horizontal: false, vertical: true)
                        }
                        .font(.caption)
                    }
                }
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Treść wiadomości").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                Text(message.isEmpty ? "Brak zapisanej treści źródłowej." : message)
                    .font(.caption).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
            }
            if let source = data.message.sourceHref {
                Button(source.hasPrefix("/crm/tenders") ? "Otwórz przetarg" : "Otwórz wiadomość źródłową") { state.openCRM(source) }
                    .buttonStyle(.link).font(.caption)
            }
        }
    }

    @ViewBuilder private var client: some View {
        let info = data.client
        VStack(alignment: .leading, spacing: 5) {
            if !info.name.isEmpty { Label(info.name, systemImage: "person").font(.caption) }
            if !info.email.isEmpty {
                Button { launch("mailto", info.email) } label: { Label(info.email, systemImage: "envelope").font(.caption) }.buttonStyle(.link)
            }
            if !info.phone.isEmpty {
                Button { launch("tel", info.phone) } label: { Label(info.phone, systemImage: "phone").font(.caption) }.buttonStyle(.link)
            }
        }
    }

    private func launch(_ scheme: String, _ value: String) {
        var parts = URLComponents()
        parts.scheme = scheme
        parts.path = scheme == "tel" ? value.filter { $0.isNumber || $0 == "+" } : value
        if let url = parts.url { NSWorkspace.shared.open(url) }
    }
}

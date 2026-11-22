import SwiftUI

// MARK: Własność sprzętu i dokumenty zakupu — 1:1 z `EquipmentAssetsCard.tsx` (`/bridge/native/v1/assets`)
//
// Sprzęt → „Zakup”: partie sztuk — środek trwały firmy, wyposażenie firmy, leasing lub najem, prywatne (można sprzedać bez
// faktury, za gotówkę) — z dokumentem zakupu: fakturą kosztową z KSeF, dokumentem spoza KSeF albo umową stałą. Karta jest tylko
// dla osób z dostępem do finansów firmy (inni jej nie widzą); zmienia „Finanse — zarządzanie”. Typy jak `assetsShared.ts`.

enum AssetOwnership: String, Codable, CaseIterable, Identifiable {
    case asset, equipment, leased
    case privateOwned = "private"
    var id: String { rawValue }
    var label: String {
        switch self {
        case .asset: return "Środek trwały firmy"
        case .equipment: return "Wyposażenie firmy"
        case .leased: return "Leasing lub najem"
        case .privateOwned: return "Prywatny"
        }
    }
    var plural: String {
        switch self {
        case .asset: return "Środki trwałe"
        case .equipment: return "Wyposażenie"
        case .leased: return "Leasing i najem"
        case .privateOwned: return "Prywatne"
        }
    }
    var hint: String {
        switch self {
        case .asset: return "Majątek spółki w ewidencji środków trwałych (amortyzowany). Sprzedaż tylko na fakturę."
        case .equipment: return "Kupione na firmę i ujęte od razu w kosztach. Sprzedaż tylko na fakturę."
        case .leased: return "Firma używa na podstawie umowy — to nie jest jej własność, nie można tego sprzedać."
        case .privateOwned: return "Własność prywatna (bez faktury na firmę) — można sprzedać bez faktury, za gotówkę."
        }
    }
}

struct AssetDocument: Codable, Hashable {
    let type: String
    let id: String
    let label: String
    let detail: String
    let counterparty: String?
    let date: String?
    let amount: Double?
    let currency: String
    var key: String { "\(type):\(id)" }
    var typeLabel: String {
        switch type {
        case "ksef": return "Faktura z KSeF"
        case "external": return "Dokument spoza KSeF"
        default: return "Umowa stała"
        }
    }
    var caption: String { ([typeLabel, detail] + (date.map { [DayDates.display($0)] } ?? [])).filter { !$0.isEmpty }.joined(separator: " · ") }
}

struct EquipmentAcquisition: Codable, Identifiable, Hashable {
    let id: String
    let quantity: Int
    let ownership: String
    let companyId: String?
    let companyName: String
    let acquiredOn: String?
    let netAmount: Double?
    let grossAmount: Double?
    let currency: String
    let document: AssetDocument?
    let documentNote: String
    let notes: String
    let updatedAt: String?
    let canEdit: Bool
    var kind: AssetOwnership { AssetOwnership(rawValue: ownership) ?? .asset }
}

struct AssetCompany: Codable, Identifiable, Hashable {
    let id: String
    let name: String
    let canEdit: Bool
}

struct EquipmentAssets: Codable {
    let equipmentId: String
    let quantity: Int
    let acquisitions: [EquipmentAcquisition]
    let counts: [String: Int]
    let unassigned: Int
    let undocumented: Int
    let companies: [AssetCompany]
    let canEditPrivate: Bool
    var canAdd: Bool { canEditPrivate || companies.contains { $0.canEdit } }
}

struct AssetDocumentList: Codable { let documents: [AssetDocument] }

/// Formularz partii (nowej albo zmienianej).
struct AcquisitionDraft: Identifiable {
    let id = UUID()
    var acquisitionID: String?
    var quantity = "1"
    var ownership: AssetOwnership = .asset
    var companyId = ""
    var acquiredOn: Date?
    var net = ""
    var gross = ""
    var currency = "PLN"
    var document: AssetDocument?
    var documentNote = ""
    var notes = ""

    init(assets: EquipmentAssets) {
        let editable = assets.companies.filter(\.canEdit)
        quantity = String(max(1, assets.unassigned))
        ownership = editable.isEmpty ? .privateOwned : .asset
        companyId = editable.count == 1 ? editable[0].id : ""
    }

    init(entry: EquipmentAcquisition) {
        acquisitionID = entry.id
        quantity = String(entry.quantity)
        ownership = entry.kind
        companyId = entry.companyId ?? ""
        acquiredOn = entry.acquiredOn.flatMap { DayDates.parse($0) }
        net = entry.netAmount.map { WarehouseLabels.number($0) } ?? ""
        gross = entry.grossAmount.map { WarehouseLabels.number($0) } ?? ""
        currency = entry.currency
        document = entry.document
        documentNote = entry.documentNote
        notes = entry.notes
    }
}

private func assetMoney(_ value: Double?, _ currency: String) -> String {
    guard let value else { return "—" }
    return currency == "PLN" ? WarehouseLabels.money(value) : "\(WarehouseLabels.number(value)) \(currency)"
}

private func assetFailure(_ error: Error, _ fallback: String) -> String {
    (error as? NativeFailure)?.message ?? (friendlyError(error).isEmpty ? fallback : friendlyError(error))
}

@MainActor struct EquipmentAssetsCard: View {
    let equipmentID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var assets: EquipmentAssets?
    @State private var hidden = false
    @State private var problem: String?
    @State private var editing: AcquisitionDraft?
    @State private var removing: EquipmentAcquisition?

    var body: some View {
        Group {
            if !hidden {
                TeamCard(title: "Własność i dokumenty zakupu", symbol: "building.columns", action: addAction) {
                    content
                }
            }
        }
        .task(id: equipmentID) { await load() }
        .sheet(item: $editing) { draft in
            if let assets {
                AcquisitionSheet(draft: draft, assets: assets, equipmentID: equipmentID) { next in self.assets = next; editing = nil }
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .confirmationDialog("Usuń partię", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let entry = removing {
                Button("Usuń", role: .destructive) { Task { await remove(entry) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Usunąć partię „\(removing?.kind.label ?? "") — \(removing?.quantity ?? 0) szt.”? Sprzęt zostaje w Magazynie, znika tylko opis własności i dokumentu.")
        }
    }

    /// „Dodaj partię” — gdy można dodać partię firmy albo prywatną.
    private var addAction: (String, () -> Void)? {
        guard let assets, assets.canAdd else { return nil }
        return ("Dodaj partię", { editing = AcquisitionDraft(assets: assets) })
    }

    @ViewBuilder private var content: some View {
        Text("Czyje są sztuki tego sprzętu: majątek firmy (sprzedaż tylko na fakturę) czy prywatne (można sprzedać za gotówkę).")
            .font(.caption).foregroundStyle(.secondary)
        if let problem {
            Text(problem).foregroundStyle(.secondary)
        } else if let assets {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), alignment: .leading)], alignment: .leading, spacing: 10) {
                stat("W Magazynie", assets.quantity)
                ForEach(AssetOwnership.allCases) { kind in stat(kind.plural, assets.counts[kind.rawValue] ?? 0) }
                stat("Nieustalona własność", assets.unassigned, warn: assets.unassigned > 0)
                stat("Firmowe bez dokumentu", assets.undocumented, warn: assets.undocumented > 0)
            }
            if assets.acquisitions.isEmpty {
                Text(assets.canAdd ? "Nie opisano jeszcze własności tego sprzętu — dodaj partię: ile sztuk, czyje i na podstawie jakiego dokumentu."
                     : "Nie opisano jeszcze własności tego sprzętu.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(assets.acquisitions) { entry in
                        row(entry)
                        if entry.id != assets.acquisitions.last?.id { Divider().opacity(0.3) }
                    }
                }
            }
        } else {
            ProgressView().controlSize(.small)
        }
    }

    private func stat(_ title: String, _ value: Int, warn: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text("\(value) szt.").monospacedDigit().foregroundStyle(warn ? Color.orange : Color.primary)
        }
    }

    private func row(_ entry: EquipmentAcquisition) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.kind.label)
                Text([entry.companyName, entry.acquiredOn.map { DayDates.display($0) } ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(.secondary)
                if !entry.notes.isEmpty { Text(entry.notes).font(.caption).foregroundStyle(.secondary) }
            }
            .frame(width: 220, alignment: .leading)
            Text("\(entry.quantity) szt.").monospacedDigit().frame(width: 70, alignment: .trailing)
            Text(assetMoney(entry.grossAmount, entry.currency)).monospacedDigit().foregroundStyle(.secondary).frame(width: 120, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                if let document = entry.document {
                    Label(document.label, systemImage: "doc.text").foregroundStyle(theme.accent)
                    Text(document.caption).font(.caption).foregroundStyle(.secondary)
                } else if entry.kind == .privateOwned {
                    Text("nie dotyczy").foregroundStyle(.secondary)
                } else {
                    Text("brak dokumentu").foregroundStyle(.orange)
                    if !entry.documentNote.isEmpty { Text(entry.documentNote).font(.caption).foregroundStyle(.secondary) }
                }
            }
            Spacer(minLength: 0)
            if entry.canEdit {
                Button { editing = AcquisitionDraft(entry: entry) } label: { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Zmień partię")
                Button { removing = entry } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń partię")
            }
        }
        .padding(.vertical, 8)
    }

    private func load() async {
        guard let api = state.nativeAPI() else { problem = "Własność sprzętu wymaga połączenia z serwerem CRM."; return }
        do {
            let data = try await api.get("/assets?op=equipment&id=\(equipmentID)")
            assets = try JSONDecoder().decode(EquipmentAssets.self, from: data)
            problem = nil
        } catch let failure as NativeFailure where failure.status == 403 {
            hidden = true
        } catch {
            problem = assetFailure(error, "Nie udało się pobrać własności sprzętu.")
        }
    }

    private func remove(_ entry: EquipmentAcquisition) async {
        guard let api = state.nativeAPI() else { return }
        guard state.canWrite else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        do {
            let data = try await state.withPending("Usuwam partię…") { try await api.post("/assets", ["op": .string("delete"), "id": .string(entry.id)]) }
            assets = try JSONDecoder().decode(EquipmentAssets.self, from: data)
            state.succeed("Usunięto partię sprzętu")
        } catch {
            state.error = assetFailure(error, "Nie udało się usunąć partii.")
        }
    }
}

/// Formularz partii: ilość, własność, firma, data i kwoty, dokument zakupu (wyszukiwanie w dokumentach firmy), uwagi.
@MainActor struct AcquisitionSheet: View {
    @State var draft: AcquisitionDraft
    let assets: EquipmentAssets
    let equipmentID: String
    let saved: (EquipmentAssets) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var query = ""
    @State private var documents: [AssetDocument]?
    @State private var searching = false
    @State private var searchError: String?

    private var editable: [AssetCompany] { assets.companies.filter { $0.canEdit || $0.id == draft.companyId } }
    private var ownerships: [AssetOwnership] { AssetOwnership.allCases.filter { $0 == .privateOwned ? assets.canEditPrivate : !editable.isEmpty } }
    private var searchKey: String { "\(draft.companyId)|\(draft.ownership.rawValue)|\(query)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(draft.acquisitionID == nil ? "Nowa partia sprzętu" : "Partia sprzętu").font(.title2.weight(.light)).padding([.horizontal, .top], 20)
            Form {
                Section {
                    TextField("Ilość (szt.)", text: $draft.quantity)
                    Picker("Własność", selection: $draft.ownership) {
                        ForEach(ownerships) { Text($0.label).tag($0) }
                    }
                    Text(draft.ownership.hint).font(.caption).foregroundStyle(.secondary)
                    if draft.ownership != .privateOwned {
                        Picker("Firma", selection: $draft.companyId) {
                            Text("Wybierz firmę…").tag("")
                            ForEach(editable) { Text($0.name).tag($0.id) }
                        }
                    }
                }
                Section("Zakup") {
                    OptionalDateField(title: "Data zakupu", date: $draft.acquiredOn)
                    TextField("Netto (cała partia)", text: $draft.net)
                    TextField("Brutto (cała partia)", text: $draft.gross)
                    TextField("Waluta", text: $draft.currency)
                }
                if draft.ownership != .privateOwned {
                    Section("Dokument zakupu") { documentSection }
                }
                Section("Uwagi") {
                    TextField("np. numery seryjne, od kogo kupione", text: $draft.notes, axis: .vertical).lineLimit(2...4)
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(draft.acquisitionID == nil ? "Dodaj partię" : "Zapisz") { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
            }
            .padding(20)
        }
        .frame(width: 560, height: 680)
        .task(id: searchKey) { await search() }
        .onChange(of: draft.ownership) { _, ownership in
            if ownership == .privateOwned || (draft.document?.type == "contract" && ownership != .leased) { draft.document = nil }
        }
        .onChange(of: draft.companyId) { _, _ in draft.document = nil }
    }

    @ViewBuilder private var documentSection: some View {
        if let document = draft.document {
            HStack(alignment: .top) {
                Image(systemName: "doc.text").foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(document.label)
                    Text(document.caption).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { draft.document = nil } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.borderless).help("Usuń dokument")
            }
        } else if draft.companyId.isEmpty {
            Text("Najpierw wybierz firmę — pokażą się jej faktury kosztowe z KSeF, dokumenty spoza KSeF\(draft.ownership == .leased ? " i umowy stałe" : "").")
                .font(.caption).foregroundStyle(.secondary)
        } else {
            TextField("Numer dokumentu, sprzedawca albo tytuł umowy", text: $query)
            if searching { ProgressView().controlSize(.small) }
            if let searchError { Text(searchError).font(.caption).foregroundStyle(.red) }
            if let documents {
                if documents.isEmpty && !searching { Text("Nic nie znaleziono.").font(.caption).foregroundStyle(.secondary) }
                ForEach(documents, id: \.key) { document in
                    Button { choose(document) } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(document.label)
                            Text(document.caption).font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            TextField("Gdy dokumentu nie ma w CRM — gdzie jest (opcjonalnie)", text: $draft.documentNote)
        }
    }

    private func choose(_ document: AssetDocument) {
        draft.document = document
        if draft.acquiredOn == nil, let date = document.date { draft.acquiredOn = DayDates.parse(date) }
        if document.type != "contract", !document.currency.isEmpty { draft.currency = document.currency }
    }

    private func search() async {
        guard draft.ownership != .privateOwned, !draft.companyId.isEmpty, draft.document == nil, let api = state.nativeAPI() else { documents = nil; return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        if Task.isCancelled { return }
        searching = true
        defer { searching = false }
        var parts = URLComponents()
        parts.queryItems = [
            URLQueryItem(name: "op", value: "documents"), URLQueryItem(name: "company", value: draft.companyId),
            URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespaces)), URLQueryItem(name: "contracts", value: draft.ownership == .leased ? "1" : ""),
        ]
        do {
            let data = try await api.get("/assets?\(parts.percentEncodedQuery ?? "")")
            if Task.isCancelled { return }
            documents = try JSONDecoder().decode(AssetDocumentList.self, from: data).documents
            searchError = nil
        } catch {
            if !Task.isCancelled { searchError = assetFailure(error, "Nie udało się pobrać dokumentów.") }
        }
    }

    private static func amount(_ text: String) -> JSONValue {
        let clean = text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: ".")
        guard !clean.isEmpty, let value = Double(clean) else { return .null }
        return .number(value)
    }

    private func save() async {
        guard let quantity = Int(draft.quantity.trimmingCharacters(in: .whitespaces)), (1...100_000).contains(quantity) else {
            state.error = "Ilość musi być liczbą od 1 do 100000."; return
        }
        if draft.ownership != .privateOwned && draft.companyId.isEmpty { state.error = "Wybierz firmę, do której należy sprzęt."; return }
        guard let api = state.nativeAPI() else { return }
        guard state.canWrite else { state.error = "Zapis wymaga połączenia z serwerem CRM."; return }
        let privateOwned = draft.ownership == .privateOwned
        var body: [String: JSONValue] = [
            "op": .string("save"), "equipmentId": .string(equipmentID), "quantity": .number(Double(quantity)), "ownership": .string(draft.ownership.rawValue),
            "companyId": privateOwned ? .null : .string(draft.companyId), "acquiredOn": draft.acquiredOn.map { .string(DayDates.string($0)) } ?? .null,
            "netAmount": Self.amount(draft.net), "grossAmount": Self.amount(draft.gross),
            "currency": .string(draft.currency.trimmingCharacters(in: .whitespaces).uppercased().isEmpty ? "PLN" : draft.currency.trimmingCharacters(in: .whitespaces).uppercased()),
            "document": privateOwned || draft.document == nil ? .null : .object(["type": .string(draft.document!.type), "id": .string(draft.document!.id)]),
            "documentNote": .string(privateOwned ? "" : draft.documentNote), "notes": .string(draft.notes),
        ]
        if let id = draft.acquisitionID { body["id"] = .string(id) }
        do {
            let data = try await state.withPending("Zapisuję partię…") { try await api.post("/assets", body) }
            let next = try JSONDecoder().decode(EquipmentAssets.self, from: data)
            state.succeed(draft.acquisitionID == nil ? "Dodano partię sprzętu" : "Zapisano partię sprzętu")
            saved(next)
            dismiss()
        } catch {
            state.error = assetFailure(error, "Nie udało się zapisać partii.")
        }
    }
}

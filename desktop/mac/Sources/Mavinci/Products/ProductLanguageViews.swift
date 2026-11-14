import SwiftUI

// MARK: Karta produktu, część C2b — wersja angielska (`useProductLanguage` i przełącznik PL/EN w CRM, funkcja `translate-product`):
// teksty produktu, wariantów, pakietów, dodatków i wymagań po angielsku. W EN poprawia się tylko teksty — ceny, zdjęcia, skład
// i ustawienia są wspólne z wersją polską. Tłumaczenie po zmianie PL robi „Przetłumacz PL → EN” (też w tle po zapisie sekcji).

/// Pola EN z serwera (`currentEnglishFields`): tekst polski, tłumaczenie (puste — brak albo nieaktualne po zmianie PL) i limit.
struct ProductEnglishDocument: Codable {
    struct Field: Codable, Identifiable, Hashable {
        var key: String
        var label: String
        var source: String
        var target: String
        var limit: Int?

        var id: String { key }
        var missing: Bool { target.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        /// Grupa jak klucze `productTranslationFields`: produkt, korzyści, warianty, pakiety…
        var group: String {
            switch key.split(separator: "/").first.map(String.init) ?? key {
            case "offer_benefits": return "Korzyści"
            case "offer_requirements": return "Wymagania"
            case "tags": return "Tagi"
            case "variants": return "Elementy i warianty"
            case "sales_packages": return "Pakiety"
            case "pricing_addons": return "Dodatki i limity"
            case "offer_additional_requirements": return "Wymagania szczegółowe"
            default: return "Produkt"
            }
        }
    }
    var revision: Int
    var version: Int
    var fields: [Field]

    var missing: [Field] { fields.filter { $0.missing } }
    /// Gotowa jak `englishReady` w CRM: każde pole ma tłumaczenie zgodne z bieżącą treścią PL.
    var ready: Bool { missing.isEmpty }
}

struct ProductEnglishGroup: Identifiable {
    let name: String
    let fields: [ProductEnglishDocument.Field]
    var id: String { name }

    /// Grupy w kolejności pierwszego wystąpienia (jak lista pól w CRM).
    static func make(_ fields: [ProductEnglishDocument.Field]) -> [ProductEnglishGroup] {
        var order: [String] = []
        var items: [String: [ProductEnglishDocument.Field]] = [:]
        for field in fields {
            if items[field.group] == nil { order.append(field.group) }
            items[field.group, default: []].append(field)
        }
        return order.map { ProductEnglishGroup(name: $0, fields: items[$0] ?? []) }
    }
}

extension ProductsStore {
    func loadEnglish(_ productID: String) async {
        guard let api else { return }
        do {
            english[productID] = try JSONDecoder().decode(ProductEnglishDocument.self, from: try await api.get("/products?op=english&id=\(productID)"))
            englishErrors[productID] = nil
        } catch {
            englishErrors[productID] = failureText(error, "Nie udało się pobrać wersji angielskiej.")
        }
    }

    /// Zapis poprawionych tekstów EN z kontrolą wersji (konflikt, gdy ktoś w międzyczasie zmienił treść PL albo EN).
    func saveEnglish(_ productID: String, document: ProductEnglishDocument, targets: [String: String]) async -> Bool {
        guard let api, let workspace else { return false }
        guard workspace.canWrite else {
            workspace.error = "Zapis wymaga połączenia z serwerem CRM."
            return false
        }
        let body: [String: JSONValue] = [
            "op": .string("englishSave"), "id": .string(productID),
            "revision": .number(Double(document.revision)), "version": .number(Double(document.version)),
            "targets": .object(targets.mapValues { JSONValue.string($0) }),
        ]
        do {
            let data = try await workspace.withPending("Zapisywanie wersji angielskiej…") { try await api.post("/products", body) }
            english[productID] = try JSONDecoder().decode(ProductEnglishDocument.self, from: data)
            englishErrors[productID] = nil
            workspace.succeed("Zapisano wersję angielską")
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać wersji angielskiej.")
            return false
        }
    }
}

/// Sekcja karty: stan wersji EN, tłumaczenie i edycja tekstów.
@MainActor struct ProductEnglishSection: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let canEdit: Bool
    /// Inna sekcja w edycji albo brak połączenia.
    let locked: Bool
    /// Zmiana produktu (np. `updated_at`) — odśwież stan tłumaczeń.
    let revision: String
    @Environment(\.crmTheme) private var theme
    @State private var editing = false

    private var document: ProductEnglishDocument? { store.english[productID] }
    private var busy: Bool { (store.englishBusy[productID] ?? 0) > 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Wersja angielska (EN)").font(.headline)
                    Text("Teksty produktu w ofertach po angielsku. Ceny, zdjęcia, skład i ustawienia są wspólne z wersją polską.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                if canEdit {
                    Button { Task { await store.translate(productID) } } label: { Label("Przetłumacz PL → EN", systemImage: "character.book.closed") }
                        .disabled(locked || busy)
                }
                Button { editing = true } label: { Label(canEdit ? "Edytuj teksty EN" : "Pokaż teksty EN", systemImage: canEdit ? "pencil" : "doc.text") }
                    .disabled(document == nil || busy || (canEdit && locked))
            }
            .controlSize(.small)
            status
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
        .task(id: revision) { await store.loadEnglish(productID) }
        .sheet(isPresented: $editing) {
            if let document { ProductEnglishSheet(store: store, productID: productID, document: document, canEdit: canEdit) }
        }
    }

    @ViewBuilder private var status: some View {
        if busy {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Przygotowywanie wersji angielskiej… Tłumaczenie może potrwać do 3 minut.").font(.callout).foregroundStyle(.secondary)
            }
        } else if let document {
            if document.ready {
                Label("Wersja EN gotowa — przetłumaczone pola: \(document.fields.count).", systemImage: "checkmark.circle.fill")
                    .font(.callout).foregroundStyle(.green)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Brak tłumaczenia: \(document.missing.count) z \(document.fields.count) pól.", systemImage: "exclamationmark.triangle.fill")
                        .font(.callout).foregroundStyle(.orange)
                    let names = document.missing.prefix(6).map(\.label).joined(separator: ", ")
                    Text(names + (document.missing.count > 6 ? "…" : "")).font(.caption).foregroundStyle(.secondary)
                    Text(canEdit ? "Użyj „Przetłumacz PL → EN” albo uzupełnij teksty ręcznie. Oferta po angielsku wymaga kompletu tłumaczeń."
                                 : "Oferta po angielsku wymaga kompletu tłumaczeń.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
        } else if let problem = store.englishErrors[productID] {
            HStack {
                Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                Spacer()
                Button("Spróbuj ponownie") { Task { await store.loadEnglish(productID) } }.controlSize(.small)
            }
        } else {
            ProgressView().controlSize(.small)
        }
    }
}

/// Teksty EN: polski tekst źródłowy i tłumaczenie z limitem znaków (jak edycja karty w trybie EN w CRM).
@MainActor struct ProductEnglishSheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let canEdit: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var document: ProductEnglishDocument
    @State private var targets: [String: String]
    @State private var onlyMissing = false
    @State private var problem: String?
    @State private var saving = false

    init(store: ProductsStore, productID: String, document: ProductEnglishDocument, canEdit: Bool) {
        _store = ObservedObject(wrappedValue: store)
        self.productID = productID
        self.canEdit = canEdit
        _document = State(initialValue: document)
        _targets = State(initialValue: Self.targets(document))
    }

    private static func targets(_ document: ProductEnglishDocument) -> [String: String] {
        Dictionary(document.fields.map { ($0.key, $0.target) }, uniquingKeysWith: { first, _ in first })
    }

    private var changed: Bool { document.fields.contains { targets[$0.key, default: ""] != $0.target } }
    private var busy: Bool { saving || (store.englishBusy[productID] ?? 0) > 0 }
    private var groups: [ProductEnglishGroup] {
        ProductEnglishGroup.make(onlyMissing ? document.fields.filter { $0.missing } : document.fields)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Wersja angielska (EN)").font(.title3.weight(.semibold))
                    Text("W EN poprawiasz tylko teksty. Dodawanie, usuwanie i zmianę składu, cen lub zdjęć wykonaj w wersji polskiej.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Toggle("Tylko bez tłumaczenia (\(document.missing.count))", isOn: $onlyMissing)
                    .toggleStyle(.checkbox).disabled(document.missing.isEmpty && !onlyMissing)
            }
            .padding(.horizontal, 18).padding(.top, 16).padding(.bottom, 10)

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if groups.isEmpty {
                        Text(onlyMissing ? "Wszystkie pola mają tłumaczenie." : "Produkt nie ma tekstów do tłumaczenia.")
                            .foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 30)
                    }
                    ForEach(groups) { group in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(group.name).font(.headline)
                            ForEach(group.fields) { field in row(field) }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                .padding(.horizontal, 18).padding(.bottom, 10)
            }
            .frame(height: 560)

            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
                else if busy && !saving { Text("Trwa tłumaczenie…").font(.caption).foregroundStyle(.secondary) }
                else { Text("Puste pole oznacza brak tłumaczenia. Po zmianie tekstu PL tłumaczenie trzeba odświeżyć.").font(.caption).foregroundStyle(.secondary) }
                Spacer()
                Button(canEdit ? "Anuluj" : "Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if canEdit {
                    Button("Przetłumacz brakujące") { Task { await translate() } }
                        .disabled(busy || changed || document.ready)
                        .help(changed ? "Najpierw zapisz albo anuluj zmiany." : "Przetłumacz pola bez tłumaczenia (PL → EN).")
                    Button(saving ? "Zapisywanie…" : "Zapisz wersję EN") { Task { await save() } }
                        .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy || !changed)
                }
            }
            .padding(18)
        }
        .frame(width: 860)
        .background(theme.page)
    }

    private func row(_ field: ProductEnglishDocument.Field) -> some View {
        let text = targets[field.key, default: ""]
        let length = text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(field.label).font(.callout.weight(.medium))
                if field.missing {
                    Text("Brak tłumaczenia").font(.caption2.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Color.orange.opacity(0.15), in: Capsule()).foregroundStyle(.orange)
                }
                Spacer()
                if let limit = field.limit {
                    Text("\(length)/\(limit)").font(.caption).monospacedDigit().foregroundStyle(length > limit ? .red : .secondary)
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("PL").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Text(field.source).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("EN").font(.caption2.weight(.bold)).foregroundStyle(theme.accent)
                TextField("", text: Binding(get: { targets[field.key, default: ""] }, set: { targets[field.key] = $0 }),
                          prompt: Text("Tłumaczenie"), axis: .vertical)
                    .textFieldStyle(.roundedBorder).lineLimit(1...8)
                    .disabled(!canEdit || busy)
            }
        }
    }

    private func translate() async {
        problem = nil
        await store.translate(productID)
        if let next = store.english[productID] {
            document = next
            targets = Self.targets(next)
        }
    }

    private func save() async {
        var payload: [String: String] = [:]
        for field in document.fields {
            let value = targets[field.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty && !field.missing {
                problem = "Pole EN nie może być puste: \(field.label). Treść usuwa się w wersji polskiej."
                return
            }
            if let limit = field.limit, value.utf16.count > limit {
                problem = "Skróć: \(field.label) (maks. \(limit) znaków)."
                return
            }
            payload[field.key] = value
        }
        problem = nil
        saving = true
        defer { saving = false }
        if await store.saveEnglish(productID, document: document, targets: payload) { dismiss() }
        else if let message = store.workspace?.error { problem = message }
    }
}

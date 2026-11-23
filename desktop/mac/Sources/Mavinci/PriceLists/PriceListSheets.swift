import SwiftUI

// MARK: Okna cenników: nowy cennik, kopia na kolejny sezon, ustawienia, uzupełnienie z katalogu i zmiana cen o %

/// Procent zmiany cen (od -50 do +200, przecinek albo kropka); `nil` — nieprawidłowy.
private func percentValue(_ text: String) -> Double? {
    let cleaned = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
    let value = cleaned.isEmpty ? 0 : Double(cleaned)
    guard let value, value >= -50, value <= 200 else { return nil }
    return value
}

/// Pola „Zmiana cen (%)” i „Zaokrąglenie”.
private struct PercentFields: View {
    @Binding var percent: String
    @Binding var rounding: Double
    var body: some View {
        HStack(spacing: 12) {
            LabeledContent("Zmiana cen (%)") {
                TextField("", text: $percent, prompt: Text("np. 8")).textFieldStyle(.roundedBorder).frame(width: 90)
            }
            Picker("Zaokrąglenie", selection: $rounding) {
                ForEach(PriceListRounding.steps, id: \.self) { step in Text(PriceListRounding.label(step)).tag(step) }
            }
            .frame(maxWidth: 220)
        }
        if percentValue(percent) == nil {
            Text("Podaj procent od -50 do 200.").font(.caption).foregroundStyle(.red)
        }
    }
}

@MainActor struct PriceListCreateSheet: View {
    @ObservedObject var store: PriceListsStore
    let data: PriceListsState
    @Environment(\.dismiss) private var dismiss
    @State private var companyID: String
    @State private var name = ""
    @State private var from = PriceListDates.nextYear.from
    @State private var to = PriceListDates.nextYear.to
    @State private var fill = true
    @State private var categoryID = ""
    @State private var percent = "0"
    @State private var rounding: Double = 1
    @State private var saving = false

    init(store: PriceListsStore, data: PriceListsState) {
        self.store = store
        self.data = data
        let preferred = data.companies.first { $0.name.range(of: "event rulers", options: [.caseInsensitive, .diacriticInsensitive]) != nil } ?? data.companies.first
        _companyID = State(initialValue: preferred?.id ?? "")
    }

    private var valid: Bool {
        !companyID.isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty && to >= from && (!fill || percentValue(percent) != nil)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nowy cennik sezonowy").font(.title3.weight(.semibold))
            Form {
                Picker("Marka realizująca", selection: $companyID) {
                    ForEach(data.companies) { company in Text(company.name).tag(company.id) }
                }
                TextField("Nazwa", text: $name, prompt: Text("np. Wesela \(String(Calendar.current.component(.year, from: Date()) + 1))"))
                DatePicker("Sezon od (data eventu)", selection: $from, displayedComponents: .date)
                DatePicker("Sezon do", selection: $to, displayedComponents: .date)
                Toggle("Wypełnij cenami z katalogu", isOn: $fill)
                if fill {
                    Picker("Produkty z kategorii", selection: $categoryID) {
                        Text("Wszystkie aktywne produkty").tag("")
                        ForEach(data.categories) { row in Text(row.name).tag(row.id) }
                    }
                    PercentFields(percent: $percent, rounding: $rounding)
                }
            }
            .formStyle(.grouped)
            Text("Nowy cennik jest szkicem — sprawdź ceny i aktywuj go. Aktywne cenniki jednej marki nie mogą obejmować tych samych dat.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Tworzenie…" : "Utwórz cennik") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(!valid || saving)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var fields: [String: JSONValue] = [
            "companyId": .string(companyID),
            "name": .string(name.trimmingCharacters(in: .whitespaces)),
            "seasonFrom": .string(PriceListDates.string(from)),
            "seasonTo": .string(PriceListDates.string(to)),
        ]
        if fill {
            fields["fill"] = .object([
                "categoryId": categoryID.isEmpty ? .null : .string(categoryID),
                "percent": .number(percentValue(percent) ?? 0),
                "rounding": .number(rounding),
            ])
        }
        if await store.changeList("create", fields, pending: "Tworzenie cennika…") { dismiss() }
    }
}

@MainActor struct PriceListDuplicateSheet: View {
    @ObservedObject var store: PriceListsStore
    let source: PriceListsState.PriceList
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var from: Date
    @State private var to: Date
    @State private var percent = "8"
    @State private var rounding: Double = 10
    @State private var saving = false

    init(store: PriceListsStore, source: PriceListsState.PriceList) {
        self.store = store
        self.source = source
        // „Wesela 2027” → „Wesela 2028”, sezon o rok dalej.
        var next = source.name
        if let range = next.range(of: #"\d{4}"#, options: .regularExpression), let year = Int(next[range]) {
            next.replaceSubrange(range, with: String(year + 1))
        } else {
            next += " (kopia)"
        }
        _name = State(initialValue: next)
        let shift = { (raw: String) -> Date in
            let date = PriceListDates.date(raw) ?? Date()
            return Calendar.current.date(byAdding: .year, value: 1, to: date) ?? date
        }
        _from = State(initialValue: shift(source.seasonFrom))
        _to = State(initialValue: shift(source.seasonTo))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Kopiuj na kolejny sezon").font(.title3.weight(.semibold))
            Text("Nowy szkic z cenami z „\(source.name)” zmienionymi o podany procent (np. inflacja na kolejny rok).")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Form {
                TextField("Nazwa", text: $name)
                DatePicker("Sezon od", selection: $from, displayedComponents: .date)
                DatePicker("Sezon do", selection: $to, displayedComponents: .date)
                PercentFields(percent: $percent, rounding: $rounding)
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Kopiowanie…" : "Utwórz kopię") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || to < from || percentValue(percent) == nil)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let fields: [String: JSONValue] = [
            "id": .string(source.id),
            "name": .string(name.trimmingCharacters(in: .whitespaces)),
            "seasonFrom": .string(PriceListDates.string(from)),
            "seasonTo": .string(PriceListDates.string(to)),
            "percent": .number(percentValue(percent) ?? 0),
            "rounding": .number(rounding),
        ]
        if await store.changeList("duplicate", fields, pending: "Kopiowanie cennika…") { dismiss() }
    }
}

@MainActor struct PriceListSettingsSheet: View {
    @ObservedObject var store: PriceListsStore
    let list: PriceListsState.PriceList
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var from: Date
    @State private var to: Date
    @State private var notes: String
    @State private var saving = false

    init(store: PriceListsStore, list: PriceListsState.PriceList) {
        self.store = store
        self.list = list
        _name = State(initialValue: list.name)
        _from = State(initialValue: PriceListDates.date(list.seasonFrom) ?? Date())
        _to = State(initialValue: PriceListDates.date(list.seasonTo) ?? Date())
        _notes = State(initialValue: list.notes)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ustawienia cennika").font(.title3.weight(.semibold))
            Form {
                TextField("Nazwa", text: $name)
                DatePicker("Sezon od (data eventu)", selection: $from, displayedComponents: .date)
                DatePicker("Sezon do", selection: $to, displayedComponents: .date)
                TextField("Notatki (dla zespołu)", text: $notes, axis: .vertical).lineLimit(2...5)
            }
            .formStyle(.grouped)
            if list.offerCount > 0 {
                Text("Cennik jest użyty w ofertach (\(list.offerCount)) — zmiana sezonu nie zmienia ich cen; nowe oferty wybiorą cennik według nowych dat.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || to < from)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let fields: [String: JSONValue] = [
            "id": .string(list.id),
            "name": .string(name.trimmingCharacters(in: .whitespaces)),
            "seasonFrom": .string(PriceListDates.string(from)),
            "seasonTo": .string(PriceListDates.string(to)),
            "notes": .string(String(notes.prefix(2000))),
        ]
        if await store.changeList("update", fields, pending: "Zapisywanie cennika…") { dismiss() }
    }
}

/// „Uzupełnij z katalogu” (kategoria, %, zaokrąglenie) albo „Zmień ceny o %” (wszystkie ceny cennika).
@MainActor struct PriceListPercentSheet: View {
    enum Mode: String, Identifiable {
        case fill, percent
        var id: String { rawValue }
    }
    @ObservedObject var store: PriceListsStore
    let list: PriceListsState.PriceList
    let categories: [PriceListsState.Category]
    let mode: Mode
    @Environment(\.dismiss) private var dismiss
    @State private var categoryID = ""
    @State private var percent = "0"
    @State private var rounding: Double = 1
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(mode == .fill ? "Uzupełnij z katalogu" : "Zmień wszystkie ceny o %").font(.title3.weight(.semibold))
            Text(mode == .fill
                 ? "Dodaje do cennika aktywne produkty i warianty, których jeszcze w nim nie ma, z ceną katalogową zmienioną o podany procent. Istniejące ceny zostają."
                 : "Zmienia wszystkie ceny w cenniku „\(list.name)” (\(list.entryCount)) o podany procent i zaokrągla. Zapisane oferty zachowują swoje ceny.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Form {
                if mode == .fill {
                    Picker("Produkty z kategorii", selection: $categoryID) {
                        Text("Wszystkie aktywne produkty").tag("")
                        ForEach(categories) { row in Text(row.name).tag(row.id) }
                    }
                }
                PercentFields(percent: $percent, rounding: $rounding)
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : mode == .fill ? "Uzupełnij" : "Zmień ceny") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || percentValue(percent) == nil)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        var fields: [String: JSONValue] = [
            "id": .string(list.id),
            "percent": .number(percentValue(percent) ?? 0),
            "rounding": .number(rounding),
        ]
        if mode == .fill { fields["categoryId"] = categoryID.isEmpty ? .null : .string(categoryID) }
        let done = await store.changePrices(mode == .fill ? "fill" : "percent", fields,
                                            pending: mode == .fill ? "Uzupełnianie cennika…" : "Zmiana cen…")
        if done { dismiss() }
    }
}

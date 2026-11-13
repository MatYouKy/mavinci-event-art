import SwiftUI

// MARK: Okna zakładki „Warunki” edytora szablonu umowy (jak `ContractConditionDialog` i `ContractOptionsDialog` w CRM):
// warunek akapitu, punktu albo sekcji (klient, rodzaj wydarzenia, opcja umowy, pole wypełnione) i opcje umowy szablonu.

struct ContractConditionRequest: Identifiable {
    let id = UUID()
    let initial: String?
    let scope: String
}

@MainActor struct ContractConditionSheet: View {
    enum Kind: String, CaseIterable {
        case client, category, option, filled

        var title: String {
            switch self {
            case .client: return "Klient"
            case .category: return "Rodzaj wydarzenia"
            case .option: return "Opcja umowy"
            case .filled: return "Pole wypełnione"
            }
        }

        var hint: String {
            switch self {
            case .client: return "firma albo osoba prywatna — z danych wydarzenia"
            case .category: return "kategoria wydarzenia, np. Wesele"
            case .option: return "włączana przy każdej umowie, np. nocleg"
            case .filled: return "np. numer zamówienia klienta"
            }
        }

        var symbol: String {
            switch self {
            case .client: return "building.2"
            case .category: return "calendar"
            case .option: return "checklist"
            case .filled: return "character.cursor.ibeam"
            }
        }
    }

    let request: ContractConditionRequest
    let categories: [String]
    let fields: [ContractTemplateDocumentPayload.Field]
    let fieldLabels: [String: String]
    let onApply: (String, [ContractOptionItem]) -> Void
    let onRemove: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var kind: Kind
    @State private var negate: Bool
    @State private var client: String
    @State private var selectedCategories: [String]
    @State private var optionList: [ContractOptionItem]
    @State private var optionKey: String
    @State private var newOption = ""
    @State private var field: String

    init(request: ContractConditionRequest, options: [ContractOptionItem], categories: [String], fields: [ContractTemplateDocumentPayload.Field],
         fieldLabels: [String: String], onApply: @escaping (String, [ContractOptionItem]) -> Void, onRemove: (() -> Void)?) {
        self.request = request
        self.categories = categories
        self.fields = fields
        self.fieldLabels = fieldLabels
        self.onApply = onApply
        self.onRemove = onRemove
        let parsed = ContractCondition.parse(request.initial)
        let initialKind: Kind
        switch parsed?.kind {
        case .client?: initialKind = .client
        case .category?: initialKind = .category
        case .option?: initialKind = .option
        case .filled?, .equals?: initialKind = .filled
        case nil: initialKind = .client
        }
        _kind = State(initialValue: initialKind)
        _negate = State(initialValue: parsed?.negate ?? false)
        _client = State(initialValue: parsed?.kind == .client ? (parsed?.values.first?.lowercased() ?? "firma") : "firma")
        _selectedCategories = State(initialValue: parsed?.kind == .category ? parsed?.values ?? [] : [])
        _optionList = State(initialValue: options)
        _optionKey = State(initialValue: parsed?.kind == .option
            ? String(parsed?.variable.dropFirst(ContractCondition.optionPrefix.count) ?? "")
            : options.first?.key ?? "")
        _field = State(initialValue: parsed.flatMap { $0.kind == .filled || $0.kind == .equals ? $0.variable : nil } ?? fields.first?.key ?? "")
    }

    private var condition: ContractCondition? {
        switch kind {
        case .client:
            return ContractCondition(kind: .client, variable: ContractCondition.clientVariable, values: [client], negate: false)
        case .category:
            return selectedCategories.isEmpty ? nil
                : ContractCondition(kind: .category, variable: ContractCondition.categoryVariable, values: selectedCategories, negate: negate)
        case .option:
            return optionKey.isEmpty ? nil : ContractCondition(kind: .option, variable: ContractCondition.optionPrefix + optionKey, values: [], negate: negate)
        case .filled:
            return field.isEmpty ? nil : ContractCondition(kind: .filled, variable: field, values: [], negate: negate)
        }
    }

    private var categoryChoices: [String] {
        Array(Set(categories + selectedCategories)).sorted { $0.compare($1, locale: Locale(identifier: "pl_PL")) == .orderedAscending }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(request.initial == nil ? "Dodaj warunek" : "Zmień warunek").font(.title3.weight(.semibold))
                Text("\(request.scope) — pojawi się w umowie tylko, gdy warunek jest spełniony.").font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(Kind.allCases, id: \.self) { item in
                    Button { kind = item } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: item.symbol).foregroundStyle(kind == item ? Color.accentColor : .secondary).frame(width: 18)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(item.title)
                                Text(item.hint).font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 7).fill(kind == item ? Color.accentColor.opacity(0.14) : Color.primary.opacity(0.04)))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(kind == item ? Color.accentColor.opacity(0.7) : Color.primary.opacity(0.1)))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            switch kind {
            case .client:
                Picker("Klient", selection: $client) {
                    Text("Firma (organizacja)").tag("firma")
                    Text("Osoba prywatna").tag("osoba")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            case .category:
                VStack(alignment: .leading, spacing: 6) {
                    Text("Pokaż dla wydarzeń z kategorii (można kilka):").font(.caption).foregroundStyle(.secondary)
                    if categoryChoices.isEmpty {
                        Text("Brak kategorii wydarzeń.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        ScrollView {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 6)], alignment: .leading, spacing: 6) {
                                ForEach(categoryChoices, id: \.self) { name in
                                    let active = selectedCategories.contains(name)
                                    Button {
                                        if active { selectedCategories.removeAll { $0 == name } } else { selectedCategories.append(name) }
                                    } label: {
                                        Text(name).font(.caption).lineLimit(1)
                                            .padding(.horizontal, 10).padding(.vertical, 4)
                                            .frame(maxWidth: .infinity)
                                            .background(Capsule().fill(active ? Color.accentColor.opacity(0.18) : Color.primary.opacity(0.05)))
                                            .overlay(Capsule().stroke(active ? Color.accentColor.opacity(0.7) : Color.primary.opacity(0.12)))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        .frame(maxHeight: 170)
                    }
                }
            case .option:
                VStack(alignment: .leading, spacing: 8) {
                    if optionList.isEmpty {
                        Text("Szablon nie ma jeszcze opcji — dodaj pierwszą.").font(.caption).foregroundStyle(.secondary)
                    } else {
                        Picker("Opcja", selection: $optionKey) {
                            ForEach(optionList, id: \.key) { option in Text(option.label).tag(option.key) }
                        }
                        .labelsHidden()
                    }
                    HStack {
                        TextField("Nowa opcja, np. Nocleg dla wykonawcy", text: $newOption).onSubmit(addOption)
                        Button("Dodaj", action: addOption).disabled(newOption.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            case .filled:
                Picker("Pole", selection: $field) {
                    ForEach(fields, id: \.key) { item in Text(item.label).tag(item.key) }
                }
                .labelsHidden()
            }

            if kind != .client {
                Toggle(kind == .category ? "Odwrotnie — dla wszystkich innych wydarzeń"
                       : kind == .option ? "Odwrotnie — gdy opcja jest wyłączona" : "Odwrotnie — gdy pole jest puste", isOn: $negate)
                    .toggleStyle(.checkbox)
            }

            Text(condition.map { ContractConditionText.describe($0.expression, options: optionList, fieldLabels: fieldLabels) } ?? "Wybierz warunek")
                .font(.callout)
                .foregroundStyle(ContractColorsUI.condition)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 7).fill(ContractColorsUI.condition.opacity(0.1)))

            HStack {
                if request.initial != nil, let onRemove {
                    Button("Usuń warunek", role: .destructive) {
                        onRemove()
                        dismiss()
                    }
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zastosuj") {
                    guard let condition else { return }
                    onApply(condition.expression, optionList)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(condition == nil)
            }
        }
        .padding(20)
        .frame(width: 520)
    }

    private func addOption() {
        let label = newOption.trimmingCharacters(in: .whitespaces)
        guard !label.isEmpty else { return }
        let key = ContractCondition.optionKey(label, existing: optionList.map(\.key))
        optionList.append(ContractOptionItem(key: key, label: label, defaultOn: true))
        optionKey = key
        newOption = ""
    }
}

enum ContractColorsUI {
    static let condition = Color(red: 0.49, green: 0.36, blue: 0.76)
}

/// Opcje umowy szablonu (np. „Nocleg dla wykonawcy”) — przy każdej umowie wydarzenia opcję można włączyć lub wyłączyć;
/// „domyślnie włączona” — stan dla nowej umowy. Opcji użytej w warunkach nie da się usunąć.
@MainActor struct ContractOptionsSheet: View {
    let usage: [String: Int]
    let onSave: ([ContractOptionItem]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var list: [ContractOptionItem]
    @State private var label = ""

    init(options: [ContractOptionItem], usage: [String: Int], onSave: @escaping ([ContractOptionItem]) -> Void) {
        self.usage = usage
        self.onSave = onSave
        _list = State(initialValue: options)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Opcje umowy").font(.title3.weight(.semibold))
                Text("Przełączane przy każdej umowie wydarzenia; w warunkach: „Opcja umowy”.").font(.caption).foregroundStyle(.secondary)
            }
            if list.isEmpty {
                Text("Szablon nie ma jeszcze opcji.").font(.callout).foregroundStyle(.secondary).padding(.vertical, 6)
            }
            ForEach($list, id: \.key) { $option in
                HStack(spacing: 10) {
                    TextField("Nazwa opcji", text: $option.label)
                    Toggle("domyślnie włączona", isOn: $option.defaultOn).toggleStyle(.checkbox).fixedSize()
                    let used = usage[option.key] ?? 0
                    Button {
                        list.removeAll { $0.key == option.key }
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .disabled(used > 0)
                    .help(used > 0 ? "Użyta w warunkach (\(used)) — najpierw usuń warunki" : "Usuń opcję")
                }
            }
            HStack {
                TextField("Nowa opcja", text: $label).onSubmit(add)
                Button("Dodaj", action: add).disabled(label.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Zapisz opcje") {
                    onSave(list.map { option in
                        var next = option
                        next.label = option.label.trimmingCharacters(in: .whitespaces).isEmpty ? option.key : option.label.trimmingCharacters(in: .whitespaces)
                        return next
                    })
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: 480)
    }

    private func add() {
        let name = label.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        list.append(ContractOptionItem(key: ContractCondition.optionKey(name, existing: list.map(\.key)), label: name, defaultOn: true))
        label = ""
    }
}

import SwiftUI

// MARK: Formularz czynności opisany przez serwer (`DocAction.fields`) — pola, warunki `visibleIf`, błędy przy polach z odpowiedzi 409.

struct DocFormSheet: View {
    let set: String
    let record: DocRecord?
    let action: DocAction
    @EnvironmentObject private var workspace: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: String] = [:]
    @State private var picks: [String: Set<String>] = [:]
    @State private var fieldErrors: [String: String] = [:]
    @State private var failure: String?
    @State private var saving = false
    /// Jeden klucz na próbę zapisu — ponowienie po zerwanym połączeniu nie utworzy drugiego rekordu.
    @State private var key = UUID().uuidString

    private var fields: [DocField] { action.fields ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(action.label).font(.title2.bold()).padding([.horizontal, .top], 22).padding(.bottom, 6)
            if let note = action.note, !note.isEmpty { Text(note).font(.callout).foregroundStyle(.secondary).padding(.horizontal, 22) }
            if let failure { Text(failure).font(.callout).foregroundStyle(.red).padding(.horizontal, 22).padding(.top, 8).textSelection(.enabled) }
            Form {
                ForEach(fields.filter(visible)) { field in
                    VStack(alignment: .leading, spacing: 4) {
                        input(field)
                        if !field.help.isEmpty { Text(field.help).font(.caption).foregroundStyle(.secondary) }
                        if let error = fieldErrors[field.name] { Text(error).font(.caption).foregroundStyle(.red) }
                    }
                }
            }.formStyle(.grouped).scrollContentBackground(.hidden)
            HStack {
                if saving { ProgressView().controlSize(.small) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(action.submitLabel ?? "Zapisz") { Task { await submit() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || !workspace.canWrite)
            }.padding(16)
        }
        .frame(minWidth: 560, idealWidth: 640, minHeight: 360, idealHeight: 560)
        .onAppear(perform: start)
    }

    private func start() {
        for field in fields {
            switch field.type {
            case "multiselect": picks[field.name] = Set(field.value.array.map(\.plain))
            case "money": values[field.name] = field.value == .null ? "" : MoneyText.format(field.value.number)
            case "toggle": values[field.name] = field.value.flag || field.value.plain == "true" ? "true" : "false"
            default: values[field.name] = field.value.plain
            }
        }
    }

    private func visible(_ field: DocField) -> Bool {
        guard let rule = field.visibleIf else { return true }
        let current = values[rule.field] ?? ""
        if let allowed = rule.in, !allowed.contains(current) { return false }
        if let blocked = rule.notIn, blocked.contains(current) { return false }
        return true
    }

    private func binding(_ name: String) -> Binding<String> { Binding(get: { values[name] ?? "" }, set: { values[name] = $0; fieldErrors[name] = nil }) }

    @ViewBuilder private func input(_ field: DocField) -> some View {
        let label = field.required ? "\(field.label) *" : field.label
        switch field.type {
        case "textarea":
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.callout)
                TextEditor(text: binding(field.name)).font(.body).frame(minHeight: 90).scrollContentBackground(.hidden)
                    .padding(6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
            }
        case "password": SecureField(label, text: binding(field.name))
        case "number": TextField(label, text: binding(field.name)).monospacedDigit()
        case "money": TextField(label, text: binding(field.name), prompt: Text("0,00")).monospacedDigit()
        case "date":
            HStack {
                DatePicker(label, selection: Binding(get: { DayText.date(values[field.name] ?? "") ?? Date() }, set: { values[field.name] = DayText.string($0); fieldErrors[field.name] = nil }), displayedComponents: .date)
                if !(values[field.name] ?? "").isEmpty && !field.required { Button { values[field.name] = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).foregroundStyle(.secondary).help("Wyczyść datę") }
                else if (values[field.name] ?? "").isEmpty { Text("brak").font(.caption).foregroundStyle(.secondary) }
            }
        case "select":
            Picker(label, selection: binding(field.name)) {
                if !field.required || (values[field.name] ?? "").isEmpty { Text("—").tag("") }
                ForEach(options(field)) { Text($0.name).tag($0.id) }
            }
        case "multiselect":
            VStack(alignment: .leading, spacing: 4) {
                Text(label).font(.callout)
                ForEach(options(field)) { option in
                    Toggle(option.name, isOn: Binding(get: { picks[field.name]?.contains(option.id) == true }, set: { on in
                        var current = picks[field.name] ?? []
                        if on { current.insert(option.id) } else { current.remove(option.id) }
                        picks[field.name] = current; fieldErrors[field.name] = nil
                    }))
                }
            }
        case "toggle": Toggle(label, isOn: Binding(get: { values[field.name] == "true" }, set: { values[field.name] = $0 ? "true" : "false"; fieldErrors[field.name] = nil }))
        case "lines", "file":
            LabeledContent(label) { Text("Edycja tego pola jest na razie w CRM.").foregroundStyle(.secondary) }
        default: TextField(label, text: binding(field.name))
        }
    }

    private func options(_ field: DocField) -> [DocOption] {
        guard let parent = field.dependsOn else { return field.options }
        let current = values[parent] ?? ""
        return field.options.filter { $0.parent == nil || $0.parent == current }
    }

    private func payload() -> [String: JSONValue]? {
        var out: [String: JSONValue] = [:]
        var errors: [String: String] = [:]
        for field in fields where visible(field) && field.type != "lines" && field.type != "file" {
            let raw = (values[field.name] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            switch field.type {
            case "multiselect":
                let chosen = Array(picks[field.name] ?? []).sorted()
                if field.required && chosen.isEmpty { errors[field.name] = "Wybierz co najmniej jedną pozycję." }
                out[field.name] = .array(chosen.map(JSONValue.string))
            case "toggle": out[field.name] = .bool(raw == "true")
            case "number":
                if raw.isEmpty { if field.required { errors[field.name] = "Wpisz liczbę." }; out[field.name] = .null }
                else if let n = Double(raw.replacingOccurrences(of: ",", with: ".")) { out[field.name] = .number(n) } else { errors[field.name] = "To nie jest liczba." }
            case "money":
                if raw.isEmpty { if field.required { errors[field.name] = "Wpisz kwotę." }; out[field.name] = .null }
                else if let grosz = MoneyText.grosz(raw) { out[field.name] = .number(Double(grosz)) } else { errors[field.name] = "Wpisz kwotę, np. 1 250,00." }
            default:
                if field.required && raw.isEmpty { errors[field.name] = "To pole jest wymagane." }
                out[field.name] = .string(raw)
            }
        }
        fieldErrors = errors
        return errors.isEmpty ? out : nil
    }

    private func submit() async {
        guard let data = payload() else { failure = "Sprawdź wpisane dane."; return }
        saving = true; failure = nil
        let result = await workspace.runNative(action, record: record, set: set, data: data, key: key)
        saving = false
        switch result {
        case .success: dismiss()
        case .failure(let issue):
            failure = issue.message
            fieldErrors = issue.fieldErrors
            if issue.status != 409 && issue.status != 400 { key = UUID().uuidString }
        }
    }
}

enum MoneyText {
    static func format(_ grosz: Double) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "pl_PL"); f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: grosz / 100)) ?? ""
    }
    static func grosz(_ text: String) -> Int? {
        let clean = text.replacingOccurrences(of: "\u{00A0}", with: "").replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "zł", with: "").replacingOccurrences(of: ",", with: ".")
        guard let value = Double(clean), value.isFinite else { return nil }
        return Int((value * 100).rounded())
    }
}

enum DayText {
    private static var formatter: DateFormatter {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Europe/Warsaw"); f.dateFormat = "yyyy-MM-dd"; return f
    }
    static func date(_ text: String) -> Date? { text.count >= 10 ? formatter.date(from: String(text.prefix(10))) : nil }
    static func string(_ date: Date) -> String { formatter.string(from: date) }
}

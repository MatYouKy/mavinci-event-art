import SwiftUI

// MARK: Zakładka „Kwalifikacje” — 1:1 z `EmployeeQualificationsTab` i `EmployeeDrivingLicensesPanel`: certyfikaty i uprawnienia
// (wygasłe / wkrótce wygasną), umiejętności z poziomem i kategorią, prawa jazdy (jedyne źródło kategorii dla floty) i dawne wpisy.

enum QualificationEditor: Identifiable {
    case certification(EmployeeCertification?), skill(EmployeeSkillEntry?), license(DrivingLicenseEntry?, prefill: EmployeeCertification?)
    var id: String {
        switch self {
        case .certification(let c): return "c:\(c?.id ?? "new")"
        case .skill(let s): return "s:\(s?.id ?? "new")"
        case .license(let l, let p): return "l:\(l?.id ?? "new"):\(p?.id ?? "")"
        }
    }
}
struct QualificationRemoval: Identifiable {
    let id = UUID()
    let op: String
    let entryID: String
    let question: String
    let success: String
}

@MainActor struct EmployeeQualificationsView: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    let canEdit: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: EmployeeQualifications?
    @State private var error: String?
    @State private var editor: QualificationEditor?
    @State private var removal: QualificationRemoval?

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error { TeamCard(title: "Kwalifikacje") { Text(error).foregroundStyle(.secondary) } }
            else { ProgressView().frame(maxWidth: .infinity).padding(40) }
        }
        .task(id: employeeID) { await load() }
        .sheet(item: $editor) { item in
            QualificationEditorSheet(store: store, employeeID: employeeID, editor: item, data: data) { Task { await load() } }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog(removal?.question ?? "", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } }), titleVisibility: .visible) {
            if let removal {
                Button("Usuń", role: .destructive) { Task { await remove(removal) } }
                Button("Anuluj", role: .cancel) {}
            }
        }
    }

    private func load() async {
        do { data = try await store.profile("qualifications", employeeID, as: EmployeeQualifications.self); error = nil }
        catch { if data == nil { self.error = store.failureText(error, "Nie udało się pobrać kwalifikacji.") } }
    }

    private func remove(_ item: QualificationRemoval) async {
        await state.withPending("Usuwanie…") {
            do {
                try await store.profilePost(item.op, employeeID, ["id": .string(item.entryID)])
                state.succeed(item.success)
                await load()
            } catch { state.error = store.failureText(error, "Błąd podczas usuwania") }
        }
    }

    private func content(_ data: EmployeeQualifications) -> some View {
        let certificates = data.certifications.filter { !$0.driving }
        let legacy = data.certifications.filter(\.driving)
        return VStack(alignment: .leading, spacing: 16) {
            TeamCard(title: "Certyfikaty i Uprawnienia", symbol: "rosette", action: canEdit ? ("Dodaj certyfikat", { editor = .certification(nil) }) : nil) {
                if certificates.isEmpty { Text("Brak certyfikatów").foregroundStyle(.secondary) }
                ForEach(certificates) { certificateRow($0) }
            }
            TeamCard(title: "Umiejętności i Kompetencje", symbol: "book", action: canEdit ? ("Dodaj umiejętność", { editor = .skill(nil) }) : nil) {
                if data.skills.isEmpty { Text("Brak umiejętności").foregroundStyle(.secondary) }
                ForEach(data.skills) { skillRow($0) }
            }
            licenses(data, legacy: legacy)
        }
    }

    private func status(_ text: String, _ color: Color, symbol: String) -> some View {
        Label(text, systemImage: symbol).font(.caption2.weight(.medium)).padding(.horizontal, 7).padding(.vertical, 2)
            .background(color.opacity(0.18), in: Capsule()).foregroundStyle(color)
    }

    private func rowActions(edit: @escaping () -> Void, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 4) {
            Button(action: edit) { Image(systemName: "pencil") }.buttonStyle(.borderless).help("Edytuj")
            Button(role: .destructive, action: remove) { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń")
        }
    }

    private func certificateRow(_ c: EmployeeCertification) -> some View {
        let expired = DayDates.expired(c.expiry)
        let soon = !expired && DayDates.expiringMonths(c.expiry, months: 3)
        let tint: Color = expired ? CrmTheme.rgb(0xf87171) : soon ? CrmTheme.rgb(0xfb923c) : .clear
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark.seal").foregroundStyle(theme.accent)
                    Text(c.typeName).fontWeight(.medium)
                    if expired { status("Wygasło", CrmTheme.rgb(0xf87171), symbol: "exclamationmark.circle") }
                    else if soon { status("Wkrótce wygaśnie", CrmTheme.rgb(0xfb923c), symbol: "exclamationmark.circle") }
                    else if c.active { status("Aktywny", CrmTheme.rgb(0x4ade80), symbol: "checkmark.circle") }
                }
                VStack(alignment: .leading, spacing: 2) {
                    if !c.number.isEmpty { Text("Nr: \(c.number)") }
                    Text("Wydano: \(DayDates.display(c.issued))")
                    if !c.expiry.isEmpty { Text("Ważne do: \(DayDates.display(c.expiry))") }
                    if !c.authority.isEmpty { Text("Wystawca: \(c.authority)") }
                    if !c.notes.isEmpty { Text(c.notes).foregroundStyle(.tertiary) }
                }
                .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if canEdit {
                rowActions(edit: { editor = .certification(c) },
                           remove: { removal = QualificationRemoval(op: "certificationDelete", entryID: c.id, question: "Czy na pewno chcesz usunąć ten certyfikat?", success: "Certyfikat usunięty") })
            }
        }
        .padding(12)
        .background(tint == .clear ? Color.primary.opacity(0.04) : tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func skillRow(_ s: EmployeeSkillEntry) -> some View {
        let categoryColor = meetingColor(s.color) ?? theme.accent
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    Image(systemName: "book").foregroundStyle(theme.accent)
                    Text(s.name).fontWeight(.medium)
                    if !s.category.isEmpty {
                        Text(s.category).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(categoryColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(categoryColor)
                    }
                }
                HStack(spacing: 8) {
                    let color = QualificationLabels.levelColor(s.level)
                    Text(QualificationLabels.level(s.level)).font(.caption.weight(.medium)).padding(.horizontal, 7).padding(.vertical, 2)
                        .background(color.opacity(0.18), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(color)
                    if let years = s.years, years > 0 {
                        Text("\(years.formatted(.number.precision(.fractionLength(0...1)))) \(years == 1 ? "rok" : "lat") doświadczenia").font(.caption).foregroundStyle(.secondary)
                    }
                }
                if !s.notes.isEmpty { Text(s.notes).font(.callout).foregroundStyle(.secondary) }
            }
            Spacer()
            if canEdit {
                rowActions(edit: { editor = .skill(s) },
                           remove: { removal = QualificationRemoval(op: "skillDelete", entryID: s.id, question: "Czy na pewno chcesz usunąć tę umiejętność?", success: "Umiejętność usunięta") })
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func licenses(_ data: EmployeeQualifications, legacy: [EmployeeCertification]) -> some View {
        let free = data.licenseCategories.filter { category in !data.licenses.contains { $0.categoryId == category.id } }
        let review = legacy.contains { cert in
            guard cert.active else { return false }
            let code = QualificationLabels.drivingCode(cert.typeName)
            guard let current = data.licenses.first(where: { $0.code == code }) else { return true }
            return current.expiry != cert.expiry || (!cert.number.isEmpty && !current.number.isEmpty && cert.number != current.number)
        }
        TeamCard(title: "Prawa jazdy", symbol: "car", action: canEdit && !free.isEmpty ? ("Dodaj prawo jazdy", { editor = .license(nil, prefill: nil) }) : nil) {
            Text("Jedyne miejsce zapisu kategorii dla floty. Wybór kierowcy uwzględnia te wpisy, daty ważności oraz termin rezerwacji pojazdu.")
                .font(.callout).foregroundStyle(.secondary)
            if review {
                Label("W historii certyfikatów są brakujące tutaj kategorie lub inne daty ważności. Porównaj je z dokumentem. Nie nadpisujemy ani nie przedłużamy uprawnień automatycznie.", systemImage: "exclamationmark.triangle")
                    .font(.callout).foregroundStyle(CrmTheme.rgb(0xfde68a))
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0xfbbf24).opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            }
            if data.licenses.isEmpty { Text("Brak praw jazdy").foregroundStyle(.secondary) }
            ForEach(data.licenses) { licenseRow($0) }
            if !legacy.isEmpty {
                DisclosureGroup("Poprzednie wpisy z certyfikatów — historia (\(legacy.count))") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Zachowaliśmy oryginalne dane. Wpisy poniżej nie są drugim źródłem uprawnień i nie kwalifikują kierowcy do pojazdu. Kategorie edytujesz wyłącznie powyżej. Przed uzupełnieniem brakującej kategorii sprawdź daty z dokumentem.")
                            .font(.caption).foregroundStyle(.secondary)
                        ForEach(legacy) { cert in legacyRow(cert, free: free) }
                    }
                    .padding(.top, 6)
                }
            }
        }
    }

    private func licenseRow(_ l: DrivingLicenseEntry) -> some View {
        let expired = DayDates.expired(l.expiry)
        let soon = !expired && DayDates.expiring(l.expiry, days: 30)
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(l.code).font(.headline.monospaced()).padding(.horizontal, 8).padding(.vertical, 3)
                        .background(theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 6)).foregroundStyle(theme.accent)
                    Text(l.name).fontWeight(.medium)
                    if expired { status("Wygasło", CrmTheme.rgb(0xf87171), symbol: "exclamationmark.circle") }
                    else if soon { status("Wygasa wkrótce", CrmTheme.rgb(0xfb923c), symbol: "exclamationmark.circle") }
                }
                HStack(spacing: 14) {
                    if !l.obtained.isEmpty { Text("Uzyskano: \(DayDates.display(l.obtained))") }
                    if !l.expiry.isEmpty {
                        Text("Ważne do: \(DayDates.display(l.expiry))")
                            .foregroundStyle(expired ? CrmTheme.rgb(0xf87171) : soon ? CrmTheme.rgb(0xfb923c) : Color.secondary)
                    }
                    if !l.number.isEmpty { Text("Numer: \(l.number)") }
                }
                .font(.callout).foregroundStyle(.secondary)
                if !l.notes.isEmpty { Text(l.notes).font(.callout).foregroundStyle(.tertiary) }
            }
            Spacer()
            if canEdit {
                rowActions(edit: { editor = .license(l, prefill: nil) },
                           remove: { removal = QualificationRemoval(op: "licenseDelete", entryID: l.id, question: "Czy na pewno chcesz usunąć to prawo jazdy?", success: "Prawo jazdy usunięte pomyślnie") })
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func legacyRow(_ cert: EmployeeCertification, free: [LicenseCategoryOption]) -> some View {
        let code = QualificationLabels.drivingCode(cert.typeName)
        let canImport = cert.active && free.contains { $0.code == code }
        return VStack(alignment: .leading, spacing: 3) {
            Text("\(cert.typeName) · \(cert.active ? "dawny wpis" : "dawny wpis nieaktywny")").fontWeight(.medium)
            Text("Wydano: \(DayDates.display(cert.issued).nonEmpty ?? "Nie podano") · Ważne do: \(DayDates.display(cert.expiry).nonEmpty ?? "Nie podano")")
                .font(.caption).foregroundStyle(.secondary)
            if !cert.number.isEmpty { Text("Numer: \(cert.number)").font(.caption) }
            if !cert.authority.isEmpty { Text("Wystawca: \(cert.authority)").font(.caption) }
            if !cert.notes.isEmpty { Text(cert.notes).font(.caption).foregroundStyle(.secondary) }
            HStack {
                if let url = URL(string: cert.documentUrl), !cert.documentUrl.isEmpty { Link("Otwórz dokument historyczny", destination: url).font(.caption) }
                if canEdit && canImport {
                    Button("Sprawdź dane i uzupełnij kategorię") { editor = .license(nil, prefill: cert) }.controlSize(.small)
                }
            }
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }
}

/// Karta sekcji zakładek pracownika (tytuł, ikona, opcjonalny przycisk).
struct TeamCard<Content: View>: View {
    let title: String
    var symbol: String?
    var action: (String, () -> Void)?
    let content: Content
    @Environment(\.crmTheme) private var theme
    init(title: String, symbol: String? = nil, action: (String, () -> Void)? = nil, @ViewBuilder content: () -> Content) {
        self.title = title; self.symbol = symbol; self.action = action; self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol).foregroundStyle(theme.accent) }
                Text(title).font(.title3.weight(.light))
                Spacer()
                if let action { Button { action.1() } label: { Label(action.0, systemImage: "plus") }.buttonStyle(.borderedProminent).controlSize(.small) }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Formularze kwalifikacji: certyfikat, umiejętność, prawo jazdy.
@MainActor struct QualificationEditorSheet: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    let editor: QualificationEditor
    let data: EmployeeQualifications?
    let saved: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var typeID = ""
    @State private var first: Date?
    @State private var second: Date?
    @State private var number = ""
    @State private var authority = ""
    @State private var notes = ""
    @State private var active = true
    @State private var level = "basic"
    @State private var years = ""
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false

    private var editingExisting: Bool {
        switch editor {
        case .certification(let c): return c != nil
        case .skill(let s): return s != nil
        case .license(let l, _): return l != nil
        }
    }
    private var title: String {
        switch editor {
        case .certification(let c): return c == nil ? "Dodaj certyfikat" : "Edytuj certyfikat"
        case .skill(let s): return s == nil ? "Dodaj umiejętność" : "Edytuj umiejętność"
        case .license(let l, _): return l == nil ? "Dodaj prawo jazdy" : "Edytuj prawo jazdy"
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text(title).font(.title2.bold()); Spacer() }.padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form { fields }.formStyle(.grouped)
            if let problem { Text(problem).font(.callout).foregroundStyle(.red).padding(.horizontal, 20) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }.padding(16)
        }
        .frame(width: 500)
        .frame(minHeight: 420)
        .background(theme.page)
        .onAppear(perform: prepare)
    }

    @ViewBuilder private var fields: some View {
        switch editor {
        case .certification:
            Picker("Typ certyfikatu *", selection: $typeID) {
                Text("Wybierz...").tag("")
                ForEach(data?.certificationTypes ?? []) { Text($0.name).tag($0.id) }
            }
            OptionalDateField(title: "Data wydania *", date: $first)
            OptionalDateField(title: "Data wygaśnięcia", date: $second)
            TextField("Numer certyfikatu", text: $number)
            TextField("Wystawca", text: $authority)
            TextField("Notatki", text: $notes, axis: .vertical).lineLimit(2...5)
            if editingExisting { Toggle("Aktywny", isOn: $active) }
        case .skill:
            Picker("Umiejętność *", selection: $typeID) {
                Text("Wybierz...").tag("")
                ForEach(data?.skillTypes ?? []) { Text($0.category.isEmpty ? $0.name : "\($0.name) (\($0.category))").tag($0.id) }
            }
            Picker("Poziom zaawansowania *", selection: $level) { ForEach(QualificationLabels.levels) { Text($0.label).tag($0.value) } }
            TextField("Lata doświadczenia", text: $years)
            TextField("Notatki", text: $notes, prompt: Text("np. Projekty, osiągnięcia, szkolenia..."), axis: .vertical).lineLimit(2...5)
        case .license(let license, _):
            if license == nil {
                let taken = Set((data?.licenses ?? []).map(\.categoryId))
                Picker("Kategoria *", selection: $typeID) {
                    Text("Wybierz...").tag("")
                    ForEach((data?.licenseCategories ?? []).filter { !taken.contains($0.id) }) { Text("\($0.code) — \($0.name)").tag($0.id) }
                }
            } else {
                LabeledContent("Kategoria", value: "\(license?.code ?? "") — \(license?.name ?? "")")
            }
            OptionalDateField(title: "Data uzyskania", date: $first)
            OptionalDateField(title: "Ważne do", date: $second)
            TextField("Numer prawa jazdy", text: $number)
            TextField("Notatki", text: $notes, axis: .vertical).lineLimit(2...5)
        }
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        switch editor {
        case .certification(let c):
            guard let c else { first = DayDates.today; return }
            typeID = c.typeId; first = DayDates.parse(c.issued); second = DayDates.parse(c.expiry)
            number = c.number; authority = c.authority; notes = c.notes; active = c.active
        case .skill(let s):
            guard let s else { return }
            typeID = s.skillId; level = s.level; years = s.years.map { $0.formatted(.number.precision(.fractionLength(0...1))) } ?? ""; notes = s.notes
        case .license(let l, let prefill):
            if let l {
                typeID = l.categoryId; first = DayDates.parse(l.obtained); second = DayDates.parse(l.expiry); number = l.number; notes = l.notes
            } else if let prefill {
                let code = QualificationLabels.drivingCode(prefill.typeName)
                typeID = data?.licenseCategories.first { $0.code == code }?.id ?? ""
                first = DayDates.parse(prefill.issued); second = DayDates.parse(prefill.expiry); number = prefill.number; notes = prefill.notes
            }
        }
    }

    private func day(_ date: Date?) -> JSONValue { date.map { .string(DayDates.string($0)) } ?? .null }

    private func save() async {
        problem = nil
        var op = ""
        var id: String?
        var body: [String: JSONValue] = [:]
        switch editor {
        case .certification(let c):
            if typeID.isEmpty || first == nil { problem = "Wybierz typ certyfikatu i datę wydania."; return }
            op = "certification"; id = c?.id
            body = ["typeId": .string(typeID), "issued": day(first), "expiry": day(second), "number": .string(number),
                    "authority": .string(authority), "notes": .string(notes), "active": .bool(active)]
        case .skill(let s):
            if typeID.isEmpty { problem = "Wybierz umiejętność."; return }
            let value = years.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)
            if !value.isEmpty && Double(value) == nil { problem = "Lata doświadczenia muszą być liczbą."; return }
            op = "skill"; id = s?.id
            body = ["skillId": .string(typeID), "level": .string(level), "years": value.isEmpty ? .null : .number(Double(value) ?? 0), "notes": .string(notes)]
        case .license(let l, _):
            if l == nil && typeID.isEmpty { problem = "Wybierz kategorię prawa jazdy"; return }
            if let a = first, let b = second, b < a { problem = "Data ważności nie może być wcześniejsza niż data uzyskania."; return }
            op = "license"; id = l?.id
            body = ["categoryId": .string(typeID), "obtained": day(first), "expiry": day(second), "number": .string(number), "notes": .string(notes)]
        }
        saving = true
        defer { saving = false }
        do {
            var payload: [String: JSONValue] = ["data": .object(body)]
            if let id { payload["id"] = .string(id) }
            try await store.profilePost(op, employeeID, payload)
            switch editor {
            case .certification: state.succeed(id == nil ? "Certyfikat dodany" : "Certyfikat zaktualizowany")
            case .skill: state.succeed(id == nil ? "Umiejętność dodana" : "Umiejętność zaktualizowana")
            case .license: state.succeed(id == nil ? "Prawo jazdy dodane pomyślnie" : "Prawo jazdy zaktualizowane pomyślnie")
            }
            saved()
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać.")
        }
    }
}

/// Data opcjonalna: przełącznik „ustaw” + wybór dnia (pole daty bez godziny).
struct OptionalDateField: View {
    let title: String
    @Binding var date: Date?
    var body: some View {
        HStack {
            Toggle(title, isOn: Binding(get: { date != nil }, set: { on in date = on ? (date ?? DayDates.today) : nil }))
            if date != nil {
                DatePicker("", selection: Binding(get: { date ?? DayDates.today }, set: { date = $0 }), displayedComponents: .date)
                    .labelsHidden()
            }
        }
    }
}

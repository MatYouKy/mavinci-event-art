import SwiftUI
import AppKit

// MARK: Okna zespołu — zmiana hasła (`AdminResetPasswordModal`), nowy pracownik (`AddEmployeeModal` + funkcja `create-employee`),
// nowa nieobecność (`AddAbsenceModal`) i rozpatrzenie wniosku (`AbsenceRequestModal`).

/// Wymagania hasła jak w CRM.
enum PasswordRules {
    static func problem(_ password: String) -> String? {
        if password.count < 8 { return "Hasło musi mieć minimum 8 znaków" }
        if password.range(of: "[A-Z]", options: .regularExpression) == nil { return "Hasło musi zawierać co najmniej jedną wielką literę" }
        if password.range(of: "[a-z]", options: .regularExpression) == nil { return "Hasło musi zawierać co najmniej jedną małą literę" }
        if password.range(of: "[0-9]", options: .regularExpression) == nil { return "Hasło musi zawierać co najmniej jedną cyfrę" }
        return nil
    }
    /// Hasło tymczasowe jak „Generuj” w CRM (12 znaków, bez mylących liter i cyfr).
    static func generate() -> String {
        let chars = Array("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%")
        var generator = SystemRandomNumberGenerator()
        return String((0..<12).map { _ in chars.randomElement(using: &generator)! })
    }
}

/// Pole hasła z przełącznikiem „pokaż”.
struct RevealablePasswordField: View {
    let title: String
    @Binding var text: String
    @Binding var visible: Bool
    var body: some View {
        HStack(spacing: 6) {
            Group {
                if visible { TextField(title, text: $text) } else { SecureField(title, text: $text) }
            }
            .textFieldStyle(.roundedBorder)
            Button { visible.toggle() } label: { Image(systemName: visible ? "eye.slash" : "eye") }
                .buttonStyle(.borderless).help(visible ? "Ukryj hasło" : "Pokaż hasło")
        }
    }
}

@MainActor struct ResetPasswordSheet: View {
    @ObservedObject var store: TeamStore
    let member: TeamMember
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var password = ""
    @State private var confirm = ""
    @State private var showPassword = false
    @State private var showConfirm = false
    @State private var errors: [String: String] = [:]
    @State private var problem: String?
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Resetuj hasło pracownika").font(.title2.bold())
                Text("\(member.name) (\(member.email))").foregroundStyle(.secondary)
            }
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Uwaga!").fontWeight(.semibold)
                    Text("Ta akcja natychmiast zmieni hasło dla pracownika. Poinformuj go o nowym haśle przez bezpieczny kanał komunikacji.")
                }
            } icon: { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange) }
            .font(.callout)
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text("Hasło musi spełniać następujące wymagania:").font(.callout.weight(.medium))
                Text("• Minimum 8 znaków\n• Co najmniej jedna wielka litera\n• Co najmniej jedna mała litera\n• Co najmniej jedna cyfra")
                    .font(.caption).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Nowe hasło").font(.caption).foregroundStyle(.secondary)
                RevealablePasswordField(title: "Wprowadź nowe hasło", text: $password, visible: $showPassword)
                if let issue = errors["password"] { Text(issue).font(.caption).foregroundStyle(.red) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Potwierdź hasło").font(.caption).foregroundStyle(.secondary)
                RevealablePasswordField(title: "Potwierdź nowe hasło", text: $confirm, visible: $showConfirm)
                if let issue = errors["confirm"] { Text(issue).font(.caption).foregroundStyle(.red) }
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zmienianie…" : "Zmień hasło") { Task { await submit() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }
        }
        .padding(22)
        .frame(width: 460)
        .background(theme.page)
        .interactiveDismissDisabled(saving)
    }

    private func submit() async {
        var found: [String: String] = [:]
        if let issue = PasswordRules.problem(password) { found["password"] = issue }
        if password != confirm { found["confirm"] = "Hasła nie są identyczne" }
        errors = found; problem = nil
        guard found.isEmpty else { return }
        saving = true
        defer { saving = false }
        do {
            try await store.resetPassword(member, password: password)
            password = ""; confirm = ""
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas resetowania hasła")
        }
    }
}

@MainActor struct AddEmployeeSheet: View {
    @ObservedObject var store: TeamStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var surname = ""
    @State private var nickname = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var occupation = ""
    @State private var accessLevelID = ""
    @State private var allCompanies = false
    @State private var companies: Set<String> = []
    @State private var levels: [TeamOption] = []
    @State private var companyOptions: [TeamOption] = []
    @State private var problem: String?
    @State private var saving = false
    @State private var created: (email: String, password: String)?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(created == nil ? "Dodaj nowego pracownika" : "✅ Pracownik utworzony").font(.title2.bold())
                Spacer()
            }.padding([.horizontal, .top], 20).padding(.bottom, 6)
            if let created { credentials(created) } else { form }
        }
        .frame(minWidth: 540, idealWidth: 580, minHeight: 560, idealHeight: 680)
        .background(theme.page)
        .overlay { if saving { PendingOverlay(text: "Tworzenie pracownika…") } }
        .interactiveDismissDisabled(saving)
        .task {
            do {
                let options = try await store.createOptions()
                levels = options.levels; companyOptions = options.companies
            }
            catch { problem = store.failureText(error, "Nie udało się pobrać ról i marek.") }
        }
    }

    private var form: some View {
        VStack(spacing: 0) {
            Form {
                Section {
                    TextField("Imię *", text: $name)
                    TextField("Nazwisko *", text: $surname)
                    TextField("Pseudonim / Nick", text: $nickname)
                    TextField("Email *", text: $email)
                    TextField("Telefon", text: $phone)
                    HStack {
                        RevealablePasswordField(title: "Hasło *", text: $password, visible: $showPassword)
                        Button("Generuj") { password = PasswordRules.generate(); showPassword = true }
                    }
                    TextField("Stanowisko", text: $occupation, prompt: Text("np. Kierownik projektu, Technik audio"))
                }
                Section("Rola firmowa") {
                    Picker("Rola firmowa *", selection: $accessLevelID) {
                        Text("Wybierz rolę firmową").tag("")
                        ForEach(levels) { Text($0.name).tag($0.id) }
                    }
                    if let level = levels.first(where: { $0.id == accessLevelID }), let description = level.description, !description.isEmpty {
                        Text(description).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section("Dostęp do marek") {
                    Picker("Dostęp do marek", selection: $allCompanies) {
                        Text("Wszystkie marki").tag(true)
                        Text("Wybrane marki").tag(false)
                    }.pickerStyle(.segmented).labelsHidden()
                    if !allCompanies {
                        ForEach(companyOptions) { company in
                            Toggle(company.name, isOn: Binding(get: { companies.contains(company.id) }, set: { on in
                                if on { companies.insert(company.id) } else { companies.remove(company.id) }
                            }))
                        }
                    }
                }
                if let problem {
                    Section { Label(problem, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.red).textSelection(.enabled) }
                }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Dodaj pracownika") { Task { await submit() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }.padding(16)
        }
    }

    private func credentials(_ data: (email: String, password: String)) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Zapisz dane logowania i przekaż pracownikowi. Hasło można zmienić po pierwszym logowaniu.").foregroundStyle(.secondary)
            copyRow("Email", data.email)
            copyRow("Hasło tymczasowe", data.password)
            Button("Kopiuj email i hasło", systemImage: "doc.on.doc") { copy("Email: \(data.email)\nHasło: \(data.password)") }
            Spacer()
            HStack { Spacer(); Button("Gotowe") { dismiss() }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent) }
        }
        .padding(20)
    }

    private func copyRow(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(theme.accent)
            HStack {
                Text(value).font(.body.monospaced()).textSelection(.enabled)
                Spacer()
                Button { copy(value) } label: { Image(systemName: "doc.on.doc") }.buttonStyle(.borderless).help("Kopiuj")
            }
        }
        .padding(10)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 8))
    }

    private func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        store.workspace?.succeed("Skopiowano do schowka")
    }

    private func submit() async {
        problem = nil
        let trimmed = (name: name.trimmingCharacters(in: .whitespaces), surname: surname.trimmingCharacters(in: .whitespaces),
                       email: email.trimmingCharacters(in: .whitespaces), password: password.trimmingCharacters(in: .whitespaces))
        if trimmed.name.isEmpty || trimmed.surname.isEmpty || trimmed.email.isEmpty || trimmed.password.isEmpty { problem = "Wypełnij wszystkie wymagane pola"; return }
        if accessLevelID.isEmpty { problem = "Wybierz rolę firmową"; return }
        if !allCompanies && companies.isEmpty { problem = "Wybierz przynajmniej jedną markę albo dostęp do wszystkich marek"; return }
        saving = true
        defer { saving = false }
        do {
            try await store.create([
                "email": .string(trimmed.email), "password": .string(trimmed.password), "name": .string(trimmed.name),
                "surname": .string(trimmed.surname), "nickname": .string(nickname), "phone_number": .string(phone),
                "access_level_id": .string(accessLevelID), "company_access_mode": .string(allCompanies ? "all" : "selected"),
                "my_company_ids": .array(companies.sorted().map { .string($0) }), "occupation": .string(occupation),
            ])
            created = (trimmed.email, trimmed.password)
        } catch {
            problem = store.failureText(error, "Nie udało się utworzyć pracownika")
        }
    }
}

@MainActor struct AddAbsenceSheet: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var type = "vacation"
    @State private var start = MeetingDates.calendar.startOfDay(for: Date())
    @State private var end = MeetingDates.calendar.startOfDay(for: Date()).addingTimeInterval(86_400 - 60)
    @State private var allDay = true
    @State private var notes = ""
    @State private var problem: String?
    @State private var saving = false

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Dodaj nieobecność").font(.title2.bold()); Spacer() }.padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Picker("Typ nieobecności", selection: $type) { ForEach(TeamLabels.absenceTypes) { Text($0.label).tag($0.value) } }
                DatePicker("Data rozpoczęcia", selection: $start)
                DatePicker("Data zakończenia", selection: $end, in: start...)
                Toggle("Cały dzień", isOn: $allDay)
                Section("Notatki (opcjonalnie)") { TextEditor(text: $notes).frame(minHeight: 70) }
                if let problem { Section { Text(problem).foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Złóż wniosek") { Task { await submit() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }.padding(16)
        }
        .frame(width: 480, height: 470)
        .background(theme.page)
        .onChange(of: start) { _, value in if end < value { end = value } }
    }

    private func submit() async {
        saving = true
        defer { saving = false }
        do {
            try await store.addAbsence(employeeId: employeeID, type: type, start: start, end: end, allDay: allDay, notes: notes)
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas zapisywania")
        }
    }
}

@MainActor struct AbsenceReviewSheet: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    let absence: EmployeeAbsence
    let canApprove: Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var note = ""
    @State private var reason = ""
    @State private var processing: Bool?
    @State private var problem: String?

    var body: some View {
        let status = TeamLabels.absenceStatus(absence.status)
        let pending = absence.status == "pending"
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Wniosek o nieobecność").font(.title2.bold())
                Text(pending ? "Oczekuje na zatwierdzenie" : "Szczegóły nieobecności").foregroundStyle(.secondary)
            }
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                GridRow { Text("Pracownik").foregroundStyle(.secondary); Text(store.member(employeeID)?.fullName ?? "") }
                GridRow { Text("Typ").foregroundStyle(.secondary); Text(TeamLabels.absenceType(absence.type)) }
                GridRow { Text("Od").foregroundStyle(.secondary); Text(absence.startDate.map { MeetingDates.format($0, absence.allDay ? "d MMMM yyyy" : "d MMMM yyyy, HH:mm") } ?? "") }
                GridRow { Text("Do").foregroundStyle(.secondary); Text(absence.endDate.map { MeetingDates.format($0, absence.allDay ? "d MMMM yyyy" : "d MMMM yyyy, HH:mm") } ?? "") }
                GridRow { Text("Czas trwania").foregroundStyle(.secondary); Text("\(absence.days) \(absence.days == 1 ? "dzień" : "dni")") }
                GridRow { Text("Status").foregroundStyle(.secondary); Text(status.label).foregroundStyle(status.color) }
                if !absence.notes.isEmpty { GridRow { Text("Notatki").foregroundStyle(.secondary); Text(absence.notes) } }
            }
            if canApprove && pending {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Notatka do zatwierdzenia (opcjonalnie)").font(.caption).foregroundStyle(.secondary)
                    TextField("Dodaj notatkę...", text: $note, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Powód odrzucenia (opcjonalnie)").font(.caption).foregroundStyle(.secondary)
                    TextField("Opcjonalnie podaj powód odrzucenia...", text: $reason, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
                }
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                if canApprove && pending {
                    Button(processing == false ? "Odrzucanie…" : "Odrzuć", role: .destructive) { Task { await decide(false) } }.disabled(processing != nil)
                    Button(processing == true ? "Zatwierdzanie…" : "Zatwierdź") { Task { await decide(true) } }
                        .buttonStyle(.borderedProminent).tint(CrmTheme.rgb(0x16a34a)).disabled(processing != nil)
                } else {
                    Button("Zamknij") { dismiss() }.keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(22)
        .frame(width: 480)
        .background(theme.page)
    }

    private func decide(_ approve: Bool) async {
        processing = approve
        defer { processing = nil }
        do {
            try await store.decideAbsence(absence, employeeId: employeeID, approve: approve, note: approve ? note : reason)
            dismiss()
        } catch {
            problem = store.failureText(error, approve ? "Błąd podczas zatwierdzania" : "Błąd podczas odrzucania")
        }
    }
}

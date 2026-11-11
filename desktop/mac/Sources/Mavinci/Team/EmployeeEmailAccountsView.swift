import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Zakładka „Konta Email” — 1:1 z `EmployeeEmailAccountsTab`: email osobisty i preferencja powiadomień, miniatura do stopki,
// konto osobiste (IMAP/SMTP; hasła nie wracają do aplikacji — puste pole = bez zmiany), dostęp do kont wspólnych i systemowych,
// formularz kontaktowy. Tylko administrator.

@MainActor struct EmployeeEmailAccountsView: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: EmployeeEmailData?
    @State private var error: String?
    @State private var managing = false
    @State private var editingPersonalEmail = false
    @State private var personalEmail = ""
    @State private var preference = "work"
    @State private var pendingThumb: Data?
    @State private var pendingPreview: NSImage?
    @State private var importing = false
    @State private var dropTargeted = false
    @State private var removingThumb = false
    @State private var editingAccount: EmployeeMailAccount??
    @State private var busy: Set<String> = []

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error { TeamCard(title: "Konta Email") { Text(error).foregroundStyle(.secondary) } }
            else { ProgressView().frame(maxWidth: .infinity).padding(40) }
        }
        .task(id: employeeID) { await load() }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            if case .success(let url) = result { stage(url) }
        }
        .sheet(item: Binding(get: { editingAccount.map { PersonalAccountRequest(account: $0) } }, set: { if $0 == nil { editingAccount = nil } })) { request in
            PersonalAccountSheet(store: store, employeeID: employeeID, account: request.account) { Task { await load() } }
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć miniaturkę do stopki email?", isPresented: $removingThumb, titleVisibility: .visible) {
            Button("Usuń", role: .destructive) { Task { await post("signatureRemove", [:], success: "Miniaturka usunięta") } }
            Button("Anuluj", role: .cancel) {}
        }
    }

    private func load() async {
        do {
            let next = try await store.profile("emails", employeeID, as: EmployeeEmailData.self)
            data = next; error = nil
            if !editingPersonalEmail { personalEmail = next.personalEmail; preference = next.notificationPreference }
        } catch { if data == nil { self.error = store.failureText(error, "Nie udało się pobrać kont email.") } }
    }

    private func post(_ op: String, _ body: [String: JSONValue], success: String) async {
        await state.withPending("Zapisywanie…") {
            do {
                try await store.profilePost(op, employeeID, body)
                state.succeed(success)
                await load()
            } catch { state.error = store.failureText(error, "Nie udało się zapisać zmian.") }
        }
    }

    private func content(_ data: EmployeeEmailData) -> some View {
        let personal = data.accounts.filter { $0.type == "personal" && $0.employeeId == employeeID }
        let shared = data.accounts.filter { $0.type == "shared" }
        let system = data.accounts.filter { $0.type == "system" }
        let assigned = Set(data.assignments.map(\.accountId))
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Konta Email").font(.title3.weight(.light))
                    Text(managing ? "Zaznacz/odznacz przy kontach wspólnych i systemowych — zmiany są zapisywane automatycznie"
                         : "Lista kont email dostępnych dla pracownika. Admin może zarządzać dostępem do kont wspólnych i systemowych.")
                        .font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                if managing {
                    Button("Gotowe") { managing = false }
                    Button { state.openCRM("/crm/settings/email-accounts") } label: { Label("Dodaj konta", systemImage: "plus") }
                } else {
                    Button { managing = true } label: { Label("Zarządzaj dostępem", systemImage: "pencil") }.buttonStyle(.borderedProminent)
                }
            }
            personalEmailCard(data)
            thumbnailCard(data)
            TeamCard(title: "Konta osobiste", symbol: "envelope", action: (personal.isEmpty ? "Dodaj konto" : "Edytuj", { editingAccount = .some(personal.first) })) {
                Text("Konta przypisane bezpośrednio do tego pracownika").font(.callout).foregroundStyle(.secondary)
                if personal.isEmpty { Text("Brak kont osobistych").foregroundStyle(.secondary) }
                ForEach(personal) { accountRow($0, assigned: true, toggleable: false) }
            }
            TeamCard(title: "Konta wspólne (działowe)", symbol: "envelope") {
                Text("Konta współdzielone przez zespół. Admin może przypisywać dostęp.").font(.callout).foregroundStyle(.secondary)
                if shared.isEmpty { Text("Brak kont wspólnych").foregroundStyle(.secondary) }
                ForEach(shared) { accountRow($0, assigned: assigned.contains($0.id), toggleable: true) }
            }
            TeamCard(title: "Konta systemowe", symbol: "envelope") {
                Text("Konta używane przez system (powiadomienia, formularze). Admin może przypisywać dostęp.").font(.callout).foregroundStyle(.secondary)
                if system.isEmpty { Text("Brak kont systemowych").foregroundStyle(.secondary) }
                ForEach(system) { accountRow($0, assigned: assigned.contains($0.id), toggleable: true) }
            }
            TeamCard(title: "Formularz kontaktowy", symbol: "checkmark.square") {
                Text("Dostęp do wiadomości z formularza kontaktowego na stronie. Niezależny od kont email.").font(.callout).foregroundStyle(.secondary)
                Toggle(isOn: Binding(get: { data.canReceiveContactForms }, set: { value in
                    Task { await post("contactForms", ["enabled": .bool(value)], success: "Dostęp do formularza kontaktowego został zaktualizowany.") }
                })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Dostęp do formularza kontaktowego")
                        Text(data.canReceiveContactForms ? "Pracownik widzi wiadomości z formularza" : "Pracownik nie ma dostępu do formularza")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.switch).disabled(!managing)
                .help(managing ? (data.canReceiveContactForms ? "Odbierz dostęp" : "Nadaj dostęp") : "Włącz tryb „Zarządzaj dostępem”")
            }
            howItWorks
        }
    }

    // MARK: Email osobisty
    private func personalEmailCard(_ data: EmployeeEmailData) -> some View {
        TeamCard(title: "Email osobisty pracownika", symbol: "envelope") {
            Text("Email prywatny pracownika używany do powiadomień poza systemem. Tylko admin może edytować.").font(.callout).foregroundStyle(.secondary)
            if editingPersonalEmail {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Email osobisty", text: $personalEmail, prompt: Text("np. jan.kowalski@gmail.com")).textFieldStyle(.roundedBorder)
                    Picker("Preferencja powiadomień email", selection: $preference) {
                        Text("Tylko służbowy (\(data.workEmail))").tag("work")
                        Text("Tylko osobisty").tag("personal")
                        Text("Oba (służbowy + osobisty)").tag("both")
                        Text("Brak emaili (tylko powiadomienia w systemie)").tag("none")
                    }
                    Text("Wybierz na jaki adres wysyłać powiadomienia o wydarzeniach i zadaniach").font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Button("Anuluj") { editingPersonalEmail = false; personalEmail = data.personalEmail; preference = data.notificationPreference }
                        Button("Zapisz") {
                            Task {
                                await post("personalEmail", ["email": .string(personalEmail), "preference": .string(preference)], success: "Email osobisty został zaktualizowany.")
                                editingPersonalEmail = false
                            }
                        }.buttonStyle(.borderedProminent)
                    }
                }
            } else {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(data.personalEmail.isEmpty ? "Nie ustawiono" : data.personalEmail).foregroundStyle(data.personalEmail.isEmpty ? Color.secondary : Color.primary)
                        Text("Preferencja powiadomień: \(preferenceLabel(data.notificationPreference))").font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { editingPersonalEmail = true } label: { Label("Edytuj", systemImage: "pencil") }
                }
            }
        }
    }
    private func preferenceLabel(_ value: String) -> String {
        switch value { case "personal": return "Tylko osobisty"; case "both": return "Oba (służbowy + osobisty)"; case "none": return "Brak emaili"; default: return "Tylko służbowy" }
    }

    // MARK: Miniatura do stopki
    private func thumbnailCard(_ data: EmployeeEmailData) -> some View {
        TeamCard(title: "Miniatura do stopki email", symbol: "photo") {
            Text("Dedykowane zdjęcie używane w stopkach wszystkich emaili. Niezależne od głównego avatara - dzięki temu można je zoptymalizować pod kątem wyświetlania w mailach.")
                .font(.callout).foregroundStyle(.secondary)
            HStack(alignment: .top, spacing: 16) {
                if let preview = pendingPreview {
                    VStack(spacing: 4) {
                        Text("Podgląd (niezapisana)").font(.caption).foregroundStyle(.secondary)
                        Image(nsImage: preview).resizable().aspectRatio(contentMode: .fill).frame(width: 110, height: 110).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                } else if let url = data.signatureThumb, !url.isEmpty {
                    VStack(spacing: 4) {
                        Text("Aktualna miniaturka").font(.caption).foregroundStyle(.secondary)
                        CachedRemoteImage(url: url, crop: nil).frame(width: 110, height: 110).clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
                VStack(spacing: 8) {
                    VStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.up").font(.title2).foregroundStyle(theme.accent)
                        Text("Kliknij lub przeciągnij i upuść").font(.callout)
                        Text("PNG, JPG lub WebP (max 2MB)").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, minHeight: 110)
                    .background(dropTargeted ? theme.accent.opacity(0.14) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
                    .contentShape(Rectangle())
                    .onTapGesture { importing = true }
                    .onDrop(of: [.fileURL], isTargeted: $dropTargeted) { providers in
                        guard let provider = providers.first else { return false }
                        _ = provider.loadObject(ofClass: URL.self) { url, _ in
                            if let url { Task { @MainActor in stage(url) } }
                        }
                        return true
                    }
                    HStack {
                        if pendingThumb != nil {
                            Button("Anuluj") { pendingThumb = nil; pendingPreview = nil }
                            Button { Task { await saveThumb() } } label: { Label("Zapisz miniaturkę", systemImage: "checkmark") }.buttonStyle(.borderedProminent)
                        } else if data.signatureThumb?.isEmpty == false {
                            Button(role: .destructive) { removingThumb = true } label: { Label("Usuń miniaturkę", systemImage: "trash") }
                        }
                    }
                }
            }
        }
    }

    private func stage(_ url: URL) {
        guard let jpeg = ImageJPEG.from(url) else { state.error = "Plik musi być obrazem"; return }
        pendingThumb = jpeg
        pendingPreview = NSImage(data: jpeg)
    }
    private func saveThumb() async {
        guard let jpeg = pendingThumb else { return }
        await state.withPending("Zapisywanie miniaturki…") {
            do {
                try await store.uploadSignature(jpeg, employeeID: employeeID)
                pendingThumb = nil; pendingPreview = nil
                state.succeed("Miniaturka do stopki została zapisana.")
                await load()
            } catch { state.error = store.failureText(error, "Błąd podczas wgrywania zdjęcia") }
        }
    }

    // MARK: Konta
    private func accountRow(_ account: EmployeeMailAccount, assigned: Bool, toggleable: Bool) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(account.name).fontWeight(.medium)
                    Text(account.typeLabel).font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(account.typeColor.opacity(0.18), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(account.typeColor)
                    if assigned && !managing {
                        Text("Przypisane").font(.caption2).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 4)).foregroundStyle(theme.accent)
                    }
                }
                Label(account.email, systemImage: "envelope").font(.callout).foregroundStyle(.secondary)
                if !account.department.isEmpty { Text("Dział: \(account.department)").font(.caption).foregroundStyle(.secondary) }
                if !account.description.isEmpty { Text(account.description).font(.caption).foregroundStyle(.tertiary) }
            }
            Spacer()
            if managing && toggleable {
                if busy.contains(account.id) { ProgressView().controlSize(.small) }
                Toggle("", isOn: Binding(get: { assigned }, set: { value in Task { await toggle(account, value) } }))
                    .toggleStyle(.checkbox).labelsHidden().disabled(busy.contains(account.id))
            }
        }
        .padding(12)
        .background(assigned ? theme.accent.opacity(0.07) : Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func toggle(_ account: EmployeeMailAccount, _ assign: Bool) async {
        busy.insert(account.id)
        defer { busy.remove(account.id) }
        do {
            try await store.profilePost("emailAssignment", employeeID, ["accountId": .string(account.id), "assign": .bool(assign)])
            state.succeed(assign ? "Konto zostało przypisane." : "Dostęp do konta został odebrany.")
            await load()
        } catch { state.error = store.failureText(error, "Błąd podczas zarządzania przypisaniem") }
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Jak to działa?").font(.headline)
            Group {
                Text("• **Email osobisty:** Admin ustawia prywatny email pracownika i wybiera gdzie wysyłać powiadomienia (służbowy/osobisty/oba/brak)")
                Text("• **Konta osobiste:** Przypisane automatycznie do właściciela, nie można ich odebrać")
                Text("• **Konta wspólne i systemowe:** Admin przypisuje dostęp ręcznie — kliknij „Zarządzaj dostępem” i zaznacz pole przy koncie")
                Text("• **Formularz kontaktowy:** Niezależna opcja kontrolująca dostęp do wiadomości z formularza na stronie")
                Text("• **Efekt w Wiadomościach:** Pracownik widzi tylko wiadomości z kont, do których ma dostęp")
                Text("• **Zarządzanie kontami:** Edycja/usuwanie/dodawanie kont w ustawieniach CRM (tylko admin)")
            }
            .font(.callout).foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(CrmTheme.rgb(0x60a5fa).opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
}

struct PersonalAccountRequest: Identifiable {
    let account: EmployeeMailAccount?
    var id: String { account?.id ?? "new" }
}

/// Konto osobiste pracownika — pola jak w CRM; hasła tylko do wpisania (puste przy edycji = bez zmiany).
@MainActor struct PersonalAccountSheet: View {
    @ObservedObject var store: TeamStore
    let employeeID: String
    let account: EmployeeMailAccount?
    let saved: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name = ""
    @State private var fromName = ""
    @State private var email = ""
    @State private var description = ""
    @State private var imapHost = ""
    @State private var imapPort = 993
    @State private var imapUser = ""
    @State private var imapPassword = ""
    @State private var imapSSL = true
    @State private var smtpHost = ""
    @State private var smtpPort = 587
    @State private var smtpUser = ""
    @State private var smtpPassword = ""
    @State private var smtpTLS = true
    @State private var showPasswords = false
    @State private var problem: String?
    @State private var saving = false
    @State private var prepared = false

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text(account == nil ? "Dodaj konto osobiste" : "Edytuj konto osobiste").font(.title2.bold()); Spacer() }
                .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section("Podstawowe informacje") {
                    TextField("Nazwa konta *", text: $name, prompt: Text("np. Boston, Jan Kowalski"))
                    TextField("Nazwa nadawcy", text: $fromName, prompt: Text("np. Jan Kowalski"))
                    TextField("Adres email *", text: $email, prompt: Text("np. boston@mavinci.pl"))
                    TextField("Opis", text: $description, prompt: Text("Opcjonalny opis konta"))
                }
                Section("Konfiguracja IMAP (odbieranie)") {
                    TextField("Serwer IMAP", text: $imapHost, prompt: Text("imap.gmail.com"))
                    TextField("Port", value: $imapPort, format: .number.grouping(.never))
                    TextField("Nazwa użytkownika", text: $imapUser, prompt: Text("Zazwyczaj adres email"))
                    passwordField("Hasło IMAP", text: $imapPassword)
                    Toggle("Użyj SSL", isOn: $imapSSL)
                }
                Section("Konfiguracja SMTP (wysyłanie)") {
                    TextField("Serwer SMTP", text: $smtpHost, prompt: Text("smtp.gmail.com"))
                    TextField("Port", value: $smtpPort, format: .number.grouping(.never))
                    TextField("Nazwa użytkownika", text: $smtpUser, prompt: Text("Zazwyczaj adres email"))
                    passwordField("Hasło SMTP", text: $smtpPassword)
                    Toggle("Użyj TLS", isOn: $smtpTLS)
                }
                Section {
                    Toggle("Pokaż wpisywane hasła", isOn: $showPasswords)
                    if account != nil { Text("Zapisanych haseł nie pokazujemy. Zostaw pole puste, aby nie zmieniać hasła.").font(.caption).foregroundStyle(.secondary) }
                }
                if let problem { Section { Text(problem).foregroundStyle(.red) } }
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving)
            }.padding(16)
        }
        .frame(width: 560, height: 680)
        .background(theme.page)
        .onAppear {
            guard !prepared, let account else { prepared = true; return }
            prepared = true
            name = account.name; fromName = account.fromName; email = account.email; description = account.description
            imapHost = account.imapHost; imapPort = account.imapPort; imapUser = account.imapUsername; imapSSL = account.imapSsl
            smtpHost = account.smtpHost; smtpPort = account.smtpPort; smtpUser = account.smtpUsername; smtpTLS = account.smtpTls
        }
    }

    @ViewBuilder private func passwordField(_ title: String, text: Binding<String>) -> some View {
        let prompt = account == nil ? Text("Hasło") : Text("Bez zmiany")
        if showPasswords { TextField(title, text: text, prompt: prompt) } else { SecureField(title, text: text, prompt: prompt) }
    }

    private func save() async {
        if name.trimmingCharacters(in: .whitespaces).isEmpty || email.trimmingCharacters(in: .whitespaces).isEmpty {
            problem = "Nazwa konta i adres email są wymagane"; return
        }
        saving = true
        defer { saving = false }
        do {
            try await store.profilePost("personalAccount", employeeID, ["data": .object([
                "name": .string(name), "fromName": .string(fromName), "email": .string(email), "description": .string(description),
                "imapHost": .string(imapHost), "imapPort": .number(Double(imapPort)), "imapUsername": .string(imapUser), "imapPassword": .string(imapPassword),
                "imapSsl": .bool(imapSSL), "smtpHost": .string(smtpHost), "smtpPort": .number(Double(smtpPort)), "smtpUsername": .string(smtpUser),
                "smtpPassword": .string(smtpPassword), "smtpTls": .bool(smtpTLS),
            ])])
            imapPassword = ""; smtpPassword = ""
            state.succeed(account == nil ? "Konto osobiste zostało utworzone." : "Konto osobiste zostało zaktualizowane.")
            saved()
            dismiss()
        } catch {
            problem = store.failureText(error, "Błąd podczas zapisywania konta")
        }
    }
}

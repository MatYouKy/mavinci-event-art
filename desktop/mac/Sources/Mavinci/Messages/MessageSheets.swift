import SwiftUI
import AppKit

/// Nowa wiadomość, odpowiedź i przekazanie — pola, stopka skrzynki, cytat i planowanie jak w `ComposeEmailModal`.
@MainActor struct ComposeSheet: View {
    @ObservedObject var store: MessagesStore
    @State var draft: ComposeDraft
    @Environment(\.dismiss) private var dismiss
    @State private var attachments: [AttachmentFile] = []
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var replyAll = false
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?

    nonisolated static var defaultSchedule: Date {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = MailDates.zone
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: Date()) ?? Date()
        return calendar.date(bySettingHour: 7, minute: 30, second: 0, of: tomorrow) ?? tomorrow
    }
    private var accounts: [MailAccount] { store.info?.sendingAccounts ?? [] }
    private func label(_ account: MailAccount) -> String {
        let name = account.display_name ?? account.account_name ?? ""
        return "\(name.isEmpty ? "" : "\(name) — ")\(account.email_address)\(account.account_type == "shared" ? " (wspólna)" : "")"
    }
    /// „Odpowiedz wszystkim”: adresaci i DW oryginału bez własnej skrzynki, nadawcy i adresów już wpisanych w „Do”.
    private var replyAllCc: String {
        guard let reply = draft.reply else { return "" }
        let own = accounts.first { $0.id == draft.accountId }?.email_address ?? ""
        let excluded = Set(emailAddresses(draft.to) + emailAddresses(own) + emailAddresses(reply.item.from))
        return (emailAddresses(reply.item.to) + emailAddresses(reply.cc)).filter { !excluded.contains($0) }
            .reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }.joined(separator: ", ")
    }
    private var totalSize: Int { attachments.reduce(0) { $0 + $1.size } }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(draft.title).font(.title2.bold())
                Spacer()
                if draft.reply != nil && !replyAllCc.isEmpty {
                    Picker("", selection: $replyAll) { Text("Odpowiedz").tag(false); Text("Odpowiedz wszystkim").tag(true) }
                        .pickerStyle(.segmented).labelsHidden().fixedSize()
                        .onChange(of: replyAll) { _, all in draft.cc = all ? replyAllCc : "" }
                }
            }.padding([.horizontal, .top], 20).padding(.bottom, 8)
            Form {
                Section {
                    if accounts.isEmpty {
                        Text("Nie masz skrzynki, z której możesz wysyłać wiadomości.").foregroundStyle(.secondary)
                    } else {
                        Picker("Od:", selection: $draft.accountId) { ForEach(accounts) { Text(label($0)).tag($0.id) } }
                    }
                    TextField("Do:", text: $draft.to, prompt: Text("email@example.com"))
                    TextField("DW:", text: $draft.cc, prompt: Text("Opcjonalnie"))
                    TextField("UDW:", text: $draft.bcc, prompt: Text("Opcjonalnie"))
                    TextField("Temat:", text: $draft.subject, prompt: Text("Temat wiadomości"))
                }
                Section("Wiadomość:") {
                    TextEditor(text: $draft.text).font(.body).frame(minHeight: 200)
                    Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
                }
                if let reply = draft.reply {
                    Section("Cytowana wiadomość") {
                        Text("Dnia \(MailDates.longText(reply.item.date)), użytkownik \(reply.item.from) napisał:").font(.caption).foregroundStyle(.secondary)
                        Text(reply.body).font(.caption).foregroundStyle(.secondary).lineLimit(8).textSelection(.enabled)
                    }
                }
                Section("Załączniki:") {
                    ForEach(attachments) { file in
                        HStack {
                            Image(systemName: "doc")
                            Text(file.name).lineLimit(1)
                            Text(file.sizeLabel).foregroundStyle(.secondary).monospacedDigit()
                            Spacer()
                            Button { attachments.removeAll { $0.id == file.id } } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń załącznik")
                        }
                    }
                    Button { pickFiles() } label: { Label("Dodaj pliki…", systemImage: "paperclip") }
                    if totalSize > 25 * 1024 * 1024 {
                        Label("Łączny rozmiar załączników przekracza 25 MB — serwer pocztowy może odrzucić wiadomość.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.caption)
                    }
                }
                Section("Wysyłka") {
                    Picker("Wysyłka", selection: $scheduled) { Text("Wyślij teraz").tag(false); Text("Zaplanuj wysyłkę").tag(true) }.pickerStyle(.segmented).labelsHidden()
                    if scheduled { DatePicker("Termin wysyłki", selection: $scheduledAt, in: Date()...) }
                }
            }
            .formStyle(.grouped)
            HStack {
                Button { Task { await showPreview() } } label: {
                    if previewLoading { ProgressView().controlSize(.small) } else { Label("Podgląd", systemImage: "eye") }
                }.disabled(previewLoading || draft.accountId.isEmpty)
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction).disabled(sending)
                Button { Task { await send() } } label: {
                    if sending { Text(scheduled ? "Planowanie..." : "Wysyłanie...") } else { Label(scheduled ? "Zaplanuj wysyłkę" : "Wyślij", systemImage: "paperplane") }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(sending || accounts.isEmpty)
            }.padding(16).crmBar()
        }
        .frame(minWidth: 720, idealWidth: 760, minHeight: 640, idealHeight: 760)
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }.frame(width: 760, height: 720)
        }
        .alert("Nie wysłano wiadomości", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Wysyłanie wiadomości…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true; panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.prompt = "Dodaj"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            attachments.append(AttachmentFile(url: url, size: size))
        }
    }
    private func showPreview() async {
        previewLoading = true; defer { previewLoading = false }
        do { previewHTML = try await store.preview(draft) }
        catch { problem = store.failureText(error, "Nie udało się przygotować podglądu.") }
    }
    private func send() async {
        let to = draft.to.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !to.isEmpty, !draft.subject.trimmingCharacters(in: .whitespaces).isEmpty,
              !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { problem = "Wypełnij wszystkie pola"; return }
        guard accounts.contains(where: { $0.id == draft.accountId }) else { problem = "Wybierz konto, z którego chcesz wysłać wiadomość"; return }
        if scheduled && scheduledAt.timeIntervalSinceNow < 30 { problem = "Termin wysyłki musi przypadać w przyszłości"; return }
        sending = true; defer { sending = false }
        do {
            let notice = try await store.send(draft, attachments: attachments, scheduledAt: scheduled ? scheduledAt : nil)
            store.workspace?.succeed(notice)
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się wysłać wiadomości")
        }
    }
}

/// „Przypisz wiadomość” — pracownicy z dostępem do wiadomości (`AssignMessageModal`).
@MainActor struct AssignMessageSheet: View {
    @ObservedObject var store: MessagesStore
    let message: MessageItem
    @Environment(\.dismiss) private var dismiss
    @State private var employees: [MailEmployee] = []
    @State private var loading = true
    @State private var selected: String?
    @State private var saving = false
    @State private var problem: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Przypisz wiadomość").font(.title2.bold())
            if loading { ProgressView("Ładowanie...").frame(maxWidth: .infinity, minHeight: 240) }
            else {
                List(employees, selection: $selected) { employee in
                    HStack {
                        Image(systemName: "person.crop.circle").foregroundStyle(.secondary)
                        VStack(alignment: .leading) { Text(employee.full); if let email = employee.email { Text(email).font(.caption).foregroundStyle(.secondary) } }
                        Spacer()
                        if employee.id == message.assigned_to { Text("Obecnie").font(.caption).foregroundStyle(.secondary) }
                    }.tag(employee.id)
                }.frame(minHeight: 280)
            }
            if let problem { Text(problem).foregroundStyle(.orange).font(.callout) }
            HStack {
                if message.assigned_to != nil {
                    Button("Usuń przypisanie", role: .destructive) { Task { await save(nil) } }.disabled(saving)
                }
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(saving ? "Zapisywanie..." : "Przypisz") { Task { await save(selected) } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || selected == nil)
            }
        }
        .padding(20).frame(width: 460)
        .overlay { if saving { PendingOverlay(text: "Zapisywanie przypisania…") } }
        .task {
            selected = message.assigned_to
            employees = await store.employees(assignable: true); loading = false
            if employees.isEmpty { problem = "Błąd podczas ładowania pracowników" }
        }
    }
    private func save(_ assignee: String?) async {
        saving = true; defer { saving = false }
        do {
            let reply = try await store.perform([
                "op": .string("assign"), "id": .string(message.id), "type": .string(message.type),
                "assignee": assignee.map { .string($0) } ?? .null, "current": message.assigned_to.map { .string($0) } ?? .null,
            ])
            store.workspace?.succeed(reply["message"]?.text.nonEmpty ?? "Wiadomość została przypisana")
            await store.reloadAfterChange(message)
            dismiss()
        } catch { problem = store.failureText(error, "Błąd przypisywania wiadomości") }
    }
}

/// Zapytanie z wiadomości: nowe (z opiekunem i liczbą osób) albo dołączenie konwersacji do istniejącego (`CreateInquiryFromMessageModal`).
@MainActor struct InquiryFromMessageSheet: View {
    @ObservedObject var store: MessagesStore
    let message: MessageItem
    @Environment(\.dismiss) private var dismiss
    @State private var linkMode = false
    @State private var employees: [MailEmployee] = []
    @State private var owner: String?
    @State private var guests = ""
    @State private var query = ""
    @State private var inquiries: [(id: String, title: String)] = []
    @State private var inquiry: String?
    @State private var wholeThread = true
    @State private var saving = false
    @State private var problem: String?
    private var canLink: Bool { message.type == "received" || message.type == "sent" }
    private var claim: Bool { message.sales?.canClaim == true }
    private var me: String { store.info?.employeeId ?? "" }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(claim ? "Przypisz zapytanie" : "Dodaj zapytanie", systemImage: "list.clipboard").font(.title2.bold())
            if canLink {
                Picker("", selection: $linkMode) { Text("Nowe zapytanie").tag(false); Text("Dołącz do istniejącego zapytania").tag(true) }
                    .pickerStyle(.segmented).labelsHidden().disabled(saving)
            }
            if linkMode && canLink { linkForm } else { createForm }
            if let problem { Text(problem).foregroundStyle(.orange).font(.callout) }
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                if linkMode && canLink {
                    Button(saving ? "Zapisywanie…" : "Dołącz do zapytania") { Task { await link() } }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || inquiry == nil)
                } else {
                    Button(saving ? "Zapisywanie…" : claim ? (owner == me ? "Przypisz mnie" : "Przypisz pracownika") : (owner == me ? "Dodaj i przypisz mnie" : "Dodaj i przypisz pracownika")) { Task { await create() } }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || owner == nil)
                }
            }
        }
        .padding(20).frame(width: 520)
        .overlay { if saving { PendingOverlay(text: linkMode ? "Wiązanie z zapytaniem…" : "Zapisywanie zapytania…") } }
        .task {
            owner = me.isEmpty ? nil : me
            employees = await store.employees(assignable: false)
            if employees.isEmpty { problem = "Błąd podczas ładowania pracowników" }
        }
        .task(id: query) {
            guard canLink else { return }
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            if let rows = await store.inquiries(matching: query) { inquiries = rows; if !rows.contains(where: { $0.id == inquiry }) { inquiry = nil } }
            else { problem = "Nie udało się pobrać zapytań." }
        }
    }
    private var createForm: some View {
        Form {
            TextField("Liczba osób — opcjonalnie", text: $guests, prompt: Text("Nie ustalono"))
            LabeledContent("Tytuł zapytania", value: "Zapytanie: \(message.subjectLabel)")
            LabeledContent("Nadawca", value: message.from.isEmpty ? "—" : message.from)
            Section("Opiekun zapytania") {
                List(employees, selection: $owner) { employee in Text(employee.full).tag(employee.id) }.frame(minHeight: 180)
            }
        }.formStyle(.grouped).frame(minHeight: 360)
    }
    private var linkForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(message.subjectLabel).foregroundStyle(.secondary)
            TextField("Wyszukaj zapytanie…", text: $query).textFieldStyle(.roundedBorder)
            List(inquiries, id: \.id, selection: $inquiry) { row in Text(row.title).tag(row.id) }.frame(minHeight: 220)
            Toggle("Powiąż całą konwersację i kolejne odpowiedzi", isOn: $wholeThread)
            Text("Ten sam temat i rozmówca w tej skrzynce lub identyfikatory odpowiedzi. Odznacz, aby dołączyć tylko wybrany mail.").font(.caption).foregroundStyle(.secondary)
        }
    }
    private func create() async {
        let trimmed = guests.trimmingCharacters(in: .whitespaces)
        if !trimmed.isEmpty, (Int(trimmed) ?? 0) < 1 || (Int(trimmed) ?? 0) > 100_000 { problem = "Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste."; return }
        guard let owner else { return }
        saving = true; defer { saving = false }
        do {
            let reply = try await store.perform([
                "op": .string("inquiry"), "id": .string(message.id), "type": .string(message.type), "owner": .string(owner),
                "guestCount": trimmed.isEmpty ? .null : .number(Double(Int(trimmed) ?? 0)),
            ])
            let text = reply["message"]?.text.nonEmpty ?? "Utworzono i przypisano zapytanie."
            if reply["warning"]?.flag == true { store.workspace?.error = text } else { store.workspace?.succeed(text) }
            await store.reloadAfterChange(message)
            dismiss()
        } catch { problem = store.failureText(error, "Nie udało się utworzyć zapytania") }
    }
    private func link() async {
        guard let inquiry else { return }
        saving = true; defer { saving = false }
        do {
            let reply = try await store.perform(["op": .string("link"), "inquiryId": .string(inquiry), "id": .string(message.id), "type": .string(message.type), "thread": .bool(wholeThread)])
            store.workspace?.succeed(reply["message"]?.text.nonEmpty ?? "Konwersacja została powiązana z zapytaniem.")
            await store.reloadAfterChange(message)
            dismiss()
        } catch { problem = store.failureText(error, "Nie udało się zapisać powiązania. Spróbuj ponownie.") }
    }
}

/// „Utwórz zadanie” z kontekstem wiadomości (`CreateTaskFromMessageModal`).
@MainActor struct TaskFromMessageSheet: View {
    @ObservedObject var store: MessagesStore
    let message: MessageItem
    let detail: MessageDetail?
    @Environment(\.dismiss) private var dismiss
    @State private var employees: [MailEmployee] = []
    @State private var title = ""
    @State private var description = ""
    @State private var assignee = ""
    @State private var hasDue = false
    @State private var due = Date()
    @State private var priority = "high"
    @State private var saving = false
    @State private var problem: String?
    private let priorities = [("low", "Niski"), ("medium", "Normalny"), ("high", "Wysoki"), ("urgent", "Pilny")]
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Label("Utwórz zadanie", systemImage: "checklist").font(.title2.bold())
                Text("Zadanie zachowa kontekst tej wiadomości.").font(.caption).foregroundStyle(.secondary)
            }
            Form {
                TextField("Tytuł zadania *", text: $title)
                Picker("Wykonawca", selection: $assignee) {
                    Text("Nieprzypisane").tag("")
                    ForEach(employees) { Text($0.full).tag($0.id) }
                }
                Toggle("Termin", isOn: $hasDue)
                if hasDue { DatePicker("Termin", selection: $due).labelsHidden() }
                Picker("Priorytet", selection: $priority) { ForEach(priorities, id: \.0) { Text($0.1).tag($0.0) } }
                Section("Opis i kontekst") { TextEditor(text: $description).frame(minHeight: 180).font(.callout) }
            }.formStyle(.grouped)
            if let problem { Text(problem).foregroundStyle(.orange).font(.callout) }
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Utwórz zadanie") { Task { await create() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20).frame(width: 620, height: 640)
        .overlay { if saving { PendingOverlay(text: "Tworzenie zadania…") } }
        .task {
            title = "Obsłuż: \(message.subjectLabel)"
            let content = detail?.body ?? message.preview
            description = String([
                "Wiadomość źródłowa: /crm/messages/\(message.id)?type=\(message.type)",
                "Nadawca: \(message.from.isEmpty ? "Nieznany" : message.from)",
                "Data wiadomości: \(MailDates.longText(message.date))",
                "Temat wiadomości: \(message.subjectLabel)",
                "",
                "Treść wiadomości:",
                content.isEmpty ? "Brak treści wiadomości" : content,
            ].joined(separator: "\n").prefix(10000))
            employees = await store.employees(assignable: false)
            if employees.isEmpty { problem = "Nie udało się pobrać listy pracowników" }
            let me = store.info?.employeeId ?? ""
            assignee = employees.contains { $0.id == me } ? me : ""
        }
    }
    private func create() async {
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { problem = "Podaj tytuł zadania"; return }
        saving = true; defer { saving = false }
        do {
            let reply = try await store.perform([
                "op": .string("task"), "id": .string(message.id), "type": .string(message.type),
                "title": .string(title), "description": .string(description), "priority": .string(priority),
                "assignee": assignee.isEmpty ? .null : .string(assignee),
                "dueDate": hasDue ? .string(ISO8601DateFormatter().string(from: due)) : .null,
            ])
            store.workspace?.succeed(reply["message"]?.text.nonEmpty ?? "Utworzono zadanie z wiadomości")
            dismiss()
        } catch { problem = store.failureText(error, "Nie udało się utworzyć zadania") }
    }
}

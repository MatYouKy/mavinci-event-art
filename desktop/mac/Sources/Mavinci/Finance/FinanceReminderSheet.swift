import SwiftUI

// MARK: Przypomnienie o płatności i „Wyślij email” z karty faktury — 1:1 z `SendInvoiceEmailModal` (tryby „reminder”
// i „invoice”): skrzynka pracownika, adresaci z organizacji nabywcy (płatnik wydarzenia oznaczony „opiekun”), temat i treść
// (monit — z terminem i kwotą do zapłaty), PDF faktury w załączniku (bez zapisanego PDF — wygenerowany i zapisany), podgląd
// ze stopką i szablonem firmy, wysyłka teraz albo zaplanowana; monit — wpis w historii monitów.
// Serwer: `/bridge/native/v1/finance` (`reminder`, `reminderPreview`, `reminderSend`, parametr `mode`).

@MainActor struct FinanceReminderSheet: View {
    @ObservedObject var store: FinanceStore
    let invoiceID: String
    let buyerName: String
    let mode: FinEmailMode
    let onSent: (() -> Void)?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var setup: FinReminderSetup?
    @State private var loadError: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var recipientName = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?
    /// Pole adresu z otwartą listą podpowiedzi (`RecipientField`) — wtedy ↩ i Esc obsługuje lista, nie przyciski okna.
    @State private var recipientField: String?

    /// Monit z listy „Należności” (Terminy i monity).
    init(store: FinanceStore, receivable: FinDeadlines.Receivable) {
        self.init(store: store, invoiceID: receivable.invoiceId ?? receivable.id, buyerName: receivable.buyerName ?? "")
    }

    init(store: FinanceStore, invoiceID: String, buyerName: String, mode: FinEmailMode = .reminder, onSent: (() -> Void)? = nil) {
        _store = ObservedObject(wrappedValue: store)
        self.invoiceID = invoiceID
        self.buyerName = buyerName
        self.mode = mode
        self.onSent = onSent
    }

    private var isReminder: Bool { mode == .reminder }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label(isReminder ? "Przypomnienie o płatności" : "Wyślij fakturę przez email", systemImage: isReminder ? "envelope.badge" : "envelope")
                    .font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            if let setup {
                form(setup)
            } else if let loadError {
                ContentUnavailableView {
                    Label("Nie udało się otworzyć wysyłki", systemImage: "exclamationmark.triangle")
                } description: { Text(loadError) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack {
                Button { Task { await showPreview() } } label: {
                    if previewLoading { ProgressView().controlSize(.small) } else { Label("Podgląd", systemImage: "eye") }
                }
                .disabled(previewLoading || accountId.isEmpty || setup == nil)
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(recipientField == nil ? .cancelAction : nil).disabled(sending)
                Button { Task { await send() } } label: {
                    if sending { Text(scheduled ? "Planowanie..." : "Wysyłanie...") }
                    else if isReminder { Label(scheduled ? "Zaplanuj przypomnienie" : "Wyślij przypomnienie", systemImage: "paperplane") }
                    else { Label(scheduled ? "Zaplanuj fakturę" : "Wyślij fakturę", systemImage: "paperplane") }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(recipientField == nil ? .defaultAction : nil)
                .disabled(sending || setup == nil)
            }
            .padding(16).crmBar()
        }
        .frame(minWidth: 760, idealWidth: 820, minHeight: 680, idealHeight: 780)
        .task { await load() }
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }
            .frame(width: 760, height: 720)
        }
        .alert(isReminder ? "Nie wysłano przypomnienia" : "Nie wysłano faktury", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(problem ?? "") }
        .interactiveDismissDisabled(sending)
        .overlay {
            if sending { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : isReminder ? "Wysyłanie przypomnienia z fakturą…" : "Wysyłanie faktury z załącznikiem PDF…") }
            else if previewLoading { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func form(_ setup: FinReminderSetup) -> some View {
        Form {
            if isReminder {
                Section {
                    Label {
                        Text("Faktura \(setup.number): termin płatności \(FinFormat.day(setup.dueDate)), do zapłaty \(FinFormat.money(setup.outstanding, setup.currency)). Zapłatę CRM widzi po wczytaniu wyciągu — jeśli klient mógł zapłacić po ostatnim wyciągu, sprawdź konto przed wysłaniem.")
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: { Image(systemName: "exclamationmark.triangle").foregroundStyle(CrmTheme.rgb(0xfbbf24)) }
                }
            }
            Section {
                if setup.accounts.isEmpty {
                    Text("Nie masz skrzynki, z której możesz wysłać fakturę.").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                }
                RecipientField("Do:", text: Binding(get: { to }, set: { value in
                    if value != to { recipientName = "" }
                    to = value
                }), prompt: "email@example.com", field: "to", openField: $recipientField, inForm: true)
                if !setup.organizationName.isEmpty {
                    Text("Nabywca faktury: \(setup.organizationName)").font(.caption).foregroundStyle(.secondary)
                }
                recipients(setup)
                RecipientField("DW:", text: $cc, prompt: "Opcjonalnie", field: "cc", openField: $recipientField, inForm: true)
                RecipientField("UDW:", text: $bcc, prompt: "Opcjonalnie", field: "bcc", openField: $recipientField, inForm: true)
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
            }
            Section("Wiadomość:") {
                TextEditor(text: $text).font(.body).frame(minHeight: 200)
                Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
            }
            Section {
                Label {
                    Text("Załącznik: Faktura_\(setup.number).pdf" + (setup.pdfStored ? " (z zapisanego PDF)" : " (zostanie wygenerowany)"))
                } icon: { Image(systemName: "paperclip").foregroundStyle(theme.accent) }
            }
            Section("Wysyłka") {
                Picker("Wysyłka", selection: $scheduled) { Text("Wyślij teraz").tag(false); Text("Zaplanuj wysyłkę").tag(true) }
                    .pickerStyle(.segmented).labelsHidden()
                if scheduled { DatePicker("Termin wysyłki", selection: $scheduledAt, in: Date()...) }
            }
        }
        .formStyle(.grouped)
        .disabled(sending)
    }

    @ViewBuilder private func recipients(_ setup: FinReminderSetup) -> some View {
        if setup.recipients.isEmpty {
            Text("Organizacja wskazana na fakturze nie ma kontaktu z adresem e-mail. Wpisz adres ręcznie albo uzupełnij kartotekę organizacji.")
                .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Text("KONTAKTY ORGANIZACJI WSKAZANEJ NA FAKTURZE").font(.caption2).foregroundStyle(.secondary)
                ForEach(setup.recipients) { recipient in
                    let selected = to == recipient.email
                    Button {
                        to = recipient.email
                        recipientName = recipient.name
                    } label: {
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: selected ? "checkmark.circle.fill" : "circle").foregroundStyle(selected ? theme.accent : Color.secondary)
                            VStack(alignment: .leading, spacing: 1) {
                                HStack(spacing: 6) {
                                    Text(recipient.name)
                                    if recipient.preferred { Text("OPIEKUN").font(.caption2.weight(.semibold)).foregroundStyle(theme.accent) }
                                }
                                if let position = recipient.position { Text(position).font(.caption).foregroundStyle(.secondary) }
                                Text(recipient.email).font(.caption).foregroundStyle(theme.accent.opacity(0.8))
                            }
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func load() async {
        loadError = nil
        do {
            let next = try await store.reminderSetup(invoiceID, mode: mode)
            accountId = next.accounts.first?.id ?? ""
            to = next.to
            recipientName = next.recipientName
            subject = next.subject
            text = next.text
            setup = next
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać skrzynek pracownika")
        }
    }

    private var effectiveRecipientName: String {
        recipientName.isEmpty ? buyerName : recipientName
    }

    private func showPreview() async {
        guard let setup else { return }
        previewLoading = true
        defer { previewLoading = false }
        do {
            previewHTML = try await store.reminderPreview(setup.invoiceId, accountId: accountId, subject: subject, text: text, recipientName: effectiveRecipientName, mode: mode)
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu.")
        }
    }

    private func send() async {
        guard let setup else { return }
        if to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź adres email odbiorcy"; return }
        if subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź temat wiadomości"; return }
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { problem = "Wprowadź treść wiadomości"; return }
        if accountId.isEmpty { problem = "Wybierz skrzynkę pracownika, z której ma zostać wysłana faktura"; return }
        if scheduled && scheduledAt.timeIntervalSinceNow < 30 { problem = "Termin wysyłki musi przypadać w przyszłości"; return }
        guard store.workspace?.canWrite == true else { problem = "Wysyłka wymaga połączenia z serwerem CRM."; return }
        sending = true
        defer { sending = false }
        do {
            let result = try await store.reminderSend(setup.invoiceId, accountId: accountId, to: to, cc: cc, bcc: bcc, subject: subject, text: text,
                                                      recipientName: effectiveRecipientName, scheduledAt: scheduled ? scheduledAt : nil, mode: mode)
            if result.scheduled, let at = result.scheduledAt, let date = MeetingDates.parse(at) {
                let when = MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
                store.workspace?.succeed(isReminder ? "Przypomnienie zostanie wysłane \(when)" : "Faktura zostanie wysłana \(when)")
            } else {
                store.workspace?.succeed(result.message)
            }
            if !result.warnings.isEmpty { store.workspace?.notice = result.warnings.joined(separator: " ") }
            dismiss()
            onSent?()
            if isReminder { await store.sync(force: true) }
        } catch {
            problem = store.failureText(error, "Błąd podczas wysyłania email")
        }
    }
}

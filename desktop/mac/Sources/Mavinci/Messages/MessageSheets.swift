import SwiftUI
import AppKit
import UniformTypeIdentifiers

/// Nowa wiadomość, odpowiedź i przekazanie — pola, stopka skrzynki, cytat i planowanie jak w `ComposeEmailModal`. Otwierana
/// w osobnym oknie (`formWindow`): okno można skalować i przesuwać, a skrzynka w głównym oknie działa dalej. U góry nadawca,
/// adresy i temat, niżej treść; w odpowiedzi pod treścią cała wiadomość, na którą odpowiadasz, z jej wcześniejszą korespondencją
/// (jak w Thunderbirdzie, podział przesuwany). Pliki przeciągnięte do okna — także na treść — trafiają do załączników.
/// Wpisywany tekst (adresy, temat, treść) ma osobne pola stanu — litera nie przelicza całego okna z podglądem cytatu.
@MainActor struct ComposeSheet: View {
    @ObservedObject var store: MessagesStore
    @State private var draft: ComposeDraft
    @State private var to: String
    @State private var cc: String
    @State private var bcc: String
    @State private var subject: String
    @State private var text: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @Environment(\.inFormWindow) private var inWindow
    @State private var attachments: [AttachmentFile] = []
    @State private var attachmentNote: String?
    @State private var dropTargeted = false
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var replyAll = false
    @State private var previewHTML: String?
    @State private var previewLoading = false
    @State private var sending = false
    @State private var problem: String?

    init(store: MessagesStore, draft: ComposeDraft) {
        _store = ObservedObject(wrappedValue: store)
        _draft = State(initialValue: draft)
        _to = State(initialValue: draft.to)
        _cc = State(initialValue: draft.cc)
        _bcc = State(initialValue: draft.bcc)
        _subject = State(initialValue: draft.subject)
        _text = State(initialValue: draft.text)
    }

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
    /// „Odpowiedz wszystkim”: adresaci i DW oryginału bez własnej skrzynki i nadawcy (adresy wpisane już w „Do” — przy wyborze).
    private var replyAllCandidates: [String] {
        guard let reply = draft.reply else { return [] }
        let own = accounts.first { $0.id == draft.accountId }?.email_address ?? ""
        let excluded = Set(emailAddresses(own) + emailAddresses(reply.item.from))
        return (emailAddresses(reply.item.to) + emailAddresses(reply.cc)).filter { !excluded.contains($0) }
            .reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
    }
    private var totalSize: Int { attachments.reduce(0) { $0 + $1.size } }
    /// Szkic z bieżącymi polami (do podglądu i wysyłki).
    private var current: ComposeDraft {
        var value = draft
        value.to = to; value.cc = cc; value.bcc = bcc; value.subject = subject; value.text = text
        return value
    }

    var body: some View {
        let showsReplyAll = draft.reply != nil && !replyAllCandidates.isEmpty
        VStack(spacing: 0) {
            if !inWindow || showsReplyAll {
                HStack {
                    if !inWindow { Text(draft.title).font(.title2.bold()) }
                    Spacer()
                    if showsReplyAll {
                        Picker("", selection: $replyAll) { Text("Odpowiedz").tag(false); Text("Odpowiedz wszystkim").tag(true) }
                            .pickerStyle(.segmented).labelsHidden().fixedSize()
                            .onChange(of: replyAll) { _, all in
                                let typed = Set(emailAddresses(to))
                                cc = all ? replyAllCandidates.filter { !typed.contains($0) }.joined(separator: ", ") : ""
                            }
                    }
                }
                .padding([.horizontal, .top], 20).padding(.bottom, inWindow ? 0 : 8)
            }
            fields
            Divider()
            VSplitView {
                editor
                if let reply = draft.reply { quote(reply) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            Divider()
            attachmentsAndSchedule
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
        .frame(minWidth: 640, idealWidth: 860, maxWidth: .infinity, minHeight: 600, idealHeight: 820, maxHeight: .infinity)
        .background(theme.page)
        .background(ComposeWindowTitle(base: draft.title, subject: $subject))
        .onDrop(of: [UTType.fileURL], isTargeted: $dropTargeted) { providers in accept(providers) }
        .overlay { if dropTargeted { dropHint } }
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

    /// Nadawca, adresy i temat.
    private var fields: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 8) {
            GridRow {
                Text("Od:").foregroundStyle(.secondary).gridColumnAlignment(.trailing)
                if accounts.isEmpty {
                    Text("Nie masz skrzynki, z której możesz wysyłać wiadomości.").foregroundStyle(.secondary)
                } else {
                    Picker("Od:", selection: $draft.accountId) { ForEach(accounts) { Text(label($0)).tag($0.id) } }
                        .labelsHidden().frame(maxWidth: 560, alignment: .leading)
                }
            }
            GridRow {
                Text("Do:").foregroundStyle(.secondary)
                TextField("Do:", text: $to, prompt: Text("email@example.com")).textFieldStyle(.roundedBorder).labelsHidden()
            }
            GridRow {
                Text("DW:").foregroundStyle(.secondary)
                TextField("DW:", text: $cc, prompt: Text("Opcjonalnie")).textFieldStyle(.roundedBorder).labelsHidden()
            }
            GridRow {
                Text("UDW:").foregroundStyle(.secondary)
                TextField("UDW:", text: $bcc, prompt: Text("Opcjonalnie")).textFieldStyle(.roundedBorder).labelsHidden()
            }
            GridRow {
                Text("Temat:").foregroundStyle(.secondary)
                TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości")).textFieldStyle(.roundedBorder).labelsHidden()
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    /// Treść wiadomości — pliki upuszczone na pole trafiają do załączników.
    private var editor: some View {
        VStack(alignment: .leading, spacing: 6) {
            MailTextEditor(text: $text) { addFiles($0) }
                .frame(maxWidth: .infinity, minHeight: 140, maxHeight: .infinity)
                .background(theme.card, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
            Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .frame(minHeight: 200, idealHeight: 300)
    }

    /// Wiadomość, na którą odpowiadasz — w całości, z jej wcześniejszą korespondencją (serwer dołącza cytat przy wysyłce).
    private func quote(_ reply: MessageDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Dnia \(MailDates.longText(reply.item.date)), użytkownik \(reply.item.from) napisał:")
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Group {
                if let html = reply.html {
                    if reply.plain && theme.scheme == .dark {
                        EmailWebView(html: theme.darkEmailDocument(html), background: theme.pageRGB, acceptsDrops: false)
                    } else {
                        EmailWebView(html: html, acceptsDrops: false)
                    }
                } else if !reply.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ScrollView { Text(reply.body).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(12) }
                } else {
                    Text("Brak treści wiadomości").italic().foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 120, maxHeight: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Color.primary.opacity(0.12)))
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .frame(minHeight: 180, idealHeight: 360)
    }

    /// Załączniki (przeciąganie plików albo „Dodaj pliki…”) i termin wysyłki.
    private var attachmentsAndSchedule: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("Załączniki").font(.callout.weight(.medium))
                Spacer()
                Button { pickFiles() } label: { Label("Dodaj pliki…", systemImage: "paperclip") }
            }
            if attachments.isEmpty {
                Text("Przeciągnij pliki do okna (także na treść wiadomości) albo użyj „Dodaj pliki…”.").font(.caption).foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) { ForEach(attachments) { file in chip(file) } }
                }
            }
            if let attachmentNote { Text(attachmentNote).font(.caption).foregroundStyle(.orange) }
            if totalSize > 25 * 1024 * 1024 {
                Label("Łączny rozmiar załączników przekracza 25 MB — serwer pocztowy może odrzucić wiadomość.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.caption)
            }
            HStack(spacing: 12) {
                Picker("Wysyłka", selection: $scheduled) { Text("Wyślij teraz").tag(false); Text("Zaplanuj wysyłkę").tag(true) }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                if scheduled { DatePicker("Termin wysyłki", selection: $scheduledAt, in: Date()...).labelsHidden() }
                Spacer()
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
    }

    private func chip(_ file: AttachmentFile) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "doc").foregroundStyle(theme.accent)
            Text(file.name).lineLimit(1).truncationMode(.middle).frame(maxWidth: 240, alignment: .leading)
            Text(file.sizeLabel).foregroundStyle(.secondary).monospacedDigit()
            Button { attachments.removeAll { $0.id == file.id } } label: { Image(systemName: "xmark.circle.fill") }
                .buttonStyle(.borderless).foregroundStyle(.secondary).help("Usuń załącznik")
        }
        .font(.caption)
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(Color.primary.opacity(0.06), in: Capsule())
    }

    private var dropHint: some View {
        RoundedRectangle(cornerRadius: 12)
            .strokeBorder(theme.accent, style: StrokeStyle(lineWidth: 2, dash: [8, 5]))
            .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                Label("Upuść, aby dołączyć pliki", systemImage: "paperclip").font(.headline)
                    .padding(.horizontal, 14).padding(.vertical, 8).background(.regularMaterial, in: Capsule())
            }
            .padding(8)
            .allowsHitTesting(false)
    }

    private func pickFiles() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true; panel.canChooseDirectories = false; panel.canChooseFiles = true
        panel.prompt = "Dodaj"
        guard panel.runModal() == .OK else { return }
        addFiles(panel.urls)
    }
    /// Pliki do załączników (bez powtórzeń); foldery pomijane z informacją.
    private func addFiles(_ urls: [URL]) {
        var skipped = 0
        for url in urls {
            var directory: ObjCBool = false
            guard url.isFileURL, FileManager.default.fileExists(atPath: url.path, isDirectory: &directory), !directory.boolValue else {
                skipped += 1
                continue
            }
            guard !attachments.contains(where: { $0.url.standardizedFileURL == url.standardizedFileURL }) else { continue }
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            attachments.append(AttachmentFile(url: url, size: size))
        }
        attachmentNote = skipped > 0 ? "Foldery nie są dołączane — przeciągnij pliki z ich wnętrza." : nil
    }
    private func accept(_ providers: [NSItemProvider]) -> Bool {
        let files = providers.filter { $0.canLoadObject(ofClass: URL.self) }
        guard !files.isEmpty else { return false }
        Task {
            var urls: [URL] = []
            for provider in files {
                if let url = await Self.fileURL(provider) { urls.append(url) }
            }
            addFiles(urls)
        }
        return true
    }
    nonisolated static func fileURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url?.isFileURL == true ? url : nil) }
        }
    }
    private func showPreview() async {
        previewLoading = true; defer { previewLoading = false }
        do { previewHTML = try await store.preview(current) }
        catch { problem = store.failureText(error, "Nie udało się przygotować podglądu.") }
    }
    private func send() async {
        let draft = current
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

/// Tytuł okna wiadomości z bieżącym tematem (osobny widok — wpisywanie tematu nie przelicza całego okna).
private struct ComposeWindowTitle: View {
    let base: String
    @Binding var subject: String
    var body: some View {
        let trimmed = subject.trimmingCharacters(in: .whitespacesAndNewlines)
        Color.clear.navigationTitle(trimmed.isEmpty ? base : "\(base): \(trimmed)")
    }
}

/// Treść wiadomości (zwykły tekst, sprawdzanie pisowni). Pliki upuszczone na pole trafiają do załączników (`onFiles`) zamiast
/// wstawiać do treści ścieżkę pliku.
struct MailTextEditor: NSViewRepresentable {
    @Binding var text: String
    let onFiles: ([URL]) -> Void

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MailTextEditor
        init(_ parent: MailTextEditor) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            if parent.text != view.string { parent.text = view.string }
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = MailDropTextView(frame: .zero)
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.isEditable = true
        textView.isSelectable = true
        textView.font = NSFont.systemFont(ofSize: NSFont.systemFontSize)
        textView.textColor = NSColor.textColor
        textView.insertionPointColor = NSColor.textColor
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 6, height: 8)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true
        textView.isContinuousSpellCheckingEnabled = true
        textView.string = text
        textView.delegate = context.coordinator
        textView.onFiles = onFiles
        let scroll = MailTextScrollView()
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        scroll.drawsBackground = false
        scroll.documentView = textView
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scroll.documentView as? MailDropTextView else { return }
        textView.onFiles = onFiles
        if textView.string != text { textView.string = text }
    }
}

/// Przewijane pole treści: tekst zajmuje co najmniej całą wysokość pola, więc kliknięcie w pustym miejscu pod tekstem
/// ustawia kursor (jak w zwykłym edytorze).
final class MailTextScrollView: NSScrollView {
    override func tile() {
        super.tile()
        guard let textView = documentView as? NSTextView else { return }
        let height = contentSize.height
        guard abs(textView.minSize.height - height) > 0.5 else { return }
        textView.minSize = NSSize(width: 0, height: height)
        if textView.frame.height < height { textView.setFrameSize(NSSize(width: textView.frame.width, height: height)) }
    }
}

/// Pole treści wiadomości: upuszczone pliki (np. z Findera) przekazuje jako załączniki, upuszczony tekst wstawia jak zwykle.
final class MailDropTextView: NSTextView {
    var onFiles: (([URL]) -> Void)?

    private func fileURLs(_ info: NSDraggingInfo) -> [URL] {
        let objects = info.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true])
        return (objects as? [URL]) ?? []
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        onFiles != nil && !fileURLs(sender).isEmpty ? .copy : super.draggingEntered(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        onFiles != nil && !fileURLs(sender).isEmpty ? .copy : super.draggingUpdated(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        let urls = fileURLs(sender)
        if let onFiles, !urls.isEmpty {
            onFiles(urls)
            return true
        }
        return super.performDragOperation(sender)
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

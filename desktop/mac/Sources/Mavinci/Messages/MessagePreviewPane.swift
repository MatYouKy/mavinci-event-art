import SwiftUI
import AppKit
import WebKit
import QuickLook

/// Podgląd jak `MessagePreviewPane`: nagłówek (temat, data, Od/Do), czynności, lejek sprzedaży, treść HTML i załączniki.
@MainActor struct MessagePreviewPane: View {
    @ObservedObject var store: MessagesStore
    let key: String?
    let actions: MessageActions
    var body: some View {
        if let key, let message = store.item(key) ?? store.details[key]?.item {
            if message.type == "draft" {
                ContentUnavailableView {
                    Label("Wersja robocza", systemImage: "doc")
                } description: { Text("Wersję roboczą otwórz w pełnym edytorze.") } actions: {
                    Button("Otwórz w przeglądarce") { actions.browser(message) }.buttonStyle(.borderedProminent)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let detail = store.details[key] {
                MessageDetailView(store: store, message: message, detail: detail, actions: actions).id(key)
            } else if store.detailErrors[key] != nil {
                ContentUnavailableView {
                    Label("Nie udało się pobrać treści wiadomości.", systemImage: "exclamationmark.triangle")
                } actions: { Button("Spróbuj ponownie") { Task { _ = await store.loadDetail(message, force: true) } } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    .task(id: key) { _ = await store.loadDetail(message) }
            }
        } else {
            ContentUnavailableView {
                Label("Wybierz wiadomość", systemImage: "tray")
            } description: { Text("Jej treść i załączniki pojawią się tutaj bez otwierania kolejnej karty.") }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

@MainActor struct MessageDetailView: View {
    @ObservedObject var store: MessagesStore
    let message: MessageItem
    let detail: MessageDetail
    let actions: MessageActions
    @Environment(\.crmTheme) private var theme
    var body: some View {
        let inbound = !message.isDeleted && message.inbound
        let manage = store.info?.canManage == true
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline) {
                    Text(message.subjectLabel).font(.title3.weight(.semibold)).textSelection(.enabled).lineLimit(2)
                    if message.isStarred { Image(systemName: "star.fill").foregroundStyle(.yellow) }
                    Spacer()
                    Text(MailDates.medium(message.date)).font(.caption).foregroundStyle(.secondary)
                }
                Grid(alignment: .leading, horizontalSpacing: 6, verticalSpacing: 2) {
                    GridRow { Text("Od:").foregroundStyle(.tertiary); Text(message.from).textSelection(.enabled).lineLimit(1) }
                    GridRow { Text("Do:").foregroundStyle(.tertiary); Text(message.to).textSelection(.enabled).lineLimit(2) }
                    if !detail.cc.isEmpty { GridRow { Text("DW:").foregroundStyle(.tertiary); Text(detail.cc).textSelection(.enabled).lineLimit(2) } }
                    if let phone = detail.phone, !phone.isEmpty { GridRow { Text("Telefon:").foregroundStyle(.tertiary); Text(phone).textSelection(.enabled) } }
                    if message.sales?.hasInquiry != true, let person = message.assigned_employee {
                        GridRow { Text("Przypisano:").foregroundStyle(.tertiary); Text(person.full) }
                    }
                }.font(.caption)
                HStack(spacing: 8) {
                    if store.canReply(message) && inbound {
                        Button { actions.reply(message) } label: { Label("Odpowiedz", systemImage: "arrowshape.turn.up.left") }.buttonStyle(.borderedProminent)
                    }
                    if store.canReply(message) && message.type == "received" {
                        Button { actions.forward(message) } label: { Label("Przekaż", systemImage: "arrowshape.turn.up.right") }
                    }
                    if manage && inbound {
                        Button { actions.assign(message) } label: { Label("Przypisz", systemImage: "person.badge.plus") }
                        Button { actions.inquiry(message) } label: { Label("Dodaj do zapytań", systemImage: "tray.and.arrow.down") }
                    }
                    if inbound && store.info?.canCreateTasks == true {
                        Button { actions.task(message) } label: { Label("Utwórz zadanie", systemImage: "checklist") }
                    }
                    Spacer()
                    Menu {
                        MessageMenuItems(store: store, message: message, actions: actions)
                    } label: { Image(systemName: "ellipsis.circle") }
                        .menuStyle(.button).buttonStyle(.borderless).menuIndicator(.hidden).fixedSize().help("Więcej czynności")
                }.controlSize(.small)
                salesRow(inbound: inbound)
            }
            .padding(14).crmBar()
            Group {
                if let html = detail.html {
                    if detail.plain && theme.scheme == .dark {
                        EmailWebView(html: theme.darkEmailDocument(html), background: theme.pageRGB)
                    } else {
                        EmailWebView(html: html)
                    }
                } else if !detail.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ScrollView { Text(detail.body).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(20) }
                } else {
                    Text("Brak treści wiadomości").italic().foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
            MessageAttachmentsBar(store: store, detail: detail)
        }
    }
    @ViewBuilder private func salesRow(inbound: Bool) -> some View {
        let sales = message.sales
        if sales?.hasInquiry == true || inbound {
            HStack(spacing: 6) {
                if let sales, sales.hasInquiry {
                    ForEach(sales.inquiries, id: \.id) { inquiry in
                        Button { store.openInquiry(inquiry.id) } label: {
                            HStack(spacing: 4) {
                                Text("W lejku · \(inquiry.archived == true ? "Archiwum" : SalesContext.stages[inquiry.stage ?? ""] ?? "Zapytanie")")
                                Text("·").foregroundStyle(.secondary)
                                Text(inquiry.ownerId == nil ? "Bez opiekuna" : "Opiekun: \(inquiry.ownerName ?? "Przypisany pracownik")")
                            }
                            .font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
                            .background(theme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 5)).foregroundStyle(theme.accent)
                        }.buttonStyle(.plain)
                    }
                    if let label = sales.aiLabel {
                        Text(label).font(.caption).padding(.horizontal, 8).padding(.vertical, 3)
                            .background((sales.aiStatus == "failed" || sales.aiStatus == "manual_review" ? Color.orange : Color.primary).opacity(0.1), in: RoundedRectangle(cornerRadius: 5))
                    }
                }
                if inbound {
                    let claim = sales?.canClaim == true
                    Button(claim ? "Przypisz mnie do zapytania" : sales?.hasInquiry == true ? "Otwórz zapytanie" : "Dodaj do zapytań i przypisz mnie") {
                        if !claim, let sales, sales.hasInquiry, sales.inquiries.count == 1, let first = sales.inquiries.first { store.openInquiry(first.id) }
                        else { actions.inquiry(message) }
                    }.controlSize(.small)
                }
                Spacer()
            }
        }
    }
}

/// Załączniki jak `MessageAttachments`: kopia wysłanej wiadomości, podgląd Quick Look i zapis na dysk.
@MainActor struct MessageAttachmentsBar: View {
    @ObservedObject var store: MessagesStore
    let detail: MessageDetail
    @State private var files: [MailAttachment] = []
    @State private var error: String?
    @State private var loading = true
    @State private var working: String?
    @State private var preview: URL?
    var body: some View {
        let sent = detail.item.type == "sent"
        VStack(alignment: .leading, spacing: 6) {
            if sent { sentInfo }
            if let error { Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(.orange) }
            if !files.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Label("\(files.count)", systemImage: "paperclip").font(.caption).foregroundStyle(.secondary).help("Załączniki: \(files.count)")
                        ForEach(files) { file in
                            HStack(spacing: 4) {
                                Button { Task { await open(file) } } label: {
                                    HStack(spacing: 4) {
                                        if working == file.id { ProgressView().controlSize(.mini) } else { Image(systemName: "doc") }
                                        Text(file.filename).lineLimit(1)
                                    }
                                }.buttonStyle(.plain).help("Podgląd: \(file.filename) (\(file.sizeLabel))")
                                Button { Task { await save(file) } } label: { Image(systemName: "arrow.down.circle") }
                                    .buttonStyle(.plain).help("Pobierz: \(file.filename)")
                            }
                            .font(.caption).padding(.horizontal, 8).padding(.vertical, 4)
                            .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 6))
                            .disabled(working != nil)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 14).padding(.vertical, (files.isEmpty && error == nil && !sent) ? 0 : 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .quickLookPreview($preview)
        .task(id: detail.item.key) {
            files = detail.attachments; error = detail.attachmentsError; loading = true
            let result = await store.attachments(for: detail)
            files = result.files; error = result.error; loading = false
        }
    }
    @ViewBuilder private var sentInfo: some View {
        let archive = detail.deliveryArchive?.object ?? [:]
        let copy = archive["sentCopy"]?.object
        let expected = archive["attachments"]?.object["expected"].map { Int($0.number) }
        let complete = archive["attachments"]?.object["status"]?.text == "complete"
        let mailbox = copy?["mailbox"]?.text ?? ""
        let labels = [
            "saved": "Kopia zapisana na serwerze pocztowym\(mailbox.isEmpty ? "" : " w folderze „\(mailbox)”").",
            "provider_managed": "Zapis kopii w folderze Wysłane obsługuje dostawca poczty.",
            "unconfigured": "Wiadomość wysłana. Brak konfiguracji IMAP do zapisania kopii na serwerze pocztowym.",
            "failed": "Wiadomość wysłana, ale nie potwierdzono zapisu kopii na serwerze pocztowym. Nie wysyłaj ponownie.",
            "unknown": "Brak potwierdzenia zapisu kopii na serwerze pocztowym.",
        ]
        VStack(alignment: .leading, spacing: 2) {
            Text(copy.map { labels[$0["status"]?.text ?? ""] ?? labels["unknown"]! } ?? "Ta starsza wiadomość nie ma informacji o zapisie kopii na serwerze pocztowym.")
            if loading && files.isEmpty { Text("Odczytywanie archiwum załączników…") }
            else if error == nil, let expected, files.count < expected {
                Text("Zarchiwizowano \(files.count) z \(expected) wysłanych załączników. Archiwum jest niepełne.").foregroundStyle(.orange)
            } else if error == nil && files.isEmpty {
                Text(expected == 0 && complete ? "Wiadomość wysłana bez załączników." : "Brak załączników w archiwum CRM. Dla starszych wiadomości nie oznacza to, że wysłano je bez załączników.")
            }
        }.font(.caption).foregroundStyle(.secondary)
    }
    private func open(_ file: MailAttachment) async {
        working = file.id; defer { working = nil }
        do { preview = try await store.download(file) }
        catch { store.workspace?.error = "Nie udało się pobrać załącznika. Spróbuj ponownie." }
    }
    private func save(_ file: MailAttachment) async {
        working = file.id
        let downloaded: URL
        do { downloaded = try await store.download(file) } catch {
            working = nil; store.workspace?.error = "Nie udało się pobrać załącznika. Spróbuj ponownie."; return
        }
        working = nil
        let panel = NSSavePanel()
        panel.nameFieldStringValue = file.filename
        panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
        guard panel.runModal() == .OK, let target = panel.url else { return }
        do {
            if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
            try FileManager.default.copyItem(at: downloaded, to: target)
            store.workspace?.succeed("Zapisano załącznik: \(target.lastPathComponent)")
        } catch { store.workspace?.error = "Nie udało się zapisać załącznika." }
    }
}

/// Treść e-maila w `WKWebView`: bez JavaScriptu i bez zapisu danych witryn; linki otwierają się w przeglądarce systemowej.
struct EmailWebView: NSViewRepresentable {
    let html: String
    /// Tło poza treścią (np. przy przewijaniu poza krawędź) — dla wiadomości w ciemnym motywie.
    var background: Int?
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        return view
    }
    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.html != html else { return }
        context.coordinator.html = html
        view.underPageBackgroundColor = background.map { rgb in
            NSColor(srgbRed: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
        } ?? .white
        view.loadHTMLString(html, baseURL: nil)
    }
    final class Coordinator: NSObject, WKNavigationDelegate {
        var html: String?
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if action.navigationType == .linkActivated || action.targetFrame == nil {
                if let url = action.request.url, ["http", "https", "mailto", "tel"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
                decisionHandler(.cancel); return
            }
            decisionHandler(action.request.url?.scheme == "about" || action.navigationType == .other ? .allow : .cancel)
        }
    }
}

extension CrmTheme {
    /// Wiadomość tekstowa w kolorach motywu: tło strony, jasny tekst, linki i cytaty w kolorze akcentu.
    func darkEmailDocument(_ html: String) -> String {
        let hex = { (rgb: Int) in String(format: "#%06x", rgb) }
        let css = """
        <style>
          :root { color-scheme: dark; }
          html, body { background: \(hex(pageRGB)) !important; color: \(hex(textRGB)) !important; }
          a { color: \(hex(accentRGB)) !important; }
          blockquote { border-left-color: \(hex(accentRGB)) !important; color: inherit !important; }
          hr { border-color: rgba(255,255,255,0.15); }
        </style>
        """
        guard let head = html.range(of: "</head>", options: .caseInsensitive) else { return css + html }
        var document = html
        document.insert(contentsOf: css, at: head.lowerBound)
        return document
    }
}


import AppKit
import SwiftUI

// MARK: Materiały → „Udostępnij link” — 1:1 z CRM (`MaterialShareDialog.tsx`, `MaterialSharesPanel.tsx`)
//
// Link do pobrania folderu (z podfolderami, „na żywo”), albumu albo wybranych plików przez osobę spoza firmy (np. zdjęcia
// z fotobudki): tytuł i wiadomość na stronie `/pobierz/<token>`, ważność 1–30 dni, dostęp dla każdego z linkiem albo po
// e-mailu i haśle (puste pole — hasło generuje serwer; pokazujemy je raz). Po zapisie: link, hasło, gotowa wiadomość dla
// odbiorcy do skopiowania albo wysłania e-mailem. „Linki” — lista linków marki: przedłuż, wyłącz / włącz, zmień, nowe hasło,
// usuń. Serwer: `/bridge/native/v1/materials` (`op=shares`, `shareCreate`, `shareUpdate`, `shareDelete`) tokenem pracownika —
// linki tworzy „Materiały — zarządzanie” (RLS). Teksty i limity jak w `materialsShared.ts`.

struct MaterialShareItem: Codable, Hashable {
    var kind: String
    var id: String
    var name: String
    var missing: Bool
}

struct MaterialShare: Codable, Identifiable, Hashable {
    var id: String
    var companyId: String
    var url: String
    var title: String
    var message: String
    var access: String
    var emails: [String]
    var expiresAt: String
    var revokedAt: String?
    var status: String
    var items: [MaterialShareItem]
    var fileCount: Int
    var totalBytes: Double
    var viewCount: Int
    var downloadCount: Int
    var lastViewedAt: String?
    var lastDownloadedAt: String?
    var openedBy: [String]
    var createdAt: String
    var createdBy: String?
}

struct MaterialShareCreated: Codable {
    var share: MaterialShare
    var password: String?
}

struct MaterialSharesReply: Codable {
    var companyId: String
    var shares: [MaterialShare]
}

/// Element do udostępnienia (folder z podfolderami, album, plik) z nazwą do opisu w oknie.
struct MaterialShareTarget: Hashable {
    var kind: String
    var id: String
    var name: String
}

/// „Udostępnij link…” — elementy i proponowany tytuł strony.
struct MaterialShareRequest: Identifiable {
    let id = UUID()
    var items: [MaterialShareTarget]
    var title: String
}

enum MaterialShareText {
    static let days = [1, 3, 7, 14, 30]
    static let defaultDays = 3
    static let titleLimit = 120
    static let messageLimit = 2000
    static let emailsLimit = 10
    static let passwordMin = 8
    static let passwordMax = 64

    static func daysLabel(_ days: Int) -> String { days == 1 ? "1 dzień" : "\(days) dni" }

    static func accessLabel(_ access: String) -> String { access == "password" ? "Po podaniu e-maila i hasła" : "Każdy, kto ma link" }

    static func statusLabel(_ status: String) -> String {
        switch status {
        case "active": return "Aktywny"
        case "revoked": return "Wyłączony"
        default: return "Wygasł"
        }
    }

    static func kindName(_ kind: String) -> String {
        switch kind {
        case "folder": return "Folder"
        case "album": return "Album"
        default: return "Plik"
        }
    }

    /// „248 plików · 1,2 GB” (jak `materialShareSummary`).
    static func summary(fileCount: Int, totalBytes: Double) -> String {
        fileCount > 0 ? "\(MaterialsText.files(fileCount)) · \(MaterialsText.bytes(totalBytes))" : "Brak plików"
    }

    /// Koniec ważności: teraz + `days` dni.
    static func expiry(days: Int) -> String {
        let date = Date().addingTimeInterval(Double(days) * 24 * 3600)
        let f = DateFormatter()
        f.locale = Locale(identifier: "pl_PL")
        f.timeZone = TimeZone(identifier: "Europe/Warsaw")
        f.dateFormat = "dd.MM.yyyy, HH:mm"
        return f.string(from: date)
    }

    /// Adresy z pola (przecinki, średniki, spacje): małe litery, bez powtórzeń; `invalid` — niepoprawne (jak `materialShareEmails`).
    static func emails(_ text: String) -> (emails: [String], invalid: [String]) {
        var emails: [String] = []
        var invalid: [String] = []
        let pattern = #"^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$"#
        for raw in text.components(separatedBy: CharacterSet(charactersIn: ",; \n\t")) {
            let email = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if email.isEmpty { continue }
            if email.range(of: pattern, options: .regularExpression) == nil || email.count > 254 { invalid.append(raw) }
            else if !emails.contains(email) { emails.append(email) }
        }
        return (emails, invalid)
    }

    /// Opis udostępnianych elementów (jak `targetsSummary` w CRM).
    static func targets(_ items: [MaterialShareTarget]) -> String {
        if items.count == 1, let item = items.first {
            switch item.kind {
            case "folder": return "Folder „\(item.name)” z podfolderami — pliki dodane później też będą do pobrania."
            case "album": return "Album „\(item.name)” — zdjęcia dodane później do albumu też będą do pobrania."
            default: return "Plik „\(item.name)”."
            }
        }
        let files = items.filter { $0.kind == "file" }.count
        let folders = items.filter { $0.kind == "folder" }.count
        let albums = items.filter { $0.kind == "album" }.count
        let parts = [files > 0 ? MaterialsText.files(files) : nil, folders > 0 ? MaterialsText.folders(folders) : nil,
                     albums > 0 ? "\(albums) " + (albums == 1 ? "album" : "albumy") : nil].compactMap { $0 }
        return parts.joined(separator: " · ") + (folders > 0 ? " (foldery z podfolderami)" : "")
    }

    /// Wiadomość dla odbiorcy (jak `materialShareMessage`): link, ważność, przy haśle — e-mail i hasło (tylko zaraz po zapisie).
    static func message(_ share: MaterialShare, password: String?, companyName: String?) -> String {
        var lines = [
            "Dzień dobry,",
            "",
            "przesyłamy link do pobrania plików „\(share.title)”:",
            share.url,
            "",
            "Link jest ważny do \(MaterialsText.dateLabel(share.expiresAt)). Pliki można pobrać pojedynczo albo wszystkie naraz (ZIP).",
        ]
        if share.access == "password" {
            lines.append("")
            lines.append(share.emails.count == 1
                         ? "Aby otworzyć stronę, podaj adres e-mail: \(share.emails[0])"
                         : "Aby otworzyć stronę, podaj swój adres e-mail (ten, na który przyszła ta wiadomość).")
            lines.append(password.map { "Hasło: \($0)" } ?? "Hasło przekażemy osobno.")
        }
        lines.append("")
        lines.append("Pozdrawiamy")
        if let companyName, !companyName.isEmpty { lines.append(companyName) }
        return lines.joined(separator: "\n")
    }

    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    /// Nowa wiadomość e-mail w domyślnej aplikacji poczty (odbiorcy, temat, treść).
    static func mail(_ share: MaterialShare, body: String) {
        var components = URLComponents()
        components.scheme = "mailto"
        components.path = share.emails.joined(separator: ",")
        components.queryItems = [URLQueryItem(name: "subject", value: "Pliki do pobrania: \(share.title)"), URLQueryItem(name: "body", value: body)]
        if let url = components.url { NSWorkspace.shared.open(url) }
    }
}

// MARK: Zapis

extension MaterialsStore {
    /// Linki marki (najnowsze najpierw).
    func shares(company: String) async throws -> [MaterialShare] {
        guard let api else { throw AppError.configuration }
        let data = try await api.get("/materials", query: ["op": "shares", "company": company])
        return try JSONDecoder().decode(MaterialSharesReply.self, from: data).shares
    }

    /// `shareCreate` / `shareUpdate` z modalnym wskaźnikiem; błąd — komunikat w oknie (zwraca `nil`).
    func saveShare(_ op: String, _ body: [String: JSONValue], pending: String, success: String?) async -> MaterialShareCreated? {
        guard let workspace, let api else { return nil }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return nil }
        var payload = body
        payload["op"] = .string(op)
        do {
            let data = try await workspace.withPending(pending) { try await api.post("/materials", payload) }
            let reply = try JSONDecoder().decode(MaterialShareCreated.self, from: data)
            if let success { workspace.succeed(success) }
            return reply
        } catch {
            workspace.error = failureText(error, "Nie udało się zapisać linku.")
            return nil
        }
    }

    func deleteShare(_ share: MaterialShare) async -> Bool {
        guard let workspace, let api else { return false }
        guard workspace.canWrite else { workspace.error = "Zapis wymaga połączenia z serwerem CRM."; return false }
        do {
            _ = try await workspace.withPending("Usuwam link") { try await api.post("/materials", ["op": .string("shareDelete"), "id": .string(share.id)]) }
            workspace.succeed("Usunięto link — pliki zostały w Materiałach")
            return true
        } catch {
            workspace.error = failureText(error, "Nie udało się usunąć linku.")
            return false
        }
    }
}

// MARK: Okno: nowy link, zmiana linku, wynik (link i hasło)

@MainActor struct MaterialShareSheet: View {
    enum Mode {
        case create(MaterialShareRequest)
        case edit(MaterialShare)
        case result(MaterialShareCreated)
    }

    @ObservedObject var store: MaterialsStore
    let companyID: String
    let companyName: String
    let mode: Mode
    var onSaved: (MaterialShare) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var title = ""
    @State private var message = ""
    @State private var days = MaterialShareText.defaultDays
    @State private var access = "public"
    @State private var emails = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @State private var result: MaterialShareCreated?
    @State private var text = ""
    @State private var prepared = false

    private var editing: MaterialShare? {
        if case .edit(let share) = mode { return share }
        return nil
    }

    private var needsPassword: Bool { access == "password" && editing?.access != "password" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label(result != nil ? "Link do pobrania jest gotowy" : editing != nil ? "Zmień link do pobrania" : "Udostępnij link do pobrania", systemImage: "link")
                .font(.title3.weight(.semibold)).foregroundStyle(theme.accent)
                .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 10)
            if let result {
                resultView(result)
            } else {
                form
            }
            Divider()
            HStack {
                Spacer()
                if let result {
                    Button { MaterialShareText.copy(text); store.workspace?.succeed("Skopiowano wiadomość") } label: { Label("Kopiuj wiadomość", systemImage: "doc.on.doc") }
                    Button { MaterialShareText.mail(result.share, body: text) } label: { Label("Wyślij e-mailem", systemImage: "envelope") }
                    Button("Gotowe") { dismiss() }.keyboardShortcut(.defaultAction)
                } else {
                    Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(busy)
                    Button(editing != nil ? "Zapisz" : "Utwórz link") { Task { await save() } }
                        .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(busy)
                }
            }
            .padding(16)
        }
        .frame(minWidth: 560, idealWidth: 600, minHeight: 460, idealHeight: 640)
        .onAppear(perform: prepare)
    }

    private func prepare() {
        guard !prepared else { return }
        prepared = true
        switch mode {
        case .create(let request):
            title = request.title
        case .edit(let share):
            title = share.title
            message = share.message
            access = share.access
            emails = share.emails.joined(separator: ", ")
        case .result(let created):
            result = created
            text = MaterialShareText.message(created.share, password: created.password, companyName: companyName)
        }
    }

    private var form: some View {
        Form {
            Section {
                switch mode {
                case .create(let request):
                    Text(MaterialShareText.targets(request.items)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                case .edit(let share):
                    Text(share.items.map { "\(MaterialShareText.kindName($0.kind)) „\($0.name)”" }.joined(separator: ", ") + " · ważny do \(MaterialsText.dateLabel(share.expiresAt))")
                        .foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                case .result:
                    EmptyView()
                }
                TextField("Tytuł na stronie", text: $title, prompt: Text("Np. Zdjęcia z fotobudki — wesele Ani i Tomka"))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Wiadomość na stronie (opcjonalnie)").font(.callout)
                    TextEditor(text: $message)
                        .font(.body).frame(minHeight: 64)
                        .scrollContentBackground(.hidden)
                        .padding(4)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
                }
            }
            if editing == nil {
                Section("Ważny przez") {
                    Picker("Ważny przez", selection: $days) {
                        ForEach(MaterialShareText.days, id: \.self) { value in Text(MaterialShareText.daysLabel(value)).tag(value) }
                    }
                    .pickerStyle(.segmented).labelsHidden()
                    Text("Link przestanie działać \(MaterialShareText.expiry(days: days)). Przedłużysz go w „Linki”.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Kto może pobrać") {
                Picker("Dostęp", selection: $access) {
                    Text("Każdy, kto ma link").tag("public")
                    Text("Po podaniu e-maila i hasła").tag("password")
                }
                .pickerStyle(.radioGroup).labelsHidden()
                Text(access == "public" ? "Najprościej dla gości — wystarczy otworzyć link." : "Tylko osoby z listy, po wpisaniu hasła.")
                    .font(.caption).foregroundStyle(.secondary)
                if access == "password" {
                    TextField("E-mail odbiorcy", text: $emails, prompt: Text("anna@example.com — kilka adresów oddziel przecinkami"))
                    SecureOrPlainPasswordField(password: $password,
                                               prompt: editing != nil && !needsPassword ? "Nowe hasło (puste — bez zmiany)" : "Hasło (puste — wygenerujemy bezpieczne hasło)")
                }
            }
            if let error {
                Text(error).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
        .disabled(busy)
    }

    private func resultView(_ created: MaterialShareCreated) -> some View {
        let share = created.share
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Link (ważny do \(MaterialsText.dateLabel(share.expiresAt)))").font(.callout).foregroundStyle(.secondary)
                    HStack {
                        Text(share.url).font(.system(.callout, design: .monospaced)).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.06)))
                        Button { MaterialShareText.copy(share.url); store.workspace?.succeed("Skopiowano link") } label: { Label("Kopiuj", systemImage: "doc.on.doc") }
                        Button { if let url = URL(string: share.url) { NSWorkspace.shared.open(url) } } label: { Image(systemName: "safari") }
                            .help("Otwórz stronę linku")
                    }
                }
                if share.access == "password" {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Otworzy: \(share.emails.joined(separator: ", "))", systemImage: "lock")
                        if let password = created.password {
                            HStack {
                                Text("Hasło:").foregroundStyle(.secondary)
                                Text(password).font(.system(.title3, design: .monospaced)).foregroundStyle(theme.accent).textSelection(.enabled)
                                Button { MaterialShareText.copy(password); store.workspace?.succeed("Skopiowano hasło") } label: { Label("Kopiuj hasło", systemImage: "doc.on.doc") }
                            }
                        }
                        Text("Hasła nie da się później odczytać — w „Linki” możesz ustawić nowe.").font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(RoundedRectangle(cornerRadius: 8).fill(theme.accent.opacity(0.08)))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Wiadomość dla odbiorcy").font(.callout).foregroundStyle(.secondary)
                    TextEditor(text: $text)
                        .font(.body).frame(minHeight: 200)
                        .scrollContentBackground(.hidden)
                        .padding(6)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
                }
            }
            .padding(.horizontal, 20).padding(.bottom, 16)
        }
    }

    private func save() async {
        guard !busy else { return }
        error = nil
        let parsed = MaterialShareText.emails(emails)
        let typed = password.trimmingCharacters(in: .whitespacesAndNewlines)
        if access == "password" {
            if !parsed.invalid.isEmpty { error = "Niepoprawny adres e-mail: \(parsed.invalid.prefix(3).joined(separator: ", "))."; return }
            if parsed.emails.isEmpty { error = "Podaj adres e-mail osoby, która otworzy link."; return }
            if parsed.emails.count > MaterialShareText.emailsLimit { error = "Najwyżej \(MaterialShareText.emailsLimit) adresów e-mail."; return }
            if !typed.isEmpty && (typed.count < MaterialShareText.passwordMin || typed.count > MaterialShareText.passwordMax) {
                error = "Hasło: od \(MaterialShareText.passwordMin) do \(MaterialShareText.passwordMax) znaków albo puste pole (wygenerujemy hasło)."
                return
            }
        }
        let cleanTitle = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(MaterialShareText.titleLimit))
        let cleanMessage = String(message.prefix(MaterialShareText.messageLimit))
        busy = true
        defer { busy = false }
        var reply: MaterialShareCreated?
        switch mode {
        case .create(let request):
            reply = await store.saveShare("shareCreate", [
                "companyId": .string(companyID),
                "items": .array(request.items.map { .object(["kind": .string($0.kind), "id": .string($0.id)]) }),
                "title": .string(cleanTitle), "message": .string(cleanMessage), "days": .number(Double(days)),
                "access": .string(access), "emails": .array((access == "password" ? parsed.emails : []).map { .string($0) }),
                "password": .string(typed),
            ], pending: "Tworzę link do pobrania", success: "Link do pobrania jest gotowy")
        case .edit(let share):
            var body: [String: JSONValue] = [
                "id": .string(share.id), "title": .string(cleanTitle), "message": .string(cleanMessage), "access": .string(access),
            ]
            if access == "password" { body["emails"] = .array(parsed.emails.map { .string($0) }) }
            if needsPassword || !typed.isEmpty {
                body["newPassword"] = .bool(true)
                body["password"] = .string(typed)
            }
            reply = await store.saveShare("shareUpdate", body, pending: "Zapisuję link", success: nil)
        case .result:
            return
        }
        guard let reply else { return }
        onSaved(reply.share)
        if case .edit = mode, reply.password == nil {
            store.workspace?.succeed("Zapisano zmiany linku")
            dismiss()
            return
        }
        if case .edit = mode { store.workspace?.succeed("Ustawiono nowe hasło") }
        text = MaterialShareText.message(reply.share, password: reply.password, companyName: companyName)
        result = reply
    }
}

/// Pole hasła widoczne podczas wpisywania (hasło i tak trzeba przekazać odbiorcy).
private struct SecureOrPlainPasswordField: View {
    @Binding var password: String
    let prompt: String
    var body: some View {
        TextField("Hasło", text: $password, prompt: Text(prompt))
            .autocorrectionDisabled()
    }
}

// MARK: „Linki” — linki do pobrania marki

@MainActor struct MaterialSharesSheet: View {
    @ObservedObject var store: MaterialsStore
    let companyID: String
    let companyName: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var shares: [MaterialShare]?
    @State private var loadError: String?
    @State private var editing: MaterialShare?
    /// „Nowe hasło” — wynik do pokazania raz (hasło i wiadomość dla odbiorcy).
    @State private var resultRequest: ResultRequest?
    @State private var deleting: MaterialShare?
    @State private var resetting: MaterialShare?

    private struct ResultRequest: Identifiable {
        let id = UUID()
        let created: MaterialShareCreated
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Linki do pobrania — \(companyName)", systemImage: "link").font(.title3.weight(.semibold)).foregroundStyle(theme.accent)
                    Text("Udostępnij folder, album albo pliki prawym przyciskiem → „Udostępnij link…”.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }.help("Odśwież")
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 10)
            content
            Divider()
            HStack { Spacer(); Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction) }.padding(14)
        }
        .frame(minWidth: 680, idealWidth: 760, minHeight: 480, idealHeight: 620)
        .task { await load() }
        .sheet(item: $editing) { share in
            MaterialShareSheet(store: store, companyID: companyID, companyName: companyName, mode: .edit(share)) { replace($0) }
                .environmentObject(state).environment(\.crmTheme, theme)
        }
        .sheet(item: $resultRequest) { request in
            MaterialShareSheet(store: store, companyID: companyID, companyName: companyName, mode: .result(request.created))
                .environmentObject(state).environment(\.crmTheme, theme)
        }
        .confirmationDialog("Usunąć link?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń link", role: .destructive) {
                if let share = deleting {
                    Task { if await store.deleteShare(share) { shares?.removeAll { $0.id == share.id } } }
                }
                deleting = nil
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text("Adres „\(deleting?.title ?? "")” przestanie działać od razu. Pliki zostaną w Materiałach.")
        }
        .confirmationDialog("Ustawić nowe hasło?", isPresented: Binding(get: { resetting != nil }, set: { if !$0 { resetting = nil } }), titleVisibility: .visible) {
            Button("Nowe hasło") {
                if let share = resetting {
                    Task {
                        if let reply = await store.saveShare("shareUpdate", ["id": .string(share.id), "newPassword": .bool(true)],
                                                             pending: "Ustawiam nowe hasło", success: "Ustawiono nowe hasło") {
                            replace(reply.share)
                            if reply.password != nil { resultRequest = ResultRequest(created: reply) }
                        }
                    }
                }
                resetting = nil
            }
            Button("Anuluj", role: .cancel) { resetting = nil }
        } message: {
            Text("Wygenerujemy nowe hasło i pokażemy je raz. Dotychczasowe hasło przestanie działać, a osoby, które już otworzyły link, podadzą nowe.")
        }
    }

    @ViewBuilder private var content: some View {
        if let loadError, shares == nil {
            VStack(spacing: 10) {
                Text(loadError).foregroundStyle(.red)
                Button("Spróbuj ponownie") { Task { await load() } }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let shares {
            if shares.isEmpty {
                ContentUnavailableView("Brak linków", systemImage: "link",
                                       description: Text("Ta marka nie ma jeszcze linków do pobrania."))
            } else {
                let active = shares.filter { $0.status == "active" }
                let inactive = shares.filter { $0.status != "active" }
                List {
                    Section("Aktywne (\(active.count))") {
                        if active.isEmpty { Text("Brak aktywnych linków.").foregroundStyle(.secondary) }
                        ForEach(active) { share in row(share) }
                    }
                    if !inactive.isEmpty {
                        Section("Nieaktywne — wygasłe i wyłączone (\(inactive.count))") {
                            ForEach(inactive) { share in row(share) }
                        }
                    }
                }
                .listStyle(.inset)
            }
        } else {
            ProgressView("Wczytuję linki…").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func row(_ share: MaterialShare) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline) {
                Text(share.title).font(.callout.weight(.semibold)).lineLimit(1)
                Spacer()
                Text(MaterialShareText.statusLabel(share.status))
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Capsule().fill(share.status == "active" ? Color.green.opacity(0.18) : Color.primary.opacity(0.1)))
                    .foregroundStyle(share.status == "active" ? Color.green : Color.secondary)
            }
            Text(share.items.map { "\(MaterialShareText.kindName($0.kind)) „\($0.name)”" + ($0.missing ? " (usunięty)" : "") }.joined(separator: ", ")
                 + " · " + MaterialShareText.summary(fileCount: share.fileCount, totalBytes: share.totalBytes))
                .font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Text(details(share)).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                Button { MaterialShareText.copy(share.url); state.succeed("Skopiowano link") } label: { Label("Kopiuj link", systemImage: "doc.on.doc") }
                Button {
                    MaterialShareText.copy(MaterialShareText.message(share, password: nil, companyName: companyName))
                    state.succeed("Skopiowano wiadomość (bez hasła)")
                } label: { Label("Kopiuj wiadomość", systemImage: "text.bubble") }
                Button { if let url = URL(string: share.url) { NSWorkspace.shared.open(url) } } label: { Label("Otwórz", systemImage: "safari") }
                Menu {
                    Text("Ważny od teraz przez:")
                    ForEach(MaterialShareText.days, id: \.self) { days in
                        Button(MaterialShareText.daysLabel(days)) { Task { await extend(share, days: days) } }
                    }
                } label: { Label(share.status == "active" ? "Przedłuż" : "Włącz ponownie", systemImage: "clock") }
                    .fixedSize()
                Button { editing = share } label: { Label("Zmień…", systemImage: "pencil") }
                if share.access == "password" {
                    Button { resetting = share } label: { Label("Nowe hasło…", systemImage: "key") }
                }
                if share.status == "active" {
                    Button {
                        Task {
                            if let reply = await store.saveShare("shareUpdate", ["id": .string(share.id), "revoked": .bool(true)],
                                                                 pending: "Wyłączam link", success: "Link wyłączony — adres przestał działać") {
                                replace(reply.share)
                            }
                        }
                    } label: { Label("Wyłącz", systemImage: "power") }
                }
                Button(role: .destructive) { deleting = share } label: { Label("Usuń", systemImage: "trash") }
            }
            .buttonStyle(.borderless).controlSize(.small)
        }
        .padding(.vertical, 4)
    }

    private func details(_ share: MaterialShare) -> String {
        var parts = [MaterialShareText.accessLabel(share.access) + (share.access == "password" ? ": " + share.emails.joined(separator: ", ") : "")]
        switch share.status {
        case "revoked": parts.append("wyłączony \(MaterialsText.dateLabel(share.revokedAt))")
        case "expired": parts.append("wygasł \(MaterialsText.dateLabel(share.expiresAt))")
        default: parts.append("ważny do \(MaterialsText.dateLabel(share.expiresAt))")
        }
        var stats = "Otwarcia: \(share.viewCount) · pobrania: \(share.downloadCount)"
        if let last = share.lastDownloadedAt { stats += " (ostatnio \(MaterialsText.dateLabel(last)))" }
        parts.append(stats)
        if !share.openedBy.isEmpty { parts.append("Otworzyli: " + share.openedBy.joined(separator: ", ")) }
        parts.append("Utworzył(a): \(share.createdBy ?? "—"), \(MaterialsText.dateLabel(share.createdAt))")
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            shares = try await store.shares(company: companyID)
            loadError = nil
        } catch {
            loadError = store.failureText(error, "Nie udało się pobrać linków.")
        }
    }

    private func replace(_ share: MaterialShare) {
        if let index = shares?.firstIndex(where: { $0.id == share.id }) { shares?[index] = share }
    }

    private func extend(_ share: MaterialShare, days: Int) async {
        var body: [String: JSONValue] = ["id": .string(share.id), "days": .number(Double(days))]
        if share.revokedAt != nil { body["revoked"] = .bool(false) }
        let success = share.status == "active" ? "Link ważny jeszcze \(MaterialShareText.daysLabel(days))" : "Link znów działa — \(MaterialShareText.daysLabel(days))"
        if let reply = await store.saveShare("shareUpdate", body, pending: "Zapisuję ważność linku", success: success) { replace(reply.share) }
    }
}

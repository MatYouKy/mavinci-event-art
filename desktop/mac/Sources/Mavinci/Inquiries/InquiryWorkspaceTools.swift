import SwiftUI
import AppKit

// MARK: Karta zapytania, część 2 — korespondencja (dołączanie i wykluczanie maili), e-mail do klienta ze skrzynki firmy
// (z „Popraw z AI”, podglądem stopki, załącznikami i planowaniem), analiza i rozmowa z AI (zatwierdzenie podsumowania do
// oferty, odczyt liczby osób z korespondencji), klient i organizacja, zadania, zespół oraz utworzenie wydarzenia /
// przygotowanie realizacji. Te same zapisy co strona `/crm/inquiries/[id]` — serwer: `src/lib/native/inquiryWorkspaceTools.ts`.

// MARK: Dane

struct InquiryMailRef: Decodable, Hashable {
    var id: String
    var type: String
    var key: String { "\(type):\(id)" }
}

struct InquiryMail: Decodable, Identifiable, Hashable {
    var id: String
    var type: String
    var subject: String
    var from: String
    var to: String
    var at: String?
    var body: String
    var clean: String
    var trimmed: Bool
    var key: String { "\(type):\(id)" }
}

struct InquiryCorrespondenceData: Decodable {
    var messages: [InquiryMail]
    var excluded: [InquiryMailRef]
    var signature: String
    var canManage: Bool
}

/// Wynik wyszukiwania albo wiadomość z wątku (bez treści).
struct InquiryMailHit: Decodable, Identifiable, Hashable {
    var id: String
    var type: String
    var subject: String
    var from: String?
    var to: String?
    var at: String?
    var key: String { "\(type):\(id)" }
}

struct InquiryAIItem: Decodable, Hashable {
    var text: String
    var label: String
    var sources: [InquiryMailRef]
}

struct InquiryAnalysis: Decodable, Identifiable {
    var id: String
    var at: String?
    var question: String
    var reply: String
    var summary: String
    var eventGoal: String
    var assumptions: [InquiryAIItem]
    var clientNeeds: [InquiryAIItem]
    var missing: [InquiryAIItem]
    var estimate: String
    var estimateSummary: String
    var estimateBasis: [InquiryAIItem]
    var products: [InquiryAIItem]
    var nextActions: [InquiryAIItem]
    var resources: [InquiryAIItem]
    var risks: [InquiryAIItem]
    var findings: [InquiryAIItem]
    var findingsCount: Int
}

struct InquiryAnalysisData: Decodable {
    struct Approved: Decodable {
        var summary: String
        var at: String?
        var analysisId: String
    }
    var analyses: [InquiryAnalysis]
    var approved: Approved?
    var approvedCurrent: Bool
    var briefRevision: Int
    var messageCount: Int
    var canManage: Bool
}

struct InquiryGuests: Decodable {
    var kind: String
    var text: String
    var evidence: String
    var count: Int?
}

struct InquiryPerson: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var active: Bool?
}

struct InquiryTeamData: Decodable {
    struct Owner: Decodable { var id: String; var name: String }
    var owner: Owner?
    var members: [InquiryPerson]
    var candidates: [InquiryPerson]
    var canManageTeam: Bool
    var isMember: Bool
}

struct InquiryTasksData: Decodable {
    struct Item: Decodable, Identifiable {
        var id: String
        var title: String
        var description: String
        var priority: String
        var column: String
        var dueDate: String?
        var createdAt: String?
        var assignees: [String]
    }
    var tasks: [Item]
    var employees: [InquiryPerson]
    var canManage: Bool
}

struct InquiryEmailSetup: Decodable {
    struct Account: Decodable, Identifiable, Hashable { var id: String; var label: String }
    var accounts: [Account]
    var accountId: String
    var to: String
    var subject: String
    var text: String
}

struct InquiryClientRecord: Decodable, Identifiable, Hashable {
    var id: String
    var name: String
    var email: String?
    var type: String?
}

struct InquiryClientSetup: Decodable {
    var contact: InquiryClientRecord?
    var organization: InquiryClientRecord?
    var contactId: String?
    var organizationId: String?
    var firstName: String
    var lastName: String
    var email: String
    var phone: String
    var suggestedOrganization: InquiryClientRecord?
}

struct InquiryConvertSetup: Decodable {
    struct Option: Decodable, Identifiable, Hashable { var id: String; var name: String }
    var name: String
    var dateLocal: String
    var endNote: String
    var location: String
    var categories: [Option]
    var companies: [Option]
    var companyId: String
    var realization: Bool
    var needsClient: Bool
}

private struct InquiryHits: Decodable { var results: [InquiryMailHit] }
private struct InquiryThread: Decodable { var messages: [InquiryMailHit] }
private struct InquiryClientHits: Decodable { var results: [InquiryClientRecord] }
private struct InquiryClientReply: Decodable { var duplicate: String?; var message: String?; var results: [InquiryClientRecord]? }
private struct InquiryImproved: Decodable { var subject: String; var text: String }
private struct InquiryEventReply: Decodable { var eventId: String }

extension InquiriesStore {
    /// Odczyt zakładki karty zapytania (`GET /inquiries?op=…&id=…`).
    func workspaceGet<T: Decodable>(_ type: T.Type, _ op: String, _ id: String, _ query: [String: String] = [:]) async throws -> T {
        guard let api else { throw AppError.configuration }
        var parameters = query
        parameters["op"] = op
        parameters["id"] = id
        return try JSONDecoder().decode(T.self, from: try await api.get("/inquiries", query: parameters))
    }

    /// Zapis z karty z odpowiedzią serwera (błąd jako wyjątek — okno pokazuje go przy polach); `pending` — okno postępu.
    func workspacePost<T: Decodable>(_ type: T.Type, _ op: String, _ id: String, _ extra: [String: JSONValue] = [:],
                                     pending: String? = nil, timeout: TimeInterval? = nil, refresh: Bool = true) async throws -> T {
        guard let api, let workspace else { throw AppError.configuration }
        guard workspace.canWrite else {
            throw NativeFailure(status: 0, message: "Zmiany wymagają połączenia z serwerem CRM.", fieldErrors: [:])
        }
        var body = extra
        body["op"] = .string(op)
        body["id"] = .string(id)
        let data: Data
        if let pending {
            data = try await workspace.withPending(pending) { try await api.post("/inquiries", body, timeout: timeout) }
        } else {
            data = try await api.post("/inquiries", body, timeout: timeout)
        }
        if refresh { Task { await sync(force: true) } }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: Elementy wspólne

@MainActor struct InquiryCard<Content: View>: View {
    let title: String
    let content: Content
    @Environment(\.crmTheme) private var theme

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            content
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.04), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(theme.accent.opacity(0.12)))
    }
}

private func inquiryDate(_ value: String?) -> String {
    value.flatMap(MeetingDates.parse).map(InquiryFormat.full) ?? ""
}

/// Wiadomość w CRM (pełny podgląd z załącznikami i odpowiedzią w module Wiadomości przeglądarki).
@MainActor private func openMail(_ state: Workspace, _ type: String, _ id: String) {
    state.openCRM("/crm/messages/\(id)?type=\(type)")
}

// MARK: Korespondencja

@MainActor struct InquiryCorrespondenceTab: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let canManage: Bool
    /// Klient ma adres e-mail (jak „Napisz e-mail” w CRM).
    let canCompose: Bool
    let openAnalysis: () -> Void
    let compose: () -> Void
    @EnvironmentObject private var state: Workspace
    @State private var data: InquiryCorrespondenceData?
    @State private var problem: String?
    @State private var loading = false
    @State private var loadedAt: Date?
    @State private var picking = false
    @State private var expanded: Set<String> = []
    @State private var full: Set<String> = []
    @State private var mutating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Text("Korespondencja (\(data?.messages.count ?? 0))").font(.headline)
                Spacer()
                Button { Task { await load() } } label: { Image(systemName: "arrow.clockwise") }
                    .help("Odśwież korespondencję").disabled(loading)
                if canManage {
                    Button { compose() } label: { Label("Napisz e-mail", systemImage: "envelope") }.disabled(!canCompose)
                    Button { picking.toggle() } label: { Label("Dołącz wiadomość lub konwersację", systemImage: "plus") }
                        .disabled(mutating)
                    Button("Otwórz analizę") { openAnalysis() }.disabled(loading || (data?.messages.isEmpty ?? true))
                }
            }
            Text("Wiadomości są uporządkowane od najstarszej. Kolejne odpowiedzi pojawiają się po odświeżeniu. Powiązania pozostają przy zapytaniu również po utworzeniu eventu. Analiza obejmuje treść maili, bez zawartości załączników.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let loadedAt {
                Text(loading ? "Sprawdzam nowe wiadomości…" : "Ostatnia aktualizacja: \(MeetingDates.format(loadedAt, "HH:mm:ss"))")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
            if let problem { Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            if picking && canManage {
                InquiryMailPicker(store: store, inquiryID: inquiryID) { message, thread in
                    await change(message.type, message.id, thread: thread, excluded: false, success: "Korespondencja została powiązana z zapytaniem.")
                    picking = false
                }
            }
            if let data {
                if data.messages.isEmpty {
                    Text("Brak powiązanych wiadomości dostępnych w Twoich skrzynkach.").foregroundStyle(.secondary)
                }
                ForEach(data.messages, id: \.key) { message in row(message) }
                if canManage && !data.excluded.isEmpty {
                    DisclosureGroup("Wykluczone wiadomości (\(data.excluded.count))") {
                        ForEach(Array(data.excluded.enumerated()), id: \.element.key) { index, message in
                            HStack {
                                Button("Otwórz wykluczoną wiadomość \(index + 1)") { openMail(state, message.type, message.id) }.buttonStyle(.link)
                                Spacer()
                                Button("Przywróć") {
                                    Task { await change(message.type, message.id, thread: true, excluded: false, success: "Wiadomość przywrócona do korespondencji.") }
                                }
                                .disabled(mutating)
                            }
                        }
                    }
                    .foregroundStyle(.secondary)
                }
            } else if problem == nil {
                ProgressView("Wczytywanie korespondencji…")
            }
        }
        .task(id: inquiryID) { await load() }
    }

    private func row(_ message: InquiryMail) -> some View {
        let open = Binding(get: { expanded.contains(message.key) }, set: { if $0 { expanded.insert(message.key) } else { expanded.remove(message.key) } })
        let showFull = full.contains(message.key) || !message.trimmed
        let content = showFull ? message.body : message.clean
        return DisclosureGroup(isExpanded: open) {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(message.from) → \(message.to)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                Text(content.isEmpty ? "Brak treści wiadomości." : content)
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    .foregroundStyle(content.isEmpty ? .secondary : .primary)
                HStack(spacing: 14) {
                    if message.trimmed {
                        Button(showFull ? "Pokaż tylko treść" : "Pokaż całą wiadomość") {
                            if full.contains(message.key) { full.remove(message.key) } else { full.insert(message.key) }
                        }
                        .help("Stopki, klauzule poufności i cytowane wcześniejsze wiadomości")
                    }
                    Button("Otwórz wiadomość") { openMail(state, message.type, message.id) }
                    if canManage {
                        Button("Wyklucz wiadomość") {
                            Task { await change(message.type, message.id, thread: true, excluded: true, success: "Wiadomość wykluczona z korespondencji i analizy.") }
                        }
                        .disabled(mutating)
                    }
                }
                .buttonStyle(.link).font(.caption)
            }
            .padding(.top, 4)
        } label: {
            HStack(spacing: 6) {
                Text(message.type == "received" ? "Odebrane" : "Wysłane").foregroundStyle(message.type == "received" ? Color.accentColor : Color.green)
                Text("· \(inquiryDate(message.at)) · \(message.subject.isEmpty ? "(bez tematu)" : message.subject)").lineLimit(1)
            }
            .font(.callout)
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            data = try await store.workspaceGet(InquiryCorrespondenceData.self, "correspondence", inquiryID)
            loadedAt = Date()
            problem = nil
        } catch {
            // Po utracie dostępu do skrzynki nie pokazujemy wcześniej pobranych maili.
            data = nil
            problem = store.failureText(error, "Nie udało się odświeżyć korespondencji. Spróbuj ponownie.")
        }
    }

    private func change(_ type: String, _ id: String, thread: Bool, excluded: Bool, success: String) async {
        mutating = true
        defer { mutating = false }
        do {
            _ = try await store.workspacePost([String: JSONValue].self, "workspaceLinkEmail", inquiryID,
                                              ["type": .string(type), "messageId": .string(id), "thread": .bool(thread), "excluded": .bool(excluded)],
                                              pending: "Zapisywanie powiązania…")
            state.succeed(success)
            await load()
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać powiązania. Spróbuj ponownie.")
        }
    }
}

/// „Dołącz wiadomość lub konwersację” — wyszukiwanie po temacie, podgląd wątku, cały wątek albo jedna wiadomość.
@MainActor private struct InquiryMailPicker: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let attach: (InquiryMailHit, Bool) async -> Void
    @State private var query = ""
    @State private var results: [InquiryMailHit] = []
    @State private var selected: InquiryMailHit?
    @State private var thread: [InquiryMailHit] = []
    @State private var wholeThread = true
    @State private var busy = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                TextField("Temat wiadomości", text: $query, prompt: Text("Wyszukaj po temacie maila…"))
                    .textFieldStyle(.roundedBorder).onSubmit { Task { await search() } }
                Button { Task { await search() } } label: { Label("Szukaj", systemImage: "magnifyingglass") }
                    .disabled(busy || query.trimmingCharacters(in: .whitespaces).count < 3)
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.orange) }
            if busy { ProgressView().controlSize(.small) }
            if let selected {
                VStack(alignment: .leading, spacing: 8) {
                    Text(selected.subject.isEmpty ? "(bez tematu)" : selected.subject).font(.callout.weight(.medium))
                    Toggle("Dołącz całą konwersację (\(thread.count) wiadomości), także kolejne odpowiedzi", isOn: $wholeThread)
                    Text("Łączymy odpowiedzi w wątku oraz wiadomości o tym samym temacie i z tym samym rozmówcą w tej skrzynce. Prefiksy Re:, Odp: i Fwd: nie zmieniają tematu.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    ForEach(wholeThread ? thread : [selected], id: \.key) { message in
                        Text("\(inquiryDate(message.at)) · \(message.subject)").font(.caption).foregroundStyle(.secondary)
                    }
                    HStack {
                        Button(wholeThread ? "Dołącz konwersację" : "Dołącz wiadomość") {
                            Task {
                                busy = true
                                await attach(selected, wholeThread)
                                busy = false
                            }
                        }
                        .buttonStyle(.borderedProminent).disabled(busy)
                        Button("Wróć do wyników") { self.selected = nil }.disabled(busy)
                    }
                }
            } else {
                ForEach(results, id: \.key) { message in
                    Button { Task { await choose(message) } } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(message.subject.isEmpty ? "(bez tematu)" : message.subject).foregroundStyle(.primary)
                            Text("\(message.type == "received" ? "Odebrane" : "Wysłane") · \(inquiryDate(message.at)) · \(message.from ?? "") → \(message.to ?? "")")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).disabled(busy)
                }
            }
        }
        .padding(12)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 3, !busy else { return }
        busy = true; problem = nil; selected = nil; results = []
        defer { busy = false }
        do {
            results = try await store.workspaceGet(InquiryHits.self, "emailSearch", inquiryID, ["query": text]).results
            if results.isEmpty { problem = "Nie znaleziono wiadomości o takim temacie w dostępnych skrzynkach." }
        } catch {
            problem = store.failureText(error, "Wyszukiwanie korespondencji jest chwilowo niedostępne. Spróbuj ponownie później.")
        }
    }

    private func choose(_ message: InquiryMailHit) async {
        busy = true; problem = nil
        defer { busy = false }
        do {
            thread = try await store.workspaceGet(InquiryThread.self, "emailThread", inquiryID, ["type": message.type, "messageId": message.id]).messages
            wholeThread = true
            selected = message
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać konwersacji. Spróbuj ponownie.")
        }
    }
}

// MARK: Analiza i rozmowa z AI

@MainActor struct InquiryAnalysisTab: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    @EnvironmentObject private var state: Workspace
    @State private var data: InquiryAnalysisData?
    @State private var problem: String?
    @State private var message = ""
    @State private var requestText: String?
    @State private var requestID = ""
    @State private var sending = false

    private static let defaultHint = "Zostaw puste, aby przeanalizować zapytanie i całą korespondencję: założenia, potrzeby, pytania, propozycje oraz szacunkową kalkulację."

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            InquiryCard("Analiza i rozmowa z AI") {
                Text("Jedno miejsce na analizę zapytania, korespondencji i doprecyzowanie ustaleń. Rozmowa i kolejne podsumowania są zapisywane przy zapytaniu.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let problem { Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
                if let data {
                    if let approved = data.approved {
                        VStack(alignment: .leading, spacing: 6) {
                            Label(data.approvedCurrent ? "Zatwierdzone do oferty / kalkulacji" : "Poprzednio zatwierdzone podsumowanie — sprawdź nowe ustalenia",
                                  systemImage: "checkmark.seal.fill")
                                .foregroundStyle(data.approvedCurrent ? Color.green : Color.orange)
                            Text(approved.summary).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                            Text(inquiryDate(approved.at)).font(.caption2).foregroundStyle(.tertiary)
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.green.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                    }
                    if let latest = data.analyses.first {
                        Text("Aktualne podsumowanie przed ofertą / kalkulacją").font(.subheadline.weight(.semibold))
                        InquiryAnalysisResultView(analysis: latest)
                        if data.canManage {
                            Button("Zatwierdź do oferty / kalkulacji") { Task { await approve(latest) } }
                                .buttonStyle(.borderedProminent).disabled(sending || data.approvedCurrent)
                                .help("Zatwierdzone podsumowanie trafia do nowej oferty i kalkulacji")
                        }
                    } else {
                        Text("Nie ma jeszcze analizy. Rozpocznij od podsumowania dostępnych informacji.").foregroundStyle(.secondary)
                    }
                    if !data.analyses.isEmpty { history(data) }
                    if data.canManage { form(data) }
                } else if problem == nil {
                    ProgressView("Wczytywanie analizy…")
                }
            }
        }
        .task(id: inquiryID) { await load() }
    }

    private func history(_ data: InquiryAnalysisData) -> some View {
        DisclosureGroup("Zapisana rozmowa i historia analiz (\(data.analyses.count)\(data.analyses.count == 30 ? ", ostatnie 30" : ""))") {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(data.analyses.reversed()) { turn in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(inquiryDate(turn.at)).font(.caption2).foregroundStyle(.tertiary)
                        Text("Ty: \(turn.question)").foregroundStyle(Color.accentColor).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        Text("AI: \(turn.reply)").textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        DisclosureGroup("Podsumowanie z tej analizy") { InquiryAnalysisResultView(analysis: turn) }
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            .padding(.top, 6)
        }
        .foregroundStyle(.secondary)
    }

    private func form(_ data: InquiryAnalysisData) -> some View {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        let action: String = !text.isEmpty ? "Wyślij do AI" : data.analyses.isEmpty ? "Przeanalizuj zapytanie" : "Odśwież analizę"
        let progress: String = text.isEmpty ? "AI analizuje zapytanie i korespondencję…" : "AI przygotowuje odpowiedź…"
        return VStack(alignment: .leading, spacing: 8) {
            Text("Doprecyzuj ustalenia lub zadaj pytanie (opcjonalnie)").font(.callout)
            TextEditor(text: $message).font(.body).frame(minHeight: 70, maxHeight: 140)
                .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.12)))
                .disabled(sending)
            Text(Self.defaultHint).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Button {
                    Task { await ask() }
                } label: {
                    if sending {
                        HStack(spacing: 6) { ProgressView().controlSize(.small); Text(progress) }
                    } else {
                        Label(action, systemImage: "sparkles")
                    }
                }
                .buttonStyle(.borderedProminent).disabled(sending || message.count > 4000)
                if data.messageCount > 0 { Text("Korespondencja: \(data.messageCount) wiadomości").font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(.top, 6)
    }

    private func load() async {
        do {
            data = try await store.workspaceGet(InquiryAnalysisData.self, "analysis", inquiryID)
            problem = nil
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać analiz zapytania.")
        }
    }

    private func ask() async {
        let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
        // Ponowienie tego samego pytania po błędzie używa tego samego identyfikatora (AI nie zapisze tury dwa razy).
        if requestText != text { requestText = text; requestID = UUID().uuidString.lowercased() }
        sending = true; problem = nil
        defer { sending = false }
        do {
            data = try await store.workspacePost(InquiryAnalysisData.self, "workspaceAsk", inquiryID,
                                                 ["message": .string(text), "requestId": .string(requestID)], timeout: 240, refresh: false)
            message = ""
            requestText = nil
            state.succeed(text.isEmpty ? "Analiza zapytania została zaktualizowana" : "AI odpowiedziało — rozmowa zapisana przy zapytaniu")
        } catch {
            problem = store.failureText(error, "Nie udało się uzyskać odpowiedzi. Spróbuj ponownie.")
        }
    }

    private func approve(_ analysis: InquiryAnalysis) async {
        guard let data else { return }
        sending = true
        defer { sending = false }
        do {
            _ = try await store.workspacePost([String: JSONValue].self, "workspaceApprove", inquiryID,
                                              ["analysisId": .string(analysis.id), "revision": .number(Double(data.briefRevision))],
                                              pending: "Zatwierdzanie podsumowania…")
            state.succeed("Podsumowanie zostało zatwierdzone do oferty i kalkulacji.")
            await load()
        } catch {
            problem = store.failureText(error, "Nie udało się zatwierdzić podsumowania.")
        }
    }
}

/// Wynik analizy jak `RecommendationView`: podsumowanie, założenia, potrzeby, pytania, szacunek, propozycje, działania,
/// ustalenia z korespondencji (ze źródłami), zasoby i ryzyka.
@MainActor struct InquiryAnalysisResultView: View {
    let analysis: InquiryAnalysis
    @EnvironmentObject private var state: Workspace

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            block("Podsumowanie zapytania i korespondencji") {
                Text(analysis.summary).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if !analysis.eventGoal.isEmpty { Text("Cel eventu: \(analysis.eventGoal)").font(.callout).foregroundStyle(.secondary) }
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10, alignment: .top), GridItem(.flexible(), spacing: 10, alignment: .top)], alignment: .leading, spacing: 10) {
                list("Założenia eventu", analysis.assumptions)
                if !analysis.clientNeeds.isEmpty { list("Potrzeby klienta", analysis.clientNeeds) }
                list("Co trzeba doprecyzować", analysis.missing)
                block("Szacunkowa kalkulacja") {
                    Text(analysis.estimate).font(.title3).foregroundStyle(Color.accentColor)
                    if !analysis.estimateSummary.isEmpty { Text(analysis.estimateSummary).font(.callout).fixedSize(horizontal: false, vertical: true) }
                    items(analysis.estimateBasis)
                    Text("Wstępny szacunek na podstawie dostępnych cen i założeń. Wymaga doprecyzowania przed ofertą.").font(.caption2).foregroundStyle(.tertiary)
                }
                list("Co możemy zaproponować", analysis.products)
                list("Następne działania", analysis.nextActions)
            }
            if !analysis.findings.isEmpty {
                DisclosureGroup("Ustalenia i źródła (\(analysis.findingsCount) wiadomości)") { items(analysis.findings).padding(.top, 4) }
                    .foregroundStyle(.secondary)
            }
            DisclosureGroup("Zasoby i ryzyka") {
                HStack(alignment: .top, spacing: 10) {
                    list("Sugerowane zasoby", analysis.resources)
                    list("Ryzyka", analysis.risks)
                }
                .padding(.top, 4)
            }
            .foregroundStyle(.secondary)
        }
    }

    private func block<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.callout.weight(.semibold)).foregroundStyle(.primary)
            content()
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func list(_ title: String, _ values: [InquiryAIItem]) -> some View {
        block(title) {
            if values.isEmpty { Text("Brak").font(.caption).foregroundStyle(.secondary) } else { items(values) }
        }
    }

    private func items(_ values: [InquiryAIItem]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(values.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("•").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        if !item.label.isEmpty { Text(item.label).font(.caption2).foregroundStyle(Color.accentColor) }
                        Text(item.text).font(.callout).foregroundStyle(.primary).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        if !item.sources.isEmpty {
                            HStack(spacing: 10) {
                                ForEach(Array(item.sources.enumerated()), id: \.element.key) { index, source in
                                    Button("\(source.type == "received" ? "E-mail odebrany" : "E-mail wysłany")\(item.sources.count > 1 ? " (\(index + 1))" : "")") {
                                        openMail(state, source.type, source.id)
                                    }
                                    .buttonStyle(.link).font(.caption2)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// „Odczytaj z korespondencji (AI)” przy liczbie osób — cytat ze źródła; przedziału ani szacunku nie przyjmujemy automatycznie.
@MainActor struct InquiryGuestsReader: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let apply: (Int) async -> Bool
    @State private var result: InquiryGuests?
    @State private var problem: String?
    @State private var reading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                Task { await read() }
            } label: {
                if reading { HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Odczytuję liczbę osób z korespondencji…") } }
                else { Label("Odczytaj liczbę osób z korespondencji (AI)", systemImage: "person.2.badge.gearshape") }
            }
            .buttonStyle(.link).disabled(reading)
            if let problem { Text(problem).font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            if let result {
                VStack(alignment: .leading, spacing: 4) {
                    Text(result.kind == "unknown" ? "Nie znaleziono jednoznacznej liczby uczestników. Wpisz ją ręcznie po ustaleniu z klientem." : "Znaleziono: \(result.text)")
                    if !result.evidence.isEmpty { Text("„\(result.evidence)”").italic().foregroundStyle(.secondary) }
                    if result.kind == "approximate" { Text("To liczba przybliżona. Możesz przyjąć ją do wyceny.").foregroundStyle(.secondary) }
                    if result.kind == "range" { Text("Klient podał przedział. Wpisz ustaloną liczbę do wyceny — nie wybieramy automatycznie średniej ani maksimum.").foregroundStyle(.secondary) }
                    if let count = result.count, result.kind != "range" {
                        Button("Użyj \(count) osób w zapytaniu") { Task { if await apply(count) { self.result = nil } } }.buttonStyle(.link)
                    }
                }
                .font(.caption).fixedSize(horizontal: false, vertical: true)
                .padding(8).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func read() async {
        reading = true; problem = nil; result = nil
        defer { reading = false }
        do {
            result = try await store.workspacePost(InquiryGuests.self, "workspaceGuests", inquiryID, timeout: 240, refresh: false)
        } catch {
            problem = store.failureText(error, "Nie udało się odczytać liczby osób. Spróbuj ponownie.")
        }
    }
}

// MARK: Zadania zapytania

private struct InquiryTaskOption: Identifiable, Hashable { let id: String; let label: String }
private let inquiryTaskPriorities = [InquiryTaskOption(id: "low", label: "Niski"), InquiryTaskOption(id: "medium", label: "Średni"),
                                     InquiryTaskOption(id: "high", label: "Wysoki"), InquiryTaskOption(id: "urgent", label: "Pilny")]
private let inquiryTaskColumns = [InquiryTaskOption(id: "todo", label: "Do zrobienia"), InquiryTaskOption(id: "in_progress", label: "W trakcie"),
                                  InquiryTaskOption(id: "review", label: "Do sprawdzenia"), InquiryTaskOption(id: "completed", label: "Zakończone")]

@MainActor struct InquiryTasksTab: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    @EnvironmentObject private var state: Workspace
    @State private var data: InquiryTasksData?
    @State private var problem: String?
    @State private var creating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Zadania zespołu przy tym zapytaniu — przypomnienia, ustalenia, przygotowanie oferty.").font(.callout).foregroundStyle(.secondary)
                Spacer()
                if data?.canManage == true {
                    Button { creating = true } label: { Label("Nowe zadanie", systemImage: "plus") }.buttonStyle(.borderedProminent)
                }
            }
            if let problem { Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange) }
            if let data {
                if data.tasks.isEmpty { Text("Brak zadań dla tego zapytania.").foregroundStyle(.secondary) }
                ForEach(data.tasks) { task in row(task) }
            } else if problem == nil {
                ProgressView("Wczytywanie zadań…")
            }
        }
        .task(id: inquiryID) { await load() }
        .sheet(isPresented: $creating) {
            InquiryTaskSheet(employees: data?.employees ?? []) { body in
                do {
                    _ = try await store.workspacePost([String: JSONValue].self, "workspaceTask", inquiryID, body, pending: "Zapisywanie zadania…")
                    state.succeed("Zadanie zostało utworzone")
                    await load()
                    return nil
                } catch {
                    return store.failureText(error, "Błąd podczas zapisywania zadania")
                }
            }
        }
    }

    private func row(_ task: InquiryTasksData.Item) -> some View {
        let done = task.column == "completed"
        let due = task.dueDate.flatMap(MeetingDates.parse)
        return Button { state.open(.tasks, id: task.id) } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle").foregroundStyle(done ? Color.green : Color.secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(task.title).font(.callout.weight(.medium)).strikethrough(done).foregroundStyle(.primary)
                    HStack(spacing: 8) {
                        Text(inquiryTaskColumns.first { $0.id == task.column }?.label ?? task.column)
                        Text("Priorytet: \(inquiryTaskPriorities.first { $0.id == task.priority }?.label ?? task.priority)")
                        if let due { Text("Termin: \(InquiryFormat.full(due))").foregroundStyle(!done && due < Date() ? Color.red : Color.secondary) }
                        if !task.assignees.isEmpty { Text(task.assignees.joined(separator: ", ")).lineLimit(1) }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(10).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }

    private func load() async {
        do {
            data = try await store.workspaceGet(InquiryTasksData.self, "tasks", inquiryID)
            problem = nil
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać zadań zapytania.")
        }
    }
}

private struct InquiryTaskSheet: View {
    let employees: [InquiryPerson]
    /// Zwraca komunikat błędu albo `nil` po zapisaniu.
    let save: ([String: JSONValue]) async -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var priority = "medium"
    @State private var column = "todo"
    @State private var hasDue = false
    @State private var due = Calendar.current.date(byAdding: .day, value: 1, to: Date()) ?? Date()
    @State private var assignees: Set<String> = []
    @State private var search = ""
    @State private var saving = false
    @State private var problem: String?

    private var people: [InquiryPerson] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return employees.filter { query.isEmpty || $0.name.lowercased().contains(query) || assignees.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Nowe zadanie w zapytaniu").font(.title3.bold()).padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                Section {
                    MeetingTextField("Tytuł", text: $title, prompt: "Co trzeba zrobić")
                    TextField("Opis", text: $description, prompt: Text("Szczegóły (opcjonalnie)"), axis: .vertical).lineLimit(3...8)
                    Picker("Priorytet", selection: $priority) { ForEach(inquiryTaskPriorities) { Text($0.label).tag($0.id) } }
                    Picker("Kolumna", selection: $column) { ForEach(inquiryTaskColumns) { Text($0.label).tag($0.id) } }
                    Toggle("Termin", isOn: $hasDue)
                    if hasDue {
                        DatePicker("Do kiedy", selection: $due, displayedComponents: [.date, .hourAndMinute])
                            .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                    }
                }
                Section("Przypisani pracownicy (\(assignees.count))") {
                    TextField("Szukaj", text: $search, prompt: Text("Imię lub nazwisko"))
                    ForEach(people) { person in
                        Toggle(person.name, isOn: Binding(get: { assignees.contains(person.id) },
                                                          set: { if $0 { assignees.insert(person.id) } else { assignees.remove(person.id) } }))
                    }
                }
            }
            .formStyle(.grouped)
            if let problem { Text(problem).foregroundStyle(.orange).padding(.horizontal, 20) }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button("Utwórz zadanie") { Task { await submit() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding(16)
        }
        .frame(width: 520, height: 620)
    }

    private func submit() async {
        saving = true; problem = nil
        defer { saving = false }
        let body: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "description": .string(description),
            "priority": .string(priority),
            "column": .string(column),
            "dueDate": hasDue ? .string(MeetingDates.iso(due)) : .null,
            "assignees": .array(assignees.sorted().map { .string($0) }),
        ]
        if let failure = await save(body) { problem = failure } else { dismiss() }
    }
}

// MARK: Zespół zapytania

@MainActor struct InquiryTeamTab: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    @EnvironmentObject private var state: Workspace
    @State private var data: InquiryTeamData?
    @State private var problem: String?
    @State private var search = ""
    @State private var selected = ""
    @State private var busy = false

    private var candidates: [InquiryPerson] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        return (data?.candidates ?? []).filter { query.isEmpty || $0.name.lowercased().contains(query) }
    }

    var body: some View {
        InquiryCard("Zespół zapytania") {
            Text("Opiekun prowadzi sprzedaż. Współpracownicy pomagają w ustaleniach, zadaniach, ofertach i kalkulacjach tego zapytania.")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Text("Dostęp do skrzynek pocztowych pozostaje zgodny z indywidualnymi uprawnieniami.").font(.caption).foregroundStyle(.secondary)
            if let problem {
                Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
                Button("Spróbuj ponownie") { Task { await load() } }.buttonStyle(.link)
            }
            if let data {
                HStack {
                    Text(data.owner?.name ?? "Brak opiekuna")
                    Spacer()
                    Text("Opiekun").font(.caption).foregroundStyle(Color.accentColor)
                }
                .padding(10).background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
                ForEach(data.members) { person in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.name)
                            Text(person.active == false ? "Konto nieaktywne" : "Współpracownik").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if data.canManageTeam {
                            Button("Usuń", systemImage: "xmark") { Task { await save(person.id, active: false) } }.disabled(busy)
                                .help("Usuń z zespołu: \(person.name)")
                        }
                    }
                    .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
                if data.members.isEmpty { Text("Nie dodano jeszcze współpracowników.").foregroundStyle(.secondary) }
                if data.canManageTeam {
                    Divider()
                    Text("Dodaj pracownika do zespołu").font(.callout.weight(.medium))
                    if data.owner == nil {
                        Text("Najpierw przypisz opiekuna zapytania.").foregroundStyle(.secondary)
                    } else {
                        TextField("Wyszukaj pracownika", text: $search, prompt: Text("Szukaj po imieniu lub nazwisku"))
                            .textFieldStyle(.roundedBorder).onChange(of: search) { _, _ in selected = "" }
                        HStack {
                            Picker("Pracownik", selection: $selected) {
                                Text("Wybierz pracownika").tag("")
                                ForEach(candidates) { Text($0.name).tag($0.id) }
                            }
                            .labelsHidden()
                            Button { Task { await save(selected, active: true) } } label: { Label(busy ? "Zapisywanie…" : "Dodaj do zespołu", systemImage: "person.badge.plus") }
                                .buttonStyle(.borderedProminent).disabled(busy || selected.isEmpty)
                        }
                        if candidates.isEmpty { Text("Brak pracowników pasujących do wyszukiwania.").font(.caption).foregroundStyle(.secondary) }
                        Text("Lista obejmuje aktywnych pracowników z kontem i dostępem do zapytań. Opiekun i osoby już dodane nie są ponownie wyświetlane.")
                            .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            } else if problem == nil {
                ProgressView("Wczytywanie zespołu…")
            }
        }
        .task(id: inquiryID) { await load() }
    }

    private func load() async {
        do {
            data = try await store.workspaceGet(InquiryTeamData.self, "team", inquiryID)
            problem = nil
        } catch {
            problem = store.failureText(error, "Nie udało się pobrać zespołu zapytania.")
        }
    }

    private func save(_ employee: String, active: Bool) async {
        guard !employee.isEmpty else { return }
        busy = true
        defer { busy = false }
        do {
            data = try await store.workspacePost(InquiryTeamData.self, "workspaceTeam", inquiryID,
                                                 ["employeeId": .string(employee), "active": .bool(active)], pending: "Zapisywanie zespołu…")
            selected = ""; search = ""
            state.succeed(active ? "Pracownik dołączył do zespołu." : "Usunięto pracownika z zespołu.")
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać zespołu.")
        }
    }
}

// MARK: E-mail do klienta (`ComposeEmailModal` w karcie zapytania)

@MainActor struct InquiryEmailSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let sent: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var state: Workspace
    @State private var setup: InquiryEmailSetup?
    @State private var loadProblem: String?
    @State private var accountId = ""
    @State private var to = ""
    @State private var cc = ""
    @State private var bcc = ""
    @State private var subject = ""
    @State private var text = ""
    @State private var attachments: [AttachmentFile] = []
    @State private var scheduled = false
    @State private var scheduledAt = ComposeSheet.defaultSchedule
    @State private var previewHTML: String?
    @State private var working: String?
    @State private var problem: String?

    private var totalSize: Int { attachments.reduce(0) { $0 + $1.size } }

    var body: some View {
        VStack(spacing: 0) {
            HStack { Text("Wiadomość do klienta").font(.title2.bold()); Spacer() }.padding([.horizontal, .top], 20).padding(.bottom, 8)
            if let setup {
                Form {
                    Section {
                        if setup.accounts.isEmpty {
                            Text("Nie masz skrzynki, z której możesz wysyłać wiadomości.").foregroundStyle(.secondary)
                        } else {
                            Picker("Od:", selection: $accountId) { ForEach(setup.accounts) { Text($0.label).tag($0.id) } }
                        }
                        TextField("Do:", text: $to, prompt: Text("email@example.com"))
                        TextField("DW:", text: $cc, prompt: Text("Opcjonalnie"))
                        TextField("UDW:", text: $bcc, prompt: Text("Opcjonalnie"))
                        TextField("Temat:", text: $subject, prompt: Text("Temat wiadomości"))
                    }
                    Section {
                        TextEditor(text: $text).font(.body).frame(minHeight: 220)
                        HStack {
                            Text("Stopka i szablon wybranej skrzynki zostaną dodane automatycznie — zobacz „Podgląd”.").font(.caption).foregroundStyle(.secondary)
                            Spacer()
                            Button { Task { await improve() } } label: { Label("Popraw z AI", systemImage: "sparkles") }
                                .disabled(working != nil || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                .help("AI poprawi język i ton — bez dopisywania cen, terminów ani obietnic")
                        }
                    } header: { Text("Wiadomość:") }
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
                            Label("Łączny rozmiar załączników przekracza 25 MB.", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.caption)
                        }
                    }
                    Section("Wysyłka") {
                        Picker("Wysyłka", selection: $scheduled) { Text("Wyślij teraz").tag(false); Text("Zaplanuj wysyłkę").tag(true) }.pickerStyle(.segmented).labelsHidden()
                        if scheduled {
                            DatePicker("Termin wysyłki", selection: $scheduledAt, in: Date()...)
                                .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                        }
                        Text("Wysłana wiadomość trafia do korespondencji zapytania i jest zapisywana jako kontakt z klientem.").font(.caption).foregroundStyle(.secondary)
                    }
                    if let problem { Section { Text(problem).foregroundStyle(.orange) } }
                }
                .formStyle(.grouped)
            } else if let loadProblem {
                ContentUnavailableView("Nie można napisać wiadomości", systemImage: "envelope.badge", description: Text(loadProblem))
                    .frame(maxHeight: .infinity)
            } else {
                ProgressView("Przygotowywanie wiadomości…").frame(maxHeight: .infinity)
            }
            HStack {
                Button { Task { await showPreview() } } label: { Label("Podgląd", systemImage: "eye") }
                    .disabled(working != nil || accountId.isEmpty)
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction).disabled(working == "send")
                Button { Task { await send() } } label: { Label(scheduled ? "Zaplanuj wysyłkę" : "Wyślij", systemImage: "paperplane") }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(working != nil || setup?.accounts.isEmpty != false)
            }
            .padding(16)
        }
        .frame(minWidth: 720, idealWidth: 760, minHeight: 640, idealHeight: 760)
        .task { await load() }
        .sheet(isPresented: Binding(get: { previewHTML != nil }, set: { if !$0 { previewHTML = nil } })) {
            VStack(spacing: 0) {
                HStack { Text("Podgląd wiadomości").font(.headline); Spacer(); Button("Zamknij") { previewHTML = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                EmailWebView(html: previewHTML ?? "")
            }
            .frame(width: 760, height: 720)
        }
        .interactiveDismissDisabled(working == "send")
        .overlay {
            if working == "send" { PendingOverlay(text: scheduled ? "Planowanie wysyłki…" : "Wysyłanie wiadomości…") }
            else if working == "improve" { PendingOverlay(text: "AI poprawia wiadomość…") }
            else if working == "preview" { PendingOverlay(text: "Przygotowywanie podglądu ze stopką…") }
        }
    }

    private func load() async {
        do {
            let next = try await store.workspaceGet(InquiryEmailSetup.self, "emailSetup", inquiryID)
            setup = next
            accountId = next.accountId
            to = next.to
            subject = next.subject
            text = next.text
        } catch {
            loadProblem = store.failureText(error, "Nie udało się przygotować wiadomości.")
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

    private func improve() async {
        working = "improve"; problem = nil
        defer { working = nil }
        do {
            let improved = try await store.workspacePost(InquiryImproved.self, "workspaceEmailImprove", inquiryID,
                                                         ["subject": .string(subject), "text": .string(text)], timeout: 120, refresh: false)
            if !improved.text.isEmpty { text = improved.text }
            if !improved.subject.isEmpty { subject = improved.subject }
        } catch {
            problem = store.failureText(error, "Nie udało się poprawić wiadomości.")
        }
    }

    private func showPreview() async {
        working = "preview"; problem = nil
        defer { working = nil }
        do {
            let reply = try await store.workspacePost([String: JSONValue].self, "workspaceEmailPreview", inquiryID,
                                                      ["accountId": .string(accountId), "subject": .string(subject), "text": .string(text)], refresh: false)
            previewHTML = reply["html"]?.text ?? ""
        } catch {
            problem = store.failureText(error, "Nie udało się przygotować podglądu.")
        }
    }

    private func send() async {
        guard !to.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !subject.trimmingCharacters(in: .whitespaces).isEmpty,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { problem = "Wypełnij wszystkie pola"; return }
        guard setup?.accounts.contains(where: { $0.id == accountId }) == true else { problem = "Wybierz konto, z którego chcesz wysłać wiadomość"; return }
        if scheduled && scheduledAt.timeIntervalSinceNow < 30 { problem = "Termin wysyłki musi przypadać w przyszłości"; return }
        if totalSize > 25 * 1024 * 1024 { problem = "Łączny rozmiar załączników przekracza 25 MB."; return }
        working = "send"; problem = nil
        defer { working = nil }
        do {
            let files: [JSONValue] = try attachments.map { file in
                .object(["filename": .string(file.name), "content": .string(try Data(contentsOf: file.url).base64EncodedString()), "contentType": .string(file.contentType)])
            }
            var body: [String: JSONValue] = [
                "accountId": .string(accountId), "to": .string(to), "cc": .string(cc), "bcc": .string(bcc),
                "subject": .string(subject), "text": .string(text), "attachments": .array(files),
            ]
            if scheduled { body["scheduledAt"] = .string(MeetingDates.iso(scheduledAt)) }
            _ = try await store.workspacePost([String: JSONValue].self, "workspaceEmailSend", inquiryID, body, timeout: 180)
            state.succeed(scheduled ? "Wiadomość zostanie wysłana \(InquiryFormat.full(scheduledAt))" : "Wiadomość została wysłana i zapisana jako kontakt")
            await sent()
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się wysłać wiadomości")
        }
    }
}

// MARK: Klient i organizacja (`InquiryClientModal`)

@MainActor struct InquiryClientSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let saved: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var setup: InquiryClientSetup?
    @State private var loadProblem: String?
    @State private var mode = "new"
    @State private var type = ""
    @State private var first = ""
    @State private var last = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var contact: InquiryClientRecord?
    @State private var query = ""
    @State private var results: [InquiryClientRecord] = []
    @State private var orgMode = "none"
    @State private var organization: InquiryClientRecord?
    @State private var orgQuery = ""
    @State private var orgResults: [InquiryClientRecord] = []
    @State private var orgName = ""
    @State private var nip = ""
    @State private var saving = false
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Klient i organizacja").font(.title2.bold())
                Text("Dane zostaną zapisane dopiero po zatwierdzeniu. Zmiana typu istniejącego kontaktu dotyczy również jego karty klienta.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            if setup != nil {
                Form {
                    Section("Kontakt") {
                        Picker("Kontakt", selection: $mode) {
                            Text("Dodaj nowy kontakt").tag("new")
                            Text("Wybierz z bazy").tag("existing")
                        }
                        if mode == "existing" {
                            TextField("Szukaj kontaktu", text: $query, prompt: Text("Szukaj po imieniu i nazwisku"))
                            if let contact { Text("Wybrano: \(contact.name)").foregroundStyle(Color.accentColor) }
                            ForEach(results) { row in
                                Button {
                                    contact = row
                                    type = (row.type?.isEmpty == false ? row.type : nil) ?? "contact"
                                    results = []
                                } label: {
                                    Text("\(row.name)\((row.email ?? "").isEmpty ? "" : " · \(row.email ?? "")")").frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        } else {
                            MeetingTextField("Imię", text: $first, prompt: "Imię")
                            MeetingTextField("Nazwisko", text: $last, prompt: "Nazwisko")
                            MeetingTextField("E-mail", text: $email, prompt: "adres@firma.pl")
                            MeetingTextField("Telefon", text: $phone, prompt: "+48 …")
                        }
                    }
                    Section {
                        Picker("Typ klienta", selection: $type) {
                            Text("Wybierz typ").tag("")
                            Text("Klient indywidualny").tag("individual")
                            Text("Kontakt firmowy").tag("contact")
                        }
                        if type == "contact" {
                            Picker("Organizacja", selection: $orgMode) {
                                Text("Powiąż później").tag("none")
                                Text("Wybierz istniejącą").tag("existing")
                                Text("Dodaj nową organizację").tag("new")
                            }
                            if orgMode == "existing" {
                                TextField("Szukaj organizacji", text: $orgQuery, prompt: Text("Szukaj organizacji po nazwie"))
                                if let organization { Text("Wybrano: \(organization.name)").foregroundStyle(Color.accentColor) }
                                ForEach(orgResults) { row in
                                    Button { organization = row; orgResults = [] } label: {
                                        Text(row.name).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
                                }
                            } else if orgMode == "new" {
                                MeetingTextField("Nazwa organizacji", text: $orgName, prompt: "Nazwa firmy")
                                MeetingTextField("NIP (opcjonalnie)", text: $nip, prompt: "np. 1234567890")
                                Text("Pozostałe dane organizacji uzupełnisz w jej karcie.").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if let problem { Section { Text(problem).foregroundStyle(.orange) } }
                }
                .formStyle(.grouped)
                .disabled(saving)
            } else if let loadProblem {
                ContentUnavailableView("Nie można zmienić klienta", systemImage: "person.crop.circle.badge.exclamationmark", description: Text(loadProblem))
                    .frame(maxHeight: .infinity)
            } else {
                ProgressView("Wczytywanie danych klienta…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz i powiąż") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving || setup == nil)
            }
            .padding(16)
        }
        .frame(width: 560, height: 640)
        .task { await load() }
        .task(id: query) { await searchContacts() }
        .task(id: orgQuery) { await searchOrganizations() }
    }

    private func load() async {
        do {
            let next = try await store.workspaceGet(InquiryClientSetup.self, "clientSetup", inquiryID)
            setup = next
            mode = next.contactId != nil ? "existing" : "new"
            type = next.organizationId != nil ? "contact" : (next.contact?.type ?? "")
            contact = next.contact
            orgMode = next.organizationId != nil ? "existing" : "none"
            organization = next.organization
            first = next.firstName; last = next.lastName; email = next.email; phone = next.phone
            if let suggested = next.suggestedOrganization { orgResults = [suggested] }
        } catch {
            loadProblem = store.failureText(error, "Nie udało się pobrać danych klienta.")
        }
    }

    private func searchContacts() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 else { if !text.isEmpty { results = [] }; return }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        do { results = try await store.workspaceGet(InquiryClientHits.self, "clientSearch", inquiryID, ["kind": "contact", "query": text]).results }
        catch { problem = store.failureText(error, "Nie udało się wyszukać kontaktów.") }
    }

    private func searchOrganizations() async {
        let text = orgQuery.trimmingCharacters(in: .whitespaces)
        guard text.count >= 2 else { if !text.isEmpty { orgResults = [] }; return }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        do { orgResults = try await store.workspaceGet(InquiryClientHits.self, "clientSearch", inquiryID, ["kind": "organization", "query": text]).results }
        catch { problem = store.failureText(error, "Nie udało się wyszukać organizacji.") }
    }

    private func save() async {
        guard let setup else { return }
        problem = nil
        if type.isEmpty { problem = "Wybierz typ klienta."; return }
        if mode == "existing" && contact == nil { problem = "Wybierz kontakt z listy."; return }
        if mode == "new" && first.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Podaj imię klienta."; return }
        if type == "contact" && orgMode == "existing" && organization == nil { problem = "Wybierz organizację."; return }
        if type == "contact" && orgMode == "new" && orgName.trimmingCharacters(in: .whitespaces).isEmpty { problem = "Podaj nazwę organizacji."; return }
        let mail = email.trimmingCharacters(in: .whitespaces)
        if mode == "new" && !mail.isEmpty && mail.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) == nil {
            problem = "Podaj poprawny adres e-mail."; return
        }
        var body: [String: JSONValue] = [
            "type": .string(type),
            "organizationMode": .string(type == "contact" ? orgMode : "none"),
            "expectedContactId": setup.contactId.map { .string($0) } ?? .null,
            "expectedOrganizationId": setup.organizationId.map { .string($0) } ?? .null,
        ]
        if mode == "existing", let contact { body["contactId"] = .string(contact.id) } else {
            body["firstName"] = .string(first); body["lastName"] = .string(last); body["email"] = .string(mail); body["phone"] = .string(phone)
        }
        if type == "contact" && orgMode == "existing", let organization { body["organizationId"] = .string(organization.id) }
        if type == "contact" && orgMode == "new" { body["organizationName"] = .string(orgName); body["nip"] = .string(nip) }
        saving = true
        defer { saving = false }
        do {
            let reply = try await store.workspacePost(InquiryClientReply.self, "workspaceClient", inquiryID, body, pending: "Zapisywanie klienta…")
            if let duplicate = reply.duplicate {
                // Bez cichego dublowania — pokazujemy istniejące rekordy do wyboru (jak w CRM).
                if duplicate == "contact" { results = reply.results ?? []; mode = "existing" } else { orgResults = reply.results ?? []; orgMode = "existing" }
                problem = reply.message
                return
            }
            await saved()
            dismiss()
        } catch {
            problem = store.failureText(error, "Nie udało się zapisać klienta.")
        }
    }
}

// MARK: Wydarzenie z zapytania (`ConvertInquiryModal`)

@MainActor struct InquiryConvertSheet: View {
    @ObservedObject var store: InquiriesStore
    let inquiryID: String
    let converted: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var setup: InquiryConvertSetup?
    @State private var loadProblem: String?
    @State private var name = ""
    @State private var hasDate = false
    @State private var date = Date()
    @State private var categoryId = ""
    @State private var companyId = ""
    @State private var saving = false
    @State private var problem: String?

    private static let localFormat: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(setup?.realization == true ? "Przygotuj realizację" : "Utwórz event z zapytania").font(.title3.bold())
            if let setup {
                Text("Dokumenty i zadania zachowają powiązania. Przy zaakceptowanej ofercie przeniesiemy wycenę oraz plan zasobów i dodamy zadanie weryfikacji dostępności. Bez akceptacji utworzymy roboczy event, pozostawiając sprzedaż otwartą.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if !setup.endNote.isEmpty { Text(setup.endNote).font(.callout) }
                if !setup.location.isEmpty { Text("Miejsce eventu: \(setup.location)").font(.callout) }
                Form {
                    MeetingTextField("Nazwa", text: $name, prompt: "Nazwa eventu")
                    Toggle("Termin ustalony", isOn: $hasDate)
                    if hasDate {
                        DatePicker("Termin *", selection: $date, displayedComponents: [.date, .hourAndMinute])
                            .environment(\.timeZone, MeetingDates.zone).environment(\.locale, Locale(identifier: "pl_PL"))
                    } else {
                        Text("Uzupełnij termin eventu — jest wymagany.").font(.caption).foregroundStyle(.orange)
                    }
                    Picker("Kategoria", selection: $categoryId) {
                        Text("Bez kategorii").tag("")
                        ForEach(setup.categories) { Text($0.name).tag($0.id) }
                    }
                    Picker("Działalność", selection: $companyId) {
                        Text("Nieprzypisana").tag("")
                        ForEach(setup.companies) { Text($0.name).tag($0.id) }
                    }
                }
                .formStyle(.grouped).frame(minHeight: 230)
                if let problem { Text(problem).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            } else if let loadProblem {
                Text(loadProblem).foregroundStyle(.orange)
            } else {
                ProgressView("Wczytywanie…")
            }
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(setup?.realization == true ? "Przygotuj realizację" : "Utwórz event") { Task { await convert() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(saving || setup == nil || !hasDate || name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(20).frame(width: 520)
        .task { await load() }
    }

    private func load() async {
        do {
            let next = try await store.workspaceGet(InquiryConvertSetup.self, "convertSetup", inquiryID)
            setup = next
            name = next.name
            companyId = next.companyId
            if let parsed = Self.localFormat.date(from: next.dateLocal) { date = parsed; hasDate = true }
        } catch {
            loadProblem = store.failureText(error, "Nie udało się przygotować eventu.")
        }
    }

    private func convert() async {
        saving = true; problem = nil
        defer { saving = false }
        do {
            let reply = try await store.workspacePost(InquiryEventReply.self, "workspaceConvert", inquiryID, [
                "name": .string(name.trimmingCharacters(in: .whitespaces)),
                "date": .string(MeetingDates.iso(date)),
                "categoryId": categoryId.isEmpty ? .null : .string(categoryId),
                "companyId": companyId.isEmpty ? .null : .string(companyId),
            ], pending: setup?.realization == true ? "Przygotowywanie realizacji…" : "Tworzenie eventu…", timeout: 120)
            dismiss()
            converted(reply.eventId)
        } catch {
            problem = store.failureText(error, "Nie udało się utworzyć eventu")
        }
    }
}

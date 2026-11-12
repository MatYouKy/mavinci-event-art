import AppKit
import PDFKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Umowa wydarzenia (`EventContractTab`) — układ jak w CRM: nagłówek z czynnościami, ścieżka statusu z następnym krokiem,
// pasek „Do sprawdzenia” i podzakładki Treść / Dane i warunki / Klauzule / Sprawdzenie / Dokumenty i historia.
// Na Macu: zmiana statusu wystawionej umowy (zasady jak w CRM), potwierdzenie podpisu firmy, podgląd PDF w zakładce, pobieranie
// i druk, podsumowanie zapisanej treści (warunki, pola zmienione dla umowy, osoby podpisujące, klauzule), podpisane dokumenty
// i wcześniejsze wersje. Treść składa i dzieli na strony edytor w CRM z aktualnych danych oferty, szablonu i klauzul — edycja,
// klauzule, szablon, depozyt, audyt AI, wystawienie szkicu, generowanie PDF, wysyłka i anulowanie otwierają się w CRM
// na właściwej podzakładce (`?tab=contract&contractSection=…`).

struct ContractTabData: Decodable {
    struct Dates: Decodable, Hashable {
        var issued: String?
        var sent: String?
        var accepted: String?
        var signedByClient: String?
        var signedReturned: String?
        var cancelled: String?
    }
    struct Contract: Decodable, Hashable {
        var id: String
        var number: String?
        var title: String
        var status: String
        var version: Int
        var lockedAt: String?
        var companySignedAt: String?
        var companySignedBy: String?
        var pdf: String?
        var pdfAt: String?
        var modified: Bool
        var createdAt: String?
        var ownContract: Bool
        var dates: Dates
    }
    struct Archived: Decodable, Identifiable, Hashable {
        var id: String
        var title: String
        var number: String?
        var version: Int
        var status: String?
        var createdAt: String?
        var pdf: String?
        var pdfAt: String?
    }
    struct SignedFile: Decodable, Identifiable, Hashable {
        var id: String
        var name: String
        var size: Double
        var mime: String
        var createdAt: String?
    }
    struct Signed: Decodable, Hashable {
        var canView: Bool
        var canUpload: Bool
        var files: [SignedFile]
        var error: String?
    }
    struct Condition: Decodable, Hashable {
        var label: String
        var value: String
    }
    struct Client: Decodable, Hashable {
        var name: String
        var company: Bool
    }
    struct ClauseItem: Decodable, Hashable {
        var topic: String
        var product: String
        var text: String
    }
    struct ClauseGroup: Decodable, Hashable, Identifiable {
        var category: String
        var label: String
        var items: [ClauseItem]
        var id: String { category }
    }
    /// Podsumowanie zapisanej treści umowy (podzakładki jak w CRM).
    struct Summary: Decodable, Hashable {
        var individuallyEdited: Bool
        var pages: Int
        var client: Client?
        var category: String?
        var conditions: [Condition]
        var changedFields: [String]
        /// `nil` — bez zapisanego wyboru (CRM bierze wszystkie osoby uprawnione z danych organizacji).
        var signers: [String]?
        var clauses: [ClauseGroup]
    }
    var isAdmin: Bool
    var canManage: Bool
    var canChangeStatus: Bool
    var templateName: String?
    var contract: Contract?
    var history: [Archived]
    var signed: Signed
    var summary: Summary?
}

enum ContractText {
    static let statuses: [String] = ["draft", "issued", "sent", "accepted", "signed_by_client", "signed_returned", "cancelled"]
    /// `CONTRACT_STATUS_FLOW` — ścieżka statusów; anulowanie jest poza nią.
    static let flow: [String] = ["draft", "issued", "sent", "accepted", "signed_by_client", "signed_returned"]

    /// `getStatusLabel`.
    static func status(_ value: String) -> String {
        switch value {
        case "draft": return "🟡 Szkic"
        case "issued": return "🟢 Wystawiona"
        case "sent": return "📤 Wysłana"
        case "accepted": return "Zaakceptowana"
        case "signed_by_client": return "✍️ Podpisana przez klienta"
        case "signed_returned": return "✅ Podpisana odesłana"
        case "cancelled": return "❌ Anulowana"
        default: return value
        }
    }

    /// `NEXT_STATUS_ACTION` — przycisk następnego kroku.
    static func nextAction(_ value: String) -> String {
        switch value {
        case "issued": return "Wystaw umowę"
        case "sent": return "Oznacz jako wysłaną"
        case "accepted": return "Oznacz jako zaakceptowaną"
        case "signed_by_client": return "Podpisana przez klienta"
        case "signed_returned": return "Podpisana i odesłana"
        default: return status(value)
        }
    }

    /// `getStatusDate`: data zmiany na bieżący status („11 listopada 2026 o 14:05”).
    static func statusDate(_ contract: ContractTabData.Contract) -> String? {
        let raw: String?
        switch contract.status {
        case "issued": raw = contract.dates.issued
        case "sent": raw = contract.dates.sent
        case "accepted": raw = contract.dates.accepted
        case "signed_by_client": raw = contract.dates.signedByClient
        case "signed_returned": raw = contract.dates.signedReturned
        case "cancelled": raw = contract.dates.cancelled
        default: raw = nil
        }
        guard let raw, let date = MeetingDates.parse(raw) else { return nil }
        return MeetingDates.format(date, "d MMMM yyyy, HH:mm")
    }

    static func date(_ value: String?) -> String {
        guard let value, let date = MeetingDates.parse(value) else { return "—" }
        return MeetingDates.format(date, "dd.MM.yyyy, HH:mm")
    }

    static func size(_ bytes: Double) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }

    static func pages(_ count: Int) -> String {
        if count == 1 { return "1 strona" }
        let few = (2...4).contains(count % 10) && !(12...14).contains(count % 100)
        return few ? "\(count) strony" : "\(count) stron"
    }
}

/// Podzakładki umowy (`CONTRACT_SECTIONS`); `rawValue` — parametr `contractSection` w adresie CRM.
enum ContractTabSection: String, CaseIterable, Identifiable {
    case content, data, clauses, review, documents
    var id: String { rawValue }
    var label: String {
        switch self {
        case .content: return "Treść"
        case .data: return "Dane i warunki"
        case .clauses: return "Klauzule"
        case .review: return "Sprawdzenie"
        case .documents: return "Dokumenty i historia"
        }
    }
}

/// Uwaga z paska „Do sprawdzenia” — kliknięcie otwiera podzakładkę.
struct ContractAlert: Identifiable {
    let id: String
    let label: String
    let section: ContractTabSection
}

private struct ContractLink: Decodable { var url: String; var name: String }
private struct ContractUploadSlot: Decodable { var id: String; var path: String; var url: String }

private struct ContractCard: ViewModifier {
    @Environment(\.crmTheme) private var theme
    func body(content: Content) -> some View {
        content
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }
}

fileprivate extension View {
    func contractCard() -> some View { modifier(ContractCard()) }
}

@MainActor struct EventContractTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var preview: NativePreview?
    @State private var pendingStatus: String?
    @State private var confirmingSignature = false
    @State private var importing = false
    @State private var uploading: String?
    @State private var section: ContractTabSection = .content
    // PDF w podzakładce „Treść” (klucz: umowa i data wygenerowania — nowy PDF wczytuje się od nowa).
    @State private var inlinePdfKey: String?
    @State private var inlinePdfData: Data?
    @State private var inlinePdfError: String?

    private var data: ContractTabData? { store.tab(eventID, "contract", as: ContractTabData.self) }

    /// Edytor umowy w CRM, opcjonalnie na wskazanej podzakładce.
    private func crmPath(_ target: ContractTabSection? = nil) -> String {
        let base = "/crm/events/\(eventID)?tab=contract"
        guard let target else { return base }
        return base + "&contractSection=" + target.rawValue
    }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|contract"] {
                ContentUnavailableView {
                    Label("Nie udało się pobrać umowy", systemImage: "signature")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "contract") } } }
            } else {
                ProgressView("Ładowanie danych umowy...").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "contract") }
        .onChange(of: eventID) { _, _ in
            section = .content
            inlinePdfKey = nil
            inlinePdfData = nil
            inlinePdfError = nil
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "contract") } }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
        .confirmationDialog("Zmienić status umowy?", isPresented: Binding(get: { pendingStatus != nil }, set: { if !$0 { pendingStatus = nil } }), titleVisibility: .visible) {
            if let next = pendingStatus, let contract = data?.contract {
                Button("Zmień na „\(ContractText.status(next))”") { Task { await changeStatus(contract, next) } }
            }
            Button("Anuluj", role: .cancel) { pendingStatus = nil }
        } message: { Text(statusMessage) }
        .confirmationDialog("Potwierdzić podpis firmy?", isPresented: $confirmingSignature, titleVisibility: .visible) {
            if let contract = data?.contract { Button("Potwierdź podpis firmy") { Task { await confirmSignature(contract) } } }
            Button("Anuluj", role: .cancel) {}
        } message: { Text("Umowa zostanie oznaczona jako podpisana przez firmę. Po podpisie klienta będzie można załączyć podpisany dokument.") }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .jpeg, .png], allowsMultipleSelection: false) { result in
            guard case .success(let urls) = result, let url = urls.first, let contract = data?.contract else { return }
            Task { await upload(url, contract) }
        }
    }

    private var statusMessage: String {
        guard let next = pendingStatus else { return "" }
        if next == "draft" { return "Umowa wróci do szkicu. Dotychczasowy PDF zostanie oznaczony jako nieaktualny — przed wysyłką wygeneruj go ponownie w CRM." }
        return "Status zmieni się na „\(ContractText.status(next))” z bieżącą datą. Zmiana statusu nie wysyła wiadomości do klienta."
    }

    private func content(_ data: ContractTabData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(data)
                if let contract = data.contract {
                    let notices = alerts(contract, data)
                    statusPath(contract, data)
                    if !notices.isEmpty { alertStrip(notices) }
                    sectionTabs(data, notices)
                    sectionContent(contract, data)
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "doc.text").font(.system(size: 40)).foregroundStyle(.tertiary)
                        Text("Umowa nie została jeszcze utworzona").font(.headline)
                        Text("Szkic powstaje w edytorze umowy w CRM z szablonu, oferty i danych wydarzenia.").font(.callout).foregroundStyle(.secondary)
                        Button("Przygotuj umowę w CRM") { state.openCRM(crmPath()) }
                    }
                    .frame(maxWidth: .infinity).padding(36)
                    .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
                    if !data.history.isEmpty { historyCard(data.history) }
                }
            }
            .padding(18)
        }
    }

    // MARK: Nagłówek i czynności

    private func header(_ data: ContractTabData) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Label("Umowa", systemImage: "signature").font(.title2.weight(.light))
                if let contract = data.contract {
                    let name: String = contract.number ?? contract.title
                    if !name.isEmpty { Text(name).font(.callout.weight(.medium)).textSelection(.enabled) }
                }
                Text(data.templateName.map { "Szablon umowy: " + $0 } ?? "Wybierz szablon umowy w CRM")
                    .font(.callout).foregroundStyle(.secondary)
            }
            Spacer()
            if let contract = data.contract { headerActions(contract, data) }
        }
    }

    private func headerActions(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let cancelled = contract.status == "cancelled"
        let draft = contract.status == "draft"
        let showLabel: String = cancelled ? "Pokaż archiwalny PDF" : draft ? "Pokaż PDF draftu" : "Pokaż PDF"
        return HStack(spacing: 8) {
            if contract.pdf != nil {
                Button { Task { await openPdf(contract.id, action: .preview) } } label: { Label(showLabel, systemImage: "eye") }
                Button { Task { await openPdf(contract.id, action: .download) } } label: { Label("Pobierz PDF", systemImage: "arrow.down.circle") }
            }
            if data.canManage && !cancelled {
                Button { state.openCRM(crmPath(.content)) } label: { Label("Edytuj treść w CRM", systemImage: "safari") }
                    .buttonStyle(.borderedProminent)
                    .help("Treść umowy, generowanie PDF i wysyłka — w edytorze umowy w CRM.")
            }
            Menu { moreMenu(contract, data) } label: { Image(systemName: "ellipsis.circle") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Więcej czynności")
        }
    }

    @ViewBuilder private func moreMenu(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let cancelled = contract.status == "cancelled"
        let draft = contract.status == "draft"
        let generateLabel: String = (contract.pdf == nil ? "Generuj PDF" : "Regeneruj PDF") + (draft ? " draftu" : "") + " w CRM"
        if contract.pdf != nil {
            Button { Task { await openPdf(contract.id, action: .print) } } label: { Label("Drukuj PDF", systemImage: "printer") }
        }
        if data.canManage && !cancelled {
            Divider()
            Button { state.openCRM(crmPath(.content)) } label: { Label(generateLabel, systemImage: "doc.badge.gearshape") }
            Button { state.openCRM(crmPath(.content)) } label: { Label(draft ? "Wyślij draft w CRM" : "Wyślij umowę w CRM", systemImage: "paperplane") }
            if draft {
                Button { state.openCRM(crmPath(.data)) } label: { Label("Edytuj pola i warunki w CRM", systemImage: "list.bullet.rectangle") }
                Button { state.openCRM(crmPath(.clauses)) } label: { Label("Zarządzaj klauzulami w CRM", systemImage: "text.badge.checkmark") }
                Button { state.openCRM(crmPath(.review)) } label: { Label("Odśwież szablon i dane w CRM", systemImage: "arrow.triangle.2.circlepath") }
            }
            Button { state.openCRM(crmPath(.review)) } label: { Label("Audyt AI w CRM", systemImage: "sparkles") }
            if data.canChangeStatus {
                Button { state.openCRM(crmPath(.content)) } label: { Label("Zmień szablon umowy w CRM", systemImage: "doc.on.doc") }
            }
        }
        Divider()
        Button { state.openCRM(crmPath(section)) } label: { Label("Otwórz w CRM", systemImage: "safari") }
        if data.isAdmin && !cancelled {
            Divider()
            Button(role: .destructive) { state.openCRM(crmPath(.content)) } label: { Label("Anuluj umowę w CRM…", systemImage: "xmark.circle") }
                .help("Anulowanie wymaga potwierdzenia hasłem administratora — otworzy się w CRM.")
        }
    }

    // MARK: Ścieżka statusu

    private enum StepStyle { case current, done, future, cancelled }

    /// `isContractStatusDisabled`: po podpisaniu nie wraca się do wcześniejszych statusów, szkic przywraca tylko administrator.
    private func statusAllowed(_ status: String, _ contract: ContractTabData.Contract, _ data: ContractTabData) -> Bool {
        if contract.lockedAt != nil && ["draft", "issued", "sent", "accepted"].contains(status) { return false }
        if !data.isAdmin && status == "draft" && contract.status != "draft" { return false }
        return true
    }

    private func nextStatus(_ contract: ContractTabData.Contract) -> String? {
        guard contract.status != "cancelled", let index = ContractText.flow.firstIndex(of: contract.status), index + 1 < ContractText.flow.count else { return nil }
        return ContractText.flow[index + 1]
    }

    /// Szkic wystawia się w CRM (treść składana z aktualnych danych, uwagi do umowy); pozostałe zmiany — tutaj, po potwierdzeniu.
    private func choose(_ status: String, _ contract: ContractTabData.Contract) {
        if contract.status == "draft" {
            state.openCRM(crmPath(.review))
            return
        }
        pendingStatus = status
    }

    private func stepLabel(_ text: String, _ style: StepStyle) -> some View {
        let fill: Color
        let border: Color
        let foreground: Color
        switch style {
        case .current:
            fill = theme.accent
            border = .clear
            foreground = theme == .light ? .white : Color.black.opacity(0.85)
        case .done:
            fill = .clear
            border = theme.accent.opacity(0.4)
            foreground = theme.accent
        case .future:
            fill = .clear
            border = Color.secondary.opacity(0.35)
            foreground = .secondary
        case .cancelled:
            fill = Color.red.opacity(0.14)
            border = .clear
            foreground = .red
        }
        return Text(text)
            .font(.caption.weight(style == .current ? .semibold : .regular))
            .foregroundStyle(foreground)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .background(Capsule().fill(fill))
            .overlay(Capsule().strokeBorder(border))
            .fixedSize()
    }

    private func statusPath(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let currentIndex = ContractText.flow.firstIndex(of: contract.status) ?? -1
        let canChange = data.canChangeStatus && contract.status != "cancelled"
        let draft = contract.status == "draft"
        let signedBy: String = contract.companySignedBy.map { " · " + $0 } ?? ""
        return VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    if contract.status == "cancelled" {
                        stepLabel(ContractText.status("cancelled"), .cancelled)
                    } else {
                        ForEach(Array(ContractText.flow.enumerated()), id: \.offset) { index, status in
                            if index > 0 { Rectangle().fill(Color.secondary.opacity(0.3)).frame(width: 14, height: 1) }
                            let current = status == contract.status
                            let clickable = canChange && !current && statusAllowed(status, contract, data)
                            let style: StepStyle = current ? .current : index < currentIndex ? .done : .future
                            let hint: String = draft
                                ? "Wystawienie szkicu — w edytorze umowy w CRM"
                                : "Zmień status na „\(ContractText.status(status))”"
                            Button { choose(status, contract) } label: { stepLabel(ContractText.status(status), style) }
                                .buttonStyle(.plain)
                                .disabled(!clickable)
                                .help(clickable ? hint : ContractText.status(status))
                        }
                    }
                }
                .padding(.vertical, 1)
            }
            HStack(spacing: 8) {
                badge("Wersja \(contract.version)", theme.accent)
                if contract.lockedAt != nil { badge("Zablokowana po podpisaniu", .green) }
                if contract.companySignedAt != nil { badge("Podpis firmy potwierdzony" + signedBy, theme.accent) }
                if let date = ContractText.statusDate(contract) {
                    Text(date).font(.caption).foregroundStyle(.secondary).help("Data zmiany statusu")
                }
                Spacer(minLength: 8)
                if data.isAdmin && !draft && contract.status != "cancelled" && contract.companySignedAt == nil {
                    Button("Potwierdź podpis firmy") { confirmingSignature = true }
                }
                if canChange, let next = nextStatus(contract), statusAllowed(next, contract, data) {
                    if draft {
                        Button { state.openCRM(crmPath(.review)) } label: { Label("Wystaw umowę w CRM", systemImage: "safari") }
                            .help("Przed wystawieniem CRM składa treść z aktualnych danych oferty i szablonu oraz sprawdza uwagi do umowy.")
                    } else {
                        Button(ContractText.nextAction(next) + " →") { pendingStatus = next }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .contractCard()
    }

    private func badge(_ text: String, _ color: Color) -> some View {
        Text(text).font(.caption).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 3).background(color.opacity(0.12), in: Capsule())
    }

    // MARK: Do sprawdzenia

    private enum CheckLevel { case ok, warn, info }

    private struct ReviewCheck: Identifiable {
        let id: String
        let level: CheckLevel
        let title: String
        let detail: String?
        /// Tekst w pasku „Do sprawdzenia” i podzakładka, którą otwiera (tylko uwagi `warn`).
        var alert: String = ""
        var section: ContractTabSection = .review
    }

    private func reviewChecks(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> [ReviewCheck] {
        var checks: [ReviewCheck] = []
        let cancelled = contract.status == "cancelled"
        let draft = contract.status == "draft"
        let signedStatus = ["signed_by_client", "signed_returned"].contains(contract.status)
        if contract.pdf == nil {
            checks.append(ReviewCheck(id: "pdf", level: draft || cancelled ? .info : .warn, title: "PDF nie został jeszcze wygenerowany",
                                      detail: "Wygenerujesz go w edytorze umowy w CRM.", alert: "brak PDF umowy", section: .content))
        } else if contract.modified && !cancelled {
            checks.append(ReviewCheck(id: "pdf", level: .warn, title: "PDF nieaktualny",
                                      detail: "Treść zmieniła się po wygenerowaniu PDF (\(ContractText.date(contract.pdfAt))) — wygeneruj go ponownie w CRM.",
                                      alert: "PDF nieaktualny — treść zmieniła się po wygenerowaniu", section: .content))
        } else {
            checks.append(ReviewCheck(id: "pdf", level: .ok, title: "PDF aktualny", detail: "Wygenerowano: " + ContractText.date(contract.pdfAt)))
        }
        if let summary = data.summary {
            checks.append(summary.individuallyEdited
                ? ReviewCheck(id: "content", level: .info, title: "Treść zmieniona indywidualnie dla tego wydarzenia", detail: nil)
                : ReviewCheck(id: "content", level: .ok, title: "Treść z szablonu, danych wydarzenia i oferty", detail: nil))
        }
        if !draft && !cancelled {
            if contract.companySignedAt != nil {
                let who: String = contract.companySignedBy.map { $0 + " · " } ?? ""
                checks.append(ReviewCheck(id: "company", level: .ok, title: "Podpis firmy potwierdzony", detail: who + ContractText.date(contract.companySignedAt)))
            } else if signedStatus {
                checks.append(ReviewCheck(id: "company", level: .warn, title: "Brak potwierdzenia podpisu firmy",
                                          detail: "Potwierdza administrator — przycisk przy statusie umowy.", alert: "brak potwierdzenia podpisu firmy"))
            } else {
                checks.append(ReviewCheck(id: "company", level: .info, title: "Podpis firmy jeszcze niepotwierdzony", detail: nil))
            }
        }
        if signedStatus && data.signed.canView && data.signed.error == nil {
            if data.signed.files.isEmpty {
                let detail: String = contract.companySignedAt == nil ? "Dodasz go po potwierdzeniu podpisu firmy." : "Dodasz go w „Dokumenty i historia”."
                checks.append(ReviewCheck(id: "signed", level: .warn, title: "Brak podpisanego dokumentu", detail: detail,
                                          alert: "brak załączonego podpisanego dokumentu", section: .documents))
            } else {
                checks.append(ReviewCheck(id: "signed", level: .ok, title: "Podpisany dokument załączony", detail: "Plików: \(data.signed.files.count)"))
            }
        }
        if contract.lockedAt != nil {
            checks.append(ReviewCheck(id: "locked", level: .ok, title: "Dokument zablokowany po podpisaniu", detail: ContractText.date(contract.lockedAt)))
        }
        return checks
    }

    private func alerts(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> [ContractAlert] {
        reviewChecks(contract, data).filter { $0.level == .warn }.map { ContractAlert(id: $0.id, label: $0.alert, section: $0.section) }
    }

    private func alertStrip(_ alerts: [ContractAlert]) -> some View {
        HStack(spacing: 8) {
            Label("Do sprawdzenia:", systemImage: "exclamationmark.shield").font(.caption.weight(.semibold)).foregroundStyle(.orange)
            ForEach(alerts) { alert in
                Button(alert.label) { section = alert.section }
                    .buttonStyle(.plain)
                    .font(.caption)
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Color.orange.opacity(0.14), in: Capsule())
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
    }

    // MARK: Podzakładki

    private func sectionBadge(_ item: ContractTabSection, _ data: ContractTabData, _ alerts: [ContractAlert]) -> (count: Int, warn: Bool)? {
        switch item {
        case .clauses: return ((data.summary?.clauses ?? []).reduce(0) { $0 + $1.items.count }, false)
        case .review: return (alerts.count, true)
        case .documents: return (data.signed.files.count + data.history.count, false)
        default: return nil
        }
    }

    private func sectionTabs(_ data: ContractTabData, _ alerts: [ContractAlert]) -> some View {
        HStack(spacing: 2) {
            ForEach(ContractTabSection.allCases) { item in
                let selected = section == item
                let badge = sectionBadge(item, data, alerts)
                Button { section = item } label: {
                    HStack(spacing: 5) {
                        Text(item.label)
                        if let badge, badge.count > 0 {
                            Text("\(badge.count)")
                                .font(.caption2.weight(.medium))
                                .padding(.horizontal, 5).padding(.vertical, 1)
                                .background((badge.warn ? Color.orange : Color.secondary).opacity(0.2), in: Capsule())
                        }
                    }
                    .font(.callout)
                    .foregroundStyle(selected ? theme.accent : Color.secondary)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .overlay(alignment: .bottom) { Rectangle().fill(selected ? theme.accent : Color.clear).frame(height: 2) }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .overlay(alignment: .bottom) { Divider() }
    }

    @ViewBuilder private func sectionContent(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        switch section {
        case .content: contentSection(contract, data)
        case .data: dataSection(contract, data)
        case .clauses: clausesSection(contract, data)
        case .review: reviewSection(contract, data)
        case .documents: documentsSection(contract, data)
        }
    }

    // MARK: Treść

    private func infoCard<Content: View>(_ title: String, tint: Color? = nil, @ViewBuilder _ makeContent: () -> Content) -> some View {
        let fill: Color = tint.map { $0.opacity(0.08) } ?? theme.card.opacity(theme == .light ? 1 : 0.9)
        let border: Color = (tint ?? Color.secondary).opacity(0.22)
        return VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.callout.weight(.medium))
            makeContent().font(.caption)
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(fill, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(border))
    }

    private func contentSection(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let summary = data.summary
        let draft = contract.status == "draft"
        let cancelled = contract.status == "cancelled"
        let conditions: String = (summary?.conditions ?? []).map { "\($0.label): \($0.value)" }.joined(separator: " · ")
        let contentText: String = summary?.individuallyEdited == true
            ? "Zmieniona indywidualnie dla tego wydarzenia."
            : "Wygenerowana z szablonu, danych wydarzenia i oferty."
        let pdfText: String = contract.pdf == nil
            ? "Jeszcze nie wygenerowany."
            : contract.modified && !cancelled ? "Treść zmieniła się po wygenerowaniu — wygeneruj ponownie." : "Aktualny."
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                infoCard("Treść umowy") {
                    Text(contentText)
                    if let pages = summary?.pages, pages > 0 { Text(ContractText.pages(pages)).foregroundStyle(.secondary) }
                }
                infoCard("Warunki umowy", tint: .purple) {
                    Text(conditions.isEmpty ? "Szablon nie ma warunków do wyboru." : conditions)
                    if !conditions.isEmpty {
                        Button(draft && data.canManage ? "Zmień w „Dane i warunki”" : "Zobacz w „Dane i warunki”") { section = .data }
                            .buttonStyle(.link)
                    }
                }
                infoCard("PDF") {
                    Text(pdfText)
                    if contract.pdf != nil { Text("Wygenerowano: " + ContractText.date(contract.pdfAt)).foregroundStyle(.secondary) }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            pdfPreview(contract, data)
        }
    }

    @ViewBuilder private func pdfPreview(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        if contract.pdf != nil {
            let key = contract.id + "|" + (contract.pdfAt ?? "")
            let title: String = contract.status == "cancelled" ? "Archiwalny PDF umowy" : contract.status == "draft" ? "PDF draftu" : "PDF umowy"
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label(title, systemImage: "doc.richtext").font(.headline)
                    Spacer()
                    Button { Task { await openPdf(contract.id, action: .preview) } } label: { Label("Powiększ", systemImage: "arrow.up.left.and.arrow.down.right") }
                    Button { Task { await openPdf(contract.id, action: .print) } } label: { Label("Drukuj", systemImage: "printer") }
                }
                if contract.modified && contract.status != "cancelled" {
                    Label("Podgląd pokazuje PDF sprzed ostatnich zmian treści. Aktualną treść zobaczysz i wygenerujesz w edytorze umowy w CRM.", systemImage: "exclamationmark.triangle")
                        .font(.callout).foregroundStyle(.orange)
                }
                Group {
                    if inlinePdfKey == key, let pdfData = inlinePdfData {
                        NativePDF(data: pdfData)
                    } else if inlinePdfKey == key, let error = inlinePdfError {
                        VStack(spacing: 8) {
                            Text(error).foregroundStyle(.secondary)
                            Button("Spróbuj ponownie") { inlinePdfKey = nil; inlinePdfError = nil }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ProgressView("Wczytywanie PDF…")
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .task(id: key) { await loadInlinePdf(contract.id, key) }
                    }
                }
                .frame(height: 640)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .contractCard()
        } else {
            VStack(spacing: 10) {
                Image(systemName: "doc.text").font(.system(size: 34)).foregroundStyle(.tertiary)
                Text(contract.status == "draft" ? "PDF draftu nie został jeszcze wygenerowany." : "PDF umowy nie został jeszcze wygenerowany.").font(.headline)
                Text("Podgląd treści i generowanie PDF są w edytorze umowy w CRM — tam treść jest składana i dzielona na strony z aktualnych danych.")
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                if data.canManage && contract.status != "cancelled" {
                    Button { state.openCRM(crmPath(.content)) } label: { Label("Otwórz treść w CRM", systemImage: "safari") }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(30)
            .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: Dane i warunki

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label).foregroundStyle(.secondary).frame(width: 170, alignment: .leading)
            Text(value).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(.callout)
    }

    private func dataSection(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let editable = data.canManage && contract.status == "draft"
        let note: String = editable
            ? "Dane strony klienta, osoby podpisujące, pola i warunki zmienisz w edytorze umowy w CRM (zmiany dotyczą tylko tej umowy)."
            : "Pola i warunki zmienia się w szkicu umowy w CRM."
        return VStack(alignment: .leading, spacing: 12) {
            if let summary = data.summary {
                let client: String = summary.client.map { $0.name + ($0.company ? " (firma)" : " (osoba prywatna)") } ?? "—"
                let signers: String = summary.signers.map { $0.isEmpty ? "nie wybrano osób" : $0.joined(separator: ", ") }
                    ?? "wszystkie osoby uprawnione z danych organizacji"
                VStack(alignment: .leading, spacing: 8) {
                    Text("Dane klienta i osoby podpisujące umowę").font(.headline)
                    infoRow("Klient", client)
                    infoRow("Kategoria wydarzenia", summary.category ?? "—")
                    if summary.client?.company == true { infoRow("Osoby podpisujące", signers) }
                }
                .contractCard()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Warunki umowy").font(.headline)
                    if summary.conditions.isEmpty {
                        Text("Szablon nie ma warunków do wyboru.").font(.callout).foregroundStyle(.secondary)
                    } else {
                        ForEach(summary.conditions, id: \.self) { condition in infoRow(condition.label, condition.value) }
                    }
                }
                .contractCard()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Pola zmienione dla tej umowy").font(.headline)
                    if summary.changedFields.isEmpty {
                        Text("Brak — pola pochodzą z danych wydarzenia i oferty.").font(.callout).foregroundStyle(.secondary)
                    } else {
                        Text(summary.changedFields.joined(separator: " · ")).font(.callout).textSelection(.enabled)
                    }
                }
                .contractCard()
            } else {
                Text("Nie udało się odczytać danych zapisanej umowy.").font(.callout).foregroundStyle(.secondary).contractCard()
            }
            HStack(spacing: 10) {
                if editable {
                    Button { state.openCRM(crmPath(.data)) } label: { Label("Edytuj pola i warunki w CRM", systemImage: "safari") }
                }
                Text(note).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Klauzule

    private func clausesSection(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let groups = data.summary?.clauses ?? []
        let editable = data.canManage && contract.status == "draft"
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Klauzule produktów w umowie").font(.headline)
                    Text("Edytujesz lub wyłączasz automatyczne klauzule i dodajesz ustalenia klienta tylko dla tego wydarzenia w CRM.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if editable {
                    Button { state.openCRM(crmPath(.clauses)) } label: { Label("Zarządzaj klauzulami w CRM", systemImage: "safari") }
                }
            }
            if groups.isEmpty {
                Text(data.summary == nil ? "Nie udało się odczytać klauzul zapisanej umowy." : "W treści umowy nie ma klauzul produktów.")
                    .font(.callout).foregroundStyle(.secondary).contractCard()
            } else {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Text(group.label).font(.callout.weight(.semibold))
                            Text("\(group.items.count)").font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(Array(group.items.enumerated()), id: \.offset) { _, item in
                            let meta: String = [item.topic, item.product].filter { !$0.isEmpty }.joined(separator: " · ")
                            VStack(alignment: .leading, spacing: 2) {
                                if !meta.isEmpty { Text(meta).font(.caption).foregroundStyle(theme.accent) }
                                Text(item.text).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                    .contractCard()
                }
                Text("Podgląd z zapisanej treści umowy (pierwsze zdania punktu).").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Sprawdzenie

    private func reviewSection(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        let checks = reviewChecks(contract, data)
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Stan dokumentu").font(.headline)
                ForEach(checks) { check in
                    let icon: String = check.level == .ok ? "checkmark.circle.fill" : check.level == .warn ? "exclamationmark.triangle.fill" : "info.circle"
                    let color: Color = check.level == .ok ? .green : check.level == .warn ? .orange : .secondary
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: icon).foregroundStyle(color)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(check.title).font(.callout)
                            if let detail = check.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer(minLength: 0)
                    }
                }
            }
            .contractCard()
            VStack(alignment: .leading, spacing: 8) {
                Label("Pełne sprawdzenie w CRM", systemImage: "checklist").font(.headline)
                Text("Uwagi przed wystawieniem, zgodność treści z aktualnymi danymi wydarzenia i oferty (odświeżenie szablonu i danych), rozbieżne wersje wspólnych ustaleń i audyt AI sprawdza edytor umowy w CRM — wymagają złożenia treści w przeglądarce.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button { state.openCRM(crmPath(.review)) } label: { Label("Sprawdź w CRM", systemImage: "safari") }
            }
            .contractCard()
        }
    }

    // MARK: Dokumenty i historia

    private func documentsSection(_ contract: ContractTabData.Contract, _ data: ContractTabData) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            signedCard(contract, data.signed)
            if !data.history.isEmpty { historyCard(data.history) }
            if !data.signed.canView && data.history.isEmpty {
                Text("Brak podpisanych dokumentów i wcześniejszych wersji umowy.").font(.callout).foregroundStyle(.secondary).contractCard()
            }
        }
    }

    // MARK: Podpisane dokumenty (`SignedContractAttachments`)

    @ViewBuilder private func signedCard(_ contract: ContractTabData.Contract, _ signed: ContractTabData.Signed) -> some View {
        if signed.canView {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Label(contract.status == "cancelled" ? "Archiwum podpisanych dokumentów" : "Podpisane dokumenty", systemImage: "checkmark.seal")
                        .font(.headline)
                    Spacer()
                    if signed.canUpload {
                        Button { importing = true } label: { Label(uploading ?? "Dodaj podpisany dokument", systemImage: "plus") }
                            .disabled(uploading != nil)
                    }
                }
                if let error = signed.error { Text(error).font(.callout).foregroundStyle(.orange) }
                if signed.files.isEmpty {
                    Text("Brak podpisanych dokumentów.").font(.callout).foregroundStyle(.secondary)
                } else {
                    ForEach(signed.files) { file in
                        HStack(spacing: 10) {
                            Image(systemName: file.mime == "application/pdf" ? "doc.richtext" : "photo").foregroundStyle(theme.accent)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(file.name).lineLimit(1)
                                Text(ContractText.size(file.size) + " · " + ContractText.date(file.createdAt)).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button { Task { await openSigned(contract.id, file, download: false) } } label: { Image(systemName: "eye") }
                                .buttonStyle(.borderless).help("Otwórz podpisaną umowę")
                            Button { Task { await openSigned(contract.id, file, download: true) } } label: { Image(systemName: "arrow.down.circle") }
                                .buttonStyle(.borderless).help("Pobierz podpisaną umowę")
                        }
                        .padding(.vertical, 4)
                    }
                }
                if ["signed_by_client", "signed_returned"].contains(contract.status) && contract.companySignedAt == nil {
                    Text("Aby załączyć podpisany dokument, administrator musi jeszcze potwierdzić podpis firmy przy statusie umowy.")
                        .font(.caption).foregroundStyle(.secondary)
                } else if !["signed_by_client", "signed_returned", "cancelled"].contains(contract.status) {
                    Text("Podpisany dokument dodasz po zmianie statusu na „Podpisana przez klienta” lub „Podpisana odesłana” i potwierdzeniu podpisu firmy. PDF, JPG lub PNG do 20 MB.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .contractCard()
        }
    }

    // MARK: Wcześniejsze wersje

    private func historyCard(_ history: [ContractTabData.Archived]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Wcześniejsze wersje umowy", systemImage: "clock.arrow.circlepath").font(.headline)
            ForEach(history) { item in
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(item.number ?? item.title).lineLimit(1)
                        Text("Wersja \(item.version) · " + ContractText.status(item.status ?? "draft") + " · " + ContractText.date(item.createdAt))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if item.pdf != nil {
                        Button { Task { await openPdf(item.id, action: .preview) } } label: { Image(systemName: "eye") }
                            .buttonStyle(.borderless).help("Pokaż archiwalny PDF")
                        Button { Task { await openPdf(item.id, action: .download) } } label: { Image(systemName: "arrow.down.circle") }
                            .buttonStyle(.borderless).help("Pobierz archiwalny PDF")
                    } else {
                        Text("bez PDF").font(.caption).foregroundStyle(.tertiary)
                    }
                }
                .padding(.vertical, 3)
            }
        }
        .contractCard()
    }

    // MARK: Czynności

    private enum PdfAction { case preview, download, print }

    private func fetch(_ query: String, _ params: [String: String]) async throws -> (Data, String) {
        let link = try await store.tabQuery(eventID, "contract", query, params, as: ContractLink.self)
        guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
        let (data, response) = try await URLSession.shared.data(from: url)
        guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
        return (data, link.name)
    }

    /// PDF do podglądu w podzakładce „Treść” — bez okna postępu; przerwane wczytywanie (zmiana podzakładki) nie jest błędem.
    private func loadInlinePdf(_ contractID: String, _ key: String) async {
        do {
            let file = try await fetch("pdf", ["contractId": contractID])
            inlinePdfData = file.0
            inlinePdfError = nil
            inlinePdfKey = key
        } catch {
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled { return }
            inlinePdfData = nil
            inlinePdfError = store.failureText(error, "Nie udało się wczytać PDF.")
            inlinePdfKey = key
        }
    }

    private func deliver(_ file: (Data, String), action: PdfAction) {
        switch action {
        case .preview:
            preview = NativePreview(name: file.1, data: file.0)
        case .download:
            do {
                let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
                let name = file.1
                let base = (name as NSString).deletingPathExtension
                let ext = (name as NSString).pathExtension
                var target = folder.appendingPathComponent(name)
                var copy = 1
                while FileManager.default.fileExists(atPath: target.path) {
                    target = folder.appendingPathComponent(ext.isEmpty ? "\(base) (\(copy))" : "\(base) (\(copy)).\(ext)")
                    copy += 1
                }
                try file.0.write(to: target)
                NSWorkspace.shared.activateFileViewerSelecting([target])
                state.succeed("Pobrano: \(target.lastPathComponent)")
            } catch {
                state.error = store.failureText(error, "Błąd podczas pobierania PDF")
            }
        case .print:
            guard let document = PDFDocument(data: file.0),
                  let operation = document.printOperation(for: NSPrintInfo.shared, scalingMode: .pageScaleToFit, autoRotate: true) else {
                state.error = "Nie udało się przygotować wydruku."
                return
            }
            operation.run()
        }
    }

    private func openPdf(_ contractID: String, action: PdfAction) async {
        let pending: String = action == .download ? "Pobieranie PDF…" : "Otwieranie PDF…"
        let fetched: (Data, String)? = await state.withPending(pending) { () async -> (Data, String)? in
            do {
                return try await fetch("pdf", ["contractId": contractID])
            } catch {
                state.error = store.failureText(error, "Błąd podczas otwierania PDF")
                return nil
            }
        }
        guard let file = fetched else { return }
        deliver(file, action: action)
    }

    private func openSigned(_ contractID: String, _ file: ContractTabData.SignedFile, download: Bool) async {
        let fetched: (Data, String)? = await state.withPending(download ? "Pobieranie…" : "Otwieranie…") { () async -> (Data, String)? in
            do {
                return try await fetch("signedFile", ["contractId": contractID, "fileId": file.id])
            } catch {
                state.error = store.failureText(error, "Nie udało się otworzyć pliku.")
                return nil
            }
        }
        guard let loaded = fetched else { return }
        deliver(loaded, action: download ? .download : .preview)
    }

    private func changeStatus(_ contract: ContractTabData.Contract, _ next: String) async {
        pendingStatus = nil
        do {
            try await store.tabAction(eventID, "contract", "status",
                                      ["contractId": .string(contract.id), "status": .string(next), "expectedStatus": .string(contract.status)],
                                      reload: ["contract"], success: "Status umowy został zaktualizowany", pending: "Zmiana statusu…")
        } catch {
            state.error = store.failureText(error, "Błąd podczas aktualizacji statusu")
            await store.loadTab(eventID, "contract")
        }
    }

    private func confirmSignature(_ contract: ContractTabData.Contract) async {
        do {
            try await store.tabAction(eventID, "contract", "companySignature", ["contractId": .string(contract.id)], reload: ["contract"],
                                      success: "Podpis firmy został potwierdzony", pending: "Zapisywanie…")
        } catch {
            state.error = store.failureText(error, "Nie udało się potwierdzić podpisu firmy")
        }
    }

    /// Dodanie podpisanego dokumentu: adres wysyłki → plik z Maca prosto do magazynu → sprawdzenie i wpis na serwerze.
    private func upload(_ url: URL, _ contract: ContractTabData.Contract) async {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard size > 0, size <= 20 * 1024 * 1024 else {
            state.error = "Wybierz niepusty plik PDF, JPG lub PNG o rozmiarze do 20 MB."
            return
        }
        uploading = "Wysyłanie…"
        defer { uploading = nil }
        do {
            let reply = try await store.tabAction(eventID, "contract", "prepareSigned",
                                                  ["contractId": .string(contract.id), "name": .string(url.lastPathComponent), "size": .number(Double(size))],
                                                  reload: [], success: nil, pending: "Przygotowanie wysyłania…")
            let slot = try JSONDecoder().decode(ContractUploadSlot.self, from: reply)
            guard let target = URL(string: slot.url) else { throw AppError.invalidResponse }
            let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
            var request = URLRequest(url: target)
            request.httpMethod = "PUT"
            request.setValue(mime, forHTTPHeaderField: "Content-Type")
            request.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
            request.setValue("false", forHTTPHeaderField: "x-upsert")
            let (_, response) = try await state.withPending("Wysyłanie pliku…") { try await URLSession.shared.upload(for: request, fromFile: url) }
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
            try await store.tabAction(eventID, "contract", "registerSigned",
                                      ["contractId": .string(contract.id), "id": .string(slot.id), "path": .string(slot.path), "name": .string(url.lastPathComponent)],
                                      reload: ["contract"], success: "Dodano podpisany dokument", pending: "Sprawdzanie pliku…")
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać pliku.")
            await store.loadTab(eventID, "contract")
        }
    }
}

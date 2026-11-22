import SwiftUI
import AppKit
import WebKit

// MARK: Sekcje karty kampanii (`CampaignsPageClient`, `CampaignDemoReport`): dane wersji roboczej, Odbiorcy, Podgląd
// kwalifikacji, demo kampanii, Test / zatwierdzenie / wysyłka i Podgląd wiadomości (HTML bez skryptów, jak `iframe sandbox`).

/// Karta sekcji w kolorach motywu.
struct MailCampaignSection<Content: View>: View {
    @Environment(\.crmTheme) private var theme
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) { content }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Pole formularza z etykietą nad kontrolką.
struct MailCampaignField<Content: View>: View {
    let label: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Licznik (Dopuszczeni, Wysłane, Wejścia…).
struct MailCampaignTile: View {
    let label: String
    let value: Int
    let color: Color
    var large = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.caption2).foregroundStyle(color.opacity(0.7))
            Text("\(value)").font(large ? .largeTitle.weight(.light) : .title2.weight(.light)).foregroundStyle(color).monospacedDigit()
        }
        .padding(large ? 14 : 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(color.opacity(large ? 0.22 : 0)))
    }
}

// MARK: Dane wersji roboczej

@MainActor struct MailCampaignFormCard: View {
    @Binding var draft: MailCampaignDraft
    let campaign: MailCampaign
    let home: MailCampaignHome
    let editable: Bool
    let dirty: Bool
    let save: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        MailCampaignSection {
            HStack(alignment: .center, spacing: 10) {
                badges
                Spacer()
                if dirty { Text("Niezapisane zmiany").font(.caption).foregroundStyle(.orange) }
                Button(action: save) { Label("Zapisz wersję", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent).keyboardShortcut("s").disabled(!editable)
            }
            fields
            HStack(alignment: .top, spacing: 12) {
                MailCampaignCheck(title: "Mierz otwarcia", detail: "Pomiar obrazkiem jest orientacyjny i może być blokowany przez program pocztowy.",
                                  isOn: $draft.trackOpens, enabled: editable)
                MailCampaignCheck(title: "Mierz kliknięcia", detail: "Linki zostaną przekierowane przez bezpieczny licznik kampanii.",
                                  isOn: $draft.trackClicks, enabled: editable)
            }
        }
    }

    private var badges: some View {
        HStack(spacing: 8) {
            MailCampaignStatusChip(status: campaign.state)
            if campaign.hasBrochure { MailCampaignBadge(text: "Przypisana broszura PDF", color: CrmTheme.rgb(0xddd6fe)) }
            if !campaign.testSentAt.isEmpty {
                Label("Test \(MailCampaignLabels.date(campaign.testSentAt))", systemImage: "checkmark.circle.fill")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0x6ee7b7))
            }
        }
    }

    private var fields: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 16, verticalSpacing: 12) {
            GridRow {
                MailCampaignField(label: "Nazwa wewnętrzna") { TextField("", text: $draft.name).textFieldStyle(.roundedBorder) }
                MailCampaignField(label: "Konto nadawcze") { accountPicker }
            }
            GridRow {
                MailCampaignField(label: "Szablon wiadomości") { templatePicker }
                MailCampaignField(label: "Tekst podglądu w skrzynce") {
                    TextField("Krótka zapowiedź wiadomości", text: $draft.previewText).textFieldStyle(.roundedBorder)
                }
            }
            GridRow {
                MailCampaignField(label: "Temat wiadomości") { TextField("", text: $draft.subject).textFieldStyle(.roundedBorder) }
                    .gridCellColumns(2)
            }
            GridRow {
                MailCampaignField(label: "Treść HTML") {
                    TextEditor(text: $draft.content)
                        .font(.system(.caption, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .padding(6)
                        .background(theme.page.opacity(0.6), in: RoundedRectangle(cornerRadius: 7))
                        .overlay(RoundedRectangle(cornerRadius: 7).stroke(theme.accent.opacity(0.15)))
                        // Stała wysokość (jak 14 wierszy w CRM): dłuższa treść przewija się w polu, karta nie rośnie do całego HTML.
                        .frame(height: 300)
                }
                .gridCellColumns(2)
            }
        }
        .disabled(!editable)
    }

    private var accountPicker: some View {
        Picker("Konto nadawcze", selection: $draft.emailAccountId) {
            Text("Wybierz konto").tag("")
            if !draft.emailAccountId.isEmpty && !home.accounts.contains(where: { $0.id == draft.emailAccountId }) {
                Text("Konto niedostępne na Twojej liście").tag(draft.emailAccountId)
            }
            ForEach(home.accounts) { account in Text(account.label).tag(account.id) }
        }
        .labelsHidden()
    }

    private var templatePicker: some View {
        Picker("Szablon wiadomości", selection: Binding(get: { draft.templateId }, set: { applyTemplate($0) })) {
            Text("Bez szablonu").tag("")
            if !draft.templateId.isEmpty && !home.templates.contains(where: { $0.id == draft.templateId }) {
                Text("Szablon niedostępny").tag(draft.templateId)
            }
            ForEach(home.templates) { template in Text(template.name).tag(template.id) }
        }
        .labelsHidden()
    }

    /// Wybór szablonu jak `applyTemplate`: temat (gdy szablon go ma) i treść z szablonu; „Bez szablonu” — tylko odpięcie.
    private func applyTemplate(_ id: String) {
        guard let template = home.templates.first(where: { $0.id == id }) else {
            draft.templateId = ""
            return
        }
        draft.templateId = template.id
        if !template.subject.isEmpty { draft.subject = template.subject }
        draft.content = template.body
    }
}

/// Pole wyboru z opisem (Mierz otwarcia / kliknięcia).
struct MailCampaignCheck: View {
    let title: String
    let detail: String
    @Binding var isOn: Bool
    let enabled: Bool
    @Environment(\.crmTheme) private var theme

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                Text(detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .toggleStyle(.checkbox)
        .disabled(!enabled)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.page.opacity(0.6), in: RoundedRectangle(cornerRadius: 9))
    }
}

// MARK: Odbiorcy

@MainActor struct MailCampaignAudienceCard: View {
    @Binding var draft: MailCampaignDraft
    let campaign: MailCampaign
    let home: MailCampaignHome
    let editable: Bool
    let canRefresh: Bool
    let refresh: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        MailCampaignSection {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Odbiorcy", systemImage: "person.2").font(.title3.weight(.light))
                    Text("Segment jest tylko filtrem wstępnym. Zgody, sprzeciwy i wykluczenia zawsze mają pierwszeństwo.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button(action: refresh) { Label("Przelicz", systemImage: "arrow.clockwise") }.disabled(!canRefresh)
            }
            HStack(alignment: .top, spacing: 16) {
                segments.frame(maxWidth: .infinity, alignment: .topLeading)
                rules.frame(maxWidth: .infinity, alignment: .topLeading)
            }
            HStack(spacing: 12) {
                MailCampaignTile(label: "Dopuszczeni", value: campaign.eligibleCount, color: CrmTheme.rgb(0x6ee7b7), large: true)
                MailCampaignTile(label: "Wykluczeni", value: campaign.excludedCount, color: CrmTheme.rgb(0xfcd34d), large: true)
            }
        }
    }

    private var segments: some View {
        MailCampaignField(label: "Segmenty") {
            if home.segments.isEmpty {
                Text("Brak aktywnych segmentów — zostaną sprawdzone wszystkie profile.").font(.callout).foregroundStyle(.secondary)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 180), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                    ForEach(home.segments) { segment in segmentTile(segment) }
                }
            }
        }
    }

    private func segmentTile(_ segment: MailCampaignSegment) -> some View {
        let checked: Bool = draft.segmentIds.contains(segment.id)
        return Toggle(isOn: Binding(get: { checked }, set: { on in toggleSegment(segment.id, on) })) {
            VStack(alignment: .leading, spacing: 2) {
                Text(segment.name)
                if !segment.description.isEmpty { Text(segment.description).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .toggleStyle(.checkbox)
        .disabled(!editable)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(checked ? theme.accent.opacity(0.12) : theme.page.opacity(0.6), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(checked ? theme.accent.opacity(0.35) : Color.clear))
    }

    private func toggleSegment(_ id: String, _ on: Bool) {
        if on {
            if !draft.segmentIds.contains(id) { draft.segmentIds.append(id) }
        } else {
            draft.segmentIds.removeAll { $0 == id }
        }
    }

    private var rules: some View {
        VStack(alignment: .leading, spacing: 12) {
            MailCampaignField(label: "Rodzaj klienta") {
                HStack(spacing: 8) {
                    entityButton("contact", "Osoby")
                    entityButton("organization", "Firmy")
                }
            }
            MailCampaignField(label: "Typy eventów (po przecinku)") {
                TextField("wesele, gala, konferencja", text: $draft.eventTypes).textFieldStyle(.roundedBorder)
            }
            MailCampaignField(label: "Regiony (po przecinku)") {
                TextField("warmińsko-mazurskie, mazowieckie", text: $draft.regions).textFieldStyle(.roundedBorder)
            }
            HStack(spacing: 12) {
                MailCampaignField(label: "Budżet od") { TextField("", text: $draft.budgetMin).textFieldStyle(.roundedBorder) }
                MailCampaignField(label: "Budżet do") { TextField("", text: $draft.budgetMax).textFieldStyle(.roundedBorder) }
            }
        }
        .disabled(!editable)
    }

    private func entityButton(_ value: String, _ label: String) -> some View {
        let selected: Bool = draft.entityTypes.contains(value)
        return Button {
            if selected { draft.entityTypes.removeAll { $0 == value } } else { draft.entityTypes.append(value) }
        } label: {
            Text(label)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundStyle(selected ? theme.accent : Color.secondary)
                .background(selected ? theme.accent.opacity(0.12) : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(selected ? theme.accent.opacity(0.4) : theme.accent.opacity(0.12)))
        }
        .buttonStyle(.plain)
    }
}

// MARK: Podgląd kwalifikacji

enum MailRecipientFilter: String, CaseIterable, Identifiable {
    case all, eligible, excluded
    var id: String { rawValue }
    var label: String { self == .all ? "Wszyscy" : self == .eligible ? "Dopuszczeni" : "Wykluczeni" }
}

@MainActor struct MailCampaignRecipientsCard: View {
    @ObservedObject var store: MailCampaignsStore
    let campaignID: String
    @State private var filter: MailRecipientFilter = .all

    private var all: [MailCampaignRecipient] { store.recipients[campaignID] ?? [] }
    private var visible: [MailCampaignRecipient] {
        switch filter {
        case .all: return all
        case .eligible: return all.filter { !$0.isExcluded }
        case .excluded: return all.filter { $0.isExcluded }
        }
    }

    var body: some View {
        MailCampaignSection {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Podgląd kwalifikacji").font(.title3.weight(.light))
                    Text("Pełna lista przed wysyłką — bez ukrywania odrzuconych rekordów.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Picker("Filtr", selection: $filter) {
                    ForEach(MailRecipientFilter.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
            }
            if let error = store.recipientErrors[campaignID] {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.callout)
            }
            if visible.isEmpty {
                Text("Przelicz odbiorców, aby zobaczyć kwalifikację.").foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.vertical, 28)
            } else {
                table.frame(height: 320)
                Text("Pozycji: \(visible.count)").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private var table: some View {
        Table(visible) {
            TableColumn("Odbiorca") { (item: MailCampaignRecipient) in Text(item.name.isEmpty ? "—" : item.name) }
                .width(min: 140, ideal: 200)
            TableColumn("E-mail") { (item: MailCampaignRecipient) in Text(item.email.isEmpty ? "—" : item.email).foregroundStyle(.secondary) }
                .width(min: 140, ideal: 220)
            TableColumn("Podstawa") { (item: MailCampaignRecipient) in Text(item.legalBasis.isEmpty ? "—" : item.legalBasis).foregroundStyle(.secondary) }
                .width(min: 80, ideal: 130)
            TableColumn("Stan") { (item: MailCampaignRecipient) in MailRecipientState(recipient: item) }
                .width(min: 160, ideal: 280)
            TableColumn("Próby") { (item: MailCampaignRecipient) in Text("\(item.attempts)").foregroundStyle(.secondary).monospacedDigit() }
                .width(min: 40, ideal: 50)
        }
    }
}

struct MailRecipientState: View {
    let recipient: MailCampaignRecipient

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Label(recipient.statusText, systemImage: recipient.isExcluded ? "xmark.circle" : "checkmark.circle")
                .foregroundStyle(recipient.statusColor).lineLimit(1)
            if !recipient.error.isEmpty {
                Text(recipient.error).font(.caption2).foregroundStyle(CrmTheme.rgb(0xfca5a5).opacity(0.75)).lineLimit(1).help(recipient.error)
            }
        }
        .help(recipient.statusText)
    }
}

// MARK: Demo kampanii z broszury

@MainActor struct MailCampaignDemoCard: View {
    @ObservedObject var store: MailCampaignsStore
    let campaignID: String
    let canGenerate: Bool

    private var demo: MailCampaignDemo? { store.demos[campaignID] }

    var body: some View {
        MailCampaignSection {
            Text("Demo strefy sprzedawcy — skuteczność kampanii").font(.title3.weight(.light))
            Text(intro).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let report = demo?.report {
                HStack(spacing: 10) {
                    MailCampaignTile(label: "Wejścia", value: report.visits, color: CrmTheme.rgb(0xd3bb73))
                    MailCampaignTile(label: "Sesje", value: report.sessions, color: CrmTheme.rgb(0xd3bb73))
                    MailCampaignTile(label: "Wygenerowane próbne PDF-y", value: report.pdfs, color: CrmTheme.rgb(0xd3bb73))
                    MailCampaignTile(label: "Uruchomione pobrania", value: report.downloads, color: CrmTheme.rgb(0xd3bb73))
                }
            }
            buttons
            if let error = store.demoErrors[campaignID] {
                Text(error).font(.caption).foregroundStyle(CrmTheme.rgb(0xfde68a))
            }
        }
        .task(id: campaignID) { await store.loadDemo(campaignID) }
    }

    private var intro: String {
        let lead = demo?.tagged == true ? "PDF zawiera link przypisany do tej kampanii." : "Przygotuj PDF kampanii, aby jej link naliczał osobne statystyki."
        return lead + " Dane nie identyfikują poszczególnych odbiorców kampanii. Obejmują również użycie przekazanego dalej linku i próby wewnętrzne."
    }

    private var buttons: some View {
        HStack(spacing: 10) {
            Button("Odśwież statystyki") { Task { await store.loadDemo(campaignID) } }.disabled(store.generatingDemo)
            if canGenerate {
                Button(store.generatingDemo ? "Przygotowywanie PDF…" : "Generuj PDF przypisany do kampanii") { generate() }
                    .disabled(store.generatingDemo || (demo?.brochureId ?? "").isEmpty)
            }
            if let link = demo?.url, !link.isEmpty, let url = URL(string: link) {
                Button("Otwórz PDF kampanii") { NSWorkspace.shared.open(url) }
            }
        }
    }

    private func generate() {
        guard let brochure = demo?.brochureId, !brochure.isEmpty else { return }
        Task { await store.generateDemoPdf(campaignID: campaignID, brochureID: brochure) }
    }
}

// MARK: Test, zatwierdzenie i wysyłka

struct MailCampaignDeliveryActions {
    let test: () -> Void
    let submit: () -> Void
    let approve: () -> Void
    let schedule: () -> Void
    let pause: () -> Void
    let resume: () -> Void
    let cancel: () -> Void
}

@MainActor struct MailCampaignDeliveryCard: View {
    let campaign: MailCampaign
    let access: MailCampaignAccess
    @Binding var testEmail: String
    @Binding var scheduledAt: Date
    @Binding var batchSize: Int
    @Binding var interval: Int
    let actions: MailCampaignDeliveryActions
    @Environment(\.crmTheme) private var theme

    private var testable: Bool { access.canManage && (campaign.state == .draft || campaign.state == .pending_approval) }

    var body: some View {
        MailCampaignSection {
            Label("Test, zatwierdzenie i wysyłka", systemImage: "testtube.2").font(.title3.weight(.light))
            HStack(spacing: 8) {
                TextField("Adres odbiorcy testowego", text: $testEmail).textFieldStyle(.roundedBorder).disabled(!testable)
                Button(action: actions.test) { Label("Test", systemImage: "paperplane") }
                    .disabled(!testable || testEmail.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            checklist
            if campaign.hasBrochure {
                Text("To bezpieczny szkic powiązany z konkretną wersją PDF. Zatwierdzenie i masowa wysyłka są zablokowane do czasu aktywacji kontrolowanej dystrybucji linku.")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xede9fe)).padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(CrmTheme.rgb(0xa78bfa).opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
            }
            approvalButtons
            if campaign.state == .approved && access.canManage { MailCampaignScheduleBox(scheduledAt: $scheduledAt, batchSize: $batchSize, interval: $interval, start: actions.schedule) }
            if campaign.state.showsDelivery { progress }
        }
    }

    private var checklist: some View {
        VStack(alignment: .leading, spacing: 6) {
            check(campaign.eligibleCount > 0, "Grupa odbiorców została przeliczona")
            check(!campaign.testSentAt.isEmpty, "Wiadomość testowa została wysłana")
        }
        .font(.caption)
    }

    private func check(_ done: Bool, _ text: String) -> some View {
        Label(text, systemImage: done ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .foregroundStyle(done ? CrmTheme.rgb(0x6ee7b7) : CrmTheme.rgb(0xfcd34d))
    }

    @ViewBuilder private var approvalButtons: some View {
        if campaign.state == .draft && access.canManage {
            Button(action: actions.submit) { Label("Przekaż do zatwierdzenia", systemImage: "checkmark.shield") }
                .buttonStyle(.borderedProminent).disabled(campaign.hasBrochure)
        }
        if campaign.state == .pending_approval && access.canApprove {
            Button(action: actions.approve) { Label("Zatwierdź kampanię", systemImage: "checkmark.shield") }
                .buttonStyle(.borderedProminent).tint(CrmTheme.rgb(0x34d399))
        }
    }

    private var progress: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 0) {
                    Text("Start: ").foregroundStyle(.secondary)
                    Text(MailCampaignLabels.date(campaign.scheduledAt))
                }
                HStack(spacing: 0) {
                    Text("Partia: ").foregroundStyle(.secondary)
                    Text("\(campaign.batchSize) wiadomości co \(campaign.sendIntervalSeconds) s")
                }
            }
            .font(.caption)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.page.opacity(0.6), in: RoundedRectangle(cornerRadius: 9))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 120), spacing: 8)], spacing: 8) {
                MailCampaignTile(label: "Wysłane", value: campaign.sentCount, color: CrmTheme.rgb(0x6ee7b7))
                MailCampaignTile(label: "Błędy", value: campaign.failedCount, color: CrmTheme.rgb(0xfca5a5))
                MailCampaignTile(label: "Otwarcia", value: campaign.openedCount, color: CrmTheme.rgb(0x7dd3fc))
                MailCampaignTile(label: "Kliknięcia", value: campaign.clickedCount, color: CrmTheme.rgb(0xc4b5fd))
                MailCampaignTile(label: "Wypisani", value: campaign.unsubscribedCount, color: CrmTheme.rgb(0xfcd34d))
            }
            if access.canManage { queueButtons }
        }
    }

    private var queueButtons: some View {
        HStack(spacing: 8) {
            if campaign.isRunning {
                Button(action: actions.pause) { Label("Wstrzymaj", systemImage: "pause") }.foregroundStyle(CrmTheme.rgb(0xfcd34d))
            }
            if campaign.state == .paused {
                Button(action: actions.resume) { Label("Wznów", systemImage: "play") }.foregroundStyle(CrmTheme.rgb(0x6ee7b7))
            }
            if campaign.isRunning || campaign.state == .paused {
                Button(action: actions.cancel) { Label("Anuluj", systemImage: "nosign") }.foregroundStyle(CrmTheme.rgb(0xfca5a5))
            }
            if campaign.isRunning {
                Label("Kolejka jest monitorowana automatycznie", systemImage: "waveform.path.ecg")
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0x7dd3fc)).symbolEffect(.pulse)
            }
        }
    }
}

/// „Zaplanuj kontrolowaną wysyłkę”: termin startu, wielkość partii (1–20) i odstęp między partiami.
struct MailCampaignScheduleBox: View {
    @Binding var scheduledAt: Date
    @Binding var batchSize: Int
    @Binding var interval: Int
    let start: () -> Void

    private var tint: Color { CrmTheme.rgb(0x93c5fd) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Label("Zaplanuj kontrolowaną wysyłkę", systemImage: "calendar.badge.clock").font(.callout.weight(.medium))
                Text("Po uruchomieniu odbiorcy zostaną ponownie sprawdzeni, a wiadomości trafią do kolejki partiami.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            MailCampaignField(label: "Termin startu") {
                DatePicker("Termin startu", selection: $scheduledAt, displayedComponents: [.date, .hourAndMinute]).labelsHidden()
            }
            HStack(alignment: .top, spacing: 12) {
                MailCampaignField(label: "Wiadomości w partii") {
                    Stepper(value: $batchSize, in: 1...20) { Text("\(batchSize)").monospacedDigit() }
                }
                MailCampaignField(label: "Odstęp między partiami") {
                    Picker("Odstęp między partiami", selection: $interval) {
                        ForEach(MailCampaignLabels.intervals) { option in Text(option.label).tag(option.seconds) }
                    }
                    .labelsHidden()
                }
            }
            Button(action: start) { Label("Uruchom bezpieczną kolejkę", systemImage: "play.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent).tint(tint).controlSize(.large)
                .disabled(!(1...20).contains(batchSize))
        }
        .padding(12)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 9))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(tint.opacity(0.22)))
    }
}

// MARK: Podgląd wiadomości

@MainActor struct MailCampaignPreviewCard: View {
    let content: String
    let previewText: String
    @Environment(\.crmTheme) private var theme

    private var html: String {
        content.isEmpty ? "<div style=\"font-family:Arial;padding:24px;color:#666\">Uzupełnij treść wiadomości.</div>" : content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Label("Podgląd wiadomości", systemImage: "eye").font(.callout).padding(.horizontal, 14).padding(.vertical, 10)
            Divider()
            if !previewText.isEmpty {
                Label(previewText, systemImage: "envelope").font(.caption).foregroundStyle(.secondary)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.page.opacity(0.6))
                Divider()
            }
            MailCampaignHTMLView(html: html).frame(height: 430)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

/// Treść HTML kampanii bez skryptów i bez nawigacji (jak `<iframe sandbox="">`), na białym tle.
struct MailCampaignHTMLView: NSViewRepresentable {
    let html: String

    final class Coordinator: NSObject, WKNavigationDelegate {
        var html: String?

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.navigationType == .other ? .allow : .cancel)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.underPageBackgroundColor = .white
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {
        guard context.coordinator.html != html else { return }
        context.coordinator.html = html
        view.loadHTMLString(html, baseURL: nil)
    }
}

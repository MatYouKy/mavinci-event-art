import SwiftUI

// MARK: Karta kampanii — sekcje jak w `CampaignsPageClient`: dane wersji roboczej („Zapisz wersję”), Odbiorcy (segmenty
// i reguły, „Przelicz”), Podgląd kwalifikacji, demo kampanii z broszury, Test / zatwierdzenie / wysyłka oraz Podgląd
// wiadomości. Przeliczenie, test i przekazanie do zatwierdzenia wymagają zapisanej wersji (działają na kampanii z bazy).
// Gdy kolejka pracuje (zaplanowana / wysyłanie), lista i odbiorcy odświeżają się co 15 s.

@MainActor struct MailCampaignDetailView: View {
    @ObservedObject var store: MailCampaignsStore
    let campaign: MailCampaign
    let home: MailCampaignHome
    @Binding var dirty: Bool
    @EnvironmentObject private var state: Workspace
    @State private var draft: MailCampaignDraft
    @State private var baseline: MailCampaignDraft
    @State private var baselineVersion: String
    @State private var testEmail = ""
    @State private var scheduledAt: Date
    @State private var batchSize: Int
    @State private var interval: Int
    @State private var cancelling = false

    init(store: MailCampaignsStore, campaign: MailCampaign, home: MailCampaignHome, dirty: Binding<Bool>) {
        self.store = store
        self.campaign = campaign
        self.home = home
        _dirty = dirty
        let draft = MailCampaignDraft(campaign)
        _draft = State(initialValue: draft)
        _baseline = State(initialValue: draft)
        _baselineVersion = State(initialValue: campaign.updatedAt)
        _scheduledAt = State(initialValue: Self.startDate(campaign))
        _batchSize = State(initialValue: campaign.batchSize)
        _interval = State(initialValue: campaign.sendIntervalSeconds)
    }

    /// Termin startu: zapisany albo za 5 minut (jak `toDateTimeInput`), pełne minuty.
    private static func startDate(_ campaign: MailCampaign) -> Date {
        let date: Date = MeetingDates.parse(campaign.scheduledAt) ?? Date().addingTimeInterval(5 * 60)
        return Date(timeIntervalSince1970: (date.timeIntervalSince1970 / 60).rounded(.down) * 60)
    }

    private var access: MailCampaignAccess { home.access }
    private var editable: Bool { campaign.state == .draft && access.canManage }
    /// „Przelicz” — wersja robocza albo kampania czekająca na zatwierdzenie (przeliczenie wraca ją do wersji roboczej).
    private var canRefresh: Bool { access.canManage && (campaign.state == .draft || campaign.state == .pending_approval) }
    private var pollKey: String { "\(campaign.id)|\(campaign.isRunning ? "run" : "idle")" }

    var body: some View {
        sections
            .task(id: campaign.id) { await store.loadRecipients(campaign.id) }
            .task(id: pollKey) { await poll() }
            .onChange(of: campaign.updatedAt) { _, _ in
                // Zmiana z serwera (zapis, przeliczenie, status, przeglądarka): bez niezapisanych zmian — formularz z bazy.
                if draft == baseline { adopt(campaign, keepEdits: false) }
            }
            .onChange(of: draft) { _, value in dirty = value != baseline }
            .onAppear { dirty = false }
            .confirmationDialog("Anulować kampanię?", isPresented: $cancelling, titleVisibility: .visible) {
                Button("Anuluj kampanię", role: .destructive) { act("Anulowanie kampanii…", "cancel") }
                Button("Wróć", role: .cancel) {}
            } message: { Text("Niewysłane wiadomości zostaną trwale usunięte z kolejki.") }
    }

    private var sections: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                formCard
                audienceCard
                MailCampaignRecipientsCard(store: store, campaignID: campaign.id)
                if campaign.hasBrochure { demoCard }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 16) {
                    deliveryCard
                    previewCard
                }
            }
            .padding(.bottom, 16)
        }
    }

    private var columns: [GridItem] { [GridItem(.adaptive(minimum: 440), spacing: 16, alignment: .top)] }
    private var dirtyNow: Bool { draft != baseline }
    private var canGenerateDemo: Bool { access.canManage && campaign.state == .draft }

    private var formCard: some View {
        MailCampaignFormCard(draft: $draft, campaign: campaign, home: home, editable: editable, dirty: dirtyNow, save: save)
    }

    private var audienceCard: some View {
        MailCampaignAudienceCard(draft: $draft, campaign: campaign, home: home, editable: editable, canRefresh: canRefresh, refresh: refreshAudience)
    }

    private var demoCard: some View {
        MailCampaignDemoCard(store: store, campaignID: campaign.id, canGenerate: canGenerateDemo)
    }

    private var previewCard: some View {
        MailCampaignPreviewCard(content: draft.content, previewText: draft.previewText)
    }

    private var deliveryCard: some View {
        MailCampaignDeliveryCard(
            campaign: campaign, access: access, testEmail: $testEmail, scheduledAt: $scheduledAt, batchSize: $batchSize, interval: $interval,
            actions: MailCampaignDeliveryActions(
                test: { sendTest() },
                submit: { guarded("Przekazywanie do zatwierdzenia…", "submit") },
                approve: { act("Zatwierdzanie kampanii…", "approve") },
                schedule: { schedule() },
                pause: { act("Wstrzymywanie kampanii…", "pause") },
                resume: { act("Wznawianie kampanii…", "resume") },
                cancel: { cancelling = true }
            )
        )
    }

    // MARK: Czynności

    /// Formularz z zapisanej kampanii; `keepEdits` — zostawia wpisane w międzyczasie zmiany.
    private func adopt(_ fresh: MailCampaign, keepEdits: Bool) {
        let next = MailCampaignDraft(fresh)
        baseline = next
        baselineVersion = fresh.updatedAt
        if !keepEdits { draft = next }
        scheduledAt = Self.startDate(fresh)
        batchSize = fresh.batchSize
        interval = fresh.sendIntervalSeconds
        dirty = draft != baseline
    }

    private func save() {
        guard editable else { return }
        let saved: MailCampaignDraft = draft
        let body: [String: JSONValue] = draft.payload(id: campaign.id, updatedAt: baselineVersion)
        let id: String = campaign.id
        Task {
            let reply: [String: JSONValue]? = await store.run("Zapisywanie kampanii…", "save", body)
            guard reply != nil, let fresh = store.campaigns.first(where: { $0.id == id }) else { return }
            adopt(fresh, keepEdits: draft != saved)
        }
    }

    /// Przeliczenie, test i przekazanie do zatwierdzenia działają na zapisanej kampanii — najpierw „Zapisz wersję”.
    private func blockedByUnsaved() -> Bool {
        guard draft != baseline else { return false }
        state.error = "Najpierw zapisz wersję — przeliczenie, test i zatwierdzenie korzystają z zapisanej kampanii."
        return true
    }

    private func refreshAudience() {
        guard !blockedByUnsaved() else { return }
        act("Przeliczanie odbiorców…", "audience")
    }

    private func sendTest() {
        guard !blockedByUnsaved() else { return }
        let email: String = testEmail.trimmingCharacters(in: .whitespaces)
        guard !email.isEmpty else { return }
        let body: [String: JSONValue] = ["id": .string(campaign.id), "email": .string(email)]
        Task { await store.run("Wysyłanie wiadomości testowej…", "test", body) }
    }

    private func guarded(_ pending: String, _ op: String) {
        guard !blockedByUnsaved() else { return }
        act(pending, op)
    }

    private func schedule() {
        guard (1...20).contains(batchSize) else {
            state.error = "Partia może mieć od 1 do 20 wiadomości."
            return
        }
        let body: [String: JSONValue] = [
            "id": .string(campaign.id), "scheduledAt": .string(MeetingDates.iso(scheduledAt)),
            "batchSize": .number(Double(batchSize)), "sendIntervalSeconds": .number(Double(interval)),
        ]
        let id: String = campaign.id
        Task { await store.run("Planowanie wysyłki…", "schedule", body, recipientsOf: id) }
    }

    private func act(_ pending: String, _ op: String) {
        let id: String = campaign.id
        let body: [String: JSONValue] = ["id": .string(id)]
        Task { await store.run(pending, op, body, recipientsOf: id) }
    }

    /// Kolejka pracuje — lista i odbiorcy co 15 s (jak `setInterval` w CRM).
    private func poll() async {
        guard campaign.isRunning else { return }
        let id: String = campaign.id
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(15))
            if Task.isCancelled { return }
            await store.load(quiet: true)
            await store.loadRecipients(id)
        }
    }
}

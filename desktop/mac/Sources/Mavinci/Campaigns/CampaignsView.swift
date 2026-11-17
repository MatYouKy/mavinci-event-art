import SwiftUI

// MARK: Centrum Kampanii — 1:1 z `/crm/campaigns` (Marketing → Kampanie e-mail): nagłówek „Sprzedaż i relacje”, „Odśwież”,
// „Nowa kampania”, lista kampanii ze statusem, tematem, broszurą PDF, liczbą odbiorców i datą zmiany oraz karta wybranej
// kampanii (`MailCampaignDetailView`). Niezapisane zmiany nie giną przy przejściu do innej kampanii (pytanie o porzucenie).

@MainActor struct MailCampaignsView: View {
    @ObservedObject var store: MailCampaignsStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    /// Edytowana kampania ma niezapisane zmiany (zgłasza karta kampanii).
    @State private var dirty = false
    @State private var pendingSelection: String?

    private var canManage: Bool { store.access?.canManage ?? false }
    private var subtitle: String {
        guard let home = store.home else { return "" }
        return "Kampanii: \(home.campaigns.count)"
    }
    private var discardShown: Binding<Bool> {
        Binding(get: { pendingSelection != nil }, set: { shown in if !shown { pendingSelection = nil } })
    }

    var body: some View {
        content
            .navigationTitle("Centrum Kampanii")
            .navigationSubtitle(subtitle)
            .task(id: state.employee?.id) { await store.load() }
            .confirmationDialog("Porzucić niezapisane zmiany?", isPresented: discardShown, titleVisibility: .visible) {
                if let id = pendingSelection {
                    Button("Porzuć zmiany", role: .destructive) { select(id, force: true) }
                    Button("Wróć do edycji", role: .cancel) {}
                }
            } message: { Text("Zmiany w bieżącej kampanii nie zostały zapisane.") }
    }

    @ViewBuilder private var content: some View {
        if let home = store.home {
            centre(home)
        } else if let error = store.loadError {
            ContentUnavailableView {
                Label("Centrum Kampanii", systemImage: "megaphone")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func centre(_ home: MailCampaignHome) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            HStack(alignment: .top, spacing: 16) {
                campaignList(home).frame(width: 330)
                detail(home).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Sprzedaż i relacje", systemImage: "megaphone").font(.callout).foregroundStyle(theme.accent)
                Text("Centrum Kampanii").font(.title.weight(.light))
                Text("Twórz kampanie tylko do klientów z właściwą podstawą komunikacji. Każda grupa jest przeliczana, testowana i zatwierdzana przed wysyłką.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 16)
            if store.loading { ProgressView().controlSize(.small) }
            Button { Task { await refresh() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            if canManage {
                Button { create() } label: { Label("Nowa kampania", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
        }
    }

    private func campaignList(_ home: MailCampaignHome) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("KAMPANIE").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                .padding(.horizontal, 14).padding(.vertical, 10)
            Divider()
            if home.campaigns.isEmpty {
                Text("Brak kampanii. Utwórz pierwszą wersję roboczą.").foregroundStyle(.secondary)
                    .multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(28)
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(home.campaigns) { campaign in
                            MailCampaignRow(campaign: campaign, selected: campaign.id == store.selectedID) { select(campaign.id, force: false) }
                        }
                    }
                    .padding(8)
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder private func detail(_ home: MailCampaignHome) -> some View {
        if let campaign = store.selected {
            MailCampaignDetailView(store: store, campaign: campaign, home: home, dirty: $dirty).id(campaign.id)
        } else {
            Text("Wybierz kampanię lub utwórz nową.").foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 420)
                .background(theme.card, in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func select(_ id: String, force: Bool) {
        guard id != store.selectedID else { return }
        if dirty && !force {
            pendingSelection = id
            return
        }
        pendingSelection = nil
        dirty = false
        store.selectedID = id
    }

    private func create() {
        guard !dirty else {
            state.error = "Zapisz zmiany w bieżącej kampanii albo przełącz się na inną i porzuć je, zanim utworzysz nową."
            return
        }
        Task { await store.run("Tworzenie kampanii…", "create", [:]) }
    }

    private func refresh() async {
        await store.load()
        if let id = store.selectedID { await store.loadRecipients(id) }
    }
}

/// Pozycja listy kampanii.
@MainActor struct MailCampaignRow: View {
    let campaign: MailCampaign
    let selected: Bool
    let open: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var hover = false

    var body: some View {
        Button(action: open) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top, spacing: 8) {
                    Text(campaign.name).font(.callout.weight(.medium)).lineLimit(1)
                    Spacer(minLength: 4)
                    MailCampaignStatusChip(status: campaign.state, small: true)
                }
                Text(campaign.subject.isEmpty ? "Brak tematu" : campaign.subject).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if campaign.hasBrochure {
                    MailCampaignBadge(text: "Broszura PDF · szkic", color: CrmTheme.rgb(0xddd6fe))
                }
                HStack(spacing: 12) {
                    Text("\(campaign.eligibleCount) odbiorców")
                    Text(MailCampaignLabels.date(campaign.updatedAt))
                }
                .font(.caption2).foregroundStyle(.tertiary)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(background, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(selected ? theme.accent.opacity(0.45) : Color.clear))
            .contentShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }

    private var background: Color {
        if selected { return theme.accent.opacity(0.12) }
        return hover ? Color.primary.opacity(0.07) : Color.primary.opacity(0.035)
    }
}

/// Status kampanii jak plakietka w CRM.
struct MailCampaignStatusChip: View {
    let status: MailCampaignStatus
    var small = false

    var body: some View {
        Text(status.label)
            .font(small ? .caption2 : .caption)
            .padding(.horizontal, small ? 7 : 9).padding(.vertical, small ? 2 : 4)
            .foregroundStyle(status.color)
            .background(status.color.opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(status.color.opacity(0.28)))
            .fixedSize()
    }
}

/// Mała plakietka (np. „Przypisana broszura PDF”).
struct MailCampaignBadge: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text).font(.caption2)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .foregroundStyle(color)
            .background(CrmTheme.rgb(0xa78bfa).opacity(0.12), in: Capsule())
            .overlay(Capsule().stroke(CrmTheme.rgb(0xa78bfa).opacity(0.25)))
            .fixedSize()
    }
}

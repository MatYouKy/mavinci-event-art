import SwiftUI
import AppKit

// MARK: Szczegóły → „Akcje” (1:1 z `EventDetailsAction`): kategoria (z uprawnieniem do ofert), liczba ofert, status eventu
// (statusy magazynu ustawia magazyn), potwierdzenie e-mail dla klienta (historia wysyłki, podgląd odbiorcy, wysyłka przez
// `send-event-confirmation`) i wydruk checklisty sprzętu przy statusie „Gotowy do realizacji”.

@MainActor struct EventDetailsActionCard: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let page: EventCardPage
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editingCategory = false
    @State private var categoryID = ""
    @State private var savingCategory = false
    @State private var editingStatus = false
    @State private var draftStatus = "inquiry"
    @State private var savingStatus = false
    @State private var confirmationOpen = false
    @State private var preview: NativePreview?

    static let statusLabels: [(String, String)] = [
        ("inquiry", "Zapytanie"), ("offer_to_send", "Oferta do wysłania"), ("offer_sent", "Oferta wysłana"),
        ("offer_accepted", "Oferta zaakceptowana"), ("in_preparation", "W przygotowaniu"), ("ready_for_live", "Gotowy do realizacji"),
        ("in_progress", "W trakcie"), ("completed", "Zrealizowany"), ("cancelled", "Anulowany"), ("invoiced", "Zafakturowany"),
        ("settled", "Rozliczony"),
    ]
    static func statusLabel(_ value: String) -> String { statusLabels.first { $0.0 == value }?.1 ?? value }
    static func statusSymbol(_ value: String) -> String {
        switch value {
        case "inquiry": return "smallcircle.filled.circle"
        case "offer_to_send", "offer_sent": return "doc.text"
        case "offer_accepted": return "checkmark.seal"
        case "in_preparation": return "arrow.triangle.2.circlepath"
        case "in_progress", "ready_for_live": return "play.circle"
        case "completed": return "checkmark.circle"
        case "cancelled": return "xmark.circle"
        case "settled": return "dollarsign.circle"
        case "invoiced": return "doc.plaintext"
        default: return "circle"
        }
    }
    private static let warehouseStatuses: Set<String> = ["in_preparation", "ready_for_live"]
    private static let acceptedStatuses: Set<String> = ["offer_accepted", "in_preparation", "ready_for_live", "in_progress", "completed", "invoiced", "settled"]

    private var event: EventFields { EventFields(raw: page.event ?? [:]) }
    private var flags: EventCardFlags? { page.flags }
    private var canManageStatus: Bool { flags?.canEventManage == true }
    private var canOffers: Bool { flags?.canOffers == true }
    private var categories: [[String: JSONValue]] { (page.categories ?? []).map(\.object) }
    private var details: EventCardDetails? { store.details(eventID) }
    private var category: [String: JSONValue]? { categories.first { $0["id"]?.text == event["category_id"] && !event["category_id"].isEmpty } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Akcje").font(.title3.weight(.light))
            categorySection
            if canOffers { offersSection }
            if canManageStatus { statusSection }
            if canManageStatus && Self.acceptedStatuses.contains(event.status) { confirmationSection }
            if event.status == "ready_for_live" && flags?.canEquipment == true {
                Button { Task { await printChecklist() } } label: {
                    Label("Drukuj checklistę sprzętu", systemImage: "printer").frame(maxWidth: .infinity)
                }
                .controlSize(.large).help("Generuj checklistę sprzętu")
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
        .sheet(isPresented: $confirmationOpen) {
            EventConfirmationSheet(store: store, eventID: eventID, alreadySent: details?.confirmation?.delivery != nil).warehouseSheetStyle(state)
        }
        .sheet(item: $preview) { NativeDocumentPreview(preview: $0) }
    }

    // MARK: Kategoria
    private var categoryBadge: some View {
        HStack(spacing: 8) {
            Image(systemName: "tag")
            Text(category?["name"]?.text ?? "Brak kategorii").font(.callout.weight(.medium))
        }
        .foregroundStyle(CrmTheme.rgb(0xf0dda0))
    }
    private var categorySection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Kategoria").font(.caption).foregroundStyle(.secondary)
            if !canOffers {
                categoryBadge.padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(categoryFill, in: RoundedRectangle(cornerRadius: 8))
            } else if !editingCategory {
                Button { categoryID = event["category_id"]; editingCategory = true } label: {
                    HStack {
                        categoryBadge
                        Spacer()
                        Text("Zmień").font(.caption).foregroundStyle(CrmTheme.rgb(0xf0dda0).opacity(0.7))
                    }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(categoryFill, in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Kliknij aby edytować kategorię")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        (Text("Aktualnie: ").foregroundColor(.secondary) + Text(category?["name"]?.text ?? "brak")).font(.caption)
                        Spacer()
                        Button("Anuluj") { editingCategory = false; categoryID = event["category_id"] }.buttonStyle(.link).linkCursor().font(.caption)
                    }
                    Picker("Kategoria", selection: $categoryID) {
                        Text("Brak kategorii").tag("")
                        ForEach(Array(categories.enumerated()), id: \.offset) { _, item in Text(item["name"]?.text ?? "").tag(item["id"]?.text ?? "") }
                    }
                    .labelsHidden().disabled(savingCategory)
                    .onChange(of: categoryID) { if editingCategory && categoryID != event["category_id"] { Task { await saveCategory() } } }
                    HStack {
                        Text(savingCategory ? "Zapisuję…" : "Wybierz kategorię z listy").font(.caption).foregroundStyle(.tertiary)
                        Spacer()
                        if savingCategory { ProgressView().controlSize(.small) }
                    }
                }
                .padding(10).background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
    private var categoryFill: LinearGradient {
        LinearGradient(colors: [Color(.sRGB, red: 127 / 255, green: 23 / 255, blue: 52 / 255, opacity: 0.58),
                                Color(.sRGB, red: 94 / 255, green: 51 / 255, blue: 68 / 255, opacity: 0.48)], startPoint: .leading, endPoint: .trailing)
    }
    private func saveCategory() async {
        savingCategory = true
        defer { savingCategory = false }
        do {
            try await store.detailsRun(eventID, "category", ["categoryId": categoryID.isEmpty ? .null : .string(categoryID)],
                                       success: "Zaktualizowano kategorię wydarzenia")
            editingCategory = false
        } catch {
            state.error = store.failureText(error, "Błąd podczas zmiany kategorii")
        }
    }

    // MARK: Oferty
    private var offersSection: some View {
        let count = page.offers?.count ?? 0
        let text = count > 0 ? "\(count) ofert\(count == 1 ? "a" : count < 5 ? "y" : "")" : "Brak oferty"
        let color = count > 0 ? CrmTheme.rgb(0x86efac) : CrmTheme.rgb(0xfdba74)
        return VStack(alignment: .leading, spacing: 6) {
            Text("Oferty").font(.caption).foregroundStyle(.secondary)
            Label(text, systemImage: "doc.text").font(.callout.weight(.medium)).foregroundStyle(color)
                .padding(.horizontal, 12).padding(.vertical, 8).frame(maxWidth: .infinity, alignment: .leading)
                .background((count > 0 ? CrmTheme.rgb(0x22c55e) : CrmTheme.rgb(0xf97316)).opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: Status
    private var statusSection: some View {
        let current = event.status
        let colors = EventLabels.statusColors(current)
        return VStack(alignment: .leading, spacing: 6) {
            Text("Status eventu").font(.caption).foregroundStyle(.secondary)
            if !editingStatus {
                Button { draftStatus = current; editingStatus = true } label: {
                    HStack {
                        Label(Self.statusLabel(current), systemImage: Self.statusSymbol(current)).font(.callout.weight(.medium))
                        Spacer()
                        Image(systemName: "chevron.down").font(.caption)
                    }
                    .foregroundStyle(colors.text)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(colors.background, in: RoundedRectangle(cornerRadius: 8)).contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Kliknij aby zmienić status")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        (Text("Aktualnie: ").foregroundColor(.secondary) + Text(Self.statusLabel(current))).font(.caption)
                        Spacer()
                        Button("Anuluj") { draftStatus = current; editingStatus = false }.buttonStyle(.link).linkCursor().font(.caption)
                    }
                    Picker("Status", selection: $draftStatus) {
                        if Self.warehouseStatuses.contains(current) {
                            Text("\(Self.statusLabel(current)) · status magazynu").tag(current).selectionDisabled()
                        }
                        ForEach(Self.statusLabels.filter { !Self.warehouseStatuses.contains($0.0) }, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    .labelsHidden().disabled(savingStatus)
                    HStack {
                        Text(savingStatus ? "Zapisuję…" : "Wybierz status i zapisz zmianę").font(.caption).foregroundStyle(.tertiary)
                        Spacer()
                        Button { Task { await saveStatus() } } label: {
                            HStack(spacing: 5) {
                                if savingStatus { ProgressView().controlSize(.mini) }
                                Text("Zapisz")
                            }
                        }
                        .buttonStyle(.borderedProminent).controlSize(.small).disabled(savingStatus || draftStatus == current)
                    }
                }
                .padding(10).background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }
    private func saveStatus() async {
        let current = event.status
        if draftStatus != current && Self.warehouseStatuses.contains(draftStatus) {
            state.notice = "Ten status ustawia magazyn podczas przygotowania realizacji."
            return
        }
        savingStatus = true
        defer { savingStatus = false }
        do {
            try await store.detailsRun(eventID, "detailsStatus", ["status": .string(draftStatus), "previous": .string(current)],
                                       success: "Status eventu: \(Self.statusLabel(draftStatus))")
            editingStatus = false
            if draftStatus == "offer_accepted" && current != "offer_accepted" { confirmationOpen = true }
        } catch {
            state.error = store.failureText(error, "Błąd podczas zmiany statusu")
        }
    }

    // MARK: Potwierdzenie e-mail
    @ViewBuilder private var confirmationSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let confirmation = details?.confirmation {
                if confirmation.historyError {
                    HStack(spacing: 4) {
                        Text("Nie udało się sprawdzić historii wysyłki.")
                        Button("Ponów") { Task { await store.loadDetails(eventID) } }.buttonStyle(.link).linkCursor()
                    }
                    .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d))
                } else {
                    Button { confirmationOpen = true } label: {
                        Label(confirmation.delivery != nil ? "Wyślij potwierdzenie ponownie" : "Wyślij potwierdzenie do klienta", systemImage: "envelope")
                            .frame(maxWidth: .infinity)
                    }
                    .controlSize(.large)
                    if let delivery = confirmation.delivery {
                        Label("Potwierdzenie wysłane e-mailem", systemImage: "checkmark.circle").font(.caption).foregroundStyle(CrmTheme.rgb(0x6ee7b7))
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(CrmTheme.rgb(0x10b981).opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                        let when = MeetingDates.parse(delivery.sentAt).map { MeetingDates.format($0, "d.MM.yyyy, HH:mm:ss") } ?? delivery.sentAt
                        Text("\(when) · \(delivery.recipient)").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                }
            } else {
                Text("Sprawdzam potwierdzenie e-mail…").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: Checklista sprzętu
    private func printChecklist() async {
        guard let api = state.nativeAPI() else { return }
        await state.withPending("Pobieranie checklisty…") {
            do {
                struct Reply: Decodable { let url: String; let name: String? }
                let reply = try JSONDecoder().decode(Reply.self, from: try await api.get("/events/card", query: ["op": "checklist", "id": eventID]))
                guard let url = URL(string: reply.url) else { state.error = "Nie udało się wygenerować linku do checklisty"; return }
                let (data, _) = try await URLSession.shared.data(from: url)
                preview = NativePreview(name: reply.name?.nonEmpty ?? "checklista-sprzetu.pdf", data: data)
            } catch let failure as NativeFailure where failure.status == 404 {
                state.notice = "Brak checklisty sprzętu do wydruku"
            } catch {
                state.error = store.failureText(error, "Błąd podczas otwierania checklisty")
            }
        }
    }
}

/// Okno „Potwierdzenie email” z podglądem odbiorcy (`EventAcceptanceConfirmationPreview`).
@MainActor struct EventConfirmationSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let alreadySent: Bool
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var preview: EventConfirmationPreview?
    @State private var loading = true
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Potwierdzenie email", systemImage: "envelope").font(.title3.weight(.light)).foregroundStyle(.primary)
            Text(alreadySent ? "Potwierdzenie zostało już wysłane. Czy wysłać je ponownie do klienta?" : "Czy wysłać e-mail z potwierdzeniem realizacji do klienta?")
                .font(.callout).foregroundStyle(.secondary)
            previewBox
            HStack {
                Button { Task { await send() } } label: {
                    HStack(spacing: 6) {
                        if sending { ProgressView().controlSize(.small) } else { Image(systemName: "envelope") }
                        Text(sending ? "Wysyłanie..." : "Wyślij")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(sending || loading || preview?.recipientEmail?.isEmpty != false)
                Button("Pomiń") { dismiss() }.controlSize(.large).keyboardShortcut(.cancelAction).disabled(sending)
            }
        }
        .padding(20).frame(width: 460)
        .task {
            do { preview = try await store.confirmationPreview(eventID) }
            catch { self.error = (error as? NativeFailure)?.message ?? "Nie udało się odczytać odbiorcy." }
            loading = false
        }
    }

    @ViewBuilder private var previewBox: some View {
        if loading {
            Text("Wczytywanie odbiorcy potwierdzenia…").font(.callout).foregroundStyle(.secondary)
        } else if let error {
            Text("\(error) Możesz zapisać akceptację bez wysyłki.").font(.callout).foregroundStyle(CrmTheme.rgb(0xfde68a))
        } else if let preview {
            VStack(alignment: .leading, spacing: 6) {
                Text(preview.eventName).font(.callout.weight(.medium))
                Text(preview.eventDate.flatMap(MeetingDates.parse).map { MeetingDates.format($0, "d MMMM yyyy HH:mm") } ?? "Termin nie został zapisany")
                    .font(.caption)
                if let email = preview.recipientEmail?.nonEmpty {
                    (Text("Odbiorca: ") + Text(email).foregroundColor(.primary) + Text(preview.recipientName.isEmpty ? "" : " · \(preview.recipientName)"))
                        .font(.callout)
                } else {
                    Text("Brak e-maila kontaktu i organizacji wydarzenia. Akceptacja jest możliwa bez wiadomości.").font(.callout).foregroundStyle(CrmTheme.rgb(0xfde68a))
                }
                Text("Potwierdzenie realizacji korzysta z danych wydarzenia: terminu, miejsca, harmonogramu i zaakceptowanej oferty. To ten sam szablon co przy zmianie statusu wydarzenia. Nie wystawia ani nie wysyła faktury.")
                    .font(.caption)
            }
            .foregroundStyle(.secondary)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func send() async {
        guard !sending, let email = preview?.recipientEmail?.nonEmpty else {
            state.error = "Brak potwierdzonego odbiorcy wiadomości dla tego wydarzenia."
            return
        }
        sending = true
        defer { sending = false }
        do {
            let data = try await store.detailsRun(eventID, "sendConfirmation", ["expectedRecipientEmail": .string(email)], success: nil, pending: "Wysyłanie…")
            struct Reply: Decodable { let recipientEmail: String?; let historyRecorded: Bool? }
            let reply = try? JSONDecoder().decode(Reply.self, from: data)
            state.succeed("Wysłano potwierdzenie do \(reply?.recipientEmail ?? email)")
            if reply?.historyRecorded == false {
                state.notice = "Wiadomość wysłana, ale nie zapisano historii potwierdzenia. Nie wysyłaj ponownie bez sprawdzenia wiadomości wysłanych."
            }
        } catch {
            state.error = store.failureText(error, "Nie udało się wysłać potwierdzenia")
        }
        dismiss()
    }
}

import SwiftUI

// MARK: Oferty (`/crm/offers`, `OfferPage.tsx` i `OffersViews.tsx`) — liczniki (wszystkie, szkice, wysłane, zaakceptowane,
// łączna wartość), wyszukiwanie po ofercie, kliencie, kontakcie, e-mailu i telefonie, filtr statusu, widok listy / tabeli /
// kafelków. Dwuklik otwiera stronę oferty (`OfferPageView`). „Nowa oferta” — kreator (`OfferWizardSheet`, najpierw wybór eventu).

@MainActor struct OffersView: View {
    @ObservedObject var store: OffersStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @AppStorage("offersViewMode") private var mode = "table"
    @State private var search = ""
    @State private var status = "all"
    @State private var deleting: OfferListItem?
    @State private var wizard: OfferWizardRoute?
    @State private var sortOrder = [KeyPathComparator(\OfferListItem.sortCreated, order: .reverse)]

    var body: some View {
        if let id = store.openedID {
            OfferPageView(store: store, offerID: id).id(id)
        } else {
            list
        }
    }

    private var rows: [OfferListItem] {
        store.offers.filter { item in
            (status == "all" || item.status == status) && OfferText.matches(item, search)
        }.sorted(using: sortOrder)
    }

    private var list: some View {
        VStack(spacing: 0) {
            toolbar
            if let problem = store.loadError { MessageBar(text: problem, warning: true) { store.loadError = nil } }
            if !store.offers.isEmpty { stats }
            content.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Oferty")
        .confirmationDialog("Czy na pewno chcesz usunąć tę ofertę?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Usuń ofertę", role: .destructive) {
                if let item = deleting { Task { _ = await store.delete(item.id) } }
                deleting = nil
            }
            Button("Anuluj", role: .cancel) { deleting = nil }
        } message: {
            Text(deleting?.eventId != nil
                 ? "Sprzęt automatycznie dodany z tej oferty zostanie usunięty z eventu.\nWszystkie pliki PDF zostaną usunięte.\n\nTej operacji nie można cofnąć."
                 : "Wszystkie pliki PDF zostaną usunięte.\n\nTej operacji nie można cofnąć.")
        }
        .sheet(item: $wizard) { route in
            OfferWizardSheet(store: store, eventID: route.eventID) { id in store.selectedID = id }
        }
        .task(id: state.employee?.id) {
            await store.backgroundSync()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                await store.backgroundSync()
            }
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            TextField("Szukaj oferty, klienta, kontaktu, e-maila lub telefonu…", text: $search)
                .textFieldStyle(.roundedBorder).frame(maxWidth: 360)
            Picker("Status", selection: $status) {
                Text("Wszystkie statusy").tag("all")
                Text("Szkice").tag("draft")
                Text("Wysłane").tag("sent")
                Text("Zaakceptowane").tag("accepted")
                Text("Odrzucone").tag("rejected")
            }
            .labelsHidden().fixedSize()
            Picker("Widok", selection: $mode) {
                Image(systemName: "list.bullet").help("Widok listy").tag("list")
                Image(systemName: "tablecells").help("Widok tabeli").tag("table")
                Image(systemName: "square.grid.2x2").help("Widok kafelków").tag("grid")
            }
            .pickerStyle(.segmented).labelsHidden().fixedSize()
            Spacer()
            if store.syncing { ProgressView().controlSize(.small) }
            Button { Task { await store.sync(force: true) } } label: { Image(systemName: "arrow.clockwise") }
                .help("Odśwież listę ofert")
            Button { wizard = OfferWizardRoute(eventID: nil) } label: { Label("Nowa oferta", systemImage: "plus") }
                .buttonStyle(.borderedProminent)
                .help("Kreator oferty: wybierz wydarzenie, klienta i produkty")
        }
        .controlSize(.small)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .crmBar()
    }

    /// Liczniki jak kafelki nad listą w CRM (zawsze z całej listy, niezależnie od filtrów).
    private var stats: some View {
        let all = store.offers
        return HStack(spacing: 10) {
            stat("Wszystkie", "\(all.count)", "doc.text")
            stat("Szkice", "\(all.filter { $0.status == "draft" }.count)", "doc.text")
            stat("Wysłane", "\(all.filter { $0.status == "sent" }.count)", "paperplane")
            stat("Zaakceptowane", "\(all.filter { $0.status == "accepted" }.count)", "checkmark.seal")
            stat("Łączna wartość", OfferText.sum(all.reduce(0) { $0 + $1.totalAmount }), "banknote")
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
    }

    private func stat(_ label: String, _ value: String, _ symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: symbol).foregroundStyle(theme.accent)
                Text(value).font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
            }
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.primary.opacity(0.08)))
    }

    @ViewBuilder private var content: some View {
        if store.offers.isEmpty {
            if !store.loaded { ProgressView("Ładowanie ofert…") }
            else { ContentUnavailableView("Brak ofert. Kliknij „Nowa oferta” aby rozpocząć.", systemImage: "doc.text") }
        } else if rows.isEmpty {
            ContentUnavailableView {
                Label("Brak ofert spełniających kryteria", systemImage: "doc.text.magnifyingglass")
            } actions: {
                Button("Pokaż wszystkie") { search = ""; status = "all" }
            }
        } else if mode == "grid" {
            grid
        } else if mode == "list" {
            listView
        } else {
            table
        }
    }

    // MARK: Widoki
    private var table: some View {
        Table(rows, selection: $store.selectedID, sortOrder: $sortOrder) {
            TableColumn("Numer oferty", value: \OfferListItem.number) { item in
                Text(item.numberText).fontWeight(.medium).lineLimit(1)
            }.width(min: 110, ideal: 140)
            TableColumn("Klient", value: \OfferListItem.client) { item in
                Text(item.client).lineLimit(1).help(item.client)
            }.width(min: 140, ideal: 220)
            TableColumn("Event", value: \OfferListItem.sortTitle) { item in
                Text(item.titleText).lineLimit(1).help(item.titleText)
            }.width(min: 140, ideal: 240)
            TableColumn("Kwota", value: \OfferListItem.gross) { item in
                VStack(alignment: .trailing, spacing: 1) {
                    Text(OfferText.money(item.gross)).monospacedDigit()
                    Text("netto: \(OfferText.money(item.net))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 120, ideal: 150)
            TableColumn("Status", value: \OfferListItem.status) { item in
                OfferStatusBadge(status: item.status)
            }.width(min: 100, ideal: 120)
            TableColumn("Ważna do", value: \OfferListItem.sortValid) { item in
                Text(item.validText).monospacedDigit().foregroundStyle(item.validUntil == nil ? .secondary : .primary)
            }.width(min: 80, ideal: 100)
            TableColumn("Utworzona", value: \OfferListItem.sortCreated) { item in
                Text(item.createdAt.flatMap(OfferText.day) ?? "-").monospacedDigit().foregroundStyle(.secondary)
            }.width(min: 80, ideal: 100)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let item = store.offer(id) { menu(item) }
        } primaryAction: { ids in
            guard let id = ids.first, store.offer(id) != nil else { return }
            store.openedID = id
        }
    }

    private var listView: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(rows) { item in
                    OfferListRow(item: item, selected: store.selectedID == item.id)
                        .onTapGesture(count: 2) { store.selectedID = item.id; store.openedID = item.id }
                        .onTapGesture { store.selectedID = item.id }
                        .contextMenu { menu(item) }
                }
            }
            .padding(16)
        }
    }

    private var grid: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260, maximum: 380), spacing: 14)], spacing: 14) {
                ForEach(rows) { item in
                    OfferGridCard(item: item, selected: store.selectedID == item.id)
                        .onTapGesture(count: 2) { store.selectedID = item.id; store.openedID = item.id }
                        .onTapGesture { store.selectedID = item.id }
                        .contextMenu { menu(item) }
                }
            }
            .padding(16)
        }
    }

    @ViewBuilder private func menu(_ item: OfferListItem) -> some View {
        Button("Zobacz szczegóły", systemImage: "eye") { store.openedID = item.id }
        if let event = item.eventId {
            Button("Otwórz wydarzenie", systemImage: "calendar") { state.showEvent(event) }
        } else if let inquiry = item.inquiryId {
            Button("Otwórz zapytanie", systemImage: "tray") { state.showInquiry(inquiry) }
        }
        Button("Otwórz w CRM", systemImage: "safari") { state.openCRM("/crm/offers/\(item.id)") }
        if !item.seller {
            Divider()
            Button("Usuń ofertę…", systemImage: "trash", role: .destructive) { deleting = item }
                .disabled(!state.canWrite)
        }
    }
}

// MARK: Elementy listy

struct OfferStatusBadge: View {
    let status: String
    var page = false
    var body: some View {
        let color = OfferText.color(status, page: page)
        Text(OfferText.status(status))
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.15), in: Capsule())
            .overlay(Capsule().stroke(color.opacity(0.3)))
            .foregroundStyle(color)
    }
}

@MainActor private struct OfferListRow: View {
    let item: OfferListItem
    let selected: Bool
    @Environment(\.crmTheme) private var theme
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text").font(.title3).foregroundStyle(theme.accent)
                .frame(width: 40, height: 40).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(item.numberText).font(.headline).lineLimit(1)
                    OfferStatusBadge(status: item.status)
                }
                HStack(spacing: 14) {
                    if item.title != nil { Label(item.titleText, systemImage: "calendar").lineLimit(1) }
                    Label(item.client, systemImage: "building.2").lineLimit(1)
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .trailing, spacing: 2) {
                Text(OfferText.money(item.gross)).font(.callout.weight(.semibold)).monospacedDigit()
                Text("netto: \(OfferText.money(item.net))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
                if let valid = item.validUntil.flatMap(OfferText.day) {
                    Text("Ważna do: \(valid)").font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .padding(10)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? theme.accent : Color.primary.opacity(0.08), lineWidth: selected ? 2 : 1))
        .contentShape(Rectangle())
    }
}

@MainActor private struct OfferGridCard: View {
    let item: OfferListItem
    let selected: Bool
    @Environment(\.crmTheme) private var theme
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                Image(systemName: "doc.text").font(.title3).foregroundStyle(theme.accent)
                    .frame(width: 36, height: 36).background(theme.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
                Spacer()
                OfferStatusBadge(status: item.status)
            }
            Text(item.numberText).font(.headline).lineLimit(1)
            VStack(alignment: .leading, spacing: 4) {
                if item.title != nil { Label(item.titleText, systemImage: "calendar").lineLimit(1) }
                Label(item.client, systemImage: "building.2").lineLimit(1)
                if let valid = item.validUntil.flatMap(OfferText.day) { Label("Ważna do: \(valid)", systemImage: "clock").lineLimit(1) }
            }
            .font(.caption).foregroundStyle(.secondary)
            Divider()
            HStack(alignment: .firstTextBaseline) {
                Text(OfferText.money(item.gross)).font(.title3.weight(.semibold)).monospacedDigit()
                Spacer()
                Text("netto: \(OfferText.money(item.net))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .padding(12)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(selected ? theme.accent : Color.primary.opacity(0.08), lineWidth: selected ? 2 : 1))
        .contentShape(Rectangle())
    }
}

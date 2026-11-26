import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Karta wypożyczenia — 1:1 z `/crm/rental/[id]`. Sprzedaż: dane, pozycje z cenami, rezerwacja, anulowanie, rozliczenie
// (naliczenia, kaucja, faktury). Magazyn: pozycje bez cen, protokoły wydania i odbioru (PDF do podpisu drukowany na Macu, skan),
// rozbieżności, uwagi magazynu, dostawa i odbiór. Co kto widzi i robi — `rental_access` w bazie (`access`).

private enum ClientRentalSheet: Identifiable {
    case form, items, trips, issue, returnGoods, resolve(ClientRentalItem), reason(ClientRentalStatus)
    var id: String {
        switch self {
        case .form: return "form"
        case .items: return "items"
        case .trips: return "trips"
        case .issue: return "issue"
        case .returnGoods: return "return"
        case .resolve(let item): return "resolve-\(item.id)"
        case .reason(let status): return "reason-\(status.rawValue)"
        }
    }
}

private struct ClientRentalConfirm: Identifiable {
    let status: ClientRentalStatus
    let title: String
    let message: String
    var id: String { status.rawValue }
}

@MainActor struct ClientRentalDetailView: View {
    @ObservedObject var store: ClientRentalsStore
    let rentalID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var sheet: ClientRentalSheet?
    @State private var confirm: ClientRentalConfirm?
    @State private var warehouseNote = ""
    @State private var printProtocol: String?
    @State private var uploadTarget: (area: String, kind: String, protocolID: String?)?
    @State private var importing = false
    @State private var uploading = false
    @State private var removingFile: ClientRentalFile?
    /// Okno pozycji otwierane na katalogu (zaraz po utworzeniu wypożyczenia).
    @State private var itemsCatalog = false

    private var rental: ClientRentalDetail? { store.details[rentalID] }

    var body: some View {
        Group {
            if let rental {
                content(rental)
            } else if let error = store.detailErrors[rentalID] {
                ContentUnavailableView {
                    Label("Wypożyczenie", systemImage: "shippingbox.and.arrow.backward")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(rentalID) } }
                    Button("Wróć do listy") { store.openedID = nil }
                }
            } else {
                ProgressView("Wczytywanie wypożyczenia…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: rentalID) {
            await store.loadDetail(rentalID)
            warehouseNote = rental?.warehouseNote ?? ""
            if store.openItemsFor == rentalID {
                store.openItemsFor = nil
                if let rental, rental.access.salesManage, [.draft, .reserved, .issued].contains(rental.status) {
                    itemsCatalog = true
                    sheet = .items
                }
            }
        }
        .onChange(of: rental?.warehouseNote) { _, value in warehouseNote = value ?? "" }
        .sheet(item: $sheet) { item in sheetView(item).environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent) }
        .confirmationDialog(confirm?.title ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if let confirm {
                Button(confirm.title) { Task { await store.run(["op": .string("status"), "id": .string(rentalID), "status": .string(confirm.status.rawValue)], success: "Zmieniono status wypożyczenia") } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text(confirm?.message ?? "") }
        .confirmationDialog("Usunąć plik?", isPresented: Binding(get: { removingFile != nil }, set: { if !$0 { removingFile = nil } }), titleVisibility: .visible) {
            if let file = removingFile {
                Button("Usuń", role: .destructive) { Task { await store.run(["op": .string("removeFile"), "id": .string(rentalID), "fileId": .string(file.id)], success: "Usunięto plik", refreshList: false) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Plik „\(removingFile?.fileName ?? "")” zostanie trwale usunięty.") }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.pdf, .image], allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result, let target = uploadTarget else { return }
            Task { await upload(urls, target: target) }
        }
    }

    @ViewBuilder private func sheetView(_ item: ClientRentalSheet) -> some View {
        if let rental {
            switch item {
            case .form: ClientRentalFormSheet(store: store, rental: rental) { _ in sheet = nil; Task { await store.loadDetail(rentalID) } }
            case .items: ClientRentalItemsSheet(store: store, rental: rental, startInCatalog: itemsCatalog)
            case .trips: ClientRentalTripsSheet(store: store, rental: rental)
            case .issue: ClientRentalProtocolSheet(store: store, rental: rental, issue: true) { protocolID in printProtocol = protocolID }
            case .returnGoods: ClientRentalProtocolSheet(store: store, rental: rental, issue: false) { protocolID in printProtocol = protocolID }
            case .resolve(let line): ClientRentalResolveSheet(store: store, rental: rental, item: line)
            case .reason(let status): ClientRentalReasonSheet(store: store, rentalID: rental.id, status: status)
            }
        }
    }

    private func upload(_ urls: [URL], target: (area: String, kind: String, protocolID: String?)) async {
        uploading = true
        defer { uploading = false }
        do {
            for url in urls { _ = try await store.upload(url, rentalID: rentalID, area: target.area, kind: target.kind, protocolID: target.protocolID) }
            state.notice = urls.count == 1 ? "Dodano plik" : "Dodano pliki (\(urls.count))"
        } catch {
            state.error = store.failureText(error, "Nie udało się przesłać pliku.")
        }
    }

    private func content(_ rental: ClientRentalDetail) -> some View {
        let access = rental.access
        let sales = access.salesManage
        let warehouse = access.warehouseAct
        let canIssue = warehouse && [.reserved, .issued].contains(rental.status) && rental.equipment.contains { $0.issuedQty < $0.quantity }
        let canReturn = warehouse && rental.status == .issued && rental.equipment.contains { $0.outQty > 0 }
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(rental)
                if let protocolID = printProtocol, let saved = rental.protocols.first(where: { $0.id == protocolID }) {
                    HStack {
                        Label("Protokół \(saved.number) zapisany. Wydrukuj go do podpisu, a skan podpisanego dodaj przy protokole.", systemImage: "checkmark.seal")
                        Spacer()
                        Button("PDF do podpisu") { printProtocol = nil; Task { await store.printProtocol(rentalID: rental.id, protocolID: saved.id, number: saved.number) } }
                            .buttonStyle(.borderedProminent)
                        Button("Zamknij") { printProtocol = nil }
                    }
                    .padding(12).background(Color.green.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                }
                if rental.status == .cancelled, let reason = rental.cancelReason, !reason.isEmpty {
                    Text("Powód anulowania: \(reason)").foregroundStyle(CrmTheme.rgb(0xfca5a5))
                }
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 16) {
                        itemsSection(rental)
                        if !rental.issues.isEmpty { issuesSection(rental) }
                        protocolsSection(rental)
                        if rental.sales != nil { ClientRentalSettlementSection(store: store, rental: rental) }
                    }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    VStack(alignment: .leading, spacing: 16) {
                        clientSection(rental)
                        if rental.handover == "delivery" || !rental.trips.isEmpty { tripsSection(rental) }
                        warehouseNoteSection(rental)
                        filesSection(rental)
                        historySection(rental)
                    }
                    .frame(width: 340)
                }
            }
            .padding(18)
        }
        .navigationTitle(rental.number)
        .navigationSubtitle(rental.clientName)
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Button { store.openedID = nil } label: { Label("Wypożyczenia", systemImage: "chevron.left") }.help("Wróć do listy")
            }
            ToolbarItemGroup(placement: .primaryAction) {
                if store.busy || uploading { ProgressView().controlSize(.small) }
                Button { Task { await store.loadDetail(rentalID) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                Button { state.openCRM("/crm/rental/\(rental.id)") } label: { Label("Otwórz w CRM", systemImage: "safari") }
                if canIssue {
                    Button { sheet = .issue } label: { Label(rental.status == .issued ? "Dowydanie" : "Protokół wydania", systemImage: "list.clipboard") }
                }
                if canReturn {
                    Button { sheet = .returnGoods } label: { Label("Protokół odbioru", systemImage: "checklist.checked") }
                }
                if sales {
                    Menu {
                        if rental.status == .draft {
                            Button("Zarezerwuj sprzęt…") { confirm = ClientRentalConfirm(status: .reserved, title: "Zarezerwuj", message: "Pozycje zajmą stan magazynu w terminie wypożyczenia, a magazyn dostanie powiadomienie.") }
                        }
                        if rental.status == .reserved {
                            Button("Cofnij rezerwację…") { confirm = ClientRentalConfirm(status: .draft, title: "Cofnij rezerwację", message: "Sprzęt wróci do dostępnych, a magazyn dostanie powiadomienie.") }
                        }
                        if rental.status == .returned {
                            Button("Rozlicz…") { confirm = ClientRentalConfirm(status: .settled, title: "Rozlicz", message: "Zmiany danych i naliczeń zostaną zablokowane.") }
                        }
                        if [.draft, .reserved, .issued, .returned].contains(rental.status) {
                            Button("Edytuj dane…") { sheet = .form }
                        }
                        if [.draft, .reserved].contains(rental.status) {
                            Divider()
                            Button("Anuluj wypożyczenie…", role: .destructive) {
                                if rental.status == .reserved { sheet = .reason(.cancelled) }
                                else { confirm = ClientRentalConfirm(status: .cancelled, title: "Anuluj wypożyczenie", message: "Szkic zostanie anulowany.") }
                            }
                        }
                    } label: { Label("Sprzedaż", systemImage: "briefcase") }
                }
                if access.admin && rental.status == .settled {
                    Button { confirm = ClientRentalConfirm(status: .returned, title: "Cofnij rozliczenie", message: "Wypożyczenie wróci do statusu „Zwrócone”.") } label: { Label("Cofnij rozliczenie", systemImage: "arrow.uturn.backward") }
                }
            }
        }
    }

    private func header(_ rental: ClientRentalDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(rental.number).font(.title2.weight(.light)).textCase(.uppercase)
                ClientRentalStatusBadge(status: rental.status)
                if rental.overdue { Label("Po terminie zwrotu", systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5)) }
                if !rental.issues.isEmpty { Label("Rozbieżności do rozstrzygnięcia", systemImage: "wrench.and.screwdriver").font(.caption).foregroundStyle(.orange) }
            }
            if !rental.title.isEmpty { Text(rental.title).font(.title3) }
            Text("\(rental.clientName) · wydanie \(ClientRentalFormat.dateTime(rental.startsAt)) · zwrot \(ClientRentalFormat.dateTime(rental.endsAt))")
                .foregroundStyle(.secondary).textSelection(.enabled)
        }
    }

    private func section<Content: View, Actions: View>(_ title: String, @ViewBuilder actions: () -> Actions, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.headline.weight(.regular)).textCase(.uppercase)
                Spacer()
                actions()
            }
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
    }

    private func itemsSection(_ rental: ClientRentalDetail) -> some View {
        let editable = rental.access.salesManage && [.draft, .reserved, .issued].contains(rental.status)
        let prices = rental.access.salesView
        return section("Pozycje", actions: {
            if editable { Button { itemsCatalog = false; sheet = .items } label: { Label("Edytuj pozycje", systemImage: "pencil") }.controlSize(.small) }
        }) {
            if rental.items.isEmpty {
                Text(editable ? "Wybierz sprzęt z katalogu magazynu — „Edytuj pozycje”." : "Brak pozycji.").foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(rental.items.filter(\.isEquipment) + rental.items.filter { !$0.isEquipment }) { item in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.name)
                                let meta = itemMeta(item)
                                if !meta.isEmpty { Text(meta).font(.caption).foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(item.quantity) \(item.unit)").monospacedDigit().frame(width: 80, alignment: .trailing)
                            Group {
                                if item.isEquipment {
                                    Text(progress(item)).font(.caption).foregroundStyle(.secondary)
                                } else { Text("—").foregroundStyle(.secondary) }
                            }
                            .frame(width: 200, alignment: .leading)
                            if prices {
                                VStack(alignment: .trailing, spacing: 1) {
                                    Text(ClientRentalFormat.money(item.lineNet)).monospacedDigit()
                                    Text(priceText(item, defaultDays: rental.defaultDays))
                                        .font(.caption2).foregroundStyle(.secondary)
                                }
                                .frame(width: 150, alignment: .trailing)
                            }
                        }
                        .padding(.vertical, 6)
                        Divider().opacity(0.4)
                    }
                }
            }
        }
    }

    private func summary(_ line: ClientRentalProtocolLine, issue: Bool) -> String {
        if issue { return "\(line.qty) \(line.unit)" }
        var parts: [String] = []
        if line.qty > 0 { parts.append("sprawne \(line.qty)") }
        if line.damaged > 0 { parts.append("uszkodzone \(line.damaged)") }
        if line.missing > 0 { parts.append("brak \(line.missing)") }
        return parts.joined(separator: ", ")
    }

    private func priceText(_ item: ClientRentalItem, defaultDays: Double) -> String {
        var text = ClientRentalFormat.money(item.unitPrice)
        text += item.priceMode == "flat" ? " ryczałt" : " × \(ClientRentalFormat.plain(item.days ?? defaultDays)) dob."
        if let discount = item.discountPercent, discount > 0 { text += " −\(ClientRentalFormat.plain(discount))%" }
        return text
    }

    private func itemMeta(_ item: ClientRentalItem) -> String {
        var parts: [String] = []
        if item.isEquipment { if let location = item.storageLocation, !location.isEmpty { parts.append("Magazyn: \(location)") } } else { parts.append("Usługa") }
        if let kit = item.kitName, !kit.isEmpty { parts.append("z zestawu \(kit)") }
        if let note = item.note, !note.isEmpty { parts.append(note) }
        return parts.joined(separator: " · ")
    }

    private func progress(_ item: ClientRentalItem) -> String {
        var parts = ["wydano \(item.issuedQty)"]
        if item.issuedQty > 0 { parts.append("u klienta \(item.outQty)") }
        if item.returnedOkQty > 0 { parts.append("sprawne \(item.returnedOkQty)") }
        if item.returnedDamagedQty > 0 { parts.append("uszk. \(item.returnedDamagedQty)") }
        if item.returnedMissingQty > 0 { parts.append("brak \(item.returnedMissingQty)") }
        return parts.joined(separator: " · ")
    }

    private func issuesSection(_ rental: ClientRentalDetail) -> some View {
        section("Rozbieżności po zwrocie", actions: { EmptyView() }) {
            Text("Do rozstrzygnięcia te sztuki zajmują stan magazynu (eventy i wypożyczenia ich nie dostaną).").font(.caption).foregroundStyle(.secondary)
            ForEach(rental.issues) { item in
                HStack {
                    Text(item.name)
                    Text([item.openDamaged > 0 ? "uszkodzone \(item.openDamaged)" : nil, item.openMissing > 0 ? "brak \(item.openMissing)" : nil].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if rental.access.warehouseAct {
                        Button { sheet = .resolve(item) } label: { Label("Rozstrzygnij", systemImage: "wrench.and.screwdriver") }.controlSize(.small)
                    }
                }
                .padding(8).background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func protocolsSection(_ rental: ClientRentalDetail) -> some View {
        let canFiles = rental.access.salesManage || rental.access.warehouseAct
        return section("Wydanie i zwrot", actions: { EmptyView() }) {
            if rental.protocols.isEmpty {
                Text(rental.status == .draft ? "Po rezerwacji magazyn wyda sprzęt z protokołem wydania." : "Brak protokołów.").foregroundStyle(.secondary)
            }
            ForEach(rental.protocols) { item in
                let scans = rental.files.filter { $0.protocolId == item.id }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(item.isIssue ? "Wydanie" : "Odbiór") · \(item.number)").font(.callout.weight(.medium))
                            Text("\(ClientRentalFormat.dateTime(item.createdAt)) · \(item.isIssue ? "odebrał(a)" : "zwrócił(a)") \(item.personName)\(item.createdByName.map { " · magazyn: \($0)" } ?? "")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button { Task { await store.printProtocol(rentalID: rental.id, protocolID: item.id, number: item.number) } } label: { Label("PDF do podpisu", systemImage: "printer") }
                            .controlSize(.small)
                        if canFiles {
                            Button { uploadTarget = ("warehouse", "scan", item.id); importing = true } label: { Label("Dodaj skan", systemImage: "square.and.arrow.up") }
                                .controlSize(.small).disabled(uploading)
                        }
                    }
                    ForEach(item.lines, id: \.itemId) { line in
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text("\(line.name): \(summary(line, issue: item.isIssue))")
                            if let note = line.note, !note.isEmpty { Text("— \(note)").foregroundStyle(.secondary) }
                            ForEach(Array(line.photos.enumerated()), id: \.offset) { index, path in
                                Button("zdjęcie \(index + 1)") { Task { await store.openFile(path) } }.buttonStyle(.link).linkCursor()
                            }
                        }
                        .font(.caption)
                    }
                    if let note = item.note, !note.isEmpty { Text("Uwagi: \(note)").font(.caption).foregroundStyle(.secondary) }
                    if scans.isEmpty {
                        Text("Brak skanu podpisanego protokołu.").font(.caption).foregroundStyle(.orange)
                    } else {
                        HStack {
                            ForEach(scans) { file in
                                HStack(spacing: 4) {
                                    Button { Task { await store.openFile(file.storagePath) } } label: { Label(file.fileName, systemImage: "doc") }.buttonStyle(.link).linkCursor()
                                    if canFiles { Button { removingFile = file } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń skan") }
                                }
                                .font(.caption)
                            }
                        }
                    }
                }
                .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private func clientSection(_ rental: ClientRentalDetail) -> some View {
        section("Klient i termin", actions: { EmptyView() }) {
            VStack(alignment: .leading, spacing: 8) {
                labeled("Klient", rental.clientName)
                if rental.recipientName != nil || rental.recipientPhone != nil {
                    labeled("Odbierający", [rental.recipientName, rental.recipientPhone].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                }
                labeled("Wydanie", ClientRentalFormat.dateTime(rental.startsAt))
                labeled("Planowany zwrot", ClientRentalFormat.dateTime(rental.endsAt), color: rental.overdue ? CrmTheme.rgb(0xfca5a5) : nil)
                labeled("Przekazanie", rental.handover == "delivery" ? "Dostawa\(rental.deliveryAddress.map { " — \($0)" } ?? "")" : "Odbiór własny")
                labeled("Opiekun", rental.sellerName ?? "—")
                if let company = rental.myCompanyName { labeled("Firma", company) }
                if let note = rental.sales?.salesNote, !note.isEmpty { labeled("Uwagi sprzedaży", note) }
            }
        }
    }

    private func labeled(_ label: String, _ value: String, color: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).foregroundStyle(color ?? .primary).textSelection(.enabled)
        }
    }

    private func tripsSection(_ rental: ClientRentalDetail) -> some View {
        let editable = (rental.access.salesManage || rental.access.warehouseAct) && [.draft, .reserved, .issued].contains(rental.status)
        return section("Dostawa i odbiór", actions: {
            if editable { Button { sheet = .trips } label: { Label("Zaplanuj", systemImage: "truck.box") }.controlSize(.small) }
        }) {
            if rental.trips.isEmpty { Text("Nie zaplanowano pojazdu i kierowcy.").foregroundStyle(.secondary) }
            ForEach(rental.trips) { trip in
                VStack(alignment: .leading, spacing: 2) {
                    Text(trip.label)
                    Text("\(ClientRentalFormat.dateTime(trip.startsAt)) – \(ClientRentalFormat.dateTime(trip.endsAt)) · \(trip.vehicleName ?? "bez pojazdu z floty")\(trip.driverName.map { " · \($0)" } ?? "")")
                        .font(.caption).foregroundStyle(.secondary)
                    if let note = trip.note, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private func warehouseNoteSection(_ rental: ClientRentalDetail) -> some View {
        let editable = rental.access.warehouseAct || rental.access.salesManage
        return section("Uwagi magazynu", actions: { EmptyView() }) {
            if editable {
                TextEditor(text: $warehouseNote).frame(minHeight: 60).font(.body)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.primary.opacity(0.15)))
                if warehouseNote != (rental.warehouseNote ?? "") {
                    Button("Zapisz uwagi") {
                        Task { await store.run(["op": .string("warehouseNote"), "id": .string(rental.id), "note": .string(warehouseNote)], success: "Zapisano uwagi magazynu", refreshList: false) }
                    }
                    .controlSize(.small)
                }
            } else {
                Text(rental.warehouseNote?.nonEmpty ?? "Brak uwag.").foregroundStyle(.secondary)
            }
        }
    }

    private func filesSection(_ rental: ClientRentalDetail) -> some View {
        let canFiles = rental.access.salesManage || rental.access.warehouseAct
        let general = rental.files.filter { $0.protocolId == nil }
        return section("Pliki", actions: {
            if canFiles {
                Button {
                    let salesOnly = rental.access.salesManage && !rental.access.warehouseAct
                    uploadTarget = (salesOnly ? "sales" : "warehouse", salesOnly ? "document" : "photo", nil)
                    importing = true
                } label: { Label("Dodaj", systemImage: "paperclip") }.controlSize(.small).disabled(uploading)
            }
        }) {
            if general.isEmpty { Text("Brak plików. Skany protokołów dodajesz przy protokole.").font(.caption).foregroundStyle(.secondary) }
            ForEach(general) { file in
                HStack {
                    Button { Task { await store.openFile(file.storagePath) } } label: { Text(file.fileName).lineLimit(1) }.buttonStyle(.link).linkCursor()
                    Spacer()
                    Text(file.area == "sales" ? "sprzedaż" : "magazyn").font(.caption2).foregroundStyle(.secondary)
                    if canFiles { Button { removingFile = file } label: { Image(systemName: "trash") }.buttonStyle(.borderless).help("Usuń plik") }
                }
            }
        }
    }

    private func historySection(_ rental: ClientRentalDetail) -> some View {
        section("Historia", actions: { EmptyView() }) {
            ForEach(Array(rental.log.prefix(60).enumerated()), id: \.offset) { _, entry in
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.label).font(.callout)
                    Text("\(ClientRentalFormat.dateTime(entry.createdAt))\(entry.actorName.map { " · \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
                    if let note = entry.note, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }
}

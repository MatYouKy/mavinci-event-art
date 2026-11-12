import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: Podwykonawcy wydarzenia (1:1 z `EventSubcontractorsPanel` i `AddTaskModal`): podsumowanie, wynajem bez podwykonawcy,
// zlecenia i umowy pogrupowane według podwykonawców, szczegóły i wytyczne, wysyłka wytycznych, podgląd umowy oraz formularz
// zlecenia (z bazy albo nowy podwykonawca, usługi z katalogu, generator wytycznych AI, umowa od podwykonawcy).

struct SubcontractorsTabData: Decodable {
    struct Person: Decodable, Hashable { var id: String; var name: String; var contactPerson: String?; var email: String?; var phone: String?; var rating: Double?; var hourlyRate: Double }
    struct Equipment: Decodable, Hashable { var name: String?; var quantity: Double; var thumbnail: String? }
    struct Order: Decodable, Identifiable, Hashable {
        var id: String; var subcontractorId: String?; var subcontractor: Person?
        var taskName: String; var description: String?; var taskType: String
        var startDate: String?; var endDate: String?; var scheduledStart: String?; var scheduledEnd: String?
        var estimatedHours: Double; var actualHours: Double; var hourlyRate: Double; var fixedPrice: Double
        var paymentType: String; var totalCost: Double; var agreedCost: Double; var currency: String
        var status: String; var paymentStatus: String; var settlementType: String; var paymentMethod: String; var serviceCatalogId: String?
        var scopeOfWork: String?; var deliverables: String?; var guidelines: String?; var operationalNotes: String?
        var contactEmail: String?; var guidelinesStatus: String; var confirmedAt: String?; var confirmedByName: String?; var responseNote: String?
        var equipment: Equipment?
        var cost: Double { agreedCost != 0 ? agreedCost : totalCost }
    }
    struct Contract: Decodable, Identifiable, Hashable {
        var id: String; var subcontractorId: String?; var subcontractor: Person?; var number: String; var title: String; var totalValue: Double; var status: String; var hasFile: Bool
    }
    var tasks: [Order]
    var contracts: [Contract]
}

enum SubcontractorLabels {
    static func status(_ value: String) -> String {
        let labels = [
            "planned": "Zaplanowane", "in_progress": "W trakcie", "completed": "Zakończone", "cancelled": "Anulowane", "pending": "Oczekuje",
            "paid": "Zapłacone", "overdue": "Opóźnione", "draft": "Szkic", "active": "Aktywna", "terminated": "Rozwiązana",
            "sent": "Wysłano do potwierdzenia", "confirmed": "Potwierdzone", "declined": "Odrzucone", "expired": "Wygasło",
        ]
        return labels[value] ?? value.replacingOccurrences(of: "_", with: " ").capitalized
    }
    static func color(_ value: String) -> Color {
        switch value {
        case "planned", "sent": return CrmTheme.rgb(0x60a5fa)
        case "in_progress", "pending": return CrmTheme.rgb(0xfacc15)
        case "completed", "paid", "active", "confirmed": return CrmTheme.rgb(0x4ade80)
        case "cancelled", "overdue", "terminated", "declined": return CrmTheme.rgb(0xf87171)
        case "expired": return CrmTheme.rgb(0xfb923c)
        default: return CrmTheme.rgb(0x9ca3af)
        }
    }
    static func settlement(_ value: String) -> String {
        switch value {
        case "cash": return "Gotówka"
        case "civil_contract": return "Umowa cywilna"
        case "invoice_no_vat": return "Faktura bez VAT"
        case "invoice_vat": return "Faktura VAT"
        default: return "Inne"
        }
    }
    static func paymentType(_ value: String) -> String { value == "fixed" ? "Ryczałt" : value == "hourly" ? "Godzinowe" : "Mieszane" }
    static func amount(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
    /// „dd.MM.rrrr, gg:mm” dla terminu z godziną, „dd.MM.rrrr” dla samej daty.
    static func when(_ value: String?, time: Bool) -> String? {
        guard let value, !value.isEmpty else { return nil }
        if time, let date = MeetingDates.parse(value) { return MeetingDates.format(date, "dd.MM.yyyy, HH:mm") }
        let parts = value.prefix(10).split(separator: "-")
        guard parts.count == 3 else { return value }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
}

@MainActor struct EventSubcontractorsTab: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var editor: SubcontractorEditRequest?
    @State private var sending: String?
    @State private var preview: URL?
    @State private var selectedOrder: String?
    @State private var selectedContract: String?
    @AppStorage("eventSubcontractors.mode") private var mode = "orders"

    private var data: SubcontractorsTabData? { store.tab(eventID, "subcontractors", as: SubcontractorsTabData.self) }

    var body: some View {
        Group {
            if let data { content(data) }
            else if let error = store.tabErrors["\(eventID)|subcontractors"] {
                ContentUnavailableView {
                    Label("Błąd podczas ładowania danych podwykonawców", systemImage: "person.badge.shield.checkmark")
                } description: { Text(error) } actions: { Button("Spróbuj ponownie") { Task { await store.loadTab(eventID, "subcontractors") } } }
            } else {
                ProgressView("Ładowanie…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .task(id: eventID) { await store.loadTab(eventID, "subcontractors") }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in Task { await store.loadTab(eventID, "subcontractors") } }
        .sheet(item: $editor) { request in
            SubcontractorTaskSheet(store: store, eventID: eventID, request: request)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .quickLookPreview($preview)
    }

    // MARK: Lista (natywne tabele: zlecenia ze szczegółami pod spodem, umowy)

    private static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        if count == 1 { return one }
        let digit = count % 10
        let tens = count % 100
        return (2...4).contains(digit) && !(12...14).contains(tens) ? few : many
    }

    /// Zlecenia bez podwykonawcy (np. wynajem do obsadzenia) na początku, potem pogrupowane według podwykonawców.
    private func orderRows(_ data: SubcontractorsTabData) -> [SubcontractorsTabData.Order] {
        let loose = data.tasks.filter { $0.subcontractorId == nil }
        return loose + orderedSubcontractors(data).flatMap { id in data.tasks.filter { $0.subcontractorId == id } }
    }

    private func contractRows(_ data: SubcontractorsTabData) -> [SubcontractorsTabData.Contract] {
        let loose = data.contracts.filter { $0.subcontractorId == nil }
        return orderedSubcontractors(data).flatMap { id in data.contracts.filter { $0.subcontractorId == id } } + loose
    }

    @ViewBuilder private func content(_ data: SubcontractorsTabData) -> some View {
        let people = orderedSubcontractors(data).count
        let orders = orderRows(data)
        let contracts = contractRows(data)
        let rentals = data.tasks.filter { $0.taskType == "equipment_rental" && $0.subcontractorId == nil }.count
        let total = data.tasks.reduce(0.0) { $0 + $1.cost }
        let summary: String = "\(people) " + Self.plural(people, "podwykonawca", "podwykonawców", "podwykonawców")
            + " · koszt zleceń " + SubcontractorLabels.amount(total) + " zł"
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Podwykonawcy").font(.title2.weight(.semibold))
                Text(summary).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                Picker("Widok", selection: $mode) {
                    Text("Zlecenia (\(orders.count))").tag("orders")
                    Text("Umowy (\(contracts.count))").tag("contracts")
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                Button { editor = SubcontractorEditRequest(order: nil) } label: { Label("Dodaj zlecenie", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
            .padding(.horizontal, 18).padding(.top, 12)
            if rentals > 0 {
                Label("\(rentals) " + Self.plural(rentals, "pozycja", "pozycje", "pozycji")
                      + " sprzętu do wynajęcia bez podwykonawcy — wybierz podwykonawcę w zleceniu, aby dodać szczegóły wynajmu",
                      systemImage: "exclamationmark.circle.fill")
                    .font(.callout).foregroundStyle(CrmTheme.rgb(0xfb923c)).padding(.horizontal, 18)
            }
            if mode == "contracts" {
                if contracts.isEmpty {
                    ContentUnavailableView("Brak umów", systemImage: "doc.text", description: Text("Do tego wydarzenia nie dodano umów od podwykonawców."))
                } else {
                    contractsTable(contracts)
                }
            } else if orders.isEmpty {
                ContentUnavailableView {
                    Label("Brak zleceń", systemImage: "person.badge.shield.checkmark")
                } description: { Text("Brak przypisanych podwykonawców do tego wydarzenia") } actions: {
                    Button("Dodaj pierwsze zadanie") { editor = SubcontractorEditRequest(order: nil) }
                }
            } else {
                VSplitView {
                    ordersTable(orders).frame(minHeight: 150, idealHeight: 340)
                    orderDetail(orders).frame(minHeight: 120, idealHeight: 260, maxHeight: .infinity)
                }
            }
        }
    }

    private func ordersTable(_ orders: [SubcontractorsTabData.Order]) -> some View {
        let lp = Dictionary(orders.enumerated().map { ($0.element.id, $0.offset + 1) }, uniquingKeysWith: { first, _ in first })
        return Table(orders, selection: $selectedOrder) {
            TableColumn("") { (task: SubcontractorsTabData.Order) in orderThumb(task, size: 26) }.width(34)
            TableColumn("Lp.") { (task: SubcontractorsTabData.Order) in
                Text("\(lp[task.id] ?? 0)").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(36)
            TableColumn("Podwykonawca") { (task: SubcontractorsTabData.Order) in
                if let person = task.subcontractor {
                    Text(person.name).fontWeight(.medium).lineLimit(1).help(person.contactPerson ?? person.name)
                } else {
                    Label("Bez podwykonawcy", systemImage: "exclamationmark.circle.fill").foregroundStyle(CrmTheme.rgb(0xfb923c)).lineLimit(1)
                }
            }.width(min: 130, ideal: 200)
            TableColumn("Zlecenie") { (task: SubcontractorsTabData.Order) in
                HStack(spacing: 6) {
                    Text(task.taskName).lineLimit(1)
                    if task.taskType == "equipment_rental" { Text("Wynajem").font(.caption).foregroundStyle(CrmTheme.rgb(0xfb923c)) }
                }
                .help(task.taskName)
            }.width(min: 140, ideal: 260)
            TableColumn("Termin") { (task: SubcontractorsTabData.Order) in
                Text(SubcontractorLabels.when(task.scheduledStart ?? task.startDate, time: task.scheduledStart != nil) ?? "—")
                    .monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            }.width(min: 80, ideal: 130)
            TableColumn("Koszt") { (task: SubcontractorsTabData.Order) in
                Text(SubcontractorLabels.amount(task.cost) + " " + task.currency).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 80, ideal: 110)
            TableColumn("Status") { (task: SubcontractorsTabData.Order) in
                EventDotLabel(label: SubcontractorLabels.status(task.status), color: SubcontractorLabels.color(task.status))
            }.width(min: 90, ideal: 120)
            TableColumn("Wytyczne") { (task: SubcontractorsTabData.Order) in
                EventDotLabel(label: SubcontractorLabels.status(task.guidelinesStatus), color: SubcontractorLabels.color(task.guidelinesStatus))
            }.width(min: 90, ideal: 170)
            TableColumn("Płatność") { (task: SubcontractorsTabData.Order) in
                EventDotLabel(label: SubcontractorLabels.status(task.paymentStatus), color: SubcontractorLabels.color(task.paymentStatus))
            }.width(min: 80, ideal: 110)
            TableColumn("") { (task: SubcontractorsTabData.Order) in
                Menu { orderMenu(task) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Czynności")
            }.width(30)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let task = orders.first(where: { $0.id == id }) { orderMenu(task) }
        } primaryAction: { ids in
            if let id = ids.first, let task = orders.first(where: { $0.id == id }) { editor = SubcontractorEditRequest(order: task) }
        }
    }

    @ViewBuilder private func orderThumb(_ task: SubcontractorsTabData.Order, size: CGFloat) -> some View {
        if let thumb = task.equipment?.thumbnail {
            WarehouseThumb(url: thumb, size: size)
        } else if task.taskType == "equipment_rental" {
            WarehouseThumb(url: nil, size: size)
        } else if let person = task.subcontractor {
            EmployeeAvatarView(name: person.name, url: nil, crop: nil, size: size)
        } else {
            Image(systemName: "person.crop.circle.badge.questionmark").font(.system(size: size * 0.7)).foregroundStyle(.secondary).frame(width: size, height: size)
        }
    }

    @ViewBuilder private func orderMenu(_ task: SubcontractorsTabData.Order) -> some View {
        let sendTitle: String = task.guidelinesStatus == "sent" ? "Wyślij wytyczne ponownie" : "Wyślij wytyczne"
        Button("Edytuj zlecenie", systemImage: "pencil") { editor = SubcontractorEditRequest(order: task) }
        Button(sendTitle, systemImage: "paperplane") { Task { await send(task) } }.disabled(sending == task.id)
        if let id = task.subcontractorId {
            Divider()
            Button("Karta podwykonawcy w CRM", systemImage: "arrow.up.right.square") { state.openCRM("/crm/subcontractors/\(id)") }
        }
        if let email = task.contactEmail?.nonEmpty ?? task.subcontractor?.email?.nonEmpty, let url = URL(string: "mailto:" + email) {
            Button("Napisz e-mail", systemImage: "envelope") { NSWorkspace.shared.open(url) }
        }
        if let phone = task.subcontractor?.phone?.nonEmpty {
            Button("Kopiuj numer telefonu", systemImage: "phone") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(phone, forType: .string)
            }
        }
    }

    /// Szczegóły zaznaczonego zlecenia pod tabelą (podział regulowany jak w Finderze/Mail).
    @ViewBuilder private func orderDetail(_ orders: [SubcontractorsTabData.Order]) -> some View {
        if let task = orders.first(where: { $0.id == selectedOrder }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 12) {
                        orderThumb(task, size: 44)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(task.taskName).font(.title3.weight(.semibold)).textSelection(.enabled)
                            personLine(task)
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("Koszt").font(.caption).foregroundStyle(.secondary)
                            Text(SubcontractorLabels.amount(task.cost) + " " + task.currency).font(.title3.weight(.light)).monospacedDigit().foregroundStyle(theme.accent)
                        }
                    }
                    if task.subcontractorId == nil && task.taskType == "equipment_rental" {
                        Text("Wybierz podwykonawcę dla tego zadania, aby móc dodać szczegóły wynajmu").font(.callout).foregroundStyle(CrmTheme.rgb(0xfb923c))
                    }
                    details(task)
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
            }
        } else {
            Text("Zaznacz zlecenie, aby zobaczyć szczegóły i wytyczne. Dwuklik otwiera edycję.")
                .foregroundStyle(.secondary).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    @ViewBuilder private func personLine(_ task: SubcontractorsTabData.Order) -> some View {
        if let person = task.subcontractor {
            HStack(spacing: 14) {
                if let id = task.subcontractorId {
                    Button { state.openCRM("/crm/subcontractors/\(id)") } label: {
                        Label(person.name, systemImage: "arrow.up.right.square").labelStyle(TrailingIconLabel())
                    }
                    .buttonStyle(.plain).help("Otwórz kartę podwykonawcy w CRM")
                } else {
                    Text(person.name)
                }
                if let contact = person.contactPerson?.nonEmpty { Label(contact, systemImage: "person") }
                if let email = person.email?.nonEmpty, let url = URL(string: "mailto:" + email) { Link(destination: url) { Label(email, systemImage: "envelope") } }
                if let phone = person.phone?.nonEmpty { Label(phone, systemImage: "phone").textSelection(.enabled) }
                if let rating = person.rating, rating > 0 {
                    Label(SubcontractorLabels.amount(rating) + "/5", systemImage: "star.fill").foregroundStyle(CrmTheme.rgb(0xfacc15))
                }
            }
            .font(.callout).foregroundStyle(.secondary)
        }
    }

    private func contractsTable(_ contracts: [SubcontractorsTabData.Contract]) -> some View {
        let lp = Dictionary(contracts.enumerated().map { ($0.element.id, $0.offset + 1) }, uniquingKeysWith: { first, _ in first })
        return Table(contracts, selection: $selectedContract) {
            TableColumn("") { (contract: SubcontractorsTabData.Contract) in
                Image(systemName: contract.hasFile ? "doc.text.fill" : "doc.text")
                    .foregroundStyle(contract.hasFile ? theme.accent : Color.secondary).frame(width: 26, height: 26)
            }.width(34)
            TableColumn("Lp.") { (contract: SubcontractorsTabData.Contract) in
                Text("\(lp[contract.id] ?? 0)").monospacedDigit().foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .trailing)
            }.width(36)
            TableColumn("Podwykonawca") { (contract: SubcontractorsTabData.Contract) in
                Text(contract.subcontractor?.name ?? "—").fontWeight(.medium).lineLimit(1)
            }.width(min: 130, ideal: 200)
            TableColumn("Tytuł") { (contract: SubcontractorsTabData.Contract) in
                Text(contract.title).lineLimit(1).help(contract.title)
            }.width(min: 140, ideal: 300)
            TableColumn("Numer") { (contract: SubcontractorsTabData.Contract) in
                Text(contract.number).monospacedDigit().foregroundStyle(.secondary).lineLimit(1)
            }.width(min: 80, ideal: 140)
            TableColumn("Status") { (contract: SubcontractorsTabData.Contract) in
                EventDotLabel(label: SubcontractorLabels.status(contract.status), color: SubcontractorLabels.color(contract.status))
            }.width(min: 90, ideal: 120)
            TableColumn("Wartość") { (contract: SubcontractorsTabData.Contract) in
                Text(SubcontractorLabels.amount(contract.totalValue) + " zł").monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
            }.width(min: 80, ideal: 120)
            TableColumn("") { (contract: SubcontractorsTabData.Contract) in
                Menu { contractMenu(contract) } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Czynności")
            }.width(30)
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let contract = contracts.first(where: { $0.id == id }) { contractMenu(contract) }
        } primaryAction: { ids in
            if let id = ids.first, let contract = contracts.first(where: { $0.id == id }), contract.hasFile { Task { await openContract(contract) } }
        }
    }

    @ViewBuilder private func contractMenu(_ contract: SubcontractorsTabData.Contract) -> some View {
        Button("Podgląd umowy", systemImage: "doc.text.magnifyingglass") { Task { await openContract(contract) } }.disabled(!contract.hasFile)
        if let id = contract.subcontractorId {
            Button("Karta podwykonawcy w CRM", systemImage: "arrow.up.right.square") { state.openCRM("/crm/subcontractors/\(id)") }
        }
    }

    /// Podwykonawcy w kolejności pojawienia się w zleceniach, potem w umowach (jak `Set` w CRM).
    private func orderedSubcontractors(_ data: SubcontractorsTabData) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for id in data.tasks.compactMap(\.subcontractorId) + data.contracts.compactMap(\.subcontractorId) where !seen.contains(id) {
            seen.insert(id)
            result.append(id)
        }
        return result
    }

    private func details(_ task: SubcontractorsTabData.Order) -> some View {
        let start = SubcontractorLabels.when(task.scheduledStart ?? task.startDate, time: task.scheduledStart != nil)
        let end = SubcontractorLabels.when(task.scheduledEnd ?? task.endDate, time: task.scheduledEnd != nil)
        let confirmed = SubcontractorLabels.when(task.confirmedAt, time: true)
        let sendTitle: String = sending == task.id ? "Wysyłanie..." : (task.guidelinesStatus == "sent" ? "Wyślij ponownie" : "Wyślij wytyczne")
        let rate: String = task.paymentType == "fixed" ? SubcontractorLabels.amount(task.fixedPrice) + " zł" : SubcontractorLabels.amount(task.hourlyRate) + " zł/h"
        return VStack(alignment: .leading, spacing: 10) {
            if let scope = (task.scopeOfWork ?? task.description)?.nonEmpty { Text(scope).font(.callout).textSelection(.enabled) }
            if let equipment = task.equipment {
                HStack(spacing: 10) {
                    if let thumb = equipment.thumbnail { WarehouseThumb(url: thumb, size: 40) }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(equipment.name ?? "Sprzęt").font(.callout)
                        Text("Ilość: " + SubcontractorLabels.amount(equipment.quantity) + " szt.").font(.caption).foregroundStyle(.secondary)
                    }
                }
                .padding(8).background(CrmTheme.rgb(0xfb923c).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
            Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 4) {
                GridRow {
                    detailCell("Rozliczenie", SubcontractorLabels.paymentType(task.paymentType))
                    detailCell("Godziny", SubcontractorLabels.amount(task.actualHours) + "h / " + SubcontractorLabels.amount(task.estimatedHours) + "h")
                    detailCell("Stawka/Cena", rate)
                    detailCell("Forma", SubcontractorLabels.settlement(task.settlementType))
                    detailCell("Koszt", SubcontractorLabels.amount(task.cost) + " " + task.currency)
                }
            }
            if let deliverables = task.deliverables?.nonEmpty { textBlock("Rezultat", deliverables) }
            if let guidelines = task.guidelines?.nonEmpty { textBlock("Wytyczne", guidelines) }
            if let notes = task.operationalNotes?.nonEmpty { textBlock("Notatki wewnętrzne", notes) }
            if let note = task.responseNote?.nonEmpty {
                Text("Odpowiedź podwykonawcy: " + note).font(.caption).padding(8).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
            }
            HStack(spacing: 14) {
                if let start { Label("Od: " + start, systemImage: "calendar") }
                if let end { Label("Do: " + end, systemImage: "calendar") }
                if let confirmed {
                    Label("Zaakceptowano " + confirmed + (task.confirmedByName.map { " · " + $0 } ?? ""), systemImage: "checkmark.shield").foregroundStyle(CrmTheme.rgb(0x4ade80))
                }
                Spacer()
                Button { editor = SubcontractorEditRequest(order: task) } label: { Label("Edytuj", systemImage: "pencil") }
                Button { Task { await send(task) } } label: { Label(sendTitle, systemImage: "paperplane") }.disabled(sending == task.id)
            }
            .font(.caption)
        }
    }

    private func detailCell(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption2).foregroundStyle(.secondary)
            Text(value).font(.callout)
        }
    }

    private func textBlock(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(text).font(.callout).textSelection(.enabled)
        }
    }

    private func send(_ task: SubcontractorsTabData.Order) async {
        guard task.contactEmail?.nonEmpty != nil || task.subcontractor?.email?.nonEmpty != nil else {
            state.snack = Snack(kind: .info, text: "Uzupełnij adres e-mail podwykonawcy przed wysłaniem wytycznych")
            return
        }
        sending = task.id
        defer { sending = nil }
        do {
            try await store.tabAction(eventID, "subcontractors", "sendGuidelines", ["taskId": .string(task.id)], reload: ["subcontractors"],
                                      success: "Wytyczne wysłane do podwykonawcy", pending: "Wysyłanie wytycznych…")
        } catch {
            state.error = store.failureText(error, "Nie udało się wysłać wytycznych")
        }
    }

    private struct FileLink: Decodable { var url: String; var name: String }

    private func openContract(_ contract: SubcontractorsTabData.Contract) async {
        do {
            preview = try await state.withPending("Otwieranie umowy…") {
                let link = try await store.tabQuery(eventID, "subcontractors", "contract", ["id": contract.id], as: FileLink.self)
                guard let url = URL(string: link.url) else { throw AppError.invalidResponse }
                let (temporary, response) = try await URLSession.shared.download(from: url)
                guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false else { throw AppError.server }
                let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-umowy/\(contract.id)", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let target = folder.appendingPathComponent(link.name.replacingOccurrences(of: "/", with: "-"))
                if FileManager.default.fileExists(atPath: target.path) { try? FileManager.default.removeItem(at: target) }
                try FileManager.default.moveItem(at: temporary, to: target)
                return target
            }
        } catch {
            state.error = store.failureText(error, "Nie udało się otworzyć podglądu umowy")
        }
    }
}

/// Nazwa z ikoną po prawej (link do karty podwykonawcy).
private struct TrailingIconLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.title
            configuration.icon.font(.caption).foregroundStyle(.secondary)
        }
    }
}

struct SubcontractorEditRequest: Identifiable {
    let id = UUID()
    var order: SubcontractorsTabData.Order?
}

// MARK: Formularz zlecenia (`AddTaskModal`)

private struct SubcontractorOption: Decodable, Identifiable, Hashable {
    var id: String; var name: String; var contactPerson: String?; var email: String?; var phone: String?; var hourlyRate: Double
    var alias: String?; var organizationName: String?; var organizationPhone: String?; var defaultSettlement: String?; var preferredPayment: String?
    /// Opis jak `subcontractorOption`: alias, osoba kontaktowa, telefony, stawka.
    var detail: String {
        var parts: [String] = []
        if let alias = alias?.nonEmpty { parts.append(alias) }
        if let contact = contactPerson?.nonEmpty { parts.append(contact) }
        for number in [phone, organizationPhone].compactMap({ $0?.nonEmpty }) where !parts.contains(number) { parts.append(number) }
        if hourlyRate > 0 { parts.append(SubcontractorLabels.amount(hourlyRate) + " zł/h") }
        return parts.joined(separator: " · ")
    }
    /// `matchesSubcontractor`: numer telefonu po cyfrach, tekst — wszystkie słowa (bez polskich znaków).
    func matches(_ query: String) -> Bool {
        let fold = { (text: String) in text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "pl_PL")).replacingOccurrences(of: "ł", with: "l").lowercased() }
        let phones = [phone, organizationPhone].compactMap { $0?.replacingOccurrences(of: "[^0-9]", with: "", options: .regularExpression) }.filter { !$0.isEmpty }
        let keywords = [organizationName, alias, email].compactMap { $0 } + phones.flatMap { $0.count == 9 ? [$0, "48" + $0] : [$0] }
        let haystack = fold(([name, detail] + keywords).joined(separator: " "))
        let needle = fold(query.trimmingCharacters(in: .whitespaces))
        if needle.range(of: "^[+0-9\\s().-]+$", options: .regularExpression) != nil {
            let digits = needle.replacingOccurrences(of: "[^0-9]", with: "", options: .regularExpression)
            return !digits.isEmpty && haystack.contains(digits)
        }
        return needle.split(separator: " ").allSatisfy { haystack.contains($0) }
    }
}
private struct SubcontractorOptions: Decodable { var subcontractors: [SubcontractorOption] }
private struct CatalogService: Decodable, Identifiable, Hashable { var id: String; var name: String; var description: String?; var category: String?; var unitPrice: Double?; var unit: String? }
private struct CatalogServices: Decodable { var services: [CatalogService] }
private struct SaveReply: Decodable { struct Upload: Decodable { var path: String; var url: String }; var id: String; var upload: Upload? }
private struct GeneratedGuidelines: Decodable { var scopeOfWork: String; var deliverables: String; var guidelines: String; var source: String }

@MainActor private struct SubcontractorTaskSheet: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let request: SubcontractorEditRequest
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var options: [SubcontractorOption] = []
    @State private var services: [CatalogService] = []
    @State private var servicesLoading = false
    @State private var search = ""
    @State private var quickMode = false
    @State private var quickCompany = false
    @State private var quickName = ""
    @State private var quickNip = ""
    @State private var quickContact = ""
    @State private var quickEmail = ""
    @State private var quickPhone = ""
    @State private var subcontractorID = ""
    @State private var serviceID = ""
    @State private var taskName = ""
    @State private var describe = ""
    @State private var scope = ""
    @State private var deliverables = ""
    @State private var guidelines = ""
    @State private var notes = ""
    @State private var hasStart = false
    @State private var start = Date()
    @State private var hasEnd = false
    @State private var end = Date()
    @State private var estimatedHours = 0.0
    @State private var actualHours = 0.0
    @State private var paymentType = "hourly"
    @State private var hourlyRate = 0.0
    @State private var fixedPrice = 0.0
    @State private var agreedCost = 0.0
    @State private var settlement = "invoice_vat"
    @State private var paymentMethod = "transfer"
    @State private var status = "planned"
    @State private var paymentStatus = "pending"
    @State private var addContract = false
    @State private var contractFile: URL?
    @State private var contractNumber = ""
    @State private var contractType = "project"
    @State private var contractTitle = ""
    @State private var contractValue = 0.0
    @State private var contractDescription = ""
    @State private var errors: [String: String] = [:]
    @State private var saving = false
    @State private var showGenerator = false
    @State private var aiPrompt = ""
    @State private var aiError = ""
    @State private var aiSource = ""
    @State private var generating = false
    @State private var prepared = false

    private var editing: SubcontractorsTabData.Order? { request.order }
    private var selected: SubcontractorOption? { options.first { $0.id == subcontractorID } }
    private var matches: [SubcontractorOption] {
        let query = search.trimmingCharacters(in: .whitespaces)
        return Array((query.isEmpty ? options : options.filter { $0.matches(query) }).prefix(8))
    }

    private static let fieldLabels: [String: String] = [
        "subcontractor_id": "Podwykonawca", "company_name": "Nazwa podwykonawcy", "nip": "NIP", "email": "E-mail", "phone": "Telefon", "task_name": "Nazwa zadania",
        "scope_of_work": "Zakres obowiązków", "deliverables": "Oczekiwany rezultat", "guidelines": "Wytyczne", "scheduled_start": "Rozpoczęcie",
        "scheduled_end": "Zakończenie", "estimated_hours": "Planowane godziny", "actual_hours": "Rzeczywiste godziny", "hourly_rate": "Stawka godzinowa",
        "fixed_price": "Kwota ryczałtu", "agreed_cost": "Uzgodniony koszt", "contract_value": "Wartość umowy", "contractFile": "Plik umowy",
    ]

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(editing == nil ? "Dodaj zlecenie podwykonawcze" : "Edytuj zlecenie podwykonawcze").font(.title2.bold())
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 6)
            Form {
                providerSection
                Section {
                    HStack {
                        Button { aiError = ""; showGenerator = true } label: { Label("Wygeneruj wytyczne", systemImage: "sparkles") }.disabled(saving || generating)
                        Spacer()
                    }
                    Text("Zakres, oczekiwany rezultat i wytyczne trafią do e-maila wysłanego przyciskiem „Wyślij wytyczne” po zapisaniu zlecenia.").font(.caption).foregroundStyle(.secondary)
                    if !aiSource.isEmpty { Text("Źródło: " + aiSource).font(.caption).foregroundStyle(.secondary) }
                    TextField("Nazwa zadania *", text: $taskName, prompt: Text("np. Obsługa nagłośnienia"))
                    textArea("Zakres obowiązków", $scope, "Co dokładnie ma wykonać podwykonawca?")
                    textArea("Oczekiwany rezultat", $deliverables, "Co ma zostać dostarczone i w jakim standardzie?")
                    textArea("Wytyczne wysyłane e-mailem", $guidelines, "Kontakt na miejscu, dress code, godzina gotowości, zasady techniczne...")
                    textArea("Notatki wewnętrzne", $notes, "Informacje widoczne tylko w CRM")
                }
                Section("Termin i rozliczenie") {
                    Toggle("Rozpoczęcie pracy", isOn: $hasStart)
                    if hasStart { DatePicker("Od", selection: $start) }
                    Toggle("Zakończenie pracy", isOn: $hasEnd)
                    if hasEnd { DatePicker("Do", selection: $end) }
                    Picker("Dokument rozliczeniowy", selection: $settlement) {
                        Text("Faktura VAT").tag("invoice_vat")
                        Text("Faktura bez VAT").tag("invoice_no_vat")
                        Text("Gotówka bez działalności").tag("cash")
                        Text("Umowa cywilnoprawna").tag("civil_contract")
                        Text("Inna forma").tag("other")
                    }
                    Picker("Sposób płatności", selection: $paymentMethod) {
                        Text("Przelew").tag("transfer")
                        Text("Gotówka").tag("cash")
                        Text("Karta").tag("card")
                        Text("Inny").tag("other")
                    }
                    Picker("Typ rozliczenia", selection: $paymentType) {
                        Text("Godzinowe").tag("hourly")
                        Text("Ryczałt").tag("fixed")
                        Text("Mieszane").tag("mixed")
                    }
                    .pickerStyle(.segmented)
                    TextField("Szacowane godziny", value: $estimatedHours, format: .number)
                    TextField("Rzeczywiste godziny", value: $actualHours, format: .number)
                    if paymentType != "fixed" { TextField("Stawka godzinowa (zł)", value: $hourlyRate, format: .number) }
                    if paymentType != "hourly" { TextField("Cena ryczałtowa (zł)", value: $fixedPrice, format: .number) }
                    TextField("Uzgodniony koszt do prognozy wydarzenia (zł)", value: $agreedCost, format: .number)
                    Picker("Status zadania", selection: $status) {
                        Text("Zaplanowane").tag("planned")
                        Text("W trakcie").tag("in_progress")
                        Text("Zakończone").tag("completed")
                        Text("Anulowane").tag("cancelled")
                    }
                    Picker("Status płatności", selection: $paymentStatus) {
                        Text("Oczekuje").tag("pending")
                        Text("Zapłacone").tag("paid")
                        Text("Opóźnione").tag("overdue")
                    }
                }
                if editing == nil { contractSection }
                if !errors.isEmpty {
                    Section {
                        Text("Nie można zapisać zlecenia. Popraw:").font(.callout.weight(.semibold)).foregroundStyle(.red)
                        ForEach(errors.sorted(by: { $0.key < $1.key }), id: \.key) { item in
                            Text((Self.fieldLabels[item.key] ?? "Formularz") + ": " + item.value).font(.callout).foregroundStyle(.red)
                        }
                    }
                }
            }
            .formStyle(.grouped)
            .disabled(saving || generating)
            HStack {
                let saveTitle: String = saving ? "Zapisywanie..." : (editing == nil ? "Dodaj zlecenie" : "Zapisz zmiany")
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saveTitle) { Task { await save() } }
                    .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(saving || generating)
            }
            .padding(16)
        }
        .frame(minWidth: 640, idealWidth: 700, minHeight: 640, idealHeight: 820)
        .sheet(isPresented: $showGenerator) { generatorSheet }
        .task {
            guard !prepared else { return }
            prepared = true
            fill()
            await loadOptions()
        }
        .onChange(of: subcontractorID) { _, _ in Task { await subcontractorChanged() } }
    }

    // MARK: Podwykonawca

    @ViewBuilder private var providerSection: some View {
        Section("Podwykonawca") {
            if editing == nil {
                Picker("", selection: $quickMode) {
                    Text("Z bazy").tag(false)
                    Text("Jednorazowy / nowy").tag(true)
                }
                .pickerStyle(.segmented).labelsHidden()
            }
            if !quickMode {
                if let selected {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(selected.name).font(.callout.weight(.medium))
                            if !selected.detail.isEmpty { Text(selected.detail).font(.caption).foregroundStyle(.secondary) }
                        }
                        Spacer()
                        Button("Zmień") { subcontractorID = ""; serviceID = "" }
                    }
                } else {
                    TextField("Podwykonawca *", text: $search, prompt: Text("Wyszukaj po nazwie, aliasie lub telefonie…"))
                    if matches.isEmpty {
                        Text(options.isEmpty ? "Ładowanie podwykonawców…" : "Nie znaleziono podwykonawcy").font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(matches) { option in
                        Button { subcontractorID = option.id; search = "" } label: {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(option.name).font(.callout)
                                if !option.detail.isEmpty { Text(option.detail).font(.caption).foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                if !subcontractorID.isEmpty {
                    Picker("Usługa podwykonawcy", selection: $serviceID) {
                        Text(servicesLoading ? "Ładowanie usług..." : "Inna / niezdefiniowana usługa").tag("")
                        ForEach(services) { service in Text(serviceLabel(service)).tag(service.id) }
                    }
                    .disabled(servicesLoading)
                    .onChange(of: serviceID) { _, id in serviceSelected(id) }
                    if !servicesLoading && services.isEmpty {
                        Text("Ten podwykonawca nie ma jeszcze zdefiniowanych usług. Zlecenie zostanie zapisane jako usługa niezdefiniowana.").font(.caption).foregroundStyle(.secondary)
                    }
                }
            } else {
                Picker("", selection: $quickCompany) {
                    Text("Osoba prywatna").tag(false)
                    Text("Firma / działalność").tag(true)
                }
                .pickerStyle(.segmented).labelsHidden()
                if settlement.hasPrefix("invoice") { TextField("NIP *", text: $quickNip) }
                if settlement == "civil_contract" {
                    HStack(spacing: 4) {
                        Text("Umowa zlecenie wymaga pełnego kreatora danych i oświadczeń.").font(.caption)
                        Button("Dodaj podwykonawcę i przygotuj umowę") { state.openCRM("/crm/subcontractors/new") }.buttonStyle(.link).linkCursor().font(.caption)
                    }
                    .foregroundStyle(theme.accent)
                }
                TextField(quickCompany ? "Nazwa firmy *" : "Imię i nazwisko *", text: $quickName)
                if quickCompany { TextField("Osoba kontaktowa", text: $quickContact) }
                TextField("E-mail (potrzebny do potwierdzeń)", text: $quickEmail)
                TextField("Telefon", text: $quickPhone)
            }
        }
    }

    private func serviceLabel(_ service: CatalogService) -> String {
        guard let price = service.unitPrice else { return service.name }
        return service.name + " — " + SubcontractorLabels.amount(price) + " zł/" + (service.unit?.nonEmpty ?? "szt.")
    }

    // MARK: Umowa

    @ViewBuilder private var contractSection: some View {
        Section {
            Toggle("Dodaj umowę otrzymaną od podwykonawcy", isOn: $addContract)
            if addContract {
                HStack {
                    Image(systemName: contractFile == nil ? "doc.badge.plus" : "doc.fill").foregroundStyle(theme.accent)
                    Text(contractFile?.lastPathComponent ?? "Plik umowy *").foregroundStyle(contractFile == nil ? Color.secondary : Color.primary)
                    Spacer()
                    if contractFile != nil { Button("Usuń") { contractFile = nil } }
                    Button("Wybierz plik…") { chooseContract() }
                }
                .dropDestination(for: URL.self) { urls, _ in
                    guard let url = urls.first(where: { $0.isFileURL && !$0.hasDirectoryPath }) else { return false }
                    contractFile = url
                    return true
                }
                Text("Przeciągnij PDF albo skan umowy. Plik trafi także do folderu „Umowy z podwykonawcami” w wydarzeniu.").font(.caption).foregroundStyle(.secondary)
                TextField("Numer umowy (opcjonalnie)", text: $contractNumber, prompt: Text("np. UMW/2025/001"))
                Picker("Typ umowy", selection: $contractType) {
                    Text("Projektowa").tag("project")
                    Text("Ramowa").tag("frame")
                }
                TextField("Tytuł umowy (opcjonalnie)", text: $contractTitle, prompt: Text("np. Umowa o świadczenie usług nagłośnienia"))
                TextField("Wartość umowy (zł)", value: $contractValue, format: .number)
                TextField("Opis umowy", text: $contractDescription, axis: .vertical).lineLimit(2...4)
            }
        }
        .onChange(of: addContract) { _, on in if !on { contractFile = nil } }
    }

    private func chooseContract() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.prompt = "Wybierz"
        if panel.runModal() == .OK, let url = panel.url { contractFile = url }
    }

    // MARK: Generator wytycznych

    private var generatorSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Wygeneruj wytyczne").font(.title3.bold())
            Text("AI uzupełni zakres obowiązków, oczekiwany rezultat i wytyczne na podstawie wydarzenia, zlecenia i Twoich wskazówek. Jeśli jest zaakceptowana oferta, uwzględni także wybrany pakiet. Oferta nie jest wymagana. Zastąpi treść tych trzech pól — sprawdź ją przed wysłaniem.")
                .font(.callout).foregroundStyle(.secondary)
            Text("Dodatkowe wskazówki (opcjonalnie)").font(.caption.weight(.semibold))
            TextEditor(text: Binding(get: { aiPrompt }, set: { aiPrompt = String($0.prefix(2000)) })).frame(minHeight: 90).font(.body)
                .scrollContentBackground(.hidden).padding(6).background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            Text("\(aiPrompt.count)/2000").font(.caption2).foregroundStyle(.secondary)
            if !aiError.isEmpty { Text(aiError).font(.callout).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Anuluj") { showGenerator = false }.disabled(generating)
                Button(generating ? "Przygotowywanie wytycznych…" : "Wygeneruj i uzupełnij") { Task { await generate() } }
                    .buttonStyle(.borderedProminent).disabled(generating)
            }
        }
        .padding(20).frame(width: 520)
    }

    private func generate() async {
        guard !generating else { return }
        guard !taskName.trimmingCharacters(in: .whitespaces).isEmpty else {
            aiError = "Najpierw podaj nazwę zlecenia, aby AI określiło obowiązki tego podwykonawcy."
            return
        }
        generating = true
        aiError = ""
        defer { generating = false }
        do {
            let reply = try await store.tabAction(eventID, "subcontractors", "generate", [
                "prompt": .string(aiPrompt), "taskName": .string(taskName), "scopeOfWork": .string(scope), "deliverables": .string(deliverables),
                "guidelines": .string(guidelines), "startsAt": .string(hasStart ? MeetingDates.iso(start) : ""),
                "endsAt": .string(hasEnd ? MeetingDates.iso(end) : ""),
            ], reload: [], success: nil, pending: "Przygotowywanie wytycznych…")
            let draft = try JSONDecoder().decode(GeneratedGuidelines.self, from: reply)
            scope = draft.scopeOfWork
            deliverables = draft.deliverables
            guidelines = draft.guidelines
            aiSource = draft.source
            showGenerator = false
            state.succeed("Uzupełniono zakres, oczekiwany rezultat i wytyczne. Sprawdź treść przed zapisaniem i wysłaniem.")
        } catch {
            aiError = store.failureText(error, "Nie udało się wygenerować wytycznych.")
        }
    }

    // MARK: Dane formularza

    private func fill() {
        guard let task = editing else { return }
        subcontractorID = task.subcontractorId ?? ""
        serviceID = task.serviceCatalogId ?? ""
        taskName = task.taskName
        describe = task.description ?? ""
        scope = task.scopeOfWork ?? task.description ?? ""
        deliverables = task.deliverables ?? ""
        guidelines = task.guidelines ?? ""
        notes = task.operationalNotes ?? ""
        if let value = task.scheduledStart, let date = MeetingDates.parse(value) { hasStart = true; start = date }
        if let value = task.scheduledEnd, let date = MeetingDates.parse(value) { hasEnd = true; end = date }
        estimatedHours = task.estimatedHours
        actualHours = task.actualHours
        paymentType = task.paymentType
        hourlyRate = task.hourlyRate
        fixedPrice = task.fixedPrice
        agreedCost = task.agreedCost
        settlement = task.settlementType
        paymentMethod = task.paymentMethod
        status = task.status
        paymentStatus = task.paymentStatus
    }

    private func loadOptions() async {
        do {
            options = try await store.tabQuery(eventID, "subcontractors", "subcontractors", as: SubcontractorOptions.self).subcontractors
        } catch {
            state.error = store.failureText(error, "Błąd podczas ładowania danych podwykonawców")
        }
        if !subcontractorID.isEmpty { await loadServices(keepSelection: true) }
    }

    /// Wybór podwykonawcy: jego usługi, domyślna stawka (dla godzinowego bez stawki), forma rozliczenia i płatności.
    private func subcontractorChanged() async {
        guard !subcontractorID.isEmpty else { services = []; serviceID = ""; return }
        if let sub = selected, editing?.subcontractorId != subcontractorID {
            if paymentType == "hourly" && hourlyRate == 0 { hourlyRate = sub.hourlyRate }
            if let value = sub.defaultSettlement?.nonEmpty { settlement = value }
            if let value = sub.preferredPayment?.nonEmpty { paymentMethod = value }
        }
        await loadServices(keepSelection: editing?.subcontractorId == subcontractorID)
    }

    private func loadServices(keepSelection: Bool) async {
        servicesLoading = true
        defer { servicesLoading = false }
        if !keepSelection { serviceID = "" }
        services = (try? await store.tabQuery(eventID, "subcontractors", "services", ["subcontractorId": subcontractorID], as: CatalogServices.self).services) ?? []
    }

    private func serviceSelected(_ id: String) {
        guard let service = services.first(where: { $0.id == id }) else { return }
        taskName = service.name
        if let description = service.description { describe = description; scope = description }
        if let price = service.unitPrice { paymentType = "fixed"; fixedPrice = price; agreedCost = price }
    }

    private func save() async {
        guard !saving, !generating else { return }
        if addContract, editing == nil, contractFile == nil {
            errors = ["contractFile": "Dodaj plik umowy podwykonawcy"]
            return
        }
        saving = true
        defer { saving = false }
        let day = { (date: Date) in MeetingDates.format(date, "yyyy-MM-dd") }
        let previousStart: JSONValue = editing?.startDate.map { JSONValue.string($0) } ?? JSONValue.null
        let previousEnd: JSONValue = editing?.endDate.map { JSONValue.string($0) } ?? JSONValue.null
        let startDay: JSONValue = hasStart ? JSONValue.string(day(start)) : previousStart
        let endDay: JSONValue = hasEnd ? JSONValue.string(day(end)) : previousEnd
        let values: [String: JSONValue] = [
            "subcontractorId": .string(subcontractorID), "serviceCatalogId": .string(serviceID), "taskName": .string(taskName), "description": .string(describe),
            "scopeOfWork": .string(scope), "deliverables": .string(deliverables), "guidelines": .string(guidelines), "operationalNotes": .string(notes),
            "scheduledStart": .string(hasStart ? MeetingDates.iso(start) : ""), "scheduledEnd": .string(hasEnd ? MeetingDates.iso(end) : ""),
            "startDay": startDay, "endDay": endDay,
            "estimatedHours": .number(estimatedHours), "actualHours": .number(actualHours), "paymentType": .string(paymentType),
            "hourlyRate": .number(hourlyRate), "fixedPrice": .number(fixedPrice), "agreedCost": .number(agreedCost), "settlementType": .string(settlement),
            "paymentMethod": .string(paymentMethod), "status": .string(status), "paymentStatus": .string(paymentStatus),
        ]
        var body: [String: JSONValue] = ["data": .object(values), "providerMode": .string(quickMode && editing == nil ? "quick" : "existing")]
        if let editing { body["id"] = .string(editing.id) }
        if quickMode && editing == nil {
            body["quick"] = .object([
                "entityType": .string(quickCompany ? "company" : "individual"), "companyName": .string(quickName), "nip": .string(quickNip),
                "contactPerson": .string(quickContact), "email": .string(quickEmail), "phone": .string(quickPhone),
            ])
        }
        let size = contractFile.flatMap { try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize } ?? 0
        let contract: [String: JSONValue] = [
            "fileName": .string(contractFile?.lastPathComponent ?? ""), "fileSize": .number(Double(size)), "number": .string(contractNumber),
            "type": .string(contractType), "title": .string(contractTitle), "totalValue": .number(contractValue), "description": .string(contractDescription),
        ]
        if addContract && editing == nil { body["contract"] = .object(contract) }
        do {
            let pendingUpload = addContract && editing == nil
            let data = try await store.tabAction(eventID, "subcontractors", "save", body, reload: pendingUpload ? [] : ["subcontractors"], success: nil, pending: "Zapisywanie zlecenia…")
            let reply = try JSONDecoder().decode(SaveReply.self, from: data)
            if let upload = reply.upload, let file = contractFile {
                try await uploadContract(file, upload, taskID: reply.id, contract: contract)
            }
            errors = [:]
            state.succeed(editing == nil ? "Zlecenie podwykonawcze zostało dodane" : "Zlecenie podwykonawcze zostało zaktualizowane")
            dismiss()
        } catch let failure as NativeFailure where !failure.fieldErrors.isEmpty {
            errors = failure.fieldErrors
            state.snack = Snack(kind: .info, text: failure.message)
        } catch {
            state.error = store.failureText(error, "Błąd podczas dodawania zadania")
        }
    }

    /// Plik umowy prosto do magazynu (podpisany adres), potem rekord umowy; nieudana wysyłka cofa nowe zlecenie jak w CRM.
    private func uploadContract(_ file: URL, _ upload: SaveReply.Upload, taskID: String, contract: [String: JSONValue]) async throws {
        guard let target = URL(string: upload.url) else { throw AppError.invalidResponse }
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.setValue(UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        let sent: Bool
        do {
            let (_, response) = try await state.withPending("Wysyłanie pliku umowy…") { try await URLSession.shared.upload(for: request, fromFile: file) }
            sent = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? false
        } catch {
            sent = false
        }
        var body: [String: JSONValue] = ["taskId": .string(taskID), "path": .string(upload.path), "contract": .object(contract)]
        if !sent { body["failed"] = .bool(true) }
        try await store.tabAction(eventID, "subcontractors", "attachContract", body, reload: ["subcontractors"], success: nil, pending: "Zapisywanie umowy…")
        if !sent { throw NativeFailure(status: 400, message: "Nie udało się przesłać pliku umowy. Zlecenie nie zostało zapisane — spróbuj ponownie.", fieldErrors: [:]) }
    }

    private func textArea(_ title: String, _ text: Binding<String>, _ prompt: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField("", text: text, prompt: Text(prompt), axis: .vertical).lineLimit(3...8).labelsHidden()
        }
    }
}

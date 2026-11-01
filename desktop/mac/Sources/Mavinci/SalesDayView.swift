import SwiftUI

struct SalesDayView: View {
    @EnvironmentObject var state: Workspace
    var data: [String: JSONValue] { state.snapshot?.salesDay.object ?? [:] }
    func items(_ key: String) -> [Row] { (data[key]?.array ?? []).map { Row($0.object) } }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Dzień dobry, \(state.employee?.name ?? "")").font(.largeTitle.bold())
                Text("Sprawy wymagające kontaktu i decyzji. Dane pochodzą z tego samego zestawienia co CRM i telefon.").foregroundStyle(.secondary)
                if let error = state.moduleErrors["day"] { Text(error).foregroundStyle(.orange) }
                if state.employee?.canView(.inquiries) == true {
                    HStack(spacing: 32) {
                        metric("Kontakty na dziś", count: items("followups").count)
                        metric("Oferty bez odpowiedzi", count: items("waiting_offers").count)
                        metric("Przetargi w 7 dni", count: items("tenders").count)
                        metric("Bez terminu kontaktu", count: Int(data["unscheduled_inquiries"]?.number ?? 0))
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                    section("Kontakty do wykonania", rows: items("followups"), module: .inquiries, dateKey: "next_action_at")
                    section("Oferty bez odpowiedzi", rows: items("waiting_offers"), module: .offers)
                    section("Przetargi z bliskim terminem", rows: items("tenders"), module: .tenders, dateKey: "submission_deadline")
                    if !items("pipeline").isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Lejek sprzedaży").font(.headline)
                            ForEach(Array(items("pipeline").enumerated()), id: \.offset) { _, row in
                                HStack {
                                    Text(Labels.text(row["stage"]))
                                    Spacer()
                                    Text("\(Int(row.fields["count"]?.number ?? 0)) spraw").foregroundStyle(.secondary)
                                    Text((row.fields["weighted_value"]?.number ?? 0).formatted(.currency(code: "PLN").locale(Locale(identifier: "pl_PL")))).monospacedDigit().frame(minWidth: 130, alignment: .trailing)
                                }
                            }
                            Text("Wartość ważona pochodzi z obliczeń serwera.").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if state.employee?.canView(.tasks) == true {
                    section("Moje otwarte zadania", rows: Array(state.rows(.tasks).filter { !["completed", "done", "cancelled"].contains($0.status) }.sorted { $0.date < $1.date }.prefix(15)), module: .tasks, dateKey: "due_date")
                }
            }.padding(30).frame(maxWidth: 1200, alignment: .leading)
        }.navigationTitle("Mój dzień")
    }
    private func metric(_ title: String, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text("\(count)").font(.system(size: 28, weight: .semibold)).monospacedDigit(); Text(title).font(.callout).foregroundStyle(.secondary) }
    }
    private func section(_ title: String, rows: [Row], module: Module, dateKey: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            if rows.isEmpty { Text("Brak spraw w tej sekcji.").font(.callout).foregroundStyle(.secondary) }
            ForEach(rows) { row in
                Button {
                    if module == .offers, !row["inquiry_id"].isEmpty { state.open(.inquiries, id: row["inquiry_id"]) }
                    else { state.open(module, id: row.id) }
                } label: {
                    HStack {
                        Image(systemName: module.symbol).foregroundStyle(.secondary).frame(width: 24)
                        Text(row.title.isEmpty ? (row["offer_number"].isEmpty ? "Sprawa" : row["offer_number"]) : row.title).lineLimit(2)
                        Spacer()
                        if let dateKey { Text(Labels.date(row[dateKey])).monospacedDigit().foregroundStyle(row.fields["overdue"]?.flag == true ? .orange : .secondary) }
                        else if let days = row.fields["days_waiting"]?.number { Text("\(Int(days)) dni").foregroundStyle(.secondary) }
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }.padding(.vertical, 9).contentShape(Rectangle())
                }.buttonStyle(.plain)
                Divider()
            }
        }
    }
}

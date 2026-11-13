import SwiftUI

// MARK: Gotowość do oferty na karcie produktu (`ProductReadiness.tsx`) — grupy wymagań z brakami, „Uzupełnij” / „Pokaż”,
// „Nie dotyczy…” z powodem (koszt, sprzęt, obsada, klauzule), „Przywróć” i usunięcie zbędnego wpisu.

@MainActor struct ProductReadinessPanel: View {
    @ObservedObject var store: ProductsStore
    let detail: ProductDetail
    let show: (ProductDetail.Check) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var open: Bool?
    @State private var waiving: String?
    @State private var reason = ""
    @FocusState private var reasonFocused: Bool

    init(store: ProductsStore, detail: ProductDetail, show: @escaping (ProductDetail.Check) -> Void) {
        _store = ObservedObject(wrappedValue: store)
        self.detail = detail
        self.show = show
    }

    private var readiness: ProductDetail.Readiness { detail.readiness }
    private var expanded: Bool { open ?? !readiness.ready }
    private var canEdit: Bool { detail.canEdit && state.canWrite }

    private var status: String {
        if !readiness.resourcesChecked { return "Nie udało się sprawdzić sprzętu i obsady." }
        return readiness.ready ? "Gotowy — ma wszystko, czego potrzebuje oferta." : "Do uzupełnienia: \(ProductText.missing(readiness.missing.count))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.easeInOut(duration: 0.15)) { open = !expanded } } label: {
                HStack(spacing: 10) {
                    Image(systemName: readiness.ready ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(readiness.ready ? Color.green : Color.orange)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Gotowość do oferty").font(.headline)
                        Text(status).font(.callout).foregroundStyle(readiness.ready ? Color.green : Color.orange)
                    }
                    Spacer()
                    if readiness.resourcesChecked {
                        ProductReadinessDots(groups: readiness.groups.map { (label: $0.label, ok: $0.ok) })
                    }
                    Image(systemName: "chevron.down").rotationEffect(.degrees(expanded ? 0 : -90)).foregroundStyle(.secondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(14)

            if expanded {
                Divider()
                VStack(alignment: .leading, spacing: 14) {
                    if !readiness.resourcesChecked {
                        Button("Spróbuj ponownie") { Task { await store.loadDetail(detail.id) } }.controlSize(.small)
                    }
                    ForEach(readiness.groups) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(group.label).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                            ForEach(group.checks) { check in row(check) }
                        }
                    }
                    if !detail.active {
                        Label("Produkt jest nieaktywny — nie trafia do nowych ofert.", systemImage: "pause.circle")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                }
                .padding(14)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke((readiness.ready ? Color.green : Color.orange).opacity(0.35)))
    }

    @ViewBuilder private func row(_ check: ProductDetail.Check) -> some View {
        HStack(alignment: .top, spacing: 10) {
            icon(check).frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(check.label).font(.callout.weight(.medium))
                Text(check.detail).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if check.exemption != nil && check.state == "ok" && canEdit {
                    Button("Wpis „nie dotyczy” jest już zbędny — usuń") { restore(check) }
                        .buttonStyle(.link).font(.caption)
                }
                if let key = check.exemptionKey, waiving == key { waiver(check, key: key) }
            }
            Spacer(minLength: 8)
            if (check.state == "missing" || check.state == "waived") && waiving != check.exemptionKey {
                HStack(spacing: 6) {
                    if check.state == "missing" {
                        Button(detail.canEdit ? "Uzupełnij" : "Pokaż") { show(check) }
                    }
                    if check.state == "missing" && canEdit, let key = check.exemptionKey {
                        Button("Nie dotyczy…") { waiving = key; reason = ""; reasonFocused = true }
                    }
                    if check.state == "waived" && canEdit {
                        Button("Przywróć") { restore(check) }
                    }
                }
                .controlSize(.small)
            }
        }
    }

    @ViewBuilder private func icon(_ check: ProductDetail.Check) -> some View {
        switch check.state {
        case "ok": Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.green).help("Gotowe")
        case "missing": Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.orange).help("Brak")
        default: Image(systemName: "nosign").foregroundStyle(.secondary).help("Nie dotyczy")
        }
    }

    private func waiver(_ check: ProductDetail.Check, key: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Dlaczego nie dotyczy tego produktu?").font(.caption).foregroundStyle(.secondary)
            TextField("", text: Binding(get: { reason }, set: { reason = String($0.prefix(300)) }),
                      prompt: Text(check.key == "cost" ? "np. własny sprzęt, koszt w amortyzacji"
                                   : check.key == "equipment" ? "np. artysta przyjeżdża ze swoim sprzętem" : "Powód"))
                .textFieldStyle(.roundedBorder)
                .focused($reasonFocused)
                .onSubmit { submit(check, key: key) }
                .onExitCommand { waiving = nil; reason = "" }
            HStack {
                Button("Anuluj") { waiving = nil; reason = "" }
                Button("Zapisz") { submit(check, key: key) }
                    .buttonStyle(.borderedProminent)
                    .disabled(reason.trimmingCharacters(in: .whitespaces).count < 3)
            }
            .controlSize(.small)
        }
        .padding(.top, 4)
    }

    private func submit(_ check: ProductDetail.Check, key: String) {
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 3 else {
            state.error = "Wpisz powód (co najmniej 3 znaki)."
            return
        }
        Task {
            if await store.setExemption(detail.id, key: key, reason: text,
                                        success: "Oznaczono: \(check.label.lowercased()) nie dotyczy tego produktu") {
                waiving = nil
                reason = ""
            }
        }
    }

    private func restore(_ check: ProductDetail.Check) {
        guard let key = check.exemptionKey else { return }
        Task { await store.setExemption(detail.id, key: key, reason: nil, success: "Przywrócono wymaganie: \(check.label.lowercased())") }
    }
}

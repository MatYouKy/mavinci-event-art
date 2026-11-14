import SwiftUI

// MARK: „Wymagania techniczne oferty” (`OfferRequirementsEditor`) — wymagania z szablonu głównego kategorii i produktów,
// scalone na serwerze (`buildOfferRequirements`); edycja w karcie jak w CRM: uwzględnij / pomiń w PDF, tytuł, treść, własne
// wymagania, „Odśwież automatycznie”, zapis `op=requirementsSave`.

@MainActor struct OfferRequirementsCard: View {
    @ObservedObject var store: OffersStore
    let detail: OfferDetail
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferRequirementsData?
    @State private var entries: [OfferRequirement] = []
    @State private var snapshot: [OfferRequirement] = []
    @State private var loadError: String?
    @State private var open = false
    @State private var editing = false
    @State private var dirty = false
    @State private var saving = false

    /// Zmiana pozycji, statusu lub treści oferty — wymagania budowane od nowa (poza trybem edycji, jak w CRM).
    private var reloadKey: String {
        "\(detail.offer.updatedAt ?? "")|\(detail.offer.contentRevision ?? 0)|\(detail.offer.status)|\(detail.items.map(\.id).joined(separator: ","))"
    }
    private var mayEdit: Bool { detail.canEdit && data?.canEdit == true }

    var body: some View {
        OfferCard(title: "Wymagania techniczne oferty",
                  subtitle: "Sekcja jest budowana z szablonu głównego, kategorii i dodanych produktów. Powtórzenia są scalane automatycznie, a mocniejszy warunek ma pierwszeństwo — np. zasilanie 400 V / trójfazowe zastępuje 230 V.",
                  symbol: "checklist", trailing: trailing) {
            if let loadError, data == nil {
                HStack {
                    Text(loadError).font(.callout).foregroundStyle(.red)
                    Spacer()
                    Button("Spróbuj ponownie") { Task { await load() } }.controlSize(.small)
                }
            } else if data == nil {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Scalanie wymagań…").font(.callout).foregroundStyle(.secondary)
                }
            } else {
                Button { open.toggle() } label: {
                    HStack(spacing: 6) {
                        Text("\(entries.filter(\.included).count) uwzględnionych wymagań · \(open ? "Zwiń sekcję" : "Otwórz i zweryfikuj")")
                        Image(systemName: open ? "chevron.up" : "chevron.down")
                    }
                    .font(.caption.weight(.medium))
                }
                .buttonStyle(.link)
                if open && editing { tools }
                if open { list }
            }
        }
        .task(id: reloadKey) { if !editing { await load() } }
    }

    private var trailing: AnyView? {
        guard mayEdit else { return nil }
        if editing {
            return AnyView(Button("Anuluj") {
                entries = snapshot
                dirty = false
                editing = false
            }.disabled(saving))
        }
        return AnyView(Button {
            snapshot = entries
            editing = true
            open = true
        } label: { Label("Edytuj", systemImage: "pencil") }.disabled(data == nil || !state.canWrite))
    }

    private var tools: some View {
        HStack(spacing: 8) {
            Button {
                if let data {
                    entries = data.automatic
                    dirty = true
                }
            } label: { Label("Odśwież automatycznie", systemImage: "arrow.counterclockwise") }
            Button { add() } label: { Label("Dodaj wymaganie", systemImage: "plus") }
            Spacer()
            Button { Task { await save() } } label: { Label(saving ? "Zapisywanie…" : "Zapisz", systemImage: "square.and.arrow.down") }
                .buttonStyle(.borderedProminent)
                .disabled(saving || !dirty || !state.canWrite)
        }
        .controlSize(.small)
        .disabled(saving)
    }

    @ViewBuilder private var list: some View {
        if entries.isEmpty {
            Text("Brak wymagań dla aktualnego zakresu.").font(.callout).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity).padding(.vertical, 16)
        } else {
            VStack(spacing: 8) {
                ForEach(entries) { entry in row(entry) }
            }
        }
    }

    private func row(_ entry: OfferRequirement) -> some View {
        let key = entry.key
        let canEdit = editing && !saving
        return HStack(alignment: .top, spacing: 10) {
            Button { update(key) { $0.included.toggle() } } label: {
                Image(systemName: entry.included ? "checkmark.square.fill" : "square")
                    .font(.title3)
                    .foregroundStyle(entry.included ? theme.accent : Color.secondary)
            }
            .buttonStyle(.plain)
            .disabled(!canEdit)
            .help(entry.included ? "Uwzględniane w PDF" : "Pominięte w PDF")
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    if canEdit {
                        TextField("", text: Binding(get: { entries.first(where: { $0.key == key })?.title ?? "" },
                                                    set: { value in update(key) { $0.title = value } }))
                            .textFieldStyle(.roundedBorder)
                            .font(.caption.weight(.semibold))
                    } else {
                        Text(entry.title).font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                    }
                    Text(entry.label ?? "INNE WYMAGANIE").font(.caption2).foregroundStyle(.tertiary)
                }
                if canEdit {
                    ProductTextArea(text: Binding(get: { entries.first(where: { $0.key == key })?.description ?? "" },
                                                  set: { value in update(key) { $0.description = value } }),
                                    lines: 2...8)
                } else {
                    Text(entry.description).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
                Text("Źródło: \(entry.sources.isEmpty ? "Ustalenie w ofercie" : entry.sources.joined(separator: " · "))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if canEdit {
                Button { remove(entry) } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.red)
                    .help(entry.origin == "manual" ? "Usuń" : "Pomiń w PDF")
            }
        }
        .padding(10)
        .background(Color.primary.opacity(entry.included ? 0.05 : 0.02), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(entry.included ? theme.accent.opacity(0.25) : Color.primary.opacity(0.06)))
        .opacity(entry.included ? 1 : 0.55)
    }

    // MARK: Zmiany

    private func update(_ key: String, _ change: (inout OfferRequirement) -> Void) {
        guard let index = entries.firstIndex(where: { $0.key == key }) else { return }
        change(&entries[index])
        dirty = true
    }

    private func add() {
        var entry = OfferRequirement.manual()
        while entries.contains(where: { $0.key == entry.key }) { entry.key += "1" }
        entries.append(entry)
        dirty = true
    }

    /// Własne wymaganie znika, automatyczne zostaje pominięte w PDF (jak `removeRequirement`).
    private func remove(_ entry: OfferRequirement) {
        if entry.origin == "manual" {
            entries.removeAll { $0.key == entry.key }
            dirty = true
        } else {
            update(entry.key) { $0.included = false }
        }
    }

    private func load() async {
        do {
            let next = try await store.requirements(detail.offer.id)
            guard !editing else { return }
            data = next
            entries = next.entries
            dirty = false
            loadError = nil
        } catch {
            loadError = store.failureText(error, "Nie udało się wczytać wymagań.")
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            let next = try await store.saveRequirements(detail.offer.id, entries)
            data = next
            entries = next.entries
            dirty = false
            editing = false
        } catch {
            state.error = store.failureText(error, "Nie udało się zapisać wymagań")
        }
    }
}

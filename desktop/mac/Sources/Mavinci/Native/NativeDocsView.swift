import SwiftUI
import AppKit

// MARK: Lista kart zbioru z serwera CRM — tabela, wyszukiwanie, „Pokaż” i karta obok (wąskie okno: w arkuszu).

extension DocRecord {
    var amountSort: Double { amountGrosz ?? -Double.greatestFiniteMagnitude }
}

enum DocTones {
    static func color(_ tone: String) -> Color {
        switch tone {
        case "new": return .blue
        case "progress": return .orange
        case "wait": return .purple
        case "warn": return .red
        case "done": return .green
        default: return .secondary
        }
    }
    static func tag(_ tone: String?) -> Color {
        switch tone { case "danger": return .red; case "warn": return .orange; case "info": return .blue; default: return .secondary }
    }
}

struct NativeDocsView: View {
    let set: String
    @EnvironmentObject private var workspace: Workspace
    @EnvironmentObject private var native: NativeStore
    @State private var query = ""
    @State private var filter = "open"
    @State private var selection: String?
    @State private var modal: String?
    @State private var sortOrder = [KeyPathComparator(\DocRecord.createdAt, order: .reverse)]

    private var meta: DocSectionMeta? { native.meta(set) }
    private var all: [DocRecord] { native.records[set] ?? [] }
    private var filterOptions: [FilterOption] {
        var out: [FilterOption] = []
        var tags: [String: (label: String, count: Int)] = [:]; var tagOrder: [String] = []
        for r in all { for t in r.filters { if tags[t.id] == nil { tagOrder.append(t.id); tags[t.id] = (t.label, 0) }; tags[t.id]?.count += 1 } }
        for id in tagOrder { if let t = tags[id] { out.append(FilterOption(id: "tag:\(id)", label: "\(t.label) (\(t.count))")) } }
        let openCount = all.filter(\.open).count
        out.append(FilterOption(id: "open", label: "\(meta?.openLabel.isEmpty == false ? meta!.openLabel : "Otwarte") (\(openCount))"))
        out.append(FilterOption(id: "all", label: "Wszystkie (\(all.count))"))
        var statuses: [String: (label: String, count: Int)] = [:]; var statusOrder: [String] = []
        for r in all where !r.status.isEmpty { if statuses[r.status] == nil { statusOrder.append(r.status); statuses[r.status] = (r.statusLabel, 0) }; statuses[r.status]?.count += 1 }
        for code in statusOrder { if let s = statuses[code] { out.append(FilterOption(id: "status:\(code)", label: "\(s.label) (\(s.count))")) } }
        return out
    }
    private var rows: [DocRecord] {
        let needle = SearchText.fold(query)
        return all.filter { r in
            if !needle.isEmpty { return SearchText.fold([r.search, r.number, r.title, r.subtitle].joined(separator: " ")).contains(needle) }
            if filter == "open" { return r.open }
            if filter.hasPrefix("tag:") { return r.filters.contains { $0.id == String(filter.dropFirst(4)) } }
            if filter.hasPrefix("status:") { return r.status == String(filter.dropFirst(7)) }
            return true
        }.sorted(using: sortOrder)
    }
    private var selected: DocRecord? { selection.flatMap { id in all.first { $0.id == id } } }

    var body: some View {
        GeometryReader { available in
            let wide = available.size.width >= 1000
            VStack(alignment: .leading, spacing: 0) {
                header
                if let message = native.error { MessageBar(text: message, warning: true) {} }
                ForEach(meta?.alerts ?? [], id: \.text) { alert in
                    Button { if let f = alert.filter { filter = f }; if let q = alert.query { query = q } } label: {
                        Label(alert.text, systemImage: "exclamationmark.circle").font(.callout).frame(maxWidth: .infinity, alignment: .leading)
                    }.buttonStyle(.plain).padding(10).background(DocTones.tag(alert.tone).opacity(0.12))
                }
                HStack(alignment: .top, spacing: 0) {
                    table.frame(width: wide && selected != nil ? max(420, available.size.width * 0.46) : nil)
                    if wide, let record = selected {
                        DocCardView(set: set, record: record).frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color.primary.opacity(0.03))
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .onChange(of: selection) { _, next in if !wide, next != nil { modal = next } }
        }
        .navigationTitle(meta?.title ?? "CRM")
        .sheet(item: Binding(get: { modal.map(IdentifiedID.init) }, set: { modal = $0?.id })) { item in
            if let record = all.first(where: { $0.id == item.id }) {
                VStack(spacing: 0) {
                    DocCardView(set: set, record: record)
                    HStack { Spacer(); Button("Zamknij") { modal = nil }.keyboardShortcut(.cancelAction) }.padding(12)
                }.frame(minWidth: 620, minHeight: 560)
            }
        }
        .onAppear { revealFocus() }
        .onChange(of: workspace.focusToken) { _, _ in revealFocus() }
    }

    private func revealFocus() {
        guard let id = workspace.nativeFocus, all.contains(where: { $0.id == id }) else { return }
        query = ""
        if let r = all.first(where: { $0.id == id }), filter == "open", !r.open { filter = "all" }
        selection = id
        workspace.nativeFocus = nil
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                TextField("Szukaj", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 320)
                Picker("Pokaż", selection: $filter) { ForEach(filterOptions) { Text($0.label).tag($0.id) } }.frame(maxWidth: 300)
                Spacer()
                if native.syncing { ProgressView().controlSize(.small) }
                Text(native.lastSync.map { "Zsynchronizowano \(Labels.date(ISO8601DateFormatter().string(from: $0)))" } ?? "").font(.caption).foregroundStyle(.secondary)
            }
            if let hint = meta?.hint, !hint.isEmpty { Text(hint).font(.caption).foregroundStyle(.secondary) }
        }.padding(.horizontal, 16).padding(.vertical, 10)
    }

    private var headers: [String] { meta?.headers ?? ["Numer", "Nazwa", "Opis", "Data", "Status", "Kwota"] }

    private var table: some View {
        Table(rows, selection: $selection, sortOrder: $sortOrder) {
            TableColumn(headers[0], value: \.number) { r in Text(r.number.isEmpty ? "—" : r.number).monospacedDigit().foregroundStyle(.secondary) }.width(min: 80, ideal: 110, max: 150)
            TableColumn(headers[1], value: \.title) { r in
                VStack(alignment: .leading, spacing: 2) {
                    Text(r.title).lineLimit(2)
                    if !r.subtitle.isEmpty { Text(r.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }.padding(.vertical, 3)
            }.width(min: 220, ideal: 380)
            TableColumn(headers[3], value: \.date) { r in Text(r.dateText.isEmpty ? "—" : r.dateText).monospacedDigit() }.width(min: 90, ideal: 110, max: 130)
            TableColumn(headers[4], value: \.statusLabel) { r in
                HStack(spacing: 6) { Circle().fill(DocTones.color(r.tone)).frame(width: 7, height: 7); Text(r.statusLabel).lineLimit(1) }
            }.width(min: 110, ideal: 150, max: 200)
            TableColumn(headers[5], value: \.amountSort) { r in Text(r.amountText.isEmpty ? "—" : r.amountText).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing) }.width(min: 90, ideal: 120, max: 160)
        }
        .scrollContentBackground(.hidden)
        .overlay {
            if rows.isEmpty {
                ContentUnavailableView(all.isEmpty ? (native.syncing ? "Pobieranie…" : "Brak pozycji") : "Brak pozycji w tym widoku", systemImage: meta?.icon ?? "doc.text",
                                       description: Text(all.isEmpty ? "Dane pojawią się po synchronizacji z serwerem CRM." : "Zmień wyszukiwanie lub filtr „Pokaż”."))
            }
        }
    }
}

struct IdentifiedID: Identifiable { let id: String }
struct FilterOption: Identifiable, Hashable { let id: String; let label: String }

// MARK: Karta rekordu — nagłówek, czynności, sekcje (wiersze, tabele, tekst).

struct DocCardView: View {
    let set: String
    let record: DocRecord
    @EnvironmentObject private var workspace: Workspace
    @State private var form: DocAction?
    @State private var confirming: DocAction?

    private var topActions: [DocAction] { record.actions.filter { $0.isPrimary && $0.section == nil }.prefix(2).map { $0 } }
    private var menuActions: [DocAction] { record.actions.filter { a in a.section == nil && !topActions.contains(a) } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        if !record.number.isEmpty { Text(record.number).font(.callout.monospacedDigit()).foregroundStyle(.secondary) }
                        Text(record.statusLabel).font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 3)
                            .background(DocTones.color(record.tone).opacity(0.16), in: Capsule()).foregroundStyle(DocTones.color(record.tone))
                        ForEach(record.filters, id: \.id) { tag in
                            Text(tag.label).font(.caption).padding(.horizontal, 7).padding(.vertical, 3).background(DocTones.tag(tag.tone).opacity(0.14), in: Capsule())
                        }
                        Spacer()
                        if !record.amountText.isEmpty { Text(record.amountText).font(.title3.monospacedDigit().weight(.semibold)) }
                    }
                    Text(record.title).font(.title2.bold()).textSelection(.enabled)
                    if !record.subtitle.isEmpty { Text(record.subtitle).foregroundStyle(.secondary).textSelection(.enabled) }
                }
                if !record.actions.filter({ $0.section == nil }).isEmpty {
                    HStack(spacing: 8) {
                        ForEach(topActions) { action in
                            Button { run(action) } label: { Label(action.label, systemImage: action.symbol) }.buttonStyle(.borderedProminent)
                                .disabled(needsConnection(action) && !workspace.canWrite)
                        }
                        if !menuActions.isEmpty {
                            Menu { ForEach(menuActions) { action in Button(role: action.isDestructive ? .destructive : nil) { run(action) } label: { Label(action.label, systemImage: action.symbol) }.disabled(needsConnection(action) && !workspace.canWrite) } }
                            label: { Image(systemName: "ellipsis.circle") }.menuStyle(.borderlessButton).fixedSize()
                        }
                        Spacer()
                    }
                }
                ForEach(record.sections) { section in
                    DocSectionBox(section: section, actions: record.actions.filter { $0.section == section.key && !section.key.isEmpty }, run: run)
                }
            }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
        }
        .sheet(item: $form) { action in DocFormSheet(set: set, record: record, action: action) }
        .confirmationDialog(confirming?.confirm ?? confirming?.label ?? "", isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
            if let action = confirming {
                Button(action.label, role: action.isDestructive ? .destructive : nil) { Task { await workspace.runNative(action, record: record, set: set, data: [:], key: UUID().uuidString) } }
            }
            Button("Anuluj", role: .cancel) {}
        }
    }

    private func needsConnection(_ action: DocAction) -> Bool { action.url == nil && action.open == nil && action.copy == nil && action.file == nil }

    private func run(_ action: DocAction) {
        if let text = action.copy { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string); workspace.notice = "Skopiowano."; return }
        if let url = action.url { workspace.openCRM(url); return }
        if let open = action.open { workspace.openCRM(open); return }
        if action.file != nil { workspace.openCRM(record.panelHref); return }
        if let fields = action.fields, !fields.isEmpty { form = action; return }
        confirming = action
    }
}

struct DocSectionBox: View {
    let section: DocSection
    let actions: [DocAction]
    let run: (DocAction) -> Void
    @EnvironmentObject private var workspace: Workspace
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(section.title).font(.headline)
                Spacer()
                ForEach(actions) { action in Button { run(action) } label: { Label(action.label, systemImage: action.symbol) }.buttonStyle(.borderless).font(.callout) }
            }
            if !section.rows.isEmpty {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 6) {
                    ForEach(Array(section.rows.enumerated()), id: \.offset) { _, row in
                        GridRow {
                            Text(row.label).foregroundStyle(.secondary).gridColumnAlignment(.leading)
                            if let link = row.link {
                                Button(row.value) { workspace.openNativeLink(link) }.buttonStyle(.link).multilineTextAlignment(.leading)
                            } else {
                                Text(row.value).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
            if let table = section.table, !table.columns.isEmpty {
                ScrollView(.horizontal) {
                    Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
                        GridRow { ForEach(Array(table.columns.enumerated()), id: \.offset) { _, c in Text(c).font(.caption.weight(.semibold)).foregroundStyle(.secondary) } }
                        Divider().gridCellUnsizedAxes(.horizontal)
                        ForEach(Array(table.rows.enumerated()), id: \.offset) { index, cells in
                            GridRow {
                                ForEach(Array(cells.enumerated()), id: \.offset) { column, cell in
                                    if column == 1 || (table.columns.count == 1), index < table.links.count, let link = table.links[index] {
                                        Button(cell) { workspace.openNativeLink(link) }.buttonStyle(.link)
                                    } else { Text(cell).textSelection(.enabled) }
                                }
                            }
                        }
                    }.padding(.bottom, 4)
                }
            }
            if !section.text.isEmpty { Text(section.text).textSelection(.enabled).foregroundStyle(section.tone == "warn" ? .orange : .primary) }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 10))
    }
}

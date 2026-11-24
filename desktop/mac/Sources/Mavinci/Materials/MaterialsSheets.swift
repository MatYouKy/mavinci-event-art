import AppKit
import SwiftUI

// MARK: Materiały — okna i panele: wybór folderu (przenoszenie, zapis pliku wydarzenia), okno wysyłki, karta pliku,
// wyniki wyszukiwania i kosz (1:1 z `MaterialsFolderPicker.tsx`, `UploadDialog`, `MaterialsDetails.tsx`, `MaterialsTrash.tsx`).

/// Wybór folderu marki (z drzewem); foldery wykluczone (przenoszony folder i jego podfoldery) są niedostępne.
@MainActor struct MaterialsFolderPicker: View {
    @ObservedObject var store: MaterialsStore
    let title: String
    let confirm: String
    let excluded: [String]
    let initial: String?
    let onPick: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var chosen: String??

    init(store: MaterialsStore, title: String, confirm: String, excluded: [String], initial: String?, onPick: @escaping (String?) -> Void) {
        self.store = store
        self.title = title
        self.confirm = confirm
        self.excluded = excluded
        self.initial = initial
        self.onPick = onPick
    }

    private var blocked: Set<String> {
        var result = Set<String>()
        for id in excluded { result.formUnion(store.descendants(of: id)) }
        return result
    }

    private var rows: [(folder: MaterialFolder, level: Int)] {
        var result: [(folder: MaterialFolder, level: Int)] = []
        func visit(_ parent: String?, _ level: Int) {
            for folder in MaterialsStore.ordered(store.folders.filter { $0.parentId == parent }) {
                result.append((folder: folder, level: level))
                visit(folder.id, level + 1)
            }
        }
        visit(nil, 1)
        return result
    }

    var body: some View {
        let selected: String? = chosen ?? initial
        let blocked = self.blocked
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.title3.weight(.semibold))
            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    row(id: nil, name: store.home?.company.name ?? "Główny folder marki", symbol: "building.2", level: 0, disabled: false, selected: selected == nil)
                    ForEach(rows, id: \.folder.id) { item in
                        row(id: item.folder.id, name: item.folder.name, symbol: MaterialsText.folderSymbol(item.folder), level: item.level,
                            disabled: blocked.contains(item.folder.id), selected: selected == item.folder.id)
                    }
                }
            }
            .frame(minHeight: 260, maxHeight: 420)
            .padding(6)
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction)
                Button(confirm) { onPick(selected) }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(selected.map { blocked.contains($0) } ?? false)
            }
        }
        .padding(20)
        .frame(width: 460)
    }

    private func row(id: String?, name: String, symbol: String, level: Int, disabled: Bool, selected: Bool) -> some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).foregroundStyle(disabled ? Color.secondary : theme.accent).frame(width: 18)
            Text(name).lineLimit(1).foregroundStyle(disabled ? Color.secondary : Color.primary)
            Spacer()
        }
        .padding(.leading, CGFloat(level) * 14 + 6).padding(.vertical, 5).padding(.trailing, 6)
        .background(selected ? theme.accent.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: 6))
        .contentShape(Rectangle())
        .onTapGesture { if !disabled { chosen = .some(id) } }
    }
}

/// Wysyłka na Dysk w tle — panel w rogu okna (jak w Dysku Google), nie blokuje aplikacji: można dalej przeglądać Dysk, dodawać
/// kolejne pliki (dołączają do kolejki) i pracować w innych sekcjach. Zwinięty: liczba plików, postęp, bieżący plik i „Przerwij
/// wysyłkę”; rozwinięty — lista plików z miejscem docelowym, błędami i pominiętymi duplikatami (gdzie już są). Po zakończeniu
/// z błędami albo duplikatami panel zostaje do „Zamknij”; po udanej wysyłce znika sam.
@MainActor struct MaterialsUploadPanel: View {
    @ObservedObject var uploads: MaterialsUploads
    @Environment(\.crmTheme) private var theme

    var body: some View {
        if let batch = uploads.batch {
            panel(batch)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func panel(_ batch: MaterialsUploadBatch) -> some View {
        let rows = batch.rows
        let finished = rows.filter { $0.status == .done || $0.status == .skipped }.count
        let failed = rows.filter { $0.status == .failed }.count
        let skipped = rows.filter { $0.status == .skipped }.count
        let cancelled = rows.filter { $0.status == .cancelled }.count
        let total = rows.reduce(Int64(0)) { $0 + ($1.status == .failed || $1.status == .cancelled ? 0 : $1.size) }
        let sent = rows.reduce(Int64(0)) { $0 + ($1.status == .done || $1.status == .skipped ? $1.size : $1.status == .uploading ? $1.sent : 0) }
        let current = rows.first { $0.status == .uploading }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: batch.running ? "arrow.up.circle" : failed > 0 ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(batch.running ? theme.accent : failed > 0 ? Color.orange : Color.green)
                Text(batch.running ? "Wysyłanie na Dysk (\(finished)/\(rows.count))" : "Wysyłka zakończona (\(finished)/\(rows.count))")
                    .font(.callout.weight(.semibold)).monospacedDigit().lineLimit(1)
                Spacer(minLength: 4)
                if batch.running { ProgressView().controlSize(.small) }
                Button { withAnimation(.easeOut(duration: 0.15)) { uploads.expanded.toggle() } } label: {
                    Image(systemName: uploads.expanded ? "chevron.down" : "chevron.up")
                }
                .buttonStyle(.borderless)
                .help(uploads.expanded ? "Zwiń listę plików" : "Pokaż listę plików")
                if !batch.running {
                    Button { uploads.close() } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless).help("Zamknij")
                }
            }
            if batch.running {
                ProgressView(value: total > 0 ? min(1, Double(sent) / Double(total)) : 0).tint(theme.accent)
                HStack(spacing: 6) {
                    Text(current.map { "\($0.name) · \($0.place)" } ?? "Przygotowanie plików…").lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 4)
                    Text("\(MaterialsText.bytes(Double(sent))) z \(MaterialsText.bytes(Double(total)))").monospacedDigit()
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            if failed > 0 || skipped > 0 || (cancelled > 0 && !batch.running) {
                Text([failed > 0 ? "Nie udało się: \(failed)" : nil, skipped > 0 ? "Pominięte duplikaty: \(skipped)" : nil,
                      cancelled > 0 && !batch.running ? "Przerwane: \(cancelled)" : nil].compactMap { $0 }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(failed > 0 ? Color.red : theme.accent)
            }
            if uploads.expanded { list(rows) }
            HStack {
                if !uploads.expanded && !batch.running && (failed > 0 || skipped > 0) {
                    Button("Pokaż szczegóły") { withAnimation(.easeOut(duration: 0.15)) { uploads.expanded = true } }
                }
                Spacer()
                if batch.running {
                    Button("Przerwij wysyłkę", role: .destructive) { uploads.cancel() }
                } else {
                    Button("Zamknij") { uploads.close() }
                }
            }
            .controlSize(.small)
        }
        .padding(12)
        .frame(width: 380)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.1)))
        .shadow(color: .black.opacity(0.2), radius: 14, y: 4)
    }

    private func list(_ rows: [MaterialsUploadRow]) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                ForEach(rows) { row in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Image(systemName: icon(row.status)).foregroundStyle(color(row.status))
                            Text(row.name).lineLimit(1).truncationMode(.middle)
                            Spacer(minLength: 4)
                            Text(MaterialsText.bytes(Double(row.size))).font(.caption2).foregroundStyle(.secondary).monospacedDigit()
                        }
                        Text(row.place).font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                        if row.status == .uploading {
                            ProgressView(value: row.size > 0 ? min(1, Double(row.sent) / Double(row.size)) : 0).tint(theme.accent)
                        }
                        if let error = row.error { Text(error).font(.caption2).foregroundStyle(.red) }
                        if row.status == .skipped {
                            Text(["Pominięto — duplikat", row.note].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption2).foregroundStyle(theme.accent).lineLimit(2).help(row.note ?? "")
                        }
                    }
                    .font(.caption)
                    .padding(6)
                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))
                }
            }
        }
        .frame(maxHeight: 280)
    }

    private func icon(_ status: MaterialsUploadRow.Status) -> String {
        switch status {
        case .waiting: return "clock"
        case .uploading: return "arrow.up.circle"
        case .done: return "checkmark.circle.fill"
        case .skipped: return "doc.on.doc"
        case .failed: return "exclamationmark.triangle.fill"
        case .cancelled: return "xmark.circle"
        }
    }

    private func color(_ status: MaterialsUploadRow.Status) -> Color {
        switch status {
        case .done: return .green
        case .failed: return .red
        case .uploading, .skipped: return theme.accent
        default: return .secondary
        }
    }
}

/// Karta pliku z boku: podgląd, dane, opis i tagi (zarządzanie), poprzednie wersje, czynności.
@MainActor struct MaterialDetailsPanel: View {
    @ObservedObject var store: MaterialsStore
    let file: MaterialFile
    let onPreview: () -> Void
    let onRename: () -> Void
    let onMove: () -> Void
    let onDelete: () -> Void
    let onReplace: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var description = ""
    @State private var tags = ""
    @State private var loadedFor: String?

    var body: some View {
        let detail = store.details[file.id]
        let current = detail?.file ?? file
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                MaterialThumb(file: current, side: 288, fit: true)
                    .frame(maxWidth: .infinity)
                    .onTapGesture(count: 2) { onPreview() }
                Text(current.name).font(.headline).textSelection(.enabled)
                VStack(alignment: .leading, spacing: 4) {
                    fact("Rodzaj", MaterialsText.kindLabel(current.kind))
                    fact("Rozmiar", MaterialsText.bytes(current.size))
                    if let width = current.width, let height = current.height { fact("Wymiary", "\(width) × \(height) px") }
                    if current.duration != nil { fact("Czas", MaterialsText.duration(current.duration)) }
                    if let detail { fact("Folder", ([store.home?.company.name ?? ""] + detail.path.map(\.name)).filter { !$0.isEmpty }.joined(separator: " / ")) }
                    fact("Dodano", [MaterialsText.dateLabel(current.createdAt), current.createdBy ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    fact("Zmieniono", [MaterialsText.dateLabel(current.updatedAt), current.updatedBy ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    if let event = detail?.event {
                        HStack(alignment: .firstTextBaseline) {
                            Text("Event").font(.caption).foregroundStyle(.secondary).frame(width: 78, alignment: .leading)
                            Button(event.name) { state.showEvent(event.id) }.buttonStyle(.link).font(.caption)
                        }
                    }
                }
                HStack(spacing: 6) {
                    Button { onPreview() } label: { Label("Podgląd", systemImage: "eye") }
                    Button { Task { await store.downloadToDownloads(id: current.id, version: current.contentVersion, name: current.name) } } label: {
                        Label("Pobierz", systemImage: "arrow.down.circle")
                    }
                }
                .controlSize(.small)
                Divider().opacity(0.4)
                if store.canManage {
                    Text("Opis").font(.caption.weight(.semibold))
                    TextEditor(text: $description).font(.callout).frame(minHeight: 70, maxHeight: 140)
                        .scrollContentBackground(.hidden).padding(4)
                        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.05)))
                    Text("Tagi (po przecinku)").font(.caption.weight(.semibold))
                    TextField("np. logo, wesele, LED", text: $tags).textFieldStyle(.roundedBorder)
                    Button("Zapisz opis i tagi") {
                        let list = tags.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        Task { await store.updateFile(current.id, description: description, tags: list) }
                    }
                    .disabled(description == current.description && tags == current.tags.joined(separator: ", "))
                } else {
                    if !current.description.isEmpty { Text(current.description).font(.callout) }
                    if !current.tags.isEmpty {
                        WrapLayout(spacing: 4) {
                            ForEach(current.tags, id: \.self) { tag in
                                Text(tag).font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
                                    .background(Capsule().fill(theme.accent.opacity(0.15)))
                            }
                        }
                    }
                }
                if let versions = detail?.versions, !versions.isEmpty {
                    Divider().opacity(0.4)
                    Text("Poprzednie wersje (30 dni)").font(.caption.weight(.semibold))
                    ForEach(versions) { version in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Wersja \(version.contentVersion)").font(.caption)
                                Text([MaterialsText.dateLabel(version.replacedAt), version.replacedBy ?? "", MaterialsText.bytes(version.size)]
                                    .filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button {
                                let ext = (current.name as NSString).pathExtension
                                let base = (current.name as NSString).deletingPathExtension
                                let name = ext.isEmpty ? "\(base) (wersja \(version.contentVersion))" : "\(base) (wersja \(version.contentVersion)).\(ext)"
                                Task { await store.downloadToDownloads(kind: "version", id: version.id, version: version.contentVersion, name: name) }
                            } label: { Image(systemName: "arrow.down.circle") }
                            .buttonStyle(.borderless).help("Pobierz tę wersję")
                        }
                    }
                }
                if store.canManage {
                    Divider().opacity(0.4)
                    VStack(alignment: .leading, spacing: 6) {
                        Button { onRename() } label: { Label("Zmień nazwę", systemImage: "pencil") }
                        Button { onMove() } label: { Label("Przenieś", systemImage: "folder") }
                        Button { onReplace() } label: { Label("Podmień treść", systemImage: "arrow.triangle.2.circlepath") }
                        Button(role: .destructive) { onDelete() } label: { Label("Usuń (kosz 30 dni)", systemImage: "trash") }
                    }
                    .buttonStyle(.borderless)
                }
            }
            .padding(14)
        }
        .task(id: "\(file.id)-\(file.contentVersion)-\(file.metaVersion)") {
            await store.loadDetail(file.id)
            sync(store.details[file.id]?.file ?? file)
        }
        .onAppear { sync(file) }
    }

    private func sync(_ current: MaterialFile) {
        let key = "\(current.id)-\(current.description)-\(current.tags.joined(separator: ","))"
        guard loadedFor != key else { return }
        loadedFor = key
        description = current.description
        tags = current.tags.joined(separator: ", ")
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.caption).foregroundStyle(.secondary).frame(width: 78, alignment: .leading)
            Text(value.isEmpty ? "—" : value).font(.caption).textSelection(.enabled)
        }
    }
}

/// Wyniki wyszukiwania: Materiały (wszystkie marki z dostępem) albo pliki wydarzeń z „Zapisz w Materiałach”.
@MainActor struct MaterialsSearchResults: View {
    @ObservedObject var store: MaterialsStore
    let onOpen: (MaterialSearchHit) -> Void
    let onPreview: (MaterialSearchHit) -> Void
    let onPreviewEvent: (MaterialEventHit) -> Void
    let onSave: (MaterialEventHit) -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let result = store.search
        Group {
            if result == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if store.scope == .events {
                let hits = result?.events ?? []
                if hits.isEmpty { empty } else {
                    List(hits) { hit in
                        HStack(spacing: 10) {
                            thumb(hit.thumbnailUrl, kind: hit.kind, name: hit.name)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.name).font(.callout).lineLimit(1)
                                Text([hit.eventName, MaterialsText.dateLabel(hit.eventDate, time: false), hit.folderName ?? "", MaterialsText.bytes(hit.size)]
                                    .filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Button { onPreviewEvent(hit) } label: { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd")
                            if store.canManage {
                                Button { onSave(hit) } label: { Label("Zapisz w Materiałach", systemImage: "square.and.arrow.down") }.controlSize(.small)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .listStyle(.inset).scrollContentBackground(.hidden)
                }
            } else {
                let hits = result?.materials ?? []
                if hits.isEmpty { empty } else {
                    List(hits) { hit in
                        HStack(spacing: 10) {
                            MaterialThumb(file: hit.file, side: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hit.file.name).font(.callout).lineLimit(1)
                                Text(([hit.companyName] + hit.path.map(\.name)).joined(separator: " / ") + " · " + MaterialsText.bytes(hit.file.size))
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Button { onPreview(hit) } label: { Image(systemName: "eye") }.buttonStyle(.borderless).help("Podgląd")
                            Button { onOpen(hit) } label: { Image(systemName: "folder") }.buttonStyle(.borderless).help("Pokaż w folderze")
                        }
                        .padding(.vertical, 2)
                        .contentShape(Rectangle())
                        .onTapGesture(count: 2) { onOpen(hit) }
                    }
                    .listStyle(.inset).scrollContentBackground(.hidden)
                }
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 36)).foregroundStyle(.tertiary)
            Text("Nic nie znaleziono dla „\(store.query.trimmingCharacters(in: .whitespaces))”.").foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func thumb(_ url: String?, kind: String, name: String) -> some View {
        Group {
            if let url { SocialImageView(url: url) } else {
                Image(nsImage: NSWorkspace.shared.icon(for: MaterialsText.type(of: name))).resizable().scaledToFit().padding(4)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }
}

/// Kosz marki: elementy z ostatnich 30 dni (folder razem z zawartością), przywracanie i usuwanie na zawsze.
@MainActor struct MaterialsTrashList: View {
    @ObservedObject var store: MaterialsStore
    @State private var confirmDelete: MaterialTrashItem?
    @Environment(\.crmTheme) private var theme

    var body: some View {
        let items = store.trash.filter { !$0.insideFolder }
        Group {
            if store.trashLoading && store.trash.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if items.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "trash").font(.system(size: 36)).foregroundStyle(.tertiary)
                    Text("Kosz jest pusty.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(items) { item in
                    HStack(spacing: 10) {
                        Group {
                            if item.kind == "folder" {
                                Image(systemName: "folder.fill").resizable().scaledToFit().padding(6).foregroundStyle(theme.accent)
                            } else if let url = item.thumbnailUrl {
                                SocialImageView(url: url)
                            } else {
                                Image(nsImage: NSWorkspace.shared.icon(for: MaterialsText.type(of: item.name))).resizable().scaledToFit().padding(4)
                            }
                        }
                        .frame(width: 40, height: 40).clipShape(RoundedRectangle(cornerRadius: 5))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.name).font(.callout).lineLimit(1)
                            Text(details(item)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Button { Task { await store.restore([item]) } } label: { Label("Przywróć", systemImage: "arrow.uturn.backward") }.controlSize(.small)
                        Button(role: .destructive) { confirmDelete = item } label: { Image(systemName: "trash.slash") }
                            .buttonStyle(.borderless).help("Usuń na zawsze")
                    }
                    .padding(.vertical, 2)
                }
                .listStyle(.inset).scrollContentBackground(.hidden)
            }
        }
        .confirmationDialog("Usunąć „\(confirmDelete?.name ?? "")” na zawsze?", isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible) {
            Button("Usuń na zawsze", role: .destructive) {
                if let item = confirmDelete { Task { await store.deleteForever([item]) } }
                confirmDelete = nil
            }
            Button("Anuluj", role: .cancel) { confirmDelete = nil }
        } message: {
            Text("Tego nie można cofnąć.")
        }
    }

    private func details(_ item: MaterialTrashItem) -> String {
        var parts: [String] = []
        if item.kind == "folder" { parts.append(item.contains > 0 ? "folder · \(item.contains) el." : "folder") } else { parts.append(MaterialsText.bytes(item.size)) }
        if let location = item.location { parts.append(location.isEmpty ? "główny folder marki" : location) }
        parts.append("usunięto " + MaterialsText.dateLabel(item.deletedAt) + (item.deletedBy.map { " · \($0)" } ?? ""))
        if let purge = MaterialsText.date(item.purgeAfter) {
            let days = max(0, Int(ceil(purge.timeIntervalSinceNow / 86400)))
            parts.append(days == 1 ? "zniknie za 1 dzień" : "zniknie za \(days) dni")
        }
        return parts.joined(separator: " · ")
    }
}

import SwiftUI
import AppKit

// MARK: Marketing → „Realizacje” — 1:1 z `/crm/marketing/portfolio`: lista realizacji portfolio strony (szkice, na stronie,
// do opublikowania) z wyszukiwaniem i filtrem, nowa realizacja (z wydarzenia albo od zera) i karta realizacji obok listy
// (`PortfolioEditorView`) na całej szerokości okna.

@MainActor struct PortfolioView: View {
    @ObservedObject var store: PortfolioStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme

    var body: some View {
        content
            .navigationTitle("Realizacje")
            .navigationSubtitle("Portfolio na stronie mavinci.pl")
            .task(id: state.employee?.id) { await store.load(quiet: store.home != nil) }
            .sheet(isPresented: $store.creating) {
                PortfolioCreateSheet(store: store).environmentObject(state).environment(\.crmTheme, theme)
            }
    }

    @ViewBuilder private var content: some View {
        if let home = store.home {
            main(home)
        } else if let error = store.loadError {
            ContentUnavailableView {
                Label("Realizacje", systemImage: "rosette")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func main(_ home: PortfolioHome) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header(home)
            HStack(alignment: .top, spacing: 14) {
                list(home).frame(width: 310)
                Group {
                    if let id = store.openedID {
                        PortfolioEditorView(store: store, id: id, cities: home.cities, categories: home.categories).id(id)
                    } else {
                        placeholder
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(_ home: PortfolioHome) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Marketing", systemImage: "sparkles").font(.callout).foregroundStyle(theme.accent)
                Text("Realizacje").font(.title.weight(.light))
                Text("Portfolio na stronie mavinci.pl — kopie robocze, zdjęcia, opisy, SEO i publikacja.")
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            .layoutPriority(1)
            Spacer(minLength: 16)
            if store.loading { ProgressView().controlSize(.small) }
            if let url = URL(string: home.siteUrl) {
                Button { NSWorkspace.shared.open(url) } label: { Label("Portfolio na stronie", systemImage: "arrow.up.right.square") }
            }
            Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            Button { store.creating = true } label: { Label("Nowa realizacja", systemImage: "plus") }.buttonStyle(.borderedProminent)
        }
    }

    private func list(_ home: PortfolioHome) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("Szukaj realizacji", text: $store.query).textFieldStyle(.roundedBorder)
            WrapLayout(spacing: 4) {
                ForEach(PortfolioFilter.allCases) { filter in
                    Button { store.filter = filter } label: {
                        Text(filter.label(home)).font(.caption)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(RoundedRectangle(cornerRadius: 6).fill(store.filter == filter ? theme.accent.opacity(0.18) : Color.clear))
                            .foregroundStyle(store.filter == filter ? theme.accent : Color.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            let items = store.visibleItems
            ScrollView {
                LazyVStack(spacing: 6) {
                    ForEach(items) { item in row(item) }
                    if items.isEmpty {
                        Text("Brak realizacji w tym widoku.").font(.callout).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(12)
                            .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
                    }
                }
            }
        }
    }

    private func row(_ item: PortfolioListItem) -> some View {
        let opened = store.openedID == item.id
        let unsaved = store.dirty(item.id)
        return Button { store.openedID = item.id } label: {
            HStack(alignment: .top, spacing: 10) {
                Color.clear.frame(width: 76, height: 58)
                    .overlay {
                        if let thumb = item.thumbnailUrl { SocialImageView(url: thumb) } else {
                            Rectangle().fill(Color.primary.opacity(0.06)).overlay(Image(systemName: "photo.on.rectangle").foregroundStyle(theme.accent.opacity(0.4)))
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(item.title).font(.callout).lineLimit(2)
                        Spacer(minLength: 2)
                        if item.isFeatured { Image(systemName: "star.fill").font(.caption2).foregroundStyle(theme.accent).help("Wyróżniona") }
                    }
                    HStack(spacing: 6) {
                        PortfolioStatusBadge(status: item.status)
                        if item.problems > 0 {
                            Label("\(item.problems)", systemImage: "exclamationmark.triangle").font(.caption2).foregroundStyle(.orange)
                                .help("Braki przed publikacją: \(item.problems)")
                        }
                        if unsaved { Label("niezapisane", systemImage: "circle.fill").font(.caption2).foregroundStyle(theme.accent).labelStyle(.titleAndIcon) }
                    }
                    Text([PortfolioDates.display(item.eventDate), item.category, "\(item.photos) zdj."].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(opened ? theme.accent.opacity(0.7) : Color.clear, lineWidth: 1.5))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var placeholder: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo.on.rectangle.angled").font(.system(size: 40)).foregroundStyle(theme.accent.opacity(0.5))
            Text("Wybierz realizację z listy albo utwórz nową — z eventu albo od zera.").font(.callout).foregroundStyle(.secondary)
            Button { store.creating = true } label: { Label("Nowa realizacja", systemImage: "plus") }.buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, minHeight: 320)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }
}

struct PortfolioStatusBadge: View {
    let status: PortfolioStatus
    var body: some View {
        Text(status.label).font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(Capsule().fill(status.color.opacity(0.15)))
            .overlay(Capsule().stroke(status.color.opacity(0.4), lineWidth: 1))
            .foregroundStyle(status.color)
    }
}

/// Nowa realizacja: z wydarzenia w CRM (tytuł, data, miejsce, rodzaj) albo od zera z tytułem.
@MainActor struct PortfolioCreateSheet: View {
    @ObservedObject var store: PortfolioStore
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var title = ""
    @State private var events: [PortfolioEvent] = []
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Nowa realizacja").font(.title3.weight(.semibold))
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            Text("Z eventu w CRM").font(.headline)
            Text("Tytuł, data, miejsce i rodzaj z eventu; zdjęcia dodasz z jego plików.").font(.caption).foregroundStyle(.secondary)
            TextField("Szukaj eventu", text: $query).textFieldStyle(.roundedBorder)
            List(events) { event in
                Button { Task { await store.create(title: nil, eventID: event.id) } } label: {
                    HStack {
                        Image(systemName: "calendar").foregroundStyle(.secondary)
                        Text(event.name).lineLimit(1)
                        Spacer()
                        Text(event.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .frame(minHeight: 220)
            .overlay { if let problem { Text(problem).font(.callout).foregroundStyle(.secondary) } else if events.isEmpty { Text("Brak eventów.").font(.callout).foregroundStyle(.secondary) } }
            Divider()
            Text("Albo od zera").font(.headline)
            HStack {
                TextField("Tytuł realizacji", text: $title).textFieldStyle(.roundedBorder)
                    .onSubmit { submitTitle() }
                Button("Utwórz") { submitTitle() }.buttonStyle(.borderedProminent)
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20)
        .frame(width: 620, height: 560)
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            if Task.isCancelled { return }
            do { events = try await store.events(query: query); problem = nil }
            catch { if !Task.isCancelled { events = []; problem = store.failureText(error, "Nie udało się pobrać eventów.") } }
        }
    }

    private func submitTitle() {
        let value = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(PortfolioLimits.title))
        guard !value.isEmpty else { return }
        Task { await store.create(title: value, eventID: nil) }
    }
}

/// Wybór wydarzenia do powiązania z realizacją.
@MainActor struct PortfolioEventPickerSheet: View {
    @ObservedObject var store: PortfolioStore
    let onPick: (PortfolioEvent) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var events: [PortfolioEvent] = []
    @State private var problem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Powiąż z eventem").font(.title3.weight(.semibold))
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            TextField("Szukaj eventu", text: $query).textFieldStyle(.roundedBorder)
            List(events) { event in
                Button { onPick(event); dismiss() } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(event.name).lineLimit(1)
                        Text(event.summary).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .overlay { if let problem { Text(problem).font(.callout).foregroundStyle(.secondary) } else if events.isEmpty { Text("Brak eventów.").font(.callout).foregroundStyle(.secondary) } }
        }
        .padding(20)
        .frame(width: 560, height: 520)
        .task(id: query) {
            if !query.isEmpty { try? await Task.sleep(for: .milliseconds(250)) }
            if Task.isCancelled { return }
            do { events = try await store.events(query: query); problem = nil }
            catch { if !Task.isCancelled { events = []; problem = store.failureText(error, "Nie udało się pobrać eventów.") } }
        }
    }
}

/// Zdjęcia do realizacji z plików powiązanego wydarzenia, Materiałów albo biblioteki social media (zaznaczanie wielu).
@MainActor struct PortfolioPhotoPickerSheet: View {
    @ObservedObject var store: PortfolioStore
    let eventID: String?
    let eventName: String?
    let onPick: (PortfolioPhotoSource, [PortfolioPhotoOption]) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State var source: PortfolioPhotoSource
    @State private var query = ""
    @State private var photos: [PortfolioPhotoOption] = []
    @State private var problem: String?
    @State private var loading = false
    @State private var selected: [String] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Dodaj zdjęcia do realizacji").font(.title3.weight(.semibold))
                Spacer()
                Picker("Źródło", selection: $source) {
                    ForEach(PortfolioPhotoSource.allCases) { item in Label(item.label, systemImage: item.symbol).tag(item) }
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 460)
            }
            if source == .event {
                if let eventName { Text("Event: \(eventName)").font(.caption).foregroundStyle(.secondary) }
            } else {
                TextField("Szukaj po nazwie", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 320)
            }
            ZStack {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                        ForEach(photos) { photo in tile(photo) }
                    }
                }
                if loading { ProgressView("Ładowanie zdjęć...") }
                else if let problem { Text(problem).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center).padding() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            HStack {
                Text("Zdjęcia trafią na stronę w trzech rozmiarach (WebP). Oryginały zostają w źródle.").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Dodaj zaznaczone (\(selected.count))") {
                    let chosen = selected.compactMap { id in photos.first { $0.id == id } }
                    dismiss()
                    onPick(source, chosen)
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(selected.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 940, height: 680)
        .onChange(of: source) { _, _ in selected = [] }
        .task(id: "\(source.rawValue)|\(query)") { await reload() }
    }

    private func tile(_ photo: PortfolioPhotoOption) -> some View {
        let active = selected.contains(photo.id)
        return Button {
            if active { selected.removeAll { $0 == photo.id } } else { selected.append(photo.id) }
        } label: {
            Color.clear.aspectRatio(1, contentMode: .fit)
                .overlay { SocialImageView(url: photo.thumbnailUrl) }
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(active ? theme.accent : Color.clear, lineWidth: 3))
                .overlay(alignment: .topTrailing) {
                    if active { Image(systemName: "checkmark.circle.fill").font(.title2).foregroundStyle(theme.accent).padding(4) }
                }
                .overlay(alignment: .bottom) {
                    Text(photo.name).font(.caption2).lineLimit(1).padding(.horizontal, 4).padding(.vertical, 2)
                        .frame(maxWidth: .infinity).background(Color.black.opacity(0.55)).foregroundStyle(.white)
                        .clipShape(UnevenRoundedRectangle(bottomLeadingRadius: 8, bottomTrailingRadius: 8))
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(photo.name)
    }

    private func reload() async {
        if source == .event && eventID == nil {
            photos = []; loading = false
            problem = "Powiąż realizację z eventem, żeby wybrać zdjęcia z jego plików."
            return
        }
        if source != .event && !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
        if Task.isCancelled { return }
        loading = true
        defer { loading = false }
        do {
            let reply = try await store.photos(source: source, eventID: eventID, query: query)
            if Task.isCancelled { return }
            photos = reply.photos
            problem = reply.problem ?? (reply.photos.isEmpty ? (source == .event ? "Event nie ma zdjęć w plikach (JPEG, PNG, WebP)." : "Brak zdjęć.") : nil)
        } catch {
            if Task.isCancelled { return }
            photos = []
            problem = store.failureText(error, "Nie udało się pobrać zdjęć.")
        }
    }
}

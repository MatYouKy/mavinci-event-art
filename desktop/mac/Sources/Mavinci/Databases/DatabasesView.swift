import SwiftUI

// MARK: Bazy Danych — 1:1 z `/crm/databases`: „Nowa Baza Danych”, wyszukiwanie po nazwie i opisie, kafelki baz
// (udostępnianie dla zarządzających, usuwanie dla administratora), okno udostępniania pracownikom. Kliknięcie otwiera
// arkusz bazy (`CustomDatabaseView`).

@MainActor struct CustomDatabasesView: View {
    @ObservedObject var store: CustomDatabasesStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var search = ""
    @State private var creating = false
    @State private var sharing: CustomDatabase?
    @State private var removing: CustomDatabase?

    private var canManage: Bool { store.access?.canManage ?? false }
    private var isAdmin: Bool { store.access?.isAdmin ?? false }
    private var visible: [CustomDatabase] {
        let query = search.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return store.list?.databases ?? [] }
        return (store.list?.databases ?? []).filter { $0.name.localizedCaseInsensitiveContains(query) || $0.description.localizedCaseInsensitiveContains(query) }
    }

    var body: some View {
        Group {
            if let id = store.openedID {
                CustomDatabaseView(store: store, databaseID: id).id(id)
            } else {
                list
            }
        }
        .task(id: state.employee?.id) { await store.load() }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if store.list != nil {
                    content
                } else if let error = store.listError {
                    ContentUnavailableView {
                        Label("Bazy Danych", systemImage: "cylinder.split.1x2")
                    } description: { Text(error) } actions: {
                        Button("Spróbuj ponownie") { Task { await store.load() } }
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    ProgressView("Ładowanie...").frame(maxWidth: .infinity).padding(40)
                }
            }
            .padding(16)
        }
        .navigationTitle("Bazy Danych")
        .navigationSubtitle(store.list.map { "Baz: \(visible.count) / \($0.databases.count)" } ?? "")
        .searchable(text: $search, placement: .toolbar, prompt: "Szukaj baz danych...")
        .sheet(isPresented: $creating) {
            CustomDatabaseCreateSheet(store: store)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $sharing) { database in
            CustomDatabaseShareSheet(store: store, database: database)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usunąć bazę danych?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let database = removing {
                Button("Usuń", role: .destructive) { Task { await store.remove("Usuwanie bazy danych…", id: database.id) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Czy na pewno chcesz usunąć bazę danych „\(removing?.name ?? "")”? Ta operacja jest nieodwracalna i usunie wszystkie dane.")
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Bazy Danych").font(.title2.weight(.light))
                Text("Zarządzaj własnymi bazami danych w formie arkusza").foregroundStyle(.secondary)
            }
            Spacer()
            if store.loading { ProgressView().controlSize(.small) }
            if canManage { WarehouseAddButton(title: "Nowa Baza Danych") { creating = true } }
        }
    }

    @ViewBuilder private var content: some View {
        if visible.isEmpty {
            ContentUnavailableView {
                Label(search.isEmpty ? "Brak baz danych" : "Nie znaleziono baz danych", systemImage: "cylinder.split.1x2")
            } description: {
                Text(!search.isEmpty ? "Spróbuj zmienić kryteria wyszukiwania"
                     : canManage ? "Utwórz swoją pierwszą bazę danych" : "Nie masz dostępu do żadnych baz danych")
            }
            .frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14)], spacing: 14) {
                ForEach(visible) { database in
                    CustomDatabaseTile(database: database, canShare: canManage || isAdmin, canDelete: isAdmin,
                                       open: { store.openedID = database.id }, share: { sharing = database }, remove: { removing = database })
                }
            }
        }
    }
}

/// Kafelek bazy: ikona, nazwa, opis, data utworzenia; udostępnianie i usuwanie.
@MainActor struct CustomDatabaseTile: View {
    let database: CustomDatabase
    let canShare: Bool
    let canDelete: Bool
    let open: () -> Void
    let share: () -> Void
    let remove: () -> Void
    @Environment(\.crmTheme) private var theme
    @State private var hover = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "cylinder.split.1x2").font(.title2).foregroundStyle(theme.accent)
                    .frame(width: 44, height: 44).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
                Spacer()
                if canShare {
                    Button(action: share) { Image(systemName: "person.2") }.buttonStyle(.borderless).help("Udostępnij bazę danych")
                }
                if canDelete {
                    Button(action: remove) { Image(systemName: "trash") }.buttonStyle(.borderless).foregroundStyle(.red).help("Usuń bazę danych")
                }
            }
            Text(database.name).font(.headline).lineLimit(2)
            if !database.description.isEmpty { Text(database.description).font(.callout).foregroundStyle(.secondary).lineLimit(3) }
            Spacer(minLength: 0)
            Text("Utworzono \(DayDates.display(database.createdAt))").font(.caption).foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 170, alignment: .topLeading)
        .background(hover ? theme.accent.opacity(0.08) : theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .contentShape(RoundedRectangle(cornerRadius: 12))
        .onHover { hover = $0 }
        .onTapGesture(perform: open)
        .contextMenu {
            Button("Otwórz", systemImage: "arrow.up.right.square", action: open)
            if canShare { Button("Udostępnij…", systemImage: "person.2", action: share) }
            if canDelete { Divider(); Button("Usuń bazę", systemImage: "trash", role: .destructive, action: remove) }
        }
    }
}

/// „Utwórz nową bazę danych”: nazwa i opis; po utworzeniu otwiera arkusz.
@MainActor struct CustomDatabaseCreateSheet: View {
    @ObservedObject var store: CustomDatabasesStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var details = ""
    @State private var busy = false

    var body: some View {
        FleetSheetFrame(title: "Utwórz nową bazę danych", subtitle: "Arkusz z własnymi kolumnami i rekordami", symbol: "cylinder.split.1x2",
                        submitTitle: "Utwórz", busy: busy, canSubmit: !name.trimmingCharacters(in: .whitespaces).isEmpty,
                        problem: nil, width: 520, height: 400) { create() } content: {
            Section {
                TextField("Nazwa", text: $name, prompt: Text("np. Kontakty, Produkty, Inwentarz..."))
                TextField("Opis (opcjonalny)", text: $details, prompt: Text("Krótki opis bazy danych..."), axis: .vertical).lineLimit(3...5)
            }
        }
    }

    private func create() {
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !busy, !title.isEmpty else { return }
        busy = true
        Task {
            let reply = await store.run("Tworzenie bazy danych…", "create", ["name": .string(title), "description": .string(details)], reload: nil)
            busy = false
            guard let id = reply?["id"]?.text.nonEmpty else { return }
            dismiss()
            store.openedID = id
        }
    }
}

/// „Udostępnij bazę danych”: komu udostępniono („Odbierz”) i komu można udostępnić.
@MainActor struct CustomDatabaseShareSheet: View {
    @ObservedObject var store: CustomDatabasesStore
    let database: CustomDatabase
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var data: CustomDatabaseShares?
    @State private var problem: String?
    @State private var revoking: CustomDatabaseShare?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "person.2").font(.title2).foregroundStyle(theme.accent)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Udostępnij bazę danych").font(.title3.weight(.semibold))
                    Text(database.name).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button { dismiss() } label: { Image(systemName: "xmark") }.buttonStyle(.borderless).keyboardShortcut(.cancelAction)
            }
            .padding(18)
            Divider()
            Group {
                if let data {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 18) {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Udostępniono dla:").font(.headline)
                                if data.shares.isEmpty {
                                    Text("Ta baza danych nie jest jeszcze nikomu udostępniona").foregroundStyle(.secondary)
                                }
                                ForEach(data.shares) { share in
                                    HStack(spacing: 10) {
                                        EmployeeAvatarView(name: share.employee.name, url: share.employee.avatarUrl, crop: share.employee.avatar, size: 40)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(share.employee.name)
                                            Text(share.canEdit ? "Może edytować dane" : "Tylko odczyt").font(.caption).foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Button("Odbierz", role: .destructive) { revoking = share }
                                    }
                                    .padding(10)
                                    .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
                                }
                            }
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Udostępnij pracownikowi:").font(.headline)
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 8)], spacing: 8) {
                                    ForEach(data.employees) { person in
                                        Button { Task { await share(person.id) } } label: {
                                            HStack(spacing: 10) {
                                                EmployeeAvatarView(name: person.name, url: person.avatarUrl, crop: person.avatar, size: 40)
                                                Text(person.name).lineLimit(1)
                                                Spacer()
                                                Image(systemName: "plus.circle").foregroundStyle(theme.accent)
                                            }
                                            .padding(8)
                                            .contentShape(Rectangle())
                                        }
                                        .buttonStyle(.plain)
                                        .background(theme.card.opacity(0.9), in: RoundedRectangle(cornerRadius: 8))
                                    }
                                }
                            }
                        }
                        .padding(18)
                    }
                } else if let problem {
                    ContentUnavailableView("Udostępnianie", systemImage: "exclamationmark.triangle", description: Text(problem))
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(width: 640, height: 600)
        .background(theme.page)
        .task { await load() }
        .confirmationDialog("Odebrać dostęp?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
            if let share = revoking {
                Button("Odbierz", role: .destructive) { Task { await revoke(share) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy na pewno chcesz odebrać dostęp do bazy danych?") }
    }

    private func load() async {
        do { data = try await store.shares(database.id); problem = nil }
        catch { problem = store.failureText(error, "Błąd podczas ładowania danych udostępniania") }
    }

    private func share(_ employeeID: String) async {
        if await store.run("Udostępnianie…", "share", ["databaseId": .string(database.id), "employeeId": .string(employeeID)], reload: nil) != nil {
            await load()
        }
    }

    private func revoke(_ share: CustomDatabaseShare) async {
        if await store.run("Odbieranie dostępu…", "revoke", ["databaseId": .string(database.id), "employeeId": .string(share.employeeId)], reload: nil) != nil {
            await load()
        }
    }
}

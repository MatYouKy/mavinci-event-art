import SwiftUI

// MARK: Sale i informacje techniczne jednej lokalizacji jako sekcja innego ekranu — 1:1 z `LocationRooms` i
// `LocationTechnicalDetails` osadzonymi w CRM poza kartą lokalizacji (karta organizacji → „Sale i przestrzenie”, podgląd brandingu
// sprzedawcy → baza hotelu). Te same dane, zapisy i arkusze co karta lokalizacji (`LocationDetailView`, `LocationsStore`);
// `readOnly` — tylko podgląd (bez uprawnienia do zarządzania lokalizacjami albo gdy CRM pokazuje podgląd).

@MainActor struct LocationSpacesPanel: View {
    @ObservedObject var store: LocationsStore
    let locationID: String
    var readOnly = false
    @EnvironmentObject private var state: Workspace
    @State private var editingTechnical = false
    @State private var editingRoom: LocationRoomTarget?
    @State private var removingRoom: CrmLocationRoom?

    private var detail: CrmLocationDetail? { store.details[locationID] }
    private var canManage: Bool { !readOnly && (detail?.access.canManage ?? false) }

    var body: some View {
        Group {
            if let detail {
                VStack(alignment: .leading, spacing: 16) {
                    rooms(detail)
                    technical(detail)
                }
            } else if let error = store.detailErrors[locationID] {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    Button("Spróbuj ponownie") { Task { await store.loadDetail(locationID) } }
                }
            } else {
                ProgressView("Wczytywanie sal i informacji o obiekcie…").frame(maxWidth: .infinity).padding(.vertical, 20)
            }
        }
        .task(id: "\(locationID)|\(state.employee?.id ?? "")") { await store.loadDetail(locationID) }
        .sheet(isPresented: $editingTechnical) {
            if let detail {
                LocationTechnicalEditorSheet(store: store, locationID: locationID, roomID: nil, room: nil, initial: detail.technical)
                    .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
            }
        }
        .sheet(item: $editingRoom) { target in
            LocationTechnicalEditorSheet(store: store, locationID: locationID, roomID: target.id, room: target.room, initial: target.room?.technical ?? [:])
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń salę", isPresented: Binding(get: { removingRoom != nil }, set: { if !$0 { removingRoom = nil } }), titleVisibility: .visible) {
            if let room = removingRoom {
                Button("Usuń salę", role: .destructive) {
                    Task { await store.run("Usuwanie sali…", "roomDelete", ["id": .string(locationID), "roomId": .string(room.id)], reload: locationID) }
                }
                Button("Anuluj", role: .cancel) {}
            }
        } message: { Text("Czy usunąć salę „\(removingRoom?.name ?? "")”? Sali przypisanej do wydarzenia nie można usunąć.") }
    }

    private func rooms(_ detail: CrmLocationDetail) -> some View {
        LocationPanel(title: "Sale i przestrzenie zewnętrzne", symbol: "square.split.2x2") {
            VStack(alignment: .leading, spacing: 10) {
                Text("Dodaj sale oraz tereny na zewnątrz, np. ogród lub miejsce teambuildingu. Ta sama baza jest dostępna w wydarzeniach i ofertach sprzedawcy hotelowego.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if detail.rooms.isEmpty {
                    Text("Nie dodano jeszcze pomieszczeń.").foregroundStyle(.secondary).padding(.vertical, 8)
                } else {
                    HStack {
                        Text("Przestrzeń").frame(maxWidth: .infinity, alignment: .leading)
                        Text("Wejście / piętro").frame(width: 220, alignment: .leading)
                        Text("Materiały").frame(width: 80, alignment: .leading)
                        if canManage { Color.clear.frame(width: 30, height: 1) }
                    }
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(detail.rooms) { room in roomRow(room, urls: detail.urls) }
                }
            }
        } trailing: {
            if canManage {
                Button("Dodaj przestrzeń", systemImage: "plus") { editingRoom = LocationRoomTarget(id: UUID().uuidString.lowercased(), room: nil) }
                    .buttonStyle(.borderedProminent).controlSize(.small).disabled(detail.rooms.count >= 100)
            }
        }
    }

    private func roomRow(_ room: CrmLocationRoom, urls: [String: String]) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(room.name).fontWeight(.semibold)
                if room.isOutdoor { Text("Teren na zewnątrz").font(.caption).foregroundStyle(.secondary) }
                DisclosureGroup("Szczegóły i materiały") {
                    LocationTechnicalView(value: room.technical, urls: urls).padding(.top, 6)
                }
                .font(.callout)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(room.notes.nonEmpty ?? "—").foregroundStyle(.secondary).frame(width: 220, alignment: .leading)
            Text(verbatim: "\(room.assetCount)").frame(width: 80, alignment: .leading)
            if canManage {
                Menu {
                    Button("Edytuj", systemImage: "pencil") { editingRoom = LocationRoomTarget(id: room.id, room: room) }
                    Button("Usuń", systemImage: "trash", role: .destructive) { removingRoom = room }
                } label: { Image(systemName: "ellipsis") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 30)
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
    }

    private func technical(_ detail: CrmLocationDetail) -> some View {
        LocationPanel(title: "Informacje techniczne obiektu", symbol: "bolt") {
            LocationTechnicalView(value: detail.technical, urls: detail.urls).frame(maxWidth: .infinity, alignment: .leading)
        } trailing: {
            if canManage {
                Button("Edytuj informacje i materiały", systemImage: "pencil") { editingTechnical = true }.controlSize(.small)
            }
        }
    }
}

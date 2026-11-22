import AppKit
import SwiftUI
import UniformTypeIdentifiers

// MARK: Profil pracownika → Dokumenty — 1:1 z `EmployeeDocumentsTab.tsx` (CRM)
//
// Dokumenty z Dysku → Pracownicy → pracownik → Dokumenty (`/bridge/native/v1/drive`, folder `employees:<id>:documents`) — ten sam
// folder w CRM, w Finderze i w telefonie. Widzi i dodaje sam pracownik, administrator i „Pracownicy — zarządzanie”; usuwa
// administrator, „Pracownicy — zarządzanie” i autor dokumentu (decyduje baza). Podgląd — Quick Look, pobranie do „Pobrane”,
// przeciągnięcie do Findera.

@MainActor struct EmployeeDocumentsView: View {
    @ObservedObject var drive: DriveStore
    let employeeID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var adding = false
    @State private var removing: DriveFile?
    @State private var preview: URL?

    private var node: String { DriveStore.documentsNode(employeeID) }
    private var listing: DriveListing? { drive.listings[node] }
    private var canUpload: Bool { listing?.canUpload == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "doc").foregroundStyle(theme.accent)
                Text("Dokumenty").font(.title3.weight(.light))
                Spacer(minLength: 8)
                if drive.listLoading.contains(node) { ProgressView().controlSize(.small) }
                Button { Task { await drive.loadListing(node, expandPath: false) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
                    .buttonStyle(.borderless)
                if canUpload {
                    Button { adding = true } label: { Label("Dodaj dokument", systemImage: "plus") }
                        .buttonStyle(.borderedProminent).disabled(drive.uploading)
                }
            }
            content
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(theme.card.opacity(theme == .light ? 1 : 0.9), in: RoundedRectangle(cornerRadius: 12))
        .quickLookPreview($preview)
        .task(id: employeeID) { await drive.loadListing(node, quiet: drive.listings[node] != nil, expandPath: false) }
        .sheet(isPresented: $adding) {
            AddEmployeeDocumentSheet(drive: drive, employeeID: employeeID)
                .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .confirmationDialog("Usuń dokument", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            if let file = removing {
                Button("Usuń", role: .destructive) { Task { await drive.deleteDocument(file, employeeID: employeeID) } }
                Button("Anuluj", role: .cancel) {}
            }
        } message: {
            Text("Usunąć dokument „\(removing?.name ?? "")”? Plik zniknie także z Dysku, Findera i telefonu.")
        }
    }

    @ViewBuilder private var content: some View {
        if let listing {
            if listing.files.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "doc").font(.system(size: 36)).foregroundStyle(.tertiary)
                    Text("Brak dokumentów").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                VStack(spacing: 0) {
                    ForEach(listing.files) { file in
                        row(file)
                        if file.id != listing.files.last?.id { Divider() }
                    }
                }
            }
        } else if let error = drive.listErrors[node] {
            VStack(spacing: 10) {
                Text(error).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Button("Spróbuj ponownie") { Task { await drive.loadListing(node, expandPath: false) } }
            }
            .frame(maxWidth: .infinity).padding(.vertical, 24)
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30)
        }
    }

    private func row(_ file: DriveFile) -> some View {
        let expired = file.detail.contains("termin minął")
        return HStack(spacing: 10) {
            DriveFileThumb(file: file, side: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.name).lineLimit(1)
                Text(DriveText.caption(file)).font(.caption).lineLimit(1)
                    .foregroundStyle(expired ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
            }
            Spacer(minLength: 8)
            Button { Task { preview = await drive.previewFile(file) } } label: { Image(systemName: "eye") }
                .buttonStyle(.borderless).help("Podgląd")
            Button { Task { await drive.downloadToDownloads(file) } } label: { Image(systemName: "arrow.down.circle") }
                .buttonStyle(.borderless).help("Pobierz")
            if canUpload {
                Button { removing = file } label: { Image(systemName: "trash").foregroundStyle(.red) }
                    .buttonStyle(.borderless).help("Usuń")
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { Task { preview = await drive.previewFile(file) } }
        .onDrag { drive.dragProvider(file) }
        .help(file.detail)
    }
}

/// Nowy dokument pracownika: plik (do 50 MB), nazwa, rodzaj, termin ważności i opis — jak „Dodaj dokument” w CRM.
@MainActor struct AddEmployeeDocumentSheet: View {
    @ObservedObject var drive: DriveStore
    let employeeID: String
    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var title = ""
    @State private var type: EmployeeDocumentType = .other
    @State private var details = ""
    @State private var hasExpiry = false
    @State private var expiry = Date()
    @State private var saving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Dodaj dokument").font(.title2.weight(.light))
            Form {
                LabeledContent("Plik") {
                    HStack(spacing: 8) {
                        Text(file?.lastPathComponent ?? "Nie wybrano pliku").lineLimit(1)
                            .foregroundStyle(file == nil ? Color.secondary : Color.primary)
                        Button("Wybierz…") { choose() }
                    }
                }
                TextField("Nazwa dokumentu", text: $title, prompt: Text("np. Badania okresowe 2026"))
                Picker("Rodzaj", selection: $type) {
                    ForEach(EmployeeDocumentType.allCases) { entry in Text(entry.label).tag(entry) }
                }
                Toggle("Termin ważności", isOn: $hasExpiry)
                if hasExpiry { DatePicker("Ważny do", selection: $expiry, displayedComponents: .date) }
                TextField("Opis", text: $details, prompt: Text("Dodatkowe informacje…"), axis: .vertical).lineLimit(3...6)
            }
            .formStyle(.grouped)
            HStack {
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button("Dodaj") { save() }.keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent).disabled(file == nil || saving)
            }
        }
        .padding(20)
        .frame(width: 500)
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.prompt = "Wybierz"
        panel.message = "Dokument pracownika — plik do 50 MB."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        file = url
        if title.trimmingCharacters(in: .whitespaces).isEmpty { title = String(url.deletingPathExtension().lastPathComponent.prefix(200)) }
    }

    private func save() {
        guard let file, !saving else { return }
        saving = true
        Task {
            let added = await drive.uploadDocument(file, employeeID: employeeID, title: String(title.prefix(200)), type: type,
                                                   description: String(details.prefix(2000)), expiry: hasExpiry ? expiry : nil)
            saving = false
            if added { dismiss() }
        }
    }
}

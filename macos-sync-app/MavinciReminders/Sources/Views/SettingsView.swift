import SwiftUI
import ServiceManagement
import EventKit

@MainActor
struct SettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel
    var body: some View {
        TabView {
            ScrollView { GeneralTab(viewModel: viewModel) }.tabItem { Label("Ogólne", systemImage: "gear") }
            ScrollView { ConnectionTab(viewModel: viewModel) }.tabItem { Label("Połączenie", systemImage: "network") }
            FolderSyncSettingsView().tabItem { Label("Pliki", systemImage: "folder") }
        }.frame(width: 660, height: 580)
    }
}

@MainActor
struct GeneralTab: View {
    @ObservedObject var viewModel: SettingsViewModel
    @ObservedObject private var sync = SyncManager.shared
    @ObservedObject private var login = LoginItemManager.shared
    @AppStorage("syncIntervalMinutes") private var minutes = 5
    @AppStorage("selectedRemindersListName") private var listName = "Mavinci CRM"
    @AppStorage("keepOnlyActiveCRMTasks") private var keepOnlyActive = true
    @State private var showLists = false
    @State private var lists: [ReminderListChoice] = []
    @State private var listError: String?
    var body: some View {
        Form {
            Toggle("Uruchamiaj przy logowaniu do macOS", isOn: Binding(
                get: { login.enabled }, set: { login.setEnabled($0) }))
            Text(login.message).font(.caption).foregroundStyle(.secondary)
            Button("Otwórz ustawienia autostartu") { login.openSettings() }
            Picker("Synchronizacja co:", selection: $minutes) {
                ForEach([1, 2, 5, 10, 15, 30], id: \.self) { Text("\($0) min").tag($0) }
            }.onChange(of: minutes) { value in sync.startPeriodicSync(interval: TimeInterval(value * 60)) }
            HStack {
                Text("Lista przypomnień: \(listName)")
                Button("Zmień…") {
                    Task {
                        do {
                            lists = try await sync.loadReminderLists()
                            listError = nil
                            showLists = true
                        } catch { listError = error.localizedDescription }
                    }
                }.disabled(sync.isSyncing)
            }
            if let listError { Text(listError).font(.caption).foregroundStyle(.red) }
            Button("Odbuduj powiązania bez tworzenia kopii") { sync.resetMapping() }.disabled(sync.isSyncing)
            Toggle("Na głównej liście tylko moje aktywne zadania", isOn: $keepOnlyActive)
                .disabled(sync.isSyncing)
                .onChange(of: keepOnlyActive) { _ in Task { await sync.syncNow() } }
            Text("Zakończone i wcześniejsze zadania CRM spoza zakresu przenosimy do listy Archiwum Mavinci, bez kasowania i bez oznaczania ich jako wykonane. Ponownie aktywne zadanie wraca na główną listę. Ręczne przypomnienia i niewysłane zmiany pozostają nietknięte.")
                .font(.caption).foregroundStyle(.secondary)
            if !sync.archiveSummary.isEmpty { Text(sync.archiveSummary).font(.caption) }
            if let date = sync.lastSyncDate { Text("Ostatnia synchronizacja: \(date.formatted())") }
            if let error = sync.lastError { Text(error).foregroundStyle(.red).font(.caption).textSelection(.enabled) }
        }
        .padding()
        .onAppear { login.refresh() }
        .sheet(isPresented: $showLists) { ListPickerSheet(availableLists: lists, isPresented: $showLists) }
    }
}

// MARK: - List Picker Sheet

@available(macOS 13.0, *)
struct ListPickerSheet: View {
    @State var availableLists: [ReminderListChoice]
    @Binding var isPresented: Bool

    @State private var selection: String = ""
    @State private var newListName: String = ""
    @State private var isCreatingNew: Bool = false
    @State private var isWorking = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 16) {
            Text("Wybierz listę Przypomnień")
                .font(.headline)

            if availableLists.isEmpty {
                Text(RemindersError.noLists.localizedDescription)
                    .foregroundColor(.secondary)
                    .font(.caption)
            } else {
                List(availableLists, selection: $selection) { list in
                    HStack {
                        Image(systemName: "list.bullet")
                        VStack(alignment: .leading) {
                            Text(list.title)
                            Text(list.account).font(.caption).foregroundStyle(.secondary)
                        }
                        if list.id == UserDefaults.standard.string(forKey: "com.mavinci.reminders.listIdentifier") {
                            Spacer()
                            Image(systemName: "checkmark")
                                .foregroundColor(.accentColor)
                        }
                    }
                    .tag(list.id)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        selection = list.id
                    }
                }
                .frame(height: 150)
            }

            Divider()

            // Create new list option
            HStack {
                Toggle("Utwórz nową listę:", isOn: $isCreatingNew)
                TextField("Nazwa listy", text: $newListName)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!isCreatingNew)
                    .frame(maxWidth: 200)
            }

            HStack {
                Button("Anuluj") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Wybierz") {
                    isWorking = true
                    Task {
                        defer { isWorking = false }
                        do {
                            try await SyncManager.shared.chooseReminderList(
                                identifier: isCreatingNew ? nil : selection,
                                newName: isCreatingNew ? newListName : nil)
                            isPresented = false
                            await SyncManager.shared.syncNow()
                        } catch { errorMessage = error.localizedDescription }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(isCreatingNew ? newListName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : !availableLists.contains(where: { $0.id == selection }))
            }
            Button("Odśwież listy") {
                isWorking = true
                Task {
                    defer { isWorking = false }
                    do {
                        availableLists = try await SyncManager.shared.loadReminderLists()
                        errorMessage = nil
                    } catch { errorMessage = error.localizedDescription }
                }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red).font(.caption) }
            if isWorking { ProgressView() }
        }
        .disabled(isWorking)
        .padding()
        .frame(width: 460, height: 450)
        .onAppear {
            selection = UserDefaults.standard.string(forKey: "com.mavinci.reminders.listIdentifier") ?? ""
        }
    }
}

// MARK: - Connection Tab

@available(macOS 13.0, *)
@MainActor
struct ConnectionTab: View {
    @ObservedObject var viewModel: SettingsViewModel

    @AppStorage("crm_base_url") private var crmBaseURL: String = ""
    @State private var tokenInput: String = ""
    @State private var hasStoredToken: Bool = false
    @State private var urlValidationError: String? = nil

    // Connection test state
    @State private var isTesting: Bool = false
    @State private var connectionResult: ConnectionTestResult? = nil

    var body: some View {
        Form {
            // CRM Base URL
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("CRM Base URL")
                        .font(.headline)

                    TextField("https://yourapp.com", text: $crmBaseURL)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: crmBaseURL) { newValue in
                            validateURL(newValue)
                        }

                    if let error = urlValidationError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundColor(.orange)
                    } else if !crmBaseURL.isEmpty {
                        Label("URL looks good", systemImage: "checkmark.circle.fill")
                            .font(.caption)
                            .foregroundColor(.green)
                    }
                }
            }

            Divider()

            // Token
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Sync Token")
                        .font(.headline)

                    HStack {
                        SecureField("Paste token here…", text: $tokenInput)
                            .textFieldStyle(.roundedBorder)

                        Button("Save") {
                            saveToken()
                        }
                        .disabled(tokenInput.isEmpty)

                        Button {
                            pasteFromClipboard()
                        } label: {
                            Image(systemName: "doc.on.clipboard")
                        }
                        .help("Paste from Clipboard")
                    }

                    // Status indicator
                    HStack(spacing: 4) {
                        if hasStoredToken {
                            Image(systemName: "checkmark.shield.fill")
                                .foregroundColor(.green)
                            Text("Token stored in Keychain")
                                .font(.caption)
                                .foregroundColor(.green)
                        } else {
                            Image(systemName: "xmark.shield.fill")
                                .foregroundColor(.red)
                            Text("No token stored")
                                .font(.caption)
                                .foregroundColor(.red)
                        }
                    }
                }
            }

            Divider()

            // Test Connection
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Button("Test Connection") {
                            testConnection()
                        }
                        .disabled(isTesting || crmBaseURL.isEmpty || !hasStoredToken)

                        if isTesting {
                            ProgressView()
                                .controlSize(.small)
                                .padding(.leading, 4)
                        }
                    }

                    if let result = connectionResult {
                        connectionResultView(result)
                    }
                }
            }

            Divider()

            // Generate New Token Info
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Generate New Token", systemImage: "key.fill")
                        .font(.subheadline)
                        .fontWeight(.medium)

                    Text("To generate a new sync token, go to your Mavinci CRM settings → Integrations → macOS Reminders Sync and click \"Generate Token\".")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding()
        .onAppear {
            checkStoredToken()
        }
    }

    // MARK: - Connection Result View

    @ViewBuilder
    private func connectionResultView(_ result: ConnectionTestResult) -> some View {
        HStack(spacing: 6) {
            switch result {
            case .success(let taskCount, let closedTaskCount, let employeeName):
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                Text("Konto: \(employeeName). Moje zadania: \(taskCount) aktywnych, \(closedTaskCount) zakończonych lub anulowanych. Bez zadań wydarzeń i zapytań.")
                    .font(.caption)
                    .foregroundColor(.green)

            case .failure(let errorMessage):
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.red)
                Text(errorMessage)
                    .font(.caption)
                    .foregroundColor(.red)
                    .lineLimit(3)
            }
        }
    }

    // MARK: - Actions

    private func validateURL(_ url: String) {
        if url.isEmpty {
            urlValidationError = nil
            return
        }

        if !url.lowercased().hasPrefix("https://") {
            urlValidationError = "URL must start with https://"
        } else if URL(string: url) == nil {
            urlValidationError = "Invalid URL format"
        } else {
            urlValidationError = nil
        }
    }

    private func saveToken() {
        let trimmedToken = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedToken.isEmpty else { return }

        let success = KeychainService.shared.save(token: trimmedToken)
        if success {
            hasStoredToken = true
            tokenInput = ""
            print("[SettingsView] Token saved to Keychain")
        } else {
            print("[SettingsView] Failed to save token to Keychain")
        }
    }

    private func pasteFromClipboard() {
        if let pasteboardString = NSPasteboard.general.string(forType: .string) {
            tokenInput = pasteboardString.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    private func checkStoredToken() {
        hasStoredToken = KeychainService.shared.loadToken() != nil
    }

    private func testConnection() {
        isTesting = true
        connectionResult = nil

        Task {
            do {
                let result = try await CRMAPIClient.shared.testConnection()
                await MainActor.run {
                    connectionResult = .success(taskCount: result.taskCount, closedTaskCount: result.closedTaskCount, employeeName: result.employeeName)
                    isTesting = false
                }
            } catch {
                await MainActor.run {
                    connectionResult = .failure(errorMessage: error.localizedDescription)
                    isTesting = false
                }
            }
        }
    }
}

// MARK: - Connection Test Result

enum ConnectionTestResult {
    case success(taskCount: Int, closedTaskCount: Int, employeeName: String)
    case failure(errorMessage: String)
}

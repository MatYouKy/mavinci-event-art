import SwiftUI
import ServiceManagement
import EventKit

// MARK: - Settings View

/// The main Settings window with two tabs: General and Connection.
/// Replaces the placeholder SettingsView in MavinciRemindersApp.swift.
@available(macOS 13.0, *)
struct SettingsView: View {
    @ObservedObject var viewModel: SettingsViewModel

    var body: some View {
        TabView {
            GeneralTab(viewModel: viewModel)
                .tabItem {
                    Label("General", systemImage: "gear")
                }

            ConnectionTab(viewModel: viewModel)
                .tabItem {
                    Label("Connection", systemImage: "network")
                }
        }
        .frame(width: 520, height: 420)
    }
}

// MARK: - General Tab

@available(macOS 13.0, *)
struct GeneralTab: View {
    @ObservedObject var viewModel: SettingsViewModel
    @ObservedObject private var syncManager = SyncManager.shared

    @AppStorage("launchAtLogin") private var launchAtLogin: Bool = false
    @AppStorage("syncIntervalMinutes") private var syncIntervalMinutes: Int = 5
    @AppStorage("showErrorNotifications") private var showErrorNotifications: Bool = true
    @AppStorage("selectedRemindersListName") private var selectedRemindersListName: String = "Mavinci CRM"

    @State private var showingListPicker = false
    @State private var showingResetConfirmation = false
    @State private var availableLists: [String] = []

    private let syncIntervalOptions: [(label: String, value: Int)] = [
        ("1 min", 1),
        ("2 min", 2),
        ("5 min", 5),
        ("10 min", 10),
        ("15 min", 15),
        ("30 min", 30)
    ]

    var body: some View {
        Form {
            // Launch at Login
            Section {
                Toggle("Launch at login", isOn: $launchAtLogin)
                    .onChange(of: launchAtLogin) { newValue in
                        updateLoginItem(enabled: newValue)
                    }
            }

            // Sync Interval
            Section {
                Picker("Sync interval:", selection: $syncIntervalMinutes) {
                    ForEach(syncIntervalOptions, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: 200)
            }

            // Notifications
            Section {
                Toggle("Show notifications on errors", isOn: $showErrorNotifications)
            }

            // Reminders List
            Section {
                HStack {
                    Text("Reminders list:")
                        .foregroundColor(.secondary)
                    Text(selectedRemindersListName)
                        .fontWeight(.medium)
                    Spacer()
                    Button("Change List…") {
                        loadAvailableLists()
                        showingListPicker = true
                    }
                }
            }

            // Reset Sync Mapping
            Section {
                HStack {
                    Button("Reset Sync Mapping") {
                        showingResetConfirmation = true
                    }
                    .foregroundColor(.red)

                    Text("Clears all task↔reminder associations")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Divider()

            // Status Info
            Section {
                HStack {
                    Text("Last sync:")
                        .foregroundColor(.secondary)
                    if let lastSync = syncManager.lastSyncDate {
                        Text(lastSync, style: .relative)
                        Text("(\(lastSync, formatter: Self.dateFormatter))")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        Text("Never")
                            .foregroundColor(.secondary)
                    }
                }

                if syncManager.errorCount > 0 {
                    HStack {
                        Text("Last error:")
                            .foregroundColor(.secondary)
                        Text("\(syncManager.errorCount) error(s) during last sync")
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
        }
        .padding()
        .sheet(isPresented: $showingListPicker) {
            ListPickerSheet(
                availableLists: availableLists,
                selectedListName: $selectedRemindersListName,
                isPresented: $showingListPicker
            )
        }
        .alert("Reset Sync Mapping?", isPresented: $showingResetConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) {
                resetSyncMapping()
            }
        } message: {
            Text("This will clear all task↔reminder associations. The next sync will recreate reminders from scratch. Existing reminders will not be deleted.")
        }
    }

    // MARK: - Helpers

    private func updateLoginItem(enabled: Bool) {
        let service = SMAppService.mainApp
        do {
            if enabled {
                try service.register()
            } else {
                try service.unregister()
            }
        } catch {
            print("[SettingsView] Failed to update login item: \(error.localizedDescription)")
        }
    }

    private func loadAvailableLists() {
        let store = EKEventStore()
        let calendars = store.calendars(for: .reminder)
        availableLists = calendars.map { $0.title }
    }

    private func resetSyncMapping() {
        // Reset the persisted sync state
        var state = SyncState()
        state.save()
        print("[SettingsView] Sync mapping reset")
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()
}

// MARK: - List Picker Sheet

@available(macOS 13.0, *)
struct ListPickerSheet: View {
    let availableLists: [String]
    @Binding var selectedListName: String
    @Binding var isPresented: Bool

    @State private var selection: String = ""
    @State private var newListName: String = ""
    @State private var isCreatingNew: Bool = false

    var body: some View {
        VStack(spacing: 16) {
            Text("Choose Reminders List")
                .font(.headline)

            if availableLists.isEmpty {
                Text("No reminders lists found. Create a new one below.")
                    .foregroundColor(.secondary)
                    .font(.caption)
            } else {
                List(availableLists, id: \.self, selection: $selection) { listName in
                    HStack {
                        Image(systemName: "list.bullet")
                        Text(listName)
                        if listName == selectedListName {
                            Spacer()
                            Image(systemName: "checkmark")
                                .foregroundColor(.accentColor)
                        }
                    }
                    .tag(listName)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        selection = listName
                    }
                }
                .frame(height: 150)
            }

            Divider()

            // Create new list option
            HStack {
                Toggle("Create new list:", isOn: $isCreatingNew)
                TextField("List name", text: $newListName)
                    .textFieldStyle(.roundedBorder)
                    .disabled(!isCreatingNew)
                    .frame(maxWidth: 200)
            }

            HStack {
                Button("Cancel") {
                    isPresented = false
                }
                .keyboardShortcut(.cancelAction)

                Spacer()

                Button("Select") {
                    if isCreatingNew && !newListName.isEmpty {
                        selectedListName = newListName
                        createNewRemindersList(name: newListName)
                    } else if !selection.isEmpty {
                        selectedListName = selection
                    }
                    isPresented = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(!isCreatingNew && selection.isEmpty)
            }
        }
        .padding()
        .frame(width: 380, height: 320)
        .onAppear {
            selection = selectedListName
        }
    }

    private func createNewRemindersList(name: String) {
        let service = RemindersService(targetListName: name)
        _ = service.getOrCreateList(name: name)
    }
}

// MARK: - Connection Tab

@available(macOS 13.0, *)
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
            case .success(let taskCount, let employeeName):
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.green)
                Text("Connected! Found \(taskCount) tasks for \(employeeName)")
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
                    connectionResult = .success(taskCount: result.taskCount, employeeName: result.employeeName)
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
    case success(taskCount: Int, employeeName: String)
    case failure(errorMessage: String)
}

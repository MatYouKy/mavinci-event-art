import SwiftUI
import EventKit
import ServiceManagement

// MARK: - Onboarding View

/// A step-based first-run setup flow shown when no token is configured.
/// Guides the user through granting permissions, entering CRM credentials,
/// choosing a reminders list, and running the first sync.
@available(macOS 13.0, *)
struct OnboardingView: View {
    @ObservedObject private var syncManager = SyncManager.shared

    @State private var currentStep: OnboardingStep = .welcome
    @State private var remindersAccessGranted: Bool = false
    @State private var crmBaseURL: String = ""
    @State private var tokenInput: String = ""
    @State private var isTesting: Bool = false
    @State private var connectionTestPassed: Bool = false
    @State private var connectionError: String? = nil
    @State private var employeeName: String = ""
    @State private var taskCount: Int = 0
    @State private var selectedListName: String = "Mavinci CRM"
    @State private var newListName: String = ""
    @State private var useExistingList: Bool = true
    @State private var availableLists: [String] = []
    @State private var firstSyncCompleted: Bool = false
    @State private var firstSyncCount: Int = 0
    @State private var isSyncing: Bool = false
    @State private var syncError: String? = nil

    /// Closure invoked when onboarding completes to dismiss the window and start background sync.
    var onComplete: (() -> Void)?

    var body: some View {
        VStack(spacing: 0) {
            // Progress indicator
            progressBar
                .padding(.horizontal, 32)
                .padding(.top, 20)

            Divider()
                .padding(.top, 12)

            // Step content
            ScrollView {
                stepContent
                    .padding(32)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Divider()

            // Navigation buttons
            navigationBar
                .padding(16)
        }
        .frame(width: 560, height: 480)
    }

    // MARK: - Progress Bar

    private var progressBar: some View {
        HStack(spacing: 4) {
            ForEach(OnboardingStep.allCases, id: \.self) { step in
                RoundedRectangle(cornerRadius: 2)
                    .fill(step.rawValue <= currentStep.rawValue ? Color.accentColor : Color.secondary.opacity(0.3))
                    .frame(height: 4)
            }
        }
    }

    // MARK: - Step Content

    @ViewBuilder
    private var stepContent: some View {
        switch currentStep {
        case .welcome:
            welcomeStep
        case .remindersPermission:
            remindersPermissionStep
        case .credentials:
            credentialsStep
        case .testConnection:
            testConnectionStep
        case .chooseList:
            chooseListStep
        case .firstSync:
            firstSyncStep
        case .done:
            doneStep
        }
    }

    // MARK: - Step 1: Welcome

    private var welcomeStep: some View {
        VStack(spacing: 20) {
            Spacer().frame(height: 20)

            Image(systemName: "checkmark.circle.fill")
                .resizable()
                .frame(width: 64, height: 64)
                .foregroundColor(.accentColor)

            Text("Mavinci CRM Reminders")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Synchronizuj zadania Mavinci CRM z Apple Reminders")
                .font(.title3)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 12)

            VStack(alignment: .leading, spacing: 12) {
                featureRow(icon: "arrow.triangle.2.circlepath", text: "Automatyczna synchronizacja zadań z CRM")
                featureRow(icon: "bell.fill", text: "Przypomnienia z terminami i priorytetami")
                featureRow(icon: "checkmark.square.fill", text: "Oznaczanie zadań jako ukończone synchronizuje się z CRM")
                featureRow(icon: "menubar.rectangle", text: "Działa cicho w pasku menu")
            }
            .padding(.horizontal, 20)
        }
        .frame(maxWidth: .infinity)
    }

    private func featureRow(icon: String, text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundColor(.accentColor)
                .frame(width: 24)
            Text(text)
                .font(.body)
        }
    }

    // MARK: - Step 2: Reminders Permission

    private var remindersPermissionStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "list.bullet.rectangle.portrait")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 48, height: 48)
                .foregroundColor(.accentColor)

            Text("Dostęp do Przypomnień")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Aplikacja potrzebuje dostępu do Apple Reminders, aby tworzyć i synchronizować zadania.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 8)

            if remindersAccessGranted {
                Label("Dostęp przyznany", systemImage: "checkmark.circle.fill")
                    .foregroundColor(.green)
                    .font(.headline)
            } else {
                Button("Przyznaj dostęp do Przypomnień") {
                    requestRemindersAccess()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }

            Text("Możesz zmienić to uprawnienie w Preferencjach Systemowych → Prywatność i bezpieczeństwo → Przypomnienia")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Step 3: Credentials

    private var credentialsStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Połączenie z CRM")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Wprowadź adres URL swojego CRM oraz token synchronizacji.")
                .font(.body)
                .foregroundColor(.secondary)

            // CRM URL
            VStack(alignment: .leading, spacing: 6) {
                Text("Adres CRM (URL)")
                    .font(.subheadline)
                    .fontWeight(.medium)

                TextField("https://yourapp.com", text: $crmBaseURL)
                    .textFieldStyle(.roundedBorder)

                if !crmBaseURL.isEmpty && !crmBaseURL.lowercased().hasPrefix("https://") {
                    Label("URL musi zaczynać się od https://", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
            }

            // Token
            VStack(alignment: .leading, spacing: 6) {
                Text("Token synchronizacji")
                    .font(.subheadline)
                    .fontWeight(.medium)

                HStack {
                    SecureField("Wklej token tutaj…", text: $tokenInput)
                        .textFieldStyle(.roundedBorder)

                    Button {
                        if let pasteboardString = NSPasteboard.general.string(forType: .string) {
                            tokenInput = pasteboardString.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                    } label: {
                        Image(systemName: "doc.on.clipboard")
                    }
                    .help("Wklej ze schowka")
                }

                Text("Token znajdziesz w ustawieniach CRM → Integracje → macOS Reminders Sync")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    // MARK: - Step 4: Test Connection

    private var testConnectionStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "network")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 48, height: 48)
                .foregroundColor(.accentColor)

            Text("Test połączenia")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Sprawdźmy, czy połączenie z CRM działa poprawnie.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 8)

            if connectionTestPassed {
                VStack(spacing: 8) {
                    Label("Połączono!", systemImage: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.headline)

                    Text("Znaleziono \(taskCount) zadań dla: \(employeeName)")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
            } else if let error = connectionError {
                VStack(spacing: 8) {
                    Label("Błąd połączenia", systemImage: "xmark.circle.fill")
                        .foregroundColor(.red)
                        .font(.headline)

                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    Button("Spróbuj ponownie") {
                        performConnectionTest()
                    }
                    .padding(.top, 8)
                }
            } else if isTesting {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)
                    Text("Łączenie z CRM…")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
            } else {
                Button("Testuj połączenie") {
                    performConnectionTest()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Step 5: Choose List

    private var chooseListStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Wybierz listę przypomnień")
                .font(.title2)
                .fontWeight(.semibold)

            Text("Zadania będą synchronizowane do wybranej listy w Apple Reminders.")
                .font(.body)
                .foregroundColor(.secondary)

            // Existing list option
            VStack(alignment: .leading, spacing: 8) {
                Picker("", selection: $useExistingList) {
                    Text("Użyj istniejącej listy").tag(true)
                    Text("Utwórz nową listę").tag(false)
                }
                .pickerStyle(.radioGroup)

                if useExistingList {
                    if availableLists.isEmpty {
                        Text("Brak dostępnych list. Utwórz nową poniżej.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        Picker("Lista:", selection: $selectedListName) {
                            ForEach(availableLists, id: \.self) { listName in
                                Text(listName).tag(listName)
                            }
                        }
                        .frame(maxWidth: 250)
                    }
                } else {
                    HStack {
                        Text("Nazwa nowej listy:")
                        TextField("Mavinci CRM", text: $newListName)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 200)
                    }
                }
            }
            .padding(.leading, 4)
        }
        .onAppear {
            loadAvailableLists()
        }
    }

    // MARK: - Step 6: First Sync

    private var firstSyncStep: some View {
        VStack(spacing: 20) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 48, height: 48)
                .foregroundColor(.accentColor)

            Text("Pierwsza synchronizacja")
                .font(.title2)
                .fontWeight(.semibold)

            if firstSyncCompleted {
                VStack(spacing: 8) {
                    Label("Synchronizacja zakończona!", systemImage: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.headline)

                    Text("Zsynchronizowano \(firstSyncCount) zadań do Apple Reminders.")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
            } else if let error = syncError {
                VStack(spacing: 8) {
                    Label("Błąd synchronizacji", systemImage: "xmark.circle.fill")
                        .foregroundColor(.red)
                        .font(.headline)

                    Text(error)
                        .font(.caption)
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)

                    Button("Spróbuj ponownie") {
                        performFirstSync()
                    }
                    .padding(.top, 8)
                }
            } else if isSyncing {
                VStack(spacing: 12) {
                    ProgressView()
                        .controlSize(.large)
                    Text("Synchronizowanie zadań…")
                        .font(.body)
                        .foregroundColor(.secondary)
                }
            } else {
                VStack(spacing: 12) {
                    Text("Kliknij poniżej, aby uruchomić pierwszą synchronizację zadań z CRM do Apple Reminders.")
                        .font(.body)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    Button("Synchronizuj teraz") {
                        performFirstSync()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Step 7: Done

    private var doneStep: some View {
        VStack(spacing: 20) {
            Spacer().frame(height: 20)

            Image(systemName: "checkmark.seal.fill")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 64, height: 64)
                .foregroundColor(.accentColor)

            Text("Gotowe!")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Mavinci CRM Reminders jest skonfigurowany i będzie synchronizować Twoje zadania w tle.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                infoRow(label: "Lista:", value: effectiveListName)
                infoRow(label: "Interwał synchronizacji:", value: "5 min")
                infoRow(label: "Zadania:", value: "\(firstSyncCount)")
            }
            .padding()
            .background(RoundedRectangle(cornerRadius: 8).fill(Color.secondary.opacity(0.1)))

            Text("Aplikacja działa w pasku menu. Kliknij ikonę ✓ aby zobaczyć status.")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundColor(.secondary)
            Text(value)
                .fontWeight(.medium)
        }
        .font(.body)
    }

    // MARK: - Navigation Bar

    private var navigationBar: some View {
        HStack {
            if currentStep != .welcome && currentStep != .done {
                Button("Wstecz") {
                    goBack()
                }
            }

            Spacer()

            if currentStep == .done {
                Button("Zakończ") {
                    completeOnboarding()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            } else {
                Button("Dalej") {
                    goNext()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canProceed)
            }
        }
    }

    // MARK: - Navigation Logic

    private var canProceed: Bool {
        switch currentStep {
        case .welcome:
            return true
        case .remindersPermission:
            return remindersAccessGranted
        case .credentials:
            return isCredentialsValid
        case .testConnection:
            return connectionTestPassed
        case .chooseList:
            return !effectiveListName.isEmpty
        case .firstSync:
            return firstSyncCompleted
        case .done:
            return true
        }
    }

    private var isCredentialsValid: Bool {
        let urlValid = crmBaseURL.lowercased().hasPrefix("https://") && URL(string: crmBaseURL) != nil
        let tokenValid = !tokenInput.isEmpty
        return urlValid && tokenValid
    }

    private var effectiveListName: String {
        if useExistingList {
            return selectedListName
        } else {
            return newListName.isEmpty ? "Mavinci CRM" : newListName
        }
    }

    private func goNext() {
        guard let nextStep = currentStep.next else { return }

        // Perform step-specific actions before advancing
        switch currentStep {
        case .credentials:
            saveCredentials()
        case .chooseList:
            saveListChoice()
        default:
            break
        }

        withAnimation(.easeInOut(duration: 0.2)) {
            currentStep = nextStep
        }

        // Auto-trigger actions on entering new step
        switch nextStep {
        case .testConnection:
            if !connectionTestPassed {
                performConnectionTest()
            }
        default:
            break
        }
    }

    private func goBack() {
        guard let prevStep = currentStep.previous else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            currentStep = prevStep
        }
    }

    // MARK: - Actions

    private func requestRemindersAccess() {
        Task {
            let service = RemindersService()
            let granted = await service.requestAccess()
            await MainActor.run {
                remindersAccessGranted = granted
                syncManager.remindersAccessGranted = granted
            }
        }
    }

    private func saveCredentials() {
        // Save URL to UserDefaults
        let trimmedURL = crmBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(trimmedURL, forKey: "crm_base_url")

        // Save token to Keychain
        let trimmedToken = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
        KeychainService.shared.save(token: trimmedToken)
    }

    private func performConnectionTest() {
        isTesting = true
        connectionError = nil
        connectionTestPassed = false

        Task {
            do {
                let result = try await CRMAPIClient.shared.testConnection()
                await MainActor.run {
                    connectionTestPassed = true
                    taskCount = result.taskCount
                    employeeName = result.employeeName
                    isTesting = false
                }
            } catch {
                await MainActor.run {
                    connectionError = error.localizedDescription
                    isTesting = false
                }
            }
        }
    }

    private func loadAvailableLists() {
        let store = EKEventStore()
        let calendars = store.calendars(for: .reminder)
        availableLists = calendars.map { $0.title }
        if !availableLists.contains(selectedListName) && !availableLists.isEmpty {
            selectedListName = availableLists.first ?? "Mavinci CRM"
        }
    }

    private func saveListChoice() {
        let listName = effectiveListName
        UserDefaults.standard.set(listName, forKey: "selectedRemindersListName")

        // Create the list if needed
        let service = RemindersService(targetListName: listName)
        _ = service.getOrCreateList(name: listName)
    }

    private func performFirstSync() {
        isSyncing = true
        syncError = nil

        Task {
            do {
                // Fetch tasks from CRM
                let response = try await CRMAPIClient.shared.fetchTasks()

                guard response.success, let tasks = response.tasks else {
                    throw CRMAPIError.invalidResponse
                }

                // Create reminders for each task
                let listName = effectiveListName
                let service = RemindersService(targetListName: listName)
                let baseURL = crmBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
                var createdCount = 0

                for task in tasks {
                    if let reminder = service.createReminder(from: task, crmBaseURL: baseURL) {
                        try service.saveReminder(reminder)
                        createdCount += 1
                    }
                }

                await MainActor.run {
                    firstSyncCompleted = true
                    firstSyncCount = createdCount
                    isSyncing = false
                }
            } catch {
                await MainActor.run {
                    syncError = error.localizedDescription
                    isSyncing = false
                }
            }
        }
    }

    private func completeOnboarding() {
        // Mark onboarding as complete
        UserDefaults.standard.set(true, forKey: "onboardingCompleted")
        UserDefaults.standard.set(5, forKey: "syncIntervalMinutes")

        // Dismiss and start background sync
        onComplete?()
    }
}

// MARK: - Onboarding Step

enum OnboardingStep: Int, CaseIterable {
    case welcome = 0
    case remindersPermission = 1
    case credentials = 2
    case testConnection = 3
    case chooseList = 4
    case firstSync = 5
    case done = 6

    var next: OnboardingStep? {
        OnboardingStep(rawValue: rawValue + 1)
    }

    var previous: OnboardingStep? {
        OnboardingStep(rawValue: rawValue - 1)
    }
}

import SwiftUI

// MARK: Dysk → „Miejsce na Dysku” — tylko administrator (1:1 z CRM `DriveStorageMeter.tsx`)
//
// Na dole paska bocznego Dysku (także w Materiałach): pasek zajętości plików względem pakietu i „zostało …”. Kliknięcie otwiera
// panel: pakiet, pliki z podziałem na rodzaje (Materiały, pliki eventów, oferty, e-maile…), baza danych i „Zmień pakiet…”.
// Dane: `op=storage` (`crm_storage_usage()`, migracja 20261126120000), zmiana pakietu — `op=storagePlan`.

enum DriveStorageText {
    /// Rozmiar po polsku jak w CRM (`formatDriveBytes`): „4,7 GB”, „824 MB”.
    static func bytes(_ value: Int64) -> String {
        let total = Double(max(0, value))
        if total < 1024 { return "\(Int(total)) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var size = total / 1024
        var unit = 0
        while size >= 1024 && unit < units.count - 1 {
            size /= 1024
            unit += 1
        }
        return number(size, digits: size >= 100 || unit == 0 ? 0 : 1) + " " + units[unit]
    }

    /// Procent zajętości jak w CRM (`formatDriveShare`): „4,7%”, „14%”, „<0,1%”.
    static func share(_ used: Int64, _ quota: Int64) -> String {
        guard quota > 0 else { return "—" }
        let value = Double(used) / Double(quota) * 100
        if value > 0 && value < 0.1 { return "<0,1%" }
        return number(value, digits: value >= 10 ? 0 : 1) + "%"
    }

    static func fraction(_ used: Int64, _ quota: Int64) -> Double {
        quota > 0 ? min(1, max(0, Double(used) / Double(quota))) : 0
    }

    /// Kolor stanu: do 80% — akcent, od 80% — pomarańczowy, od 95% — czerwony.
    static func color(_ used: Int64, _ quota: Int64, accent: Color) -> Color {
        let value = fraction(used, quota)
        return value >= 0.95 ? .red : value >= 0.8 ? .orange : accent
    }

    /// Liczba z przecinkiem dziesiętnym, bez zbędnego „,0”.
    static func number(_ value: Double, digits: Int) -> String {
        let text = String(format: "%.\(digits)f", value).replacingOccurrences(of: ".", with: ",")
        return text.hasSuffix(",0") ? String(text.dropLast(2)) : text
    }

    /// „1 plik”, „3 pliki”, „1 250 plików”.
    static func files(_ count: Int64) -> String {
        let text = count.formatted(.number.locale(Locale(identifier: "pl_PL")))
        let tens = count % 100
        let unit = count % 10
        if count == 1 { return "\(text) plik" }
        return "\(text) " + ((2...4).contains(unit) && !(12...14).contains(tens) ? "pliki" : "plików")
    }

    /// Liczba GB do pola formularza („100”, „8”, „250,5”).
    static func gigabytes(_ bytes: Int64) -> String {
        number(Double(bytes) / 1_073_741_824, digits: 1)
    }
}

/// Pasek zajętości (wypełnienie według udziału, kolor stanu).
struct DriveStorageBar: View {
    let used: Int64
    let quota: Int64
    var height: CGFloat = 6
    @Environment(\.crmTheme) private var theme

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.1))
                Capsule().fill(DriveStorageText.color(used, quota, accent: theme.accent))
                    .frame(width: max(used > 0 ? height : 0, proxy.size.width * DriveStorageText.fraction(used, quota)))
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityLabel("Zajęte \(DriveStorageText.share(used, quota))")
    }
}

/// Pozycja na dole paska bocznego Dysku — tylko dla administratora.
struct DriveStorageMeter: View {
    @ObservedObject var store: DriveStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var shown = false

    var body: some View {
        if state.employee?.isAdmin == true {
            Button { shown = true } label: { meter }
                .buttonStyle(.plain)
                .help("Miejsce na Dysku — szczegóły i pakiet (widzi tylko administrator)")
                .popover(isPresented: $shown, arrowEdge: .trailing) {
                    DriveStoragePanel(store: store).environment(\.crmTheme, theme)
                }
                .padding(.horizontal, 8).padding(.bottom, 8)
                .task(id: state.employee?.id) { if store.storage == nil { await store.loadStorage() } }
        }
    }

    private var meter: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "externaldrive").foregroundStyle(theme.accent)
                Text("Miejsce na Dysku").font(.caption.weight(.semibold))
                Spacer(minLength: 0)
                if store.storageLoading && store.storage == nil { ProgressView().controlSize(.mini) }
            }
            if let usage = store.storage {
                DriveStorageBar(used: usage.files.used, quota: usage.files.quota)
                Text("\(DriveStorageText.bytes(usage.files.used)) z \(DriveStorageText.bytes(usage.files.quota)) · zostało \(DriveStorageText.bytes(max(0, usage.files.quota - usage.files.used)))")
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            } else if let error = store.storageError {
                Text(error).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
        .contentShape(Rectangle())
    }
}

/// Panel „Miejsce na Dysku”: pakiet, pliki według rodzaju, baza danych, zmiana pakietu.
struct DriveStoragePanel: View {
    @ObservedObject var store: DriveStore
    @Environment(\.crmTheme) private var theme
    @State private var editing = false
    @State private var name = ""
    @State private var filesGb = ""
    @State private var databaseGb = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Miejsce na Dysku").font(.headline)
                Spacer()
                if store.storageLoading { ProgressView().controlSize(.small) }
                Button { Task { await store.loadStorage() } } label: { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.borderless).help("Odśwież").disabled(store.storageLoading)
            }
            if let usage = store.storage {
                content(usage)
            } else if let error = store.storageError {
                Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
            Text("Widzi tylko administrator. Pliki to cały magazyn CRM (także załączniki e-mail, czat, strona), nie tylko Dysk.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(width: 380)
        .task { await store.loadStorage() }
    }

    @ViewBuilder private func content(_ usage: DriveStorageUsage) -> some View {
        Text("Pakiet: \(usage.plan.name)").font(.callout).foregroundStyle(.secondary)
        usageBlock("Pliki", used: usage.files.used, quota: usage.files.quota, detail: usage.files.objects.map(DriveStorageText.files))
        if !usage.groups.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                ForEach(Array(usage.groups.enumerated()), id: \.element.id) { index, group in
                    HStack(spacing: 8) {
                        RoundedRectangle(cornerRadius: 2).fill(theme.accent.opacity(max(0.2, 1 - Double(index) * 0.11))).frame(width: 10, height: 10)
                        Text(group.label).font(.caption).lineLimit(1)
                        Spacer(minLength: 8)
                        Text(DriveStorageText.bytes(group.bytes)).font(.caption).monospacedDigit()
                        Text(DriveStorageText.share(group.bytes, max(1, usage.files.used))).font(.caption).foregroundStyle(.secondary)
                            .monospacedDigit().frame(width: 44, alignment: .trailing)
                    }
                }
            }
        }
        Divider()
        usageBlock("Baza danych", used: usage.database.used, quota: usage.database.quota, detail: nil)
        Divider()
        if editing {
            planForm
        } else {
            Button("Zmień pakiet…") {
                name = usage.plan.name
                filesGb = DriveStorageText.gigabytes(usage.files.quota)
                databaseGb = DriveStorageText.gigabytes(usage.database.quota)
                editing = true
            }
        }
    }

    private func usageBlock(_ title: String, used: Int64, quota: Int64, detail: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.callout.weight(.semibold))
                Spacer()
                Text("\(DriveStorageText.bytes(used)) z \(DriveStorageText.bytes(quota))").font(.callout).monospacedDigit()
            }
            DriveStorageBar(used: used, quota: quota, height: 8)
            HStack {
                Text("Zajęte \(DriveStorageText.share(used, quota)) · zostało \(DriveStorageText.bytes(max(0, quota - used)))")
                Spacer()
                if let detail { Text(detail) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }

    private var planForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Zakupiony pakiet").font(.callout.weight(.semibold))
            TextField("Nazwa pakietu (np. Supabase Pro)", text: $name).textFieldStyle(.roundedBorder)
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Pliki (GB)").font(.caption).foregroundStyle(.secondary)
                    TextField("100", text: $filesGb).textFieldStyle(.roundedBorder)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("Baza danych (GB)").font(.caption).foregroundStyle(.secondary)
                    TextField("8", text: $databaseGb).textFieldStyle(.roundedBorder)
                }
            }
            HStack {
                Spacer()
                Button("Anuluj") { editing = false }
                Button("Zapisz pakiet") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(Self.gb(filesGb) == nil || Self.gb(databaseGb) == nil)
            }
        }
    }

    /// Liczba GB z pola (przecinek albo kropka), 1–100 000.
    private static func gb(_ text: String) -> Double? {
        guard let value = Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")),
              value >= 1, value <= 100_000 else { return nil }
        return value
    }

    private func save() async {
        guard let files = Self.gb(filesGb), let database = Self.gb(databaseGb) else { return }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if await store.saveStoragePlan(name: trimmed.isEmpty ? "Pakiet" : trimmed, filesGb: files, databaseGb: database) { editing = false }
    }
}

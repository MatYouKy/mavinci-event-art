import SwiftUI
import AppKit
import ImageCaptureCore
import ImageIO
import PDFKit
import UniformTypeIdentifiers

// MARK: Skaner dokumentów — kilka stron w jeden PDF (jak skaner w CRM, `ScannerCaptureModal` z `multiPage`)
//
// Natywnie przez ImageCaptureCore (to samo co „Pobieranie obrazów” i Ustawienia systemowe → Drukarki i skanery): skanery
// podłączone kablem, udostępnione i sieciowe (AirScan / eSCL, np. Brother MFC-T920) — bez lokalnego modułu NAPS2, którego
// używa przeglądarka. Każdy skan dokłada strony do listy („Skanuj pierwszą stronę”, potem „Dodaj stronę”; z podajnika może
// przyjść kilka stron naraz), strony można obejrzeć, przestawić i usunąć, a „Zakończ” łączy je w jeden PDF (PDFKit,
// JPEG ~72%, wymiar strony z rozdzielczości skanu). Strony leżą w katalogu tymczasowym do zamknięcia okna. Ustawienia
// (skaner, źródło, jakość, kolor) zapamiętuje ten Mac. Użycie: umowy stałe (Finanse → Umowy stałe — formularz i „Pliki
// umowy”) oraz Mavinci → „Skanuj dokument do PDF…” (zapis w wybranym miejscu).

/// Źródło papieru (`ICScannerFunctionalUnitType`: 0 — szyba, 3 — podajnik).
enum ScanSource: String, CaseIterable, Identifiable {
    case flatbed, feeder, duplex
    var id: String { rawValue }
    var label: String {
        switch self {
        case .flatbed: return "Szyba"
        case .feeder: return "Podajnik"
        case .duplex: return "Podajnik dwustronny"
        }
    }
    var unitRaw: UInt { self == .flatbed ? 0 : 3 }
}

/// Kolor skanu (`ICScannerPixelDataType`: 0 — czarno-biały, 1 — skala szarości, 2 — kolor).
enum ScanColor: String, CaseIterable, Identifiable {
    case color, gray, bw
    var id: String { rawValue }
    var label: String {
        switch self {
        case .color: return "Kolor"
        case .gray: return "Skala szarości"
        case .bw: return "Czarno-biały"
        }
    }
    var pixelRaw: UInt {
        switch self {
        case .color: return 2
        case .gray: return 1
        case .bw: return 0
        }
    }
    /// Bity na próbkę (`ICScannerBitDepth`): 8 — kolor i skala szarości, 1 — czarno-biały.
    var bitDepthRaw: UInt { self == .bw ? 1 : 8 }
}

/// Zeskanowana strona (plik w katalogu tymczasowym skanera).
struct ScannedPage: Identifiable {
    let id = UUID()
    let url: URL
    let dpi: Int
    let bytes: Int
    let thumbnail: NSImage?
}

struct ScanFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

@MainActor final class DocumentScanner: NSObject, ObservableObject {
    enum Phase { case idle, opening, scanning }

    @Published private(set) var devices: [ICScannerDevice] = []
    @Published private(set) var searching = true
    @Published var selectedID = ""
    @Published var source: ScanSource = .flatbed
    @Published var dpi = 300
    @Published var color: ScanColor = .color
    /// Źródła i rozdzielczości wybranego skanera (po otwarciu sesji); wcześniej — wszystkie.
    @Published private(set) var sources: [ScanSource] = ScanSource.allCases
    @Published private(set) var resolutions: [Int] = DocumentScanner.standardResolutions
    @Published private(set) var pages: [ScannedPage] = []
    @Published private(set) var phase: Phase = .idle
    @Published var error: String?
    @Published var notice: String?

    nonisolated static let standardResolutions = [150, 200, 300, 600]
    private let browser = ICDeviceBrowser()
    private let folder: URL
    /// Skaner z sesją otwartą przez to okno.
    private var sessionDevice: ICScannerDevice?
    private var wantScan = false
    private var unitRequested = false
    private var scanDPI = 300
    private var pagesBefore = 0
    private var counter = 0
    private var started = false
    private var stopped = false

    private enum Key {
        static let device = "scanner.device"
        static let source = "scanner.source"
        static let dpi = "scanner.dpi"
        static let color = "scanner.color"
    }

    override init() {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("mavinci-skan-\(UUID().uuidString)", isDirectory: true)
        super.init()
        let defaults = UserDefaults.standard
        selectedID = defaults.string(forKey: Key.device) ?? ""
        source = ScanSource(rawValue: defaults.string(forKey: Key.source) ?? "") ?? .flatbed
        let savedDPI = defaults.integer(forKey: Key.dpi)
        dpi = Self.standardResolutions.contains(savedDPI) ? savedDPI : 300
        color = ScanColor(rawValue: defaults.string(forKey: Key.color) ?? "") ?? .color
    }

    var selectedDevice: ICScannerDevice? { devices.first { Self.key($0) == selectedID } }
    var totalBytes: Int { pages.reduce(0) { $0 + $1.bytes } }
    var busy: Bool { phase != .idle }

    static func key(_ device: ICDevice) -> String {
        let uuid: String? = device.uuidString
        let name: String? = device.name
        return uuid ?? name ?? ""
    }

    static func title(_ device: ICDevice) -> String {
        let name: String? = device.name
        let transport: String? = device.transportType
        let network = (transport ?? "").localizedCaseInsensitiveContains("tcp") || (transport ?? "").localizedCaseInsensitiveContains("bonjour")
        return (name ?? "Skaner") + (network ? " (sieć)" : "")
    }

    // MARK: Wyszukiwanie

    func start() {
        guard !started else { return }
        started = true
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        browser.delegate = self
        // Skanery: podłączone, udostępnione, Bonjour (AirScan / eSCL) i Bluetooth (`ICDeviceTypeMask` + `ICDeviceLocationTypeMask`).
        if let mask = ICDeviceTypeMask(rawValue: 0x0002 | 0x0100 | 0x0200 | 0x0400 | 0x0800) as ICDeviceTypeMask? {
            browser.browsedDeviceTypeMask = mask
        }
        browser.start()
        // Skanery sieciowe zgłaszają się z opóźnieniem — po chwili przestajemy pokazywać „Szukanie…”.
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 8_000_000_000)
            self?.searching = false
        }
    }

    /// Zamknięcie okna: przerwany skan, zamknięta sesja, usunięte strony tymczasowe.
    func stop() {
        guard !stopped else { return }
        stopped = true
        if phase == .scanning { sessionDevice?.cancelScan() }
        sessionDevice?.requestCloseSession()
        sessionDevice = nil
        browser.stop()
        browser.delegate = nil
        try? FileManager.default.removeItem(at: folder)
    }

    private func add(_ device: ICDevice) {
        guard let scanner = device as? ICScannerDevice, !devices.contains(where: { $0 === scanner }) else { return }
        devices.append(scanner)
        devices.sort { Self.title($0).localizedCaseInsensitiveCompare(Self.title($1)) == .orderedAscending }
        if selectedDevice == nil { selectedID = Self.key(preferred() ?? scanner) }
    }

    /// Zapamiętany skaner, potem Brother (jak w CRM), potem pierwszy.
    private func preferred() -> ICScannerDevice? {
        let saved = UserDefaults.standard.string(forKey: Key.device) ?? ""
        if let device = devices.first(where: { Self.key($0) == saved }) { return device }
        return devices.first { Self.title($0).range(of: "brother", options: .caseInsensitive) != nil } ?? devices.first
    }

    private func remove(_ device: ICDevice) {
        devices.removeAll { $0 === device }
        if sessionDevice === device {
            sessionDevice = nil
            if phase != .idle { error = "Skaner został odłączony." }
            phase = .idle
            wantScan = false
        }
        if selectedDevice == nil { selectedID = preferred().map { Self.key($0) } ?? "" }
    }

    // MARK: Skanowanie

    /// Skan z bieżącymi ustawieniami: sesja ze skanerem, wybór szyby lub podajnika, ustawienia, skan.
    func scan() {
        guard phase == .idle else { return }
        guard let device = selectedDevice else {
            error = devices.isEmpty
                ? "Nie znaleziono skanera. Sprawdź, czy jest włączony i w tej samej sieci (Ustawienia systemowe → Drukarki i skanery)."
                : "Wybierz skaner."
            return
        }
        error = nil
        notice = nil
        let defaults = UserDefaults.standard
        defaults.set(selectedID, forKey: Key.device)
        defaults.set(source.rawValue, forKey: Key.source)
        defaults.set(dpi, forKey: Key.dpi)
        defaults.set(color.rawValue, forKey: Key.color)
        wantScan = true
        unitRequested = false
        pagesBefore = pages.count
        phase = .opening
        if let open = sessionDevice, open !== device {
            open.requestCloseSession()
            sessionDevice = nil
        }
        if sessionDevice === device && device.hasOpenSession {
            selectUnit(device)
        } else {
            sessionDevice = device
            device.delegate = self
            device.requestOpenSession()
        }
    }

    func cancel() {
        wantScan = false
        if phase == .scanning { sessionDevice?.cancelScan() } else { phase = .idle }
    }

    private func selectUnit(_ device: ICScannerDevice) {
        guard wantScan else { return }
        let current: ICScannerFunctionalUnit? = device.selectedFunctionalUnit
        if let current, current.type.rawValue == source.unitRaw {
            startScan(device, unit: current)
        } else if !unitRequested, let type = ICScannerFunctionalUnitType(rawValue: source.unitRaw) as ICScannerFunctionalUnitType? {
            unitRequested = true
            device.requestSelect(type)
        }
    }

    private func capabilities(_ device: ICScannerDevice, unit: ICScannerFunctionalUnit) {
        let types: [NSNumber]? = device.availableFunctionalUnitTypes
        var available: [ScanSource] = []
        if (types ?? []).contains(where: { $0.uintValue == 0 }) { available.append(.flatbed) }
        if (types ?? []).contains(where: { $0.uintValue == 3 }) { available += [.feeder, .duplex] }
        if !available.isEmpty { sources = available }
        let supported = Self.resolutions(of: unit)
        let standard = Self.standardResolutions.filter { supported.contains($0) }
        resolutions = standard.isEmpty ? Array(supported.filter { $0 >= 100 && $0 <= 1200 }.prefix(6)) : standard
        if resolutions.isEmpty { resolutions = Self.standardResolutions }
        if !resolutions.contains(dpi) { dpi = resolutions.min { abs($0 - dpi) < abs($1 - dpi) } ?? dpi }
        // Skaner bez wybranego źródła (np. tylko podajnik) — pierwsze dostępne (poza trwającym skanem).
        if phase == .idle, !sources.contains(source), let first = sources.first {
            let missing = source
            source = first
            notice = "Ten skaner nie ma źródła „\(missing.label.lowercased())” — wybrano „\(first.label.lowercased())”."
        }
    }

    private func configure(_ unit: ICScannerFunctionalUnit) {
        if let inches = ICScannerMeasurementUnit(rawValue: 0) as ICScannerMeasurementUnit? { unit.measurementUnit = inches }
        let supported = Self.resolutions(of: unit)
        if !supported.isEmpty {
            let target = supported.min { abs($0 - dpi) < abs($1 - dpi) } ?? dpi
            unit.resolution = target
        }
        if let pixel = ICScannerPixelDataType(rawValue: color.pixelRaw) as ICScannerPixelDataType? { unit.pixelDataType = pixel }
        let depths: IndexSet? = unit.supportedBitDepths
        let depthRaw = (depths ?? []).contains(Int(color.bitDepthRaw)) ? color.bitDepthRaw : 8
        if let depth = ICScannerBitDepth(rawValue: depthRaw) as ICScannerBitDepth? { unit.bitDepth = depth }
        if let feeder = unit as? ICScannerFunctionalUnitDocumentFeeder {
            // A4 (`ICScannerDocumentType` 1), jeśli podajnik go zna; dwustronnie — gdy wybrano i podajnik to umie.
            let documentTypes: IndexSet? = feeder.supportedDocumentTypes
            if (documentTypes ?? []).contains(1), let a4 = ICScannerDocumentType(rawValue: 1) as ICScannerDocumentType? { feeder.documentType = a4 }
            let duplex = source == .duplex
            if duplex && !feeder.supportsDuplexScanning { notice = "Ten podajnik nie skanuje dwustronnie — skan jednostronny." }
            feeder.duplexScanningEnabled = duplex && feeder.supportsDuplexScanning
        } else {
            // Szyba: cały obszar skanowania.
            let size = unit.physicalSize
            if size.width > 0 && size.height > 0 { unit.scanArea = NSRect(origin: .zero, size: size) }
        }
        scanDPI = unit.resolution > 0 ? unit.resolution : dpi
    }

    /// Rozdzielczości obsługiwane przez szybę albo podajnik.
    private static func resolutions(of unit: ICScannerFunctionalUnit) -> [Int] {
        let set: IndexSet? = unit.supportedResolutions
        return Array(set ?? [])
    }

    private func startScan(_ device: ICScannerDevice, unit: ICScannerFunctionalUnit) {
        capabilities(device, unit: unit)
        configure(unit)
        counter += 1
        if let mode = ICScannerTransferMode(rawValue: 0) as ICScannerTransferMode? { device.transferMode = mode }
        device.downloadsDirectory = folder
        device.documentName = "strona-\(counter)"
        // Czarno-biały skan jako PNG (JPEG nie ma 1 bitu na piksel), pozostałe — JPEG.
        device.documentUTI = color == .bw ? UTType.png.identifier : UTType.jpeg.identifier
        wantScan = false
        phase = .scanning
        device.requestScan()
    }

    private func scanned(_ url: URL) {
        let bytes = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        pages.append(ScannedPage(url: url, dpi: scanDPI, bytes: bytes, thumbnail: Self.thumbnail(url)))
    }

    private func completed(_ failure: Error?) {
        phase = .idle
        wantScan = false
        if let failure {
            let text = failure.localizedDescription
            error = text.isEmpty ? "Skanowanie nie powiodło się." : "Skanowanie nie powiodło się: \(text)"
        } else if pages.count == pagesBefore {
            error = source == .flatbed
                ? "Skaner nie przysłał strony — sprawdź, czy dokument leży na szybie, i spróbuj ponownie."
                : "Skaner nie przysłał strony — sprawdź, czy dokument jest w podajniku, i spróbuj ponownie."
        }
    }

    // MARK: Strony

    func move(_ page: ScannedPage, by offset: Int) {
        guard let index = pages.firstIndex(where: { $0.id == page.id }) else { return }
        let target = index + offset
        guard pages.indices.contains(target) else { return }
        pages.swapAt(index, target)
    }

    func remove(_ page: ScannedPage) {
        pages.removeAll { $0.id == page.id }
        try? FileManager.default.removeItem(at: page.url)
    }

    func preview(_ page: ScannedPage) {
        NSWorkspace.shared.open(page.url)
    }

    /// Wszystkie strony w kolejności z listy → jeden PDF (w tle).
    func makePDF() async throws -> Data {
        let list = pages.map { ($0.url, $0.dpi) }
        return try await Task.detached(priority: .userInitiated) { try DocumentScanner.pdf(from: list) }.value
    }

    nonisolated static func pdf(from pages: [(URL, Int)]) throws -> Data {
        let document = PDFDocument()
        for (index, page) in pages.enumerated() {
            guard let image = NSImage(contentsOf: page.0), let rep = image.representations.first, rep.pixelsWide > 0, rep.pixelsHigh > 0 else {
                throw ScanFailure(message: "Nie udało się odczytać strony \(index + 1).")
            }
            let dpi = Double(page.1 > 0 ? page.1 : 300)
            let size = NSSize(width: Double(rep.pixelsWide) * 72 / dpi, height: Double(rep.pixelsHigh) * 72 / dpi)
            image.size = size
            guard let pdfPage = PDFPage(image: image, options: [.mediaBox: NSValue(rect: NSRect(origin: .zero, size: size)), .compressionQuality: 0.72]) else {
                throw ScanFailure(message: "Nie udało się dodać strony \(index + 1) do PDF.")
            }
            document.insert(pdfPage, at: document.pageCount)
        }
        guard document.pageCount > 0, let data = document.dataRepresentation() else { throw ScanFailure(message: "Nie udało się połączyć stron w PDF.") }
        return data
    }

    nonisolated static func thumbnail(_ url: URL) -> NSImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: 360,
            kCGImageSourceCreateThumbnailWithTransform: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return NSImage(cgImage: image, size: .zero)
    }

    static func pagesLabel(_ count: Int) -> String {
        if count == 1 { return "1 strona" }
        let tens = count % 100
        return (2...4).contains(count % 10) && !(12...14).contains(tens) ? "\(count) strony" : "\(count) stron"
    }

    static func size(_ bytes: Int) -> String {
        bytes >= 1024 * 1024
            ? String(format: "%.1f MB", Double(bytes) / 1_048_576).replacingOccurrences(of: ".", with: ",")
            : "\(max(1, bytes / 1024)) kB"
    }
}

// MARK: Zdarzenia ImageCaptureCore (wywoływane przez system — przekazywane na wątek główny w kolejności)

/// Obiekt ImageCaptureCore w drodze na wątek główny (zdarzenia przychodzą od systemu, obsługa i stan — na wątku głównym).
private struct ICBox<T>: @unchecked Sendable {
    let value: T
}

extension DocumentScanner: ICDeviceBrowserDelegate, ICScannerDeviceDelegate {
    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didAdd device: ICDevice, moreComing: Bool) {
        let box = ICBox(value: device)
        DispatchQueue.main.async { MainActor.assumeIsolated { self.add(box.value) } }
    }

    nonisolated func deviceBrowser(_ browser: ICDeviceBrowser, didRemove device: ICDevice, moreGoing: Bool) {
        let box = ICBox(value: device)
        DispatchQueue.main.async { MainActor.assumeIsolated { self.remove(box.value) } }
    }

    nonisolated func deviceBrowserDidEnumerateLocalDevices(_ browser: ICDeviceBrowser) {
        DispatchQueue.main.async { MainActor.assumeIsolated { if !self.devices.isEmpty { self.searching = false } } }
    }

    nonisolated func didRemove(_ device: ICDevice) {
        let box = ICBox(value: device)
        DispatchQueue.main.async { MainActor.assumeIsolated { self.remove(box.value) } }
    }

    nonisolated func device(_ device: ICDevice, didOpenSessionWithError error: Error?) {
        let box = ICBox(value: device)
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard let scanner = box.value as? ICScannerDevice, scanner === self.sessionDevice else { return }
                if let error {
                    self.sessionDevice = nil
                    self.phase = .idle
                    self.wantScan = false
                    self.error = "Nie udało się połączyć ze skanerem: \(error.localizedDescription)"
                    return
                }
                self.selectUnit(scanner)
            }
        }
    }

    nonisolated func device(_ device: ICDevice, didCloseSessionWithError error: Error?) {
        let box = ICBox(value: device)
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                if self.sessionDevice === box.value { self.sessionDevice = nil; if self.phase != .idle { self.phase = .idle } }
            }
        }
    }

    nonisolated func device(_ device: ICDevice, didEncounterError error: Error?) {
        guard let error else { return }
        DispatchQueue.main.async { MainActor.assumeIsolated { self.error = "Skaner zgłosił błąd: \(error.localizedDescription)" } }
    }

    nonisolated func scannerDeviceDidBecomeAvailable(_ scanner: ICScannerDevice) {
        let box = ICBox(value: scanner)
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                guard box.value === self.sessionDevice, self.phase == .opening else { return }
                self.selectUnit(box.value)
            }
        }
    }

    nonisolated func scannerDevice(_ scanner: ICScannerDevice, didSelect functionalUnit: ICScannerFunctionalUnit, error: Error?) {
        let box = ICBox(value: (scanner, functionalUnit))
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                let (scanner, functionalUnit) = box.value
                guard scanner === self.sessionDevice else { return }
                if let error {
                    self.phase = .idle
                    self.wantScan = false
                    self.error = "Skaner nie przełączył się na „\(self.source.label.lowercased())”: \(error.localizedDescription)"
                    return
                }
                if self.wantScan { self.startScan(scanner, unit: functionalUnit) } else { self.capabilities(scanner, unit: functionalUnit) }
            }
        }
    }

    nonisolated func scannerDevice(_ scanner: ICScannerDevice, didScanTo url: URL) {
        DispatchQueue.main.async { MainActor.assumeIsolated { self.scanned(url) } }
    }

    nonisolated func scannerDevice(_ scanner: ICScannerDevice, didCompleteScanWithError error: Error?) {
        DispatchQueue.main.async { MainActor.assumeIsolated { self.completed(error) } }
    }
}

// MARK: Okno skanera

/// Arkusz skanera: wybór skanera i ustawień, lista stron, „Dodaj stronę”, „Zakończ — połącz w PDF”. `onFinish` dostaje PDF
/// i liczbę stron; `maxBytes` — limit pliku (np. magazyn umów: 20 MB).
@MainActor struct DocumentScannerSheet: View {
    let title: String
    let intro: String
    var finishLabel = "Zakończ — połącz w PDF"
    var maxBytes: Int?
    let onFinish: (Data, Int) -> Void
    @StateObject private var scanner = DocumentScanner()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var merging = false
    @State private var confirmClose = false

    private var tooLarge: Bool { maxBytes.map { scanner.totalBytes > $0 } ?? false }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: "doc.viewfinder").font(.title3.bold())
                Text(intro).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding([.horizontal, .top], 18).padding(.bottom, 10)
            Divider()
            HStack(alignment: .top, spacing: 0) {
                settings.frame(width: 270)
                Divider()
                pagesArea.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack(spacing: 10) {
                if let error = scanner.error {
                    Label(error, systemImage: "exclamationmark.triangle").font(.caption).foregroundStyle(CrmTheme.rgb(0xfca5a5)).lineLimit(3)
                } else if let notice = scanner.notice {
                    Label(notice, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 8)
                Button("Anuluj", role: .cancel) { close() }.keyboardShortcut(.cancelAction).disabled(merging)
                if scanner.phase == .scanning || scanner.phase == .opening {
                    Button("Przerwij skanowanie") { scanner.cancel() }
                }
                Button { scanner.scan() } label: {
                    Label(scanner.pages.isEmpty ? "Skanuj pierwszą stronę" : "Dodaj stronę", systemImage: scanner.pages.isEmpty ? "doc.viewfinder" : "plus.rectangle.on.rectangle")
                }
                .disabled(scanner.busy || merging || scanner.selectedDevice == nil)
                Button { Task { await finish() } } label: {
                    Label(scanner.pages.isEmpty ? finishLabel : "\(finishLabel) (\(DocumentScanner.pagesLabel(scanner.pages.count)))", systemImage: "doc.on.doc")
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(scanner.pages.isEmpty || scanner.busy || merging || tooLarge)
            }
            .padding(14).crmBar()
        }
        .frame(minWidth: 860, idealWidth: 940, minHeight: 560, idealHeight: 640)
        .overlay {
            if merging { PendingOverlay(text: "Łączenie stron w PDF…") }
            else if scanner.phase == .opening { PendingOverlay(text: "Łączenie ze skanerem…") }
            else if scanner.phase == .scanning { PendingOverlay(text: "Skanowanie…") }
        }
        .interactiveDismissDisabled(true)
        .onAppear { scanner.start() }
        .onDisappear { scanner.stop() }
        .confirmationDialog("Odrzucić zeskanowane strony (\(DocumentScanner.pagesLabel(scanner.pages.count)))?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Odrzuć i zamknij", role: .destructive) { scanner.cancel(); dismiss() }
            Button("Wróć do skanowania", role: .cancel) {}
        }
    }

    private var settings: some View {
        Form {
            Section("Skaner") {
                if scanner.devices.isEmpty {
                    HStack(spacing: 8) {
                        if scanner.searching { ProgressView().controlSize(.small) }
                        Text(scanner.searching ? "Szukanie skanerów…" : "Nie znaleziono skanera").foregroundStyle(.secondary)
                    }
                    if !scanner.searching {
                        Text("Sprawdź, czy skaner jest włączony i w tej samej sieci albo podłączony kablem.").font(.caption).foregroundStyle(.secondary)
                        Button("Drukarki i skanery…") {
                            if let url = URL(string: "x-apple.systempreferences:com.apple.Print-Scan-Settings.extension") { NSWorkspace.shared.open(url) }
                        }
                    }
                } else {
                    Picker("Skaner", selection: $scanner.selectedID) {
                        ForEach(scanner.devices, id: \.self) { device in Text(DocumentScanner.title(device)).tag(DocumentScanner.key(device)) }
                    }
                    .labelsHidden()
                }
            }
            Section("Ustawienia") {
                Picker("Źródło", selection: $scanner.source) {
                    ForEach(scanner.sources) { Text($0.label).tag($0) }
                }
                Picker("Jakość", selection: $scanner.dpi) {
                    ForEach(scanner.resolutions, id: \.self) { value in Text(value == 300 ? "300 DPI — zalecany" : "\(value) DPI").tag(value) }
                }
                Picker("Kolor", selection: $scanner.color) {
                    ForEach(ScanColor.allCases) { Text($0.label).tag($0) }
                }
            }
            .disabled(scanner.busy || merging)
            Section {
                Text("Połóż pierwszą stronę i kliknij „Skanuj pierwszą stronę”, potem kolejną — „Dodaj stronę”. Podajnik może zeskanować kilka stron naraz. „Zakończ” łączy wszystkie strony w jeden PDF.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }

    @ViewBuilder private var pagesArea: some View {
        if scanner.pages.isEmpty {
            ContentUnavailableView("Brak zeskanowanych stron", systemImage: "doc.viewfinder",
                                   description: Text("Zeskanowane strony pojawią się tutaj — możesz je obejrzeć, przestawić albo usunąć przed połączeniem w PDF."))
        } else {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Label("Zeskanowano: \(DocumentScanner.pagesLabel(scanner.pages.count)) · \(DocumentScanner.size(scanner.totalBytes))", systemImage: "doc.on.doc")
                        .font(.callout.weight(.semibold))
                    Spacer()
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                if tooLarge, let maxBytes {
                    Text("Plik przekroczy limit \(DocumentScanner.size(maxBytes)). Usuń stronę i zeskanuj ją ponownie w niższej jakości (np. 200 DPI) albo w skali szarości.")
                        .font(.caption).foregroundStyle(CrmTheme.rgb(0xfcd34d)).padding(.horizontal, 14).padding(.bottom, 8)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Divider()
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150, maximum: 190), spacing: 14)], spacing: 14) {
                        ForEach(Array(scanner.pages.enumerated()), id: \.element.id) { index, page in pageCell(page, index: index) }
                    }
                    .padding(14)
                }
            }
        }
    }

    private func pageCell(_ page: ScannedPage, index: Int) -> some View {
        VStack(spacing: 6) {
            Group {
                if let image = page.thumbnail {
                    Image(nsImage: image).resizable().scaledToFit()
                } else {
                    Image(systemName: "doc").font(.largeTitle).foregroundStyle(.secondary)
                }
            }
            .frame(height: 170)
            .frame(maxWidth: .infinity)
            .background(Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(theme.accent.opacity(0.25)))
            .onTapGesture(count: 2) { scanner.preview(page) }
            Text("Strona \(index + 1)").font(.caption.weight(.semibold))
            HStack(spacing: 8) {
                Button { scanner.preview(page) } label: { Image(systemName: "eye") }.help("Podgląd strony")
                Button { scanner.move(page, by: -1) } label: { Image(systemName: "arrow.left") }.help("Wcześniej").disabled(index == 0)
                Button { scanner.move(page, by: 1) } label: { Image(systemName: "arrow.right") }.help("Później").disabled(index == scanner.pages.count - 1)
                Button(role: .destructive) { scanner.remove(page) } label: { Image(systemName: "trash") }.help("Usuń stronę")
            }
            .buttonStyle(.borderless)
            .disabled(scanner.busy || merging)
        }
        .padding(8)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 8))
    }

    private func close() {
        if scanner.pages.isEmpty { scanner.cancel(); dismiss() } else { confirmClose = true }
    }

    private func finish() async {
        guard !scanner.pages.isEmpty, !merging else { return }
        merging = true
        defer { merging = false }
        do {
            let data = try await scanner.makePDF()
            if let maxBytes, data.count > maxBytes {
                scanner.error = "Połączony plik ma \(DocumentScanner.size(data.count)) — limit to \(DocumentScanner.size(maxBytes)). Zeskanuj część stron w niższej jakości (np. 200 DPI) albo w skali szarości."
                return
            }
            let count = scanner.pages.count
            onFinish(data, count)
            dismiss()
        } catch {
            scanner.error = error.localizedDescription
        }
    }
}

/// Mavinci → „Skanuj dokument do PDF…”: skan kilku stron i zapis PDF w wybranym miejscu (domyślnie Pobrane).
enum DocumentScanSaver {
    @MainActor static func save(_ data: Data, pages: Int, workspace: Workspace) {
        // Po zamknięciu arkusza skanera — okno zapisu nie nakłada się na arkusz.
        DispatchQueue.main.async {
            MainActor.assumeIsolated {
                let panel = NSSavePanel()
                panel.title = "Zapisz skan"
                panel.allowedContentTypes = [.pdf]
                panel.canCreateDirectories = true
                panel.directoryURL = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
                panel.nameFieldStringValue = "Skan \(MeetingDates.format(Date(), "yyyy-MM-dd HH.mm")).pdf"
                guard panel.runModal() == .OK, let url = panel.url else { return }
                do {
                    try data.write(to: url, options: .atomic)
                    workspace.succeed("Zapisano skan (\(DocumentScanner.pagesLabel(pages))) — \(url.lastPathComponent).")
                } catch {
                    workspace.error = "Nie udało się zapisać pliku: \(error.localizedDescription)"
                }
            }
        }
    }
}

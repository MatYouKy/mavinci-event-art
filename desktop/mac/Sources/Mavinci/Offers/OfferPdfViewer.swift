import SwiftUI
import PDFKit

// MARK: „Pokaż PDF” — podgląd zapisanego PDF oferty w oknie aplikacji (PDFKit): przewijanie stron, powiększenie,
// dopasowanie do okna, numer strony, drukowanie, zapis w Pobranych i — opcjonalnie — otwarcie w Podglądzie.

/// Plik PDF oferty pobrany do podglądu.
struct OfferPdfPreview: Identifiable {
    let data: Data
    let name: String
    let id = UUID()
}

/// Widok PDFKit sterowany z paska okna (powiększenie, drukowanie, numer strony).
@MainActor final class OfferPdfController: ObservableObject {
    let view = PDFView()
    @Published private(set) var page = 1
    @Published private(set) var pages = 0
    private var observer: NSObjectProtocol?

    init(data: Data) {
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displaysPageBreaks = true
        view.backgroundColor = .underPageBackgroundColor
        view.document = PDFDocument(data: data)
        pages = view.document?.pageCount ?? 0
        observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: view, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshPage() }
        }
    }

    /// Koniec obserwowania zmian strony (zamknięcie okna).
    func stop() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
    }

    var loaded: Bool { view.document != nil }

    private func refreshPage() {
        guard let document = view.document, let current = view.currentPage else { return }
        page = document.index(for: current) + 1
    }

    func zoomIn() { view.zoomIn(nil) }
    func zoomOut() { view.zoomOut(nil) }
    func fit() { view.autoScales = true }
    func printDocument() { view.print(with: NSPrintInfo.shared, autoRotate: true) }
}

private struct OfferPdfKitView: NSViewRepresentable {
    let controller: OfferPdfController
    func makeNSView(context: Context) -> PDFView { controller.view }
    func updateNSView(_ nsView: PDFView, context: Context) {}
}

@MainActor struct OfferPdfViewer: View {
    let file: OfferPdfPreview
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @StateObject private var controller: OfferPdfController

    init(file: OfferPdfPreview) {
        self.file = file
        _controller = StateObject(wrappedValue: OfferPdfController(data: file.data))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(file.name).font(.headline).lineLimit(1).truncationMode(.middle)
                    if controller.pages > 0 {
                        Text("Strona \(controller.page) z \(controller.pages)").font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                ControlGroup {
                    Button { controller.zoomOut() } label: { Image(systemName: "minus.magnifyingglass") }.help("Pomniejsz")
                    Button { controller.fit() } label: { Image(systemName: "arrow.up.left.and.down.right.magnifyingglass") }.help("Dopasuj do okna")
                    Button { controller.zoomIn() } label: { Image(systemName: "plus.magnifyingglass") }.help("Powiększ")
                }
                .fixedSize()
                Button { controller.printDocument() } label: { Label("Drukuj", systemImage: "printer") }
                    .keyboardShortcut("p", modifiers: .command)
                Button { download() } label: { Label("Pobierz", systemImage: "arrow.down.doc") }
                Button { openExternally() } label: { Label("Otwórz w Podglądzie", systemImage: "arrow.up.forward.app") }
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction).buttonStyle(.borderedProminent)
            }
            .controlSize(.small)
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            if controller.loaded {
                OfferPdfKitView(controller: controller)
            } else {
                ContentUnavailableView("Nie udało się odczytać pliku PDF", systemImage: "doc.questionmark",
                                       description: Text("Pobierz plik albo otwórz go w Podglądzie."))
            }
        }
        .frame(minWidth: 820, idealWidth: 1000, minHeight: 700, idealHeight: 1000)
        .onDisappear { controller.stop() }
    }

    private func download() {
        do {
            _ = try ContractFiles.saveToDownloads(file.data, name: file.name)
            state.succeed("PDF zapisany w Pobranych")
        } catch {
            state.error = "Nie udało się zapisać PDF w Pobranych."
        }
    }

    private func openExternally() {
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Mavinci-oferty", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let target = folder.appendingPathComponent(file.name)
            try file.data.write(to: target, options: .atomic)
            NSWorkspace.shared.open(target)
        } catch {
            state.error = "Nie udało się otworzyć PDF."
        }
    }
}

import AppKit
import SwiftUI

// MARK: Okno „Dopasuj dokument do płatności”
//
// Zamiast arkusza przyklejonego do okna uzgodnienia — osobne okno w rozmiarze dawnego okna modalnego (jak okno nowej
// wiadomości): można je przesunąć, zmniejszyć albo powiększyć i zerknąć na listę operacji pod spodem. Okno pływa nad
// oknami Mavinci — także nad oknem na pełnym ekranie, na tym samym biurku (nie otwiera się jako nowe okno pełnoekranowe ani
// karta) — chowa się po przejściu do innej aplikacji i wraca razem z Mavinci. Jedno okno na płatność: ponowne „Wybierz
// dokument” pokazuje okno już otwarte. Dopasowanie zamyka okno; lista operacji odświeża się jak dotąd.

@MainActor final class BankMatchWindows {
    static let shared = BankMatchWindows()
    /// Otwarte okna — identyfikator operacji z wyciągu.
    private var panels: [String: NSPanel] = [:]
    private var observers: [String: NSObjectProtocol] = [:]

    /// Rozmiar treści przy otwarciu (jak dawne okno modalne), w granicach ekranu.
    private static let openSize = NSSize(width: 1000, height: 720)

    func open(store: FinanceBankStore, tx: BankTx, workspace: Workspace) {
        if let panel = panels[tx.id] {
            panel.makeKeyAndOrderFront(nil)
            return
        }
        let anchor = NSApp.keyWindow ?? NSApp.mainWindow
        let id = tx.id
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: Self.openSize),
                            styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: true)
        panel.title = "Dopasuj dokument do płatności"
        panel.subtitle = [FinFormat.day(tx.date), tx.signedAmount, tx.displayName].joined(separator: " · ")
        // Nad oknami Mavinci (także na pełnym ekranie, na tym samym biurku), schowane, gdy pracujesz w innej aplikacji.
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.isReleasedWhenClosed = false
        panel.tabbingMode = .disallowed
        panel.collectionBehavior = [.fullScreenAuxiliary]
        panel.minSize = NSSize(width: 640, height: 420)
        panel.appearance = NSAppearance(named: workspace.theme.scheme == .dark ? .darkAqua : .aqua)

        let root = WorkspaceScene(workspace: workspace) {
            BankDocumentPickerSheet(store: store, tx: tx, onClose: { [weak self] in self?.close(id) })
        }
        let controller = NSHostingController(rootView: root)
        // Rozmiar okna ustala okno (przesuwanie i skalowanie), a nie treść.
        controller.sizingOptions = []
        panel.contentViewController = controller

        let screen = (anchor?.screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let content = NSSize(width: min(Self.openSize.width, screen.width - 40), height: min(Self.openSize.height, screen.height - 60))
        var frame = panel.frameRect(forContentRect: NSRect(origin: .zero, size: content))
        let center = anchor.map { NSPoint(x: $0.frame.midX, y: $0.frame.midY) } ?? NSPoint(x: screen.midX, y: screen.midY)
        frame.origin.x = min(max(center.x - frame.width / 2, screen.minX), screen.maxX - frame.width)
        frame.origin.y = min(max(center.y - frame.height / 2, screen.minY), screen.maxY - frame.height)
        panel.setFrame(frame, display: false)

        panels[id] = panel
        observers[id] = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: panel, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.closed(id) }
        }
        panel.makeKeyAndOrderFront(nil)
    }

    /// Zamknięcie okna płatności (po dopasowaniu albo „Zamknij”).
    func close(_ id: String) {
        panels[id]?.close()
    }

    /// Okno zamknięte (przyciskiem okna, „Zamknij” albo po dopasowaniu) — treść i sklep banku, który trzyma, są zwalniane.
    private func closed(_ id: String) {
        if let observer = observers.removeValue(forKey: id) { NotificationCenter.default.removeObserver(observer) }
        guard let panel = panels.removeValue(forKey: id) else { return }
        Task { @MainActor [weak panel] in panel?.contentViewController = nil }
    }
}

import SwiftUI
import AppKit

/// Panele obok siebie z przesuwanymi granicami (natywny `NSSplitView`). Szerokości paneli zapisują się ok. 1 s po ostatniej
/// zmianie i wracają po powrocie do sekcji i po ponownym uruchomieniu aplikacji. Ostatni panel zajmuje resztę okna,
/// a przy zmianie rozmiaru okna pozostałe panele zachowują swoją szerokość.
struct PersistentSplitView: NSViewControllerRepresentable {
    struct Pane {
        let view: AnyView
        let min: CGFloat
        let ideal: CGFloat
        var max: CGFloat? = nil
    }
    /// Klucz zapisu (np. „messages”) — osobny dla każdego ekranu.
    let id: String
    let panes: [Pane]

    func makeNSViewController(context: Context) -> Controller { Controller(id: id, panes: panes) }
    func updateNSViewController(_ controller: Controller, context: Context) { controller.update(panes) }

    final class Controller: NSSplitViewController {
        private let key: String
        private let ideals: [CGFloat]
        private var hosts: [NSHostingController<AnyView>] = []
        private var restored = false
        private var saveWork: DispatchWorkItem?
        private var observers: [NSObjectProtocol] = []

        init(id: String, panes: [Pane]) {
            key = "split-widths-\(id)"
            ideals = panes.map(\.ideal)
            super.init(nibName: nil, bundle: nil)
            splitView.isVertical = true
            splitView.dividerStyle = .thin
            for (index, pane) in panes.enumerated() {
                let host = NSHostingController(rootView: pane.view)
                host.sizingOptions = []
                let item = NSSplitViewItem(viewController: host)
                item.minimumThickness = pane.min
                if let max = pane.max { item.maximumThickness = max }
                item.canCollapse = false
                // Pierwsze panele trzymają szerokość, ostatni (treść) przejmuje zmianę rozmiaru okna.
                item.holdingPriority = index == panes.count - 1 ? .defaultLow : NSLayoutConstraint.Priority(rawValue: 270 - Float(index) * 5)
                addSplitViewItem(item)
                hosts.append(host)
            }
            observers.append(NotificationCenter.default.addObserver(forName: NSSplitView.didResizeSubviewsNotification, object: splitView, queue: .main) { [weak self] _ in
                self?.scheduleSave()
            })
            // Zamknięcie aplikacji tuż po przesunięciu granicy — zapis bez czekania.
            observers.append(NotificationCenter.default.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
                self?.flush()
            })
        }
        required init?(coder: NSCoder) { fatalError("init(coder:) nie jest używany") }
        deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }

        func update(_ panes: [Pane]) {
            for (host, pane) in zip(hosts, panes) { host.rootView = pane.view }
        }

        override func viewDidLayout() {
            super.viewDidLayout()
            guard !restored, view.window != nil, splitView.bounds.width > 0 else { return }
            restored = true
            let saved = (UserDefaults.standard.array(forKey: key) as? [Double])?.map { CGFloat($0) }
            let widths = saved?.count == hosts.count - 1 ? saved! : Array(ideals.dropLast())
            var position: CGFloat = 0
            for (index, width) in widths.enumerated() {
                position += width
                splitView.setPosition(position, ofDividerAt: index)
                position += splitView.dividerThickness
            }
        }

        override func viewWillDisappear() {
            super.viewWillDisappear()
            flush()
        }
        /// Zapis oczekującej zmiany od razu (wyjście z sekcji, zamknięcie aplikacji).
        private func flush() {
            guard let work = saveWork else { return }
            work.cancel(); saveWork = nil
            save()
        }

        private func scheduleSave() {
            guard restored else { return }
            saveWork?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.saveWork = nil; self?.save() }
            saveWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2, execute: work)
        }
        private func save() {
            let widths = splitViewItems.dropLast().map { Double($0.viewController.view.frame.width) }
            guard widths.allSatisfy({ $0 > 0 }) else { return }
            UserDefaults.standard.set(widths, forKey: key)
        }
    }
}

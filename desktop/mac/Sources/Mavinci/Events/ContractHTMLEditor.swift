import AppKit
import SwiftUI
import WebKit

// MARK: Edytor treści umowy w WebKit (`contenteditable`) — jak edytor umowy wydarzenia w CRM (`edit-wysiwyg?contractId=…`)
// i pola z formatowaniem w „Edytuj pola i warunki” (`ContractVariableHtmlField`). Treść dokumentu nie uruchamia skryptów
// (`allowsContentJavaScript = false`), polecenia edytora działają w osobnym świecie skryptów aplikacji. Wklejanie — jako
// zwykły tekst (bez obcych stylów). Strukturę list i paragrafów porządkuje przy zapisie ten sam kod co w CRM (silnik umów).

@MainActor final class ContractHTMLEditorController: NSObject, ObservableObject {
    enum Mode { case document, field }
    struct Marks: Equatable {
        var bold = false
        var italic = false
        var underline = false
        var strike = false
        var unordered = false
        var ordered = false
    }

    let mode: Mode
    let html: String
    let css: String
    let font: String
    let lineHeight: Double
    @Published fileprivate(set) var ready = false
    /// Treść zmieniona w edytorze (zdarzenie `input` albo polecenie z paska).
    @Published fileprivate(set) var dirty = false
    @Published fileprivate(set) var marks = Marks()
    fileprivate weak var webView: WKWebView?

    init(mode: Mode, html: String, css: String, font: String = "", lineHeight: Double = 1.6) {
        self.mode = mode
        self.html = html
        self.css = css
        self.font = font
        self.lineHeight = lineHeight
    }

    // MARK: Polecenia

    /// `document.execCommand` (pogrubienie, listy, cofnij…) na zapamiętanym zaznaczeniu.
    func exec(_ command: String) { run("return window.__mavinciEditor ? window.__mavinciEditor.exec(command) : false", ["command": command]) }
    /// Wyrównanie akapitów pod zaznaczeniem (jak `execCommand('justify…')` w CRM — styl `text-align` bloków).
    func align(_ value: String) { run("return window.__mavinciEditor ? window.__mavinciEditor.align(value) : false", ["value": value]) }
    /// Wcięcie / zmniejszenie wcięcia (Tab / Shift+Tab).
    func indent(_ outdent: Bool) { run("return window.__mavinciEditor ? window.__mavinciEditor.indent(outdent) : false", ["outdent": outdent]) }
    /// „§+ Nowy paragraf” — nagłówek paragrafu z numerem nadawanym przy zapisie.
    func insertParagraph() { run("return window.__mavinciEditor ? window.__mavinciEditor.paragraph() : false", [:]) }

    /// Bieżąca treść edytora (`innerHTML`).
    func currentHTML() async throws -> String {
        guard let webView else { throw AppError.invalidResponse }
        return try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript("return document.getElementById('mavinci-editor').innerHTML", arguments: [:], in: nil, in: .defaultClient) { result in
                switch result {
                case .success(let value): continuation.resume(returning: value as? String ?? "")
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
    }

    private func run(_ body: String, _ arguments: [String: Any]) {
        guard let webView, ready else { return }
        webView.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .defaultClient) { [weak self] result in
            guard case .success(let value) = result, (value as? Bool) == true else { return }
            Task { @MainActor in self?.dirty = true }
        }
    }

    fileprivate func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "ready": ready = true
        case "dirty": dirty = true
        case "marks":
            var next = Marks()
            next.bold = message["bold"] as? Bool ?? false
            next.italic = message["italic"] as? Bool ?? false
            next.underline = message["underline"] as? Bool ?? false
            next.strike = message["strike"] as? Bool ?? false
            next.unordered = message["unordered"] as? Bool ?? false
            next.ordered = message["ordered"] as? Bool ?? false
            if next != marks { marks = next }
        default: break
        }
    }

    // MARK: Dokument

    private static func escapeAttribute(_ value: String) -> String {
        value.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "<", with: "&lt;").replacingOccurrences(of: ">", with: "&gt;")
    }

    /// Strona A4 z treścią jak w edytorze CRM (`contract-a4-page` / `contract-content`) albo pole z ramką.
    fileprivate var document: String {
        let lineHeightText = String(format: "%.2f", lineHeight)
        let fontStyle = font.isEmpty ? "" : "font-family: \(Self.escapeAttribute(font));"
        let chrome: String
        let body: String
        switch mode {
        case .document:
            chrome = """
            html, body { margin: 0; background: #525659; }
            .mavinci-wrap { padding: 24px 0 48px; }
            .contract-a4-page.contract-editor-flow-page { margin: 0 auto; height: auto !important; min-height: 297mm; overflow: visible !important; }
            #mavinci-editor { outline: none; min-height: 230mm; overflow: visible; direction: ltr; unicode-bidi: embed; }
            """
            body = """
            <div class="mavinci-wrap"><div class="contract-a4-page contract-editor-flow-page">\
            <div id="mavinci-editor" class="contract-content contract-template-editor" contenteditable="true" dir="ltr" \
            style="line-height: \(lineHeightText); \(fontStyle)">\(html)</div></div></div>
            """
        case .field:
            chrome = """
            html, body { margin: 0; background: #ffffff; color: #111827; }
            #mavinci-editor { outline: none; min-height: calc(100vh - 24px); padding: 12px; font-size: 14px; white-space: pre-wrap; overflow-x: auto; }
            """
            body = "<div id=\"mavinci-editor\" contenteditable=\"true\" dir=\"ltr\">\(html)</div>"
        }
        return """
        <!doctype html><html lang="pl"><head><meta charset="utf-8"><style>\(css)</style><style>\(chrome)</style></head>
        <body>\(body)</body></html>
        """
    }

    /// Polecenia edytora w świecie skryptów aplikacji (treść strony nie wykonuje JavaScriptu).
    fileprivate static let script = """
    (() => {
      const editor = document.getElementById('mavinci-editor');
      if (!editor) return;
      const post = (message) => { try { window.webkit.messageHandlers.contractEditor.postMessage(message); } catch (e) {} };
      let saved = null;
      let dirty = false;
      const markDirty = () => { if (!dirty) { dirty = true; post({ type: 'dirty' }); } };
      const inside = (node) => node && editor.contains(node.nodeType === 3 ? node.parentNode : node);
      const remember = () => {
        const selection = window.getSelection();
        if (selection && selection.rangeCount && inside(selection.getRangeAt(0).commonAncestorContainer)) {
          saved = selection.getRangeAt(0).cloneRange();
        }
      };
      const restore = () => {
        editor.focus({ preventScroll: true });
        const selection = window.getSelection();
        if (saved && selection) { selection.removeAllRanges(); selection.addRange(saved); }
        return selection && selection.rangeCount ? selection.getRangeAt(0) : null;
      };
      const state = (name) => { try { return document.queryCommandState(name); } catch (e) { return false; } };
      const marks = () => post({
        type: 'marks', bold: state('bold'), italic: state('italic'), underline: state('underline'),
        strike: state('strikeThrough'), unordered: state('insertUnorderedList'), ordered: state('insertOrderedList'),
      });
      const blocksIn = (range, selector) => {
        const node = range.commonAncestorContainer;
        const element = node.nodeType === 3 ? node.parentElement : node;
        const closest = element && element.closest ? element.closest(selector) : null;
        if (range.collapsed) return closest && closest !== editor && editor.contains(closest) ? [closest] : [];
        const all = Array.from(editor.querySelectorAll(selector)).filter((block) => {
          try { return range.intersectsNode(block); } catch (e) { return false; }
        });
        return all.filter((block) => !all.some((other) => other !== block && block.contains(other)));
      };
      document.addEventListener('selectionchange', () => { remember(); marks(); });
      editor.addEventListener('input', markDirty);
      editor.addEventListener('paste', (event) => {
        event.preventDefault();
        const text = (event.clipboardData && event.clipboardData.getData('text/plain')) || '';
        document.execCommand('insertText', false, text);
        markDirty();
      });
      editor.addEventListener('drop', (event) => event.preventDefault());
      editor.addEventListener('keydown', (event) => {
        if (event.key !== 'Tab' || editor.dataset.mode !== 'document') return;
        event.preventDefault();
        window.__mavinciEditor.indent(event.shiftKey);
      });
      editor.addEventListener('click', (event) => {
        const link = event.target && event.target.closest ? event.target.closest('a') : null;
        if (link) event.preventDefault();
      });
      window.__mavinciEditor = {
        exec(command) {
          restore();
          const done = document.execCommand(command, false, null);
          remember(); marks();
          if (done && command !== 'undo' && command !== 'redo') markDirty();
          if (command === 'undo' || command === 'redo') markDirty();
          return done;
        },
        align(value) {
          const range = restore();
          if (!range) return false;
          const blocks = blocksIn(range, 'p, pre, li, h1, h2, h3, h4, h5, h6, [data-contract-paragraph="true"], .contract-paragraph-heading, div');
          if (blocks.length === 0) {
            const command = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[value];
            if (command) document.execCommand(command, false, null);
          } else {
            blocks.forEach((block) => { block.style.textAlign = value; });
          }
          markDirty();
          return true;
        },
        indent(outdent) {
          const range = restore();
          if (!range) return false;
          const node = range.commonAncestorContainer;
          const element = node.nodeType === 3 ? node.parentElement : node;
          const item = element && element.closest ? element.closest('li') : null;
          if (item && editor.contains(item)) {
            document.execCommand(outdent ? 'outdent' : 'indent', false, null);
            markDirty();
            return true;
          }
          const blocks = blocksIn(range, 'p, div, h1, h2, h3, h4, h5, h6, blockquote, pre');
          if (blocks.length === 0) {
            if (!outdent) document.execCommand('insertHTML', false, '&emsp;');
            markDirty();
            return true;
          }
          blocks.forEach((block) => {
            const classIndent = Array.from(block.classList).map((name) => (name.match(/^ql-indent-(\\d+)$/) || [])[1]).find(Boolean);
            const savedLevel = Number(block.dataset.editorIndent || classIndent || 0);
            const margin = block.style.marginLeft || '';
            const marginLevel = margin.endsWith('mm') ? Math.round((parseFloat(margin) || 0) / 12.7)
              : margin.endsWith('em') ? Math.round((parseFloat(margin) || 0) / 1.5) : 0;
            const next = Math.min(8, Math.max(0, Math.max(savedLevel, marginLevel) + (outdent ? -1 : 1)));
            Array.from(block.classList).filter((name) => /^ql-indent-\\d+$/.test(name)).forEach((name) => block.classList.remove(name));
            if (next === 0) {
              delete block.dataset.editorIndent;
              block.style.removeProperty('margin-left');
            } else {
              block.dataset.editorIndent = String(next);
              block.style.marginLeft = `${next * 12.7}mm`;
            }
          });
          markDirty();
          return true;
        },
        paragraph() {
          const range = restore();
          if (!range) return false;
          const paragraph = document.createElement('p');
          paragraph.style.fontWeight = 'bold';
          paragraph.style.textAlign = 'center';
          paragraph.style.margin = '1.5em 0';
          paragraph.setAttribute('data-contract-paragraph', 'true');
          paragraph.textContent = '§n ';
          // Nowy akapit za blokiem pod kursorem (lista — za całą listą), żeby nie zagnieżdżać akapitu w akapicie.
          const node = range.commonAncestorContainer;
          const element = node.nodeType === 3 ? node.parentElement : node;
          let block = element && element.closest ? element.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, div') : null;
          if (block && block !== editor && editor.contains(block)) {
            let list = block.closest('ol, ul');
            while (list && list.parentElement && list.parentElement !== editor && list.parentElement.closest('ol, ul')) {
              list = list.parentElement.closest('ol, ul');
            }
            if (list && editor.contains(list)) block = list;
            while (block.parentElement && block.parentElement !== editor && !block.parentElement.classList.contains('product-contract-clause')) {
              block = block.parentElement;
            }
            block.after(paragraph);
          } else {
            range.insertNode(paragraph);
          }
          const text = paragraph.firstChild;
          const selection = window.getSelection();
          if (text && selection) {
            const caret = document.createRange();
            caret.setStart(text, text.textContent.length);
            caret.collapse(true);
            selection.removeAllRanges();
            selection.addRange(caret);
          }
          markDirty();
          return true;
        },
      };
      post({ type: 'ready' });
    })();
    """
}

/// Pośrednik obsługi wiadomości (bez cyklu: kontroler WebKit trzyma pośrednika, pośrednik — słabą referencję).
private final class ContractEditorMessages: NSObject, WKScriptMessageHandler {
    weak var controller: ContractHTMLEditorController?
    init(_ controller: ContractHTMLEditorController) { self.controller = controller }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        Task { @MainActor [weak controller] in controller?.receive(body) }
    }
}

struct ContractHTMLEditorView: NSViewRepresentable {
    @ObservedObject var controller: ContractHTMLEditorController

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let content = WKUserContentController()
        let mode = controller.mode == .document ? "document" : "field"
        let source = "(() => { const editor = document.getElementById('mavinci-editor'); if (editor) editor.dataset.mode = '\(mode)'; })();\n"
            + ContractHTMLEditorController.script
        content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        content.add(ContractEditorMessages(controller), contentWorld: .defaultClient, name: "contractEditor")
        configuration.userContentController = content
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = true
        view.underPageBackgroundColor = controller.mode == .document ? NSColor(srgbRed: 0x52 / 255, green: 0x56 / 255, blue: 0x59 / 255, alpha: 1) : .white
        controller.webView = view
        view.loadHTMLString(controller.document, baseURL: nil)
        return view
    }

    func updateNSView(_ view: WKWebView, context: Context) {}

    static func dismantleNSView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeAllScriptMessageHandlers()
    }

    /// Tylko wczytanie dokumentu — linki i inne przejścia są blokowane.
    final class Coordinator: NSObject, WKNavigationDelegate {
        private var loaded = false
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if !loaded && action.navigationType == .other && (action.request.url?.scheme == "about" || action.request.url == nil) {
                loaded = true
                decisionHandler(.allow)
                return
            }
            decisionHandler(.cancel)
        }
    }
}

/// Pasek poleceń edytora: cofnij / ponów, pogrubienie, kursywa, podkreślenie, przekreślenie, wyrównanie, listy, wcięcia, paragraf.
struct ContractHTMLEditorToolbar: View {
    @ObservedObject var controller: ContractHTMLEditorController
    var paragraphs = true

    private func button(_ symbol: String, _ help: String, active: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).frame(width: 18, height: 16)
        }
        .buttonStyle(.bordered)
        .tint(active ? Color.accentColor : nil)
        .help(help)
    }

    var body: some View {
        HStack(spacing: 6) {
            button("arrow.uturn.backward", "Cofnij (⌘Z)") { controller.exec("undo") }
            button("arrow.uturn.forward", "Ponów (⇧⌘Z)") { controller.exec("redo") }
            Divider().frame(height: 18)
            button("bold", "Pogrubienie", active: controller.marks.bold) { controller.exec("bold") }
            button("italic", "Kursywa", active: controller.marks.italic) { controller.exec("italic") }
            button("underline", "Podkreślenie", active: controller.marks.underline) { controller.exec("underline") }
            button("strikethrough", "Przekreślenie", active: controller.marks.strike) { controller.exec("strikeThrough") }
            Divider().frame(height: 18)
            button("text.alignleft", "Do lewej") { controller.align("left") }
            button("text.aligncenter", "Wyśrodkuj") { controller.align("center") }
            button("text.alignright", "Do prawej") { controller.align("right") }
            button("text.justify", "Wyjustuj") { controller.align("justify") }
            Divider().frame(height: 18)
            button("list.bullet", "Lista", active: controller.marks.unordered) { controller.exec("insertUnorderedList") }
            button("list.number", "Punkt główny: 1., 2., 3.", active: controller.marks.ordered) { controller.exec("insertOrderedList") }
            button("increase.indent", "Podpunkt / wcięcie (Tab)") { controller.indent(false) }
            button("decrease.indent", "Poziom wyżej / mniejsze wcięcie (Shift+Tab)") { controller.indent(true) }
            if paragraphs {
                Divider().frame(height: 18)
                Button { controller.insertParagraph() } label: { Text("§+ Nowy paragraf") }
                    .buttonStyle(.bordered)
                    .help("Nowy paragraf (§) — numer zostanie nadany przy zapisie")
            }
        }
        .disabled(!controller.ready)
    }
}

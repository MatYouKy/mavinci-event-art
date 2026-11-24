import AppKit
import SwiftUI
import WebKit

// MARK: Treść nowej wiadomości z formatowaniem (jak w Thunderbirdzie)
//
// Edytor HTML w `WKWebView` (`contenteditable`): pogrubienie, kursywa, podkreślenie, przekreślenie, rozmiar i kolor tekstu,
// wypunktowanie i numeracja, wcięcia, wyrównanie, linki i „Wyczyść formatowanie”. Treść ma ten sam krój, rozmiar i odstępy co
// wiadomość u odbiorcy (Arial 14 px, interlinia 1,6, wiersze bez dodatkowych odstępów), a pod treścią — stopka wybranej skrzynki,
// tak jak zobaczy ją odbiorca (stopki nie edytuje się tutaj). Do wysyłki idzie HTML z odstępami zapisanymi w stylach
// (serwer zostawia tylko znaczniki formatowania — `sanitizeMailContentHtml`) i zwykły tekst. Pliki upuszczone na treść trafiają
// do załączników (okno wiadomości). Wklejony tekst zachowuje pogrubienia, kursywę, podkreślenia, listy, wyrównanie i linki
// (bez obcych krojów, kolorów tła i obrazów).

/// Stan formatowania w miejscu kursora (podświetlenie przycisków paska).
struct MailEditorState: Equatable {
    var bold = false
    var italic = false
    var underline = false
    var strike = false
    var bullets = false
    var numbers = false
    var align = "left"
    /// Adres linku pod kursorem (pusty — poza linkiem).
    var link = ""
}

/// Edytor treści i pasek formatowania: polecenia w `WKWebView` (skrypt edytora działa w osobnym świecie skryptów aplikacji,
/// treść i stopka nie uruchamiają własnych skryptów), stan formatowania i zmiany treści z edytora.
@MainActor final class MailEditorController: NSObject, ObservableObject {
    @Published fileprivate(set) var state = MailEditorState()
    /// Prośba o okno linku (⌘K w treści).
    @Published fileprivate(set) var linkRequest = 0
    fileprivate weak var webView: WKWebView?
    /// Zmiana treści: HTML do wysyłki i zwykły tekst (z krótkim opóźnieniem po pisaniu).
    fileprivate var onChange: ((_ html: String, _ text: String) -> Void)?
    private let initialHTML: String
    private var ready = false
    private var signatureHTML = ""
    private var appliedSignature: String?

    init(initialHTML: String) {
        self.initialHTML = initialHTML
    }

    private func run(_ body: String, _ arguments: [String: Any]) {
        webView?.callAsyncJavaScript(body, arguments: arguments, in: nil, in: .defaultClient, completionHandler: nil)
    }

    /// Polecenie edycji (`bold`, `italic`, `underline`, `strikeThrough`, `insertUnorderedList`, `insertOrderedList`, `indent`,
    /// `outdent`, `justifyLeft`, `justifyCenter`, `justifyRight`, `justifyFull`, `removeFormat`, `unlink`).
    func exec(_ command: String) { run("return window.__mail ? window.__mail.exec(command) : false", ["command": command]) }
    /// Rozmiar zaznaczonego tekstu w pikselach (14 — zwykły).
    func size(_ pixels: Int) { run("return window.__mail ? window.__mail.size(pixels) : false", ["pixels": pixels]) }
    /// Kolor zaznaczonego tekstu (`#rrggbb`).
    func color(_ hex: String) { run("return window.__mail ? window.__mail.color(hex) : false", ["hex": hex]) }
    /// Link dla zaznaczenia (bez zaznaczenia — wstawia adres jako link).
    func link(_ url: String) { run("return window.__mail ? window.__mail.link(url) : false", ["url": url]) }

    /// Stopka wybranej skrzynki pod treścią (pusta — bez stopki).
    fileprivate func setSignature(_ html: String) {
        signatureHTML = html
        applySignature()
    }

    private func applySignature() {
        guard ready, appliedSignature != signatureHTML else { return }
        appliedSignature = signatureHTML
        run("return window.__mail ? window.__mail.setSignature(html) : false", ["html": signatureHTML])
    }

    fileprivate func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "ready":
            ready = true
            run("return window.__mail ? window.__mail.setContent(html) : false", ["html": initialHTML])
            applySignature()
        case "change":
            onChange?(message["html"] as? String ?? "", message["text"] as? String ?? "")
        case "state":
            let next = MailEditorState(
                bold: message["bold"] as? Bool ?? false, italic: message["italic"] as? Bool ?? false,
                underline: message["underline"] as? Bool ?? false, strike: message["strike"] as? Bool ?? false,
                bullets: message["bullets"] as? Bool ?? false, numbers: message["numbers"] as? Bool ?? false,
                align: message["align"] as? String ?? "left", link: message["link"] as? String ?? "")
            if state != next { state = next }
        case "link":
            linkRequest += 1
        default:
            break
        }
    }
}

/// Pośrednik komunikatów edytora (bez cyklu: WebKit trzyma pośrednika, pośrednik — słabą referencję do kontrolera).
private final class MailEditorMessages: NSObject, WKScriptMessageHandler {
    weak var controller: MailEditorController?
    init(_ controller: MailEditorController) { self.controller = controller }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let body = message.body
        Task { @MainActor [weak controller] in controller?.receive(body) }
    }
}

/// Pole treści wiadomości: edytor z formatowaniem i stopka skrzynki pod treścią.
struct MailRichEditor: NSViewRepresentable {
    @ObservedObject var controller: MailEditorController
    let signatureHTML: String
    let onChange: (_ html: String, _ text: String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> MailEditorWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let content = WKUserContentController()
        content.addUserScript(WKUserScript(source: MailEditorDocument.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
        content.add(MailEditorMessages(controller), contentWorld: .defaultClient, name: "mailEditor")
        configuration.userContentController = content
        let view = MailEditorWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = false
        view.allowsMagnification = false
        view.underPageBackgroundColor = .white
        controller.webView = view
        controller.onChange = onChange
        controller.setSignature(signatureHTML)
        view.loadHTMLString(MailEditorDocument.html, baseURL: nil)
        return view
    }

    func updateNSView(_ view: MailEditorWebView, context: Context) {
        controller.webView = view
        controller.onChange = onChange
        controller.setSignature(signatureHTML)
    }

    static func dismantleNSView(_ view: MailEditorWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeAllScriptMessageHandlers()
        view.navigationDelegate = nil
    }

    /// Tylko wczytanie dokumentu edytora — linki w treści i stopce się nie otwierają, upuszczone pliki nie zastępują edytora.
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

/// Edytor nie przyjmuje przeciąganych plików ani adresów — trafiają do okna wiadomości (`ComposeSheet.onDrop` → załączniki),
/// przeciągnięty tekst wstawia się jak zwykle.
final class MailEditorWebView: WKWebView {
    private static let blocked: Set<String> = [
        NSPasteboard.PasteboardType.fileURL.rawValue, NSPasteboard.PasteboardType.URL.rawValue, "NSFilenamesPboardType",
        "Apple URL pasteboard type", "WebURLsWithTitlesPboardType", "CorePasteboardFlavorType 0x75726C20",
    ]
    override func registerForDraggedTypes(_ newTypes: [NSPasteboard.PasteboardType]) {
        super.registerForDraggedTypes(newTypes.filter { !Self.blocked.contains($0.rawValue) })
    }
}

/// Zwykły tekst (np. przekazywana wiadomość) → wiersze edytora.
enum MailEditorText {
    static func html(_ text: String) -> String {
        let lines = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        return lines.map { line in
            let escaped = line.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\t", with: "    ")
            return escaped.isEmpty ? "<div><br></div>" : "<div>\(escaped)</div>"
        }.joined()
    }
}

// MARK: Pasek formatowania

@MainActor struct MailEditorToolbar: View {
    @ObservedObject var controller: MailEditorController
    @Environment(\.crmTheme) private var theme
    @State private var linkOpen = false
    @State private var linkURL = ""

    private struct Choice: Identifiable {
        let name: String
        let value: String
        var id: String { value }
    }
    /// Kolory tekstu („Automatyczny” — kolor treści wiadomości).
    private static let colors = [
        Choice(name: "Automatyczny", value: "#1c1f33"), Choice(name: "Szary", value: "#6b7280"), Choice(name: "Czerwony", value: "#c0392b"),
        Choice(name: "Pomarańczowy", value: "#d35400"), Choice(name: "Złoty", value: "#a8842c"), Choice(name: "Zielony", value: "#2e7d32"),
        Choice(name: "Niebieski", value: "#1a5fb4"), Choice(name: "Bordowy", value: "#7f1734"),
    ]
    /// Rozmiary tekstu w pikselach (14 — zwykły rozmiar treści wiadomości).
    private static let sizes = [
        Choice(name: "Mały", value: "12"), Choice(name: "Zwykły", value: "14"), Choice(name: "Duży", value: "18"), Choice(name: "Bardzo duży", value: "22"),
    ]

    var body: some View {
        HStack(spacing: 2) {
            toggle("bold", "Pogrubienie (⌘B)", on: controller.state.bold) { controller.exec("bold") }
            toggle("italic", "Kursywa (⌘I)", on: controller.state.italic) { controller.exec("italic") }
            toggle("underline", "Podkreślenie (⌘U)", on: controller.state.underline) { controller.exec("underline") }
            toggle("strikethrough", "Przekreślenie", on: controller.state.strike) { controller.exec("strikeThrough") }
            Menu {
                ForEach(Self.sizes) { item in Button(item.name) { controller.size(Int(item.value) ?? 14) } }
            } label: { Image(systemName: "textformat.size") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Rozmiar tekstu")
            Menu {
                ForEach(Self.colors) { item in
                    Button { controller.color(item.value) } label: {
                        Label { Text(item.name) } icon: { Image(nsImage: Self.swatch(item.value)) }
                    }
                }
            } label: { Image(systemName: "paintpalette") }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().help("Kolor tekstu")
            separator
            toggle("list.bullet", "Wypunktowanie", on: controller.state.bullets) { controller.exec("insertUnorderedList") }
            toggle("list.number", "Numeracja", on: controller.state.numbers) { controller.exec("insertOrderedList") }
            toggle("decrease.indent", "Zmniejsz wcięcie", on: false) { controller.exec("outdent") }
            toggle("increase.indent", "Zwiększ wcięcie", on: false) { controller.exec("indent") }
            separator
            toggle("text.alignleft", "Do lewej", on: controller.state.align == "left") { controller.exec("justifyLeft") }
            toggle("text.aligncenter", "Wyśrodkuj", on: controller.state.align == "center") { controller.exec("justifyCenter") }
            toggle("text.alignright", "Do prawej", on: controller.state.align == "right") { controller.exec("justifyRight") }
            toggle("text.justify", "Wyjustuj", on: controller.state.align == "justify") { controller.exec("justifyFull") }
            separator
            toggle("link", "Wstaw link (⌘K)", on: !controller.state.link.isEmpty) { openLink() }
                .popover(isPresented: $linkOpen, arrowEdge: .bottom) { linkPopover }
            toggle("eraser", "Wyczyść formatowanie", on: false) { controller.exec("removeFormat") }
            Spacer(minLength: 0)
        }
        .controlSize(.small)
        .onChange(of: controller.linkRequest) { _, _ in openLink() }
    }

    private var separator: some View { Divider().frame(height: 16).padding(.horizontal, 4) }

    private func toggle(_ symbol: String, _ help: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .frame(width: 24, height: 22)
                .background(on ? theme.accent.opacity(0.22) : Color.clear, in: RoundedRectangle(cornerRadius: 5))
                .foregroundStyle(on ? theme.accent : Color.primary)
        }
        .buttonStyle(.borderless)
        .help(help)
        .accessibilityLabel(help)
    }

    private func openLink() {
        linkURL = controller.state.link
        linkOpen = true
    }

    private var linkPopover: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(controller.state.link.isEmpty ? "Wstaw link" : "Edytuj link").font(.headline)
            TextField("Adres", text: $linkURL, prompt: Text("https://… albo adres e-mail")).textFieldStyle(.roundedBorder).frame(width: 320)
            Text("Zaznaczony tekst stanie się linkiem; bez zaznaczenia wstawimy sam adres.").font(.caption).foregroundStyle(.secondary)
            HStack {
                if !controller.state.link.isEmpty {
                    Button("Usuń link", role: .destructive) { controller.exec("unlink"); linkOpen = false }
                }
                Spacer()
                Button("Anuluj") { linkOpen = false }.keyboardShortcut(.cancelAction)
                Button("Wstaw") {
                    if let url = Self.normalizedURL(linkURL) { controller.link(url) }
                    linkOpen = false
                }
                .keyboardShortcut(.defaultAction)
                .disabled(Self.normalizedURL(linkURL) == nil)
            }
        }
        .padding(14)
    }

    /// „mavinci.pl” → „https://mavinci.pl”, „jan@firma.pl” → „mailto:jan@firma.pl”; inne protokoły niż http(s), mailto i tel — brak.
    static func normalizedURL(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !value.contains(" ") else { return nil }
        let lower = value.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") || lower.hasPrefix("mailto:") || lower.hasPrefix("tel:") { return value }
        if value.contains("@"), !value.contains("/") { return "mailto:" + value }
        if lower.contains(":") { return nil }
        return "https://" + value
    }

    private static func swatch(_ hex: String) -> NSImage {
        let value = Int(hex.dropFirst(), radix: 16) ?? 0
        let color = NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        let image = NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
            NSColor.separatorColor.setStroke()
            NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).stroke()
            return true
        }
        return image
    }
}

// MARK: Dokument edytora

/// Dokument (bez skryptów — `allowsContentJavaScript = false`) i skrypt edytora w świecie `.defaultClient`.
enum MailEditorDocument {
    static let html = #"""
<!doctype html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light">
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; height: 100%; }
  body { color: #1c1f33; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
  #page { box-sizing: border-box; min-height: 100%; padding: 14px 16px 24px; cursor: text; }
  #editor { outline: none; }
  #editor p, #editor div { margin: 0; }
  #editor ul, #editor ol { margin: 0; padding-left: 26px; }
  #editor li { margin: 0; }
  #editor a { color: #7f1734; }
  #editor:empty::before { content: attr(data-placeholder); color: #9aa0a6; }
  #signature { cursor: default; -webkit-user-select: none; user-select: none; }
  #signature img { max-width: 100%; height: auto; }
</style></head>
<body><div id="page"><div id="editor" contenteditable="true" spellcheck="true" data-placeholder="Wpisz treść wiadomości…"></div><div id="signature" title="Stopka wybranej skrzynki — dodawana automatycznie"></div></div>
</body></html>
"""#

    static let script = #"""
(function () {
  const editor = document.getElementById('editor');
  const signature = document.getElementById('signature');
  const page = document.getElementById('page');
  const post = (type, body) => {
    try { window.webkit.messageHandlers.mailEditor.postMessage(Object.assign({ type }, body || {})); } catch (error) {}
  };
  let savedRange = null;
  let timer = null;
  let lastState = '';
  const inEditor = (node) => Boolean(node) && (node === editor || editor.contains(node));
  document.execCommand('defaultParagraphSeparator', false, 'div');

  // HTML do wysyłki: odstępy zapisane w stylach, tak jak w oknie treści (programy poczty nie znają arkusza edytora).
  function serialize() {
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('p, div').forEach((element) => { element.style.margin = '0'; });
    clone.querySelectorAll('ul, ol').forEach((element) => { element.style.margin = '0'; element.style.paddingLeft = '26px'; });
    clone.querySelectorAll('li').forEach((element) => { element.style.margin = '0'; });
    clone.querySelectorAll('a').forEach((element) => { if (!element.style.color) element.style.color = '#7f1734'; });
    return clone.innerHTML;
  }
  function plainText() { return (editor.innerText || '').replace(/ /g, ' '); }
  function notifyNow() { clearTimeout(timer); timer = null; post('change', { html: serialize(), text: plainText() }); }
  function notify() { clearTimeout(timer); timer = setTimeout(notifyNow, 150); }

  function anchorAtSelection() {
    const selection = document.getSelection();
    let node = selection && selection.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
    while (node && node !== editor) { if (node.nodeName === 'A') return node; node = node.parentNode; }
    return null;
  }
  function alignment() {
    if (document.queryCommandState('justifyCenter')) return 'center';
    if (document.queryCommandState('justifyRight')) return 'right';
    if (document.queryCommandState('justifyFull')) return 'justify';
    return 'left';
  }
  function reportState() {
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount || !inEditor(selection.anchorNode)) return;
    savedRange = selection.getRangeAt(0).cloneRange();
    const anchor = anchorAtSelection();
    const state = {
      bold: document.queryCommandState('bold'), italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'), strike: document.queryCommandState('strikeThrough'),
      bullets: document.queryCommandState('insertUnorderedList'), numbers: document.queryCommandState('insertOrderedList'),
      align: alignment(), link: anchor ? (anchor.getAttribute('href') || '') : '',
    };
    const key = JSON.stringify(state);
    if (key !== lastState) { lastState = key; post('state', state); }
  }
  function restore() {
    if (document.activeElement !== editor) editor.focus();
    if (savedRange && inEditor(savedRange.startContainer)) {
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
  }
  function focusEnd() {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = document.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    reportState();
  }
  function done() { notify(); reportState(); }
  const escapeHtml = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Wklejanie: tylko formatowanie treści (bez obcych krojów, tła, obrazów i skryptów).
  const KEEP = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'SPAN', 'SUB', 'SUP']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE',
    'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'VIDEO', 'AUDIO', 'CANVAS', 'PICTURE', 'SOURCE']);
  const BLOCK = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TBODY', 'THEAD', 'TR', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'PRE', 'ADDRESS', 'FIGURE', 'MAIN', 'NAV', 'ASIDE']);
  // Pogrubienie, kursywa, podkreślenie i przekreślenie ze stylów (np. z Dokumentów Google) → znaczniki; wyrównanie bloków zostaje.
  function cleanInto(source, target) {
    source.childNodes.forEach((node) => {
      if (node.nodeType === 3) { target.appendChild(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (DROP.has(tag)) return;
      const style = node.style || {};
      const href = tag === 'A' ? (node.getAttribute('href') || '').trim() : '';
      const plainBold = (tag === 'B' || tag === 'STRONG') && /^(normal|[1-5]00)$/.test(style.fontWeight || '');
      if (!KEEP.has(tag) || plainBold || (tag === 'A' && !/^(https?:\/\/|mailto:|tel:)/i.test(href))) {
        if (BLOCK.has(tag)) { const line = document.createElement('div'); cleanInto(node, line); target.appendChild(line); }
        else { cleanInto(node, target); if (tag === 'TD' || tag === 'TH') target.appendChild(document.createTextNode(' ')); }
        return;
      }
      const copy = document.createElement(tag);
      if (tag === 'A') copy.setAttribute('href', href);
      if (/^(center|right|justify)$/.test(style.textAlign || '') && ['P', 'DIV', 'LI', 'BLOCKQUOTE'].includes(tag)) copy.style.textAlign = style.textAlign;
      let inner = copy;
      const wrap = (name) => { const element = document.createElement(name); inner.appendChild(element); inner = element; };
      const decoration = style.textDecorationLine || style.textDecoration || '';
      if (/^(bold|bolder|[6-9]00)$/.test(style.fontWeight || '') && tag !== 'B' && tag !== 'STRONG') wrap('b');
      if (style.fontStyle === 'italic' && tag !== 'I' && tag !== 'EM') wrap('i');
      if (/underline/.test(decoration) && tag !== 'U') wrap('u');
      if (/line-through/.test(decoration) && !['S', 'STRIKE', 'DEL'].includes(tag)) wrap('s');
      cleanInto(node, inner);
      if (tag === 'SPAN' && !copy.getAttribute('style')) { while (copy.firstChild) target.appendChild(copy.firstChild); }
      else target.appendChild(copy);
    });
  }
  editor.addEventListener('paste', (event) => {
    const data = event.clipboardData;
    if (!data) return;
    event.preventDefault();
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    if (html) {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const holder = document.createElement('div');
      cleanInto(parsed.body, holder);
      document.execCommand('insertHTML', false, holder.innerHTML);
    } else if (text) {
      document.execCommand('insertText', false, text);
    }
  });
  editor.addEventListener('drop', (event) => {
    // Pliki obsługuje aplikacja (załączniki); obrazy przeciągnięte ze stron nie trafiają do treści.
    if (event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files.length) event.preventDefault();
  });
  editor.addEventListener('keydown', (event) => {
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      const key = event.key.toLowerCase();
      const command = { b: 'bold', i: 'italic', u: 'underline' }[key];
      if (command && !event.shiftKey) { event.preventDefault(); document.execCommand(command); done(); return; }
      if (key === 'k' && !event.shiftKey) { event.preventDefault(); reportState(); post('link'); return; }
    }
    if (event.key === 'Tab' && !event.metaKey && !event.altKey && !event.ctrlKey) {
      event.preventDefault();
      if (document.queryCommandState('insertUnorderedList') || document.queryCommandState('insertOrderedList')) {
        document.execCommand(event.shiftKey ? 'outdent' : 'indent');
      } else if (!event.shiftKey) {
        document.execCommand('insertText', false, '    ');
      }
      done();
    }
  });
  editor.addEventListener('input', done);
  document.addEventListener('selectionchange', reportState);
  page.addEventListener('mousedown', (event) => {
    if (inEditor(event.target)) return;
    event.preventDefault();
    focusEnd();
  });
  signature.addEventListener('click', (event) => event.preventDefault());

  function safeSignature(html) {
    const parsed = new DOMParser().parseFromString(html || '', 'text/html');
    parsed.querySelectorAll('script, iframe, object, embed, form, input, button, meta, link, base, style').forEach((element) => element.remove());
    parsed.body.querySelectorAll('*').forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attribute.value))) element.removeAttribute(attribute.name);
      });
    });
    return parsed.body.innerHTML;
  }

  window.__mail = {
    setContent(html) {
      editor.innerHTML = html && html.trim() ? html : '<div><br></div>';
      savedRange = null;
      notifyNow();
    },
    setSignature(html) {
      signature.innerHTML = safeSignature(html);
      signature.hidden = !signature.innerHTML.trim();
    },
    exec(command) {
      restore();
      if (command === 'unlink') {
        const anchor = anchorAtSelection();
        const selection = document.getSelection();
        if (anchor && selection.isCollapsed) { const range = document.createRange(); range.selectNodeContents(anchor); selection.removeAllRanges(); selection.addRange(range); }
      }
      document.execCommand('styleWithCSS', false, false);
      document.execCommand(command, false, null);
      if (command === 'removeFormat') document.execCommand('unlink', false, null);
      done();
    },
    size(pixels) {
      restore();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      const spans = [];
      editor.querySelectorAll('font[size="7"]').forEach((font) => {
        font.querySelectorAll('[style]').forEach((inner) => {
          inner.style.fontSize = '';
          if (!inner.getAttribute('style')) inner.removeAttribute('style');
        });
        const span = document.createElement('span');
        if (pixels !== 14) span.style.fontSize = pixels + 'px';
        while (font.firstChild) span.appendChild(font.firstChild);
        font.replaceWith(span);
        spans.push(span);
      });
      if (spans.length) {
        const range = document.createRange();
        range.setStart(spans[0], 0);
        const last = spans[spans.length - 1];
        range.setEnd(last, last.childNodes.length);
        const selection = document.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
      done();
    },
    color(hex) {
      restore();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand('foreColor', false, hex);
      document.execCommand('styleWithCSS', false, false);
      done();
    },
    link(url) {
      restore();
      const selection = document.getSelection();
      const anchor = anchorAtSelection();
      if (anchor && selection.isCollapsed) anchor.setAttribute('href', url);
      else if (selection.isCollapsed) document.execCommand('insertHTML', false, '<a href="' + escapeHtml(url) + '">' + escapeHtml(url.replace(/^mailto:/i, '')) + '</a>');
      else document.execCommand('createLink', false, url);
      done();
    },
    focusEnd,
  };
  post('ready');
})();
"""#
}

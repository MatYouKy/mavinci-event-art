import Foundation
import Network
import PDFKit

// MARK: Skaner w sieci po adresie IP — jak skaner w CRM (moduł skanowania `scripts/scanner-bridge.mjs`, adres IP skanera)
//
// macOS widzi skaner w „Pobieraniu obrazów” (ImageCaptureCore, `DocumentScanner`) tylko z jego sterownikiem albo AirScan
// ogłaszanym w sieci — urządzenie wyłączone, z wygasłym ogłoszeniem albo bez sterownika (np. HP Photosmart 6510) się tam nie
// pojawia. CRM łączy się ze skanerem bezpośrednio po adresie IP i tak samo robi to okno skanera:
// - AirScan / eSCL (`http://<adres>/eSCL`): możliwości (`ScannerCapabilities`), stan (`ScannerStatus`), zadanie (`ScanJobs`)
//   i kolejne strony (`NextDocument`) — bilet skanu jak w CRM (A4, JPEG, kolor RGB24 albo skala szarości);
// - HP Photosmart 6510 (model „pst_…” w eSCL albo odrzucony bilet eSCL przy bezczynnym skanerze) — HP WebScan
//   (`/Scan/Status`, `/Scan/Jobs`, plik strony z `BinaryURL`), tylko szyba.
// Skanery AirScan ogłaszane w sieci (Bonjour `_uscan._tcp`) dochodzą do listy same (`ScannerServiceFinder`). Adres skanera
// zapamiętuje ten Mac (domyślnie 192.168.1.17 — jak w CRM). Na macOS 15+ pierwsze połączenie pyta o dostęp do sieci lokalnej
// (`NSLocalNetworkUsageDescription` w Info.plist).

/// Skaner sieciowy: adres usługi eSCL, nazwa (model), źródła i rozdzielczości z `ScannerCapabilities`.
struct NetworkScanner: Identifiable, Sendable {
    /// `http://192.168.1.17/eSCL`.
    let base: String
    let host: String
    let name: String
    /// HP Photosmart 6510 — skan przez HP WebScan (tylko szyba).
    let legacyHP: Bool
    let sources: [ScanSource]
    let resolutions: [Int]

    var id: String { "escl:" + base }
    var title: String { "\(name) — \(host)" }
}

enum NetworkScan {
    struct Settings: Sendable {
        let source: ScanSource
        let dpi: Int
        let color: ScanColor
        let folder: URL
        /// Początek nazw plików stron (np. `skan-3`).
        let prefix: String
    }

    /// Strona zapisana w katalogu skanera (JPEG/PNG/TIFF albo jednostronicowy PDF).
    struct Page: Sendable {
        let url: URL
    }

    private struct Reply {
        let status: Int
        let location: String?
        let contentType: String
        let data: Data
        var ok: Bool { (200..<300).contains(status) }
        var text: String { String(decoding: data, as: UTF8.self) }
    }

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }()

    // MARK: Adres

    /// Adres wpisany przez użytkownika (`192.168.1.17`, `http://192.168.1.17:8080`) → usługa eSCL i host; tylko lokalne IPv4
    /// (10.x, 172.16–31.x, 192.168.x, 169.254.x) — jak moduł skanowania CRM.
    static func base(address raw: String) throws -> (base: String, host: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw ScanFailure(message: "Podaj adres IP skanera, np. 192.168.1.17.") }
        let candidate = text.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil ? text : "http://" + text
        guard let parts = URLComponents(string: candidate), let host = parts.host, let scheme = parts.scheme?.lowercased(),
              scheme == "http" || scheme == "https", privateIPv4(host) else {
            throw ScanFailure(message: "Podaj lokalny adres IP skanera, np. 192.168.1.17.")
        }
        let port = parts.port.map { ":\($0)" } ?? ""
        return ("\(scheme)://\(host)\(port)/eSCL", host)
    }

    static func privateIPv4(_ host: String) -> Bool {
        let octets = host.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
        guard octets.count == 4, octets.allSatisfy({ (0...255).contains($0) }) else { return false }
        let first = octets[0], second = octets[1]
        return first == 10 || (first == 172 && (16...31).contains(second)) || (first == 192 && second == 168) || (first == 169 && second == 254)
    }

    // MARK: Rozpoznanie skanera

    /// Możliwości skanera pod adresem usługi eSCL: nazwa, źródła (szyba, podajnik, dwustronnie), rozdzielczości.
    static func probe(base: String, fallbackName: String = "Skaner sieciowy") async throws -> NetworkScanner {
        let host = URLComponents(string: base)?.host ?? base
        do {
            let reply = try await send("\(base)/ScannerCapabilities")
            guard reply.ok else {
                throw ScanFailure(message: "Urządzenie \(host) odpowiada, ale nie udostępnia skanowania AirScan/eSCL (HTTP \(reply.status)).")
            }
            let xml = reply.text
            guard xml.range(of: "ScannerCapabilities", options: .caseInsensitive) != nil else {
                throw ScanFailure(message: "Pod adresem \(host) działa panel WWW, ale nie ma usługi skanowania AirScan/eSCL.")
            }
            let model = xmlValue(xml, "MakeAndModel")
            let legacy = model.map { $0.range(of: "^pst_[a-z0-9_-]+$", options: [.regularExpression, .caseInsensitive]) != nil } ?? false
            var sources: [ScanSource] = []
            if legacy || has(xml, "Platen") { sources.append(.flatbed) }
            if !legacy && has(xml, "Adf") { sources.append(.feeder) }
            if !legacy && has(xml, "AdfDuplexInputCaps") { sources.append(.duplex) }
            if sources.isEmpty { sources = [.flatbed] }
            let offered = Set(xmlValues(xml, "XResolution").compactMap { Int($0) })
            let standard = DocumentScanner.standardResolutions.filter { offered.contains($0) }
            return NetworkScanner(
                base: base, host: host, name: legacy ? "HP Photosmart 6510" : (model ?? fallbackName), legacyHP: legacy,
                sources: sources, resolutions: legacy || standard.isEmpty ? DocumentScanner.standardResolutions : standard
            )
        } catch {
            throw failure(error, host: host)
        }
    }

    // MARK: Skan

    /// Skan z ustawieniami okna: strony zapisane w katalogu skanera (z podajnika — wszystkie strony zadania).
    static func scan(_ scanner: NetworkScanner, _ settings: Settings) async throws -> [Page] {
        do {
            if scanner.legacyHP { return try await scanWebScan(scanner, settings) }
            return try await scanESCL(scanner, settings)
        } catch {
            throw failure(error, host: scanner.host)
        }
    }

    private static func scanESCL(_ scanner: NetworkScanner, _ settings: Settings) async throws -> [Page] {
        let base = scanner.base
        var state: String?
        if let status = try? await send("\(base)/ScannerStatus"), status.ok { state = xmlValue(status.text, "State") }
        var created: Reply?
        for attempt in 0..<3 {
            let reply = try await send("\(base)/ScanJobs", method: "POST", body: esclTicket(settings), timeout: 20)
            created = reply
            if reply.status != 409 || attempt == 2 { break }
            try await Task.sleep(nanoseconds: UInt64(800_000_000 * (attempt + 1)))
        }
        guard let job = created else { throw ScanFailure(message: "Nie udało się rozpocząć skanowania.") }
        guard job.ok else {
            // Bezczynny skaner odrzuca bilet eSCL — starsze HP (Photosmart) skanują przez HP WebScan.
            if job.status == 409, state?.lowercased() == "idle", settings.source == .flatbed { return try await scanWebScan(scanner, settings) }
            if job.status == 409, state?.lowercased() == "idle" {
                throw ScanFailure(message: "Skaner odrzucił skan z podajnika — sprawdź, czy kartki leżą w podajniku, i spróbuj ponownie.")
            }
            if [409, 423, 503].contains(job.status) {
                throw ScanFailure(message: "Skaner jest zajęty albo ma otwarte inne zadanie. Zamknij aktywne skanowanie (np. HP WebScan, Brother iPrint&Scan), odczekaj chwilę i spróbuj ponownie.")
            }
            throw ScanFailure(message: "Skaner odrzucił rozpoczęcie skanu (HTTP \(job.status)).")
        }
        guard let location = job.location, let resolved = URL(string: location, relativeTo: URL(string: base + "/"))?.absoluteString else {
            throw ScanFailure(message: "Skaner nie zwrócił adresu zadania skanowania.")
        }
        let jobURL = resolved.hasSuffix("/") ? String(resolved.dropLast()) : resolved
        var pages: [Page] = []
        var waits = 0
        do {
            while pages.count < 100 {
                let reply = try await send("\(jobURL)/NextDocument", accept: "image/jpeg, image/png, image/tiff, application/pdf", timeout: 120)
                if [404, 409, 503].contains(reply.status), !pages.isEmpty { break }
                // Pierwsza strona jeszcze się skanuje — krótkie czekanie (do ok. 30 s).
                if reply.status == 503, pages.isEmpty, waits < 30 {
                    waits += 1
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                    continue
                }
                guard reply.ok else { throw ScanFailure(message: "Nie udało się pobrać strony ze skanera (HTTP \(reply.status)).") }
                let stored = try store(reply, settings, index: pages.count + 1)
                pages += stored
                if settings.source == .flatbed { break }
            }
        } catch {
            cancelJob(jobURL)
            throw error
        }
        guard !pages.isEmpty else { throw ScanFailure(message: "Skaner nie zwrócił żadnej strony.") }
        return pages
    }

    /// HP WebScan (HP Photosmart 6510): jedno zadanie z szyby, gotowy plik spod `BinaryURL`.
    private static func scanWebScan(_ scanner: NetworkScanner, _ settings: Settings) async throws -> [Page] {
        guard settings.source == .flatbed else {
            throw ScanFailure(message: "\(scanner.name) skanuje tylko z szyby — wybierz źródło „Szyba”.")
        }
        guard let parts = URLComponents(string: scanner.base), let scheme = parts.scheme, let host = parts.host else {
            throw ScanFailure(message: "Nieprawidłowy adres skanera.")
        }
        let origin = "\(scheme)://\(host)\(parts.port.map { ":\($0)" } ?? "")"
        let status = try await send("\(origin)/Scan/Status")
        guard status.ok else { throw ScanFailure(message: "Skaner nie udostępnia zgodnego mechanizmu HP WebScan.") }
        if let state = xmlValue(status.text, "ScannerState"), state.lowercased() != "idle" {
            throw ScanFailure(message: "Skaner nie jest gotowy (stan: \(state)). Zamknij WebScan i spróbuj ponownie.")
        }
        let job = try await send(
            "\(origin)/Scan/Jobs", method: "POST", body: webScanTicket(settings),
            headers: ["Accept": "*/*", "Content-Type": "text/xml", "User-Agent": "Mozilla/5.0"], timeout: 30
        )
        guard job.ok else {
            if [409, 423, 503].contains(job.status) {
                throw ScanFailure(message: "Skaner ma aktywne inne zadanie. Zamknij WebScan, odczekaj chwilę i spróbuj ponownie.")
            }
            throw ScanFailure(message: "HP WebScan odrzucił rozpoczęcie skanu (HTTP \(job.status)).")
        }
        guard let location = job.location, let jobURL = URL(string: location, relativeTo: URL(string: origin + "/"))?.absoluteString else {
            throw ScanFailure(message: "HP WebScan nie zwrócił adresu zadania skanowania.")
        }
        let deadline = Date().addingTimeInterval(120)
        var binary: String?
        while Date() < deadline {
            let reply = try await send(jobURL)
            guard reply.ok else { throw ScanFailure(message: "Nie udało się odczytać postępu skanowania HP (HTTP \(reply.status)).") }
            let xml = reply.text
            let jobState = xmlValue(xml, "JobState")
            if let candidate = xmlValue(xml, "BinaryURL"), xmlValue(xml, "PageState") == "ReadyToUpload" {
                binary = URL(string: decodeXML(candidate), relativeTo: URL(string: origin + "/"))?.absoluteString
                break
            }
            if let jobState, ["Canceled", "ProcessingError"].contains(jobState) {
                throw ScanFailure(message: "Skanowanie HP zostało przerwane (stan: \(jobState)).")
            }
            try await Task.sleep(nanoseconds: 750_000_000)
        }
        guard let binary else { throw ScanFailure(message: "Skaner HP nie przygotował obrazu w wymaganym czasie.") }
        let document = try await send(binary, accept: "application/pdf, image/jpeg, image/png, image/tiff", timeout: 120)
        guard document.ok else { throw ScanFailure(message: "Nie udało się pobrać skanu z HP (HTTP \(document.status)).") }
        return try store(document, settings, index: 1)
    }

    // MARK: Bilety skanu (jak w CRM)

    private static func esclTicket(_ settings: Settings) -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <scan:ScanSettings xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03" xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm">
          <pwg:Version>2.0</pwg:Version>
          <scan:Intent>TextAndGraphic</scan:Intent>
          <pwg:ScanRegions pwg:MustHonor="true">
            <pwg:ScanRegion>
              <pwg:Height>3508</pwg:Height>
              <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
              <pwg:Width>2480</pwg:Width>
              <pwg:XOffset>0</pwg:XOffset>
              <pwg:YOffset>0</pwg:YOffset>
            </pwg:ScanRegion>
          </pwg:ScanRegions>
          <pwg:InputSource>\(settings.source == .flatbed ? "Platen" : "Feeder")</pwg:InputSource>
          <scan:Duplex>\(settings.source == .duplex ? "true" : "false")</scan:Duplex>
          <scan:ColorMode>\(settings.color == .color ? "RGB24" : "Grayscale8")</scan:ColorMode>
          <scan:XResolution>\(settings.dpi)</scan:XResolution>
          <scan:YResolution>\(settings.dpi)</scan:YResolution>
          <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
        </scan:ScanSettings>
        """
    }

    private static func webScanTicket(_ settings: Settings) -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <scan:ScanJob xmlns:scan="http://www.hp.com/schemas/imaging/con/cnx/scan/2008/08/19" xmlns:dd="http://www.hp.com/schemas/imaging/con/dictionaries/1.0/">
          <scan:XResolution>\(settings.dpi)</scan:XResolution>
          <scan:YResolution>\(settings.dpi)</scan:YResolution>
          <scan:XStart>0</scan:XStart>
          <scan:YStart>0</scan:YStart>
          <scan:Width>2480</scan:Width>
          <scan:Height>3508</scan:Height>
          <scan:Format>Pdf</scan:Format>
          <scan:CompressionQFactor>25</scan:CompressionQFactor>
          <scan:ColorSpace>\(settings.color == .color ? "Color" : "Gray")</scan:ColorSpace>
          <scan:BitDepth>8</scan:BitDepth>
          <scan:InputSource>Platen</scan:InputSource>
          <scan:GrayRendering>NTSC</scan:GrayRendering>
          <scan:ToneMap>
            <scan:Gamma>1000</scan:Gamma>
            <scan:Brightness>1000</scan:Brightness>
            <scan:Contrast>1000</scan:Contrast>
            <scan:Highlite>179</scan:Highlite>
            <scan:Shadow>25</scan:Shadow>
          </scan:ToneMap>
          <scan:ContentType>Document</scan:ContentType>
        </scan:ScanJob>
        """
    }

    // MARK: Strony

    /// Odpowiedź ze stroną → plik w katalogu skanera; PDF — rozdzielony na pojedyncze strony (każda strona osobno na liście).
    private static func store(_ reply: Reply, _ settings: Settings, index: Int) throws -> [Page] {
        let type = reply.contentType.lowercased()
        if type.contains("pdf") || reply.data.starts(with: Data("%PDF".utf8)) {
            guard let document = PDFDocument(data: reply.data), document.pageCount > 0 else {
                throw ScanFailure(message: "Skaner przysłał nieczytelny plik PDF.")
            }
            var pages: [Page] = []
            for number in 0..<document.pageCount {
                guard let page = document.page(at: number) else { continue }
                let single = PDFDocument()
                single.insert((page.copy() as? PDFPage) ?? page, at: 0)
                let url = settings.folder.appendingPathComponent("\(settings.prefix)-\(index + number).pdf")
                guard single.write(to: url) else { throw ScanFailure(message: "Nie udało się zapisać strony skanu.") }
                pages.append(Page(url: url))
            }
            return pages
        }
        let ext = type.contains("png") ? "png" : type.contains("tiff") ? "tiff" : "jpg"
        let url = settings.folder.appendingPathComponent("\(settings.prefix)-\(index).\(ext)")
        try reply.data.write(to: url, options: .atomic)
        return [Page(url: url)]
    }

    /// Przerwane albo nieudane zadanie eSCL — usunięcie ze skanera (bez czekania; skaner nie zostaje „zajęty”).
    private static func cancelJob(_ url: String) {
        Task.detached { _ = try? await NetworkScan.send(url, method: "DELETE", timeout: 5) }
    }

    // MARK: HTTP i XML

    private static func send(_ url: String, method: String = "GET", body: String? = nil, accept: String = "application/xml, text/xml",
                             headers: [String: String] = [:], timeout: TimeInterval = 8) async throws -> Reply {
        guard let target = URL(string: url) else { throw ScanFailure(message: "Nieprawidłowy adres skanera.") }
        var request = URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue(accept, forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = Data(body.utf8)
            request.setValue("text/xml; charset=utf-8", forHTTPHeaderField: "Content-Type")
        }
        for (field, value) in headers { request.setValue(value, forHTTPHeaderField: field) }
        let (data, response) = try await session.data(for: request)
        let http = response as? HTTPURLResponse
        return Reply(
            status: http?.statusCode ?? 0,
            location: http?.value(forHTTPHeaderField: "Location"),
            contentType: http?.value(forHTTPHeaderField: "Content-Type") ?? "",
            data: data
        )
    }

    /// Błąd połączenia → komunikat dla użytkownika (przerwanie — `CancellationError`).
    static func failure(_ error: Error, host: String) -> Error {
        if error is CancellationError || error is ScanFailure { return error }
        if let url = error as? URLError {
            switch url.code {
            case .cancelled:
                return CancellationError()
            case .timedOut, .cannotConnectToHost, .cannotFindHost, .networkConnectionLost, .notConnectedToInternet, .dnsLookupFailed:
                return ScanFailure(message: "Skaner \(host) nie odpowiada. Sprawdź, czy jest włączony i w tej samej sieci, oraz czy Mavinci ma dostęp do sieci lokalnej (Ustawienia systemowe → Prywatność i ochrona → Sieć lokalna).")
            default:
                break
            }
        }
        return ScanFailure(message: "Nie udało się połączyć ze skanerem \(host): \(error.localizedDescription)")
    }

    /// Pierwsza wartość elementu (z dowolnym prefiksem przestrzeni nazw) — jak `extractXmlValue` w module skanowania CRM.
    static func xmlValue(_ xml: String, _ name: String) -> String? { xmlValues(xml, name).first }

    static func xmlValues(_ xml: String, _ name: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: "<(?:\\w+:)?\(name)[^>]*>([^<]+)<", options: .caseInsensitive) else { return [] }
        return regex.matches(in: xml, range: NSRange(xml.startIndex..., in: xml)).compactMap { match in
            Range(match.range(at: 1), in: xml).map { String(xml[$0]).trimmingCharacters(in: .whitespacesAndNewlines) }
        }
        .filter { !$0.isEmpty }
    }

    /// Czy jest element (np. `<scan:Adf>`), niezależnie od prefiksu.
    static func has(_ xml: String, _ element: String) -> Bool {
        xml.range(of: "<(?:\\w+:)?\(element)[\\s>/]", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func decodeXML(_ text: String) -> String {
        text.replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&amp;", with: "&")
    }
}

// MARK: Skanery AirScan ogłaszane w sieci

/// Skanery AirScan / eSCL ogłaszane przez Bonjour (`_uscan._tcp`) → adres IPv4, port i ścieżka usługi (TXT `rs`). Stan tylko
/// na własnej kolejce; znalezione usługi trafiają do `onFound` (okno skanera sprawdza je i dokłada do listy).
final class ScannerServiceFinder: @unchecked Sendable {
    struct Found: Sendable {
        let base: String
        let name: String
    }

    private let queue = DispatchQueue(label: "pl.mavinci.scanner-finder")
    private let onFound: @Sendable (Found) -> Void
    private var browser: NWBrowser?
    private var resolving: [String: NWConnection] = [:]
    private var seen: Set<String> = []

    init(onFound: @escaping @Sendable (Found) -> Void) {
        self.onFound = onFound
    }

    func start() {
        queue.async { [self] in
            guard browser == nil else { return }
            let created = NWBrowser(for: .bonjourWithTXTRecord(type: "_uscan._tcp", domain: nil), using: NWParameters())
            created.browseResultsChangedHandler = { [weak self] _, changes in self?.handle(changes) }
            browser = created
            created.start(queue: queue)
        }
    }

    func stop() {
        queue.async { [self] in
            browser?.cancel()
            browser = nil
            for connection in resolving.values { connection.cancel() }
            resolving = [:]
        }
    }

    private func handle(_ changes: Set<NWBrowser.Result.Change>) {
        for change in changes {
            guard case .added(let result) = change else { continue }
            var path = "eSCL"
            var model: String?
            if case .bonjour(let record) = result.metadata {
                if let rs = record["rs"]?.trimmingCharacters(in: CharacterSet(charactersIn: "/ ")), !rs.isEmpty { path = rs }
                model = record["ty"]
            }
            var service = "Skaner sieciowy"
            if case .service(let name, _, _, _) = result.endpoint { service = name }
            resolve(result.endpoint, name: model ?? service, path: path)
        }
    }

    /// Adres usługi: połączenie IPv4 z ogłoszonym skanerem i odczyt adresu drugiej strony (bez wysyłania danych).
    private func resolve(_ endpoint: NWEndpoint, name: String, path: String) {
        let key = String(describing: endpoint)
        guard browser != nil, resolving[key] == nil else { return }
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
        let connection = NWConnection(to: endpoint, using: parameters)
        resolving[key] = connection
        connection.stateUpdateHandler = { [weak self] state in self?.changed(key, state: state, name: name, path: path) }
        connection.start(queue: queue)
        // Bez odpowiedzi w 10 s — rezygnacja (skaner wyłączony, ogłoszenie nieaktualne).
        queue.asyncAfter(deadline: .now() + 10) { [weak self] in self?.finish(key) }
    }

    private func changed(_ key: String, state: NWConnection.State, name: String, path: String) {
        switch state {
        case .ready:
            if case .hostPort(let host, let port)? = resolving[key]?.currentPath?.remoteEndpoint, case .ipv4(let address) = host {
                let ip = address.rawValue.map { String($0) }.joined(separator: ".")
                let base = "http://\(ip)\(port.rawValue == 80 ? "" : ":\(port.rawValue)")/\(path)"
                if seen.insert(base).inserted { onFound(Found(base: base, name: name)) }
            }
            finish(key)
        case .failed, .cancelled:
            finish(key)
        default:
            break
        }
    }

    private func finish(_ key: String) {
        resolving.removeValue(forKey: key)?.cancel()
    }
}

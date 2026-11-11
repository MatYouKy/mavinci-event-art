import Foundation
import AppKit

// MARK: Lokalny silnik PDF — wydruki CRM (HTML → Chromium) generowane na Macu.
//
// Serwer przygotowuje zadanie (`?render=local`, `src/lib/print/printJob.server.ts`): dokładnie ten HTML i te ustawienia, które
// trasy przekazują do Playwright (`page.setContent` + `page.pdf`). Mac drukuje je w Chrome (albo innej przeglądarce Chromium)
// zainstalowanej na komputerze — bez okna, przez DevTools Protocol, z identycznymi parametrami `Page.printToPDF`
// (przeliczenia jednostek i formatów jak w Playwright). Przeglądarka zostaje w tle, więc kolejne wydruki są natychmiastowe.
// Bez przeglądarki Chromium na Macu wydruk generuje serwer, jak dotąd.

/// Zadanie wydruku z serwera.
struct PrintJob: Decodable {
    struct Margin: Decodable { var top: String?; var right: String?; var bottom: String?; var left: String? }
    struct Options: Decodable {
        var format: String?
        var width: String?
        var height: String?
        var landscape: Bool?
        var preferCSSPageSize: Bool?
        var printBackground: Bool?
        var displayHeaderFooter: Bool?
        var headerTemplate: String?
        var footerTemplate: String?
        var margin: Margin?
        var scale: Double?
    }
    var version: Int
    var html: String
    var fontsMarker: String?
    var javascript: Bool
    var network: String
    var allowedHosts: [String]
    var waitUntil: String
    var waitForAssets: Bool
    var emulatePrintMedia: Bool
    var pdf: Options
    var fileName: String
    var finalize: Bool
}

enum LocalPdfError: LocalizedError {
    case browserMissing, fontsMissing, launch(String), devtools(String), timeout(String)
    var errorDescription: String? {
        switch self {
        case .browserMissing: return "Na tym Macu nie ma przeglądarki Chrome."
        case .fontsMissing: return "Brakuje fontów wydruku w aplikacji."
        case .launch(let text): return "Nie udało się uruchomić Chrome do wydruku: \(text)"
        case .devtools(let text): return "Wydruk w Chrome nie powiódł się: \(text)"
        case .timeout(let text): return "Wydruk trwał zbyt długo (\(text))."
        }
    }
}

/// Fonty wydruków — te same pliki i ten sam zapis CSS co `loadPrintFontCss` na serwerze.
enum PrintFonts {
    static let css: String? = {
        guard let folder = Bundle.main.resourceURL?.appendingPathComponent("PrintFonts", isDirectory: true) else { return nil }
        let files: [(Int, String)] = [(400, "Inter-Regular.ttf"), (500, "Inter-Medium.ttf"), (600, "Inter-SemiBold.ttf"), (700, "Inter-Bold.ttf")]
        var css = ""
        for (weight, name) in files {
            guard let data = try? Data(contentsOf: folder.appendingPathComponent(name)) else { return nil }
            css += "@font-face{font-family:'Inter';src:url(data:font/ttf;base64,\(data.base64EncodedString())) format('truetype');font-weight:\(weight);font-style:normal;font-display:block;}"
        }
        return css
    }()
}

/// Przeliczenia jak w Playwright (`crPdf.ts`): formaty papieru w calach, jednostki px/in/cm/mm.
enum PlaywrightPdf {
    static let formats: [String: (Double, Double)] = [
        "letter": (8.5, 11), "legal": (8.5, 14), "tabloid": (11, 17), "ledger": (17, 11), "a0": (33.1, 46.8), "a1": (23.4, 33.1),
        "a2": (16.54, 23.4), "a3": (11.7, 16.54), "a4": (8.27, 11.7), "a5": (5.83, 8.27), "a6": (4.13, 5.83),
    ]
    static let unitToPixels: [String: Double] = ["px": 1, "in": 96, "cm": 37.8, "mm": 3.78]
    static func inches(_ text: String?) -> Double? {
        guard let text, !text.isEmpty else { return nil }
        var unit = String(text.suffix(2)).lowercased()
        var valueText = String(text.dropLast(2))
        if unitToPixels[unit] == nil { unit = "px"; valueText = text }
        guard let value = Double(valueText.trimmingCharacters(in: .whitespaces)) else { return nil }
        return value * (unitToPixels[unit] ?? 1) / 96
    }
    /// Parametry `Page.printToPDF` dokładnie jak `page.pdf(options)`.
    static func parameters(_ o: PrintJob.Options) -> [String: Any] {
        var width = 8.5, height = 11.0
        if let format = o.format, let size = formats[format.lowercased()] {
            width = size.0; height = size.1
        } else {
            width = (inches(o.width) ?? 0) == 0 ? width : inches(o.width)!
            height = (inches(o.height) ?? 0) == 0 ? height : inches(o.height)!
        }
        func margin(_ value: String?) -> Double { let v = inches(value) ?? 0; return v == 0 ? 0 : v }
        return [
            "transferMode": "ReturnAsBase64",
            "landscape": o.landscape ?? false,
            "displayHeaderFooter": o.displayHeaderFooter ?? false,
            "headerTemplate": o.headerTemplate ?? "",
            "footerTemplate": o.footerTemplate ?? "",
            "printBackground": o.printBackground ?? false,
            "scale": o.scale ?? 1,
            "paperWidth": width, "paperHeight": height,
            "marginTop": margin(o.margin?.top), "marginBottom": margin(o.margin?.bottom),
            "marginLeft": margin(o.margin?.left), "marginRight": margin(o.margin?.right),
            "pageRanges": "",
            "preferCSSPageSize": o.preferCSSPageSize ?? false,
            "generateTaggedPDF": false,
            "generateDocumentOutline": false,
        ]
    }
}

/// Przeglądarka Chromium w tle i połączenie DevTools. Jedna instancja na aplikację; zamykana po 10 min bezczynności i przy wyjściu.
actor ChromePdfEngine {
    static let shared = ChromePdfEngine()

    private var process: Process?
    private var socket: URLSessionWebSocketTask?
    private var nextID = 0
    private var replies: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    private var events: [String: [String: Int]] = [:]          // sessionId → zdarzenie → licznik
    private var inflight: [String: Set<String>] = [:]          // sessionId → requestId w toku
    private var lastActivity: [String: Date] = [:]
    private var policies: [String: (network: String, hosts: Set<String>, file: String)] = [:]
    private var idleTask: Task<Void, Never>?
    private var busy = 0
    private static let pidLock = NSLock()
    private static var runningPID: Int32 = 0
    /// Zamknięcie przeglądarki razem z aplikacją (jednorazowa rejestracja).
    private static let exitHook: NSObjectProtocol = NotificationCenter.default.addObserver(
        forName: NSApplication.willTerminateNotification, object: nil, queue: nil) { _ in ChromePdfEngine.terminateOnExit() }

    /// Plik przeglądarki: Chrome, Chromium, Edge albo Brave (pierwsza znaleziona).
    nonisolated static func browserExecutable() -> URL? {
        let bundles = ["com.google.Chrome", "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser", "com.google.Chrome.canary"]
        for id in bundles {
            guard let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id), let bundle = Bundle(url: app),
                  let executable = bundle.executableURL, FileManager.default.isExecutableFile(atPath: executable.path) else { continue }
            return executable
        }
        return nil
    }
    nonisolated static var available: Bool { browserExecutable() != nil && PrintFonts.css != nil }

    /// Zamknięcie przeglądarki przy wyjściu z aplikacji (proces potomny nie kończy się sam).
    /// Zapis PID poza kontekstem asynchronicznym (NSLock nie jest dozwolony bezpośrednio w funkcjach `async`).
    nonisolated private static func setRunningPID(_ pid: Int32) {
        pidLock.lock(); runningPID = pid; pidLock.unlock()
    }

    nonisolated static func terminateOnExit() {
        pidLock.lock(); let pid = runningPID; pidLock.unlock()
        if pid > 0 { kill(pid, SIGTERM) }
    }

    // MARK: Wydruk
    func render(_ job: PrintJob) async throws -> Data {
        busy += 1
        idleTask?.cancel()
        defer { busy -= 1; scheduleIdle() }
        var html = job.html
        if let marker = job.fontsMarker, !marker.isEmpty {
            guard let fonts = PrintFonts.css else { throw LocalPdfError.fontsMissing }
            if let range = html.range(of: marker) { html.replaceSubrange(range, with: fonts) }   // jak `String.replace` — pierwsze wystąpienie
        }
        try await ensureBrowser()
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("mavinci-print", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appendingPathComponent("\(UUID().uuidString).html")
        try Data(html.utf8).write(to: file, options: .atomic)
        defer { try? FileManager.default.removeItem(at: file) }

        let target = try await send("Target.createTarget", ["url": "about:blank"])
        guard let targetID = target["targetId"] as? String else { throw LocalPdfError.devtools("brak karty") }
        defer { Task { _ = try? await self.send("Target.closeTarget", ["targetId": targetID]) } }
        let attached = try await send("Target.attachToTarget", ["targetId": targetID, "flatten": true])
        guard let session = attached["sessionId"] as? String else { throw LocalPdfError.devtools("brak sesji") }
        defer { events[session] = nil; inflight[session] = nil; lastActivity[session] = nil; policies[session] = nil }

        policies[session] = (job.network, Set(job.allowedHosts), file.absoluteString)
        _ = try await send("Page.enable", [:], session: session)
        _ = try await send("Network.enable", [:], session: session)
        _ = try await send("Fetch.enable", ["patterns": [["urlPattern": "*", "requestStage": "Request"]]], session: session)
        if !job.javascript { _ = try await send("Emulation.setScriptExecutionDisabled", ["value": true], session: session) }

        events[session] = [:]
        _ = try await send("Page.navigate", ["url": file.absoluteString], session: session)
        try await waitForEvent("Page.loadEventFired", session: session, timeout: 45)
        if job.waitUntil == "networkidle" { try await waitForNetworkIdle(session: session, timeout: 30) }
        if job.waitForAssets {
            // Jak `page.evaluate` w trasach agendy i kalkulacji: fonty gotowe i wszystkie obrazy załadowane (albo z błędem).
            let script = """
            (async () => {
              if (document.fonts && document.fonts.ready) { await document.fonts.ready; }
              const imgs = Array.from(document.images || []);
              await Promise.all(imgs.map((img) => new Promise((resolve) => {
                if (img.complete) return resolve();
                img.onload = () => resolve(); img.onerror = () => resolve();
              })));
            })()
            """
            _ = try await send("Runtime.evaluate", ["expression": script, "awaitPromise": true], session: session, timeout: 30)
        }
        if job.emulatePrintMedia { _ = try await send("Emulation.setEmulatedMedia", ["media": "print"], session: session) }
        let printed = try await send("Page.printToPDF", PlaywrightPdf.parameters(job.pdf), session: session, timeout: 120)
        guard let base64 = printed["data"] as? String, let data = Data(base64Encoded: base64) else { throw LocalPdfError.devtools("pusty dokument") }
        return data
    }

    // MARK: Przeglądarka
    private func ensureBrowser() async throws {
        if let process, process.isRunning, socket != nil { return }
        shutdown()
        guard let executable = Self.browserExecutable() else { throw LocalPdfError.browserMissing }
        _ = Self.exitHook
        let profile = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/pdf-chrome", isDirectory: true)
        try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
        let portFile = profile.appendingPathComponent("DevToolsActivePort")
        try? FileManager.default.removeItem(at: portFile)
        let process = Process()
        process.executableURL = executable
        process.arguments = [
            "--headless=new", "--remote-debugging-port=0", "--user-data-dir=\(profile.path)", "--no-first-run", "--no-default-browser-check",
            "--disable-extensions", "--disable-background-networking", "--disable-sync", "--disable-component-update",
            "--disable-default-apps", "--hide-scrollbars", "--mute-audio", "--allow-file-access-from-files", "about:blank",
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { throw LocalPdfError.launch(error.localizedDescription) }
        self.process = process
        Self.setRunningPID(process.processIdentifier)
        var endpoint: URL?
        for _ in 0..<150 {
            if let text = try? String(contentsOf: portFile, encoding: .utf8) {
                let lines = text.split(whereSeparator: \.isNewline).map(String.init)
                if lines.count >= 2, let url = URL(string: "ws://127.0.0.1:\(lines[0])\(lines[1])") { endpoint = url; break }
            }
            try await Task.sleep(for: .milliseconds(100))
        }
        guard let endpoint else { shutdown(); throw LocalPdfError.launch("przeglądarka nie odpowiedziała") }
        let task = URLSession.shared.webSocketTask(with: endpoint)
        task.maximumMessageSize = 256 * 1024 * 1024
        task.resume()
        socket = task
        Task { await self.receiveLoop(task) }
    }

    private func shutdown() {
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        if let process, process.isRunning { process.terminate() }
        process = nil
        Self.setRunningPID(0)
        for (_, waiter) in replies { waiter.resume(throwing: LocalPdfError.devtools("połączenie zamknięte")) }
        replies = [:]
    }

    private func scheduleIdle() {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(600))
            guard !Task.isCancelled else { return }
            await self?.closeIfIdle()
        }
    }
    private func closeIfIdle() { if busy == 0 { shutdown() } }

    // MARK: DevTools
    private func receiveLoop(_ task: URLSessionWebSocketTask) async {
        while true {
            do {
                let message = try await task.receive()
                let data: Data
                switch message {
                case .string(let text): data = Data(text.utf8)
                case .data(let bytes): data = bytes
                @unknown default: continue
                }
                guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                handle(object)
            } catch {
                if socket === task { shutdown() }
                return
            }
        }
    }

    private func handle(_ message: [String: Any]) {
        if let id = message["id"] as? Int, let waiter = replies.removeValue(forKey: id) {
            if let error = message["error"] as? [String: Any] {
                waiter.resume(throwing: LocalPdfError.devtools(error["message"] as? String ?? "błąd protokołu"))
            } else {
                waiter.resume(returning: message["result"] as? [String: Any] ?? [:])
            }
            return
        }
        guard let method = message["method"] as? String, let session = message["sessionId"] as? String else { return }
        let params = message["params"] as? [String: Any] ?? [:]
        events[session, default: [:]][method, default: 0] += 1
        switch method {
        case "Network.requestWillBeSent":
            if let id = params["requestId"] as? String { inflight[session, default: []].insert(id); lastActivity[session] = Date() }
        case "Network.loadingFinished", "Network.loadingFailed":
            if let id = params["requestId"] as? String { inflight[session]?.remove(id); lastActivity[session] = Date() }
        case "Fetch.requestPaused":
            guard let id = params["requestId"] as? String else { return }
            let url = (params["request"] as? [String: Any])?["url"] as? String ?? ""
            let allowed = allows(url, session: session)
            Task { _ = try? await self.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
                                            allowed ? ["requestId": id] : ["requestId": id, "errorReason": "BlockedByClient"], session: session) }
        default: break
        }
    }

    /// Sieć jak w trasach: `none` — nic poza dokumentem; `trusted` — hosty z listy (`restrictPageNetwork`); `open` — wszystko.
    private func allows(_ url: String, session: String) -> Bool {
        guard let policy = policies[session] else { return false }
        if url == policy.file { return true }
        let lower = url.lowercased()
        if lower.hasPrefix("data:") || lower.hasPrefix("blob:") || lower.hasPrefix("about:") { return true }
        switch policy.network {
        case "open": return true
        case "trusted":
            guard let parsed = URL(string: url), let scheme = parsed.scheme?.lowercased(), scheme == "https" || scheme == "http", let host = parsed.host else { return false }
            let hostWithPort = parsed.port.map { "\(host):\($0)" } ?? host
            return policy.hosts.contains(hostWithPort)
        default: return false
        }
    }

    private func send(_ method: String, _ params: [String: Any], session: String? = nil, timeout: Double = 60) async throws -> [String: Any] {
        guard let socket else { throw LocalPdfError.devtools("brak połączenia") }
        nextID += 1
        let id = nextID
        var message: [String: Any] = ["id": id, "method": method, "params": params]
        if let session { message["sessionId"] = session }
        let data = try JSONSerialization.data(withJSONObject: message)
        let timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(timeout))
            guard !Task.isCancelled else { return }
            await self?.expire(id, method)
        }
        defer { timer.cancel() }
        return try await withCheckedThrowingContinuation { continuation in
            replies[id] = continuation
            socket.send(.string(String(decoding: data, as: UTF8.self))) { [weak self] error in
                guard let error else { return }
                Task { await self?.fail(id, error) }
            }
        }
    }
    private func expire(_ id: Int, _ method: String) { replies.removeValue(forKey: id)?.resume(throwing: LocalPdfError.timeout(method)) }
    private func fail(_ id: Int, _ error: Error) { replies.removeValue(forKey: id)?.resume(throwing: LocalPdfError.devtools(error.localizedDescription)) }

    private func waitForEvent(_ method: String, session: String, timeout: Double) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while (events[session]?[method] ?? 0) == 0 {
            if Date() > deadline { throw LocalPdfError.timeout(method) }
            try await Task.sleep(for: .milliseconds(20))
        }
    }
    /// Jak `waitUntil: 'networkidle'` w Playwright: brak połączeń przez 500 ms.
    private func waitForNetworkIdle(session: String, timeout: Double) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let idle = inflight[session]?.isEmpty ?? true
            let quiet = Date().timeIntervalSince(lastActivity[session] ?? .distantPast) >= 0.5
            if idle && quiet { return }
            if Date() > deadline { throw LocalPdfError.timeout("networkidle") }
            try await Task.sleep(for: .milliseconds(50))
        }
    }
}

// MARK: Wydruki z CRM

extension Workspace {
    /// Wydruk z trasy CRM: lokalnie (zadanie `?render=local` + Chrome na Macu), a bez Chrome — PDF z serwera.
    /// Zwraca plik PDF w podręcznym katalogu wydruków.
    func printDocument(path: String, query: [String: String] = [:], fallbackName: String) async throws -> URL {
        guard let backend = eventAPI(), let base = connection.crm else { throw AppError.configuration }
        let token = try await backend.token()
        func request(_ extra: [String: String]) throws -> URLRequest {
            guard var components = URLComponents(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path) else { throw AppError.configuration }
            components.queryItems = query.merging(extra) { $1 }.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            guard let url = components.url else { throw AppError.configuration }
            var request = URLRequest(url: url)
            request.timeoutInterval = 180
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
            return request
        }
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/Wydruki", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        func save(_ data: Data, _ name: String) throws -> URL {
            let clean = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            let target = folder.appendingPathComponent(clean.lowercased().hasSuffix(".pdf") ? clean : clean + ".pdf")
            try data.write(to: target, options: .atomic)
            return target
        }
        if ChromePdfEngine.available {
            struct Reply: Decodable { let job: PrintJob }
            let (data, response) = try await URLSession.shared.data(for: try request(["render": "local"]))
            try Self.checkPrintResponse(data, response)
            let job = try JSONDecoder().decode(Reply.self, from: data).job
            let pdf = try await ChromePdfEngine.shared.render(job)
            if job.finalize {
                // Dokument zapisywany w CRM (Pliki wydarzenia, umowy): gotowy PDF wraca na serwer, który robi resztę jak w przeglądarce.
                var upload = try request(["finalize": "1"])
                let boundary = "mavinci-\(UUID().uuidString)"
                let payload = (try? JSONSerialization.data(withJSONObject: query, options: [.sortedKeys])) ?? Data("{}".utf8)
                var body = Data()
                body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"payload\"\r\nContent-Type: application/json\r\n\r\n".utf8))
                body.append(payload)
                body.append(Data("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dokument.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".utf8))
                body.append(pdf)
                body.append(Data("\r\n--\(boundary)--\r\n".utf8))
                upload.httpMethod = "POST"
                upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
                let (reply, response) = try await URLSession.shared.upload(for: upload, from: body)
                try Self.checkPrintResponse(reply, response)
            }
            return try save(pdf, job.fileName.nonEmpty ?? fallbackName)
        }
        let (data, response) = try await URLSession.shared.data(for: try request([:]))
        try Self.checkPrintResponse(data, response)
        guard data.starts(with: Data("%PDF".utf8)) else { throw NativeFailure(status: 500, message: "Serwer nie zwrócił dokumentu PDF.", fieldErrors: [:]) }
        let name = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")
            .flatMap { header in header.components(separatedBy: "filename*=UTF-8''").last?.removingPercentEncoding } ?? fallbackName
        return try save(data, name)
    }

    /// Dokument zapisywany w CRM przez trasę POST (agenda, karta weselna, kalkulacja, umowa): z Chrome — `?render=local`, druk
    /// na Macu i `?finalize=1` z gotowym PDF (multipart: `file` + `payload` — ta sama treść żądania); bez Chrome — serwer.
    /// Zwraca PDF (gdy powstał na Macu) i odpowiedź trasy.
    func generateStoredDocument(path: String, body: Data) async throws -> (pdf: Data?, reply: Data) {
        guard let backend = eventAPI(), let base = connection.crm else { throw AppError.configuration }
        let token = try await backend.token()
        let payload = body
        func request(_ query: String?) throws -> URLRequest {
            let address = base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path + (query.map { "?" + $0 } ?? "")
            guard let url = URL(string: address) else { throw AppError.configuration }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 180
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
            return request
        }
        if ChromePdfEngine.available {
            struct Reply: Decodable { let job: PrintJob }
            var ask = try request("render=local")
            ask.setValue("application/json", forHTTPHeaderField: "Content-Type")
            ask.httpBody = payload
            let (data, response) = try await URLSession.shared.data(for: ask)
            try Self.checkPrintResponse(data, response)
            let job = try JSONDecoder().decode(Reply.self, from: data).job
            let pdf = try await ChromePdfEngine.shared.render(job)
            var upload = try request("finalize=1")
            let boundary = "mavinci-\(UUID().uuidString)"
            var form = Data()
            form.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"payload\"\r\nContent-Type: application/json\r\n\r\n".utf8))
            form.append(payload)
            form.append(Data("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dokument.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".utf8))
            form.append(pdf)
            form.append(Data("\r\n--\(boundary)--\r\n".utf8))
            upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            let (reply, uploadResponse) = try await URLSession.shared.upload(for: upload, from: form)
            try Self.checkPrintResponse(reply, uploadResponse)
            return (pdf, reply)
        }
        var direct = try request(nil)
        direct.setValue("application/json", forHTTPHeaderField: "Content-Type")
        direct.httpBody = payload
        let (data, response) = try await URLSession.shared.data(for: direct)
        try Self.checkPrintResponse(data, response)
        return (nil, data)
    }

    static func checkPrintResponse(_ data: Data, _ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw AppError.invalidResponse }
        if http.statusCode == 401 { throw AppError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let object = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            throw NativeFailure(status: http.statusCode, message: object["error"]?.text.nonEmpty ?? "Nie udało się przygotować dokumentu.", fieldErrors: [:])
        }
    }
}

import Foundation

// MARK: Supabase Realtime dla komunikatora — protokół Phoenix (`vsn=1.0.0`) jak `supabase.channel(...)` w CRM:
// zmiany w tabelach (`postgres_changes`, RLS według tokenu pracownika), obecność (`presence:employees`) i sygnał „pisze…”
// (`broadcast`). Jedno połączenie na sesję; kanały dołączane ponownie po zerwaniu połączenia (odstępy 1–30 s), puls co 25 s,
// a odświeżony token trafia do kanałów (`access_token`). Gdy połączenia nie ma, komunikator odpytuje serwer (`ChatStore`).

@MainActor final class ChatRealtime {
    private struct Channel {
        let config: [String: JSONValue]
        var joinRef: String?
        var joined = false
    }

    /// Zdarzenie kanału: temat (bez przedrostka `realtime:`), nazwa zdarzenia i treść.
    var onEvent: ((String, String, [String: JSONValue]) -> Void)?
    /// Kanał dołączony (`true`) albo utracony (`false`) — temat bez przedrostka.
    var onChannel: ((String, Bool) -> Void)?

    private let session = URLSession(configuration: .default)
    private var task: URLSessionWebSocketTask?
    private var endpoint: URL?
    private var tokenProvider: (() async throws -> String)?
    private var token = ""
    private var channels: [String: Channel] = [:]
    private var ref = 0
    private var generation = 0
    private var heartbeat: Task<Void, Never>?
    private var retry: Task<Void, Never>?
    private var attempts = 0
    private var pendingHeartbeat: String?
    private var stopped = true

    /// Adres gniazda projektu Supabase (`wss://…/realtime/v1/websocket?apikey=…&vsn=1.0.0`).
    static func endpoint(supabaseURL: String, apiKey: String) -> URL? {
        guard var components = URLComponents(string: supabaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/ "))) else { return nil }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path = (components.path.isEmpty ? "" : components.path) + "/realtime/v1/websocket"
        components.queryItems = [URLQueryItem(name: "apikey", value: apiKey), URLQueryItem(name: "vsn", value: "1.0.0")]
        return components.url
    }

    func start(endpoint: URL, token: @escaping () async throws -> String) {
        self.endpoint = endpoint
        tokenProvider = token
        stopped = false
        attempts = 0
        open()
    }

    func stop() {
        stopped = true
        generation += 1
        heartbeat?.cancel(); heartbeat = nil
        retry?.cancel(); retry = nil
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        channels = [:]
        pendingHeartbeat = nil
    }

    /// Dołączenie do kanału (temat bez przedrostka, np. `chat_typing:<id>`); po ponownym połączeniu — automatycznie.
    func join(_ topic: String, config: [String: JSONValue]) {
        channels[topic] = Channel(config: config)
        if task != nil { sendJoin(topic) }
    }

    func leave(_ topic: String) {
        guard let channel = channels.removeValue(forKey: topic) else { return }
        if channel.joined, let joinRef = channel.joinRef {
            send(["topic": .string("realtime:\(topic)"), "event": .string("phx_leave"), "payload": .object([:]),
                  "ref": .string(nextRef()), "join_ref": .string(joinRef)])
        }
    }

    func isJoined(_ topic: String) -> Bool { channels[topic]?.joined == true }

    /// Sygnał w kanale (`broadcast`) — np. „pisze…”.
    func broadcast(_ topic: String, event: String, payload: [String: JSONValue]) {
        guard let channel = channels[topic], channel.joined, let joinRef = channel.joinRef else { return }
        send(["topic": .string("realtime:\(topic)"), "event": .string("broadcast"),
              "payload": .object(["type": .string("broadcast"), "event": .string(event), "payload": .object(payload)]),
              "ref": .string(nextRef()), "join_ref": .string(joinRef)])
    }

    /// Obecność (`track`) w kanale z kluczem obecności.
    func track(_ topic: String, meta: [String: JSONValue]) {
        guard let channel = channels[topic], channel.joined, let joinRef = channel.joinRef else { return }
        send(["topic": .string("realtime:\(topic)"), "event": .string("presence"),
              "payload": .object(["type": .string("presence"), "event": .string("track"), "payload": .object(meta)]),
              "ref": .string(nextRef()), "join_ref": .string(joinRef)])
    }

    // MARK: Połączenie

    private func nextRef() -> String { ref += 1; return String(ref) }

    private func open() {
        guard !stopped, let endpoint else { return }
        generation += 1
        let current = generation
        Task { @MainActor [weak self] in
            guard let self else { return }
            do { self.token = try await self.tokenProvider?() ?? "" } catch { self.scheduleRetry(); return }
            guard current == self.generation, !self.stopped else { return }
            let socket = self.session.webSocketTask(with: endpoint)
            self.task = socket
            self.pendingHeartbeat = nil
            socket.resume()
            self.listen(socket, generation: current)
            self.startHeartbeat(current)
            for topic in self.channels.keys { self.sendJoin(topic) }
        }
    }

    private func sendJoin(_ topic: String) {
        guard var channel = channels[topic] else { return }
        let joinRef = nextRef()
        channel.joinRef = joinRef
        channel.joined = false
        channels[topic] = channel
        send(["topic": .string("realtime:\(topic)"), "event": .string("phx_join"),
              "payload": .object(["config": .object(channel.config), "access_token": .string(token)]),
              "ref": .string(joinRef), "join_ref": .string(joinRef)])
    }

    private func send(_ message: [String: JSONValue]) {
        guard let task, let data = try? JSONEncoder().encode(message), let text = String(data: data, encoding: .utf8) else { return }
        let current = generation
        task.send(.string(text)) { [weak self] error in
            guard error != nil else { return }
            Task { @MainActor in
                guard let self, current == self.generation else { return }
                self.dropped()
            }
        }
    }

    private func listen(_ socket: URLSessionWebSocketTask, generation current: Int) {
        socket.receive { [weak self] result in
            Task { @MainActor in
                guard let self, current == self.generation else { return }
                switch result {
                case .failure:
                    self.dropped()
                case .success(let message):
                    switch message {
                    case .string(let text): self.handle(text)
                    case .data(let data): if let text = String(data: data, encoding: .utf8) { self.handle(text) }
                    @unknown default: break
                    }
                    self.listen(socket, generation: current)
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8), let message = try? JSONDecoder().decode([String: JSONValue].self, from: data) else { return }
        let fullTopic = message["topic"]?.text ?? ""
        let event = message["event"]?.text ?? ""
        let payload = message["payload"]?.object ?? [:]
        let ref = message["ref"]?.text ?? ""
        if fullTopic == "phoenix" {
            if event == "phx_reply", ref == pendingHeartbeat { pendingHeartbeat = nil; attempts = 0 }
            return
        }
        let topic = fullTopic.hasPrefix("realtime:") ? String(fullTopic.dropFirst("realtime:".count)) : fullTopic
        switch event {
        case "phx_reply":
            guard var channel = channels[topic], channel.joinRef == ref else { return }
            let ok = payload["status"]?.text == "ok"
            channel.joined = ok
            channels[topic] = channel
            attempts = 0
            onChannel?(topic, ok)
        case "phx_error", "phx_close":
            guard var channel = channels[topic] else { return }
            channel.joined = false
            channels[topic] = channel
            onChannel?(topic, false)
            // Ponowne dołączenie po chwili (np. po odświeżeniu tokenu na serwerze).
            let current = generation
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard let self, current == self.generation, self.channels[topic] != nil, self.task != nil else { return }
                self.sendJoin(topic)
            }
        default:
            onEvent?(topic, event, payload)
        }
    }

    private func startHeartbeat(_ current: Int) {
        heartbeat?.cancel()
        heartbeat = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 25_000_000_000) } catch { return }
                guard let self, current == self.generation, !self.stopped else { return }
                // Brak odpowiedzi na poprzedni puls — połączenie jest martwe.
                if self.pendingHeartbeat != nil { self.dropped(); return }
                let ref = self.nextRef()
                self.pendingHeartbeat = ref
                self.send(["topic": .string("phoenix"), "event": .string("heartbeat"), "payload": .object([:]), "ref": .string(ref)])
                // Token odświeżony w międzyczasie — kanały dostają nowy (RLS dalej działa po wygaśnięciu starego).
                if let fresh = try? await self.tokenProvider?(), !fresh.isEmpty, fresh != self.token, current == self.generation {
                    self.token = fresh
                    for (topic, channel) in self.channels where channel.joined {
                        self.send(["topic": .string("realtime:\(topic)"), "event": .string("access_token"),
                                   "payload": .object(["access_token": .string(fresh)]), "ref": .string(self.nextRef()),
                                   "join_ref": .string(channel.joinRef ?? "")])
                    }
                }
            }
        }
    }

    private func dropped() {
        guard !stopped else { return }
        generation += 1
        heartbeat?.cancel(); heartbeat = nil
        task?.cancel(with: .abnormalClosure, reason: nil)
        task = nil
        pendingHeartbeat = nil
        for topic in Array(channels.keys) {
            channels[topic]?.joined = false
            onChannel?(topic, false)
        }
        scheduleRetry()
    }

    private func scheduleRetry() {
        guard !stopped else { return }
        retry?.cancel()
        let delays: [UInt64] = [1, 2, 5, 10, 30]
        let delay = delays[min(attempts, delays.count - 1)]
        attempts += 1
        retry = Task { @MainActor [weak self] in
            do { try await Task.sleep(nanoseconds: delay * 1_000_000_000) } catch { return }
            guard let self, !self.stopped, self.task == nil else { return }
            self.open()
        }
    }
}

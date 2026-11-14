import AppKit
import SwiftUI

// MARK: Oferty, część D1 — PDF oferty jak `OfferActions` w CRM: generowanie przez `/bridge/offers/generate-pdf` z postępem
// w strumieniu (te same etapy co okno generowania w CRM), pobranie gotowego pliku do Pobranych, wersja angielska
// (`translate-offer` przez `op=english`, podpis treści EN przy generowaniu), usuwanie plików PDF (`op=pdfDelete`).

/// Etapy generowania (`OFFER_PDF_STEPS`).
enum OfferPdfSteps {
    static let all: [(id: String, label: String)] = [
        ("queued", "Oczekiwanie na generator"),
        ("data", "Odczyt danych oferty"),
        ("layout", "Szablon, czcionki i okładka"),
        ("products", "Produkty, zdjęcia i pakiety"),
        ("pricing", "Kalkulacja i podsumowanie cen"),
        ("recommendations", "Propozycje dodatkowe"),
        ("finishing", "Warunki, zakończenie i numeracja stron"),
        ("saving", "Tworzenie i zapis pliku PDF"),
        ("download", "Pobieranie gotowego PDF"),
    ]
    static func label(_ id: String) -> String { all.first { $0.id == id }?.label ?? "Generujemy PDF…" }
    static func index(_ id: String) -> Int { all.firstIndex { $0.id == id } ?? 0 }
}

/// Błąd generowania z etapem i danymi do zgłoszenia (jak `OfferPdfFailure`).
struct OfferPdfFailure: Error, LocalizedError {
    var step: String
    var message: String
    var context: String = ""
    var code: String?
    var requestId: String?
    var status: Int?
    var occurredAt = Date()
    var errorDescription: String? { message }
}

struct OfferPdfResult {
    var pageCount: Int
    var downloadURL: URL?
    var fileName: String
    var compact: Bool
    var requestId: String?
}

/// Zlecenie generowania z karty akcji: język i podpis treści EN.
struct OfferPdfJob: Identifiable {
    let language: String
    let signature: String?
    var id: String { language + (signature ?? "") }
}

struct OfferEnglishState: Decodable, Equatable {
    var ready: Bool
    var signature: String?
}

extension OffersStore {
    /// Angielska treść oferty: `read` — zapisana, `generate` — tłumaczenie brakujących tekstów (do 3 minut).
    func english(_ id: String, action: String) async throws -> OfferEnglishState {
        guard let api else { throw AppError.configuration }
        let body: [String: JSONValue] = ["op": .string("english"), "id": .string(id), "action": .string(action)]
        return try JSONDecoder().decode(OfferEnglishState.self, from: try await api.post("/offers", body, timeout: action == "generate" ? 200 : 60))
    }

    /// Generowanie PDF jak w CRM (`Accept: application/x-ndjson`): postęp etapów na bieżąco, na końcu wynik z adresem pliku.
    func generatePdf(_ id: String, language: String, signature: String?, progress: (String, String?) -> Void) async throws -> OfferPdfResult {
        guard let api, let url = URL(string: api.base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/bridge/offers/generate-pdf") else {
            throw AppError.configuration
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        request.setValue("mac", forHTTPHeaderField: "X-Mavinci-Client")
        request.setValue("Bearer \(try await api.backend.token())", forHTTPHeaderField: "Authorization")
        var body: [String: JSONValue] = ["offerId": .string(id), "language": .string(language)]
        if let signature { body["expectedEnglishSignature"] = .string(signature) }
        request.httpBody = try JSONEncoder().encode(body)

        let (bytes, response) = try await URLSession.shared.bytes(for: request)
        let http = response as? HTTPURLResponse
        if http?.statusCode == 401 { throw AppError.unauthorized }
        var step = "queued"
        var detail = "Przygotowanie zlecenia generowania."
        var status = http?.statusCode ?? 0
        var result: [String: JSONValue]?
        if (http?.value(forHTTPHeaderField: "Content-Type") ?? "").contains("ndjson") {
            for try await line in bytes.lines {
                guard let data = line.data(using: .utf8), let event = try? JSONDecoder().decode([String: JSONValue].self, from: data) else { continue }
                switch event["type"]?.text {
                case "progress":
                    let next = event["step"]?.text ?? ""
                    if OfferPdfSteps.all.contains(where: { $0.id == next }) { step = next }
                    detail = event["detail"]?.text ?? ""
                    progress(step, detail.isEmpty ? nil : detail)
                case "result":
                    status = Int(event["status"]?.number ?? 0)
                    result = event["result"]?.object
                default:
                    break
                }
            }
        } else {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            result = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
        }
        guard let result else {
            throw OfferPdfFailure(step: step, message: "Utracono połączenie z generatorem. Odśwież ofertę i sprawdź zapisany PDF przed ponowieniem.",
                                  context: "Ostatni potwierdzony etap. \(detail)")
        }
        if status >= 400 || result["success"] != JSONValue.bool(true) {
            let failed = result["failedStep"]?.text ?? ""
            if OfferPdfSteps.all.contains(where: { $0.id == failed }) { step = failed }
            let code = result["code"]?.text
            let limit = status == 546 || code == "WORKER_RESOURCE_LIMIT" || code == "WORKER_LIMIT"
            let message = limit ? "Generator PDF chwilowo przekroczył limit zasobów. Spróbuj ponownie za chwilę."
                : [result["error"]?.text, result["message"]?.text].compactMap { $0 }.first { !$0.isEmpty } ?? "Błąd generowania PDF"
            throw OfferPdfFailure(step: step, message: message, context: detail, code: code, requestId: result["requestId"]?.text, status: status)
        }
        return OfferPdfResult(
            pageCount: Int(result["pageCount"]?.number ?? 0),
            downloadURL: (result["downloadUrl"]?.text).flatMap { URL(string: $0) },
            fileName: result["downloadFileName"]?.text ?? "Oferta.pdf",
            compact: result["resourceMode"]?.text == "compact",
            requestId: result["requestId"]?.text
        )
    }

    /// Gotowy PDF z generatora do Pobranych (jak automatyczne pobranie po generowaniu w CRM).
    func saveGeneratedPdf(_ result: OfferPdfResult) async throws -> URL? {
        guard let url = result.downloadURL else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 30
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw OfferPdfFailure(step: "download", message: "PDF został wygenerowany, ale pobranie nie powiodło się. Użyj przycisku pobierania oferty.",
                                  context: "PDF został wygenerowany i zapisany. Pobieranie pliku.", requestId: result.requestId, status: http.statusCode)
        }
        return try ContractFiles.saveToDownloads(data, name: result.fileName)
    }
}

// MARK: Okno generowania (jak `FullScreenLoader` + `OfferPdfProgressSteps`)

@MainActor struct OfferPdfGenerateSheet: View {
    @ObservedObject var store: OffersStore
    let offerID: String
    let job: OfferPdfJob
    /// Treść EN zmieniła się od przygotowania — karta przygotuje ją ponownie.
    var onEnglishStale: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var step = "queued"
    @State private var detail = ""
    @State private var failure: OfferPdfFailure?
    @State private var running = true
    @State private var copied = false

    private var title: String {
        guard let failure else { return "Generowanie oferty PDF" }
        return failure.step == "download" ? "PDF zapisany — błąd pobierania" : "Nie udało się ukończyć generowania PDF"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.title3.weight(.semibold))
                Text(failure == nil ? detail : "Szczegóły są widoczne pod odpowiednim krokiem.").font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 8) {
                ForEach(OfferPdfSteps.all, id: \.id) { item in stepRow(item.id, item.label) }
            }
            if failure != nil {
                HStack {
                    Spacer()
                    Button(copied ? "Skopiowano" : "Kopiuj szczegóły") { copyDetails() }
                    Button("Zamknij") { dismiss() }.buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                }
            }
        }
        .padding(20)
        .frame(width: 520)
        .background(theme.page)
        .interactiveDismissDisabled(running)
        .task { await run() }
    }

    @ViewBuilder private func stepRow(_ id: String, _ label: String) -> some View {
        let current = OfferPdfSteps.index(step)
        let index = OfferPdfSteps.index(id)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Group {
                    if index < current {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    } else if index == current, failure != nil {
                        Image(systemName: "xmark.octagon.fill").foregroundStyle(.red)
                    } else if index == current {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "circle").foregroundStyle(.tertiary)
                    }
                }
                .frame(width: 18)
                Text(label).font(.callout.weight(index == current ? .semibold : .regular))
                    .foregroundStyle(index > current ? Color.secondary : Color.primary)
            }
            if index == current, let failure {
                VStack(alignment: .leading, spacing: 3) {
                    Text(failure.message).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
                    if !failure.context.isEmpty { Text(failure.context).font(.caption).foregroundStyle(.secondary) }
                    if let requestId = failure.requestId { Text("Identyfikator zgłoszenia: \(requestId)").font(.caption2).foregroundStyle(.secondary).textSelection(.enabled) }
                }
                .padding(.leading, 28)
            }
        }
    }

    private func run() async {
        detail = job.language == "en" ? "Sprawdzamy zapisaną wersję EN i przygotowujemy zlecenie." : "Przygotowujemy zlecenie generowania."
        do {
            if job.language == "en" {
                let saved = try await store.english(offerID, action: "read")
                guard saved.ready, saved.signature == job.signature else {
                    onEnglishStale()
                    throw OfferPdfFailure(step: "queued", message: "Angielska treść wymaga aktualizacji. Poczekaj na przygotowanie EN i ponów generowanie.",
                                          context: "Sprawdzanie zapisanej wersji angielskiej.")
                }
            }
            let result = try await store.generatePdf(offerID, language: job.language, signature: job.signature) { next, text in
                step = next
                detail = text ?? OfferPdfSteps.label(next)
            }
            step = "download"
            detail = "PDF jest gotowy. Pobieramy zapisany plik…"
            let saved = try await store.saveGeneratedPdf(result)
            running = false
            await store.loadDetail(offerID)
            Task { await store.sync(force: true) }
            let pages = "\(result.pageCount) stron" + (result.compact ? " — tryb zoptymalizowany" : "")
            store.workspace?.succeed(saved == nil ? "PDF wygenerowany pomyślnie (\(pages))" : "PDF wygenerowany pomyślnie (\(pages)) — zapisany w Pobranych")
            dismiss()
        } catch let error as OfferPdfFailure {
            fail(error)
        } catch {
            let timeout = (error as? URLError)?.code == .timedOut
            let lost = timeout || error is URLError
            let message: String
            if step == "download" && lost {
                message = "PDF został zapisany, ale pobieranie zostało przerwane. Zamknij okno i użyj przycisku pobierania oferty."
            } else if timeout {
                message = "Przekroczono czas oczekiwania. Serwer może nadal zapisać PDF — odśwież ofertę i sprawdź plik przed ponowieniem."
            } else {
                message = store.failureText(error, "Błąd podczas generowania PDF")
            }
            fail(OfferPdfFailure(step: step, message: message, context: (lost ? "Ostatni potwierdzony etap. " : "") + detail))
        }
    }

    private func fail(_ error: OfferPdfFailure) {
        failure = error
        step = error.step
        running = false
        Task { await store.loadDetail(offerID) }
    }

    private func copyDetails() {
        guard let failure else { return }
        let lines: [String?] = [
            "Oferta: \(offerID)", "Czas: \(ISO8601DateFormatter().string(from: failure.occurredAt))", "Etap: \(OfferPdfSteps.label(failure.step))",
            failure.context.isEmpty ? nil : failure.context, "Błąd: \(failure.message)",
            failure.code.map { "Kod: \($0)" }, failure.status.map { "HTTP: \($0)" }, failure.requestId.map { "Identyfikator zgłoszenia: \($0)" },
        ]
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(lines.compactMap { $0 }.joined(separator: "\n"), forType: .string)
        copied = true
    }
}

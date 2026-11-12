import PDFKit
import SwiftUI

// MARK: Wydruki wydarzenia — szuflada pod przyciskiem drukarki na pasku karty
//
// Karta imprezy generowana na żądanie oraz dokumenty wygenerowane w wydarzeniu (oferty, kalkulacje, umowy, agendy, checklisty
// sprzętu, faktury) — najnowsze najpierw, z podglądem i szybkim drukiem. Listę zwraca serwer (`files` → `documents`) według
// uprawnień pracownika (RLS jak w zakładce Pliki CRM), więc każdy widzi tylko wydruki ze swojego zakresu. Gdy dokumentu danego
// rodzaju jeszcze nie ma, a pracownik ma tę zakładkę — skrót do miejsca, w którym się go generuje.

struct EventPrintDocument: Decodable, Identifiable {
    let id: String
    let name: String
    let type: String
    let size: Double?
    let createdAt: String?
}

@MainActor struct EventPrintDrawer: View {
    @ObservedObject var store: EventCardStore
    let eventID: String
    let canPrintCard: Bool
    /// Zakładki widoczne dla pracownika (skróty „wygeneruj w zakładce…”).
    let tabs: Set<String>
    let printCard: () -> Void
    let openTab: (String) -> Void
    let show: (NativePreview) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var documents: [EventPrintDocument]?
    @State private var failed: String?
    @State private var busy: String?

    private struct Kind {
        let type: String
        let title: String
        let symbol: String
        let tab: String?
        let tabTitle: String
    }

    private static let kinds: [Kind] = [
        Kind(type: "offer", title: "Oferty", symbol: "doc.richtext", tab: "offer", tabTitle: "Oferta"),
        Kind(type: "calculation", title: "Kalkulacje", symbol: "function", tab: "calculations", tabTitle: "Kalkulacje"),
        Kind(type: "contract", title: "Umowy", symbol: "signature", tab: "contract", tabTitle: "Umowa"),
        Kind(type: "agenda", title: "Agenda", symbol: "list.bullet.rectangle", tab: "agenda", tabTitle: "Agenda"),
        Kind(type: "equipment_checklist", title: "Checklisty sprzętu", symbol: "shippingbox", tab: "equipment", tabTitle: "Sprzęt"),
        Kind(type: "invoice", title: "Faktury", symbol: "doc.plaintext", tab: nil, tabTitle: ""),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Label("Wydruki", systemImage: "printer").font(.headline)
                Spacer()
                if documents == nil && failed == nil { ProgressView().controlSize(.small) }
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if canPrintCard { cardSection }
                    if let failed {
                        Text(failed).font(.callout).foregroundStyle(.secondary)
                    } else if let documents {
                        ForEach(Self.kinds, id: \.type) { kind in
                            section(kind, documents.filter { $0.type == kind.type })
                        }
                    }
                }
                .padding(.horizontal, 14).padding(.bottom, 14)
            }
        }
        .frame(width: 400)
        .frame(maxHeight: 560)
        .task { await load() }
    }

    private var cardSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Do wygenerowania").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Button { printCard() } label: {
                HStack(spacing: 10) {
                    Image(systemName: "doc.text.image").frame(width: 22).foregroundStyle(theme.accent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Karta imprezy").font(.callout.weight(.medium))
                        Text("Aktualne dane wydarzenia — podgląd, druk, zapis").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                }
                .padding(10)
                .background(theme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 9))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder private func section(_ kind: Kind, _ items: [EventPrintDocument]) -> some View {
        let hint: Bool = items.isEmpty && kind.tab.map { tabs.contains($0) } == true
        if !items.isEmpty || hint {
            VStack(alignment: .leading, spacing: 4) {
                Text(kind.title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                ForEach(items.prefix(5)) { item in row(item, kind) }
                if items.count > 5 {
                    Text("Starsze: \(items.count - 5) — w zakładce Pliki").font(.caption).foregroundStyle(.secondary)
                }
                if hint, let tab = kind.tab {
                    Button { openTab(tab) } label: {
                        Label("Brak — wygeneruj w zakładce \(kind.tabTitle)", systemImage: "arrow.right.circle")
                            .font(.caption)
                    }
                    .buttonStyle(.borderless)
                    .foregroundStyle(theme.accent)
                }
            }
        }
    }

    private func row(_ item: EventPrintDocument, _ kind: Kind) -> some View {
        HStack(spacing: 10) {
            Image(systemName: kind.symbol).frame(width: 22).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.name).font(.callout).lineLimit(1).truncationMode(.middle)
                Text(Self.date(item.createdAt)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            if busy == item.id {
                ProgressView().controlSize(.small)
            } else {
                Button { Task { await open(item, print: false) } } label: { Image(systemName: "eye") }
                    .buttonStyle(.borderless).help("Podgląd")
                Button { Task { await open(item, print: true) } } label: { Image(systemName: "printer") }
                    .buttonStyle(.borderless).help("Drukuj")
            }
        }
        .padding(.vertical, 6).padding(.horizontal, 8)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { Task { await open(item, print: false) } }
    }

    private static func date(_ value: String?) -> String {
        guard let value, let date = FinderLikeDate.parse(value) else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "pl_PL")
        f.dateFormat = "d MMM yyyy, HH:mm"
        return "Wygenerowano " + f.string(from: date)
    }

    private func load() async {
        struct Reply: Decodable { let documents: [EventPrintDocument] }
        do {
            documents = try await store.tabQuery(eventID, "files", "documents", as: Reply.self).documents
        } catch {
            failed = store.failureText(error, "Nie udało się pobrać listy dokumentów.")
        }
    }

    private func open(_ item: EventPrintDocument, print: Bool) async {
        struct Links: Decodable { let urls: [String: String] }
        busy = item.id
        defer { busy = nil }
        do {
            let links = try await store.tabQuery(eventID, "files", "urls", ["ids": item.id], as: Links.self)
            guard let link = links.urls[item.id], let url = URL(string: link) else { throw AppError.invalidResponse }
            let (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? true else { throw URLError(.badServerResponse) }
            if print {
                try CalculationPdf.printDocument(PDFDocument(data: data))
            } else {
                show(NativePreview(name: item.name, data: data))
            }
        } catch {
            failed = store.failureText(error, "Nie udało się otworzyć dokumentu „\(item.name)”.")
        }
    }
}

/// Daty z bazy (`2026-11-12T17:20:24.673944+00:00`) — ułamki sekund pomijamy.
enum FinderLikeDate {
    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()
    static func parse(_ value: String) -> Date? {
        var text = value.replacingOccurrences(of: " ", with: "T")
        if let dot = text.firstIndex(of: ".") {
            let rest = text[text.index(after: dot)...]
            let zone = rest.firstIndex(where: { $0 == "+" || $0 == "-" || $0 == "Z" }) ?? rest.endIndex
            text = String(text[..<dot]) + String(rest[zone...])
        }
        if text.hasSuffix("+00") { text += ":00" }
        return formatter.date(from: text)
    }
}

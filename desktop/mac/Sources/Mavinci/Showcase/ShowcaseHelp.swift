import SwiftUI

// MARK: Strefa sprzedawcy → „Prezentacje” → „?” — instrukcja z przykładem treściwej karty (natywnie)
//
// Te same rozdziały co znak „?” w CRM i „?” w aplikacji mobilnej (`src/lib/help/presentationsHelp.ts`, z serwera CRM:
// `GET /bridge/native/v1/showcase?op=help`). „Utwórz kartę z przykładu” dodaje do wybranego działu ukrytą kartę
// „Ciężki dym — pierwszy taniec w chmurach” (`SHOWCASE_EXAMPLE` na serwerze) — do obejrzenia w podglądzie i przerobienia.

struct ShowcaseHelpManual: Decodable, Equatable {
    struct Question: Decodable, Hashable { var q: String; var a: String }
    struct Chapter: Decodable, Identifiable, Hashable {
        var id: String
        var title: String
        var summary: String
        var steps: [String]?
        var notes: [String]?
        var faq: [Question]?
    }
    var title: String
    var chapters: [Chapter]
}

@MainActor struct ShowcaseHelpSheet: View {
    @ObservedObject var store: ShowcaseStore
    /// Rozdział otwarty na starcie (jak „?” w CRM — „Treściwa karta w 7 krokach”).
    var initialChapter: String? = "karta"
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var manual: ShowcaseHelpManual?
    @State private var problem: String?
    @State private var selected: String?
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(manual?.title ?? "Prezentacje — instrukcja").font(.title3.weight(.light))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if let manual {
                content(manual)
            } else if let problem {
                ContentUnavailableView {
                    Label("Nie udało się wczytać instrukcji", systemImage: "questionmark.circle")
                } description: { Text(problem) } actions: {
                    Button("Spróbuj ponownie") { Task { await load() } }
                }
            } else {
                ProgressView("Wczytywanie instrukcji…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            footer
        }
        .padding(20).frame(width: 900, height: 660)
        .task {
            if selected == nil { selected = initialChapter }
            if manual == nil { await load() }
        }
    }

    private func load() async {
        problem = nil
        do { manual = try await store.help() } catch { problem = store.failureText(error, "Sprawdź połączenie z serwerem CRM.") }
    }

    /// Karta z przykładu w wybranym dziale (tylko z prawem edycji Prezentacji) — jak stopka „?” w CRM.
    @ViewBuilder private var footer: some View {
        if store.home?.access.manage == true {
            Divider()
            HStack {
                if let section = store.selectedSection {
                    Text("Przykład trafi do działu jako karta ukryta — podejrzyj go w „Podgląd na iPadzie” i przerób na swoją.")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        dismiss()
                        Task { await store.createItem(sectionID: section.id, title: nil, productID: nil, example: true) }
                    } label: { Label("Utwórz kartę z przykładu w „\(section.title)”", systemImage: "plus") }
                        .buttonStyle(.borderedProminent)
                } else {
                    Text("Wybierz dział, aby utworzyć w nim kartę z przykładu.").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
            }
        }
    }

    private func matches(_ chapter: ShowcaseHelpManual.Chapter, _ term: String) -> Bool {
        guard !term.isEmpty else { return true }
        var parts = [chapter.title, chapter.summary]
        parts += chapter.steps ?? []
        parts += chapter.notes ?? []
        for item in chapter.faq ?? [] { parts += [item.q, item.a] }
        let text = parts.joined(separator: " ")
        // Bez polskich znaków i wielkości liter — jak `searchHelp` w CRM.
        return term.split(separator: " ").allSatisfy { text.localizedStandardContains($0) }
    }

    private func content(_ manual: ShowcaseHelpManual) -> some View {
        let term = query.trimmingCharacters(in: .whitespaces)
        let chapters = manual.chapters.filter { matches($0, term) }
        let current = chapters.first { $0.id == selected } ?? chapters.first
        return HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                TextField("Szukaj w instrukcji", text: $query).textFieldStyle(.roundedBorder)
                List(chapters, selection: $selected) { chapter in
                    Text(chapter.title).lineLimit(2).tag(chapter.id)
                }
                .overlay { if chapters.isEmpty { Text("Nic nie znaleziono.").foregroundStyle(.secondary) } }
            }
            .frame(width: 250)
            ScrollView {
                if let chapter = current { chapterView(chapter) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func chapterView(_ chapter: ShowcaseHelpManual.Chapter) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(chapter.title).font(.title3)
            Text(chapter.summary).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            if let steps = chapter.steps, !steps.isEmpty {
                Text("Jak to zrobić").font(.headline)
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(index + 1)").font(.caption.weight(.semibold)).frame(width: 22, height: 22)
                            .background(theme.accent.opacity(0.15), in: Circle()).foregroundStyle(theme.accent)
                        Text(step).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let notes = chapter.notes, !notes.isEmpty {
                Text("Dobrze wiedzieć").font(.headline)
                ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "lightbulb").foregroundStyle(theme.accent).font(.caption)
                        Text(note).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let faq = chapter.faq, !faq.isEmpty {
                Text("Częste pytania").font(.headline)
                ForEach(faq, id: \.self) { item in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.q).font(.callout.weight(.medium))
                        Text(item.a).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .textSelection(.enabled)
        .padding(.trailing, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

import SwiftUI

/// Instrukcja opiekuna sprzedawców — ta sama treść co znak „?” w CRM (`src/lib/help/managerHelp.ts`, z serwera CRM).
@MainActor struct SellersHelpSheet: View {
    @ObservedObject var store: SellersStore
    /// Rozdział otwarty na starcie (np. `ocena` z karty oferty).
    var initialChapter: String? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var selected: String?
    @State private var query = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(store.help?.title ?? "Instrukcja opiekuna sprzedawców").font(.title3.weight(.light))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            if let help = store.help {
                content(help)
            } else if let error = store.helpError {
                ContentUnavailableView {
                    Label("Nie udało się wczytać instrukcji", systemImage: "questionmark.circle")
                } description: { Text(error) } actions: {
                    Button("Spróbuj ponownie") { Task { store.helpError = nil; await store.loadHelp() } }
                }
            } else {
                ProgressView("Wczytywanie instrukcji…").frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(20).frame(width: 900, height: 660)
        .task {
            if selected == nil { selected = initialChapter }
            await store.loadHelp()
        }
    }

    private func matches(_ chapter: SellersHelp.Chapter, _ term: String) -> Bool {
        guard !term.isEmpty else { return true }
        var parts = [chapter.title, chapter.summary]
        parts += chapter.steps ?? []
        parts += chapter.notes ?? []
        for item in chapter.faq ?? [] { parts += [item.q, item.a] }
        return parts.joined(separator: " ").localizedStandardContains(term)
    }

    private func content(_ help: SellersHelp) -> some View {
        let term = query.trimmingCharacters(in: .whitespaces)
        let chapters = help.chapters.filter { matches($0, term) }
        let current = chapters.first { $0.id == selected } ?? chapters.first
        return VStack(alignment: .leading, spacing: 12) {
            // Oś w 5 etapach — hotel i opiekun używają tych samych nazw.
            HStack(spacing: 6) {
                ForEach(Array(help.stages.enumerated()), id: \.element.id) { index, stage in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(index + 1). \(stage.label)").font(.caption.weight(.semibold)).foregroundStyle(theme.accent)
                        Text(stage.hint).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                    }
                    .padding(8).frame(maxWidth: .infinity, alignment: .topLeading)
                    .background(theme.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            HStack(alignment: .top, spacing: 14) {
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
    }

    private func chapterView(_ chapter: SellersHelp.Chapter) -> some View {
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

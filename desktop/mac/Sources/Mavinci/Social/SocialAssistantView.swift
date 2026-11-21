import SwiftUI

// MARK: Asystent AI w kreatorze posta — 1:1 z CRM (`SocialAssistant.tsx`): „Napisz” (3 wersje opisu z hashtagami, tytułem
// i podpisem grafiki — temat, cel, ton, długość, opcjonalnie zdjęcie), „Popraw opis” (szybkie poprawki albo własne polecenie)
// i „Hashtagi” (podpowiedzi w grupach do zaznaczania). Bierze niezapisane wartości z kreatora; propozycja zmienia formularz
// dopiero po wybraniu. Wyłączonego asystenta włącza osoba akceptująca (zgoda zapisana z osobą i datą).

struct SocialAssistantDraft {
    var caption: String
    var hashtags: String
    var headline: String
    var subline: String
    var eventID: String?
    var assetID: String?
    var channels: [SocialChannel]
}

struct SocialAssistantPanel: View {
    @ObservedObject var store: SocialStore
    let detail: SocialPostDetail
    let draft: SocialAssistantDraft
    /// Wybrana propozycja: opis i hashtagi, a przy `true` — także tytuł i podpis grafiki.
    let onUse: (SocialAiSuggestion, Bool) -> Void
    let onHashtags: ([String]) -> Void
    @Environment(\.crmTheme) private var theme

    private enum Tab: String, CaseIterable, Identifiable {
        case write, rewrite, hashtags
        var id: String { rawValue }
        var label: String { self == .write ? "Napisz" : self == .rewrite ? "Popraw opis" : "Hashtagi" }
        var symbol: String { self == .write ? "pencil.line" : self == .rewrite ? "wand.and.stars" : "number" }
    }

    @State private var tab: Tab = .write
    @State private var topic = ""
    @State private var goal: SocialAiGoal?
    @State private var tone: SocialAiTone? = .elegant
    @State private var length: SocialAiLength = .medium
    @State private var usePhoto = false
    @State private var instruction = ""
    @State private var reply: SocialAssistReply?
    @State private var confirmEnable = false
    @State private var goalInitialized = false

    var body: some View {
        Group {
            if detail.settings.aiCaptionsEnabled { panel } else { disabledBox }
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 10).stroke(theme.accent.opacity(0.25)))
        .onAppear {
            guard !goalInitialized else { return }
            goalInitialized = true
            if detail.event != nil { goal = .realization }
        }
    }

    private var disabledBox: some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles").foregroundStyle(theme.accent)
            Text("Asystent AI pisze opisy, poprawia je i dobiera hashtagi. " + (detail.access.approve ? "Jest wyłączony dla tej marki." : "Włącza go osoba akceptująca posty („Szablony i AI”)."))
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Spacer()
            if detail.access.approve {
                Button { confirmEnable = true } label: { Label("Włącz asystenta AI", systemImage: "sparkles") }
            }
        }
        .confirmationDialog("Włączyć asystenta AI?", isPresented: $confirmEnable, titleVisibility: .visible) {
            Button("Włącz asystenta") { Task { await store.enableAssistant(companyID: detail.post.companyId) } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Do OpenAI trafią: temat i opis wpisane w kreatorze, rodzaj wydarzenia, miejsce, miesiąc i opis realizacji; nazwa wydarzenia i klient — tylko przy zgodzie klienta na publikację; zdjęcie — tylko gdy zaznaczysz „Uwzględnij zdjęcie” i ma ono zgodę klienta. Zgoda zostanie zapisana z Twoim nazwiskiem i datą; wyłączysz ją w „Szablony i AI”.")
        }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Asystent AI", systemImage: "sparkles").font(.subheadline)
                Spacer()
                Picker("", selection: $tab) {
                    ForEach(Tab.allCases) { item in Label(item.label, systemImage: item.symbol).tag(item) }
                }
                .pickerStyle(.segmented).labelsHidden().fixedSize()
                .onChange(of: tab) { _, _ in reply = nil }
            }
            switch tab {
            case .write: writeTab
            case .rewrite: rewriteTab
            case .hashtags: hashtagsTab
            }
            if let reply, reply.mode != "hashtags" {
                ForEach(Array(reply.suggestions.enumerated()), id: \.offset) { _, suggestion in suggestionCard(suggestion) }
            }
            Text("Do AI trafia temat i opis z kreatora, rodzaj wydarzenia, miejsce, miesiąc i opis realizacji; nazwa wydarzenia i klient — tylko przy zgodzie klienta; zdjęcie — tylko gdy zaznaczysz i ma zgodę klienta na publikację. Propozycje nie zmieniają posta, dopóki ich nie użyjesz.\(reply?.usedPhoto == true ? " Ta odpowiedź uwzględnia zdjęcie." : "")")
                .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Zakładki

    private var writeTab: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("O czym jest post? Np. jubileusz 30 lat marki, scena z ekranem LED, teleturniej dla gości (opcjonalnie)", text: $topic, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.roundedBorder)
                .onChange(of: topic) { _, value in if value.count > 500 { topic = String(value.prefix(500)) } }
            Text("Cel").font(.caption).foregroundStyle(.secondary)
            chips(SocialAiGoal.allCases, selected: goal, label: \.label) { goal = goal == $0 ? nil : $0 }
            Text("Ton").font(.caption).foregroundStyle(.secondary)
            chips(SocialAiTone.allCases, selected: tone, label: \.label) { tone = tone == $0 ? nil : $0 }
            Text("Długość").font(.caption).foregroundStyle(.secondary)
            chips(SocialAiLength.allCases, selected: length, label: \.label) { length = $0 }
            photoToggle
            Button { Task { await write() } } label: { Label("Napisz 3 wersje", systemImage: "sparkles") }
        }
    }

    private var rewriteTab: some View {
        let hasCaption = !draft.caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 8) {
            if !hasCaption {
                Text("Najpierw wpisz opis (albo skorzystaj z „Napisz”) — asystent go poprawi.").font(.caption).foregroundStyle(.orange)
            }
            WrapLayout(spacing: 6) {
                ForEach(SocialAiRewrite.allCases) { item in
                    chip(item.label, active: false) { Task { await ask("Asystent AI poprawia opis", ["mode": .string("rewrite"), "rewrite": .string(item.rawValue)]) } }
                        .disabled(!hasCaption)
                }
            }
            HStack {
                TextField("Własne polecenie, np. „podkreśl, że cała technika była nasza”", text: $instruction).textFieldStyle(.roundedBorder)
                    .onChange(of: instruction) { _, value in if value.count > 300 { instruction = String(value.prefix(300)) } }
                Button { Task { await ask("Asystent AI poprawia opis", ["mode": .string("rewrite"), "instruction": .string(instruction)]) } } label: {
                    Label("Popraw", systemImage: "wand.and.stars")
                }
                .disabled(!hasCaption || instruction.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private var hashtagsTab: some View {
        let current = socialHashtags(draft.hashtags)
        let hint: String = current.count < socialHashtagsRecommended.lowerBound
            ? "Dodaj kilka trafnych (zalecane \(socialHashtagsRecommended.lowerBound)–\(socialHashtagsRecommended.upperBound))."
            : current.count > socialHashtagsRecommended.upperBound
                ? "Najlepiej działa \(socialHashtagsRecommended.lowerBound)–\(socialHashtagsRecommended.upperBound) trafnych hashtagów."
                : "Liczba hashtagów w sam raz."
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Button { Task { await ask("Asystent AI dobiera hashtagi", ["mode": .string("hashtags"), "topic": .string(topic)]) } } label: {
                    Label(reply?.mode == "hashtags" ? "Inne propozycje" : "Dobierz hashtagi", systemImage: "number")
                }
                photoToggle
            }
            Text("W poście: \(current.count)/30. \(hint) Kliknij hashtag, żeby go dodać albo usunąć.")
                .font(.caption).foregroundStyle(current.count > 30 ? Color.red : Color.secondary)
            if let reply, reply.mode == "hashtags" {
                ForEach(reply.hashtagGroups, id: \.key) { group in
                    Text(group.label).font(.caption).foregroundStyle(.secondary)
                    WrapLayout(spacing: 6) {
                        ForEach(group.tags, id: \.self) { tag in
                            let selected = current.contains { $0.lowercased() == tag.lowercased() }
                            chip(tag, active: selected) { onHashtags(socialToggleHashtag(current, tag)) }
                        }
                    }
                }
            }
        }
    }

    private var photoToggle: some View {
        Toggle("Uwzględnij zdjęcie", isOn: Binding(get: { usePhoto && draft.assetID != nil }, set: { usePhoto = $0 }))
            .toggleStyle(.checkbox).font(.caption)
            .disabled(draft.assetID == nil)
            .help(draft.assetID == nil ? "Wybierz zdjęcie posta" : "AI opisze to, co widać na zdjęciu (miniatura; tylko zdjęcie ze zgodą klienta)")
    }

    // MARK: Elementy

    private func suggestionCard(_ suggestion: SocialAiSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if !suggestion.headline.isEmpty || !suggestion.subline.isEmpty {
                Text("Na grafice: " + suggestion.headline + (suggestion.subline.isEmpty ? "" : " · " + suggestion.subline)).font(.caption).foregroundStyle(theme.accent)
            }
            Text(suggestion.caption).font(.caption).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if !suggestion.hashtags.isEmpty {
                Text(suggestion.hashtags.joined(separator: " ")).font(.caption2).foregroundStyle(.secondary).textSelection(.enabled)
            }
            HStack {
                Button("Użyj opisu i hashtagów") { onUse(suggestion, false) }
                if !suggestion.headline.isEmpty || !suggestion.subline.isEmpty {
                    Button("Użyj z tytułem na grafice") { onUse(suggestion, true) }
                }
            }
        }
        .padding(8).frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
    }

    private func chips<Item: Identifiable & Equatable>(_ items: [Item], selected: Item?, label: KeyPath<Item, String>, action: @escaping (Item) -> Void) -> some View {
        WrapLayout(spacing: 6) {
            ForEach(items) { item in chip(item[keyPath: label], active: selected == item) { action(item) } }
        }
    }

    private func chip(_ title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 3) {
                if active { Image(systemName: "checkmark").font(.caption2) }
                Text(title).font(.caption)
            }
            .padding(.horizontal, 9).padding(.vertical, 4)
            .foregroundStyle(active ? theme.accent : Color.primary.opacity(0.8))
            .background(Capsule().fill(active ? theme.accent.opacity(0.18) : Color.clear))
            .overlay(Capsule().stroke(active ? theme.accent.opacity(0.7) : Color.primary.opacity(0.15)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: Zapytanie

    private func write() async {
        let extra: [String: JSONValue] = [
            "mode": .string("write"),
            "topic": .string(topic),
            "goal": goal.map { JSONValue.string($0.rawValue) } ?? .null,
            "tone": tone.map { JSONValue.string($0.rawValue) } ?? .null,
            "length": .string(length.rawValue),
        ]
        await ask("Asystent AI pisze", extra)
    }

    private func ask(_ pending: String, _ extra: [String: JSONValue]) async {
        var body: [String: JSONValue] = [
            "id": .string(detail.post.id),
            "caption": .string(draft.caption),
            "hashtags": .array(socialHashtags(draft.hashtags).map(JSONValue.string)),
            "headline": .string(draft.headline),
            "subline": .string(draft.subline),
            "eventId": draft.eventID.map(JSONValue.string) ?? .null,
            "assetId": draft.assetID.map(JSONValue.string) ?? .null,
            "channels": .array(draft.channels.map { JSONValue.string($0.rawValue) }),
            "usePhoto": .bool(usePhoto && draft.assetID != nil),
        ]
        for (key, value) in extra { body[key] = value }
        guard let result = await store.assist(body, pending: pending) else { return }
        reply = result
        if let note = result.photoNote {
            usePhoto = false
            store.workspace?.notice = note
        }
    }
}

import SwiftUI

// MARK: Social media → „Szablony i AI” (akceptujący) — 1:1 z CRM (`SocialSettingsModal`): opisy AI (zgoda na przekazanie treści
// realizacji bez danych osobowych), analiza AI raportu tygodniowego (zgoda na zagregowane wyniki), stałe hashtagi i styl opisów
// oraz szablony grafik — wyłącznie logo, fonty i kolory z księgi znaku marki — z domyślnym stylem grafik nowych postów.

@MainActor struct SocialSettingsSheet: View {
    @ObservedObject var store: SocialStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var ai = false
    @State private var aiReports = false
    @State private var hashtags = ""
    @State private var style = ""
    @State private var templates: [SocialTemplate] = []
    @State private var brandbook: SocialBrandbook?
    @State private var templateID: String?
    @State private var name = "Nowy szablon"
    @State private var isDefault = false
    @State private var logoID: String?
    @State private var titleFontID: String?
    @State private var captionFontID: String?
    @State private var overlayID: String?
    @State private var accentID: String?
    @State private var textID: String?
    @State private var defaultStyle: SocialGraphicStyle = .classic

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Social media — szablony i AI").font(.title2.weight(.light))
                Spacer()
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    aiSection
                    Divider()
                    templateSection
                }
                .padding(.trailing, 6)
            }
        }
        .padding(20)
        .frame(width: 760, height: 760)
        .task {
            if let home = store.home {
                ai = home.settings.aiCaptionsEnabled
                aiReports = home.settings.aiReportsEnabled ?? false
                hashtags = home.settings.defaultHashtags.joined(separator: " ")
                style = home.settings.captionStyle
                templates = home.templates
                pick(home.templates.first { $0.isDefault } ?? home.templates.first)
            }
            brandbook = await store.brandbook()
        }
    }

    private var aiSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Opisy AI i hashtagi", systemImage: "sparkles").font(.headline)
            Toggle(isOn: $ai) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Opisy AI z danych realizacji")
                    Text("Do usługi AI (OpenAI, konfiguracja marketingu) trafia rodzaj eventu, miejsce, miesiąc, opis realizacji ze strony i robocza treść posta. Nazwa eventu i klient — tylko przy zgodzie klienta. Bez danych osobowych i kontaktowych.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if let at = store.home?.settings.aiConsentAt { Text("Włączone: \(SocialDates.dateTime(at))").font(.caption2).foregroundStyle(.secondary) }
                }
            }
            .toggleStyle(.checkbox)
            Toggle(isOn: $aiReports) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Analiza AI w raporcie tygodniowym „Trendy i rekomendacje”")
                    Text("Do usługi AI trafiają wyłącznie zagregowane wyniki postów (wyświetlenia, zasięg, interakcje, kanał, dzień i pora publikacji, długość opisu, liczba hashtagów, liczba komentarzy) — bez treści postów i komentarzy, tytułów i danych osobowych. Bez zgody raport zawiera same liczby i wnioski z danych.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    if let at = store.home?.settings.aiReportsConsentAt { Text("Włączone: \(SocialDates.dateTime(at))").font(.caption2).foregroundStyle(.secondary) }
                }
            }
            .toggleStyle(.checkbox)
            TextField("Stałe hashtagi marki, np. #mavinci #eventy", text: $hashtags).textFieldStyle(.roundedBorder)
            TextField("Styl opisów (wskazówki dla AI)", text: $style, axis: .vertical).lineLimit(2...4).textFieldStyle(.roundedBorder)
            Button("Zapisz ustawienia") { Task { await store.saveSettings(ai: ai, aiReports: aiReports, hashtags: socialHashtags(hashtags), style: style) } }
                .buttonStyle(.borderedProminent)
        }
    }

    private var templateSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Szablony grafik").font(.headline)
            Text("Szablon wskazuje logo, fonty i kolory z księgi znaku marki (Ustawienia → Moje firmy → Księga znaku). Fonty muszą mieć plik, żeby grafika była identyczna w CRM, na Macu i w telefonie.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                ForEach(templates) { template in
                    Button(template.name + (template.isDefault ? " ★" : "") + (template.ready ? "" : " (niegotowy)")) { pick(template) }
                        .buttonStyle(.bordered).tint(templateID == template.id ? .accentColor : .secondary)
                }
                Button { pick(nil) } label: { Label("Nowy szablon", systemImage: "plus") }
            }
            if let current = templates.first(where: { $0.id == templateID }), !current.ready {
                Text(current.problems.joined(separator: " ")).font(.caption).foregroundStyle(.orange)
            }
            TextField("Nazwa", text: $name).textFieldStyle(.roundedBorder)
            Toggle("Domyślny szablon marki", isOn: $isDefault).toggleStyle(.checkbox)
            Text("Logo (na zdjęciach — wersja w negatywie)").font(.subheadline)
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(brandbook?.logos ?? []) { logo in
                        Button { logoID = logo.id } label: {
                            VStack(spacing: 2) {
                                SocialImageView(url: logo.url, contentMode: .fit).frame(width: 96, height: 48)
                                Text(logo.label).font(.caption2).lineLimit(1).foregroundStyle(.white.opacity(0.85))
                            }
                            .padding(6).frame(width: 112, height: 76)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color(white: 0.3)))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(logoID == logo.id ? Color.accentColor : Color.clear, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            HStack(spacing: 14) {
                fontPicker("Font tytułu", selection: $titleFontID)
                fontPicker("Font podpisu", selection: $captionFontID)
            }
            colorRow("Przyciemnienie (dół zdjęcia)", selection: $overlayID)
            colorRow("Akcent (kreska i podpis)", selection: $accentID)
            colorRow("Tytuł (tekst na zdjęciu)", selection: $textID)
            Picker("Domyślny styl grafik", selection: $defaultStyle) {
                ForEach(SocialGraphicStyle.allCases) { style in Text(style.label).tag(style) }
            }
            .frame(maxWidth: 330)
            Text(defaultStyle.hint + " Nowe posty dostają ten styl; w kreatorze można wybrać inny.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Zapisz szablon") { Task { await save() } }.buttonStyle(.borderedProminent)
        }
    }

    private func fontPicker(_ title: String, selection: Binding<String?>) -> some View {
        Picker(title, selection: selection) {
            Text("— wybierz —").tag(String?.none)
            ForEach(brandbook?.fonts ?? []) { font in
                Text((font.label.isEmpty ? font.family : font.label) + (font.hasFile ? "" : " (bez pliku — nie do grafik)")).tag(String?.some(font.id))
            }
        }
        .frame(maxWidth: 330)
    }

    private func colorRow(_ title: String, selection: Binding<String?>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline)
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(brandbook?.colors ?? []) { color in
                        Button { selection.wrappedValue = color.id } label: {
                            HStack(spacing: 4) {
                                RoundedRectangle(cornerRadius: 3).fill(CrmTheme.hex(color.hex) ?? .gray).frame(width: 16, height: 16)
                                    .overlay(RoundedRectangle(cornerRadius: 3).stroke(Color.primary.opacity(0.3)))
                                Text(color.label.isEmpty ? color.hex : color.label).font(.caption)
                                if selection.wrappedValue == color.id { Image(systemName: "checkmark").font(.caption2) }
                            }
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(RoundedRectangle(cornerRadius: 6).stroke(selection.wrappedValue == color.id ? Color.accentColor : Color.primary.opacity(0.15)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func pick(_ template: SocialTemplate?) {
        templateID = template?.id
        name = template?.name ?? "Nowy szablon"
        isDefault = template?.isDefault ?? false
        logoID = template?.logoId
        titleFontID = template?.titleFontId
        captionFontID = template?.captionFontId
        overlayID = template?.overlayColorId
        accentID = template?.accentColorId
        textID = template?.textColorId
        defaultStyle = template?.graphicStyle ?? .classic
    }

    private func save() async {
        let value = { (id: String?) -> JSONValue in id.map(JSONValue.string) ?? .null }
        let body: [String: JSONValue] = [
            "id": value(templateID), "name": .string(name), "isDefault": .bool(isDefault), "logoId": value(logoID),
            "titleFontId": value(titleFontID), "captionFontId": value(captionFontID), "overlayColorId": value(overlayID),
            "accentColorId": value(accentID), "textColorId": value(textID), "defaultStyle": .string(defaultStyle.rawValue),
        ]
        guard let saved = await store.saveTemplate(body) else { return }
        templates = saved
        pick(saved.first { $0.id == templateID } ?? saved.first { $0.name == name })
    }
}

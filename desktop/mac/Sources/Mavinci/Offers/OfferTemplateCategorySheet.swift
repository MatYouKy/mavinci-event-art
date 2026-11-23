import SwiftUI
import UniformTypeIdentifiers
import CoreText

// MARK: Szablony ofert — kategoria (`CategoryModal`): nazwa, opis, kolor, zdjęcie hero (upuść albo wybierz, zmniejszane do
// 1800 px), opis zdjęcia, „Kreator wyglądu kategorii” z podglądem okładki, założeń, wyceny, strony „Informacje i warunki”
// i strony wymagań, kategoria domyślna. Kolory z księgi znaku marki wydarzenia, wycena weselna „Wasza wycena” (zadatek,
// warunki) i rozdziały z Prezentacji. Zapis `op=templateCategorySave`.

@MainActor struct OfferTemplateCategorySheet: View {
    @ObservedObject var store: OfferTemplatesStore
    let category: OfferTemplatesState.Category?
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var name: String
    @State private var description: String
    @State private var color: String
    @State private var isDefault: Bool
    @State private var heroAlt: String
    @State private var design: OfferTemplateDesign
    @State private var heroData: Data?
    @State private var heroImage: NSImage?
    @State private var removeHero = false
    @State private var importing = false
    @State private var dragActive = false
    @State private var problem: String?
    @State private var saving = false

    init(store: OfferTemplatesStore, category: OfferTemplatesState.Category?) {
        self.store = store
        self.category = category
        _name = State(initialValue: category?.name ?? "")
        _description = State(initialValue: category?.description ?? "")
        _color = State(initialValue: category?.color ?? "#d3bb73")
        _isDefault = State(initialValue: category?.isDefault ?? false)
        _heroAlt = State(initialValue: category?.heroAlt ?? "")
        _design = State(initialValue: category?.design ?? store.state?.defaults ?? OfferTemplateCategorySheet.fallback)
    }

    private var canEdit: Bool { store.state?.canEditCategories == true }
    private var hasHero: Bool { heroImage != nil || (!removeHero && category?.heroUrl != nil) }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(category == nil ? "Nowa kategoria" : "Edytuj kategorię").font(.title3.weight(.semibold))
                Spacer()
            }
            .padding(.horizontal, 20).padding(.vertical, 16)
            Divider()
            HStack(alignment: .top, spacing: 0) {
                ScrollView { form.padding(20) }
                    .frame(width: 560)
                Divider()
                ScrollView { previews.padding(20) }
                    .frame(maxWidth: .infinity)
                    .background(Color.primary.opacity(0.03))
            }
            Divider()
            HStack {
                if let problem { Text(problem).font(.callout).foregroundStyle(.red) }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                if canEdit {
                    Button(saving ? "Zapisywanie..." : category == nil ? "Utwórz kategorię" : "Zapisz zmiany") { Task { await save() } }
                        .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                        .disabled(saving || !state.canWrite)
                }
            }
            .padding(16)
        }
        .frame(minWidth: 1080, idealWidth: 1180, minHeight: 680, idealHeight: 860)
        .interactiveDismissDisabled(saving)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.jpeg, .png, .webP]) { result in
            if case .success(let url) = result { chooseHero(url) }
        }
    }

    // MARK: Formularz

    private var form: some View {
        VStack(alignment: .leading, spacing: 16) {
            ProductField(label: "Nazwa kategorii *") { TextField("", text: $name, prompt: Text("np. Wesela")).textFieldStyle(.roundedBorder) }
            ProductField(label: "Opis") { ProductTextArea(text: $description, prompt: "Opis kategorii...", lines: 2...4) }
            ProductField(label: "Kolor") { colorRow($color) }
            ProductField(label: "Zdjęcie hero kategorii") { heroDrop }
            ProductField(label: "Opis zdjęcia hero") {
                TextField("", text: $heroAlt, prompt: Text("Np. eleganckie przyjęcie weselne w sali balowej")).textFieldStyle(.roundedBorder)
            }
            designForm
            chaptersForm
            infoPageForm
            requirementsForm
            VStack(alignment: .leading, spacing: 2) {
                Toggle("Ustaw jako domyślną kategorię", isOn: $isDefault).toggleStyle(.checkbox)
                Text("Domyślna kategoria jest używana przy tworzeniu nowych ofert").font(.caption).foregroundStyle(.secondary).padding(.leading, 20)
            }
        }
        .disabled(!canEdit || saving)
    }

    private func colorRow(_ value: Binding<String>) -> some View {
        HStack(spacing: 8) {
            ColorPicker("", selection: Binding(get: { CrmTheme.hex(value.wrappedValue) ?? .gray }, set: { value.wrappedValue = CrmTheme.hexString($0) }),
                        supportsOpacity: false)
                .labelsHidden()
            TextField("", text: value, prompt: Text("#d3bb73")).textFieldStyle(.roundedBorder).frame(width: 110)
        }
    }

    private var heroDrop: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { importing = true } label: {
                ZStack {
                    if let heroImage {
                        Image(nsImage: heroImage).resizable().scaledToFill()
                    } else if !removeHero, let address = category?.heroUrl, let url = URL(string: address) {
                        AsyncImage(url: url) { phase in
                            if let image = phase.image { image.resizable().scaledToFill() } else { ProgressView() }
                        }
                    } else {
                        VStack(spacing: 6) {
                            Image(systemName: "photo").font(.largeTitle).foregroundStyle(theme.accent.opacity(0.6))
                            Text("Upuść zdjęcie lub kliknij, aby wybrać").font(.callout)
                            Text("JPG, PNG lub WEBP, maks. 12 MB").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    if dragActive {
                        VStack(spacing: 6) {
                            Image(systemName: "square.and.arrow.down").font(.largeTitle).foregroundStyle(theme.accent)
                            Text("Upuść zdjęcie tutaj").font(.headline)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.ultraThinMaterial)
                    }
                }
                .frame(height: 200).frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(dragActive ? theme.accent : theme.accent.opacity(0.3), style: StrokeStyle(lineWidth: 2, dash: [6])))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onDrop(of: [UTType.fileURL], isTargeted: $dragActive) { providers in
                guard let provider = providers.first else { return false }
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    Task { @MainActor in chooseHero(url) }
                }
                return true
            }
            if hasHero {
                Button("Usuń zdjęcie hero", role: .destructive) {
                    heroData = nil
                    heroImage = nil
                    removeHero = true
                }
                .buttonStyle(.link).font(.caption)
            }
        }
    }

    private var designForm: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Kreator wyglądu kategorii").font(.headline)
                Text("Te ustawienia sterują okładką, założeniami, dużą kartą produktu i wyceną.").font(.caption).foregroundStyle(.secondary)
            }
            Toggle(isOn: brandColors) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Kolory z księgi znaku marki wydarzenia")
                    Text("PDF bierze kolor główny, dodatkowy i akcent z księgi znaku marki realizującej wydarzenie (np. Event Rulers dla wesel). Kolory poniżej zostają dla ról, których marka nie ma, i dla podglądu.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.checkbox)
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 10) {
                GridRow {
                    ProductField(label: "Kolor główny") { colorRow($design.primary_color) }
                    ProductField(label: "Kolor dodatkowy") { colorRow($design.secondary_color) }
                }
                GridRow {
                    ProductField(label: "Kolor akcentu") { colorRow($design.accent_color) }
                    ProductField(label: "Tło jasnych stron") { colorRow($design.surface_color) }
                }
            }
            slider("Przyciemnienie zdjęcia: \(percent(design.hero_opacity))", value: $design.hero_opacity, range: 0.2...0.85, step: 0.05)
            Toggle("Gradient widoczności zdjęcia", isOn: $design.hero_gradient_enabled).toggleStyle(.checkbox)
            slider("Widoczność po prawej: \(percent(design.hero_gradient_end))", value: $design.hero_gradient_end, range: 0.2...0.8, step: 0.05)
                .disabled(!design.hero_gradient_enabled).opacity(design.hero_gradient_enabled ? 1 : 0.4)
            slider("Wielkość logo: \(percent(design.logo_scale))", value: $design.logo_scale, range: 0.7...1.5, step: 0.05)
            slider("Wysokość hero: \(Int(design.hero_height)) pt", value: $design.hero_height, range: 320...470, step: 5)
            slider("Wysokość dużego zdjęcia produktu: \(Int(design.visual_image_height)) pt", value: $design.visual_image_height, range: 220...330, step: 5)
            HStack(spacing: 14) {
                ProductField(label: "Strona założeń") {
                    Picker("", selection: $design.assumptions_layout) {
                        Text("Karty jak w projekcie").tag("cards")
                        Text("Prosty układ tekstowy").tag("simple")
                    }
                    .labelsHidden()
                }
                ProductField(label: "Karta podsumowania wyceny") {
                    Picker("", selection: $design.pricing_style) {
                        Text("Duża kolorowa karta").tag("card")
                        Text("Minimalna linia podsumowania").tag("minimal")
                        Text("Weselna — „Wasza wycena” z zadatkiem i warunkami").tag("wedding")
                    }
                    .labelsHidden()
                }
            }
            if design.pricing_style == "wedding" { weddingForm }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    /// Wycena weselna: zadatek (% kwoty do zapłaty, 0 — bez zadatku) i warunki pod wyceną.
    private var weddingForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Wycena weselna „Wasza wycena”").font(.callout.weight(.medium))
                Text("Zamiast tabeli: pozycje oferty z kwotami, rabat i VAT w podsumowaniu, razem do zapłaty, zadatek z pozostałą kwotą i warunki. Oferty z pakietami do wyboru i oferty sprzedawców zostają w zwykłym układzie.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            ProductField(label: "Zadatek (% kwoty do zapłaty)", help: "0 — bez zadatku na stronie wyceny.") {
                HStack(spacing: 6) {
                    TextField("", value: depositPercent, format: .number).textFieldStyle(.roundedBorder).frame(width: 70)
                    Text("%").foregroundStyle(.secondary)
                    Stepper("", value: depositPercent, in: 0...100, step: 5).labelsHidden()
                }
            }
            ProductField(label: "Warunki", help: "Każdy warunek w nowym wierszu (np. dojazd, nocleg zespołu). Zadatek ma własny wiersz w podsumowaniu.") {
                ProductTextArea(text: weddingTerms, lines: 3...8)
            }
        }
        .padding(.top, 4)
    }

    // MARK: Rozdziały z Prezentacji

    private var chapterIDs: [String] { design.chapter_item_ids ?? [] }
    private var chapterCards: [OfferTemplatesState.ChapterCard]? { store.state?.showcaseCards }
    private func chapterCard(_ id: String) -> OfferTemplatesState.ChapterCard? { chapterCards?.first { $0.id == id } }
    private var chapterSections: [String] {
        var seen = Set<String>()
        return (chapterCards ?? []).map(\.section).filter { seen.insert($0).inserted }
    }
    private static let chapterLimit = 12

    private func moveChapter(_ index: Int, by offset: Int) {
        var ids = chapterIDs
        let target = index + offset
        guard ids.indices.contains(index), ids.indices.contains(target) else { return }
        ids.swapAt(index, target)
        design.chapter_item_ids = ids
    }

    /// Wybrane karty trafiają do PDF po stronie „O nas”, przed produktami, w tej kolejności (`chapter_item_ids`).
    private var chaptersForm: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Label("Rozdziały z Prezentacji", systemImage: "book").font(.headline)
                Text("Wybrane karty (np. „Jak to robimy?”, „Zespół”) trafią do PDF po stronie „O nas”, przed produktami — w tej kolejności. Zmiana karty w Prezentacjach zmienia kolejne oferty. Na stronach: zdjęcie główne, tytuł, wstęp, tekst, punkty, zdjęcia, specyfikacja i pytania (bez bloków z katalogu produktów i realizacji). Wersja EN i oferty sprzedawców — bez rozdziałów.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(chapterIDs.enumerated()), id: \.element) { index, id in
                HStack(spacing: 8) {
                    Text("\(index + 1).").font(.caption).foregroundStyle(theme.accent).frame(width: 22, alignment: .leading)
                    VStack(alignment: .leading, spacing: 1) {
                        if let card = chapterCard(id) {
                            Text(card.title).lineLimit(1)
                            Text(card.active ? card.section : "\(card.section) · wyłączona — nie trafi do PDF")
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        } else {
                            Text(chapterCards == nil ? "Karta z Prezentacji" : "Karta usunięta z Prezentacji — nie trafi do PDF")
                                .foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Spacer()
                    Button { moveChapter(index, by: -1) } label: { Image(systemName: "arrow.up") }
                        .buttonStyle(.borderless).disabled(index == 0).help("Wyżej")
                    Button { moveChapter(index, by: 1) } label: { Image(systemName: "arrow.down") }
                        .buttonStyle(.borderless).disabled(index == chapterIDs.count - 1).help("Niżej")
                    Button { design.chapter_item_ids = chapterIDs.filter { $0 != id } } label: { Image(systemName: "xmark") }
                        .buttonStyle(.borderless).help("Usuń rozdział")
                }
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 6))
            }
            if let cards = chapterCards {
                Menu {
                    ForEach(chapterSections, id: \.self) { section in
                        Section(section) {
                            ForEach(cards.filter { $0.section == section && !chapterIDs.contains($0.id) }) { card in
                                Button(card.active ? card.title : "\(card.title) (wyłączona)") { design.chapter_item_ids = chapterIDs + [card.id] }
                            }
                        }
                    }
                } label: {
                    Label(chapterIDs.count >= Self.chapterLimit ? "Najwięcej \(Self.chapterLimit) rozdziałów" : cards.isEmpty ? "Brak kart w Prezentacjach" : "Dodaj kartę z Prezentacji",
                          systemImage: "plus")
                }
                .fixedSize()
                .disabled(cards.isEmpty || chapterIDs.count >= Self.chapterLimit)
            } else {
                Text("Wybór kart wymaga aktualizacji serwera CRM.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private var brandColors: Binding<Bool> {
        Binding(get: { design.brand_colors ?? false }, set: { design.brand_colors = $0 })
    }
    private var depositPercent: Binding<Double> {
        Binding(get: { design.deposit_percent ?? 30 }, set: { design.deposit_percent = min(100, max(0, $0.rounded())) })
    }
    private var weddingTerms: Binding<String> {
        Binding(get: { design.wedding_terms_text ?? "" }, set: { design.wedding_terms_text = $0 })
    }

    private var infoPageForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $design.info_page_enabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Dodaj stronę „Informacje i warunki”")
                    Text("Strona pojawi się po wycenie, przed kontaktem do sprzedawcy.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .toggleStyle(.checkbox)
            if design.info_page_enabled {
                ProductField(label: "Tytuł strony") { TextField("", text: $design.info_page_title).textFieldStyle(.roundedBorder) }
                ProductField(label: "Jak wygląda zamówienie", help: "Każdy krok wpisz w nowym wierszu.") {
                    ProductTextArea(text: $design.order_process_text, lines: 4...8)
                }
                ProductField(label: "Rezerwacja i zmiany", help: "Każdą zasadę wpisz w nowym wierszu.") {
                    ProductTextArea(text: $design.reservation_terms_text, lines: 4...8)
                }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private var requirementsForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle(isOn: $design.requirements_page_enabled) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Dodaj osobną stronę wymagań")
                    Text("Warunki ogólne oraz wymagania wszystkich produktów zostaną scalone bez duplikatów i opisane na kolejnych stronach PDF.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            .toggleStyle(.checkbox)
            if design.requirements_page_enabled {
                ProductField(label: "Tytuł strony wymagań") { TextField("", text: $design.requirements_page_title).textFieldStyle(.roundedBorder) }
                ProductField(label: "Wprowadzenie") { ProductTextArea(text: $design.requirements_page_subtitle, lines: 2...4) }
                ProductField(label: "Wymagania bazowe szablonu głównego / kategorii",
                             help: "Każdy warunek wpisz w nowym wierszu. Oferta połączy tę bazę z wymaganiami wybranych produktów, usunie powtórzenia i wybierze mocniejszy wariant warunku.") {
                    ProductTextArea(text: $design.technical_requirements_text, lines: 6...10)
                }
            }
        }
        .padding(14)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
    }

    private func slider(_ label: String, value: Binding<Double>, range: ClosedRange<Double>, step: Double) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Slider(value: value, in: range, step: step)
        }
    }

    private func percent(_ value: Double) -> String { "\(Int((value * 100).rounded()))%" }

    // MARK: Podglądy

    private var previews: some View {
        VStack(alignment: .leading, spacing: 18) {
            previewTitle("Okładka")
            OfferCoverPreview(design: design, heroImage: heroImage, heroURL: removeHero ? nil : category?.heroUrl,
                              logoURL: store.state?.brand.logoUrl, heading: store.headingDescriptor)
                .frame(maxWidth: 430).frame(maxWidth: .infinity)
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    previewTitle("Podgląd strony założeń")
                    OfferAssumptionsPreview(design: design, heading: store.headingDescriptor)
                }
                VStack(alignment: .leading, spacing: 6) {
                    previewTitle("Podgląd wyceny")
                    if design.pricing_style == "wedding" {
                        OfferWeddingPricingPreview(design: design, heading: store.headingDescriptor)
                    } else {
                        OfferPricingPreview(design: design, heading: store.headingDescriptor)
                    }
                }
            }
            if design.info_page_enabled || design.requirements_page_enabled {
                HStack(alignment: .top, spacing: 16) {
                    if design.info_page_enabled {
                        VStack(alignment: .leading, spacing: 6) {
                            previewTitle("Informacje i warunki")
                            OfferInfoPagePreview(design: design, heading: store.headingDescriptor)
                        }
                    }
                    if design.requirements_page_enabled {
                        VStack(alignment: .leading, spacing: 6) {
                            previewTitle("Strona wymagań")
                            OfferRequirementsPreview(design: design, heading: store.headingDescriptor)
                        }
                    }
                }
            }
        }
    }

    private func previewTitle(_ text: String) -> some View {
        Text(text.uppercased()).font(.caption2).foregroundStyle(.secondary)
    }

    // MARK: Czynności

    private func chooseHero(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let type = UTType(filenameExtension: url.pathExtension)
        let allowed = [UTType.jpeg, .png, .webP].contains { type?.conforms(to: $0) == true }
        let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        guard allowed, size > 0 else { problem = "Wybierz zdjęcie JPG, PNG lub WEBP"; return }
        guard size <= 12 * 1024 * 1024 else { problem = "Zdjęcie może mieć maksymalnie 12 MB"; return }
        guard let encoded = ProductImageEncoder.encode(url) else { problem = "Nie udało się przygotować zdjęcia."; return }
        heroData = encoded.data
        heroImage = encoded.image
        removeHero = false
        problem = nil
    }

    private func save() async {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { problem = "Podaj nazwę kategorii"; return }
        saving = true
        defer { saving = false }
        var body: [String: JSONValue] = [
            "op": .string("templateCategorySave"), "name": .string(name), "description": .string(description), "color": .string(color),
            "isDefault": .bool(isDefault), "heroAlt": .string(heroAlt), "design": design.json,
        ]
        if let category { body["id"] = .string(category.id) }
        if let heroData {
            body["hero"] = .object(["data": .string(heroData.base64EncodedString())])
        } else if removeHero {
            body["hero"] = .object(["remove": .bool(true)])
        }
        if await store.perform(body, pending: "Zapisywanie...") != nil { dismiss() }
    }

    static let fallback = OfferTemplateDesign(
        primary_color: "#5b001f", secondary_color: "#1c1f33", accent_color: "#d3bb73", surface_color: "#faf7f2",
        hero_opacity: 0.58, hero_gradient_enabled: true, hero_gradient_end: 0.45, hero_height: 395, logo_scale: 1,
        assumptions_layout: "cards", visual_image_height: 285, pricing_style: "card", info_page_enabled: true,
        info_page_title: "INFORMACJE I WARUNKI", order_process_text: "", requirements_page_enabled: true,
        requirements_page_title: "WARUNKI TECHNICZNE I ORGANIZACYJNE", requirements_page_subtitle: "", technical_requirements_text: "",
        reservation_terms_text: "", brand_colors: false, deposit_percent: 30,
        wedding_terms_text: "Ubezpieczenie OC\nDojazd: 50 km gratis, dalej 1 zł/km\nPokój dla zespołu", chapter_item_ids: [])
}

// MARK: Podglądy stron (proporcje A4, jak w oknie kategorii CRM)

/// Krój nagłówków z brandbooka w podglądach (bez niego — systemowy, lekki).
enum OfferPreviewFonts {
    static func heading(_ descriptor: CTFontDescriptor?, _ size: CGFloat) -> Font {
        guard let descriptor else { return .system(size: size, weight: .light) }
        return Font(CTFontCreateWithFontDescriptor(descriptor, size, nil))
    }
}

/// Strona A4 z wymiarami w punktach podglądu CRM (`base` — szerokość podglądu w CRM, do skalowania czcionek).
private struct PreviewPage<Content: View>: View {
    let base: CGFloat
    let background: Color
    @ViewBuilder let content: (CGFloat, CGSize) -> Content

    var body: some View {
        GeometryReader { geometry in
            content(geometry.size.width / base, geometry.size)
                .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
        }
        .aspectRatio(1 / 1.414, contentMode: .fit)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 4)
    }
}

struct OfferCoverPreview: View {
    let design: OfferTemplateDesign
    let heroImage: NSImage?
    let heroURL: String?
    let logoURL: String?
    let heading: CTFontDescriptor?

    private var heroHeight: CGFloat { CGFloat(min(470, max(320, design.hero_height))) }

    var body: some View {
        PreviewPage(base: 430, background: design.primary) { scale, size in
            let top = (841.89 - 210 - heroHeight) / 841.89 * size.height
            let height = heroHeight / 841.89 * size.height
            ZStack(alignment: .topLeading) {
                hero.frame(width: size.width, height: height).clipped().offset(y: top)
                overlay.frame(width: size.width, height: height).offset(y: top)
                logo(size).offset(x: size.width * 0.07, y: size.height * 0.05)
                Text("OFERTA OBSŁUGI TECHNICZNEJ").font(.system(size: 9 * scale)).tracking(1 * scale).foregroundStyle(design.accent)
                    .offset(x: size.width * 0.07, y: size.height * 0.28)
                Text("NAZWA\nWYDARZENIA").font(OfferPreviewFonts.heading(heading, 24 * scale)).foregroundStyle(.white).lineSpacing(0)
                    .frame(maxWidth: size.width * 0.78, alignment: .leading)
                    .offset(x: size.width * 0.07, y: size.height * 0.34)
                Rectangle().fill(design.accent).frame(width: size.width * 0.82, height: 1).offset(x: size.width * 0.07, y: size.height * 0.47)
                Text("TERMIN I MIEJSCE").font(.system(size: 8 * scale)).foregroundStyle(design.accent).offset(x: size.width * 0.07, y: size.height * 0.51)
                Text("24.10.2026 · 10:00–18:00").font(.system(size: 12 * scale)).foregroundStyle(.white).offset(x: size.width * 0.07, y: size.height * 0.55)
                Text("Lokalizacja z CRM").font(.system(size: 10 * scale)).foregroundStyle(.white).offset(x: size.width * 0.07, y: size.height * 0.59)
                Text("OFERTA PRZYGOTOWANA NA PODSTAWIE ZAPYTANIA").font(.system(size: 8 * scale)).foregroundStyle(.white.opacity(0.7))
                    .offset(x: size.width * 0.07, y: size.height * 0.92)
                Text("01").font(.system(size: 8 * scale)).foregroundStyle(design.accent)
                    .frame(width: size.width * 0.93, alignment: .trailing).offset(y: size.height * 0.92)
            }
        }
    }

    @ViewBuilder private var hero: some View {
        if let heroImage {
            Image(nsImage: heroImage).resizable().scaledToFill()
        } else if let heroURL, let url = URL(string: heroURL) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { Color.clear }
            }
        } else {
            Color.clear
        }
    }

    @ViewBuilder private var overlay: some View {
        if design.hero_gradient_enabled {
            LinearGradient(colors: [design.primary, design.primary.opacity(1 - design.hero_gradient_end)], startPoint: .leading, endPoint: .trailing)
        } else {
            design.primary.opacity(design.hero_opacity)
        }
    }

    @ViewBuilder private func logo(_ size: CGSize) -> some View {
        if let logoURL, let url = URL(string: logoURL) {
            AsyncImage(url: url) { phase in
                if let image = phase.image { image.resizable().scaledToFit() } else { Color.clear }
            }
            .frame(width: size.width * 0.24, height: size.height * 0.15, alignment: .topLeading)
            .scaleEffect(design.logo_scale, anchor: .topLeading)
        } else {
            Text("MAVINCI").font(.system(size: 14 * size.width / 430, weight: .semibold)).tracking(4).foregroundStyle(.white)
        }
    }
}

struct OfferAssumptionsPreview: View {
    let design: OfferTemplateDesign
    let heading: CTFontDescriptor?

    var body: some View {
        PreviewPage(base: 250, background: design.surface) { scale, _ in
            VStack(alignment: .leading, spacing: 8 * scale) {
                Text("ZAŁOŻENIA SPOTKANIA").font(OfferPreviewFonts.heading(heading, 18 * scale)).foregroundStyle(design.primary)
                Rectangle().fill(design.primary).frame(height: 1)
                ForEach(Self.rows, id: \.self) { row in
                    let parts = row.components(separatedBy: "|")
                    HStack(spacing: 8 * scale) {
                        Text(parts[0]).font(OfferPreviewFonts.heading(heading, 9 * scale)).foregroundStyle(.white)
                            .frame(width: 26 * scale, height: 26 * scale)
                            .background(design.primary, in: RoundedRectangle(cornerRadius: 5 * scale))
                        VStack(alignment: .leading, spacing: 2 * scale) {
                            Text(parts[1]).font(OfferPreviewFonts.heading(heading, 8 * scale)).foregroundStyle(design.primary)
                            Text(parts[2]).font(.system(size: 6 * scale)).foregroundStyle(.black.opacity(0.7))
                        }
                    }
                    .padding(8 * scale).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white, in: RoundedRectangle(cornerRadius: 5 * scale))
                }
                Text("CEL REALIZACJI").font(.system(size: 8 * scale)).foregroundStyle(design.primary).padding(.top, 6 * scale)
                RoundedRectangle(cornerRadius: 3 * scale).fill(.black.opacity(0.05)).frame(height: 20 * scale)
                Text("REKOMENDOWANY ZESTAW").font(.system(size: 8 * scale)).foregroundStyle(.white)
                    .padding(10 * scale).frame(maxWidth: .infinity, alignment: .leading)
                    .background(design.primary, in: RoundedRectangle(cornerRadius: 5 * scale))
            }
            .padding(14 * scale)
        }
    }

    static let rows = [
        "180|LICZBA GOŚCI|Wartość może zostać wpisana i wyeksponowana w znaczniku.",
        "02|PRZEBIEG I POTRZEBY KLIENTA|Przy pustej wartości znacznik zachowuje numer sekcji.",
        "6 H|CZAS REALIZACJI|Krótka wartość może zawierać również jednostkę.",
    ]
}

struct OfferPricingPreview: View {
    let design: OfferTemplateDesign
    let heading: CTFontDescriptor?

    var body: some View {
        PreviewPage(base: 250, background: design.surface) { scale, _ in
            VStack(alignment: .leading, spacing: 8 * scale) {
                Text("WYCENA").font(OfferPreviewFonts.heading(heading, 18 * scale)).foregroundStyle(design.primary)
                Rectangle().fill(design.primary).frame(height: 1)
                VStack(spacing: 0) {
                    row("NAZWA POZYCJI", "WARTOŚĆ", scale).foregroundStyle(.white).background(design.primary)
                    row("Usługa techniczna", "5 000 PLN", scale).background(.white)
                    row("Streaming", "2 500 PLN", scale).background(Color(white: 0.97))
                }
                .clipShape(RoundedRectangle(cornerRadius: 2 * scale))
                Spacer()
                summary(scale)
            }
            .padding(14 * scale)
        }
    }

    private func row(_ name: String, _ value: String, _ scale: CGFloat) -> some View {
        HStack { Text(name); Spacer(); Text(value) }
            .font(.system(size: 7 * scale)).padding(.horizontal, 7 * scale).padding(.vertical, 7 * scale)
    }

    @ViewBuilder private func summary(_ scale: CGFloat) -> some View {
        let minimal = design.pricing_style == "minimal"
        VStack(alignment: .leading, spacing: 6 * scale) {
            Text("ŁĄCZNA WARTOŚĆ OFERTY").font(.system(size: 7 * scale))
            Text("7 500 PLN").font(.system(size: 16 * scale))
        }
        .foregroundStyle(minimal ? design.primary : Color.white)
        .padding(12 * scale).frame(maxWidth: .infinity, alignment: .leading)
        .background(minimal ? Color.clear : design.primary, in: RoundedRectangle(cornerRadius: 5 * scale))
        .overlay(alignment: .top) { if minimal { Rectangle().fill(design.primary).frame(height: 1) } }
        .padding(.bottom, 30 * scale)
    }
}

/// Strona „WASZA WYCENA” (styl weselny) — układ jak w PDF (`src/lib/offer-pdf/weddingPricing.ts`), przykładowe kwoty.
struct OfferWeddingPricingPreview: View {
    let design: OfferTemplateDesign
    let heading: CTFontDescriptor?

    private static let total: Double = 12400
    private static let rows: [(String, Double)] = [("Pakiet z prowadzeniem", 10800), ("Fontanny iskier — 4 szt.", 800), ("Ciężki dym", 800)]
    private var percent: Double { min(100, max(0, (design.deposit_percent ?? 30).rounded())) }
    private var deposit: Double { (Self.total * percent).rounded() / 100 }
    private var terms: [String] {
        Array((design.wedding_terms_text ?? "").components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(5))
    }

    var body: some View {
        PreviewPage(base: 250, background: design.surface) { scale, _ in
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 3 * scale) {
                    Text("OFERTA NR 17/2026").font(.system(size: 5 * scale)).foregroundStyle(design.accent)
                    Text("WASZA WYCENA").font(OfferPreviewFonts.heading(heading, 16 * scale)).foregroundStyle(design.accent)
                    Text("Wesele · 12.06.2027 · Miejsce przyjęcia").font(.system(size: 6 * scale)).foregroundStyle(design.surface)
                }
                .padding(.horizontal, 14 * scale).padding(.top, 14 * scale).padding(.bottom, 10 * scale)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(design.primary)
                .overlay(alignment: .bottom) { Rectangle().fill(design.accent).frame(height: 2 * scale) }
                VStack(alignment: .leading, spacing: 5 * scale) {
                    Text("Ceny według cennika na sezon 2027").font(.system(size: 5 * scale)).foregroundStyle(.black.opacity(0.45))
                    ForEach(Array(Self.rows.enumerated()), id: \.offset) { _, row in
                        HStack { Text(row.0); Spacer(); Text(Self.money(row.1)) }
                            .font(.system(size: 6.5 * scale, weight: .semibold)).foregroundStyle(design.primary)
                            .padding(.bottom, 3 * scale)
                            .overlay(alignment: .bottom) { Rectangle().fill(design.accent.opacity(0.6)).frame(height: 0.5) }
                    }
                    HStack {
                        Text("RAZEM").font(OfferPreviewFonts.heading(heading, 7 * scale)).foregroundStyle(design.surface)
                        Spacer()
                        Text(Self.money(Self.total)).font(.system(size: 10 * scale, weight: .semibold)).foregroundStyle(design.accent)
                    }
                    .padding(7 * scale)
                    .background(design.primary, in: RoundedRectangle(cornerRadius: 2 * scale))
                    if percent > 0 {
                        VStack(spacing: 2 * scale) {
                            HStack { Text("Zadatek \(Int(percent))% przy podpisaniu umowy"); Spacer(); Text(Self.money(deposit)) }
                                .font(.system(size: 6 * scale, weight: .semibold)).foregroundStyle(design.primary)
                            HStack { Text("Pozostało do zapłaty"); Spacer(); Text(Self.money(Self.total - deposit)) }
                                .font(.system(size: 5.5 * scale)).foregroundStyle(.black.opacity(0.55))
                        }
                        .padding(6 * scale)
                        .background(.white)
                        .overlay(Rectangle().stroke(design.accent, lineWidth: 0.8))
                    }
                    if !terms.isEmpty {
                        Text("WARUNKI").font(OfferPreviewFonts.heading(heading, 9 * scale)).foregroundStyle(design.primary).padding(.top, 3 * scale)
                        Rectangle().fill(design.accent).frame(width: 18 * scale, height: 1)
                        ForEach(Array(terms.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .firstTextBaseline, spacing: 4 * scale) {
                                Text("◆").foregroundStyle(design.accent)
                                Text(line).foregroundStyle(.black.opacity(0.65)).lineLimit(2)
                            }
                            .font(.system(size: 5.5 * scale))
                        }
                    }
                }
                .padding(14 * scale)
            }
        }
    }

    /// Kwota jak w PDF: grupy tysięcy zawsze (także 4 cyfry), grosze tylko przy niepełnej kwocie.
    private static func money(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.groupingSeparator = " "
        formatter.groupingSize = 3
        formatter.decimalSeparator = ","
        let fractional = (value * 100).rounded() != (value.rounded() * 100)
        formatter.minimumFractionDigits = fractional ? 2 : 0
        formatter.maximumFractionDigits = fractional ? 2 : 0
        return "\(formatter.string(from: NSNumber(value: value)) ?? String(value)) zł"
    }
}

struct OfferInfoPagePreview: View {
    let design: OfferTemplateDesign
    let heading: CTFontDescriptor?

    var body: some View {
        PreviewPage(base: 250, background: design.surface) { scale, _ in
            VStack(alignment: .leading, spacing: 6 * scale) {
                Text(design.info_page_title.isEmpty ? "INFORMACJE I WARUNKI" : design.info_page_title)
                    .font(OfferPreviewFonts.heading(heading, 16 * scale)).foregroundStyle(design.primary).lineLimit(2)
                Rectangle().fill(design.primary).frame(height: 1)
                ForEach(Array(cards.enumerated()), id: \.offset) { index, card in
                    HStack(alignment: .top, spacing: 6 * scale) {
                        Text(String(format: "%02d", index + 1)).font(.system(size: 11 * scale)).foregroundStyle(design.accent)
                        VStack(alignment: .leading, spacing: 2 * scale) {
                            Text(card.0).font(.system(size: 7 * scale, weight: .medium)).foregroundStyle(design.primary)
                            Text(card.1).font(.system(size: 6 * scale)).foregroundStyle(.black.opacity(0.55)).lineLimit(3)
                        }
                    }
                    .padding(6 * scale).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white, in: RoundedRectangle(cornerRadius: 5 * scale))
                }
            }
            .padding(14 * scale)
        }
    }

    private var cards: [(String, String)] {
        [("JAK WYGLĄDA ZAMÓWIENIE", design.order_process_text), ("REZERWACJA I ZMIANY", design.reservation_terms_text),
         ("TERMIN I MIEJSCE", "Data i lokalizacja wydarzenia"), ("ZAKRES I WYCENA", "Źródło wyceny oraz wartość oferty"),
         ("KONTAKT I KOORDYNACJA", "Osoba kontaktowa i ustalenia organizacyjne")]
    }
}

struct OfferRequirementsPreview: View {
    let design: OfferTemplateDesign
    let heading: CTFontDescriptor?

    var body: some View {
        PreviewPage(base: 250, background: design.surface) { scale, _ in
            VStack(alignment: .leading, spacing: 6 * scale) {
                Text(design.requirements_page_title.isEmpty ? "WARUNKI TECHNICZNE I ORGANIZACYJNE" : design.requirements_page_title)
                    .font(OfferPreviewFonts.heading(heading, 14 * scale)).foregroundStyle(design.primary).lineLimit(2)
                Text(design.requirements_page_subtitle).font(.system(size: 6 * scale)).foregroundStyle(.black.opacity(0.45))
                Rectangle().fill(design.primary).frame(height: 1)
                ForEach(Array(Self.cards.enumerated()), id: \.offset) { index, card in
                    HStack(alignment: .top, spacing: 6 * scale) {
                        Text(String(format: "%02d", index + 1)).font(.system(size: 7 * scale)).foregroundStyle(design.accent)
                        VStack(alignment: .leading, spacing: 2 * scale) {
                            Text(card.0).font(.system(size: 7 * scale, weight: .medium)).foregroundStyle(design.primary)
                            Text(card.1).font(.system(size: 6 * scale)).foregroundStyle(.black.opacity(0.55))
                        }
                    }
                    .padding(7 * scale).frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white, in: RoundedRectangle(cornerRadius: 5 * scale))
                }
            }
            .padding(14 * scale)
        }
    }

    static let cards: [(String, String)] = [
        ("DOSTĘP DO OBIEKTU", "Warunek opisany pełnym zdaniem wraz z kontekstem realizacji."),
        ("DJ EVENTOWY", "Wymaganie pochodzące z wybranego produktu i widoczne tylko wtedy, gdy produkt znajduje się w ofercie."),
        ("POKÓJ DWUOSOBOWY", "Inne wymaganie organizacyjne dodane w katalogu produktu."),
    ]
}

import SwiftUI
import AppKit
import CoreText

// MARK: Strefa sprzedawcy → „Prezentacje” → podgląd jak na iPadzie (poziomo: iPad Pro 13″ albo iPad Air 11″) — natywnie, ten sam
// układ co podgląd w CRM i tryb prezentacji na iPadzie (etap 2): działy → karty → karta (zdjęcie główne, wstęp, bloki z nawigacją),
// galeria na pełnym ekranie, ceny ukryte z przełącznikiem. Marka z księgi znaku (logo, sygnet, kolory, fonty — font nagłówków
// z pliku księgi znaku rejestrowany w aplikacji). Puste i ukryte bloki, ukryte działy i karty nie pokazują się (kartę otwartą
// z edytora widać także przed zapisem i gdy jest ukryta). „Do oferty” przy wariantach, pakietach i w nagłówku karty oraz „Oferta”
// w pasku — oferta ze spotkania w panelu obok pokazu (`ShowcaseOffer.swift`).

/// Fonty z księgi znaku: plik pobrany do pamięci podręcznej i zarejestrowany w aplikacji → nazwa rodziny do `Font.custom`.
@MainActor enum ShowcaseFonts {
    private static var families: [String: String] = [:]

    static func family(for font: ShowcaseFont?) async -> String? {
        guard let font else { return nil }
        guard let link = font.url, let remote = URL(string: link) else {
            // Bez pliku — rodzina zainstalowana w systemie (pierwsza nazwa z listy).
            let first = font.family.split(separator: ",").first.map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: " '\"")) } ?? ""
            return NSFont(name: first, size: 12) != nil || NSFontManager.shared.availableFontFamilies.contains(first) ? first : nil
        }
        if let known = families[link] { return known }
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/fonts", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let ext = remote.pathExtension.isEmpty ? "otf" : remote.pathExtension
        let file = folder.appendingPathComponent(digest(link)).appendingPathExtension(ext)
        if !FileManager.default.fileExists(atPath: file.path) {
            guard let (data, response) = try? await URLSession.shared.data(from: remote),
                  ((response as? HTTPURLResponse)?.statusCode ?? 0) == 200, !data.isEmpty else { return nil }
            try? data.write(to: file, options: .atomic)
        }
        guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(file as CFURL) as? [CTFontDescriptor], let first = descriptors.first,
              let name = CTFontDescriptorCopyAttribute(first, kCTFontFamilyNameAttribute) as? String else { return nil }
        var error: Unmanaged<CFError>?
        if !CTFontManagerRegisterFontsForURL(file as CFURL, .process, &error) {
            // Już zarejestrowany (ponowne otwarcie podglądu) — nazwa rodziny nadal działa.
            error?.release()
        }
        families[link] = name
        return name
    }
}

/// Nagłówki pokazu z fontu księgi znaku: font nagłówków w pogrubieniu ucina części znaków, a jego „0” wygląda jak „O” — dlatego
/// nagłówki są wersalikami (czytelne), wyłącznie krojem regularnym, a cyfry fontem treści. 1:1 z CRM (`ShowcasePresenter`) i telefonem.
enum ShowcaseHeadingText {
    static func attributed(_ text: String, heading: Font, digits: Font) -> AttributedString {
        let upper = text.uppercased(with: Locale(identifier: "pl_PL"))
        var result = AttributedString()
        var run = ""
        var runDigits = false
        func flush() {
            guard !run.isEmpty else { return }
            var part = AttributedString(run)
            part[AttributeScopes.SwiftUIAttributes.FontAttribute.self] = runDigits ? digits : heading
            result.append(part)
            run = ""
        }
        for character in upper {
            let digit = character.isASCII && character.isNumber
            if !run.isEmpty && digit != runDigits { flush() }
            runDigits = digit
            run.append(character)
        }
        flush()
        return result
    }
}

private enum ShowcaseScreen: Equatable {
    case home
    case section(String)
    case item(String, String?)
}

private struct ShowcaseNeighbours {
    var prev: ShowcaseItemSummary?
    var next: ShowcaseItemSummary?
    var index: Int
    var count: Int
    var sectionTitle: String
}

/// Komunikat w pokazie (pasek komunikatów głównego okna jest pod arkuszem podglądu).
private struct ShowcaseToast: Equatable {
    let id = UUID()
    var text: String
    var error: Bool
    var openOffer: Bool
}

private struct ShowcaseLightbox: Equatable {
    var photos: [ShowcaseMedia]
    var index: Int
    var urls: [String: ShowcaseURLPair]
}

@MainActor struct ShowcasePreviewSheet: View {
    @ObservedObject var store: ShowcaseStore
    @ObservedObject private var offer: ShowcaseOfferStore
    let request: ShowcasePreviewRequest
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var device: ShowcaseDevice
    @State private var screen: ShowcaseScreen
    @State private var showPrices = false
    @State private var lightbox: ShowcaseLightbox?
    @State private var details: [String: ShowcaseDetail] = [:]
    @State private var problem: String?
    @State private var headingFamily: String?
    @State private var bodyFamily: String?
    @State private var openQuestion: String?
    @State private var offerOpen = false
    @State private var toast: ShowcaseToast?
    @State private var pdfFile: OfferPdfPreview?
    @FocusState private var keysFocused: Bool

    init(store: ShowcaseStore, request: ShowcasePreviewRequest) {
        _store = ObservedObject(wrappedValue: store)
        _offer = ObservedObject(wrappedValue: store.offer)
        self.request = request
        _device = State(initialValue: ShowcaseDevice(rawValue: UserDefaults.standard.string(forKey: "showcaseDevice") ?? "") ?? .ipad13)
        if let itemID = request.itemID {
            _screen = State(initialValue: .item(itemID, request.sectionID))
        } else if let sectionID = request.sectionID {
            _screen = State(initialValue: .section(sectionID))
        } else {
            _screen = State(initialValue: .home)
        }
    }

    private var brand: ShowcaseBrand {
        store.home?.brand ?? ShowcaseBrand(name: "Mavinci", logoUrl: nil, sygnetUrl: nil, accent: "#d3bb73", surface: "#1c1f33", headingFont: nil, bodyFont: nil)
    }
    // Pokaz w kolorach motywu CRM pracownika (Burgund, Granat, Ciemny, Jasny) — jak podgląd w CRM i tablet: tło — powierzchnia
    // motywu, akcent — z księgi znaku (w jasnym motywie — akcent motywu), tekst i przyciemnienia odwrócone w jasnym motywie.
    private var accent: Color { theme == .light ? theme.accent : ShowcaseShared.color(brand.accent, fallback: theme.accent) }
    private var surface: Color { theme.card }
    /// Tekst pokazu: w ciemnych motywach — biały, w jasnym — tekst motywu.
    private var ink: Color { theme == .light ? theme.text : .white }
    /// Przyciemnienie (kafle, gradienty na zdjęciach): w ciemnych motywach — czarne, w jasnym — białe (jak odwrócony CRM).
    private var scrim: Color { theme == .light ? .white : .black }
    private var sheetSize: CGSize {
        let frame = NSScreen.main?.visibleFrame.size ?? CGSize(width: 1440, height: 900)
        return CGSize(width: min(1480, frame.width - 60), height: min(1000, frame.height - 60))
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Text("Podgląd jak na iPadzie (poziomo) — tak zobaczy to klient na spotkaniu. Strzałki ← → — sąsiedni dział, karta, zdjęcie (na iPadzie: przesunięcie palcem w bok).")
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
                Spacer()
                Picker("Urządzenie", selection: $device) {
                    ForEach(ShowcaseDevice.allCases) { item in Text(item.label).tag(item) }
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 260)
                Button("Zamknij") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            .padding(12)
            HStack(spacing: 0) {
                GeometryReader { geometry in
                    let size = device.size
                    let scale = max(0.2, min(1, (geometry.size.width - 32) / (size.width + 28), (geometry.size.height - 32) / (size.height + 28)))
                    deviceFrame(size)
                        .frame(width: size.width + 28, height: size.height + 28)
                        .scaleEffect(scale)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                }
                .clipped()
                if offerOpen {
                    // Oferta ze spotkania obok pokazu (natywne pola — poza ramką iPada, bez skalowania).
                    ShowcaseOfferPanel(offer: offer, accent: accent,
                                       notify: { text, error in toast = ShowcaseToast(text: text, error: error, openOffer: false) },
                                       close: { offerOpen = false },
                                       openRecord: { module, id in
                                           dismiss()
                                           state.open(module, id: id)
                                       },
                                       pdfFile: $pdfFile)
                        .frame(width: 440)
                        .transition(.move(edge: .trailing))
                }
            }
            .animation(.easeOut(duration: 0.22), value: offerOpen)
        }
        .frame(width: sheetSize.width, height: sheetSize.height)
        .background(Color.black.opacity(0.92))
        // Strzałki ← →: sąsiedni dział / karta w dziale / zdjęcie w galerii — to samo, co przesunięcie palcem w bok na iPadzie.
        .focusable()
        .focused($keysFocused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow]) { press in
            let direction = press.key == .rightArrow ? 1 : -1
            if lightbox != nil { step(direction) } else { move(direction) }
            return .handled
        }
        .onAppear { keysFocused = true }
        .onChange(of: device) { _, value in UserDefaults.standard.set(value.rawValue, forKey: "showcaseDevice") }
        .task {
            headingFamily = await ShowcaseFonts.family(for: brand.headingFont)
            bodyFamily = await ShowcaseFonts.family(for: brand.bodyFont)
        }
        .task(id: currentItemID) { await loadItem() }
        .task { await offer.loadSetup() }
        .task(id: toast?.id) {
            guard let current = toast else { return }
            try? await Task.sleep(for: .seconds(current.error ? 7 : 3.5))
            if toast?.id == current.id { withAnimation { toast = nil } }
        }
        .sheet(item: $pdfFile) { file in OfferPdfViewer(file: file).environmentObject(state) }
    }

    // MARK: Ramka i ekran
    private func deviceFrame(_ size: CGSize) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 44).fill(Color(white: 0.04))
                .overlay(RoundedRectangle(cornerRadius: 44).stroke(Color.white.opacity(0.1)))
            ZStack(alignment: .top) {
                surface
                screenContent(size)
                topBar
                if let lightbox { lightboxView(lightbox) }
                if let toast { toastView(toast).frame(maxHeight: .infinity, alignment: .bottom) }
            }
            .frame(width: size.width, height: size.height)
            .clipShape(RoundedRectangle(cornerRadius: 30))
            .environment(\.colorScheme, theme.scheme)
        }
    }

    @ViewBuilder private func screenContent(_ size: CGSize) -> some View {
        switch screen {
        case .home: homeScreen
        case .section(let id): sectionScreen(id)
        case .item(let id, _):
            if let detail = current(id) {
                itemScreen(detail, size: size)
            } else {
                Text(problem ?? "Wczytuję kartę…").font(.system(size: 18)).foregroundStyle(.white.opacity(0.5))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            if screen != .home {
                Button { back() } label: {
                    Label("Wróć", systemImage: "chevron.left").font(.system(size: 16)).foregroundStyle(accent)
                        .padding(.horizontal, 14).frame(height: 44).background(Capsule().fill(scrim.opacity(0.3)))
                }
                .buttonStyle(.plain)
            } else if let sygnet = brand.sygnetUrl {
                SocialImageView(url: sygnet, contentMode: .fit).frame(width: 32, height: 32)
            }
            if let section = crumbSection {
                // Okruszek: nazwa działu przenosi do działu (jak w CRM).
                Button { screen = .section(section.id) } label: {
                    Text(section.title).font(.system(size: 15)).foregroundStyle(ink.opacity(0.7)).lineLimit(1)
                        .padding(.horizontal, 8).frame(height: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).help("Przejdź do działu")
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(ink.opacity(0.35))
            }
            Text(crumb).font(.system(size: 15)).foregroundStyle(ink.opacity(0.7)).lineLimit(1)
            Spacer()
            if offer.canOffer {
                Button { offerOpen.toggle(); if toast?.openOffer == true { toast = nil } } label: {
                    Label(offer.count > 0 ? "Oferta · \(offer.count)" : "Oferta", systemImage: "list.clipboard")
                        .font(.system(size: 15))
                        .foregroundStyle(offer.count > 0 ? surface : accent)
                        .padding(.horizontal, 16).frame(height: 44)
                        .background(Capsule().fill(offer.count > 0 ? accent : Color.clear))
                        .overlay(Capsule().stroke(accent.opacity(0.5)))
                }
                .buttonStyle(.plain)
                .help("Oferta dla klienta ze spotkania")
            }
            Button { showPrices.toggle() } label: {
                Label(showPrices ? "Ceny widoczne" : "Ceny", systemImage: showPrices ? "eye" : "eye.slash")
                    .font(.system(size: 15))
                    .foregroundStyle(showPrices ? surface : accent)
                    .padding(.horizontal, 16).frame(height: 44)
                    .background(Capsule().fill(showPrices ? accent : Color.clear))
                    .overlay(Capsule().stroke(accent.opacity(0.5)))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 24)
        .frame(height: 64)
        .background {
            // Jak w CRM: na karcie pasek pełny (treść nie prześwituje), na stronie startowej i w dziale — przejście w tło.
            if onItemScreen {
                surface
            } else {
                LinearGradient(stops: [.init(color: surface, location: 0), .init(color: surface.opacity(0.9), location: 0.7), .init(color: surface.opacity(0), location: 1)],
                               startPoint: .top, endPoint: .bottom)
            }
        }
    }

    private var onItemScreen: Bool {
        if case .item = screen { return true }
        return false
    }

    private var crumbSection: ShowcaseSection? {
        guard case .item(_, let sectionID) = screen, let sectionID else { return nil }
        return store.home?.sections.first { $0.id == sectionID }
    }

    /// Poprzedni / następny na tym samym poziomie: dział ↔ dział, karta ↔ karta w dziale (bez zawijania) — jak przesunięcie palcem na iPadzie.
    private func move(_ direction: Int) {
        switch screen {
        case .home:
            return
        case .section(let id):
            let list = visibleSections
            guard let index = list.firstIndex(where: { $0.id == id }), list.indices.contains(index + direction) else { return }
            withAnimation(.easeOut(duration: 0.24)) { screen = .section(list[index + direction].id) }
        case .item(let id, let sectionID):
            guard let sectionID else { return }
            let list = visibleItems(sectionID)
            guard let index = list.firstIndex(where: { $0.id == id }), list.indices.contains(index + direction) else { return }
            withAnimation(.easeOut(duration: 0.24)) { screen = .item(list[index + direction].id, sectionID) }
        }
    }

    private var crumb: String {
        switch screen {
        case .home: return brand.name
        case .section(let id): return store.home?.sections.first { $0.id == id }?.title ?? ""
        case .item(let id, _): return current(id)?.item.title ?? ""
        }
    }

    private func back() {
        switch screen {
        case .item(_, let sectionID): screen = sectionID.map { .section($0) } ?? .home
        default: screen = .home
        }
    }

    private func titleFont(_ size: CGFloat) -> Font { headingFamily.map { Font.custom($0, size: size) } ?? .system(size: size, weight: .regular) }
    private func textFont(_ size: CGFloat) -> Font { bodyFamily.map { Font.custom($0, size: size) } ?? .system(size: size) }
    /// Nagłówek pokazu — wersalikami, krojem regularnym, cyfry fontem treści (jak w CRM i na tablecie).
    private func heading(_ text: String, _ size: CGFloat) -> Text {
        Text(ShowcaseHeadingText.attributed(text, heading: titleFont(size), digits: textFont(size))).tracking(size * 0.02)
    }

    // MARK: Dane
    private var currentItemID: String? {
        if case .item(let id, _) = screen { return id }
        return nil
    }

    private func current(_ id: String) -> ShowcaseDetail? {
        if let draft = request.draft, draft.item.id == id { return draft }
        return details[id]
    }

    private func loadItem() async {
        guard let id = currentItemID, current(id) == nil else { return }
        problem = nil
        if let detail = await store.fetchDetail(id) { details[id] = detail } else { problem = "Nie udało się otworzyć karty." }
    }

    private var visibleSections: [ShowcaseSection] { store.sections.filter(\.isActive) }
    private func visibleItems(_ sectionID: String) -> [ShowcaseItemSummary] { store.items(in: sectionID).filter(\.isActive) }
    private var columns: Int { device.wide ? 3 : 2 }

    // MARK: Strona startowa i dział
    private var homeScreen: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                HStack(alignment: .bottom, spacing: 24) {
                    if let logo = brand.logoUrl { SocialImageView(url: logo, contentMode: .fit).frame(maxWidth: 220, maxHeight: 96) }
                    VStack(alignment: .leading, spacing: 6) {
                        heading("Co możemy dla Państwa przygotować", device.wide ? 44 : 36).foregroundStyle(ink)
                        Text("Wybierz dział, żeby zobaczyć, jak to wygląda.").font(textFont(18)).foregroundStyle(ink.opacity(0.6))
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: columns), spacing: 20) {
                    ForEach(visibleSections) { section in sectionTile(section) }
                }
                if visibleSections.isEmpty {
                    Text("Brak widocznych działów — dodaj dział i karty w edytorze.").font(textFont(18)).foregroundStyle(ink.opacity(0.5)).frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 40).padding(.top, 96).padding(.bottom, 48)
        }
    }

    private func sectionTile(_ section: ShowcaseSection) -> some View {
        let count = visibleItems(section.id).count
        let subtitle: String = section.subtitle.isEmpty ? "\(count) \(ShowcaseShared.plural(count, "pozycja", "pozycje", "pozycji"))" : section.subtitle
        return Button { screen = .section(section.id) } label: {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(colors: [accent.opacity(0.25), surface], startPoint: .topLeading, endPoint: .bottomTrailing)
                if let cover = section.cover, let thumb = store.url(cover.key)?.thumb {
                    SocialImageView(url: thumb).opacity(0.85)
                }
                LinearGradient(colors: [.clear, scrim.opacity(0.8)], startPoint: .top, endPoint: .bottom)
                VStack(alignment: .leading, spacing: 4) {
                    Image(systemName: ShowcaseIconInfo.symbol(section.icon)).font(.system(size: 22)).foregroundStyle(accent)
                        .frame(width: 48, height: 48).background(RoundedRectangle(cornerRadius: 14).fill(scrim.opacity(0.4)))
                    Spacer()
                    heading(section.title, 26).foregroundStyle(ink).lineLimit(2)
                    Text(subtitle).font(textFont(15)).foregroundStyle(ink.opacity(0.7)).lineLimit(2)
                }
                .padding(20)
            }
            .frame(height: device.wide ? 300 : 220)
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(ink.opacity(0.1)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sectionScreen(_ id: String) -> some View {
        let section = store.home?.sections.first { $0.id == id }
        let items = visibleItems(id)
        return ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let section {
                    HStack(spacing: 20) {
                        Image(systemName: ShowcaseIconInfo.symbol(section.icon)).font(.system(size: 30)).foregroundStyle(accent)
                            .frame(width: 64, height: 64).background(RoundedRectangle(cornerRadius: 16).fill(accent.opacity(0.14)))
                        VStack(alignment: .leading, spacing: 4) {
                            heading(section.title, 40).foregroundStyle(ink)
                            if !section.subtitle.isEmpty { Text(section.subtitle).font(textFont(18)).foregroundStyle(ink.opacity(0.6)) }
                        }
                    }
                }
                if visibleSections.count > 1 {
                    // Przejście do innego działu bez wracania na start (na iPadzie także przesunięcie palcem w bok).
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(visibleSections) { entry in sectionChip(entry, active: entry.id == id) }
                        }
                    }
                }
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20), count: columns), spacing: 20) {
                    ForEach(items) { item in itemTile(item, sectionID: id) }
                }
                if items.isEmpty {
                    Text("Ten dział nie ma jeszcze widocznych kart.").font(textFont(18)).foregroundStyle(ink.opacity(0.5)).frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, 40).padding(.top, 96).padding(.bottom, 48)
        }
    }

    private func sectionChip(_ entry: ShowcaseSection, active: Bool) -> some View {
        Button { screen = .section(entry.id) } label: {
            HStack(spacing: 8) {
                Image(systemName: ShowcaseIconInfo.symbol(entry.icon)).font(.system(size: 14))
                Text(entry.title).font(textFont(15))
            }
            .foregroundStyle(active ? surface : accent)
            .padding(.horizontal, 20).frame(height: 44)
            .background(Capsule().fill(active ? accent : Color.clear))
            .overlay(Capsule().stroke(active ? accent : accent.opacity(0.35)))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func itemTile(_ item: ShowcaseItemSummary, sectionID: String) -> some View {
        Button { screen = .item(item.id, sectionID) } label: {
            VStack(alignment: .leading, spacing: 0) {
                scrim.opacity(0.3).aspectRatio(16.0 / 10.0, contentMode: .fit)
                    .overlay { SocialImageView(url: store.url(item.thumbKey)?.thumb) }
                    .clipped()
                VStack(alignment: .leading, spacing: 4) {
                    // Stała wysokość opisu — kafelki w rzędzie mają równą wysokość.
                    heading(item.title, 22).foregroundStyle(ink).lineLimit(2, reservesSpace: true)
                    Text(item.tagline).font(textFont(15)).foregroundStyle(accent).lineLimit(2, reservesSpace: true)
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(scrim.opacity(0.25))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(ink.opacity(0.1)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Karta
    private func itemScreen(_ detail: ShowcaseDetail, size: CGSize) -> some View {
        let blocks = ShowcaseShared.visibleBlocks(detail.item.content, products: detail.products)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                    heroView(detail, height: max(420, size.height * 0.72))
                    Section {
                        // Odstęp nad blokiem należy do bloku: po przejściu z paska bloków tytuł nie chowa się pod przypiętym paskiem.
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(blocks) { block in blockSection(block, detail: detail).padding(.top, 86).id("preview-\(block.id)") }
                            if blocks.isEmpty {
                                Text("Karta nie ma jeszcze treści do pokazania.").font(textFont(18)).foregroundStyle(ink.opacity(0.5)).frame(maxWidth: .infinity)
                                    .padding(.top, 36)
                            }
                            if let nav = neighbours(detail.item.id) { neighbourNav(nav).padding(.top, 64) }
                        }
                        .padding(.horizontal, 40).padding(.bottom, 72)
                    } header: {
                        if blocks.count > 1 { blockNav(blocks, proxy: proxy) }
                    }
                }
            }
        }
        .padding(.top, 64)
    }

    private func heroView(_ detail: ShowcaseDetail, height: CGFloat) -> some View {
        let item = detail.item
        let linked = item.productIds.compactMap { id in detail.products.first { $0.id == id } }.filter { $0.priceNet != nil }
        let products: [ShowcaseProduct] = item.productIds.compactMap { id in detail.products.first { $0.id == id } }
        let offerProducts: [ShowcaseProduct] = products.filter { offerable($0) }
        return ZStack(alignment: .bottomLeading) {
            if let hero = item.content.hero {
                SocialImageView(url: detail.urls[hero.key]?.url).onTapGesture { lightbox = ShowcaseLightbox(photos: [hero], index: 0, urls: detail.urls) }
            } else {
                RadialGradient(colors: [accent.opacity(0.35), surface], center: .topLeading, startRadius: 10, endRadius: 900)
            }
            LinearGradient(colors: [scrim.opacity(0.1), scrim.opacity(0.3), scrim.opacity(0.9)], startPoint: .top, endPoint: .bottom).allowsHitTesting(false)
            VStack(alignment: .leading, spacing: 12) {
                heading(item.title, 56).foregroundStyle(ink)
                if !item.tagline.isEmpty { Text(item.tagline).font(textFont(24)).foregroundStyle(accent) }
                if !item.content.lead.isEmpty { Text(item.content.lead).font(textFont(19)).foregroundStyle(ink.opacity(0.85)).frame(maxWidth: 900, alignment: .leading) }
                if showPrices && !linked.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(linked) { product in
                            let prefix: String = linked.count > 1 ? "\(product.name): " : "od "
                            Text(prefix + ShowcaseShared.price(product.priceNet) + (product.unit.isEmpty ? "" : " / \(product.unit)"))
                                .font(textFont(16)).foregroundStyle(accent)
                                .padding(.horizontal, 14).padding(.vertical, 6).background(Capsule().fill(scrim.opacity(0.5)))
                        }
                    }
                }
                if !offerProducts.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(offerProducts) { product in
                            ShowcaseOfferAddButton(accent: accent, added: offer.has(product, kind: "product", option: nil),
                                                   label: offerProducts.count > 1 ? "Do oferty: \(product.name)" : "Do oferty") {
                                addToOffer(product, kind: "product", option: nil)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
            .padding(40)
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    private func blockNav(_ blocks: [ShowcaseBlock], proxy: ScrollViewProxy) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(blocks) { block in
                    Button { withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo("preview-\(block.id)", anchor: .top) } } label: {
                        Text(block.title).font(textFont(15)).foregroundStyle(accent)
                            .padding(.horizontal, 20).frame(height: 44)
                            .overlay(Capsule().stroke(accent.opacity(0.5)))
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 40).padding(.vertical, 12)
        }
        .background(surface)
    }

    // MARK: Sąsiednie karty działu (koniec karty) — to samo dają strzałki ← → i przesunięcie palcem w bok na iPadzie
    private func neighbours(_ itemID: String) -> ShowcaseNeighbours? {
        guard case .item(_, let sectionID) = screen, let sectionID else { return nil }
        let list = visibleItems(sectionID)
        guard list.count > 1, let index = list.firstIndex(where: { $0.id == itemID }) else { return nil }
        return ShowcaseNeighbours(prev: index > 0 ? list[index - 1] : nil, next: index + 1 < list.count ? list[index + 1] : nil,
                                  index: index, count: list.count, sectionTitle: store.home?.sections.first { $0.id == sectionID }?.title ?? "")
    }

    private func neighbourNav(_ nav: ShowcaseNeighbours) -> some View {
        VStack(spacing: 20) {
            Rectangle().fill(accent.opacity(0.15)).frame(height: 1)
            Text("Karta \(nav.index + 1) z \(nav.count)\(nav.sectionTitle.isEmpty ? "" : " · \(nav.sectionTitle)") — przesuń palcem w bok, żeby przejść do sąsiedniej")
                .font(textFont(15)).foregroundStyle(ink.opacity(0.5)).frame(maxWidth: .infinity)
            HStack(spacing: 20) {
                if let prev = nav.prev { neighbourCard(prev, direction: -1) } else { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                if let next = nav.next { neighbourCard(next, direction: 1) } else { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
            }
        }
    }

    private func neighbourCard(_ item: ShowcaseItemSummary, direction: Int) -> some View {
        Button { move(direction) } label: {
            HStack(spacing: 20) {
                if direction > 0 { neighbourText(item, direction: direction) }
                scrim.opacity(0.3).frame(width: 128, height: 80)
                    .overlay { SocialImageView(url: store.url(item.thumbKey)?.thumb) }
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                if direction < 0 { neighbourText(item, direction: direction) }
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 112)
            .background(RoundedRectangle(cornerRadius: 24).fill(scrim.opacity(0.25)))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(ink.opacity(0.1)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func neighbourText(_ item: ShowcaseItemSummary, direction: Int) -> some View {
        VStack(alignment: direction > 0 ? .trailing : .leading, spacing: 4) {
            HStack(spacing: 4) {
                if direction < 0 { Image(systemName: "chevron.left") }
                Text(direction > 0 ? "Następna karta" : "Poprzednia karta")
                if direction > 0 { Image(systemName: "chevron.right") }
            }
            .font(textFont(14)).foregroundStyle(accent)
            heading(item.title, 22).foregroundStyle(ink).lineLimit(2).multilineTextAlignment(direction > 0 ? .trailing : .leading)
        }
        .frame(maxWidth: .infinity, alignment: direction > 0 ? .trailing : .leading)
    }

    private func blockSection(_ block: ShowcaseBlock, detail: ShowcaseDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            heading(block.title, 34).foregroundStyle(ink)
            if block.kind != .text && !block.text.isEmpty {
                Text(block.text).font(textFont(18)).foregroundStyle(ink.opacity(0.7)).frame(maxWidth: 900, alignment: .leading)
            }
            blockContent(block, detail: detail).padding(.top, 16)
        }
    }

    @ViewBuilder private func blockContent(_ block: ShowcaseBlock, detail: ShowcaseDetail) -> some View {
        switch block.kind {
        case .photos:
            if block.style == "large" { largePhotos(block.photos, urls: detail.urls) } else { gridPhotos(block.photos, urls: detail.urls) }
        case .points:
            points(block.rows.map { ShowcasePoint(title: $0.title, text: $0.text) }, style: block.style)
        case .specs:
            specs(block.rows)
        case .faq:
            faq(block.rows)
        case .text:
            Text(block.text).font(textFont(19)).foregroundStyle(ink.opacity(0.85)).lineSpacing(4).frame(maxWidth: 960, alignment: .leading)
        case .realizations:
            realizations(block.refs.compactMap { id in detail.realizations.first { $0.id == id } }, urls: detail.urls)
        case .catalog:
            if let product = detail.products.first(where: { $0.id == block.productId }) {
                catalog(product, style: block.style, urls: detail.urls)
            }
        }
    }

    // MARK: Bloki
    private func largePhotos(_ photos: [ShowcaseMedia], urls: [String: ShowcaseURLPair]) -> some View {
        VStack(alignment: .leading, spacing: 24) {
            ForEach(Array(photos.enumerated()), id: \.element.id) { entry in
                VStack(alignment: .leading, spacing: 8) {
                    scrim.opacity(0.3).frame(height: 560)
                        .overlay { SocialImageView(url: urls[entry.element.key]?.url) }
                        .clipShape(RoundedRectangle(cornerRadius: 24))
                        .contentShape(Rectangle())
                        .onTapGesture { lightbox = ShowcaseLightbox(photos: photos, index: entry.offset, urls: urls) }
                    if !entry.element.caption.isEmpty { Text(entry.element.caption).font(textFont(16)).foregroundStyle(ink.opacity(0.6)) }
                }
            }
        }
    }

    private func gridPhotos(_ photos: [ShowcaseMedia], urls: [String: ShowcaseURLPair]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: device.wide ? 4 : 3), spacing: 12) {
            ForEach(Array(photos.enumerated()), id: \.element.id) { entry in
                scrim.opacity(0.3).aspectRatio(1, contentMode: .fit)
                    .overlay { SocialImageView(url: urls[entry.element.key]?.thumb) }
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .contentShape(Rectangle())
                    .onTapGesture { lightbox = ShowcaseLightbox(photos: photos, index: entry.offset, urls: urls) }
            }
        }
    }

    private func tile<Inner: View>(highlighted: Bool = false, @ViewBuilder _ inner: () -> Inner) -> some View {
        VStack(alignment: .leading, spacing: 8) { inner() }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(RoundedRectangle(cornerRadius: 24).fill(scrim.opacity(0.25)))
            .overlay(RoundedRectangle(cornerRadius: 24).stroke(highlighted ? accent : ink.opacity(0.1), lineWidth: highlighted ? 2 : 1))
    }

    @ViewBuilder private func points(_ items: [ShowcasePoint], style: String) -> some View {
        switch style {
        case "steps":
            VStack(alignment: .leading, spacing: 20) {
                ForEach(Array(items.enumerated()), id: \.offset) { entry in
                    HStack(alignment: .top, spacing: 20) {
                        Text("\(entry.offset + 1)").font(.system(size: 20, weight: .semibold)).foregroundStyle(surface)
                            .frame(width: 48, height: 48).background(Circle().fill(accent))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.element.title).font(textFont(22)).foregroundStyle(ink)
                            if !entry.element.text.isEmpty { Text(entry.element.text).font(textFont(17)).foregroundStyle(ink.opacity(0.7)) }
                        }
                        .padding(.top, 8)
                    }
                }
            }
        case "checklist":
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 40, alignment: .topLeading), count: device.wide ? 2 : 1), alignment: .leading, spacing: 16) {
                ForEach(Array(items.enumerated()), id: \.offset) { entry in checkRow(entry.element) }
            }
        default:
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20, alignment: .top), count: device.wide ? 3 : 2), spacing: 20) {
                ForEach(Array(items.enumerated()), id: \.offset) { entry in
                    tile {
                        Image(systemName: "checkmark").font(.system(size: 20, weight: .semibold)).foregroundStyle(accent)
                            .frame(width: 44, height: 44).background(RoundedRectangle(cornerRadius: 14).fill(accent.opacity(0.14)))
                        Text(entry.element.title).font(textFont(21)).foregroundStyle(ink).padding(.top, 8)
                        if !entry.element.text.isEmpty { Text(entry.element.text).font(textFont(16)).foregroundStyle(ink.opacity(0.65)) }
                    }
                }
            }
        }
    }

    private func checkRow(_ point: ShowcasePoint) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "checkmark").font(.system(size: 20, weight: .semibold)).foregroundStyle(accent).padding(.top, 2)
            VStack(alignment: .leading, spacing: 2) {
                Text(point.title).font(textFont(19)).foregroundStyle(ink)
                if !point.text.isEmpty { Text(point.text).font(textFont(16)).foregroundStyle(ink.opacity(0.65)) }
            }
            Spacer(minLength: 0)
        }
    }

    private func specs(_ rows: [ShowcaseRow]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { entry in
                HStack(alignment: .top, spacing: 24) {
                    Text(entry.element.title).font(textFont(18)).foregroundStyle(ink.opacity(0.65)).frame(maxWidth: .infinity, alignment: .leading)
                    Text(entry.element.text).font(textFont(18)).foregroundStyle(ink).frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
                }
                .padding(.horizontal, 24).padding(.vertical, 16)
                .background(scrim.opacity(entry.offset % 2 == 0 ? 0.25 : 0.1))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(ink.opacity(0.1)))
    }

    private func faq(_ rows: [ShowcaseRow]) -> some View {
        VStack(spacing: 12) {
            ForEach(rows) { row in
                let open = (openQuestion ?? rows.first?.id) == row.id
                VStack(alignment: .leading, spacing: 0) {
                    Button { openQuestion = open ? "" : row.id } label: {
                        HStack {
                            Text(row.title).font(textFont(20)).foregroundStyle(ink).frame(maxWidth: .infinity, alignment: .leading)
                            Image(systemName: "chevron.right").font(.system(size: 18, weight: .semibold)).foregroundStyle(accent).rotationEffect(.degrees(open ? 90 : 0))
                        }
                        .padding(.horizontal, 24).padding(.vertical, 16)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if open && !row.text.isEmpty {
                        Text(row.text).font(textFont(17)).foregroundStyle(ink.opacity(0.75)).padding(.horizontal, 24).padding(.bottom, 20)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 18).fill(scrim.opacity(0.25)))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(ink.opacity(0.1)))
            }
        }
    }

    private func realizations(_ list: [ShowcaseRealization], urls: [String: ShowcaseURLPair]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20, alignment: .top), count: device.wide ? 3 : 2), spacing: 20) {
            ForEach(list) { entry in
                Button { if !entry.photos.isEmpty { lightbox = ShowcaseLightbox(photos: entry.photos, index: 0, urls: urls) } } label: {
                    VStack(alignment: .leading, spacing: 0) {
                        scrim.opacity(0.3).aspectRatio(4.0 / 3.0, contentMode: .fit)
                            .overlay { SocialImageView(url: entry.photos.first.flatMap { urls[$0.key]?.thumb }) }
                            .overlay(alignment: .bottomTrailing) {
                                if entry.photos.count > 1 {
                                    Label("\(entry.photos.count)", systemImage: "photo.on.rectangle").font(.system(size: 13)).foregroundStyle(ink)
                                        .padding(.horizontal, 10).padding(.vertical, 4).background(Capsule().fill(scrim.opacity(0.6))).padding(12)
                                }
                            }
                            .clipped()
                        VStack(alignment: .leading, spacing: 4) {
                            Text(entry.title).font(textFont(20)).foregroundStyle(ink).lineLimit(2, reservesSpace: true)
                            let place: String = [entry.location, String((entry.date ?? "").prefix(4))].filter { !$0.isEmpty }.joined(separator: " · ")
                            if !place.isEmpty { Label(place, systemImage: "mappin.and.ellipse").font(textFont(14)).foregroundStyle(ink.opacity(0.55)) }
                        }
                        .padding(20)
                    }
                    .background(scrim.opacity(0.25))
                    .clipShape(RoundedRectangle(cornerRadius: 24))
                    .overlay(RoundedRectangle(cornerRadius: 24).stroke(ink.opacity(0.1)))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private func catalog(_ product: ShowcaseProduct, style: String, urls: [String: ShowcaseURLPair]) -> some View {
        switch style {
        case "benefits":
            points(benefitPoints(product), style: "benefits")
        case "variants":
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20, alignment: .top), count: product.variants.count >= 3 && device.wide ? 3 : 2), spacing: 20) {
                ForEach(product.variants) { variant in variantTile(variant, product: product, urls: urls) }
            }
        case "packages":
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 20, alignment: .top), count: product.packages.count >= 3 && device.wide ? 3 : 2), spacing: 20) {
                ForEach(product.packages) { item in packageTile(item, product: product, urls: urls) }
            }
        default:
            preparation(product)
        }
    }

    /// Korzyści produktu, a gdy ich brak — korzyści wariantów.
    private func benefitPoints(_ product: ShowcaseProduct) -> [ShowcasePoint] {
        if !product.benefits.isEmpty { return product.benefits }
        return product.variants.flatMap { variant in variant.benefits.map { ShowcasePoint(title: $0, text: "") } }
    }

    private func priceLine(_ value: Double?, unit: String, onRequest: Bool = false) -> some View {
        Group {
            if onRequest {
                Text("Wycena indywidualna").font(textFont(18)).foregroundStyle(accent)
            } else if let value {
                Text(ShowcaseShared.price(value) + (unit.isEmpty ? "" : " / \(unit)")).font(.system(size: 22, weight: .semibold)).foregroundStyle(accent)
            }
        }
        .padding(.top, 6)
    }

    private func variantTile(_ variant: ShowcaseProductVariant, product: ShowcaseProduct, urls: [String: ShowcaseURLPair]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let image = variant.image {
                scrim.opacity(0.3).aspectRatio(16.0 / 9.0, contentMode: .fit)
                    .overlay { SocialImageView(url: urls[image.key]?.thumb) }
                    .clipped()
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top) {
                    Text(variant.name).font(textFont(22)).foregroundStyle(ink)
                    Spacer()
                    if variant.recommended {
                        Label("Polecany", systemImage: "star.fill").font(.system(size: 13)).foregroundStyle(surface)
                            .padding(.horizontal, 10).padding(.vertical, 4).background(Capsule().fill(accent))
                    }
                }
                if !variant.shortDescription.isEmpty { Text(variant.shortDescription).font(textFont(16)).foregroundStyle(ink.opacity(0.7)) }
                ForEach(Array(variant.benefits.enumerated()), id: \.offset) { entry in
                    Label(entry.element, systemImage: "checkmark").font(textFont(16)).foregroundStyle(ink)
                }
                if showPrices || offerable(product) {
                    HStack(alignment: .bottom, spacing: 8) {
                        if showPrices { priceLine(variant.priceNet, unit: product.unit) }
                        Spacer(minLength: 8)
                        if offerable(product) {
                            ShowcaseOfferAddButton(accent: accent, added: offer.has(product, kind: "variant", option: variant.id)) {
                                addToOffer(product, kind: "variant", option: variant.id)
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            }
            .padding(24)
        }
        .background(scrim.opacity(0.25))
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(variant.recommended ? accent : ink.opacity(0.1), lineWidth: variant.recommended ? 2 : 1))
    }

    private func packageTile(_ item: ShowcaseProductPackage, product: ShowcaseProduct, urls: [String: ShowcaseURLPair]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let image = item.image {
                scrim.opacity(0.3).aspectRatio(16.0 / 9.0, contentMode: .fit)
                    .overlay { SocialImageView(url: urls[image.key]?.thumb) }
                    .clipped()
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(item.name).font(textFont(22)).foregroundStyle(ink)
                if !item.description.isEmpty { Text(item.description).font(textFont(16)).foregroundStyle(ink.opacity(0.7)) }
                if !item.scope.isEmpty { Text("W pakiecie: \(item.scope)").font(textFont(15)).foregroundStyle(ink.opacity(0.6)) }
                if !item.bonus.isEmpty { Text("Gratis: \(item.bonus)").font(textFont(15)).foregroundStyle(accent) }
                if showPrices || offerable(product) {
                    HStack(alignment: .bottom, spacing: 8) {
                        if showPrices { priceLine(item.priceNet, unit: "", onRequest: item.priceOnRequest) }
                        Spacer(minLength: 8)
                        if offerable(product) {
                            ShowcaseOfferAddButton(accent: accent, added: offer.has(product, kind: "package", option: item.id)) {
                                addToOffer(product, kind: "package", option: item.id)
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            }
            .padding(24)
        }
        .background(scrim.opacity(0.25))
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(item.highlighted ? accent : ink.opacity(0.1), lineWidth: item.highlighted ? 2 : 1))
    }

    private func preparation(_ product: ShowcaseProduct) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 24, alignment: .top), count: device.wide ? 2 : 1), spacing: 24) {
            if !product.requirements.isEmpty {
                tile {
                    Text("Co zapewnia obiekt lub klient").font(textFont(20)).foregroundStyle(accent)
                    ForEach(Array(product.requirements.enumerated()), id: \.offset) { entry in checkRow(entry.element) }
                }
            }
            if product.setupHours != nil || product.teardownHours != nil || !product.preparation.isEmpty {
                tile {
                    Text("Montaż i ustalenia").font(textFont(20)).foregroundStyle(accent)
                    if let hours = product.setupHours {
                        Label("Montaż: ok. \(ShowcaseShared.hours(hours)) h przed wydarzeniem", systemImage: "clock").font(textFont(18)).foregroundStyle(ink)
                    }
                    if let hours = product.teardownHours {
                        Label("Demontaż: ok. \(ShowcaseShared.hours(hours)) h", systemImage: "clock").font(textFont(18)).foregroundStyle(ink)
                    }
                    ForEach(Array(product.preparation.enumerated()), id: \.offset) { entry in
                        let days: String = entry.element.leadDays.map { " — \(Int($0)) dni przed" } ?? ""
                        checkRow(ShowcasePoint(title: entry.element.title + days, text: entry.element.details))
                    }
                }
            }
        }
    }

    // MARK: Oferta ze spotkania
    /// Produkt, który można dodać do oferty z pokazu (aktywny, bez konfiguratora) — przy uprawnieniu do ofert z pokazu.
    private func offerable(_ product: ShowcaseProduct) -> Bool { offer.canOffer && product.isActive && product.configurable != true }

    private var currentItemRef: (id: String, title: String)? {
        guard let id = currentItemID, let detail = current(id) else { return nil }
        return (id: detail.item.id, title: detail.item.title)
    }

    private func addToOffer(_ product: ShowcaseProduct, kind: String, option: String?) {
        switch offer.add(product, kind: kind, option: option, item: currentItemRef) {
        case .added(let label): toast = ShowcaseToast(text: "Dodano do oferty: \(label)", error: false, openOffer: true)
        case .exists(let label): toast = ShowcaseToast(text: "„\(label)” jest już w ofercie.", error: false, openOffer: true)
        case .full: toast = ShowcaseToast(text: "Oferta ze spotkania może mieć najwyżej \(ShowcaseOfferRules.lines) pozycji.", error: true, openOffer: false)
        case .unavailable(let name): toast = ShowcaseToast(text: "„\(name)” dodasz w edytorze oferty po jej utworzeniu.", error: true, openOffer: false)
        }
    }

    private func toastView(_ value: ShowcaseToast) -> some View {
        HStack(spacing: 12) {
            Image(systemName: value.error ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.system(size: 18)).foregroundStyle(value.error ? Color.red : accent)
            Text(value.text).font(textFont(16)).foregroundStyle(ink).lineLimit(3)
            if value.openOffer && !offerOpen {
                Button { offerOpen = true; toast = nil } label: {
                    Text("Pokaż ofertę").font(.system(size: 15, weight: .medium)).foregroundStyle(surface)
                        .padding(.horizontal, 14).frame(height: 38).background(Capsule().fill(accent))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 16).fill(surface))
        .overlay(RoundedRectangle(cornerRadius: 16).fill(value.error ? Color.red.opacity(0.22) : Color.clear).allowsHitTesting(false))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(ink.opacity(0.12)))
        .shadow(color: scrim.opacity(0.4), radius: 18)
        .padding(.horizontal, 40).padding(.bottom, 24)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    // MARK: Galeria na pełnym ekranie
    private func lightboxView(_ value: ShowcaseLightbox) -> some View {
        let photo = value.photos.indices.contains(value.index) ? value.photos[value.index] : nil
        return ZStack {
            Color.black
            if let photo {
                SocialImageView(url: value.urls[photo.key]?.url, contentMode: .fit).padding(.vertical, 64)
            }
            VStack {
                HStack {
                    Text(value.photos.count > 1 ? "\(value.index + 1) / \(value.photos.count)" : "").font(.system(size: 15)).foregroundStyle(.white.opacity(0.7))
                    Spacer()
                    Button { lightbox = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 20, weight: .semibold)).foregroundStyle(.white)
                            .frame(width: 44, height: 44).background(Circle().fill(Color.white.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 24).padding(.top, 12)
                Spacer()
                if let caption = photo?.caption, !caption.isEmpty {
                    Text(caption).font(textFont(17)).foregroundStyle(.white.opacity(0.8)).padding(.bottom, 20)
                }
            }
            if value.photos.count > 1 {
                HStack {
                    arrow("chevron.left") { step(-1) }
                    Spacer()
                    arrow("chevron.right") { step(1) }
                }
                .padding(.horizontal, 16)
            }
        }
    }

    private func arrow(_ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 28, weight: .semibold)).foregroundStyle(accent)
                .frame(width: 60, height: 60).background(Circle().fill(Color.black.opacity(0.5)))
        }
        .buttonStyle(.plain)
    }

    private func step(_ delta: Int) {
        guard var value = lightbox, !value.photos.isEmpty else { return }
        value.index = (value.index + delta + value.photos.count) % value.photos.count
        lightbox = value
    }
}

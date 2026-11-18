import SwiftUI
import AppKit

// MARK: „Podgląd brandingu ofert” 1:1 z `CrmOfferBrandingPanel` — w ustawieniach sprzedawcy („Branding i wizytówka — podgląd”)
// i na karcie organizacji („Branding ofert”): marki, organizacja (przy kilku organizacjach sprzedawcy — wybór), informacja o
// brandingu wspólnym albo sprzedawcy niezależnym, wizytówka sprzedawcy, branding organizacji (`OrganizationIdentitySummary`:
// logo, okładka, galeria, czcionka, kolory, brandbook, teksty) i baza hotelu (`HotelVenueSettings` w trybie CRM: sale
// i informacje techniczne lokalizacji — `LocationSpacesPanel`, kontakty hotelu). CRM tylko pokazuje — logo, kolory i wizytówkę
// sprzedawca zmienia w portalu. Serwer: `/bridge/native/v1/sellers?op=branding|hotelVenue` (`src/lib/native/offerBranding.ts`).

struct OfferBrandingData: Decodable {
    struct Organization: Decodable, Identifiable, Hashable { let id: String; let name: String }
    struct Branding: Decodable {
        let displayName: String
        let positionTitle: String
        let contactEmail: String
        let contactPhone: String
        let portrait: String?
        let logo: String?
        let cover: String?
        let gallery: [String]
        let primaryColor: String?
        let secondaryColor: String?
        let surfaceColor: String?
        let headingFont: String
        let headingFontPath: String?
        let brandbook: String?
        let brandbookNotes: String
        let footerText: String
        let disclosureText: String
        let organizationBrandingConfigured: Bool?
    }
    struct Brand: Decodable, Identifiable { let id: String; let name: String; let branding: Branding }
    let organizationId: String?
    let organizationName: String?
    let organizations: [Organization]
    let brands: [Brand]
    let urls: [String: String]

    /// Podpisany adres pliku z `seller-brand-assets` (albo adres zewnętrzny zapisany wprost).
    func url(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.lowercased().hasPrefix("http://") || path.lowercased().hasPrefix("https://") { return URL(string: path) }
        return urls[path].flatMap { URL(string: $0) }
    }
}

struct HotelVenueData: Decodable {
    struct Organization: Decodable { let id: String; let name: String }
    struct Location: Decodable { let id: String; let name: String; let rooms: [CrmLocationRoom]; let technical: [String: JSONValue]; let urls: [String: String] }
    struct Person: Decodable, Identifiable { let id: String; let name: String; let role: String; let email: String; let phone: String }
    let available: Bool
    let canEdit: Bool
    let organization: Organization?
    let location: Location?
    let contacts: [Person]
}

/// Miejsce na karcie organizacji, do którego prowadzą odnośniki podglądu (powiązanie lokalizacji, kontakty hotelu).
enum OfferBrandingTarget { case details, contacts }

/// Etykieta i wartość w podglądzie (kolory, teksty organizacji).
private struct BrandingLine: Identifiable { let label: String; let value: String; var id: String { label } }

@MainActor enum OfferBrandingAPI {
    static func get<T: Decodable>(_ state: Workspace, _ query: [String: String], as type: T.Type) async throws -> T {
        guard let api = state.nativeAPI() else { throw AppError.configuration }
        return try JSONDecoder().decode(T.self, from: try await api.get("/sellers", query: query))
    }
    static func message(_ error: Error, _ fallback: String) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
        if let error = error as? AppError { return error.localizedDescription }
        return fallback
    }
}

@MainActor struct OfferBrandingPanel: View {
    /// Sprzedawca (ustawienia sprzedawcy) albo nil (karta organizacji).
    let partnerID: String?
    /// Organizacja (karta organizacji) albo nil (sprzedawca — organizacja domyślna nowych ofert).
    let organizationID: String?
    /// Hotel na karcie organizacji: zamiast bazy hotelu — przejście do zakładki „Sale i przestrzenie”.
    var onOpenVenue: (() -> Void)? = nil
    /// Karta organizacji (szczegóły albo kontakty) — z odnośników podglądu.
    var openOrganization: ((String, OfferBrandingTarget) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: OfferBrandingData?
    @State private var error: String?
    @State private var loading = false
    @State private var brandID = ""
    @State private var selectedOrganization = ""
    @State private var attempt = 0

    private var key: String { "\(partnerID ?? "")|\(organizationID ?? "")|\(selectedOrganization)|\(attempt)" }

    var body: some View {
        Group {
            if let data {
                content(data)
            } else if loading {
                ProgressView("Wczytywanie brandingu…").frame(maxWidth: .infinity).padding(.vertical, 24)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    Text(error ?? "Brak dostępnych ustawień.").foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
                    Button("Spróbuj ponownie") { attempt += 1 }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.orange.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            }
        }
        .task(id: key) { await load() }
    }

    private func load() async {
        loading = true
        error = nil
        data = nil
        defer { loading = false }
        var query = ["op": "branding"]
        if let partnerID { query["id"] = partnerID }
        let organization = selectedOrganization.isEmpty ? (organizationID ?? "") : selectedOrganization
        if !organization.isEmpty { query["organization"] = organization }
        do {
            let value = try await OfferBrandingAPI.get(state, query, as: OfferBrandingData.self)
            guard !Task.isCancelled else { return }
            data = value
            if !value.brands.contains(where: { $0.id == brandID }) { brandID = value.brands.first?.id ?? "" }
        } catch {
            guard !Task.isCancelled else { return }
            self.error = OfferBrandingAPI.message(error, "Nie udało się pobrać brandingu.")
        }
    }

    private var organizationSelection: Binding<String> {
        Binding(get: { selectedOrganization.isEmpty ? (data?.organizationId ?? "") : selectedOrganization },
                set: { selectedOrganization = $0 })
    }

    @ViewBuilder private func content(_ data: OfferBrandingData) -> some View {
        let brand = data.brands.first(where: { $0.id == brandID }) ?? data.brands.first
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Label("Podgląd brandingu ofert", systemImage: "paintpalette").font(.title3)
                    Text("Logo, kolory, wygląd ofert i wizytówkę sprzedawca ustawia wyłącznie w swoim portalu. CRM pokazuje te same zapisane dane, bez możliwości ich edycji.")
                        .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button { attempt += 1 } label: { Label("Odśwież podgląd", systemImage: "arrow.clockwise") }.controlSize(.small)
            }
            if partnerID != nil && data.organizations.count > 1 {
                Picker("Organizacja powiązana ze sprzedawcą", selection: organizationSelection) {
                    ForEach(data.organizations) { organization in Text(organization.name).tag(organization.id) }
                }
                .frame(maxWidth: 520)
            }
            HStack(spacing: 6) {
                ForEach(data.brands) { item in
                    Button { brandID = item.id } label: {
                        Text(item.name).padding(.horizontal, 12).padding(.vertical, 6)
                            .foregroundStyle(item.id == brand?.id ? theme.accent : Color.secondary)
                            .background((item.id == brand?.id ? theme.accent.opacity(0.15) : Color.primary.opacity(0.05)), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            if let organizationID = data.organizationId {
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: "Branding organizacji jest wspólny dla wszystkich przypisanych do niej sprzedawców w marce \(brand?.name ?? ""). Każdy z nich może go edytować w portalu. Wizytówka dotyczy wyłącznie wybranej osoby.")
                        .font(.callout).fixedSize(horizontal: false, vertical: true)
                    if partnerID != nil, let openOrganization {
                        Button("Otwórz kartę organizacji") { openOrganization(organizationID, .details) }.buttonStyle(.link).linkCursor().font(.caption)
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.accent.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
            } else {
                Text("Sprzedawca niezależny — ustawienia dotyczą tylko jego ofert. Edytuje je w swoim portalu.")
                    .font(.callout).foregroundStyle(.secondary)
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 10))
            }
            if let branding = brand?.branding {
                if partnerID != nil { businessCard(branding, data) }
                identity(branding, data)
            }
            if let onOpenVenue {
                Button { onOpenVenue() } label: {
                    Text("Sale, rzuty i informacje techniczne edytujesz w zakładce „Sale i przestrzenie” →")
                        .foregroundStyle(theme.accent).padding(14).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            } else if let organizationID = data.organizationId {
                HotelVenuePanel(organizationID: organizationID, openOrganization: openOrganization).id(organizationID)
            }
        }
    }

    // MARK: Wizytówka i branding

    private func businessCard(_ branding: OfferBrandingData.Branding, _ data: OfferBrandingData) -> some View {
        HStack(alignment: .top, spacing: 20) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Wizytówka sprzedawcy · podgląd").font(.headline)
                cardField("Imię i nazwisko", branding.displayName)
                cardField("Stanowisko", branding.positionTitle)
                cardField("E-mail", branding.contactEmail)
                cardField("Telefon", branding.contactPhone)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            BrandAssetImage(url: data.url(branding.portrait), hasPath: branding.portrait != nil).frame(width: 220, height: 192)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func cardField(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: label).font(.caption).foregroundStyle(.secondary)
            Text(verbatim: value.isEmpty ? "Nie uzupełniono" : value).textSelection(.enabled)
        }
    }

    private func identity(_ branding: OfferBrandingData.Branding, _ data: OfferBrandingData) -> some View {
        let shared = data.organizationId != nil
        let colors = [BrandingLine(label: "Kolor główny", value: branding.primaryColor ?? ""), BrandingLine(label: "Akcent", value: branding.secondaryColor ?? ""),
                      BrandingLine(label: "Tło", value: branding.surfaceColor ?? "")].filter { !$0.value.isEmpty }
        let texts = [BrandingLine(label: "Zasady używania marki", value: branding.brandbookNotes), BrandingLine(label: "Tekst organizacji w ofercie", value: branding.footerText),
                     BrandingLine(label: "Informacja o partnerze / realizatorze", value: branding.disclosureText)].filter { !$0.value.isEmpty }
        return VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: (shared ? "Branding organizacji" : "Branding sprzedawcy") + (data.organizationName.map { " · \($0)" } ?? "")).font(.headline)
                Text(shared ? "Wspólne ustawienia edytują przypisani sprzedawcy w swoim portalu. Zmiany nie nadpisują istniejących ofert ani zapisanych PDF-ów."
                     : "Ustawienia edytuje sprzedawca w swoim portalu. Poniżej aktualny podgląd.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Logo").font(.caption).foregroundStyle(.secondary)
                    BrandAssetImage(url: data.url(branding.logo), hasPath: branding.logo != nil).frame(height: 160)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Zdjęcie okładkowe").font(.caption).foregroundStyle(.secondary)
                    BrandAssetImage(url: data.url(branding.cover), hasPath: branding.cover != nil, fill: true).frame(height: 160)
                }
            }
            if !branding.gallery.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Galeria obiektu").font(.caption).foregroundStyle(.secondary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 10)], alignment: .leading, spacing: 10) {
                        ForEach(Array(branding.gallery.enumerated()), id: \.offset) { _, path in
                            BrandAssetImage(url: data.url(path), hasPath: true, fill: true).frame(height: 112)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                Text(verbatim: "Czcionka nagłówków: \(branding.headingFont)").font(.callout)
                HStack(spacing: 16) {
                    ForEach(colors) { item in
                        HStack(spacing: 6) {
                            Circle().fill(CrmTheme.hex(item.value) ?? Color.clear).frame(width: 18, height: 18)
                                .overlay(Circle().stroke(Color.primary.opacity(0.15)))
                            Text(verbatim: "\(item.label): \(item.value)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                HStack(spacing: 16) {
                    if let url = data.url(branding.headingFontPath) { assetLink("Plik czcionki", url) }
                    if let url = data.url(branding.brandbook) { assetLink("Otwórz brandbook", url) }
                }
            }
            ForEach(texts) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: item.label).font(.caption).foregroundStyle(.secondary)
                    Text(verbatim: item.value).font(.callout).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
            if branding.organizationBrandingConfigured == false {
                Text("Organizacja nie ma jeszcze ustawionego brandingu tej marki. Może go uzupełnić każdy przypisany sprzedawca w swoim portalu.")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    private func assetLink(_ title: String, _ url: URL) -> some View {
        Button { NSWorkspace.shared.open(url) } label: { Label(title, systemImage: "arrow.up.right.square") }
            .buttonStyle(.link).linkCursor().font(.caption)
    }
}

/// Plik brandingu (`IdentityAssetPreview`): obraz z podpisanego adresu albo „Brak pliku” / „Podgląd niedostępny”.
@MainActor struct BrandAssetImage: View {
    let url: URL?
    let hasPath: Bool
    var fill = false

    var body: some View {
        ZStack {
            Color.primary.opacity(0.06)
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        if fill { image.resizable().scaledToFill() } else { image.resizable().scaledToFit().padding(6) }
                    case .failure:
                        placeholder("Podgląd niedostępny")
                    default:
                        ProgressView().controlSize(.small)
                    }
                }
            } else {
                placeholder(hasPath ? "Podgląd niedostępny" : "Brak pliku")
            }
        }
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func placeholder(_ text: String) -> some View {
        Text(verbatim: text).font(.caption).foregroundStyle(.tertiary).multilineTextAlignment(.center).padding(8)
    }
}

/// „Przestrzenie i kontakty hotelu” (`HotelVenueSettings` z `crm`): z prawem edycji lokalizacji — sale i informacje techniczne
/// do edycji (te same co karta lokalizacji), bez — podgląd; do tego aktualne kontakty hotelu. Bez bazy hotelu — nic.
@MainActor struct HotelVenuePanel: View {
    let organizationID: String
    var openOrganization: ((String, OfferBrandingTarget) -> Void)? = nil
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var data: HotelVenueData?
    @State private var error: String?
    @State private var loading = true
    @State private var attempt = 0

    var body: some View {
        Group {
            if !loading && error == nil && data?.available != true {
                EmptyView()
            } else {
                section
            }
        }
        .task(id: "\(organizationID)|\(attempt)") { await load() }
    }

    private func load() async {
        loading = true
        error = nil
        defer { loading = false }
        do {
            let value = try await OfferBrandingAPI.get(state, ["op": "hotelVenue", "organization": organizationID], as: HotelVenueData.self)
            guard !Task.isCancelled else { return }
            data = value
        } catch {
            guard !Task.isCancelled else { return }
            self.error = OfferBrandingAPI.message(error, "Nie udało się wczytać bazy hotelu.")
        }
    }

    private var section: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Label {
                        Text(verbatim: ("Przestrzenie i kontakty hotelu" + (data?.organization.map { " · \($0.name)" } ?? "")).uppercased())
                    } icon: { Image(systemName: "building.2").foregroundStyle(theme.accent) }
                    .font(.subheadline.weight(.semibold))
                    Text("Wspólna baza hotelu, niezależna od marki oferty. W ofercie wybierasz salę i potrzebne osoby z listy. Edycja bazy należy do CRM; sprzedawcy korzystają z podglądu.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Spacer()
                Button { attempt += 1 } label: { Image(systemName: "arrow.clockwise") }.disabled(loading).help("Odśwież bazę hotelu")
            }
            if loading { ProgressView("Wczytywanie bazy hotelu…").controlSize(.small) }
            if let error { Text(error).font(.callout).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true) }
            if !loading, error == nil, let data, data.available {
                if let organization = data.organization {
                    venue(data, organization)
                    contacts(data, organization)
                } else {
                    Text("Wybierz hotel, aby zobaczyć jego przestrzenie, plany i kontakty.").font(.callout).foregroundStyle(.secondary)
                }
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder private func venue(_ data: HotelVenueData, _ organization: HotelVenueData.Organization) -> some View {
        if let location = data.location {
            if data.canEdit {
                Text("Dodane tutaj sale, plany i informacje będą widoczne sprzedawcom hotelu. Nie dodawaj wewnętrznych notatek CRM.")
                    .font(.caption).foregroundStyle(.secondary)
                LocationSpacesPanel(store: state.locations, locationID: location.id).id("\(location.id)|\(attempt)")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("SALE I PRZESTRZENIE").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(location.rooms) { room in
                        DisclosureGroup {
                            VStack(alignment: .leading, spacing: 8) {
                                if !room.notes.isEmpty { Text(room.notes).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
                                LocationTechnicalView(value: room.technical, urls: location.urls)
                            }
                            .padding(.top, 6)
                        } label: { Text(room.name).foregroundStyle(theme.accent) }
                        .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                    }
                    if location.rooms.isEmpty {
                        Text("Nie dodano jeszcze przestrzeni. Poproś opiekuna o uzupełnienie bazy hotelu.").font(.callout).foregroundStyle(.secondary)
                    }
                    DisclosureGroup {
                        LocationTechnicalView(value: location.technical, urls: location.urls).padding(.top, 6)
                    } label: { Text("Plany i informacje o obiekcie").foregroundStyle(theme.accent) }
                    .padding(10).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Hotel nie ma jeszcze powiązanej lokalizacji. Opiekun CRM powinien wybrać lub utworzyć lokalizację w szczegółach organizacji. Sale i materiały zapisujemy w tej samej bazie co wydarzenia.")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let openOrganization {
                    Button("Powiąż lokalizację hotelu") { openOrganization(organization.id, .details) }.buttonStyle(.link).linkCursor()
                }
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private func contacts(_ data: HotelVenueData, _ organization: HotelVenueData.Organization) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("KONTAKTY HOTELOWE").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text("Aktualne osoby powiązane z hotelem w CRM, np. technik, recepcja i dział sprzedaży. Do konkretnej oferty dodajesz tylko potrzebne kontakty.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(data.contacts) { person in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(person.name)
                        if !person.role.isEmpty { Text(person.role).font(.caption).foregroundStyle(.secondary) }
                        Text(verbatim: [person.phone, person.email].filter { !$0.isEmpty }.joined(separator: " · ").nonEmpty ?? "Kontakt do uzupełnienia w CRM")
                            .font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                    }
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                }
            }
            if data.contacts.isEmpty { Text("Brak aktualnych kontaktów hotelowych.").font(.callout).foregroundStyle(.secondary) }
            if let openOrganization {
                Button("Dodaj lub uporządkuj kontakty organizacji w CRM") { openOrganization(organization.id, .contacts) }
                    .buttonStyle(.link).linkCursor().font(.caption)
            }
        }
    }
}

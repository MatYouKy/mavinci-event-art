import SwiftUI

// MARK: Nowe zapytanie — okno jak `NewInquiryModal` w CRM (lejek zapytań, kalendarz, karta kontaktu), na Macu uzupełnione:
//
// • Klient z pełnej listy kontaktów (kopia Kontaktów na Macu albo pełna lista z serwera — okno CRM pobiera po 200 rekordów,
//   więc część osób nie była do znalezienia): każde słowo frazy w nazwie, e-mailu, telefonie (same cyfry), stanowisku
//   i nazwach powiązanych organizacji. Organizacja i osoba kontaktowa razem: po wyborze organizacji — jej osoby
//   (`contact_organizations.is_current`), po wyborze osoby — jej organizacje (jedna — od razu). Telefon i e-mail z osoby.
// • „Dodaj klienta” — formularze Kontaktów (organizacja, osoba kontaktowa, osoba prywatna, „Dodaj osobę do …”) bez
//   wychodzenia z okna; nowy rekord jest od razu wybrany.
// • Rozpoznanie kontaktu po wpisanym telefonie lub e-mailu, ostrzeżenie o otwartych zapytaniach tego klienta (z lejka)
//   i o kontakcie, który baza utworzyłaby z nazwy organizacji (`link_inquiry_to_customer360`).
// • Prowadzenie: opiekun od razu (wspólna kolejka, Ty, osoba z zespołu — uprawnienia jak przydział w lejku), „Rozmowa
//   z klientem już się odbyła” (etap „Kontakt podjęty”, bez przypomnienia o pierwszym kontakcie) i termin następnego
//   działania z gotowymi terminami. Podgląd wartości szacunkowej z budżetu (jak liczy serwer).
// • Zapis nie odmawia, gdy w tle trwa zwykłe odświeżanie danych (`Workspace.prepareWrite`).
// Serwer: `/bridge/native/v1/inquiries` (`newSetup`, `specialDays`, `create` — `src/lib/native/inquiryCreate.ts`), tokenem
// pracownika (RLS). Starszy serwer bez opiekuna i kontaktu w `create` — okno wykonuje je czynnościami lejka (`claim`, `contact`).

/// Klient wskazany z góry (z karty kontaktu — jak `initialClient` w CRM).
struct NewInquiryClient {
    var contactID: String? = nil
    var organizationID: String? = nil
    var name: String
    var email: String? = nil
    var phone: String? = nil
}

/// Wynik zapisu dla miejsca, z którego otwarto okno (lejek, kalendarz, karta kontaktu).
struct NewInquiryCreated {
    let id: String
    /// Opiekun po zapisie (wybrany albo z przydziału automatycznego); `nil` — wspólna kolejka.
    let ownerID: String?
    let message: String
    /// Czynności po zapisie, których nie udało się wykonać (zapytanie jest zapisane).
    let warnings: [String]

    /// Komunikat w oknie aplikacji: potwierdzenie albo informacja z tym, co trzeba dokończyć w lejku.
    @MainActor func announce(_ state: Workspace) {
        if warnings.isEmpty { state.succeed(message) } else { state.notice = ([message] + warnings).joined(separator: ". ") }
    }
}

struct NewInquirySetup: Decodable {
    struct Organization: Decodable { var id: String; var name: String; var alias: String; var email: String?; var phone: String?; var city: String? }
    struct Contact: Decodable {
        var id: String; var firstName: String; var lastName: String; var phone: String; var email: String; var position: String?
        var fullName: String { "\(firstName) \(lastName)".trimmingCharacters(in: .whitespaces) }
    }
    struct Location: Decodable, Identifiable { var id: String; var name: String; var address: String; var city: String }
    /// Obecne powiązania osoby z organizacją (nowszy serwer).
    struct Link: Decodable { var contactId: String; var organizationId: String; var position: String }
    var organizations: [Organization]
    var contacts: [Contact]
    var locations: [Location]
    var links: [Link]?
}

// MARK: Lista klientów

/// Druga strona powiązania osoby z organizacją (osoba organizacji albo organizacja osoby).
struct InquiryClientLink: Hashable, Identifiable {
    let id: String
    let name: String
    let position: String
    let primary: Bool
    let decisionMaker: Bool
}

struct InquiryClientOrganization: Hashable, Identifiable {
    let id: String
    let name: String
    let legalName: String
    let email: String
    let phone: String
    let city: String
    let people: [InquiryClientLink]
    var detail: String {
        [city, InquiryClientIndex.peopleLabel(people.count)].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct InquiryClientPerson: Hashable, Identifiable {
    let id: String
    let name: String
    let email: String
    let phone: String
    let position: String
    let individual: Bool
    let organizations: [InquiryClientLink]
    var detail: String {
        let places = organizations.map(\.name).joined(separator: ", ")
        return [individual ? "Osoba prywatna" : position, places, phone].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

/// Organizacje i osoby z obecnymi powiązaniami — z kopii Kontaktów (`ContactsStore`) albo z listy serwera (`op=newSetup`).
struct InquiryClientIndex {
    var organizations: [String: InquiryClientOrganization] = [:]
    var people: [String: InquiryClientPerson] = [:]
    var isEmpty: Bool { organizations.isEmpty && people.isEmpty }

    init() {}

    init(entries: [ContactEntry]) {
        for entry in entries {
            let links = entry.links.map {
                InquiryClientLink(id: $0.id, name: $0.name, position: $0.position, primary: $0.primary, decisionMaker: $0.decisionMaker)
            }
            if entry.isOrganization {
                organizations[entry.id] = InquiryClientOrganization(
                    id: entry.id, name: entry.name, legalName: entry.legalName == entry.name ? "" : entry.legalName,
                    email: entry.email, phone: entry.listPhone, city: entry.city, people: links)
            } else {
                people[entry.id] = InquiryClientPerson(
                    id: entry.id, name: entry.name.isEmpty ? "—" : entry.name, email: entry.email, phone: entry.listPhone,
                    position: entry.position, individual: entry.isIndividual, organizations: links)
            }
        }
    }

    init(setup: NewInquirySetup) {
        var organizationNames: [String: String] = [:]
        for organization in setup.organizations {
            organizationNames[organization.id] = organization.alias.isEmpty ? organization.name : organization.alias
        }
        var personNames: [String: String] = [:]
        for contact in setup.contacts {
            personNames[contact.id] = contact.fullName.isEmpty ? (contact.email.isEmpty ? "—" : contact.email) : contact.fullName
        }
        var byOrganization: [String: [InquiryClientLink]] = [:]
        var byPerson: [String: [InquiryClientLink]] = [:]
        for link in setup.links ?? [] {
            if let name = personNames[link.contactId] {
                byOrganization[link.organizationId, default: []].append(
                    InquiryClientLink(id: link.contactId, name: name, position: link.position, primary: false, decisionMaker: false))
            }
            if let name = organizationNames[link.organizationId] {
                byPerson[link.contactId, default: []].append(
                    InquiryClientLink(id: link.organizationId, name: name, position: link.position, primary: false, decisionMaker: false))
            }
        }
        for organization in setup.organizations {
            let name = organizationNames[organization.id] ?? organization.name
            organizations[organization.id] = InquiryClientOrganization(
                id: organization.id, name: name, legalName: organization.name == name ? "" : organization.name,
                email: organization.email ?? "", phone: organization.phone ?? "", city: organization.city ?? "",
                people: byOrganization[organization.id] ?? [])
        }
        for contact in setup.contacts {
            people[contact.id] = InquiryClientPerson(
                id: contact.id, name: personNames[contact.id] ?? "—", email: contact.email, phone: contact.phone,
                position: contact.position ?? "", individual: false, organizations: byPerson[contact.id] ?? [])
        }
    }

    // MARK: Wyszukiwanie

    /// Małe litery bez znaków diakrytycznych (także „ł”) — „lodz” znajduje „Łódź”.
    static func fold(_ text: String) -> String {
        text.lowercased().replacingOccurrences(of: "ł", with: "l").folding(options: .diacriticInsensitive, locale: Locale(identifier: "pl_PL"))
    }
    static func digits(_ text: String) -> String { text.filter { $0.isASCII && $0.isNumber } }
    /// Ostatnie 9 cyfr numeru (bez kierunkowego) — porównanie telefonów zapisanych różnie.
    static func phoneTail(_ phone: String) -> String? {
        let value = digits(phone)
        return value.count >= 9 ? String(value.suffix(9)) : nil
    }
    static func words(_ query: String) -> [String] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // Numer telefonu wpisany ze spacjami („+48 600 123 456”) — jedno słowo z samych cyfr.
        if !trimmed.isEmpty, digits(trimmed).count >= 3, trimmed.allSatisfy({ ($0.isASCII && $0.isNumber) || " +-()/.".contains($0) }) {
            return [digits(trimmed)]
        }
        return trimmed.split(whereSeparator: { $0.isWhitespace || $0 == "," }).map { fold(String($0)) }.filter { !$0.isEmpty }
    }
    /// Każde słowo w tekście; słowo z samych cyfr (co najmniej 3) — także w cyfrach telefonu (długi numer — ostatnie 9 cyfr,
    /// bo numer bywa zapisany bez kierunkowego).
    static func matches(_ words: [String], text: String, phone: String) -> Bool {
        let haystack = fold(text)
        let phoneDigits = digits(phone)
        return words.allSatisfy { word in
            if haystack.contains(word) { return true }
            let wordDigits = digits(word)
            let numeric = word.allSatisfy { ($0.isASCII && $0.isNumber) || "+-()/.".contains($0) }
            guard numeric, wordDigits.count >= 3, !phoneDigits.isEmpty else { return false }
            return phoneDigits.contains(wordDigits) || (wordDigits.count >= 9 && phoneDigits.contains(String(wordDigits.suffix(9))))
        }
    }

    func search(_ query: String) -> (organizations: [InquiryClientOrganization], people: [InquiryClientPerson]) {
        let words = Self.words(query)
        guard let first = words.first else { return ([], []) }
        let foundOrganizations = organizations.values.filter {
            Self.matches(words, text: "\($0.name) \($0.legalName) \($0.email) \($0.city)", phone: $0.phone)
        }
        let foundPeople = people.values.filter {
            Self.matches(words, text: "\($0.name) \($0.email) \($0.position) " + $0.organizations.map(\.name).joined(separator: " "), phone: $0.phone)
        }
        func before(_ a: String, _ b: String) -> Bool {
            let aPrefix = Self.fold(a).hasPrefix(first), bPrefix = Self.fold(b).hasPrefix(first)
            if aPrefix != bPrefix { return aPrefix }
            return a.localizedStandardCompare(b) == .orderedAscending
        }
        return (Array(foundOrganizations.sorted { before($0.name, $1.name) }.prefix(8)),
                Array(foundPeople.sorted { before($0.name, $1.name) }.prefix(12)))
    }

    /// „1 osoba”, „3 osoby”, „5 osób”.
    static func peopleLabel(_ count: Int) -> String {
        if count == 0 { return "brak osób" }
        if count == 1 { return "1 osoba" }
        let tens = count % 100, units = count % 10
        return "\(count) " + ((2...4).contains(units) && !(12...14).contains(tens) ? "osoby" : "osób")
    }

    /// Osoby z tym e-mailem albo telefonem (rozpoznanie klienta po wpisanych danych).
    func matchingPeople(email: String, phone: String) -> [InquiryClientPerson] {
        let mail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let tail = Self.phoneTail(phone)
        guard mail.contains("@") || tail != nil else { return [] }
        return people.values.filter { person in
            (mail.contains("@") && person.email.lowercased() == mail) || (tail != nil && Self.phoneTail(person.phone) == tail)
        }
        .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}

// MARK: Model okna

/// Termin następnego działania z gotowych przycisków.
struct NewInquiryNextPreset: Identifiable {
    let id: String
    let label: String
    let date: () -> Date
}

@MainActor final class NewInquiryModel: ObservableObject {
    /// Źródła zapytania wpisywanego ręcznie (`SOURCE_LABELS`).
    static let sources: [(String, String)] = [
        ("phone", "Telefon"), ("meeting", "Rozmowa / spotkanie"), ("referral", "Polecenie"), ("social_media", "Social media"), ("other", "Inne źródło"),
    ]
    /// Źródła, przy których rozmowa z klientem zwykle już się odbyła (domyślnie zaznaczone „Rozmowa … odbyła”).
    static let conversationSources: Set<String> = ["phone", "meeting"]

    weak var workspace: Workspace?
    /// Identyfikator nadany przy otwarciu okna — ponowny zapis nie tworzy duplikatu (jak w CRM).
    let inquiryID = UUID().uuidString.lowercased()

    @Published var subject = ""
    @Published var source = "phone" {
        didSet { if !contactedTouched { contacted = Self.conversationSources.contains(source) } }
    }
    @Published var hasTermin = false
    @Published var termin = Date()
    @Published var scope = ""
    @Published var guestCount = ""
    @Published var budget = ""
    @Published var expectations = ""

    // Klient: wyszukiwanie / wpisana nazwa albo wybrana organizacja i osoba kontaktowa.
    @Published var clientText = ""
    @Published private(set) var organizationID: String?
    @Published private(set) var organizationName = ""
    @Published private(set) var personID: String?
    @Published private(set) var personName = ""
    @Published var clientPhone = ""
    @Published var clientEmail = ""
    /// Telefon i e-mail wpisane automatycznie z wybranej osoby — zmiana osoby je podmienia, wpisane ręcznie zostają.
    private var autoPhone = ""
    private var autoEmail = ""
    @Published var locationText = ""
    @Published var locationID: String?

    // Prowadzenie
    /// Opiekun: puste — wspólna kolejka.
    @Published var ownerID = ""
    @Published var contacted = true
    private var contactedTouched = false
    @Published var nextAction: Date?

    @Published private(set) var index = InquiryClientIndex()
    @Published private(set) var indexReady = false
    @Published private(set) var locations: [NewInquirySetup.Location] = []
    @Published private(set) var access: InquiryAccess?
    @Published private(set) var employees: [MeetingPerson] = []
    @Published var specialDays: EventSpecialDays?
    @Published var saving = false
    @Published var error: String?
    private var setup: NewInquirySetup?
    private var usesContacts = false

    init(initialDate: Date?, initialClient: NewInquiryClient?) {
        if let initialDate {
            hasTermin = true
            termin = initialDate
        }
        if let initialClient {
            organizationID = initialClient.organizationID
            personID = initialClient.contactID
            if initialClient.contactID != nil { personName = initialClient.name } else if initialClient.organizationID != nil { organizationName = initialClient.name }
            if initialClient.contactID == nil && initialClient.organizationID == nil { clientText = initialClient.name }
            clientPhone = initialClient.phone ?? ""
            clientEmail = initialClient.email ?? ""
            autoPhone = clientPhone
            autoEmail = clientEmail
        }
    }

    private var api: NativeAPI? { workspace?.nativeAPI() }
    var me: String? { workspace?.employee?.id }

    /// Termin jak pole `datetime-local` w CRM: „RRRR-MM-DDTGG:MM” w czasie polskim, puste — bez terminu.
    var terminText: String {
        guard hasTermin else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = MeetingDates.zone
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter.string(from: termin)
    }

    // MARK: Wczytanie

    func load(_ state: Workspace) async {
        workspace = state
        async let fetched = fetchSetup()
        // Uprawnienia lejka (opiekun do wyboru) — z kopii lejka; bez niej pobieramy ją teraz.
        if state.inquiries.access == nil, state.employee?.canView(.inquiries) == true { await state.inquiries.backgroundSync() }
        access = state.inquiries.access
        // Kopia Kontaktów ma pełną listę z powiązaniami; bez dostępu do Kontaktów — lista z serwera.
        if state.employee?.canView(.contacts) == true {
            if state.contacts.contacts.isEmpty { await state.contacts.backgroundSync() } else { Task { await state.contacts.sync() } }
        }
        setup = await fetched
        locations = setup?.locations ?? []
        rebuildIndex()
        indexReady = true
        if access?.canAssign == true {
            await state.inquiries.loadEmployees()
            employees = state.inquiries.employees
        }
    }

    private func fetchSetup() async -> NewInquirySetup? {
        guard let api, let data = try? await api.get("/inquiries", query: ["op": "newSetup"]) else { return nil }
        return try? JSONDecoder().decode(NewInquirySetup.self, from: data)
    }

    /// Lista klientów od nowa (po dodaniu osoby lub organizacji w formularzu Kontaktów).
    func rebuildIndex() {
        let entries = workspace?.contacts.contacts ?? []
        if !entries.isEmpty {
            index = InquiryClientIndex(entries: entries)
            usesContacts = true
        } else if let setup {
            index = InquiryClientIndex(setup: setup)
            usesContacts = false
        }
        // Nazwy wybranego klienta z listy (okno z karty kontaktu dostaje tylko jedną nazwę).
        if let id = organizationID, let organization = index.organizations[id] { organizationName = organization.name }
        if let id = personID, let person = index.people[id] { personName = person.name }
    }
    func reloadAfterCreate() async {
        if !usesContacts, let fresh = await fetchSetup() { setup = fresh; locations = fresh.locations }
        rebuildIndex()
    }

    /// Nietypowe dni terminu (`SpecialDayNotice`): święto, niedziela, długi weekend, Sylwester.
    func loadSpecialDays() async {
        let from = terminText
        guard !from.isEmpty, let api else { specialDays = nil; return }
        let days = try? JSONDecoder().decode(EventSpecialDays.self, from: try await api.get("/inquiries", query: ["op": "specialDays", "from": from]))
        guard from == terminText else { return }
        specialDays = days
    }

    // MARK: Klient

    var organization: InquiryClientOrganization? { organizationID.flatMap { index.organizations[$0] } }
    var person: InquiryClientPerson? { personID.flatMap { index.people[$0] } }
    var hasClient: Bool { organizationID != nil || personID != nil }

    /// Osoby wybranej organizacji (główny kontakt i osoby decyzyjne najpierw).
    var organizationPeople: [InquiryClientPerson] {
        guard let organization else { return [] }
        let links = organization.people.sorted { a, b in
            if a.primary != b.primary { return a.primary }
            if a.decisionMaker != b.decisionMaker { return a.decisionMaker }
            return a.name.localizedStandardCompare(b.name) == .orderedAscending
        }
        var result = links.map { link -> InquiryClientPerson in
            if let person = index.people[link.id] {
                return InquiryClientPerson(id: person.id, name: person.name, email: person.email, phone: person.phone,
                                           position: link.position.isEmpty ? person.position : link.position,
                                           individual: person.individual, organizations: person.organizations)
            }
            return InquiryClientPerson(id: link.id, name: link.name, email: "", phone: "", position: link.position, individual: false, organizations: [])
        }
        // Wybrana osoba spoza obecnych powiązań (np. z karty kontaktu) też jest na liście.
        if let person, !result.contains(where: { $0.id == person.id }) { result.insert(person, at: 0) }
        return result
    }
    func link(of personID: String) -> InquiryClientLink? { organization?.people.first { $0.id == personID } }

    func pick(organization: InquiryClientOrganization) {
        organizationID = organization.id
        organizationName = organization.name
        clientText = ""
        // Osoba spoza tej organizacji nie pasuje do nowego klienta.
        if let person, !person.organizations.contains(where: { $0.id == organization.id }) { clearPerson() }
    }
    func pick(organizationID id: String) {
        if let organization = index.organizations[id] { pick(organization: organization) }
    }
    func pick(person: InquiryClientPerson, keepOrganization: Bool = false) {
        personID = person.id
        personName = person.name
        clientText = ""
        fill(phone: person.phone, email: person.email)
        if keepOrganization { return }
        // Organizacja: obecna, jeśli osoba w niej pracuje; jedyna organizacja osoby — od razu; kilka — wybór (główna od razu).
        if let current = organizationID, person.organizations.contains(where: { $0.id == current }) { return }
        if person.organizations.count == 1, let only = person.organizations.first {
            organizationID = only.id
            organizationName = index.organizations[only.id]?.name ?? only.name
        } else if let primary = person.organizations.first(where: \.primary) {
            organizationID = primary.id
            organizationName = index.organizations[primary.id]?.name ?? primary.name
        } else {
            organizationID = nil
            organizationName = ""
        }
    }
    func pick(personID id: String) {
        if let person = index.people[id] { pick(person: person, keepOrganization: organizationID != nil && link(of: id) != nil) }
    }
    /// Osoba z listy osób organizacji — organizacja zostaje.
    func choose(person: InquiryClientPerson) {
        if personID == person.id { clearPerson(); return }
        pick(person: person, keepOrganization: true)
    }
    func chooseOrganization(_ link: InquiryClientLink) {
        organizationID = link.id
        organizationName = index.organizations[link.id]?.name ?? link.name
    }
    func clearPerson() {
        personID = nil
        personName = ""
        if clientPhone == autoPhone { clientPhone = "" }
        if clientEmail == autoEmail { clientEmail = "" }
        autoPhone = ""; autoEmail = ""
    }
    func clearOrganization() {
        organizationID = nil
        organizationName = ""
    }
    /// „Zmień klienta” — wracamy do wyszukiwania z nazwą do poprawienia.
    func clearClient() {
        let previous = personID != nil && organizationID == nil ? personName : organizationName
        clearPerson()
        clearOrganization()
        clientText = previous
    }
    private func fill(phone: String, email: String) {
        let currentPhone = clientPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentEmail = clientEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        if !phone.isEmpty, currentPhone.isEmpty || clientPhone == autoPhone { clientPhone = phone; autoPhone = phone }
        if !email.isEmpty, currentEmail.isEmpty || clientEmail == autoEmail { clientEmail = email; autoEmail = email }
    }

    /// Nazwa klienta w zapytaniu (`client_text`): osoba kontaktowa, inaczej organizacja, inaczej wpisany tekst.
    var clientLabel: String {
        if personID != nil { return personName }
        if organizationID != nil { return organizationName }
        return clientText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    /// Organizacja obok osoby kontaktowej (`client_company`).
    var clientCompany: String { personID != nil && organizationID != nil ? organizationName : "" }

    /// Osoby z kontaktów z tym telefonem lub e-mailem — gdy nie wybrano osoby.
    var recognizedPeople: [InquiryClientPerson] {
        guard personID == nil else { return [] }
        return Array(index.matchingPeople(email: clientEmail, phone: clientPhone).prefix(3))
    }
    /// Baza utworzy kontakt o nazwie organizacji, gdy zapytanie ma organizację bez osoby, a telefon/e-mail nie pasuje
    /// do żadnego kontaktu (`link_inquiry_to_customer360`).
    var createsContactFromOrganization: Bool {
        guard organizationID != nil, personID == nil, recognizedPeople.isEmpty else { return false }
        let mail = clientEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        return mail.range(of: #"^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$"#, options: .regularExpression) != nil
            || InquiryClientIndex.digits(clientPhone).count >= 9
    }

    /// Otwarte zapytania tego klienta (widoczne dla Ciebie w lejku): ta sama osoba, organizacja, e-mail albo telefon.
    func openInquiries(_ all: [Inquiry]) -> [Inquiry] {
        let mail = clientEmail.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let tail = InquiryClientIndex.phoneTail(clientPhone)
        return all.filter { inquiry in
            guard inquiry.isOpen, inquiry.id != inquiryID else { return false }
            if let personID, inquiry.contactId == personID { return true }
            if let organizationID, inquiry.organizationId == organizationID { return true }
            if mail.contains("@"), inquiry.clientEmail.lowercased() == mail { return true }
            if let tail, InquiryClientIndex.phoneTail(inquiry.clientPhone) == tail { return true }
            return false
        }
        .sorted { $0.created > $1.created }
    }

    // MARK: Lokalizacja

    var filteredLocations: [NewInquirySetup.Location] {
        let words = InquiryClientIndex.words(locationText)
        if words.isEmpty { return Array(locations.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }.prefix(20)) }
        return Array(locations.filter { InquiryClientIndex.matches(words, text: "\($0.name) \($0.address) \($0.city)", phone: "") }.prefix(20))
    }
    func typeLocation(_ value: String) {
        guard value != locationText else { return }
        locationText = value
        locationID = nil
    }
    func pick(_ location: NewInquirySetup.Location) {
        locationID = location.id
        locationText = [location.name, location.city].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    // MARK: Prowadzenie

    func setContacted(_ value: Bool) {
        contactedTouched = true
        contacted = value
    }
    /// Opiekunowie do wyboru: Ty (przejmowanie lub przydział), inne osoby z listy „Osoba odpowiedzialna” (przydział).
    var ownerOptions: [MeetingPerson] {
        guard let access, let me = workspace?.employee else { return [] }
        var result: [MeetingPerson] = []
        if access.canClaim || access.canAssign {
            result.append(MeetingPerson(id: me.id, name: "Ja — \(me.name) \(me.surname)".trimmingCharacters(in: .whitespaces)))
        }
        if access.canAssign {
            result += employees.filter { $0.id != me.id }
        }
        return result
    }

    static var nextPresets: [NewInquiryNextPreset] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = MeetingDates.zone
        func at(days: Int, hour: Int) -> Date {
            let day = calendar.date(byAdding: .day, value: days, to: Date()) ?? Date()
            return calendar.date(bySettingHour: hour, minute: 0, second: 0, of: day) ?? day
        }
        func inTwoHours() -> Date {
            let raw = Date().addingTimeInterval(2 * 3600)
            let minute = calendar.component(.minute, from: raw)
            return calendar.date(byAdding: .minute, value: (5 - minute % 5) % 5, to: raw) ?? raw
        }
        return [
            NewInquiryNextPreset(id: "2h", label: "Za 2 godz.", date: inTwoHours),
            NewInquiryNextPreset(id: "tomorrow", label: "Jutro 10:00", date: { at(days: 1, hour: 10) }),
            NewInquiryNextPreset(id: "3d", label: "Za 3 dni", date: { at(days: 3, hour: 10) }),
            NewInquiryNextPreset(id: "week", label: "Za tydzień", date: { at(days: 7, hour: 10) }),
        ]
    }

    /// Wartość szacunkowa jak na serwerze (`createInquiry`): bez spacji, pierwszy przecinek jako kropka, tylko cyfry, kropki
    /// i minusy; liczba nieujemna — inaczej brak wartości.
    static func estimatedValue(_ budget: String) -> Double? {
        var text = budget.filter { !$0.isWhitespace }
        if let comma = text.firstIndex(of: ",") { text.replaceSubrange(comma...comma, with: ".") }
        text = text.filter { ($0.isASCII && $0.isNumber) || $0 == "." || $0 == "-" }
        guard !text.isEmpty, let value = Double(text), value.isFinite, value >= 0 else { return nil }
        return value
    }

    /// Pola nowego kontaktu z wpisanej frazy i danych okna (formularz Kontaktów).
    func personPrefill(_ query: String) -> [String: String] {
        var values: [String: String] = [:]
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let digits = InquiryClientIndex.digits(text).count
        if text.contains("@") {
            values["email"] = text
        } else if digits >= 6 && digits * 2 >= text.filter({ !$0.isWhitespace }).count {
            values["mobile"] = text
        } else if !text.isEmpty {
            let words = text.split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }
            values["first_name"] = words.first ?? ""
            if words.count > 1 { values["last_name"] = words.dropFirst().joined(separator: " ") }
        }
        let phone = clientPhone.trimmingCharacters(in: .whitespacesAndNewlines)
        let email = clientEmail.trimmingCharacters(in: .whitespacesAndNewlines)
        if values["mobile"] == nil, !phone.isEmpty { values["mobile"] = phone }
        if values["email"] == nil, !email.isEmpty { values["email"] = email }
        return values
    }

    // MARK: Zapis

    /// „Zapisz zapytanie” — wynik albo `nil` (komunikat w oknie).
    func save() async -> NewInquiryCreated? {
        guard !saving else { return nil }
        error = nil
        if subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "Podaj temat zapytania."; return nil }
        let label = clientLabel
        if [label, clientPhone, clientEmail].allSatisfy({ $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) {
            error = "Podaj przynajmniej dane kontaktowe klienta (nazwa, telefon lub e-mail)."
            return nil
        }
        let guests = guestCount.trimmingCharacters(in: .whitespaces)
        if !guests.isEmpty {
            guard let count = Double(guests), count.rounded() == count, count >= 1, count <= 100_000 else {
                error = "Podaj całkowitą liczbę osób od 1 do 100 000 lub zostaw pole puste."
                return nil
            }
        }
        if let nextAction, nextAction < Date().addingTimeInterval(-60) {
            error = "Termin następnego działania jest w przeszłości — wybierz późniejszy albo zostaw automatyczny."
            return nil
        }
        guard let workspace, let api, workspace.employee != nil else { error = "Brak aktywnej sesji. Zaloguj się ponownie."; return nil }
        saving = true
        defer { saving = false }
        if let blocked = await workspace.prepareWrite() { error = blocked; return nil }
        var form: [String: JSONValue] = [
            "subject": .string(subject), "source": .string(source),
            "termin": .string(terminText), "dueDate": .string(hasTermin ? ISO8601DateFormatter().string(from: termin) : ""),
            "scope": .string(scope), "guestCount": .string(guests), "budget": .string(budget), "expectations": .string(expectations),
            "clientText": .string(label), "clientCompany": .string(clientCompany), "clientOrganizationId": .string(organizationID ?? ""),
            "clientContactId": .string(personID ?? ""), "clientPhone": .string(clientPhone), "clientEmail": .string(clientEmail),
            "locationText": .string(locationText), "locationId": .string(locationID ?? ""),
            "ownerId": .string(ownerID), "contacted": .bool(contacted),
        ]
        form["nextActionAt"] = nextAction.map { JSONValue.string(MeetingDates.iso($0)) } ?? JSONValue.string("")
        do {
            let data = try await api.post("/inquiries", ["op": .string("create"), "id": .string(inquiryID), "form": .object(form)])
            let reply = (try? JSONDecoder().decode([String: JSONValue].self, from: data)) ?? [:]
            let id = reply["id"]?.text.nonEmpty ?? inquiryID
            if reply["stage"] == nil {
                // Starszy serwer CRM: opiekun i rozmowa — czynnościami lejka (jak „Przejmij” i „Kontakt wykonany”).
                return await legacyFollowUp(id: id, api: api)
            }
            let owner = reply["ownerId"]?.text.nonEmpty
            let ownerName = reply["ownerName"]?.text ?? ""
            let automatic = reply["autoAssigned"]?.flag == true
            return NewInquiryCreated(id: id, ownerID: owner, message: message(owner: owner, ownerName: ownerName, automatic: automatic, contacted: contacted), warnings: [])
        } catch {
            if let failure = error as? NativeFailure { self.error = failure.message }
            else if error is URLError { self.error = "Brak połączenia z serwerem CRM. Spróbuj ponownie." }
            else { self.error = "Nieznany błąd" }
            return nil
        }
    }

    private func legacyFollowUp(id: String, api: NativeAPI) async -> NewInquiryCreated {
        var warnings: [String] = []
        var owner: String?
        var contactSaved = false
        if !ownerID.isEmpty {
            if ownerID == me {
                do {
                    _ = try await api.post("/inquiries", ["op": .string("claim"), "id": .string(id)])
                    owner = ownerID
                } catch {
                    warnings.append("Nie udało się przypisać zapytania do Ciebie (\(Self.failureText(error))) — przejmij je w lejku.")
                }
            } else {
                warnings.append("Opiekuna przypisz w lejku — ta wersja serwera CRM nie zapisuje go przy dodawaniu zapytania.")
            }
        }
        if contacted {
            do {
                _ = try await api.post("/inquiries", [
                    "op": .string("contact"), "id": .string(id),
                    "nextActionAt": nextAction.map { JSONValue.string(MeetingDates.iso($0)) } ?? JSONValue.null,
                ])
                contactSaved = true
            } catch {
                warnings.append("Nie udało się zapisać rozmowy z klientem (\(Self.failureText(error))) — oznacz kontakt w lejku.")
            }
        } else if nextAction != nil {
            warnings.append("Termin następnego działania ustaw w lejku — ta wersja serwera CRM nie zapisuje go przy dodawaniu zapytania.")
        }
        let ownerName = employees.first { $0.id == owner }?.name ?? ""
        return NewInquiryCreated(id: id, ownerID: owner, message: message(owner: owner, ownerName: ownerName, automatic: false, contacted: contactSaved), warnings: warnings)
    }

    private static func failureText(_ error: Error) -> String {
        if let failure = error as? NativeFailure { return failure.message }
        if error is URLError { return "brak połączenia z serwerem CRM" }
        return "błąd serwera"
    }

    private func message(owner: String?, ownerName: String, automatic: Bool, contacted: Bool) -> String {
        var text: String
        if owner == nil {
            text = "Zapytanie zostało dodane do wspólnej kolejki"
        } else if owner == me {
            text = "Zapytanie zostało dodane i przypisane do Ciebie"
        } else {
            let name = ownerName.isEmpty ? "wybrana osoba" : ownerName
            text = automatic ? "Zapytanie zostało dodane — przydział automatyczny: \(name)" : "Zapytanie zostało dodane — opiekun: \(name)"
        }
        if contacted { text += " · etap „Kontakt podjęty”" }
        if let nextAction { text += " · następne działanie \(InquiryFormat.short(nextAction))" }
        return text
    }
}

// MARK: Okno

/// Formularz Kontaktów otwarty z okna zapytania (nowa organizacja, osoba kontaktowa, osoba prywatna, osoba organizacji).
struct NewInquiryContactRequest: Identifiable {
    let id = UUID()
    let mode: ContactEditorMode
    let organizationID: String?
    let values: [String: String]
}

@MainActor struct NewInquirySheet: View {
    /// Po zapisie: identyfikator, opiekun i komunikat do pokazania.
    let onSaved: (NewInquiryCreated) -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @StateObject private var model: NewInquiryModel
    @FocusState private var focus: Field?
    @State private var clientOpen = false
    @State private var locationOpen = false
    @State private var peopleFilter = ""
    @State private var personEditor: NewInquiryContactRequest?
    @State private var organizationEditor: NewInquiryContactRequest?
    /// Ostatni wybór: zapytania od razu przypisane do mnie (zapamiętany w aplikacji).
    @AppStorage("inquiries.new.mine") private var ownerMine = false
    /// Po zapisie od razu karta zapytania („Obsługa zapytania”).
    @AppStorage("inquiries.new.openCard") private var openCard = false

    enum Field: Hashable { case subject, client, phone, email, location, guests, scope, budget, expectations }

    /// `initialDate` — dzień z kalendarza; `initialClient` — klient z karty kontaktu.
    init(initialDate: Date? = nil, initialClient: NewInquiryClient? = nil, onSaved: @escaping (NewInquiryCreated) -> Void) {
        self.onSaved = onSaved
        _model = StateObject(wrappedValue: NewInquiryModel(initialDate: initialDate, initialClient: initialClient))
    }

    private var canAddContacts: Bool {
        state.employee?.canView(.contacts) == true && (state.contacts.access?.canCreate ?? true)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "phone.arrow.down.left").foregroundStyle(theme.accent)
                    .frame(width: 34, height: 34).background(theme.accent.opacity(0.12), in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nowe zapytanie").font(.title2.bold())
                    Text("Trafi do lejka zapytań. Pola z gwiazdką są wymagane, resztę uzupełnisz później w karcie zapytania.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding([.horizontal, .top], 20).padding(.bottom, 8)
            form
            footer
        }
        .frame(minWidth: 640, idealWidth: 720, minHeight: 640, idealHeight: 860)
        .background(theme.page)
        .interactiveDismissDisabled(model.saving)
        .task {
            await model.load(state)
            if ownerMine, model.ownerOptions.contains(where: { $0.id == model.me }), let me = model.me { model.ownerID = me }
        }
        .task(id: model.terminText) { await model.loadSpecialDays() }
        .onChange(of: model.ownerID) { _, value in
            // Zapamiętujemy tylko „Ja” i „Wspólna kolejka” — przydział innej osobie jest jednorazowy.
            if value.isEmpty { ownerMine = false } else if value == model.me { ownerMine = true }
        }
        .onChange(of: focus) { _, next in
            // Lista podpowiedzi otwarta przy polu; przejście do innego pola ją zamyka (kliknięcie podpowiedzi — nie).
            if next == .client { clientOpen = true } else if next != nil { clientOpen = false }
            if next == .location { locationOpen = true } else if next != nil { locationOpen = false }
        }
        .onAppear { focus = .subject }
        .sheet(item: $personEditor) { request in
            PersonEditorSheet(store: state.contacts, mode: request.mode, initialValues: request.values, initialOrganizationID: request.organizationID) { id in
                Task {
                    await model.reloadAfterCreate()
                    if let organization = request.organizationID { model.pick(organizationID: organization) }
                    model.pick(personID: id)
                }
            }
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
        .sheet(item: $organizationEditor) { request in
            OrganizationEditorSheet(store: state.contacts, mode: request.mode, onCreated: { id in
                Task {
                    await model.reloadAfterCreate()
                    model.pick(organizationID: id)
                }
            }, initialValues: request.values)
            .environmentObject(state).environment(\.crmTheme, state.theme).tint(state.theme.accent)
        }
    }

    private var form: some View {
        Form {
            Section {
                TextField("Temat zapytania *", text: $model.subject, prompt: Text("Np. oprawa techniczna wesela 12.09.2027"))
                    .focused($focus, equals: .subject)
                Picker("Źródło zapytania", selection: $model.source) {
                    ForEach(NewInquiryModel.sources, id: \.0) { Text($0.1).tag($0.0) }
                }
                terminRow
            }
            Section {
                if model.hasClient { selectedClient } else { clientSearch }
                TextField("Telefon", text: $model.clientPhone, prompt: Text("+48...")).focused($focus, equals: .phone)
                TextField("E-mail", text: $model.clientEmail, prompt: Text("klient@example.com")).focused($focus, equals: .email)
                clientHints
                existingInquiries
                locationField
            } header: {
                Text("Klient")
            }
            Section {
                TextField("Liczba osób — opcjonalnie", text: $model.guestCount, prompt: Text("Nie ustalono")).focused($focus, equals: .guests)
                TextField("Zakres", text: $model.scope, prompt: Text("Np. nagłośnienie, DJ, konferansjer..."), axis: .vertical)
                    .lineLimit(2...5).focused($focus, equals: .scope)
                VStack(alignment: .leading, spacing: 4) {
                    TextField("Budżet", text: $model.budget, prompt: Text("Np. 10 000 zł netto")).focused($focus, equals: .budget)
                    budgetHint
                }
                TextField("Oczekiwania", text: $model.expectations, prompt: Text("Co jest najważniejsze dla klienta?"), axis: .vertical)
                    .lineLimit(3...8).focused($focus, equals: .expectations)
            } header: {
                Text("Szczegóły")
            }
            handlingSection
        }
        .formStyle(.grouped)
        .disabled(model.saving)
    }

    // MARK: Termin

    @ViewBuilder private var terminRow: some View {
        if model.hasTermin {
            HStack {
                DatePicker("Termin", selection: $model.termin, displayedComponents: [.date, .hourAndMinute])
                    .environment(\.timeZone, MeetingDates.zone)
                Button { model.hasTermin = false } label: { Image(systemName: "xmark.circle") }
                    .buttonStyle(.borderless).help("Usuń termin")
            }
            EventSpecialDaysNotice(days: model.specialDays)
        } else {
            LabeledContent("Termin") {
                Button("Ustaw termin") {
                    model.termin = EventFormDates.suggestedStart
                    model.hasTermin = true
                }
            }
        }
    }

    // MARK: Klient — wyszukiwanie

    private var clientSearch: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Klient", text: Binding(get: { model.clientText }, set: { value in
                model.clientText = value
                clientOpen = true
            }), prompt: Text("Szukaj organizacji lub osoby — nazwa, nazwisko, e-mail, telefon"))
            .focused($focus, equals: .client)
            let query = model.clientText.trimmingCharacters(in: .whitespacesAndNewlines)
            if clientOpen && !query.isEmpty {
                let found = model.index.search(query)
                suggestions {
                    if !found.organizations.isEmpty {
                        suggestionHeader("Organizacje")
                        ForEach(found.organizations) { organization in
                            suggestion(organization.name, detail: organization.detail, symbol: "building.2") {
                                model.pick(organization: organization)
                                clientOpen = false
                                peopleFilter = ""
                            }
                        }
                    }
                    if !found.people.isEmpty {
                        suggestionHeader("Osoby")
                        ForEach(found.people) { person in
                            suggestion(person.name, detail: person.detail, symbol: person.individual ? "person.crop.circle" : "person") {
                                model.pick(person: person)
                                clientOpen = false
                                peopleFilter = ""
                            }
                        }
                    }
                    if found.organizations.isEmpty && found.people.isEmpty {
                        Text(model.indexReady
                             ? "Nie ma takiego klienta w kontaktach. Zapisz zapytanie z wpisaną nazwą albo dodaj klienta."
                             : "Wczytywanie kontaktów…")
                            .font(.caption).foregroundStyle(.secondary)
                            .padding(.horizontal, 10).padding(.vertical, 8)
                    }
                }
            }
            HStack(spacing: 8) {
                if !model.indexReady {
                    ProgressView().controlSize(.small)
                    Text("Wczytywanie kontaktów…").font(.caption).foregroundStyle(.secondary)
                } else if query.isEmpty {
                    Text("Wybierz organizację albo osobę z kontaktów — albo wpisz nazwę klienta spoza bazy.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if canAddContacts { addClientMenu(query: query) }
            }
        }
    }

    private func addClientMenu(query: String) -> some View {
        Menu {
            Button { Task { await openOrganizationEditor(query: query) } } label: { Label("Organizacja…", systemImage: "building.2") }
            Button { Task { await openPersonEditor(kind: .contact, organizationID: nil, query: query) } } label: {
                Label("Osoba kontaktowa (firma)…", systemImage: "person")
            }
            Button { Task { await openPersonEditor(kind: .individual, organizationID: nil, query: query) } } label: {
                Label("Osoba prywatna…", systemImage: "person.crop.circle")
            }
        } label: {
            Label("Dodaj klienta", systemImage: "plus")
        }
        .menuStyle(.borderlessButton).fixedSize()
        .help("Nowy klient w kontaktach — po zapisie będzie od razu wybrany")
    }

    /// Formularze Kontaktów potrzebują kopii listy kontaktów (wybór organizacji, sprawdzenie duplikatu).
    private func prepareContacts() async {
        if state.contacts.contacts.isEmpty { await state.contacts.backgroundSync() }
    }
    private func openPersonEditor(kind: ContactKind, organizationID: String?, query: String) async {
        await prepareContacts()
        personEditor = NewInquiryContactRequest(mode: .create(kind), organizationID: organizationID, values: model.personPrefill(query))
    }
    private func openOrganizationEditor(query: String) async {
        await prepareContacts()
        let name = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let values: [String: String] = name.isEmpty || name.contains("@") || InquiryClientIndex.digits(name).count >= 6 ? [:] : ["name": name]
        organizationEditor = NewInquiryContactRequest(mode: .create(.organization), organizationID: nil, values: values)
    }

    // MARK: Klient — wybrany

    @ViewBuilder private var selectedClient: some View {
        if model.organizationID != nil {
            VStack(alignment: .leading, spacing: 10) {
                clientCard(symbol: "building.2", title: model.organizationName.isEmpty ? "Organizacja" : model.organizationName,
                           detail: model.organization?.detail ?? "")
                organizationPeople
            }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                clientCard(symbol: model.person?.individual == true ? "person.crop.circle" : "person",
                           title: model.personName.isEmpty ? "Osoba" : model.personName, detail: model.person?.detail ?? "")
                personOrganizations
            }
        }
    }

    private func clientCard(symbol: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).font(.title3).foregroundStyle(theme.accent)
                .frame(width: 32, height: 32).background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).textSelection(.enabled)
                if !detail.isEmpty { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            Spacer()
            Button("Zmień klienta") {
                model.clearClient()
                peopleFilter = ""
                focus = .client
                clientOpen = true
            }
            .controlSize(.small)
        }
    }

    /// Osoby kontaktowe wybranej organizacji: wybór jednym kliknięciem, „Dodaj osobę do …”, „Bez osoby kontaktowej”.
    private var organizationPeople: some View {
        let people = model.organizationPeople
        let words = InquiryClientIndex.words(peopleFilter)
        let shown = words.isEmpty ? people : people.filter { InquiryClientIndex.matches(words, text: "\($0.name) \($0.position) \($0.email)", phone: $0.phone) }
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Osoba kontaktowa").font(.callout.weight(.medium))
                Spacer()
                if people.count > 6 {
                    TextField("Filtruj osoby", text: $peopleFilter).textFieldStyle(.roundedBorder).frame(maxWidth: 180).controlSize(.small)
                }
            }
            if people.isEmpty {
                Text(model.indexReady ? "W tej organizacji nie ma jeszcze osób w kontaktach." : "Wczytywanie osób…")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(shown) { person in personRow(person) }
                    }
                }
                .frame(maxHeight: people.count > 5 ? 230 : nil)
            }
            HStack(spacing: 8) {
                if model.personID != nil {
                    Button("Bez osoby kontaktowej") { model.clearPerson() }.controlSize(.small)
                }
                Spacer()
                if canAddContacts, let organization = model.organizationID {
                    Button {
                        Task { await openPersonEditor(kind: .contact, organizationID: organization, query: "") }
                    } label: {
                        Label("Dodaj osobę do \(model.organizationName)…", systemImage: "person.badge.plus")
                    }
                    .controlSize(.small)
                }
            }
            if model.personID == nil && !people.isEmpty {
                Text("Wybierz osobę, z którą rozmawiasz — jej telefon i e-mail trafią do zapytania.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func personRow(_ person: InquiryClientPerson) -> some View {
        let selected = model.personID == person.id
        let link = model.link(of: person.id)
        return Button { model.choose(person: person) } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? theme.accent : Color.secondary).padding(.top, 1)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(person.name).fontWeight(selected ? .semibold : .regular)
                        if link?.primary == true { badge("główny kontakt") }
                        if link?.decisionMaker == true { badge("decyzyjna") }
                    }
                    let details = [person.position, person.phone, person.email].filter { !$0.isEmpty }.joined(separator: " · ")
                    if !details.isEmpty { Text(details).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8).padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.accent.opacity(0.1) : Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func badge(_ text: String) -> some View {
        Text(text).font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
            .background(theme.accent.opacity(0.14), in: Capsule()).foregroundStyle(theme.accent)
    }

    /// Wybrana osoba bez organizacji: jej obecne organizacje do wyboru (zapytanie dotyczy firmy) albo „Bez organizacji”.
    @ViewBuilder private var personOrganizations: some View {
        let links = model.person?.organizations ?? []
        if !links.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("Pracuje w").font(.callout.weight(.medium))
                ForEach(links) { link in
                    Button { model.chooseOrganization(link) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: "building.2").foregroundStyle(.secondary)
                            Text(link.name)
                            if !link.position.isEmpty { Text(link.position).font(.caption).foregroundStyle(.secondary) }
                            Spacer()
                            Text("Wybierz").font(.caption).foregroundStyle(theme.accent)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 6)
                        .background(Color.primary.opacity(0.03), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Text("Zapytanie od firmy? Wybierz organizację — osoba zostanie jej osobą kontaktową. Bez wyboru zapytanie dotyczy samej osoby.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: Klient — podpowiedzi

    @ViewBuilder private var clientHints: some View {
        let recognized = model.recognizedPeople
        if !recognized.isEmpty {
            let title: String = recognized.count == 1 ? "Ten telefon lub e-mail jest już w kontaktach" : "Ten telefon lub e-mail ma kilka kontaktów"
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: "person.crop.circle.badge.checkmark")
                    .font(.callout).foregroundStyle(theme.accent)
                ForEach(recognized) { person in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(person.name)
                            if !person.detail.isEmpty { Text(person.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                        }
                        Spacer()
                        Button("Wybierz") { model.pick(person: person, keepOrganization: model.organizationID != nil && model.link(of: person.id) != nil) }
                            .controlSize(.small)
                    }
                }
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        } else if model.createsContactFromOrganization {
            Label("Bez osoby kontaktowej CRM utworzy z tego telefonu lub e-maila nowy kontakt o nazwie organizacji. Wybierz osobę albo dodaj ją do organizacji.",
                  systemImage: "exclamationmark.triangle")
                .font(.caption).foregroundStyle(.orange).fixedSize(horizontal: false, vertical: true)
        } else if model.organizationID != nil && model.personID == nil
                    && model.clientPhone.trimmingCharacters(in: .whitespaces).isEmpty
                    && model.clientEmail.trimmingCharacters(in: .whitespaces).isEmpty {
            Label("Zapytanie bez telefonu i e-maila trafi do lejka z ostrzeżeniem „Brak danych kontaktowych”.", systemImage: "info.circle")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    /// Otwarte zapytania tego klienta w lejku — żeby nie zakładać drugiej sprawy dla tej samej rozmowy.
    @ViewBuilder private var existingInquiries: some View {
        let existing = model.openInquiries(state.inquiries.inquiries)
        if !existing.isEmpty {
            let title: String = existing.count == 1 ? "Ten klient ma już otwarte zapytanie" : "Ten klient ma już otwarte zapytania (\(existing.count))"
            VStack(alignment: .leading, spacing: 6) {
                Label(title, systemImage: "exclamationmark.bubble")
                    .font(.callout).foregroundStyle(.orange)
                ForEach(existing.prefix(4)) { inquiry in
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(inquiry.titleLabel.isEmpty ? inquiry.title : inquiry.titleLabel).lineLimit(1)
                            Text([inquiry.inquiryStage.label, inquiry.ownerName.isEmpty ? "bez opiekuna" : inquiry.ownerName,
                                  "dodane \(InquiryFormat.short(inquiry.created))"].joined(separator: " · "))
                                .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer()
                        Button("Otwórz") {
                            dismiss()
                            state.showInquiryWorkspace(inquiry.id)
                        }
                        .controlSize(.small)
                    }
                }
                Text("Jeśli to ta sama sprawa, dopisz ustalenia w istniejącym zapytaniu zamiast zakładać nowe.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            .padding(10).frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: Lokalizacja

    private var locationField: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Lokalizacja", text: Binding(get: { model.locationText }, set: { value in
                model.typeLocation(value)
                locationOpen = true
            }), prompt: Text("Wyszukaj z bazy lub wpisz..."))
            .focused($focus, equals: .location)
            let locations = model.filteredLocations
            if locationOpen && !locations.isEmpty {
                suggestions {
                    ForEach(locations) { location in
                        let detail = [location.address, location.city].filter { !$0.isEmpty }.joined(separator: ", ")
                        suggestion(location.name, detail: detail, symbol: "mappin.and.ellipse") {
                            model.pick(location)
                            locationOpen = false
                        }
                    }
                }
            }
        }
    }

    // MARK: Szczegóły

    @ViewBuilder private var budgetHint: some View {
        if !model.budget.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            if let value = NewInquiryModel.estimatedValue(model.budget) {
                Text("Wartość szacunkowa w lejku: \(InquiryFormat.money(value))").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("Kwota nierozpoznana — budżet zostanie zapisany jako tekst, wartość szacunkową uzupełnisz w zapytaniu.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: Prowadzenie

    private var handlingSection: some View {
        Section {
            let owners = model.ownerOptions
            if !owners.isEmpty {
                Picker("Opiekun", selection: $model.ownerID) {
                    Text("Wspólna kolejka — bez opiekuna").tag("")
                    ForEach(owners) { person in Text(person.name).tag(person.id) }
                }
            }
            Toggle(isOn: Binding(get: { model.contacted }, set: { model.setContacted($0) })) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Rozmowa z klientem już się odbyła")
                    Text(model.contacted
                         ? "Zapytanie trafi do etapu „Kontakt podjęty” z dzisiejszą datą kontaktu — bez przypomnienia o pierwszym kontakcie."
                         : "Zapytanie trafi do etapu „Nowe” — CRM przypomni o pierwszym kontakcie z klientem.")
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
            }
            nextActionRow
        } header: {
            Text("Prowadzenie")
        }
    }

    @ViewBuilder private var nextActionRow: some View {
        if let next = model.nextAction {
            HStack {
                DatePicker("Następne działanie", selection: Binding(get: { next }, set: { model.nextAction = $0 }),
                           displayedComponents: [.date, .hourAndMinute])
                    .environment(\.timeZone, MeetingDates.zone)
                Button { model.nextAction = nil } label: { Image(systemName: "xmark.circle") }
                    .buttonStyle(.borderless).help("Termin automatyczny")
            }
        } else {
            LabeledContent("Następne działanie") {
                Text(model.contacted ? "automatycznie — według ustawień SLA" : "automatycznie — za 2 godz.")
                    .foregroundStyle(.secondary)
            }
        }
        HStack(spacing: 6) {
            ForEach(NewInquiryModel.nextPresets) { preset in
                Button(preset.label) { model.nextAction = preset.date() }
                    .buttonStyle(.bordered).controlSize(.small)
            }
            Spacer()
        }
    }

    // MARK: Listy podpowiedzi

    private func suggestions<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) { content() }
        }
        .frame(maxHeight: 280)
        .background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.2)))
    }

    private func suggestionHeader(_ title: String) -> some View {
        Text(title).font(.caption).foregroundStyle(theme.accent.opacity(0.8))
            .padding(.horizontal, 10).padding(.vertical, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.08))
    }

    private func suggestion(_ title: String, detail: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol).foregroundStyle(.secondary).frame(width: 16)
                Text(title).lineLimit(1)
                if !detail.isEmpty { Text(detail).foregroundStyle(.secondary).lineLimit(1) }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10).padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Stopka

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Toggle("Po zapisie otwórz kartę zapytania", isOn: $openCard).toggleStyle(.checkbox)
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction).disabled(model.saving)
                Button {
                    Task {
                        if let created = await model.save() {
                            let openAfter = openCard
                            dismiss()
                            onSaved(created)
                            if openAfter { state.showInquiryWorkspace(created.id) }
                        }
                    }
                } label: {
                    HStack(spacing: 6) {
                        if model.saving { ProgressView().controlSize(.small) }
                        Text(model.saving ? "Zapisywanie…" : "Zapisz zapytanie")
                    }
                }
                .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                .disabled(model.saving)
            }
        }
        .padding(16)
    }
}

import SwiftUI

// MARK: Wystawianie faktury — dane formularza z `/bridge/native/v1/finance` (`src/lib/native/financeInvoiceForm.ts`) i wyliczenia
// jak w `/crm/invoices/new`: wartości pozycji (netto × ilość, VAT zaokrąglany jak w CRM), pozycja zbiorcza, procent pro formy
// i zaliczki, termin płatności w dniach kalendarzowych.

/// Skąd otwarto formularz (adres `/crm/invoices/new?…` w CRM).
enum InvoiceFormRequest: Identifiable, Equatable {
    /// Nowa faktura danego typu, opcjonalnie dla wydarzenia (`?event=`).
    case new(type: String, eventID: String?)
    /// Korekta wskazanej faktury (`?type=corrective&related=`).
    case corrective(relatedID: String)
    /// Kolejna faktura zaliczkowa do zamówienia (`?type=advance&advanceFrom=`).
    case nextAdvance(sourceID: String)

    var id: String {
        switch self {
        case .new(let type, let eventID): return "new-\(type)-\(eventID ?? "")"
        case .corrective(let id): return "corrective-\(id)"
        case .nextAdvance(let id): return "advance-\(id)"
        }
    }
}

/// Pozycja formularza (zwykła albo z dokumentu źródłowego).
struct InvoiceFormItem: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var unit: String
    var quantity: Double
    var priceNet: Double
    var vatRate: Double
    var vatCode: String
    var exemption: String

    enum CodingKeys: String, CodingKey { case name, unit, quantity, priceNet, vatRate, vatCode, exemption }

    init(name: String = "", unit: String = "szt.", quantity: Double = 1, priceNet: Double = 0, vatCode: String = "23", exemption: String = "") {
        self.name = name; self.unit = unit; self.quantity = quantity; self.priceNet = priceNet
        self.vatCode = vatCode; self.vatRate = InvoiceMath.rate(vatCode); self.exemption = exemption
    }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        unit = try c.decodeIfPresent(String.self, forKey: .unit) ?? "szt."
        quantity = try c.decodeIfPresent(Double.self, forKey: .quantity) ?? 0
        priceNet = try c.decodeIfPresent(Double.self, forKey: .priceNet) ?? 0
        vatRate = try c.decodeIfPresent(Double.self, forKey: .vatRate) ?? 0
        vatCode = try c.decodeIfPresent(String.self, forKey: .vatCode) ?? "23"
        exemption = try c.decodeIfPresent(String.self, forKey: .exemption) ?? ""
    }
    var json: JSONValue {
        .object(["name": .string(name), "unit": .string(unit), "quantity": .number(quantity), "priceNet": .number(priceNet),
                 "vatCode": .string(vatCode), "exemption": .string(exemption)])
    }
}

/// Odbiorca na fakturze i w KSeF (`InvoiceRecipientDraft`): ten sam co nabywca, organizacja CRM albo dane ręczne.
struct InvoiceRecipientDraft: Codable, Equatable {
    struct Fields: Codable, Equatable {
        var name = ""
        var nip = ""
        var internalId = ""
        var street = ""
        var postalCode = ""
        var city = ""
        var countryCode = "PL"
        /// 2 — jednostka wewnętrzna nabywcy (IDWew), 8 — jednostka podrzędna JST (własny NIP).
        var role = 2
        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
            nip = try c.decodeIfPresent(String.self, forKey: .nip) ?? ""
            internalId = try c.decodeIfPresent(String.self, forKey: .internalId) ?? ""
            street = try c.decodeIfPresent(String.self, forKey: .street) ?? ""
            postalCode = try c.decodeIfPresent(String.self, forKey: .postalCode) ?? ""
            city = try c.decodeIfPresent(String.self, forKey: .city) ?? ""
            countryCode = try c.decodeIfPresent(String.self, forKey: .countryCode) ?? "PL"
            role = (try? c.decodeIfPresent(Int.self, forKey: .role)) ?? 2
        }
    }
    var mode = "same_as_buyer"
    var organizationId = ""
    var data = Fields()

    static let same = InvoiceRecipientDraft()
    static func organization(_ id: String = "", role: Int = 2) -> InvoiceRecipientDraft {
        var draft = InvoiceRecipientDraft()
        draft.mode = "organization"; draft.organizationId = id; draft.data.role = role
        return draft
    }
    var json: JSONValue {
        .object([
            "mode": .string(mode), "organizationId": .string(organizationId),
            "data": .object([
                "name": .string(data.name), "nip": .string(data.nip), "internalId": .string(data.internalId), "street": .string(data.street),
                "postalCode": .string(data.postalCode), "city": .string(data.city), "countryCode": .string(data.countryCode), "role": .number(Double(data.role)),
            ]),
        ])
    }

    /// Sprawdzenie odbiorcy jak `validateInvoiceRecipientDraft` (serwer sprawdza ponownie).
    var errors: [String] {
        if mode == "same_as_buyer" { return [] }
        var found: [String] = []
        if mode == "organization" && organizationId.count != 36 { found.append("Wybierz organizację odbiorcy lub wpisz jego dane ręcznie.") }
        let fields: [(String, String)] = [(data.name, "nazwę"), (data.street, "adres"), (data.postalCode, "kod pocztowy"), (data.city, "miejscowość")]
        for (value, label) in fields where value.trimmingCharacters(in: .whitespaces).isEmpty { found.append("Uzupełnij \(label) odbiorcy.") }
        let country = data.countryCode.trimmingCharacters(in: .whitespaces).uppercased()
        if country.range(of: "^[A-Z]{2}$", options: .regularExpression) == nil && !["POLSKA", "POLAND"].contains(country) {
            found.append("Podaj dwuliterowy kod kraju odbiorcy, np. PL.")
        }
        let nip = InvoiceMath.digitsNip(data.nip)
        if data.role == 8 {
            if !InvoiceMath.validNip(nip) { found.append("Jednostka podrzędna JST musi mieć poprawny własny NIP — bez niego KSeF nie przypisze jej faktury.") }
            if !["PL", "POLSKA", "POLAND"].contains(country) { found.append("Jednostka podrzędna JST musi mieć kod kraju PL.") }
            return found
        }
        if !nip.isEmpty && !InvoiceMath.validNip(nip) { found.append("Sprawdź NIP odbiorcy — wymagany jest poprawny polski NIP albo puste pole.") }
        let internal = data.internalId.trimmingCharacters(in: .whitespaces)
        if !internal.isEmpty {
            let prefix = String(internal.prefix(10))
            if internal.range(of: "^\\d{10}-\\d{5}$", options: .regularExpression) == nil || !InvoiceMath.validNip(prefix) {
                found.append("Numer wewnętrzny odbiorcy musi mieć postać poprawny NIP–5 cyfr, np. 5252228219-00145.")
            } else if !nip.isEmpty && prefix != nip {
                found.append("NIP odbiorcy musi być zgodny z NIP-em w jego numerze wewnętrznym.")
            }
        }
        return found
    }
}

/// Nabywca po korekcie danych (ten sam podatnik — NIP bez zmian).
struct InvoiceCorrectedBuyer: Codable, Equatable {
    var source = "organization"
    var organizationId = ""
    var name = ""
    var nip = ""
    var street = ""
    var postalCode = ""
    var city = ""
    var countryCode = "PL"
    var json: JSONValue {
        .object(["source": .string(source), "organizationId": .string(organizationId), "name": .string(name), "nip": .string(nip),
                 "street": .string(street), "postalCode": .string(postalCode), "city": .string(city), "countryCode": .string(countryCode)])
    }
    /// Porównanie przed / po (nazwa, NIP, adres, kraj).
    var comparable: [String] {
        [name.trimmingCharacters(in: .whitespaces), InvoiceMath.normalizeNip(nip), street.trimmingCharacters(in: .whitespaces),
         postalCode.trimmingCharacters(in: .whitespaces), city.trimmingCharacters(in: .whitespaces), countryCode.trimmingCharacters(in: .whitespaces)]
    }
}

struct InvoicePrivateBuyer: Codable, Equatable {
    var firstName = ""
    var lastName = ""
    var street = ""
    var postalCode = ""
    var city = ""
    var email = ""
    var phone = ""
    var json: JSONValue {
        .object(["firstName": .string(firstName), "lastName": .string(lastName), "street": .string(street), "postalCode": .string(postalCode),
                 "city": .string(city), "email": .string(email), "phone": .string(phone)])
    }
}

struct InvoiceFormBuyer: Decodable, Equatable {
    var organizationId: String
    var name: String
    var nip: String
    var street: String
    var postalCode: String
    var city: String
    var country: String
    var email: String
    var phone: String
    var privatePerson: Bool
}

struct InvoiceFormEvent: Decodable, Equatable, Identifiable {
    var id: String
    var name: String
    var date: String?
    var companyId: String
    var organizationId: String
    var contactPersonId: String
    var billingArrangement: String
    var billingOrganizationId: String
}

struct InvoiceBuyerLink: Decodable, Equatable {
    struct Buyer: Decodable, Equatable { var id: String; var name: String; var alias: String; var nip: String; var address: String; var postalCode: String; var city: String }
    var unitOrganizationId: String
    var role: Int
    var buyer: Buyer
}

struct InvoiceSettlementGroup: Decodable, Equatable {
    struct Member: Decodable, Equatable, Identifiable { var id: String; var name: String; var date: String? }
    var id: String
    var name: String
    var primaryEventId: String
    var events: [Member]
}

struct InvoiceItemSource: Decodable, Equatable, Identifiable {
    var id: String
    var label: String
    var items: [InvoiceFormItem]
    var net: Double
    var gross: Double
    var discount: Double
    var notice: String
}

struct InvoiceFormSetup: Decodable {
    struct Company: Decodable, Identifiable, Equatable {
        var id: String; var name: String; var legalName: String; var nip: String; var isDefault: Bool; var footer: String; var missing: [String]
    }
    struct Organization: Decodable, Identifiable, Equatable {
        var id: String; var name: String; var nip: String; var street: String; var postalCode: String; var city: String
        var country: String; var clientType: String; var email: String; var phone: String
        var address: String { [street, [postalCode, city].filter { !$0.isEmpty }.joined(separator: " ")].filter { !$0.isEmpty }.joined(separator: ", ") }
    }
    struct Individual: Decodable, Identifiable, Equatable {
        var id: String; var firstName: String; var lastName: String; var name: String; var email: String; var phone: String
        var street: String; var postalCode: String; var city: String
    }
    struct Correctable: Decodable, Identifiable, Equatable {
        var id: String; var number: String; var type: String; var issueDate: String?; var gross: Double; var buyerName: String; var companyId: String
    }
    struct Advance: Decodable {
        var error: String?
        var sourceId: String?
        var sourceNumber: String?
        var currency: String?
        var reservedGross: Double?
        var remainingGross: Double?
        var orderGross: Double?
        var orderItems: [InvoiceFormItem]?
        var orderToken: String?
        var companyId: String?
        var eventId: String?
        var billingArrangement: String?
        var serviceRecipientOrganizationId: String?
        var serviceRecipientContactId: String?
        var recipient: InvoiceRecipientDraft?
        var recipientError: String?
        var buyer: InvoiceFormBuyer?
        var privateBuyer: InvoicePrivateBuyer?
        var individualId: String?
        var saleDate: String?
    }
    var scope: String
    var companies: [Company]
    var defaultCompanyId: String
    var paymentMethod: String
    var organizations: [Organization]
    var organizationsError: String?
    var individuals: [Individual]
    var correctable: [Correctable]
    var advance: Advance?
}

struct InvoiceEventContext: Decodable {
    struct Parties: Decodable {
        var billingArrangement: String
        var buyerId: String
        var serviceRecipientOrganizationId: String
        var serviceRecipientContactId: String
        var recipient: InvoiceRecipientDraft
        var recipientError: String?
    }
    struct Company: Decodable { var companyId: String; var message: String? }
    struct Sources: Decodable { var choices: [InvoiceItemSource]; var preferredId: String; var warning: String; var eventName: String }
    var event: InvoiceFormEvent?
    var buyerLink: InvoiceBuyerLink?
    var settlementGroup: InvoiceSettlementGroup?
    var parties: Parties?
    var company: Company?
    var itemSources: Sources?
    var itemSourcesError: String?
}

/// Faktura korygowana: strony, numer KSeF, pozycje „przed”.
struct InvoiceOriginal: Decodable {
    struct Item: Decodable, Equatable, Identifiable {
        var position: Int
        var name: String
        var unit: String
        var vatRate: Double
        var vatCode: String
        var exemption: String
        var beforeQuantity: Double
        var beforePriceNet: Double
        var beforeNet: Double
        var beforeVat: Double
        var beforeGross: Double
        var id: Int { position }
    }
    struct Totals: Decodable { var net: Double; var vat: Double; var gross: Double }
    var id: String
    var number: String
    var type: String
    var status: String
    var proforma: Bool
    var issueDate: String?
    var saleDate: String?
    var companyId: String
    var eventId: String
    var event: InvoiceFormEvent?
    var billingArrangement: String
    var serviceRecipientOrganizationId: String
    var serviceRecipientContactId: String
    var currency: String
    var buyer: InvoiceFormBuyer
    var privateBuyer: InvoicePrivateBuyer
    var correctedBuyer: InvoiceCorrectedBuyer
    var recipient: InvoiceRecipientDraft?
    var recipientError: String?
    var ksefNumber: String?
    var wasInKsef: Bool
    var totals: Totals
    var items: [Item]
}

/// Pozycja korekty: „przed” z faktury pierwotnej, „po” do edycji.
struct InvoiceCorrectionLine: Identifiable, Equatable {
    var before: InvoiceOriginal.Item
    var afterQuantity: Double
    var afterPriceNet: Double
    var id: Int { before.position }
}

struct InvoiceRecipientOrganization: Decodable, Identifiable, Equatable {
    var id: String; var name: String; var nip: String; var city: String
}

// MARK: Słowniki i wyliczenia

enum InvoiceFormText {
    static let types: [(String, String)] = [("vat", "Faktura VAT"), ("proforma", "Proforma"), ("advance", "Zaliczkowa"), ("corrective", "Korygująca")]
    static func title(_ type: String, nextAdvance: Bool) -> String {
        if nextAdvance { return "Kolejna faktura zaliczkowa" }
        switch type {
        case "proforma": return "Wystaw proformę"
        case "advance": return "Wystaw fakturę zaliczkową"
        case "corrective": return "Wystaw fakturę korygującą"
        default: return "Wystaw fakturę VAT"
        }
    }
    static func numberType(_ type: String) -> String {
        switch type { case "proforma": return "Proforma"; case "advance": return "Zaliczkowa"; case "corrective": return "Korygująca"; default: return "VAT" }
    }
    static let paymentMethods = ["Przelew", "Gotówka", "Karta", "BLIK"]
    static let units = ["szt.", "godz.", "usł.", "m", "m2", "kg"]
    /// Stawki jak w CRM; „0” i „np” są tylko podpowiedzią — trzeba wybrać właściwy rodzaj.
    static let vatCodes: [(String, String, Bool)] = [
        ("23", "23%", true), ("8", "8%", true), ("5", "5%", true), ("0", "0% — wybierz właściwy rodzaj", false),
        ("0 KR", "0% — sprzedaż krajowa", true), ("0 WDT", "0% — WDT", true), ("0 EX", "0% — eksport", true), ("zw", "zw. — zwolniona", true),
        ("np", "np. — wybierz właściwy rodzaj", false), ("np I", "np I — poza terytorium kraju", true),
        ("np II", "np II — art. 100 ust. 1 pkt 4 VAT", true), ("oo", "oo — odwrotne obciążenie", true),
    ]
    static let arrangements: [(String, String)] = [
        ("direct", "Klient wydarzenia — rozliczenie bezpośrednie"), ("hotel", "Hotel"), ("agency", "Agencja lub pośrednik"), ("other", "Inna organizacja"),
    ]
    static func arrangementDescription(_ value: String) -> String {
        switch value {
        case "hotel": return "Hotel będzie nabywcą i płatnikiem faktury. Klient oraz wydarzenie pozostaną powiązane w CRM."
        case "agency": return "Agencja lub pośrednik będzie nabywcą faktury. Klient oraz wydarzenie pozostaną powiązane w CRM."
        case "other": return "Inna organizacja będzie nabywcą faktury. Klient oraz wydarzenie pozostaną powiązane w CRM."
        default: return "Nabywcą faktury jest klient przypisany do wydarzenia."
        }
    }
    static let correctionTypes: [(Int, String)] = [
        (1, "Korekta skutkująca w dacie ujęcia faktury pierwotnej"), (2, "Korekta skutkująca w dacie wystawienia faktury korygującej"),
        (3, "Inna data lub różne daty dla pozycji korekty"),
    ]
    static func correctableType(_ type: String) -> String {
        switch type { case "advance": return "Zaliczkowa"; case "vat": return "VAT"; default: return type }
    }
    /// Data „rrrr-mm-dd” jak `toLocaleDateString('pl-PL')`: dzień bez zera wiodącego, miesiąc z zerem.
    static func plDate(_ raw: String?) -> String {
        guard let raw, !raw.isEmpty else { return "—" }
        let parts = raw.prefix(10).split(separator: "-")
        guard parts.count == 3, let dayNumber = Int(parts[2]) else { return raw }
        return "\(dayNumber).\(parts[1]).\(parts[0])"
    }
}

enum InvoiceMath {
    /// `Math.round` z JavaScriptu (połówki w górę, także dla liczb ujemnych).
    static func jsRound(_ value: Double) -> Double { (value + 0.5).rounded(.down) }
    /// `Number(x.toFixed(2))`: najbliższa wartość w groszach, przy równej odległości — większa.
    static func fixed2(_ value: Double) -> Double {
        let scaled = value * 100
        let lower = scaled.rounded(.down)
        let fraction = scaled - lower
        if abs(fraction - 0.5) < 1e-9 { return (lower + 1) / 100 }
        return scaled.rounded(.toNearestOrAwayFromZero) / 100
    }
    static func round2(_ value: Double) -> Double { fixed2(value) }
    /// Stawka liczbowa z kodu: 23 / 8 / 5, pozostałe 0.
    static func rate(_ code: String) -> Double { ["23", "8", "5"].contains(code) ? Double(code) ?? 0 : 0 }
    /// Wartości pozycji jak `calculateItemValues`: netto = ilość × cena, VAT = round(netto × stawka) / 100, brutto = suma.
    static func values(quantity: Double, priceNet: Double, rate: Double) -> (net: Double, vat: Double, gross: Double) {
        let net = fixed2(quantity * priceNet)
        let vat = fixed2(jsRound(net * rate) / 100)
        return (net, vat, fixed2(net + vat))
    }
    static func values(_ item: InvoiceFormItem) -> (net: Double, vat: Double, gross: Double) {
        values(quantity: item.quantity, priceNet: item.priceNet, rate: item.vatRate)
    }
    static func totals(_ items: [InvoiceFormItem]) -> (net: Double, vat: Double, gross: Double) {
        var net = 0.0, vat = 0.0, gross = 0.0
        for item in items {
            let v = values(item)
            net += v.net; vat += v.vat; gross += v.gross
        }
        return (net, vat, gross)
    }
    static func netFromGross(_ gross: Double, _ rate: Double) -> Double { round2(gross / (1 + rate / 100)) }
    static func grossFromNet(_ net: Double, _ rate: Double) -> Double { round2(net * (1 + rate / 100)) }
    static func percentItems(_ items: [InvoiceFormItem], _ percent: Double) -> [InvoiceFormItem] {
        items.map { item in
            var copy = item
            copy.priceNet = round2(item.priceNet * percent / 100)
            return copy
        }
    }
    /// Błąd pozycji zbiorczej (`getCombinedItemsError`).
    static func combinedError(_ items: [InvoiceFormItem]) -> String? {
        guard let first = items.first else { return "Dodaj przynajmniej jedną pozycję stanowiącą podstawę kwoty." }
        if Set(items.map { "\($0.vatCode)|\($0.vatRate)|\($0.exemption)" }).count > 1 {
            return "Jedna pozycja zbiorcza nie może łączyć różnych stawek lub podstaw VAT. Zachowaj pozycje szczegółowe."
        }
        let source = totals(items)
        let combinedVat = round2(round2(source.net) * first.vatRate / 100)
        if abs(combinedVat - round2(source.vat)) > 0.001 {
            return "Scalenie zmieniłoby VAT przez zaokrąglenia. Zachowaj pozycje szczegółowe, aby nie zmienić uzgodnionej kwoty."
        }
        return nil
    }
    /// Termin płatności: data wystawienia + pełne dni (`getInvoicePaymentDueDate`).
    static func dueDate(issue: String, days: String) -> String? {
        let input = days.trimmingCharacters(in: .whitespaces)
        guard input.range(of: "^\\d+$", options: .regularExpression) != nil, let count = Int(input), count >= 0, count < 3_000_000,
              let start = FinanceText.dayDate(issue), FinanceText.dayString(start) == issue,
              let date = MeetingDates.calendar.date(byAdding: .day, value: count, to: start) else { return nil }
        return FinanceText.dayString(date)
    }
    static func normalizeNip(_ value: String) -> String {
        var text = value.trimmingCharacters(in: .whitespaces)
        if text.uppercased().hasPrefix("PL") { text = String(text.dropFirst(2)) }
        return text.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
    }
    static func digitsNip(_ value: String) -> String { normalizeNip(value) }
    static func validNip(_ value: String) -> Bool {
        let digits = value.compactMap(\.wholeNumberValue)
        guard value.count == 10, digits.count == 10 else { return false }
        let weights = [6, 5, 7, 2, 3, 4, 5, 6, 7]
        return zip(weights, digits).reduce(0) { $0 + $1.0 * $1.1 } % 11 == digits[9]
    }
    /// Kwota z pola tekstowego (przecinek lub kropka).
    static func number(_ text: String) -> Double? {
        Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "").replacingOccurrences(of: ",", with: "."))
    }
    static func plain(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }
    static func money(_ value: Double, _ currency: String) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "pl_PL")
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = 2
        formatter.maximumFractionDigits = 2
        return (formatter.string(from: NSNumber(value: value)) ?? String(format: "%.2f", value)) + " " + (currency == "PLN" ? "zł" : currency)
    }
}

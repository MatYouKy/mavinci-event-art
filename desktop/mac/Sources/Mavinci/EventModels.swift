import Foundation

struct EventRoute { let id: String; let origin: Module?; var tab: String? = nil }

/// Zakładki karty wydarzenia jak `EVENT_TAB_LABELS` / `normalizeEventTabId` w CRM (adresy `?tab=…` z powiadomień, linków i starszych ustawień).
enum EventCardTabID {
    static let all = ["overview", "details", "equipment", "logistics", "team", "phases", "agenda", "subcontractors", "files", "tasks",
                      "mavinci-live", "offer", "calculations", "contract", "seller-arrangements", "finances", "summary", "history"]
    static func normalize(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespaces).lowercased(), !value.isEmpty else { return nil }
        switch value {
        case "warehouse", "steps": return "overview"
        case "timeline": return "phases"
        case "settlement", "commissions": return "summary"
        // Starsze nazwy z aplikacji na Maca i powiadomień.
        case "wedding": return "agenda"
        case "seller": return "seller-arrangements"
        case "live": return "mavinci-live"
        case "checklist": return "equipment"
        case "fleet": return "logistics"
        default: return all.contains(value) ? value : nil
        }
    }
}
enum EventTab: String, CaseIterable, Identifiable, Codable {
    case overview, phases, offer, agenda, wedding, finances, calculations, contract, equipment, team, logistics, subcontractors, files, tasks, history, seller = "seller-arrangements", live = "mavinci-live"
    var id: String { rawValue }
    var title: String {
        switch self {
        case .seller: return "Ustalenia sprzedawcy"
        case .overview: return "Informacje"
        case .phases: return "Etapy"
        case .offer: return "Oferty"
        case .agenda: return "Agenda"
        case .wedding: return "Karta wesela"
        case .finances: return "Finanse"
        case .calculations: return "Kalkulacje"
        case .contract: return "Umowy"
        case .equipment: return "Sprzęt i magazyn"
        case .team: return "Zespół"
        case .logistics: return "Logistyka"
        case .subcontractors: return "Podwykonawcy"
        case .files: return "Pliki"
        case .tasks: return "Zadania"
        case .history: return "Historia"
        case .live: return "Mavinci LIVE"
        }
    }
    var symbol: String {
        switch self {
        case .seller: return "bubble.left.and.bubble.right"
        case .overview: return "info.circle"
        case .phases: return "chart.bar.xaxis"
        case .offer: return "doc.text"
        case .agenda: return "list.bullet.rectangle"
        case .wedding: return "heart"
        case .finances: return "banknote"
        case .calculations: return "function"
        case .contract: return "signature"
        case .equipment: return "shippingbox"
        case .team: return "person.2"
        case .logistics: return "truck.box"
        case .subcontractors: return "person.crop.rectangle.badge.checkmark"
        case .files: return "folder"
        case .tasks: return "checklist"
        case .history: return "clock.arrow.circlepath"
        case .live: return "play.rectangle"
        }
    }
}
extension EventTab {
    /// Zakładka natywnej karty (`EVENT_TAB_IDS` w CRM).
    var cardTabID: String {
        switch self {
        case .wedding: return "agenda"
        case .seller: return "seller-arrangements"
        case .live: return "mavinci-live"
        default: return rawValue
        }
    }
}
struct EventAccess: Codable, Equatable {
    var tabs: [EventTab]
    var manage: Bool
    var finance: [String: JSONValue]
    var operationalOnly: Bool
    var workflow: [String:JSONValue]?
    var assignment: Row?
    var canManageCosts: Bool { finance["canManageCosts"]?.flag == true }
    var canViewCosts: Bool { finance["canViewCosts"]?.flag == true }
    var canViewCommercials: Bool { finance["canViewCommercials"]?.flag ?? (finance["canViewCosts"]?.flag == true) }
}
struct EventPageCache: Codable {
    var event: Row
    var access: EventAccess
    var sections: [String: [Row]] = [:]
    var sectionErrors: [String:String]?
    var loadedTabs: [String] = []
    var loadedAt = Date()
}
struct EventSection: Identifiable {
    let id: String
    let title: String
    var rows: [Row]
    var error: String?
}

struct EventField: Identifiable {
    enum Kind { case text, multiline, date, day, time, decimal, integer, choice([String]), lookup(String), toggle }
    let id: String
    let label: String
    var kind: Kind = .text
    var required = false
}
struct EventForm: Identifiable {
    let id = UUID()
    let title: String
    let table: String
    let fields: [EventField]
    var record: Row?
    var fixed: [String: JSONValue] = [:]
}

enum EventSchema {
    static let overviewFields: [EventField] = [
        .init(id:"name",label:"Nazwa",required:true), .init(id:"description",label:"Opis",kind:.multiline),
        .init(id:"event_date",label:"Początek",kind:.date,required:true), .init(id:"event_end_date",label:"Koniec",kind:.date),
        .init(id:"location",label:"Miejsce"), .init(id:"purchase_order_number",label:"Numer zamówienia klienta")
    ]
    static let phaseFields: [EventField] = [
        .init(id:"name",label:"Nazwa",required:true), .init(id:"description",label:"Opis",kind:.multiline),
        .init(id:"start_time",label:"Początek",kind:.date,required:true), .init(id:"end_time",label:"Koniec",kind:.date,required:true),
        .init(id:"notes",label:"Uwagi",kind:.multiline)
    ]
    static let taskFields: [EventField] = [
        .init(id:"title",label:"Tytuł",required:true), .init(id:"description",label:"Opis",kind:.multiline),
        .init(id:"priority",label:"Priorytet",kind:.choice(Labels.priorities),required:true),
        .init(id:"board_column",label:"Etap",kind:.choice(Labels.taskStages),required:true), .init(id:"due_date",label:"Termin",kind:.date)
    ]
    static let agendaFields: [EventField] = [
        .init(id:"time",label:"Godzina",kind:.time,required:true), .init(id:"title",label:"Tytuł",required:true),
        .init(id:"description",label:"Opis",kind:.multiline), .init(id:"order_index",label:"Kolejność",kind:.integer,required:true)
    ]
    static let agendaHeaderFields: [EventField] = [.init(id:"event_name",label:"Nazwa na agendzie",required:true),.init(id:"event_date",label:"Data",kind:.day,required:true),.init(id:"client_contact",label:"Kontakt do klienta")]
    static let noteFields: [EventField] = [.init(id:"content",label:"Treść",kind:.multiline,required:true),.init(id:"order_index",label:"Kolejność",kind:.integer,required:true)]
    static let costFields: [EventField] = [
        .init(id:"name",label:"Nazwa kosztu",required:true), .init(id:"description",label:"Opis",kind:.multiline),
        .init(id:"amount",label:"Kwota (zł)",kind:.decimal,required:true),.init(id:"cost_date",label:"Data kosztu",kind:.day,required:true),
        .init(id:"category_id",label:"Kategoria",kind:.lookup("event_cost_categories"),required:true),.init(id:"payment_method",label:"Sposób płatności",kind:.choice(["transfer","cash","card","other"]),required:true)
    ]
    static let teamFields: [EventField] = [.init(id:"employee_id",label:"Pracownik",kind:.lookup("employees"),required:true),.init(id:"role",label:"Rola w wydarzeniu"),.init(id:"responsibilities",label:"Obowiązki",kind:.multiline)]
    static let assignmentFields: [EventField] = [.init(id:"role",label:"Rola w wydarzeniu"),.init(id:"responsibilities",label:"Obowiązki",kind:.multiline)]
    static func editForm(section: String, row: Row, page: EventPageCache) -> EventForm? {
        guard page.access.manage || (section == "event_costs" && page.access.canManageCosts) else { return nil }
        switch section {
        case "event_phases": return EventForm(title:"Edytuj etap",table:section,fields:phaseFields,record:row)
        case "event_agenda_items": return EventForm(title:"Edytuj punkt agendy",table:section,fields:agendaFields,record:row)
        case "event_agenda_notes": return EventForm(title:"Edytuj notatkę agendy",table:section,fields:noteFields,record:row)
        case "tasks": return EventForm(title:"Edytuj zadanie wydarzenia",table:section,fields:taskFields,record:row)
        case "employee_assignments": return EventForm(title:"Edytuj obowiązki",table:section,fields:assignmentFields,record:row)
        case "event_costs" where page.access.canManageCosts && row["status"] == "pending": return EventForm(title:"Edytuj planowany koszt",table:section,fields:costFields,record:row)
        default: return nil
        }
    }
    static let labels: [String:String] = [
        "realization":"Realizacja","handoff":"Przygotowanie magazynowe","manager_name":"Kierownik realizacji","started_at":"Przejęto realizację","completed_at":"Zakończono realizację","completion_notes":"Uwagi po realizacji","accepted_by_name":"Magazynier","accepted_at":"Przejęto przygotowanie","ready_at":"Gotowość","ready_by_name":"Gotowość potwierdził(a)",
        "expected_profit":"Planowany zysk","actual_profit":"Rzeczywisty zysk","actual_revenue":"Rzeczywisty przychód","estimated_costs":"Planowane koszty","actual_costs":"Rzeczywiste koszty","profit_margin_expected":"Planowana marża (%)","profit_margin_actual":"Rzeczywista marża (%)","invoices_count":"Liczba faktur","invoices_paid_count":"Opłacone faktury","invoices_total":"Wartość faktur","costs_count":"Liczba kosztów","costs_paid_count":"Opłacone koszty","costs_total":"Wartość kosztów","cash_budget":"Budżet gotówkowy","actual_cash_revenue":"Przychód gotówkowy","is_cash_only":"Rozliczenie gotówkowe",
        "enabled":"Włączono","order_reference":"Numer zamówienia partnera","include_contract":"Dołącz umowę","partner_name":"Sprzedawca","brand_name":"Marka","task_name":"Nazwa zlecenia","name":"Nazwa","title":"Tytuł","description":"Opis","content":"Treść","notes":"Uwagi","status":"Stan","role":"Rola","responsibilities":"Obowiązki",
        "event_date":"Początek wydarzenia","event_end_date":"Koniec wydarzenia","start_time":"Początek","end_time":"Koniec","time":"Godzina","order_index":"Kolejność","sequence_order":"Kolejność",
        "created_at":"Utworzono","updated_at":"Zmieniono","due_date":"Termin","priority":"Priorytet","board_column":"Etap","location":"Miejsce","location_text":"Adres miejsca",
        "planned_setup_at":"Planowany montaż","planned_teardown_at":"Planowany demontaż","purchase_order_number":"Numer zamówienia klienta","billing_arrangement":"Sposób rozliczenia",
        "first_name":"Imię","last_name":"Nazwisko","surname":"Nazwisko","phone":"Telefon","phone_number":"Telefon","mobile":"Telefon komórkowy","email":"E-mail","company_name":"Firma","alias":"Nazwa skrócona","nip":"NIP","address":"Adres","city":"Miejscowość","formatted_address":"Adres",
        "offer_number":"Numer oferty","total_amount":"Wartość brutto","subtotal":"Wartość netto","tax_amount":"VAT","discount_amount":"Rabat","tax_percent":"VAT (%)","discount_percent":"Rabat (%)","valid_until":"Ważność oferty","guest_count":"Liczba gości","unit_price":"Cena jednostkowa","quantity":"Liczba","days":"Dni","unit":"Jednostka",
        "budget":"Budżet","expected_revenue":"Planowany przychód","amount":"Kwota","revenue":"Przychód","total_revenue":"Przychód łącznie","total_costs":"Koszty łącznie","profit":"Zysk","profit_margin":"Marża (%)","total_paid":"Zapłacono łącznie","balance":"Saldo","cost_date":"Data kosztu","cost_type":"Rodzaj kosztu","payment_status":"Stan płatności","agreed_cost":"Uzgodniony koszt","total_cost":"Całkowity koszt","payment_due_date":"Termin płatności",
        "registration_number":"Numer rejestracyjny","brand":"Marka","model":"Model","departure_location":"Miejsce wyjazdu","departure_time":"Wyjazd","arrival_time":"Przyjazd","return_departure_time":"Wyjazd powrotny","return_arrival_time":"Powrót","purpose":"Cel","is_external":"Transport zewnętrzny","external_company_name":"Firma zewnętrzna",
        "is_loaded":"Załadowano","loaded":"Załadowano","loading_confirmed":"Potwierdzono załadunek","loading_locked":"Załadunek zablokowany","loading_notes":"Uwagi do załadunku","equipment_checklist_notes":"Uwagi do sprzętu","item_name":"Nazwa pozycji","is_completed":"Wykonano","completed":"Wykonano",
        "invitation_status":"Odpowiedź na zaproszenie","assignment_start":"Przypisanie od","assignment_end":"Przypisanie do","assigned_start":"Zasób od","assigned_end":"Zasób do","responded_at":"Odpowiedź z dnia",
        "mime_type":"Format pliku","file_size":"Rozmiar (bajty)","original_name":"Nazwa pliku","document_type":"Rodzaj dokumentu","folder":"Folder","pdf_url":"Dokument PDF","generated_pdf_path":"Dokument PDF","modified_after_generation":"Zmieniono po wygenerowaniu",
        "action":"Czynność","field_name":"Zmienione pole","user_name":"Autor","old_value":"Poprzednia wartość","new_value":"Nowa wartość",
        "invoice_number":"Numer faktury","issue_date":"Data wystawienia","paid_amount":"Zapłacono","remaining_amount":"Pozostało","total_gross":"Kwota brutto","total_net":"Kwota netto",
        "beneficiary_name":"Beneficjent","rate":"Stawka","base_amount":"Podstawa","company_cost_amount":"Koszt firmy","calculation_type":"Sposób naliczenia","payment_method":"Sposób płatności",
        "scheduled_at":"Termin","category":"Kategoria","responsible_person":"Odpowiedzialna osoba","is_confirmed":"Potwierdzono","side":"Strona","artist":"Wykonawca","list_type":"Lista muzyczna","attraction_name":"Atrakcja","choice":"Wybór","section":"Sekcja","field_key":"Pole karty","value":"Odpowiedź","progress":"Uzupełnienie (%)",
        "module_key":"Moduł","enabled_modules":"Włączone moduły","version":"Wersja","can_view":"Podgląd","can_edit":"Edycja","can_run":"Uruchamianie","can_admin":"Administracja","valid_from":"Dostęp od",
        "equipment":"Sprzęt","kit":"Zestaw","equipment_items":"Sprzęt","equipment_kits":"Zestaw","employee":"Pracownik","driver":"Kierowca","vehicle":"Pojazd","contact":"Osoba kontaktowa","organization":"Organizacja","category_info":"Kategoria","creator":"Autor","subcontractor":"Podwykonawca","subcontractors":"Podwykonawca","location_info":"Miejsce"
    ]
    static let stateFields: Set<String> = ["status","priority","board_column","invitation_status","payment_status","billing_arrangement","cost_type","calculation_type","payment_method","side","role","list_type","choice","action","document_type","module_key"]
    static let moneyFields: Set<String> = ["expected_profit","actual_profit","actual_revenue","estimated_costs","actual_costs","invoices_total","costs_total","cash_budget","actual_cash_revenue","total_revenue","amount","total_amount","subtotal","tax_amount","discount_amount","unit_price","budget","expected_revenue","agreed_cost","total_cost","paid_amount","remaining_amount","total_gross","total_net","base_amount","company_cost_amount"]
    static func summary(_ row: Row) -> String {
        if !row.title.isEmpty { return row.title }
        for key in ["equipment","kit","employee","vehicle","subcontractor","subcontractors","equipment_items","equipment_kits"] {
            let nested = row.fields[key]?.object ?? [:]
            let title = nested["name"]?.text ?? nested["company_name"]?.text ?? ""
            let surname = nested["surname"]?.text ?? ""
            if !title.isEmpty { return [title,surname].filter { !$0.isEmpty }.joined(separator:" ") }
        }
        return [row["task_name"],row["offer_number"],row["content"],row["item_name"],row["description"],row["attraction_name"],row["user_name"]].first { !$0.isEmpty } ?? "Pozycja"
    }
}

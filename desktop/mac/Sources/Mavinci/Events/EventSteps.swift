import SwiftUI

// MARK: Kroki realizacji — model i reguły jak `src/lib/events/steps/eventSteps.ts` (wspólne z aplikacją w telefonie).
// Stan kroków zmienia wyłącznie baza (RPC `update_event_step` / `add_event_step`); tu tylko etykiety i to, które przyciski pokazać.

struct EventStepAssignee: Codable, Hashable { var id: String?; var name: String?; var phone: String? }
struct EventStepBlocker: Codable, Hashable { var key: String; var title: String; var owner_role: String }
struct EventStepHistory: Codable, Hashable { var action: String; var to_status: String?; var note: String?; var by: String?; var at: String }

struct EventStep: Codable, Hashable, Identifiable {
    var id: String
    var key: String
    var stage: String
    var kind: String
    var source: String?
    var title: String
    var details: String?
    var quantity: Double?
    var unit: String?
    var supplier: String?
    var owner_role: String
    var due_at: String?
    var status: String
    var status_note: String?
    var ordered_at: String?
    var expected_at: String?
    var completed_at: String?
    var completed_by_name: String?
    var blocks_ready: Bool?
    var is_mine: Bool?
    var completed_by_me: Bool?
    var assignee: EventStepAssignee?
    var blocked_by: [EventStepBlocker]?
    var overdue: Bool?
    var can_act: Bool?
    var can_override: Bool?
    var system_managed: Bool?
    var history: [EventStepHistory]?

    var mine: Bool { is_mine == true }
    var blockers: [EventStepBlocker] { blocked_by ?? [] }
    var live: Bool { ["open", "in_progress", "problem"].contains(status) }
    var isOverdue: Bool { overdue == true }
}

struct EventStepProgress: Codable, Hashable { var total: Int; var done: Int }

struct EventStepsSnapshot: Codable, Hashable {
    var my_roles: [String: Bool]?
    var can_override: Bool?
    var can_add: Bool?
    var steps: [EventStep]
    var waiting_for: [EventStep]?
    var progress: [String: EventStepProgress]?
    var show_commercial: Bool?
}

enum EventStepRules {
    static let roles: [String: String] = [
        "sales": "Sprzedawca", "warehouse": "Magazyn", "manager": "Kierownik realizacji", "driver": "Kierowca",
        "admin": "Administrator", "author": "Prowadzący wydarzenie",
    ]
    static let stages: [(String, String)] = [
        ("formalities", "Formalności"), ("handoff", "Przekazanie"), ("preparation", "Przygotowanie i zamówienia"),
        ("dispatch", "Wydanie sprzętu"), ("realization", "Realizacja"), ("return", "Zwrot sprzętu"), ("settlement", "Rozliczenie"),
    ]
    static let statuses: [String: String] = [
        "open": "Do zrobienia", "in_progress": "W toku", "done": "Zrobione", "problem": "Problem", "skipped": "Pominięte", "archived": "Archiwum",
    ]
    static let kinds: [String: String] = [
        "handoff": "Przekazanie", "order": "Zamówienie", "stock_check": "Sprawdzenie stanu",
        "venue_confirmation": "Potwierdzenie z klientem / obiektem", "task": "Zadanie", "approval": "Potwierdzenie",
    ]
    static let manualRoles = ["warehouse", "sales", "manager", "driver", "admin"]
    static let manualKinds = ["task", "order", "stock_check", "venue_confirmation"]
    static let blockingRoles: Set<String> = ["warehouse", "sales", "manager"]
    static let defaultHour = 10

    private static let processKeys: Set<String> = [
        "warehouse_accept", "warehouse_ready", "manager_appointed", "dispatch_out", "return_handover", "return_check", "realization_start",
        "realization_complete", "settlement_invoice", "settlement_paid", "settlement_summary", "settlement_summary_approval", "formal_details",
        "formal_contract", "formal_deposit", "wedding_card", "team_ready", "agenda_ready", "transport_planned",
    ]
    static let targetTab: [String: String] = [
        "formal_details": "details", "formal_contract": "contract", "formal_deposit": "finances", "wedding_card": "agenda",
        "team_ready": "team", "agenda_ready": "agenda", "transport_planned": "logistics", "manager_appointed": "team",
        "dispatch_out": "equipment", "warehouse_ready": "equipment", "return_handover": "equipment", "return_check": "equipment",
        "settlement_invoice": "finances", "settlement_paid": "finances", "settlement_summary": "summary", "settlement_summary_approval": "summary",
    ]
    private static let contextLabels: [String: String] = [
        "dispatch_out": "Checklista: wydanie", "return_handover": "Checklista: załadunek powrotny", "return_check": "Checklista: zwrot",
        "wedding_card": "Karta weselna",
    ]
    static let tabLabels: [String: String] = [
        "overview": "Przegląd", "details": "Szczegóły", "equipment": "Sprzęt", "logistics": "Logistyka", "team": "Zespół", "phases": "Harmonogram",
        "agenda": "Agenda", "subcontractors": "Podwykonawcy", "files": "Pliki", "tasks": "Zadania", "offer": "Oferta", "calculations": "Kalkulacje",
        "contract": "Umowa", "seller-arrangements": "Ustalenia", "finances": "Finanse", "summary": "Podsumowanie", "history": "Historia",
    ]
    static let tabSymbols: [String: String] = [
        "details": "info.circle", "contract": "doc.text", "finances": "wallet.pass", "summary": "checklist.checked", "agenda": "list.clipboard",
        "team": "person.2", "logistics": "truck.box", "equipment": "shippingbox",
    ]

    /// Kolor statusu: neutral / progress / success / danger / muted / warning (jak `eventStepTone`).
    static func tone(_ step: EventStep) -> String {
        if step.status == "problem" { return "danger" }
        if step.status == "done" { return "success" }
        if step.status == "skipped" || step.status == "archived" { return "muted" }
        if step.isOverdue { return "warning" }
        if step.status == "in_progress" { return "progress" }
        return step.blockers.isEmpty ? "neutral" : "muted"
    }
    static func chip(_ tone: String) -> (Color, Color) {
        switch tone {
        case "progress": return (CrmTheme.rgb(0x38bdf8).opacity(0.15), CrmTheme.rgb(0xbae6fd))
        case "success": return (CrmTheme.rgb(0x34d399).opacity(0.15), CrmTheme.rgb(0xa7f3d0))
        case "danger": return (CrmTheme.rgb(0xef4444).opacity(0.2), CrmTheme.rgb(0xfecaca))
        case "muted": return (Color.primary.opacity(0.05), Color.secondary)
        case "warning": return (CrmTheme.rgb(0xfbbf24).opacity(0.15), CrmTheme.rgb(0xfde68a))
        default: return (Color.primary.opacity(0.1), Color.primary.opacity(0.85))
        }
    }
    static func rowFill(_ tone: String) -> Color {
        switch tone {
        case "progress": return CrmTheme.rgb(0x38bdf8).opacity(0.06)
        case "danger": return CrmTheme.rgb(0xef4444).opacity(0.08)
        case "warning": return CrmTheme.rgb(0xfbbf24).opacity(0.07)
        case "neutral": return Color.primary.opacity(0.04)
        default: return Color.primary.opacity(0.025)
        }
    }

    /// Przyciski kroku w kolejności interfejsu (`eventStepAvailableActions`).
    static func actions(_ step: EventStep) -> [String] {
        var result: [String] = []
        if step.live && step.can_act == true {
            if step.system_managed != true { result.append("done") }
            if step.source != "system" && step.status != "in_progress" { result.append("start") }
            if !step.mine { result.append("take") }
            result.append("problem")
        }
        if step.live && step.can_override == true { result.append("skip") }
        let reopenable = step.status == "skipped" || (step.status == "done" && !processKeys.contains(step.key))
        if reopenable && (step.can_override == true || step.completed_by_me == true) { result.append("reopen") }
        return result
    }
    static func primary(_ step: EventStep, _ actions: [String]) -> String? {
        if step.kind == "order" && actions.contains("start") { return "start" }
        if actions.contains("done") { return "done" }
        if actions.contains("start") { return "start" }
        if actions.contains("take") { return "take" }
        return nil
    }
    static func blocked(_ step: EventStep, _ action: String) -> Bool { (action == "done" || action == "start") && !step.blockers.isEmpty }

    private static let primaryLabels: [String: String] = [
        "sales_handoff": "Przekazane do magazynu", "warehouse_accept": "Przyjmuję do przygotowania", "warehouse_ready": "Gotowe do wydania",
        "dispatch_out": "Wydane — załadunek zgodny", "dispatch_receive": "Odebrane — zgodne z listą", "realization_start": "Przejmuję realizację",
        "realization_complete": "Zakończ z raportem", "return_handover": "Oddane do magazynu", "return_check": "Zwrot przyjęty — OK",
        "client_requirements": "Potwierdzone",
    ]
    private static let kindDone: [String: String] = [
        "order": "Dostarczone", "stock_check": "Sprawdzone — OK", "venue_confirmation": "Potwierdzone", "handoff": "Przekazane",
        "task": "Zrobione", "approval": "Potwierdzone",
    ]
    static func actionLabel(_ step: EventStep, _ action: String) -> String {
        switch action {
        case "done": return primaryLabels[step.key] ?? kindDone[step.kind] ?? "Gotowe"
        case "start": return step.kind == "order" ? "Zamówione" : "Rozpoczynam"
        case "take": return "Biorę to"
        case "problem": return "Zgłoś problem"
        case "reopen": return "Otwórz ponownie"
        case "skip": return "Pomiń"
        default: return action
        }
    }
    static let successMessages: [String: String] = [
        "take": "Krok jest teraz przypisany do Ciebie.", "start": "Zapisano rozpoczęcie kroku.", "done": "Krok zamknięty.",
        "problem": "Zgłoszono problem. Kierownik i prowadzący dostaną powiadomienie.", "reopen": "Krok otwarty ponownie.", "skip": "Krok pominięty.",
    ]

    struct NoteRule { var required: Bool; var minLength: Int; var label: String; var placeholder: String }
    static func noteRule(_ step: EventStep, _ action: String) -> NoteRule? {
        if action == "problem" { return NoteRule(required: true, minLength: 5, label: "Opis problemu", placeholder: "Co się stało, ile brakuje, co proponujesz") }
        if action == "skip" { return NoteRule(required: true, minLength: 5, label: "Powód pominięcia", placeholder: "Dlaczego ten krok nie jest potrzebny") }
        if action == "reopen" { return NoteRule(required: true, minLength: 1, label: "Powód ponownego otwarcia", placeholder: "Co trzeba poprawić") }
        if action == "done" && step.key == "realization_complete" {
            return NoteRule(required: true, minLength: 5, label: "Raport z realizacji", placeholder: "Przebieg, dodatkowe godziny, uwagi klienta, szkody")
        }
        if action == "start" && step.kind == "order" { return NoteRule(required: false, minLength: 0, label: "Notatka do zamówienia", placeholder: "Numer zamówienia, ustalenia") }
        if action == "done" || action == "start" { return NoteRule(required: false, minLength: 0, label: "Notatka (opcjonalnie)", placeholder: "Z kim, kiedy, co ustalono") }
        return nil
    }
    static func needsOrderFields(_ step: EventStep, _ action: String) -> Bool { action == "start" && step.kind == "order" }
    static func needsForm(_ step: EventStep, _ action: String) -> Bool { noteRule(step, action)?.required == true || needsOrderFields(step, action) }

    private static func pad(_ value: Int) -> String { value < 10 ? "0\(value)" : "\(value)" }
    static func date(_ iso: String?) -> String {
        guard let iso, let date = MeetingDates.parse(iso) else { return "" }
        let c = MeetingDates.calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        return "\(pad(c.day ?? 0)).\(pad(c.month ?? 0)).\(c.year ?? 0), \(pad(c.hour ?? 0)):\(pad(c.minute ?? 0))"
    }
    /// „do 12.11.2026, 10:00”, „dziś do 10:00”, „po terminie 2 dni” (`eventStepDueLabel`).
    static func dueLabel(_ step: EventStep, now: Date = Date()) -> String {
        guard let iso = step.due_at, let due = MeetingDates.parse(iso) else { return "" }
        if !step.live { return "termin \(date(iso))" }
        let diff = due.timeIntervalSince(now)
        if diff < 0 {
            let days = Int(floor(-diff / 86_400)), hours = Int(floor(-diff / 3_600))
            if days >= 1 { return "po terminie \(days) \(days == 1 ? "dzień" : "dni")" }
            return hours >= 1 ? "po terminie \(hours) godz." : "termin minął"
        }
        if MeetingDates.calendar.isDate(due, inSameDayAs: now) {
            let c = MeetingDates.calendar.dateComponents([.hour, .minute], from: due)
            return "dziś do \(pad(c.hour ?? 0)):\(pad(c.minute ?? 0))"
        }
        return "do \(date(iso))"
    }
    static func ownerLabel(_ step: EventStep) -> String {
        let role = roles[step.owner_role] ?? step.owner_role
        if let name = step.assignee?.name, !name.isEmpty { return "\(name) · \(role)" }
        return "\(role) (nieprzypisane)"
    }
    static func quantityLabel(_ step: EventStep) -> String {
        guard let value = step.quantity else { return "" }
        let text: String
        if value.rounded() == value { text = String(Int(value)) } else {
            var fixed = String(format: "%.2f", value)
            while fixed.hasSuffix("0") { fixed.removeLast() }
            text = fixed.replacingOccurrences(of: ".", with: ",")
        }
        return step.unit.map { "\(text) \($0)" } ?? text
    }
    private static let historyActions: [String: String] = [
        "add": "dodano krok", "take": "przejęto krok", "start": "rozpoczęto", "done": "zamknięto", "problem": "zgłoszono problem",
        "reopen": "otwarto ponownie", "skip": "pominięto", "auto_done": "zamknięto automatycznie", "auto_reopen": "otwarto ponownie w procesie",
    ]
    static func historyLabel(_ entry: EventStepHistory) -> String {
        [date(entry.at), entry.by ?? "", historyActions[entry.action] ?? "zmiana kroku"].filter { !$0.isEmpty }.joined(separator: " · ")
    }
    /// Zakładka, w której zamyka się krok (kroki magazynu: braki, wynajem, sprawdzenia → Sprzęt).
    static func contextLink(_ key: String) -> (tab: String, label: String)? {
        var tab = targetTab[key]
        if tab == nil {
            let prefix = key.split(separator: ":").first.map(String.init) ?? key
            if ["shortage", "rental", "check"].contains(prefix) { tab = "equipment" }
        }
        guard let tab else { return nil }
        guard let label = contextLabels[key] ?? tabLabels[tab] else { return nil }
        return (tab, label)
    }
    static func telURL(_ phone: String?) -> URL? {
        let digits = (phone ?? "").filter { $0 == "+" || $0.isNumber }
        return digits.count >= 6 ? URL(string: "tel:\(digits)") : nil
    }
    /// ISO z lokalnej daty i godziny (godzina domyślna 10:00, jak `localPartsToIso`).
    static func iso(day: Date, time: Date?) -> String {
        let calendar = MeetingDates.calendar
        var c = calendar.dateComponents([.year, .month, .day], from: day)
        if let time {
            let t = calendar.dateComponents([.hour, .minute], from: time)
            c.hour = t.hour; c.minute = t.minute
        } else { c.hour = defaultHour; c.minute = 0 }
        return MeetingDates.iso(calendar.date(from: c) ?? day)
    }
}

// MARK: Przegląd — kontrola przed wydarzeniem i „Najważniejsze”

struct EventPreflightIssue: Codable, Hashable { var code: String; var label: String; var severity: String; var tab: String }
struct EventPreflight: Codable, Hashable {
    var event_date: String?
    var ready: Bool?
    var accepted_employee_conflicts: Int?
    var issues: [EventPreflightIssue]?
}
struct EventHandoff: Codable, Hashable { var accepted_at: String?; var accepted_by_name: String?; var ready_at: String?; var ready_by_name: String? }
struct EventVehicleFact: Codable, Hashable, Identifiable { var id: String; var label: String; var driver: String? }
struct EventKeyFacts: Codable, Hashable {
    var loadingAt: String?
    var managerName: String?
    var operationalStatus: String?
    var handoff: EventHandoff?
    var handoffKnown: Bool
    var canContactWarehouse: Bool
    var canPrepareWarehouse: Bool
    var vehicles: [EventVehicleFact]?
}
struct EventOnsiteContact: Codable, Hashable {
    var source: String?
    var name: String?
    var role: String?
    var phone: String?
    var notes: String?
    var is_primary: Bool?
    var displayName: String { name?.trimmingCharacters(in: .whitespaces).nonEmpty ?? "Osoba kontaktowa" }
    var sourceLabel: String { ["client": "Klient", "venue": "Obiekt"][source ?? ""] ?? "Wydarzenie" }
}
struct EventOnsite: Codable, Hashable { var contacts: [EventOnsiteContact]; var error: Bool? }
struct EventStepsState: Codable, Hashable { var snapshot: EventStepsSnapshot?; var hidden: Bool?; var unavailable: Bool?; var error: Bool? }
struct EventCardOverview: Codable, Hashable {
    var steps: EventStepsState
    var preflight: EventPreflight?
    var facts: EventKeyFacts
    var onsite: EventOnsite
    var equipmentCount: Int?
}

/// Pomoc kroków (`EVENT_STEPS_HELP` z serwera — ta sama treść co w CRM i w telefonie).
struct EventStepsHelpSection: Codable, Hashable, Identifiable {
    struct Step: Codable, Hashable { var title: String; var how: String }
    var role: String
    var title: String
    var summary: String
    var responsibilities: [String]
    var steps: [Step]
    var closeScope: [String]
    var notYours: String
    var id: String { role }
}

struct EventStepsHelp: Codable, Hashable {
    var help: [EventStepsHelpSection]
    var rules: [String]?

    /// Najpierw role osoby na tym wydarzeniu, potem pozostałe (`eventStepsHelpForRoles`).
    func ordered(_ myRoles: [String: Bool]?) -> (mine: [EventStepsHelpSection], others: [EventStepsHelpSection]) {
        func has(_ role: String) -> Bool { myRoles?[role] == true || (role == "sales" && myRoles?["author"] == true) }
        let mine = help.filter { has($0.role) && !($0.role == "admin" && myRoles?["admin"] != true) }
        let mineIDs = Set(mine.map(\.role))
        return (mine, help.filter { !mineIDs.contains($0.role) })
    }
}

// MARK: Odczyt odporny na pojedyncze nietypowe pola (krok z błędnym polem nie psuje całej listy).

private struct LossyStep: Decodable {
    let value: EventStep?
    init(from decoder: Decoder) throws { value = try? EventStep(from: decoder) }
}

extension EventStep {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func text(_ key: CodingKeys) -> String? { (try? c.decodeIfPresent(String.self, forKey: key)) ?? nil }
        func flag(_ key: CodingKeys) -> Bool? { (try? c.decodeIfPresent(Bool.self, forKey: key)) ?? nil }
        id = try c.decode(String.self, forKey: .id)
        key = text(.key) ?? ""
        stage = text(.stage) ?? ""
        kind = text(.kind) ?? "task"
        source = text(.source)
        title = text(.title) ?? ""
        details = text(.details)
        if let value = (try? c.decodeIfPresent(Double.self, forKey: .quantity)) ?? nil { quantity = value }
        else { quantity = text(.quantity).flatMap { Double($0) } }
        unit = text(.unit)
        supplier = text(.supplier)
        owner_role = text(.owner_role) ?? ""
        due_at = text(.due_at)
        status = text(.status) ?? "open"
        status_note = text(.status_note)
        ordered_at = text(.ordered_at)
        expected_at = text(.expected_at)
        completed_at = text(.completed_at)
        completed_by_name = text(.completed_by_name)
        blocks_ready = flag(.blocks_ready)
        is_mine = flag(.is_mine)
        completed_by_me = flag(.completed_by_me)
        assignee = (try? c.decodeIfPresent(EventStepAssignee.self, forKey: .assignee)) ?? nil
        blocked_by = (try? c.decodeIfPresent([EventStepBlocker].self, forKey: .blocked_by)) ?? nil
        overdue = flag(.overdue)
        can_act = flag(.can_act)
        can_override = flag(.can_override)
        system_managed = flag(.system_managed)
        history = (try? c.decodeIfPresent([EventStepHistory].self, forKey: .history)) ?? nil
    }
}

extension EventStepsSnapshot {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        my_roles = ((try? c.decodeIfPresent([String: Bool?].self, forKey: .my_roles)) ?? nil)?.compactMapValues { $0 }
        can_override = (try? c.decodeIfPresent(Bool.self, forKey: .can_override)) ?? nil
        can_add = (try? c.decodeIfPresent(Bool.self, forKey: .can_add)) ?? nil
        steps = ((try? c.decodeIfPresent([LossyStep].self, forKey: .steps)) ?? nil)?.compactMap(\.value) ?? []
        waiting_for = ((try? c.decodeIfPresent([LossyStep].self, forKey: .waiting_for)) ?? nil)?.compactMap(\.value)
        progress = (try? c.decodeIfPresent([String: EventStepProgress].self, forKey: .progress)) ?? nil
        show_commercial = (try? c.decodeIfPresent(Bool.self, forKey: .show_commercial)) ?? nil
    }
}

import SwiftUI
import AppKit

// MARK: Terminy i monity — panel „Co z tym zrobić” obok tabeli: dla zaznaczonej pozycji co to jest, skąd się wzięła, jaki ma stan
// i jak ją załatwić (przyciski prowadzą do właściwego miejsca albo robią zapis od razu); bez zaznaczenia — opis listy. Okno
// ręcznego oznaczenia zapłaty faktury (karta, gotówka, polecenie zapłaty, przelew spoza wczytanych wyciągów).

/// Zaznaczona pozycja jednej z list.
enum FinDeadlineItem {
    case obligation(FinDeadlines.Obligation)
    case receivable(FinDeadlines.Receivable)
    case payable(FinDeadlines.Payable, FinWhitelist.Payable?)
    case payment(FinWhitelist.Payment)
}

/// Faktura do ręcznego oznaczenia zapłaty.
enum FinDeadlinePaidTarget: Identifiable {
    case receivable(FinDeadlines.Receivable)
    case payable(FinDeadlines.Payable)
    var id: String {
        switch self {
        case .receivable(let item): return "r:\(item.id)"
        case .payable(let item): return "p:\(item.id)"
        }
    }
}

/// Czynności z panelu (obsługuje je ekran „Terminy i monity”).
enum FinDeadlineAction {
    case declaration(FinDeadlines.Obligation)
    case reconcile(company: String?, day: String)
    case statements(company: String?, day: String?)
    case declarations(company: String?, periodStart: String, kind: String)
    case settings(company: String?)
    case reminder(FinDeadlines.Receivable)
    case markPaid(FinDeadlinePaidTarget)
    case invoice(String)
    case ksef
    case dueDate(FinDeadlines.Payable)
    case checkPayable(FinDeadlines.Payable)
    case checkPayment(FinWhitelist.Payment)
    case copy(String)
}

/// Dane i uprawnienia potrzebne panelowi.
struct FinDeadlineContext {
    var today: String
    /// Ostatni dzień wczytanych wyciągów działalności (`nil` — brak wyciągów).
    var statementEnd: (String?) -> String?
    var canManage: (String?) -> Bool
    var canSend: (FinDeadlines.Receivable) -> Bool
    var editable: (FinDeadlines.Payable) -> Bool
    var canWrite: Bool
    var whitelistAvailable: Bool
}

enum FinDeadlineText {
    /// „październik 2025” — miesiąc daty „rrrr-MM-dd”.
    static func month(_ day: String) -> String { FinFormat.monthLabel(day) }

    static func plural(_ count: Int, _ one: String, _ few: String, _ many: String) -> String {
        if count == 1 { return one }
        let tens = count % 100, units = count % 10
        return (2...4).contains(units) && !(12...14).contains(tens) ? few : many
    }

    static func payee(_ kind: String) -> String {
        kind == "zus" ? "do ZUS (Zakład Ubezpieczeń Społecznych)" : "do urzędu skarbowego (mikrorachunek podatkowy)"
    }

    static func meaning(_ item: FinDeadlines.Obligation) -> String {
        switch item.kind {
        case "zus": return "Składki ZUS za okres z nazwy — kwota z deklaracji DRA (Płatnik albo PUE ZUS), płatna przelewem na rachunek składkowy w ZUS."
        case "pit": return "Zaliczki na podatek dochodowy pobrane od wynagrodzeń i umów (\(item.form)) za okres z nazwy — przelew na mikrorachunek podatkowy."
        case "vat": return "VAT za okres z nazwy (JPK_V7 z deklaracją) — przelew podatku na mikrorachunek podatkowy. Przy nadwyżce (zwrot albo przeniesienie) nic się nie płaci."
        case "cit": return item.periodKind == "year"
            ? "Roczne zeznanie CIT-8 i dopłata podatku za rok z nazwy — przelew na mikrorachunek podatkowy."
            : "Zaliczka na podatek CIT za okres z nazwy — przelew na mikrorachunek podatkowy."
        default: return "Obowiązek \(item.form) za okres z nazwy."
        }
    }

    static let listIntro: [FinDeadlinesList: (what: String, done: String)] = [
        .obligations: (
            "Terminy ZUS, PIT-4R, VAT i CIT wyliczone z „Obowiązków działalności” — każda pozycja to jeden okres (np. DRA za wrzesień). Kwota pochodzi z deklaracji wpisanej w „Deklaracjach ZUS i podatkach”, a zapłata — z przelewu z wyciągu przypisanego do tej deklaracji w uzgodnieniu wyciągów.",
            "Pozycja jest załatwiona, gdy ma kwotę z deklaracji i przypisany przelew na tę kwotę (stan „Zapłacone”) — po terminie znika z listy. „brak kwoty” = w CRM nie ma kwoty z deklaracji za ten okres; „Po terminie” = termin minął, a we wczytanych wyciągach żaden przelew nie jest przypisany do tej deklaracji. To nie musi znaczyć, że nie zapłaciliście — tylko że CRM tego nie wie."
        ),
        .receivables: (
            "Nieopłacone faktury sprzedaży po terminie i z terminem w ciągu 14 dni. Zapłatę CRM bierze z uzgodnienia wyciągów (wpłata dopasowana do faktury) albo z ręcznego oznaczenia w karcie faktury.",
            "Faktura znika z listy, gdy wpłata zostanie dopasowana w uzgodnieniu albo oznaczona ręcznie. Nieopłaconą możesz przypomnieć klientowi e-mailem z fakturą w załączniku."
        ),
        .payables: (
            "Nieopłacone faktury kosztowe pobrane z KSeF: bez terminu płatności albo z terminem w ciągu 14 dni. Zapłatę CRM bierze z uzgodnienia wyciągów (przelew dopasowany do faktury) albo z ręcznego oznaczenia.",
            "Faktura znika z listy po dopasowaniu przelewu w uzgodnieniu albo po oznaczeniu zapłaty (karta, gotówka, polecenie zapłaty). Biała lista VAT jest obowiązkowa tylko przy transakcji ponad 15 000 zł — przy mniejszych to tylko informacja."
        ),
        .payments: (
            "Przelewy ponad 15 000 zł z ostatnich 90 dni (z wczytanych wyciągów) dopasowane do faktur kosztowych. To lista kontrolna: przy transakcji ponad 15 000 zł brutto płaci się tylko na rachunek dostawcy z wykazu podatników VAT („biała lista” Ministerstwa Finansów).",
            "„Sprawdź” pyta MF, czy rachunek był w wykazie w dniu przelewu. Zielony stan = w porządku, nic więcej nie trzeba (identyfikator zapytania MF to dowód sprawdzenia). Przelew zostaje na liście przez 90 dni od wykonania."
        ),
    ]
}

// MARK: Panel

@MainActor struct FinDeadlinesGuidePanel: View {
    let list: FinDeadlinesList
    let item: FinDeadlineItem?
    let context: FinDeadlineContext
    let footnote: String
    let perform: (FinDeadlineAction) -> Void
    @Environment(\.crmTheme) private var theme
    @State private var aboutOpen = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let item {
                    switch item {
                    case .obligation(let obligation): obligationGuide(obligation)
                    case .receivable(let receivable): receivableGuide(receivable)
                    case .payable(let payable, let check): payableGuide(payable, check)
                    case .payment(let payment): paymentGuide(payment)
                    }
                    Divider()
                    DisclosureGroup(isExpanded: $aboutOpen) { about } label: {
                        Text("O liście „\(list.label)”").font(.callout.weight(.medium))
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Co z tym zrobić?", systemImage: "lightbulb").font(.headline)
                        Text("Zaznacz pozycję na liście — tu zobaczysz, co to jest, skąd się wzięła i jak ją załatwić, z przyciskami do właściwych miejsc.")
                            .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                    about
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.primary.opacity(0.02))
    }

    // MARK: Elementy

    private var about: some View {
        let intro = FinDeadlineText.listIntro[list]
        return VStack(alignment: .leading, spacing: 10) {
            if let intro {
                block("Co to za lista", intro.what)
                block("Kiedy pozycja jest załatwiona", intro.done)
            }
            Text(footnote).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func block(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(.tertiary)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
        }
    }

    private func header(_ title: String, _ subtitle: String?, chip: FinChip?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.headline).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            if let chip { FinChipView(chip: chip).font(.callout) }
        }
    }

    private func status(_ text: String, tone: FinChip.Tone = .warn) -> some View {
        let color = FinChip(text: "", tone: tone).color
        return HStack(alignment: .top, spacing: 8) {
            Image(systemName: tone == .ok ? "checkmark.circle.fill" : "info.circle.fill").foregroundStyle(color)
            Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.10), in: RoundedRectangle(cornerRadius: 8))
    }

    /// Krok „co zrobić”: opis i przycisk (wyłączony bez uprawnienia albo połączenia — z wyjaśnieniem).
    private func step(_ text: String, button: String? = nil, symbol: String = "arrow.right.circle",
                      enabled: Bool = true, disabledHint: String? = nil, action: FinDeadlineAction? = nil) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "chevron.right.circle.fill").font(.callout).foregroundStyle(theme.accent.opacity(0.8))
            VStack(alignment: .leading, spacing: 6) {
                Text(text).font(.callout).fixedSize(horizontal: false, vertical: true)
                if let button, let action {
                    Button { perform(action) } label: { Label(button, systemImage: symbol) }
                        .controlSize(.small).disabled(!enabled)
                        .help(enabled ? button : disabledHint ?? "Niedostępne")
                    if !enabled, let disabledHint { Text(disabledHint).font(.caption2).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private func steps<Content: View>(_ title: String = "Co zrobić", @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).tracking(0.5).foregroundStyle(.tertiary)
            content()
        }
    }

    private func manageHint(_ company: String?) -> String? {
        context.canManage(company) ? (context.canWrite ? nil : "Zapis wymaga połączenia z serwerem CRM.") : "Wymaga „Zarządzania finansami” tej działalności."
    }
    private func canAct(_ company: String?) -> Bool { context.canManage(company) && context.canWrite }

    private func monthOf(_ day: String?) -> String { day.map { FinDeadlineText.month($0) } ?? "" }

    // MARK: ZUS i podatki

    @ViewBuilder private func obligationGuide(_ item: FinDeadlines.Obligation) -> some View {
        let end = context.statementEnd(item.company)
        let dueMonth = monthOf(item.dueDate)
        header(item.label, [item.settingLabel, "termin \(FinFormat.day(item.dueDate))"].compactMap { $0 }.joined(separator: " · "),
               chip: FinChip.obligation(item, today: context.today))
        block("Co to jest", FinDeadlineText.meaning(item))
        block("Skąd się wzięło", "Pozycję tworzy włączony obowiązek \(item.form) w „Obowiązkach działalności” — co okres pojawia się nowa z terminem z ustawień (sobota, niedziela i święto przesuwają termin na dzień roboczy).")
        obligationStatus(item, end: end)
        steps {
            if item.amountDue == nil {
                step("Przepisz kwotę z deklaracji \(item.form) za ten okres (DRA: „kwota do zapłaty”; PIT-4R, VAT, CIT: podatek do wpłaty). Jeśli nic nie było do zapłaty (np. VAT do zwrotu) — wpisz 0 zł.",
                     button: "Wpisz kwotę z deklaracji…", symbol: "square.and.pencil", enabled: canAct(item.company), disabledHint: manageHint(item.company),
                     action: .declaration(item))
            }
            if item.status == "unconfirmed" {
                step("Wczytaj wyciąg za \(dueMonth) (miesiąc terminu) — dopiero wtedy CRM sprawdzi, czy przelew wyszedł.",
                     button: "Wyciągi — \(dueMonth)", symbol: "building.columns", action: .statements(company: item.company, day: item.dueDate))
            } else if item.status != "paid" && (item.amountDue == nil || item.paid < (item.amountDue ?? 0) - 0.01) {
                step("Przypisz przelew \(FinDeadlineText.payee(item.kind)): w uzgodnieniu za \(dueMonth) zaznacz przelew, potem „Rozlicz ręcznie” → „Przypisz do deklaracji” i wybierz \(item.label).",
                     button: "Uzgodnienie — \(dueMonth)", symbol: "arrow.left.arrow.right", action: .reconcile(company: item.company, day: item.dueDate))
            }
            if item.amountDue != nil {
                step("Kwota, pliki deklaracji i rozbicie na pracowników — w rejestrze deklaracji.",
                     button: "Deklaracje ZUS i podatki", symbol: "doc.plaintext",
                     action: .declarations(company: item.company, periodStart: item.periodStart, kind: item.kind))
            }
            step("Ten obowiązek nie dotyczy działalności (np. bez pracowników nie ma PIT-4R)? Wyłącz go albo popraw termin w ustawieniach.",
                 button: "Obowiązki działalności", symbol: "gearshape", enabled: canAct(item.company), disabledHint: manageHint(item.company),
                 action: .settings(company: item.company))
        }
    }

    @ViewBuilder private func obligationStatus(_ item: FinDeadlines.Obligation, end: String?) -> some View {
        let endText = end.map { "do \(FinFormat.day($0))" } ?? "— brak wczytanych wyciągów"
        switch item.status {
        case "paid":
            status("Zapłacone — kwota z deklaracji (\(FinFormat.money(item.amountDue ?? 0))) i przypisane przelewy się zgadzają. Nic nie trzeba robić.", tone: .ok)
        case "paid_no_amount":
            status("Przypisany przelew: \(FinFormat.money(item.paid)), ale bez kwoty z deklaracji CRM nie wie, czy to całość. Wpisz kwotę z deklaracji.")
        case "partial":
            let missing = max(0, (item.amountDue ?? 0) - item.paid)
            status("Zapłacono \(FinFormat.money(item.paid)) z \(FinFormat.money(item.amountDue ?? 0)) — brakuje \(FinFormat.money(missing)). Przypisz pozostały przelew albo popraw kwotę deklaracji.", tone: .bad)
        case "unconfirmed":
            status("Termin minął po ostatnim wczytanym wyciągu (\(endText)) — CRM jeszcze nie może sprawdzić zapłaty.", tone: .neutral)
        default:
            if item.overdue {
                let amount = item.amountDue.map { "Kwota z deklaracji: \(FinFormat.money($0))." } ?? "CRM nie zna kwoty (brak deklaracji za ten okres)."
                status("\(amount) Wyciągi są wczytane \(endText), a żaden przelew nie jest przypisany do tej deklaracji — dlatego „po terminie”.", tone: .bad)
            } else {
                let left = FinFormat.daysBetween(context.today, item.dueDate)
                let when = left == 0 ? "dziś" : "za \(left) \(FinFormat.dayWord(left))"
                let hint = item.amountDue == nil ? "Wpisz kwotę z deklaracji, gdy ją złożycie; po zapłacie i wczytaniu wyciągu przypisz przelew." : "Po zapłacie i wczytaniu wyciągu przypisz przelew."
                status("Termin \(when). \(hint)", tone: .neutral)
            }
        }
    }

    // MARK: Należności

    @ViewBuilder private func receivableGuide(_ item: FinDeadlines.Receivable) -> some View {
        let end = context.statementEnd(item.company)
        let late = Int(item.daysOverdue)
        let covered = end.map { $0 >= item.dueDate } ?? false
        header(item.invoiceNumber, [item.buyerName, "do zapłaty \(FinFormat.money(item.outstanding, item.currency))"].compactMap { $0 }.joined(separator: " · "),
               chip: FinChip(text: late > 0 ? "\(late) \(FinFormat.dayWord(late)) po terminie" : "termin \(FinFormat.day(item.dueDate))", tone: late > 0 ? .bad : .neutral))
        block("Co to jest", "Faktura sprzedaży wystawiona \(FinFormat.day(item.issueDate))\(item.inKsef ? " (wysłana do KSeF)" : "") z terminem \(FinFormat.day(item.dueDate)), bez zapisanej zapłaty."
              + (item.source == "ksef" ? " Faktura jest tylko w KSeF (nie ma jej w rejestrze faktur CRM)." : ""))
        block("Skąd się wzięło", "Na liście są nieopłacone faktury sprzedaży po terminie albo z terminem w ciągu 14 dni. Zapłatę CRM widzi dopiero po dopasowaniu wpłaty z wyciągu albo po ręcznym oznaczeniu.")
        if covered {
            status("Wyciągi są wczytane do \(FinFormat.day(end)) i w nich nie ma dopasowanej wpłaty. Jeśli klient zapłacił w tym czasie, wpłata czeka w uzgodnieniu; jeśli nie — przypomnij.", tone: late > 0 ? .bad : .neutral)
        } else {
            status(end.map { "Wyciągi są wczytane tylko do \(FinFormat.day($0)) — wpłata po tej dacie nie jest jeszcze widoczna." } ?? "Brak wczytanych wyciągów — CRM nie widzi żadnych wpłat.", tone: .neutral)
        }
        steps {
            step(covered ? "Klient zapłacił przelewem? Zaznacz wpłatę w uzgodnieniu za \(monthOf(item.dueDate)) (albo kolejny miesiąc) i „Wybierz dokument” → ta faktura."
                    : "Klient zapłacił przelewem? Wczytaj wyciągi od \(monthOf(end ?? item.dueDate)) — uzgodnienie samo dopasuje wpłatę.",
                 button: covered ? "Uzgodnienie — \(monthOf(item.dueDate))" : "Wyciągi", symbol: covered ? "arrow.left.arrow.right" : "building.columns",
                 action: covered ? FinDeadlineAction.reconcile(company: item.company, day: item.dueDate) : FinDeadlineAction.statements(company: item.company, day: end ?? item.dueDate))
            step("Zapłata gotówką, kompensatą albo znasz datę wpłaty spoza wyciągów? Oznacz zapłatę ręcznie — faktura zniknie z listy.",
                 button: "Oznacz zapłatę…", symbol: "checkmark.circle", enabled: canAct(item.company), disabledHint: manageHint(item.company),
                 action: .markPaid(.receivable(item)))
            if context.canSend(item) {
                step(item.reminders > 0
                     ? "Nie zapłacił? Wysłano już \(Int(item.reminders)) \(FinDeadlineText.plural(Int(item.reminders), "przypomnienie", "przypomnienia", "przypomnień")) (ostatnie \(FinFormat.day(item.lastReminderAt))) — możesz wysłać kolejne."
                     : "Nie zapłacił? Wyślij przypomnienie e-mailem z fakturą w załączniku — data i adresat zapiszą się w historii monitów.",
                     button: "Wyślij przypomnienie…", symbol: "envelope", enabled: context.canWrite, disabledHint: "Wysyłka wymaga połączenia z serwerem CRM.",
                     action: .reminder(item))
            } else {
                step(item.source == "ksef" || item.invoiceId == nil
                     ? "Faktura spoza rejestru CRM — przypomnienie wyślij z poczty."
                     : "Przypomnienia wysyła osoba z „Wystawianiem faktur” w tej działalności.")
            }
            if let invoice = item.invoiceId {
                step("Szczegóły faktury, zaliczki i historia płatności — w karcie faktury.", button: "Otwórz fakturę", symbol: "doc.text", action: .invoice(invoice))
            } else {
                step("Szczegóły faktury i wpłaty — na ekranie KSeF.", button: "Faktury KSeF", symbol: "doc.badge.arrow.up", action: .ksef)
            }
        }
    }

    // MARK: Faktury kosztowe do zapłaty

    @ViewBuilder private func payableGuide(_ item: FinDeadlines.Payable, _ check: FinWhitelist.Payable?) -> some View {
        let end = context.statementEnd(item.company)
        let big = item.amount > 15_000
        let reference = item.dueDate ?? item.issueDate
        let covered = end.flatMap { stamp in reference.map { stamp >= $0 } } ?? false
        header(item.sellerName ?? "Dostawca", [item.sellerNip.map { "NIP \($0)" }, item.invoiceNumber, FinFormat.money(item.amount, item.currency)].compactMap { $0 }.joined(separator: " · "),
               chip: item.dueDate == nil ? FinChip(text: "brak terminu w fakturze", tone: .warn)
                   : FinChip(text: "termin \(FinFormat.day(item.dueDate))", tone: (item.dueDate ?? "9999") < context.today ? .bad : .neutral))
        block("Co to jest", "Faktura kosztowa pobrana z KSeF (wystawiona \(FinFormat.day(item.issueDate))) bez zapisanej zapłaty."
              + (item.bankAccount == nil ? " Dostawca nie podał w niej rachunku." : ""))
        block("Skąd się wzięło", "Lista pokazuje nieopłacone faktury kosztowe bez terminu albo z terminem w ciągu 14 dni. Zapłatę CRM widzi po dopasowaniu przelewu z wyciągu albo po ręcznym oznaczeniu.")
        if item.dueDate == nil {
            status("Dostawca nie wpisał terminu płatności w fakturze — tak bywa przy płatności kartą, gotówką, poleceniem zapłaty (abonamenty) albo „przy odbiorze”."
                   + (covered ? " Wyciągi obejmują datę wystawienia, a przelewu nie dopasowano — najpewniej zapłata była inaczej niż przelewem z rachunku firmy." : ""), tone: .warn)
        } else if covered {
            status("Wyciągi obejmują termin (do \(FinFormat.day(end))), a przelewu nie dopasowano — sprawdź uzgodnienie albo czy faktura była zapłacona inaczej.", tone: .bad)
        } else {
            status(end.map { "Wyciągi są wczytane do \(FinFormat.day($0)) — późniejszy przelew nie jest jeszcze widoczny." } ?? "Brak wczytanych wyciągów — CRM nie widzi żadnych przelewów.", tone: .neutral)
        }
        steps {
            step("Zapłacona kartą, gotówką, poleceniem zapłaty albo ze środków prywatnych? Oznacz zapłatę z datą i sposobem — faktura zniknie z listy.",
                 button: "Oznacz jako zapłaconą…", symbol: "checkmark.circle", enabled: canAct(item.company), disabledHint: manageHint(item.company),
                 action: .markPaid(.payable(item)))
            if let reference {
                step(covered
                     ? "Zapłacona przelewem z rachunku firmy? W uzgodnieniu za \(monthOf(reference)) (albo kolejny miesiąc) zaznacz przelew i „Wybierz dokument” → ta faktura."
                     : "Zapłacona przelewem z rachunku firmy? Wczytaj wyciąg obejmujący przelew — uzgodnienie samo dopasuje fakturę.",
                     button: covered ? "Uzgodnienie — \(monthOf(reference))" : "Wyciągi", symbol: covered ? "arrow.left.arrow.right" : "building.columns",
                     action: covered ? FinDeadlineAction.reconcile(company: item.company, day: reference) : FinDeadlineAction.statements(company: item.company, day: end ?? reference))
            }
            if context.editable(item) {
                step(item.dueDate == nil
                     ? "Jeszcze do zapłaty? Ustaw termin (z faktury papierowej albo umowy) — przy NIP możesz go zapamiętać dla dostawcy."
                     : "Termin wpisany w CRM — możesz go zmienić.",
                     button: item.dueDate == nil ? "Ustaw termin…" : "Zmień termin…", symbol: "calendar", enabled: context.canWrite,
                     disabledHint: "Zapis wymaga połączenia z serwerem CRM.", action: .dueDate(item))
            }
            if context.whitelistAvailable && item.sellerNip != nil {
                step(big
                     ? "Faktura ponad 15 000 zł: przed przelewem sprawdź rachunek na białej liście VAT (w dniu zlecenia przelewu) — zapłata na rachunek spoza wykazu odbiera koszt podatkowy."
                     : "Biała lista: przy fakturze do 15 000 zł sprawdzenie nie jest obowiązkowe — tylko informacyjnie." + (check?.verdict == nil ? "" : " Ostatni wynik: \(FinChip.whitelist(verdict: check?.verdict, statusVat: check?.statusVat, nip: check?.nip, fresh: check?.fresh ?? false, big: big).text)."),
                     button: "Sprawdź na białej liście", symbol: "checkmark.shield", enabled: context.canWrite,
                     disabledHint: "Sprawdzenie wymaga połączenia z serwerem CRM.", action: .checkPayable(item))
            }
            if let account = item.bankAccount {
                step("Rachunek z faktury: \(account)", button: "Kopiuj numer rachunku", symbol: "doc.on.doc", action: .copy(account))
            }
        }
    }

    // MARK: Przelewy ponad 15 000 zł

    @ViewBuilder private func paymentGuide(_ item: FinWhitelist.Payment) -> some View {
        let chip = FinChip.whitelist(verdict: item.verdict, statusVat: item.statusVat, nip: item.nip, fresh: true, big: true)
        let days = FinFormat.daysBetween(item.transactionDate, context.today)
        header(item.sellerName ?? "Dostawca", ["przelew \(FinFormat.day(item.transactionDate))", FinFormat.money(item.amount), item.documentNumber].compactMap { $0 }.joined(separator: " · "),
               chip: chip)
        block("Co to jest", "Przelew z wyciągu na kwotę ponad 15 000 zł, dopasowany do faktury kosztowej \(item.documentNumber ?? "") (wartość \(FinFormat.money(item.documentGross))). Rachunek odbiorcy z wyciągu: \(item.account ?? "brak").")
        block("Po co biała lista", "Za transakcję ponad 15 000 zł brutto płaci się tylko na rachunek dostawcy z wykazu podatników VAT. Zapłata na rachunek spoza wykazu: wydatek nie jest kosztem podatkowym, a spółka odpowiada solidarnie za nieodprowadzony VAT dostawcy — chyba że w ciągu 7 dni od zlecenia przelewu złoży do swojego urzędu skarbowego zawiadomienie ZAW-NR.")
        switch item.verdict ?? "" {
        case "ok":
            status("Rachunek był w wykazie w dniu przelewu — w porządku, nic więcej nie trzeba robić." + (item.requestId.map { " Dowód sprawdzenia (identyfikator zapytania MF): \($0)." } ?? ""), tone: .ok)
        case "not_listed", "not_found":
            status((item.verdict == "not_found" ? "NIP dostawcy nie figuruje w wykazie VAT." : "Rachunku nie było w wykazie w dniu przelewu.")
                   + (days <= 7 ? " Od przelewu minęło \(days) \(FinFormat.dayWord(days)) — złóż zawiadomienie ZAW-NR w urzędzie skarbowym (termin: 7 dni od zlecenia przelewu)."
                      : " Termin na ZAW-NR (7 dni od zlecenia przelewu) minął — skonsultuj z biurem rachunkowym skutki dla kosztów i VAT."), tone: .bad)
        case "no_account":
            status("Na wyciągu nie ma rachunku odbiorcy — sprawdź rachunek z potwierdzenia przelewu w wykazie podatników VAT ręcznie.", tone: .warn)
        case "error":
            status("Sprawdzenie w MF się nie powiodło — spróbuj ponownie.", tone: .warn)
        default:
            status("Jeszcze nie sprawdzono, czy rachunek był w wykazie w dniu przelewu (\(FinFormat.day(item.transactionDate))). Sprawdzenie działa wstecz — na dzień przelewu.", tone: .warn)
        }
        steps {
            step(item.verdict == "ok" ? "Możesz sprawdzić ponownie (na dzień przelewu)." : "Sprawdź rachunek odbiorcy na dzień przelewu — wynik i identyfikator zapytania MF zapiszą się przy przelewie.",
                 button: "Sprawdź ten przelew", symbol: "checkmark.shield", enabled: context.canWrite && item.nip != nil,
                 disabledHint: item.nip == nil ? "Dostawca bez polskiego NIP — nie dotyczy." : "Sprawdzenie wymaga połączenia z serwerem CRM.",
                 action: .checkPayment(item))
            step("Przelew i dopasowana faktura — w uzgodnieniu wyciągu za \(monthOf(item.transactionDate)).",
                 button: "Uzgodnienie — \(monthOf(item.transactionDate))", symbol: "arrow.left.arrow.right",
                 action: .reconcile(company: item.company, day: item.transactionDate))
            if let account = item.account {
                step("Rachunek odbiorcy: \(account)", button: "Kopiuj numer rachunku", symbol: "doc.on.doc", action: .copy(account))
            }
        }
    }
}

// MARK: Ręczne oznaczenie zapłaty faktury

@MainActor struct FinDeadlinePaidSheet: View {
    @ObservedObject var store: FinanceStore
    let target: FinDeadlinePaidTarget
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var method = ""
    @State private var note = ""
    @State private var saving = false

    private static let payableMethods: [(String, String)] = [
        ("card", "Karta płatnicza"), ("cash", "Gotówka"), ("direct_debit", "Polecenie zapłaty / płatność automatyczna"),
        ("transfer", "Przelew spoza wczytanych wyciągów"), ("private", "Ze środków prywatnych"), ("offset", "Kompensata"), ("other", "Inaczej"),
    ]
    private static let receivableMethods: [(String, String)] = [
        ("transfer", "Przelew spoza wczytanych wyciągów"), ("cash", "Gotówka"), ("card", "Karta / terminal"), ("offset", "Kompensata"), ("other", "Inaczej"),
    ]

    /// Faktura lokalna CRM — zapis jak „Oznacz jako opłaconą” w karcie (bez sposobu i notatki).
    private var localInvoice: String? {
        if case .receivable(let item) = target, item.source == "local" { return item.invoiceId }
        return nil
    }
    private var methods: [(String, String)] {
        if case .payable = target { return Self.payableMethods }
        return Self.receivableMethods
    }
    private var title: String {
        if case .payable = target { return "Oznacz jako zapłaconą" }
        return "Oznacz zapłatę klienta"
    }
    private var summary: (number: String, party: String, amount: String) {
        switch target {
        case .payable(let item):
            return (item.invoiceNumber, item.sellerName ?? "Dostawca", FinFormat.money(abs(item.amount), item.currency))
        case .receivable(let item):
            return (item.invoiceNumber, item.buyerName ?? "Klient", FinFormat.money(item.outstanding, item.currency))
        }
    }

    var body: some View {
        let info = summary
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: "checkmark.circle").font(.title3.bold())
            VStack(alignment: .leading, spacing: 2) {
                Text(info.party).fontWeight(.medium)
                Text("Faktura \(info.number) · \(info.amount)").font(.caption).foregroundStyle(.secondary)
            }
            Form {
                DatePicker("Data zapłaty", selection: $date, in: ...Date(), displayedComponents: .date)
                if localInvoice == nil {
                    Picker("Sposób", selection: $method) {
                        ForEach(methods, id: \.0) { Text($0.1).tag($0.0) }
                    }
                    TextField("Notatka", text: $note, prompt: Text("opcjonalnie, np. karta firmowa *1234"))
                }
            }
            .formStyle(.grouped)
            Text(localInvoice != nil
                 ? "Zapisze się pełna zapłata faktury (dla faktury końcowej — kwota po zaliczkach) z tą datą, jak „Oznacz jako opłaconą” w karcie faktury."
                 : "Zapisze się wpłata całej kwoty \(info.amount) z tą datą (rejestr wpłat faktury w KSeF). Jeśli zapłata była przelewem z rachunku firmy, lepiej wczytać wyciąg — uzgodnienie samo dopasuje przelew do faktury.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button("Anuluj", role: .cancel) { dismiss() }.keyboardShortcut(.cancelAction).disabled(saving)
                Button(saving ? "Zapisywanie…" : "Zapisz") { Task { await save() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction).disabled(saving)
            }
        }
        .padding(20)
        .frame(width: 500)
        .onAppear { if method.isEmpty { method = methods.first?.0 ?? "other" } }
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        let day = FinanceText.dayString(date)
        let methodLabel = methods.first { $0.0 == method }?.1 ?? "Inaczej"
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = "Ręczne oznaczenie zapłaty: \(methodLabel.lowercased())" + (trimmed.isEmpty ? "" : " — \(trimmed)")
        let ok: Bool
        switch target {
        case .payable(let item):
            ok = await store.bank.ksefAction("Zapisywanie zapłaty…", "ksefPaymentAdd", [
                "id": .string(item.id), "amount": .number((abs(item.amount) * 100).rounded() / 100), "date": .string(day), "notes": .string(notes),
            ], company: item.company ?? "")
        case .receivable(let item):
            if let invoice = localInvoice {
                ok = await store.bank.invoiceAction("Zapisywanie zapłaty…", "invoiceStatus", [
                    "id": .string(invoice), "status": .string("paid"), "paidDate": .string(day),
                ])
            } else {
                ok = await store.bank.ksefAction("Zapisywanie zapłaty…", "ksefPaymentAdd", [
                    "id": .string(item.id), "amount": .number((abs(item.outstanding) * 100).rounded() / 100), "date": .string(day), "notes": .string(notes),
                ], company: item.company ?? "")
            }
        }
        if ok { dismiss() }
    }
}

import SwiftUI
import EventKit
import AppKit

// MARK: Kopia CRM w Kalendarzu Apple
// Wydarzenia i spotkania pracownika trafiają do wskazanego kalendarza Apple (tylko odczyt — zmiany w Apple nie wracają do CRM).
// Każdy wpis CRM ma w kalendarzu najwyżej jedną kopię: kopie rozpoznajemy po adresie `mavinci://event|meeting/<id>` i znaczniku
// w notatce, niezależnie od połączenia, z którego powstały (np. sprzed przeniesienia bazy), a nadmiarowe i nieaktualne usuwamy.
// Kalendarz iCloud trafia też na iPhone'a i Apple Watch — razem z subskrypcją kalendarza CRM (link webcal z CRM → Ustawienia →
// Kalendarz) dawałby podwójne wpisy, dlatego okno ostrzega o tym i pozwala trzymać kopię tylko na tym Macu albo ją usunąć.

/// Powiązanie konta z kalendarzem Apple (pęk kluczy). `items`: wpis CRM → identyfikator kopii w Kalendarzu.
struct CalendarLink:Codable {
    var calendarID:String
    var items:[String:String]=[:]
    var lastSync:Date?
    /// Aktualizacja kopii po każdym odświeżeniu danych (brak w starszych zapisach = wyłączona).
    var automatic:Bool?
}

/// Link subskrypcji kalendarza CRM (`calendar_feed_tokens`) — własny wiersz pracownika.
struct CalendarFeedStatus:Equatable {
    var exists:Bool
    var created:Date?=nil
    var lastUsed:Date?=nil
    /// Link pobierany w ostatnich 3 dniach — subskrypcja działa na którymś urządzeniu.
    var active:Bool {lastUsed.map {Date().timeIntervalSince($0) < 3*86_400} ?? false}
}

/// Potwierdzenie usunięcia kopii z kalendarza.
struct CalendarRemoval:Identifiable {
    let calendarID:String
    let title:String
    let count:Int
    var id:String {calendarID}
}

@MainActor final class AppleCalendarLink:ObservableObject {
    @Published var calendars:[EKCalendar]=[]
    @Published var busy=false
    @Published var error:String?
    @Published var summary:String?
    @Published var selectedCalendar=""
    /// Kalendarz, w którym jest kopia tego konta — inny niż wybrany oznacza przeniesienie kopii.
    @Published private(set) var linkedCalendar=""
    @Published private(set) var lastSync:Date?
    @Published private(set) var automatic=false
    /// Subskrybowane kalendarze CRM widoczne na tym Macu (np. „MAVINCI CRM — Kalendarz” z linku webcal).
    @Published private(set) var subscriptions:[String]=[]
    @Published var feed:CalendarFeedStatus?
    @Published var removal:CalendarRemoval?

    static let marker="Mavinci CRM • "
    private let store=EKEventStore()
    private var account=""
    /// Stan wpisów CRM przy ostatniej udanej aktualizacji — automatyczna aktualizacja tylko po zmianie.
    private var signature=""

    var authorized:Bool {EKEventStore.authorizationStatus(for:.event) == .fullAccess}
    var hasCopy:Bool {!linkedCalendar.isEmpty}
    func calendar(_ id:String) -> EKCalendar? {id.isEmpty ? nil:store.calendar(withIdentifier:id)}
    /// Miejsce „Na moim Macu” — kalendarz tylko na tym komputerze (macOS ukrywa je przy włączonych kalendarzach iCloud).
    var localSource:EKSource? {store.sources.first {$0.sourceType == .local}}
    static func isLocal(_ calendar:EKCalendar) -> Bool {calendar.source.sourceType == .local}

    // MARK: Konto i pęk kluczy

    /// Klucz konta: pracownik (bez adresu serwera — zmiana połączenia nie tworzy drugiej kopii).
    static func account(_ employee:String) -> String {digest("apple-calendar|\(employee)")}
    private var vaultKey:String {"apple-calendar-v2-\(account)"}
    private func ownerKey(_ calendarID:String) -> String {"apple-calendar-owner-\(digest(calendarID))"}
    private func load() -> CalendarLink? {
        guard !account.isEmpty,let data=try? Vault.read(vaultKey) else {return nil}
        return try? JSONDecoder().decode(CalendarLink.self,from:data)
    }
    private func persist(_ link:CalendarLink) throws {try Vault.write(vaultKey,JSONEncoder().encode(link))}
    private func publish(_ link:CalendarLink?) {
        linkedCalendar=link.map {$0.items.isEmpty ? "":$0.calendarID} ?? ""
        lastSync=link?.lastSync
        automatic=link?.automatic ?? false
    }
    /// Konto pracownika; zapis sprzed tej wersji (klucz z adresem serwera) przechodzi na klucz pracownika.
    func restore(employee:String,identity:String) {
        let next=Self.account(employee)
        if next != account {account=next;signature="";selectedCalendar="";summary=nil;error=nil}
        var link=load()
        let legacy="apple-calendar-\(digest(identity+"|"+employee))"
        if link == nil,let data=try? Vault.read(legacy),let old=try? JSONDecoder().decode(CalendarLink.self,from:data) {
            link=old
            if (try? persist(old)) != nil {try? Vault.delete(legacy)}
        }
        publish(link)
        if selectedCalendar.isEmpty {selectedCalendar=link?.calendarID ?? ""}
    }
    func reset() {
        account="";signature="";calendars=[];subscriptions=[];selectedCalendar="";linkedCalendar=""
        lastSync=nil;automatic=false;feed=nil;removal=nil;error=nil;summary=nil;busy=false
    }
    /// Jeden kalendarz Apple = jedno konto Mavinci na tym Macu (kopie w kalendarzu należą do niego w całości).
    private func claim(_ calendarID:String) throws -> Bool {
        if let data=try Vault.read(ownerKey(calendarID)),let owner=String(data:data,encoding:.utf8),!owner.isEmpty,owner != account {return false}
        try Vault.write(ownerKey(calendarID),Data(account.utf8))
        return true
    }

    // MARK: Dostęp i lista kalendarzy

    /// Okno ustawień: lista kalendarzy bez pytania o zgodę, jeśli dostęp już jest.
    func open(employee:String,identity:String) {
        restore(employee:employee,identity:identity)
        if authorized {reloadCalendars()}
    }
    func prepare(employee:String,identity:String) async {
        busy=true;error=nil
        defer {busy=false}
        guard Bundle.main.object(forInfoDictionaryKey:"NSCalendarsFullAccessUsageDescription") != nil else {
            error="Integracja z Kalendarzem wymaga uruchomienia pakietu .app. W trybie developerskim uruchom scripts/dev-app.sh.";return
        }
        do {
            let granted=try await store.requestFullAccessToEvents()
            guard granted else {error="Zezwól aplikacji na dostęp do kalendarzy w Ustawieniach systemowych → Prywatność i ochrona → Kalendarze.";return}
            restore(employee:employee,identity:identity)
            reloadCalendars()
        } catch {self.error="Nie udało się uzyskać dostępu do Kalendarza macOS."}
    }
    func reloadCalendars() {
        let all=store.calendars(for:.event)
        calendars=all.filter(\.allowsContentModifications).sorted {
            if Self.isLocal($0) != Self.isLocal($1) {return Self.isLocal($0)}
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
        subscriptions=all.filter {$0.type == .subscription && $0.title.localizedCaseInsensitiveContains("mavinci")}.map(\.title).sorted()
        if !selectedCalendar.isEmpty && store.calendar(withIdentifier:selectedCalendar) == nil {selectedCalendar=""}
    }
    /// Osobny kalendarz „Mavinci CRM” — na tym Macu, jeśli macOS na to pozwala; istniejący o tej nazwie jest wybierany ponownie.
    func createCalendar(local:Bool) {
        error=nil
        guard let source=local ? localSource:(store.defaultCalendarForNewEvents?.source ?? localSource) else {
            error=local ? "macOS nie udostępnia miejsca „Na moim Macu”, gdy kalendarze iCloud są włączone. Wybierz istniejący kalendarz albo utwórz go w iCloud.":"Dodaj najpierw kalendarz lokalny lub konto w aplikacji Kalendarz.";return
        }
        if let existing=store.calendars(for:.event).first(where:{$0.source.sourceIdentifier == source.sourceIdentifier && $0.title == "Mavinci CRM" && $0.allowsContentModifications}) {
            reloadCalendars();selectedCalendar=existing.calendarIdentifier;return
        }
        do {
            let calendar=EKCalendar(for:.event,eventStore:store);calendar.title="Mavinci CRM";calendar.source=source;calendar.cgColor=NSColor.controlAccentColor.cgColor
            try store.saveCalendar(calendar,commit:true)
            reloadCalendars()
            selectedCalendar=calendar.calendarIdentifier
        } catch {self.error="Nie udało się utworzyć kalendarza Mavinci. Możesz wybrać istniejący zapisywalny kalendarz."}
    }

    // MARK: Kopie w kalendarzu

    static func ours(_ event:EKEvent) -> Bool {event.url?.scheme == "mavinci" && event.notes?.contains(marker) == true}
    /// `event/<id>` albo `meeting/<id>` z adresu kopii — bez konta, więc dawne kopie są rozpoznawane.
    static func key(_ url:URL?) -> String? {
        guard let url,url.scheme == "mavinci",let host=url.host,!host.isEmpty else {return nil}
        let id=url.path.trimmingCharacters(in:CharacterSet(charactersIn:"/"))
        return id.isEmpty ? nil:"\(host)/\(id)"
    }
    /// Kopie Mavinci w kalendarzu w zakresie dat (po roku — EventKit przycina dłuższe zapytania) oraz zapamiętane w powiązaniu.
    private func copies(in calendar:EKCalendar,from start:Date,to end:Date,link:CalendarLink?) -> [EKEvent] {
        var seen=Set<String>();var found:[EKEvent]=[]
        var cursor=start
        while cursor<end {
            let next=min(end,cursor.addingTimeInterval(365*86_400))
            for event in store.events(matching:store.predicateForEvents(withStart:cursor,end:next,calendars:[calendar])) where Self.ours(event) {
                if seen.insert(event.calendarItemIdentifier).inserted {found.append(event)}
            }
            cursor=next
        }
        for id in link?.items.values.sorted() ?? [] where !seen.contains(id) {
            if let event=store.calendarItem(withIdentifier:id) as? EKEvent,event.calendar?.calendarIdentifier == calendar.calendarIdentifier,Self.ours(event) {
                seen.insert(id);found.append(event)
            }
        }
        return found
    }
    private func wideCopies(in calendar:EKCalendar,link:CalendarLink?) -> [EKEvent] {
        let now=Date()
        return copies(in:calendar,from:now.addingTimeInterval(-8*365*86_400),to:now.addingTimeInterval(8*365*86_400),link:link)
    }

    private struct Entry {
        let row:String;let key:String;let title:String;let start:Date;let end:Date;let location:String;let url:URL
    }
    private func entries(_ rows:[Row]) -> (items:[Entry],skipped:Int) {
        var items:[Entry]=[];var keys=Set<String>();var skipped=0
        for row in rows where !["cancelled","rejected"].contains(row["status"]) {
            let sourceID=row["source_id"].isEmpty ? row.id:row["source_id"]
            let host=row["kind"] == "meeting" ? "meeting":"event"
            guard let start=CalendarDates.date(row["event_date"]),!sourceID.isEmpty,
                  let url=URL(string:"mavinci://\(host)/\(sourceID)?account=\(account)"),let key=Self.key(url) else {skipped+=1;continue}
            guard keys.insert(key).inserted else {continue}
            let end=max(CalendarDates.date(row["event_end_date"]) ?? start.addingTimeInterval(3600),start.addingTimeInterval(60))
            items.append(Entry(row:row.id,key:key,title:row.title,start:start,end:end,location:row["location"],url:url))
        }
        return (items,skipped)
    }
    private var notes:String {"\(Self.marker)\(account)\nDane pochodzą z CRM. Zmiany w tej kopii nie zmieniają eventu w CRM."}
    /// Zapis pól kopii — tylko gdy coś się zmieniło (bez zbędnych zmian w iCloud).
    private func apply(_ entry:Entry,to event:EKEvent,calendar:EKCalendar) -> Bool {
        let zone=CalendarDates.calendar.timeZone
        func same(_ a:Date?,_ b:Date) -> Bool {a.map {abs($0.timeIntervalSince(b))<1} ?? false}
        if event.calendar?.calendarIdentifier == calendar.calendarIdentifier,event.title == entry.title,same(event.startDate,entry.start),
           same(event.endDate,entry.end),(event.location ?? "") == entry.location,event.url == entry.url,event.notes == notes,
           event.timeZone == zone,!event.isAllDay,!event.hasRecurrenceRules {return false}
        event.calendar=calendar;event.title=entry.title;event.startDate=entry.start;event.endDate=entry.end;event.isAllDay=false
        event.location=entry.location.isEmpty ? nil:entry.location;event.timeZone=zone;event.url=entry.url;event.notes=notes
        // Kolejne terminy spotkań są w CRM osobnymi wpisami — bez reguły powtarzania.
        event.recurrenceRules=nil
        return true
    }

    /// Kopia wpisów CRM w wybranym kalendarzu (albo w powiązanym — automatycznie). Wszystko albo nic: zmiany zatwierdzane razem.
    @discardableResult func synchronize(rows:[Row],calendarID:String?=nil,automatic auto:Bool=false) -> Bool {
        guard !busy else {return false}
        guard authorized,!account.isEmpty else {if !auto {error="Najpierw zezwól na połączenie z Kalendarzem."};return false}
        let target=calendarID ?? selectedCalendar
        guard let calendar=self.calendar(target),calendar.allowsContentModifications else {if !auto {error="Wybierz kalendarz do zapisu."};return false}
        var link=load() ?? CalendarLink(calendarID:calendar.calendarIdentifier,automatic:true)
        guard link.calendarID == calendar.calendarIdentifier || link.items.isEmpty else {
            if !auto {error="Kopia jest w innym kalendarzu. Użyj „Przenieś kopię”, aby nie powstała druga."};return false
        }
        busy=true;error=nil
        if !auto {summary=nil}
        defer {busy=false}
        do {
            guard try claim(calendar.calendarIdentifier) else {
                if !auto {error="Tego kalendarza używa inne konto Mavinci na tym Macu. Wybierz albo utwórz inny kalendarz."};return false
            }
            let plan=entries(rows)
            let now=Date()
            let earliest=plan.items.map(\.start).min() ?? now
            let latest=plan.items.map(\.end).max() ?? now
            let existing=copies(in:calendar,from:min(earliest,now.addingTimeInterval(-2*365*86_400)).addingTimeInterval(-2*86_400),
                                to:max(latest,now.addingTimeInterval(2*365*86_400)).addingTimeInterval(2*86_400),link:link)
            // Pusta odpowiedź CRM nie może wyczyścić kalendarza.
            guard !plan.items.isEmpty || existing.isEmpty else {
                if !auto {error="CRM nie zwrócił żadnych wpisów — kopia w kalendarzu zostaje bez zmian."};return false
            }
            var byKey:[String:[EKEvent]]=[:];var stray:[EKEvent]=[]
            for event in existing {if let key=Self.key(event.url) {byKey[key,default:[]].append(event)} else {stray.append(event)}}
            var written:[(String,EKEvent)]=[];var created=0,updated=0,removed=0
            for entry in plan.items {
                var candidates=byKey.removeValue(forKey:entry.key) ?? []
                let remembered=link.items[entry.row]
                let index=candidates.firstIndex {$0.calendarItemIdentifier == remembered} ?? (candidates.isEmpty ? nil:0)
                let event=index.map {candidates.remove(at:$0)} ?? EKEvent(eventStore:store)
                // Druga kopia tego samego wpisu (np. z dawnego połączenia) — zostaje jedna.
                for duplicate in candidates {try store.remove(duplicate,span:.thisEvent,commit:false);removed+=1}
                if apply(entry,to:event,calendar:calendar) {
                    try store.save(event,span:.thisEvent,commit:false)
                    if index == nil {created+=1} else {updated+=1}
                }
                written.append((entry.row,event))
            }
            // Wpisy, których nie ma już w CRM (usunięte, odwołane, poza zakresem pracownika).
            for event in byKey.values.flatMap({$0})+stray {try store.remove(event,span:.thisEvent,commit:false);removed+=1}
            try store.commit()
            link.calendarID=calendar.calendarIdentifier
            link.items=Dictionary(written.map {($0.0,$0.1.calendarItemIdentifier)},uniquingKeysWith:{first,_ in first})
            link.lastSync=Date()
            if link.automatic == nil {link.automatic=false}
            try persist(link)
            publish(link)
            selectedCalendar=calendar.calendarIdentifier
            signature=Self.signature(rows)
            var changes:[String]=[]
            if created>0 {changes.append("nowe: \(created)")}
            if updated>0 {changes.append("zmienione: \(updated)")}
            if removed>0 {changes.append("usunięte: \(removed)")}
            var text="Kopia aktualna — \(Self.count(plan.items.count)) w kalendarzu „\(calendar.title)”"
            text += changes.isEmpty ? " (bez zmian).":" (\(changes.joined(separator:", ")))."
            if plan.skipped>0 {text += " Pominięto \(Self.count(plan.skipped)) bez daty."}
            summary=text
            return true
        } catch {
            store.reset()
            if !auto {self.error="Synchronizacja kalendarza nie została zakończona. Kalendarz Apple nie został zmieniony — spróbuj ponownie."}
            return false
        }
    }
    /// Po odświeżeniu danych (`Workspace.refresh`): aktualizacja kopii, jeśli jest włączona i wpisy CRM się zmieniły.
    func refreshed(rows:[Row],employee:String,identity:String) {
        guard authorized,!busy else {return}
        if account != Self.account(employee) {restore(employee:employee,identity:identity)}
        guard let link=load(),link.automatic == true,!link.items.isEmpty,calendar(link.calendarID) != nil else {return}
        let next=Self.signature(rows)
        guard next != signature else {return}
        if synchronize(rows:rows,calendarID:link.calendarID,automatic:true) {signature=next}
    }
    func setAutomatic(_ on:Bool) {
        guard var link=load() else {return}
        link.automatic=on
        do {try persist(link);publish(link)} catch {self.error="Nie udało się zapisać ustawienia."}
    }
    /// Przeniesienie kopii do wybranego kalendarza: usunięcie z poprzedniego, potem zapis w nowym.
    func move(rows:[Row]) {
        guard !busy,authorized,let target=calendar(selectedCalendar),target.calendarIdentifier != linkedCalendar else {return}
        var link=load()
        if let previous=calendar(linkedCalendar) {
            guard remove(from:previous,link:link) != nil else {return}
        }
        try? Vault.delete(ownerKey(linkedCalendar))
        link?.items=[:]
        if let link {try? persist(link)}
        publish(link)
        selectedCalendar=target.calendarIdentifier
        if synchronize(rows:rows,calendarID:target.calendarIdentifier) {summary=(summary ?? "")+" Kopię usunięto z poprzedniego kalendarza."}
    }
    /// Liczba kopii w powiązanym kalendarzu — potwierdzenie przed usunięciem.
    func askRemoval() {
        guard authorized,let calendar=self.calendar(linkedCalendar.isEmpty ? selectedCalendar:linkedCalendar) else {error="Nie ma kopii do usunięcia.";return}
        let count=wideCopies(in:calendar,link:load()).count
        guard count>0 else {
            summary="W kalendarzu „\(calendar.title)” nie ma wpisów utworzonych przez Mavinci."
            if var link=load() {link.items=[:];link.automatic=false;try? persist(link);publish(link)}
            return
        }
        removal=CalendarRemoval(calendarID:calendar.calendarIdentifier,title:calendar.title,count:count)
    }
    /// Usunięcie wszystkich kopii Mavinci z kalendarza; automatyczna aktualizacja zostaje wyłączona (inaczej kopia by wróciła).
    func removeCopies(_ request:CalendarRemoval) {
        removal=nil
        guard !busy,authorized,let calendar=self.calendar(request.calendarID) else {return}
        var link=load()
        guard let removed=remove(from:calendar,link:link) else {return}
        try? Vault.delete(ownerKey(calendar.calendarIdentifier))
        link?.items=[:];link?.automatic=false;link?.lastSync=nil
        if let link {try? persist(link)}
        publish(link)
        signature=""
        summary="Usunięto \(Self.count(removed)) z kalendarza „\(calendar.title)”. Eventy w CRM i inne wpisy tego kalendarza zostały bez zmian."
    }
    private func remove(from calendar:EKCalendar,link:CalendarLink?) -> Int? {
        busy=true;error=nil;summary=nil
        defer {busy=false}
        let found=wideCopies(in:calendar,link:link)
        do {
            for event in found {try store.remove(event,span:.thisEvent,commit:false)}
            try store.commit()
            return found.count
        } catch {
            store.reset()
            self.error="Nie udało się usunąć kopii z kalendarza „\(calendar.title)”. Nic nie zostało zmienione."
            return nil
        }
    }

    static func signature(_ rows:[Row]) -> String {
        digest(rows.map {[$0.id,$0.title,$0["event_date"],$0["event_end_date"],$0["location"],$0["status"]].joined(separator:"\u{1f}")}.sorted().joined(separator:"\u{1e}"))
    }
    /// „1 wpis”, „3 wpisy”, „5 wpisów”.
    static func count(_ n:Int) -> String {
        if n == 1 {return "1 wpis"}
        let tens=n%100,units=n%10
        return "\(n) "+((2...4).contains(units) && !(12...14).contains(tens) ? "wpisy":"wpisów")
    }
}

extension Workspace {
    /// Link subskrypcji kalendarza CRM tego pracownika (RLS: tylko własny wiersz). `nil`, gdy nie da się sprawdzić.
    func calendarFeedStatus() async -> CalendarFeedStatus? {
        guard connection.provider == .supabase,let backend=nativeAPI()?.backend,let id=employee?.id else {return nil}
        let query=[URLQueryItem(name:"select",value:"created_at,last_used_at"),URLQueryItem(name:"employee_id",value:"eq.\(id)"),URLQueryItem(name:"limit",value:"1")]
        guard let data=try? await backend.request("/rest/v1/calendar_feed_tokens",query:query),
              let rows=try? JSONDecoder().decode([[String:JSONValue]].self,from:data) else {return nil}
        guard let row=rows.first else {return CalendarFeedStatus(exists:false)}
        return CalendarFeedStatus(exists:true,created:ChatDates.parse(row["created_at"]?.text),lastUsed:ChatDates.parse(row["last_used_at"]?.text))
    }
}

// MARK: Okno „Kalendarz Apple”

@MainActor struct AppleCalendarSettings:View {
    @ObservedObject var workspace:Workspace
    @ObservedObject var apple:AppleCalendarLink
    var close:() -> Void

    private var employeeID:String {workspace.employee?.id ?? ""}
    private var selected:EKCalendar? {apple.calendar(apple.selectedCalendar)}
    private var linked:EKCalendar? {apple.calendar(apple.linkedCalendar)}
    private var moving:Bool {apple.hasCopy && !apple.selectedCalendar.isEmpty && apple.selectedCalendar != apple.linkedCalendar}
    private var dataReady:Bool {
        // Tryb testowy „widok jako”: wpisy oglądanej osoby nie trafiają do Kalendarza Apple administratora.
        workspace.testMode == nil && workspace.canWrite && workspace.moduleErrors["calendar"] == nil && workspace.snapshot?.collections["calendar"]?.lastSync != nil
    }
    /// Kopia trafi (albo już trafia) na inne urządzenia — iCloud lub inne konto.
    private var synced:Bool {(selected ?? linked).map {!AppleCalendarLink.isLocal($0)} ?? false}
    private var subscribedElsewhere:Bool {!apple.subscriptions.isEmpty || apple.feed?.exists == true}

    var body:some View {
        VStack(alignment:.leading,spacing:16) {
            Text("Kalendarz Apple").font(.title2.bold())
            Text("Aplikacja kopiuje nazwy, terminy i miejsca eventów oraz Twoich spotkań z CRM do wybranego kalendarza. Kopia jest tylko do odczytu — zmiany w Kalendarzu Apple nie trafiają do CRM, a prywatne wpisy z Maca nie są przesyłane.")
                .font(.callout).fixedSize(horizontal:false,vertical:true)
            if workspace.testMode != nil {
                Text("Tryb testowy: kopiowanie do Kalendarza Apple jest wyłączone — wpisy oglądanej osoby nie trafią do Twojego kalendarza.")
                    .font(.callout).foregroundStyle(.orange).fixedSize(horizontal:false,vertical:true)
            }
            if !apple.authorized || apple.calendars.isEmpty {
                Button("Zezwól na połączenie z Kalendarzem") {
                    Task {await apple.prepare(employee:employeeID,identity:workspace.connection.identity)}
                }.disabled(apple.busy || employeeID.isEmpty || workspace.testMode != nil)
            } else {
                target
                duplicates
                copyState
            }
            if let error=apple.error {Text(error).foregroundStyle(.red).font(.callout).fixedSize(horizontal:false,vertical:true)}
            if let summary=apple.summary {Text(summary).foregroundStyle(.green).font(.callout).fixedSize(horizontal:false,vertical:true)}
            if apple.busy {ProgressView().controlSize(.small)}
            HStack {
                Button("Otwórz Kalendarz Apple") {
                    if let url=NSWorkspace.shared.urlForApplication(withBundleIdentifier:"com.apple.iCal") {NSWorkspace.shared.openApplication(at:url,configuration:NSWorkspace.OpenConfiguration())}
                }
                Spacer()
                Button("Gotowe",action:close).keyboardShortcut(.defaultAction)
            }
        }
        .padding(28).frame(width:640)
        .task(id:employeeID) {
            guard !employeeID.isEmpty else {return}
            apple.open(employee:employeeID,identity:workspace.connection.identity)
            apple.feed=await workspace.calendarFeedStatus()
        }
        .confirmationDialog("Usunąć kopię z kalendarza „\(apple.removal?.title ?? "")”?",isPresented:Binding(get:{apple.removal != nil},set:{if !$0 {apple.removal=nil}}),presenting:apple.removal) {request in
            Button("Usuń \(AppleCalendarLink.count(request.count))",role:.destructive) {apple.removeCopies(request)}
            Button("Anuluj",role:.cancel) {apple.removal=nil}
        } message: {request in
            Text("Zostaną usunięte tylko wpisy utworzone przez aplikację Mavinci (\(AppleCalendarLink.count(request.count))). Eventy w CRM i pozostałe wpisy tego kalendarza zostają bez zmian. Automatyczna aktualizacja zostanie wyłączona.")
        }
    }

    private var target:some View {
        VStack(alignment:.leading,spacing:8) {
            Picker("Kalendarz docelowy",selection:$apple.selectedCalendar) {
                Text("Wybierz…").tag("")
                ForEach(apple.calendars,id:\.calendarIdentifier) {calendar in
                    Text(AppleCalendarLink.isLocal(calendar) ? "\(calendar.title) — tylko ten Mac":"\(calendar.title) — \(calendar.source.title)").tag(calendar.calendarIdentifier)
                }
            }
            if let calendar=selected {
                Label(AppleCalendarLink.isLocal(calendar)
                      ? "„\(calendar.title)” jest tylko na tym Macu — kopia nie pojawi się na iPhonie ani w Apple Watch."
                      : "„\(calendar.title)” należy do konta „\(calendar.source.title)” — kopia pojawi się też na iPhonie i w Apple Watch, jeśli to konto jest na nich włączone.",
                      systemImage:AppleCalendarLink.isLocal(calendar) ? "desktopcomputer":"icloud")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            }
            HStack {
                if apple.localSource != nil {
                    Button("Utwórz kalendarz „Mavinci CRM” tylko na tym Macu") {apple.createCalendar(local:true)}.disabled(apple.busy)
                } else {
                    Button("Utwórz osobny kalendarz „Mavinci CRM”") {apple.createCalendar(local:false)}.disabled(apple.busy)
                }
            }
        }
    }

    /// Ostrzeżenie o podwójnych wpisach: kopia w kalendarzu synchronizowanym z telefonem + subskrypcja CRM.
    @ViewBuilder private var duplicates:some View {
        if synced && subscribedElsewhere {
            VStack(alignment:.leading,spacing:6) {
                Label("Uwaga na podwójne wpisy na iPhonie i w zegarku",systemImage:"exclamationmark.triangle.fill").font(.callout.weight(.semibold)).foregroundStyle(.orange)
                Text(duplicateReason).font(.caption).fixedSize(horizontal:false,vertical:true)
                Text("Jeśli kalendarz CRM jest subskrybowany na iPhonie, każdy event widać tam (i w Apple Watch) dwa razy: z subskrypcji i z tej kopii. Zostaw jedno źródło — trzymaj kopię w kalendarzu tylko na tym Macu albo usuń kopię i korzystaj z subskrypcji.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
            }
            .padding(10).frame(maxWidth:.infinity,alignment:.leading)
            .background(Color.orange.opacity(0.1),in:RoundedRectangle(cornerRadius:8))
        }
    }
    private var duplicateReason:String {
        var parts:[String]=[]
        if !apple.subscriptions.isEmpty {parts.append("Na tym Macu jest subskrypcja: \(apple.subscriptions.map {"„\($0)”"}.joined(separator:", ")).")}
        if let feed=apple.feed,feed.exists {
            if let used=feed.lastUsed,feed.active {
                parts.append("Link subskrypcji kalendarza CRM był pobierany \(Self.relative(used)) — subskrypcja działa na którymś urządzeniu (np. iPhonie).")
            } else {
                parts.append("Masz link subskrypcji kalendarza CRM (CRM → Ustawienia → Kalendarz)"+(feed.created.map {", utworzony \(CalendarDates.title($0,format:"d MMMM yyyy"))"} ?? "")+".")
            }
        }
        return parts.joined(separator:" ")
    }
    private static func relative(_ date:Date) -> String {
        let f=RelativeDateTimeFormatter();f.locale=Locale(identifier:"pl_PL");f.unitsStyle = .full
        return f.localizedString(for:date,relativeTo:Date())
    }

    private func copyLine(_ calendar:EKCalendar) -> String {
        var line="Kopia jest w kalendarzu „\(calendar.title)”"
        if let date=apple.lastSync {line += " · ostatnia aktualizacja \(CalendarDates.title(date,format:"d MMMM yyyy, HH:mm"))"}
        return line+"."
    }
    private var copyState:some View {
        VStack(alignment:.leading,spacing:10) {
            if let current=linked {
                Text(copyLine(current)).font(.caption).foregroundStyle(.secondary)
            } else if apple.hasCopy {
                Text("Kalendarz z poprzednią kopią nie jest już dostępny — wybierz kalendarz i zsynchronizuj ponownie.").font(.caption).foregroundStyle(.secondary)
            }
            Toggle("Aktualizuj kopię automatycznie po każdym odświeżeniu danych",isOn:Binding(get:{apple.automatic},set:{apple.setAutomatic($0)}))
                .disabled(!apple.hasCopy || apple.busy)
                .help("Nowe, przesunięte i odwołane eventy zmieniają się w kopii bez klikania „Synchronizuj teraz”.")
            HStack {
                if moving {
                    Button("Przenieś kopię do „\(selected?.title ?? "")”") {apple.move(rows:workspace.rows(.calendar))}
                        .disabled(apple.busy || !dataReady)
                } else {
                    Button("Synchronizuj teraz") {apple.synchronize(rows:workspace.rows(.calendar))}
                        .disabled(apple.busy || apple.selectedCalendar.isEmpty || !dataReady)
                }
                if apple.hasCopy {
                    Button("Usuń kopię z kalendarza…",role:.destructive) {apple.askRemoval()}.disabled(apple.busy)
                }
            }
            Text("Ponowna synchronizacja aktualizuje tę samą kopię (jeden wpis na event). Usuwane są wyłącznie wpisy utworzone przez Mavinci.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
        }
    }
}

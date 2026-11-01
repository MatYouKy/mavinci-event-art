import SwiftUI
import EventKit
import AppKit

@MainActor struct CalendarDates {
    private static var parsed:[String:Date]=[:]
    static var calendar:Calendar { var c=Calendar(identifier:.gregorian);c.locale=Locale(identifier:"pl_PL");c.timeZone=TimeZone(identifier:"Europe/Warsaw")!;c.firstWeekday=2;return c }
    static func date(_ raw:String) -> Date? {
        if let existing=parsed[raw] {return existing}
        guard !raw.isEmpty else {return nil}
        func remember(_ date:Date) -> Date {
            if parsed.count>4096 {parsed.removeAll(keepingCapacity:true)}
            parsed[raw]=date;return date
        }
        let iso=ISO8601DateFormatter();iso.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        if let d=iso.date(from:raw) {return remember(d)};iso.formatOptions=[.withInternetDateTime]
        if let d=iso.date(from:raw) {return remember(d)}
        for format in ["yyyy-MM-dd'T'HH:mm:ss","yyyy-MM-dd"] {
            let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.timeZone=calendar.timeZone;f.dateFormat=format
            if let d=f.date(from:raw) {return remember(d)}
        };return nil
    }
    static func title(_ date:Date,format:String) -> String { let f=DateFormatter();f.locale=calendar.locale;f.timeZone=calendar.timeZone;f.dateFormat=format;return f.string(from:date) }
}
struct CalendarDay:Identifiable { let id:Int;let date:Date? }
struct CalendarLink:Codable {
    var calendarID:String
    var items:[String:String]=[:]
    var lastSync:Date?
}
@MainActor final class AppleCalendarLink:ObservableObject {
    @Published var calendars:[EKCalendar]=[]
    @Published var busy=false
    @Published var error:String?
    @Published var summary:String?
    @Published var selectedCalendar=""
    private let store=EKEventStore()
    func prepare() async {
        busy=true;error=nil
        defer {busy=false}
        guard Bundle.main.object(forInfoDictionaryKey:"NSCalendarsFullAccessUsageDescription") != nil else {
            error="Integracja z Kalendarzem wymaga uruchomienia pakietu .app. W trybie developerskim uruchom scripts/dev-app.sh.";return
        }
        do {
            let granted=try await store.requestFullAccessToEvents()
            guard granted else {error="Zezwól aplikacji na dostęp do kalendarzy w Ustawieniach systemowych → Prywatność i ochrona → Kalendarze.";return}
            calendars=store.calendars(for:.event).filter(\.allowsContentModifications).sorted {$0.title.localizedStandardCompare($1.title) == .orderedAscending}
        } catch {self.error="Nie udało się uzyskać dostępu do Kalendarza macOS."}
    }
    func createCalendar() {
        do {
            guard let source=store.sources.first(where:{$0.sourceType == .local}) ?? store.defaultCalendarForNewEvents?.source else {error="Dodaj najpierw kalendarz lokalny lub konto w aplikacji Kalendarz.";return}
            let calendar=EKCalendar(for:.event,eventStore:store);calendar.title="Mavinci CRM";calendar.source=source;calendar.cgColor=NSColor.controlAccentColor.cgColor
            try store.saveCalendar(calendar,commit:true)
            calendars=store.calendars(for:.event).filter(\.allowsContentModifications)
            selectedCalendar=calendar.calendarIdentifier
        } catch {self.error="Nie udało się utworzyć kalendarza Mavinci. Możesz wybrać istniejący zapisywalny kalendarz."}
    }
    func synchronize(rows:[Row],namespace:String) {
        guard !busy,EKEventStore.authorizationStatus(for:.event) == .fullAccess,
              let calendar=store.calendar(withIdentifier:selectedCalendar),calendar.allowsContentModifications else {error="Wybierz kalendarz do zapisu.";return}
        busy=true;error=nil;summary=nil
        defer {busy=false}
        let key="apple-calendar-\(namespace)"
        do {
            var link=CalendarLink(calendarID:calendar.calendarIdentifier)
            if let saved=try Vault.read(key),let previous=try? JSONDecoder().decode(CalendarLink.self,from:saved) {
                guard previous.calendarID == calendar.calendarIdentifier || previous.items.isEmpty else {error="To konto jest już powiązane z innym kalendarzem. Wybierz poprzedni kalendarz, aby uniknąć drugiej kopii.";return}
                link=previous
            }
            let marker="Mavinci CRM • \(namespace)"
            var ids=Set<String>();var count=0
            for row in rows where !["cancelled","rejected"].contains(row["status"]) {
                guard let start=CalendarDates.date(row["event_date"]) else {throw AppError.invalidResponse}
                let end=CalendarDates.date(row["event_end_date"]) ?? start.addingTimeInterval(3600)
                let sourceID=row["source_id"].isEmpty ? row.id:row["source_id"]
                let host=row["kind"] == "meeting" ? "meeting":"event"
                let url=URL(string:"mavinci://\(host)/\(sourceID)?account=\(namespace)")!
                let previous=link.items[row.id].flatMap {store.calendarItem(withIdentifier:$0) as? EKEvent}
                let event:EKEvent
                if let previous,previous.calendar.calendarIdentifier == calendar.calendarIdentifier,previous.url == url,previous.notes?.contains(marker) == true {event=previous}
                else {
                    let predicate=store.predicateForEvents(withStart:start.addingTimeInterval(-86_400),end:max(end,start.addingTimeInterval(3600)).addingTimeInterval(86_400),calendars:[calendar])
                    event=store.events(matching:predicate).first(where:{$0.url == url && $0.notes?.contains(marker) == true}) ?? EKEvent(eventStore:store)
                }
                event.calendar=calendar;event.title=row.title;event.startDate=start;event.endDate=max(end,start.addingTimeInterval(60));event.location=row["location"]
                event.timeZone=CalendarDates.calendar.timeZone;event.url=url;event.notes="\(marker)\nDane pochodzą z CRM. Zmiany w tej kopii nie zmieniają wydarzenia w CRM."
                // Meeting occurrences are already materialized by CRM. Do not add another recurrence rule.
                event.recurrenceRules=nil
                try store.save(event,span:.thisEvent,commit:true)
                link.items[row.id]=event.calendarItemIdentifier;ids.insert(row.id);count+=1
                // Checkpoint each confirmed write; the URL marker also recovers an interrupted checkpoint.
                try Vault.write(key,JSONEncoder().encode(link))
            }
            for (id,itemID) in link.items where !ids.contains(id) {
                if let event=store.calendarItem(withIdentifier:itemID) as? EKEvent,
                   event.calendar.calendarIdentifier == calendar.calendarIdentifier,event.notes?.contains(marker) == true {
                    try store.remove(event,span:.thisEvent,commit:true)
                }
                link.items.removeValue(forKey:id)
                try Vault.write(key,JSONEncoder().encode(link))
            }
            link.lastSync=Date();try Vault.write(key,JSONEncoder().encode(link))
            summary="Zaktualizowano \(count) wpisów w kalendarzu „\(calendar.title)”."
        } catch {store.reset();self.error="Synchronizacja kalendarza nie została zakończona. Potwierdzone wpisy zachowano; możesz ponowić synchronizację bez tworzenia drugiej kopii."}
    }
    func restoreChoice(namespace:String) {
        guard let data=try? Vault.read("apple-calendar-\(namespace)"),let link=try? JSONDecoder().decode(CalendarLink.self,from:data) else {return}
        selectedCalendar=link.calendarID
    }
}
@MainActor struct NativeCalendarView:View {
    @EnvironmentObject var workspace:Workspace
    @StateObject private var apple=AppleCalendarLink()
    @State private var month=Date()
    @State private var selectedDate=Date()
    @State private var calendarSheet=false
    @State private var meeting:Row?
    private var c:Calendar {CalendarDates.calendar}
    private var rows:[Row] {
        var rows=workspace.rows(.calendar)
        if workspace.employee?.canView(.inquiries) == true {
            for item in workspace.rows(.inquiries) where !["won","lost","completed"].contains(item.status) {
                let date=item["next_action_at"].isEmpty ? item["due_date"]:item["next_action_at"]
                guard !date.isEmpty else {continue}
                var f=item.fields;f["id"] = .string("inquiry:\(item.id)");f["source_id"] = .string(item.id);f["kind"] = .string("inquiry");f["event_date"] = .string(date);f["event_end_date"] = .null
                rows.append(Row(f))
            }
        }
        return rows.sorted {$0["event_date"]<$1["event_date"]}
    }
    private var days:[CalendarDay] {
        guard let first=c.date(from:c.dateComponents([.year,.month],from:month)),let range=c.range(of:.day,in:.month,for:first) else {return []}
        let leading=(c.component(.weekday,from:first)-c.firstWeekday+7)%7
        let total=((leading+range.count+6)/7)*7
        return (0..<total).map { n in CalendarDay(id:n,date:n>=leading && n<leading+range.count ? c.date(byAdding:.day,value:n-leading,to:first):nil) }
    }
    var body:some View {
        VStack(spacing:0) {
            if let error=workspace.moduleErrors["calendar"] { Text(error).foregroundStyle(.orange).padding(10) }
            HStack {
                Button { move(-1) } label:{Image(systemName:"chevron.left")}.help("Poprzedni miesiąc")
                Button("Dziś") {month=Date();selectedDate=Date()}
                Button {move(1)} label:{Image(systemName:"chevron.right")}.help("Następny miesiąc")
                Text(CalendarDates.title(month,format:"LLLL yyyy").capitalized).font(.title2.bold()).padding(.leading,12)
                Spacer()
                Button("Połącz z Kalendarzem Apple…",systemImage:"calendar.badge.clock") {calendarSheet=true}
            }.padding(16).background(.bar)
            HSplitView {
                ScrollView {
                    LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:4),count:7),spacing:5) {
                        ForEach(["Pon","Wt","Śr","Czw","Pt","Sob","Nd"],id:\.self) {Text($0).font(.caption.bold()).foregroundStyle(.secondary).frame(maxWidth:.infinity).padding(.vertical,8)}
                        ForEach(days) { day in
                            if let date=day.date {dayCell(date)} else {Color.clear.frame(height:104)}
                        }
                    }.padding(14)
                }.frame(minWidth:590,maxWidth:.infinity,maxHeight:.infinity)
                VStack(alignment:.leading,spacing:0) {
                    Text(CalendarDates.title(selectedDate,format:"EEEE, d MMMM").capitalized).font(.headline).padding(16)
                    List(dayRows(selectedDate)) { row in
                        Button {open(row)} label: {
                            VStack(alignment:.leading,spacing:5) {
                                Label(row.title,systemImage:row["kind"] == "meeting" ? "person.2":row["kind"] == "inquiry" ? "phone":"calendar").font(.headline)
                                Text(Labels.date(row["event_date"])).font(.caption).foregroundStyle(.secondary)
                                if !row["location"].isEmpty {Text(row["location"]).font(.caption).foregroundStyle(.secondary)}
                            }.padding(.vertical,6).frame(maxWidth:.infinity,alignment:.leading).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }.overlay {if dayRows(selectedDate).isEmpty {ContentUnavailableView("Brak spraw tego dnia",systemImage:"calendar")}}
                }.frame(minWidth:300,idealWidth:360,maxWidth:480,maxHeight:.infinity)
            }.frame(maxWidth:.infinity,maxHeight:.infinity)
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.top).navigationTitle("Kalendarz")
        .onAppear {revealTarget()}
        .onChange(of:workspace.focusedID) {_,_ in revealTarget()}
        .sheet(isPresented:$calendarSheet) {calendarSettings}
        .sheet(item:$meeting) {row in VStack(alignment:.leading,spacing:16) {Text(row.title).font(.title2.bold());EventRecordFields(row:row);Button("Zamknij") {meeting=nil}}.padding(24).frame(width:540)}
    }
    private func dayRows(_ day:Date) -> [Row] {
        let interval=c.dateInterval(of:.day,for:day)!
        return rows.filter { row in
            guard let start=CalendarDates.date(row["event_date"]) else {return false}
            let end=CalendarDates.date(row["event_end_date"]) ?? start.addingTimeInterval(1)
            return start<interval.end && max(start.addingTimeInterval(1),end)>interval.start
        }
    }
    private func dayCell(_ date:Date) -> some View {
        let items=dayRows(date)
        return Button {selectedDate=date} label: {
            VStack(alignment:.leading,spacing:5) {
                HStack {Text("\(c.component(.day,from:date))").font(.callout.bold()).foregroundStyle(c.isDateInToday(date) ? Color.accentColor:Color.primary);Spacer();if items.count>2 {Text("+\(items.count-2)").font(.caption2).foregroundStyle(.secondary)}}
                ForEach(Array(items.prefix(2))) {row in Text(row.title).font(.caption2).lineLimit(2).frame(maxWidth:.infinity,alignment:.leading).foregroundStyle(row["kind"] == "inquiry" ? Color.orange:Color.primary)}
                Spacer(minLength:0)
            }.padding(8).frame(maxWidth:.infinity,minHeight:104,maxHeight:104,alignment:.topLeading)
                .background(c.isDate(date,inSameDayAs:selectedDate) ? Color.accentColor.opacity(0.16):Color.secondary.opacity(0.05),in:RoundedRectangle(cornerRadius:6))
        }.buttonStyle(.plain).accessibilityLabel(CalendarDates.title(date,format:"d MMMM yyyy")+", \(items.count) spraw")
    }
    private var calendarSettings:some View {
        VStack(alignment:.leading,spacing:18) {
            Text("Kalendarz Apple").font(.title2.bold())
            Text("Kopiuj nazwy, terminy i miejsca wydarzeń oraz swoich spotkań do wybranego kalendarza. Wybierając kalendarz iCloud lub innego konta, zapiszesz je również w tym koncie. Prywatne wpisy z Maca nie są przesyłane do CRM.").font(.callout)
            if apple.calendars.isEmpty {
                Button("Zezwól na połączenie z Kalendarzem") {Task {await apple.prepare();if let e=workspace.employee {apple.restoreChoice(namespace:digest(workspace.connection.identity+"|"+e.id))}}}.disabled(apple.busy)
            } else {
                Picker("Kalendarz docelowy",selection:$apple.selectedCalendar) {Text("Wybierz…").tag("");ForEach(apple.calendars,id:\.calendarIdentifier) {calendar in Text("\(calendar.title) — \(calendar.source.title)").tag(calendar.calendarIdentifier)}}
                Button("Utwórz osobny kalendarz Mavinci CRM") {apple.createCalendar()}.disabled(apple.busy)
                Text("Ponowna synchronizacja aktualizuje tę samą kopię. Znikające i anulowane sprawy są usuwane wyłącznie spośród wpisów utworzonych przez to powiązanie. Zmiany wykonane w Apple nie nadpisują CRM.").font(.caption).foregroundStyle(.secondary)
                Button("Synchronizuj teraz") {
                    guard let e=workspace.employee else {return}
                    apple.synchronize(rows:workspace.rows(.calendar),namespace:digest(workspace.connection.identity+"|"+e.id))
                }.disabled(apple.busy || apple.selectedCalendar.isEmpty || !workspace.canWrite || workspace.moduleErrors["calendar"] != nil || workspace.snapshot?.collections["calendar"]?.lastSync == nil)
            }
            if let error=apple.error {Text(error).foregroundStyle(.red).font(.callout)}
            if let summary=apple.summary {Text(summary).foregroundStyle(.green).font(.callout)}
            if apple.busy {ProgressView().controlSize(.small)}
            HStack {Button("Otwórz Kalendarz Apple") {if let url=NSWorkspace.shared.urlForApplication(withBundleIdentifier:"com.apple.iCal") {NSWorkspace.shared.openApplication(at:url,configuration:NSWorkspace.OpenConfiguration())}};Spacer();Button("Gotowe") {calendarSheet=false}.keyboardShortcut(.defaultAction)}
        }.padding(28).frame(width:620)
    }
    private func revealTarget() {
        guard let target=workspace.focusedID,let row=rows.first(where:{$0.id==target}),let date=CalendarDates.date(row["event_date"]) else {return}
        month=date;selectedDate=date;if row["kind"] == "meeting" {meeting=row}
    }
    private func move(_ offset:Int) {if let next=c.date(byAdding:.month,value:offset,to:month) {month=next}}
    private func open(_ row:Row) {
        switch row["kind"] {
        case "meeting":meeting=row
        case "inquiry":workspace.open(.inquiries,id:row["source_id"])
        default:workspace.showEvent(row["source_id"].isEmpty ? row.id:row["source_id"])
        }
    }
}

import SwiftUI
import EventKit
import AppKit

@MainActor struct CalendarDates {
    /// Odczytane daty (także nieczytelne — `nil`), żeby listy z tysiącami wierszy (przetargi, wydarzenia, oferty) nie tworzyły
    /// formaterów przy każdym odświeżeniu widoku. Przy przepełnieniu pamięć jest czyszczona w całości.
    private static var parsed:[String:Date?]=[:]
    static let calendar:Calendar = { var c=Calendar(identifier:.gregorian);c.locale=Locale(identifier:"pl_PL");c.timeZone=TimeZone(identifier:"Europe/Warsaw")!;c.firstWeekday=2;return c }()
    private static let fractional:ISO8601DateFormatter = { let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime,.withFractionalSeconds];return f }()
    private static let internet:ISO8601DateFormatter = { let f=ISO8601DateFormatter();f.formatOptions=[.withInternetDateTime];return f }()
    // Termin zapytania z CRM bywa zapisany bez sekund (`2027-01-08T19:00`, czas polski).
    private static let local:[DateFormatter] = ["yyyy-MM-dd'T'HH:mm:ss","yyyy-MM-dd'T'HH:mm","yyyy-MM-dd"].map { format in
        let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.timeZone=TimeZone(identifier:"Europe/Warsaw")!;f.dateFormat=format;return f
    }
    static func date(_ raw:String) -> Date? {
        guard !raw.isEmpty else {return nil}
        if let known=parsed[raw] {return known}
        let value=fractional.date(from:raw) ?? internet.date(from:raw) ?? local.lazy.compactMap{$0.date(from:raw)}.first
        if parsed.count>=50_000 {parsed.removeAll(keepingCapacity:true)}
        parsed[raw]=value
        return value
    }
    static func title(_ date:Date,format:String) -> String { let f=DateFormatter();f.locale=calendar.locale;f.timeZone=calendar.timeZone;f.dateFormat=format;return f.string(from:date) }
    /// Dni kalendarza zajmowane przez wpis — ta sama reguła co `calendarDaySpan` w CRM (`src/lib/CRM/calendar/calendarDays.ts`)
    /// i w aplikacji mobilnej: noc kończąca się najpóźniej o 5:00 należy do dnia rozpoczęcia, więc impreza 18:00–02:00 zajmuje
    /// jeden dzień (w miesiącu nie wygląda jak dwa zarezerwowane terminy). Godziny wpisu bez zmian.
    static func daySpan(start:Date,end:Date?,in c:Calendar) -> (first:Date,count:Int) {
        let first=c.startOfDay(for:start)
        guard let end,end>start else {return (first,1)}
        var extra:Int=c.dateComponents([.day],from:first,to:c.startOfDay(for:end)).day ?? 0
        let time=c.dateComponents([.hour,.minute],from:end)
        let minutes:Int=(time.hour ?? 0)*60+(time.minute ?? 0)
        if extra>0 && minutes<=overnightEndLimit {extra-=1}
        return (first,max(extra,0)+1)
    }
    /// Najpóźniejsze zakończenie nocy (minuty od północy): 5:00.
    static let overnightEndLimit=5*60
    static func occupies(_ day:Date,start:Date,end:Date?,in c:Calendar) -> Bool {
        let span=daySpan(start:start,end:end,in:c)
        let offset:Int=c.dateComponents([.day],from:span.first,to:c.startOfDay(for:day)).day ?? -1
        return offset>=0 && offset<span.count
    }
}
struct CalendarDay:Identifiable { let id:Int;let date:Date? }
@MainActor struct NativeCalendarView:View {
    @EnvironmentObject var workspace:Workspace
    /// Nawigacja okna, w którym jest widok (inne okna mają własną).
    @EnvironmentObject private var nav: WindowNavigation
    @State private var month=Date()
    @State private var selectedDate=Date()
    @State private var calendarSheet=false
    @State private var meeting:Row?
    /// Nowy wpis z kalendarza: wybór rodzaju, kreator wydarzenia albo formularz spotkania.
    @State private var creation:CalendarCreation?
    /// Dzień pod kursorem — pokazuje „+” w komórce.
    @State private var hoveredDay:Date?
    /// „Potencjalne zapytania: widoczne / ukryte” jak filtr kalendarza w CRM.
    @AppStorage("calendar.potentialInquiries") private var showInquiries=true
    private var c:Calendar {CalendarDates.calendar}
    private var canSeeInquiries:Bool {workspace.employee?.canView(.inquiries) == true}
    private var rows:[Row] {
        var rows=workspace.rows(.calendar)
        if showInquiries && canSeeInquiries {
            rows += workspace.inquiries.inquiries.compactMap(NativeCalendarView.inquiryRow)
        }
        return rows.sorted {$0["event_date"]<$1["event_date"]}
    }
    /// Zapytanie jako wpis kalendarza — jak `fetchCalendarEvents` w CRM: termin z zapytania (albo termin zadania), tylko bez
    /// wydarzenia i poza etapami wygrane / przegrane; tytuł „Potencjalne · …”, kolor bursztynowy, linia przerywana.
    static func inquiryRow(_ item:Inquiry) -> Row? {
        guard item.eventId == nil, item.stage != "won", item.stage != "lost" else {return nil}
        let termin:String=item.termin ?? ""
        let raw:String=termin.isEmpty ? (item.dueDate ?? ""):termin
        guard !raw.isEmpty else {return nil}
        // Godzina z terminu (`2027-01-08T19:00`, czas polski) w zapisie ISO — tak samo czytają ją kalendarz i opis wpisu.
        var date:String=raw
        if raw.count > 10, let parsed=CalendarDates.date(raw) {date=ISO8601DateFormatter().string(from:parsed)}
        let subject:String=item.title.replacingOccurrences(of:#"^Zapytanie:\s*"#,with:"",options:[.regularExpression,.caseInsensitive])
        let stage=InquiryStage(raw:item.stage)
        let client:String=item.clientLabel ?? ""
        var details:[String]=[client.isEmpty ? "nieznany klient":client,stage.label]
        if item.probability > 0 {details.append("szansa \(item.probability)%")}
        var f:[String:JSONValue]=[:]
        f["id"] = .string("inquiry:\(item.id)")
        f["source_id"] = .string(item.id)
        f["kind"] = .string("inquiry")
        f["title"] = .string("Potencjalne · \(subject.isEmpty ? "Zapytanie":subject)")
        f["event_date"] = .string(date)
        f["event_end_date"] = .string(date)
        f["location"] = .string(item.locationText)
        f["color"] = .string("#f59e0b")
        f["inquiry_details"] = .string(details.joined(separator:" · "))
        return Row(f)
    }
    private var monthStart:Date {c.date(from:c.dateComponents([.year,.month],from:month)) ?? month}
    /// Dni siatki miesiąca (od poniedziałku; puste pola przed pierwszym dniem).
    private func gridDays(_ anyDay:Date) -> [CalendarDay] {
        guard let first=c.date(from:c.dateComponents([.year,.month],from:anyDay)),let range=c.range(of:.day,in:.month,for:first) else {return []}
        let leading=(c.component(.weekday,from:first)-c.firstWeekday+7)%7
        let total=((leading+range.count+6)/7)*7
        return (0..<total).map { n in CalendarDay(id:n,date:n>=leading && n<leading+range.count ? c.date(byAdding:.day,value:n-leading,to:first):nil) }
    }
    /// Wpisy dni widocznych w miesiącu i dwóch kolejnych (miniatury) — liczone raz na odświeżenie widoku, ta sama reguła dni.
    private func dayIndex() -> [Date:[Row]] {
        let calendar=c
        let rangeStart=monthStart
        guard let rangeEnd=calendar.date(byAdding:.month,value:3,to:rangeStart) else {return [:]}
        var index:[Date:[Row]]=[:]
        for row in rows {
            guard let begin=CalendarDates.date(row["event_date"]) else {continue}
            let span=CalendarDates.daySpan(start:begin,end:CalendarDates.date(row["event_end_date"]),in:calendar)
            guard span.first<rangeEnd else {continue}
            for offset in 0..<min(span.count,400) {
                guard let day=calendar.date(byAdding:.day,value:offset,to:span.first),day<rangeEnd else {break}
                if day>=rangeStart {index[day,default:[]].append(row)}
            }
        }
        return index
    }
    /// Kto może tworzyć wydarzenia z kalendarza — jak `canCreateEvents` w CRM (administrator albo `calendar_manage`)
    /// lub uprawnienie z listy wydarzeń.
    private var canCreateEvents:Bool {workspace.employee?.has("calendar_manage") == true || workspace.events.access?.canCreate == true}
    var body:some View {
        let byDay:[Date:[Row]]=dayIndex()
        VStack(spacing:0) {
            if let error=workspace.moduleErrors["calendar"] { Text(error).foregroundStyle(.orange).padding(10) }
            toolbar
            GeometryReader { available in
              let detailWidth=min(340,max(245,available.size.width*0.33))
              HStack(alignment:.top,spacing:0) {
                ScrollView {
                    VStack(alignment:.leading,spacing:18) {
                        monthGrid(byDay)
                        upcomingMonths(byDay)
                    }.padding(14)
                }.frame(width:max(1,available.size.width-detailWidth-1),height:available.size.height)
                Divider()
                dayPanel.frame(width:detailWidth,height:available.size.height)
              }.frame(width:available.size.width,height:available.size.height,alignment:.topLeading)
            }.frame(maxWidth:.infinity,maxHeight:.infinity)
        }.frame(maxWidth:.infinity,maxHeight:.infinity,alignment:.top).navigationTitle("Kalendarz")
        .onAppear {revealTarget()}
        .task(id:workspace.employee?.id) {if canSeeInquiries {await workspace.inquiries.backgroundSync()}}
        .onChange(of:nav.focusedID) {_,_ in revealTarget()}
        .sheet(isPresented:$calendarSheet) {
            AppleCalendarSettings(workspace:workspace,apple:workspace.appleCalendar) {calendarSheet=false}
                .environmentObject(workspace).environment(\.crmTheme,workspace.theme).tint(workspace.theme.accent)
        }
        .sheet(item:$meeting) {row in VStack(alignment:.leading,spacing:16) {Text(row.title).font(.title2.bold());EventRecordFields(row:row);Button("Zamknij") {meeting=nil}}.padding(24).frame(width:540)}
        .sheet(item:$creation,onDismiss:{if creation == nil {Task {await workspace.refresh()}}}) {item in creationSheet(item)}
    }
    private var toolbar:some View {
        HStack {
            Button { move(-1) } label:{Image(systemName:"chevron.left")}.help("Poprzedni miesiąc")
            Button("Dziś") {month=Date();selectedDate=Date()}
            Button {move(1)} label:{Image(systemName:"chevron.right")}.help("Następny miesiąc")
            Text(CalendarDates.title(month,format:"LLLL yyyy").capitalized).font(.title2.bold()).padding(.leading,12)
            Spacer()
            if canSeeInquiries {
                Toggle(isOn:$showInquiries) {Label("Potencjalne zapytania",systemImage:"tray")}.toggleStyle(.button)
                    .help(showInquiries ? "Potencjalne zapytania: widoczne (kliknij, aby ukryć)":"Potencjalne zapytania: ukryte (kliknij, aby pokazać)")
            }
            Button("Połącz z Kalendarzem Apple…",systemImage:"calendar.badge.clock") {calendarSheet=true}
            Button {creation = .chooser(selectedDate)} label:{Label("Dodaj",systemImage:"plus")}
                .buttonStyle(.borderedProminent).keyboardShortcut("n")
                .help("Co chcesz dodać? — event, spotkanie albo zapytanie na wybrany dzień (⌘N)")
        }.padding(16).crmBar()
    }
    private func monthGrid(_ byDay:[Date:[Row]]) -> some View {
        LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:4),count:7),spacing:5) {
            ForEach(["Pon","Wt","Śr","Czw","Pt","Sob","Nd"],id:\.self) {Text($0).font(.caption.bold()).foregroundStyle(.secondary).frame(maxWidth:.infinity).padding(.vertical,8)}
            ForEach(gridDays(month)) { day in
                if let date=day.date {dayCell(date,items:byDay[date] ?? [])} else {Color.clear.frame(height:104)}
            }
        }
    }
    /// Dwa kolejne miesiące w miniaturach (wolne miejsce pod siatką): kropka — dzień z wpisami; kliknięcie przenosi do dnia,
    /// dwuklik — „Co chcesz dodać?” na ten dzień.
    private func upcomingMonths(_ byDay:[Date:[Row]]) -> some View {
        HStack(alignment:.top,spacing:14) {
            ForEach([1,2],id:\.self) { offset in
                miniMonth(c.date(byAdding:.month,value:offset,to:monthStart) ?? monthStart,byDay:byDay)
            }
            Spacer(minLength:0)
        }
    }
    private func miniMonth(_ first:Date,byDay:[Date:[Row]]) -> some View {
        VStack(alignment:.leading,spacing:8) {
            Button {month=first;selectedDate=first} label:{
                Text(CalendarDates.title(first,format:"LLLL yyyy").capitalized).font(.headline)
            }.buttonStyle(.plain).help("Pokaż ten miesiąc")
            LazyVGrid(columns:Array(repeating:GridItem(.flexible(),spacing:2),count:7),spacing:4) {
                ForEach(Array(["P","W","Ś","C","P","S","N"].enumerated()),id:\.offset) {Text($0.element).font(.caption2.bold()).foregroundStyle(.secondary).frame(maxWidth:.infinity)}
                ForEach(gridDays(first)) { day in
                    if let date=day.date {miniDay(date,items:byDay[date] ?? [])} else {Color.clear.frame(height:30)}
                }
            }
        }
        .padding(12).frame(maxWidth:340,alignment:.topLeading)
        .background(RoundedRectangle(cornerRadius:8).fill(Color.secondary.opacity(0.04)))
    }
    private func miniDay(_ date:Date,items:[Row]) -> some View {
        let today:Bool=c.isDateInToday(date)
        let selected:Bool=c.isDate(date,inSameDayAs:selectedDate)
        let dot:Color=items.first.map {WorkspacePresentation.calendarColor($0)} ?? .clear
        let label:String=CalendarDates.title(date,format:"d MMMM")
        let names:String=items.prefix(4).map(\.title).joined(separator:", ")+(items.count>4 ? "…":"")
        let tip:String=items.isEmpty ? label : label+": "+names
        return VStack(spacing:2) {
            Text("\(c.component(.day,from:date))").font(.caption.weight(today ? .bold:.regular)).monospacedDigit()
                .foregroundStyle(today ? Color.accentColor:Color.primary)
            Circle().fill(dot).frame(width:5,height:5)
        }
        .frame(maxWidth:.infinity,minHeight:30)
        .background(RoundedRectangle(cornerRadius:5).fill(selected ? Color.accentColor.opacity(0.15):Color.clear))
        .contentShape(Rectangle())
        .onTapGesture(count:2) {month=date;selectedDate=date;creation = .chooser(date)}
        .onTapGesture {month=date;selectedDate=date}
        .help(tip)
    }
    private var dayPanel:some View {
        VStack(alignment:.leading,spacing:0) {
            HStack {
                Text(CalendarDates.title(selectedDate,format:"EEEE, d MMMM").capitalized).font(.headline)
                Spacer()
                Button {creation = .chooser(selectedDate)} label:{Image(systemName:"plus")}
                    .buttonStyle(.borderless).help("Dodaj event, spotkanie albo zapytanie na ten dzień")
            }.padding(16)
            List(dayRows(selectedDate)) { row in
                Button {open(row)} label: {
                    calendarEntry(row,compact:false)
                }.buttonStyle(.plain)
            }.overlay {
                if dayRows(selectedDate).isEmpty {
                    ContentUnavailableView {
                        Label("Brak spraw tego dnia",systemImage:"calendar")
                    } description: {
                        Text("Kliknij dwukrotnie dzień w kalendarzu albo „Dodaj”, aby utworzyć wpis.")
                    } actions: {
                        Button("Dodaj…") {creation = .chooser(selectedDate)}
                    }
                }
            }
        }
    }
    /// Wpisy dnia — dni zajmowane jak w CRM (`CalendarDates.occupies`): noc do 5:00 należy do dnia rozpoczęcia.
    private func dayRows(_ day:Date) -> [Row] {
        let calendar=c
        return rows.filter { row in
            guard let start=CalendarDates.date(row["event_date"]) else {return false}
            return CalendarDates.occupies(day,start:start,end:CalendarDates.date(row["event_end_date"]),in:calendar)
        }
    }
    /// Dzień siatki: klik — wybór dnia, dwuklik albo „+” (po najechaniu) — „Co chcesz dodać?” jak kliknięcie dnia w CRM,
    /// menu pod prawym przyciskiem — od razu wybrany rodzaj.
    private func dayCell(_ date:Date,items:[Row]) -> some View {
        let hovered:Bool=hoveredDay == date
        return VStack(alignment:.leading,spacing:5){
            HStack{
                Button{selectedDate=date}label:{Text("\(c.component(.day,from:date))").font(.callout.bold()).foregroundStyle(c.isDateInToday(date) ? Color.accentColor:Color.primary)}.buttonStyle(.plain)
                Spacer()
                if hovered {
                    Button {selectedDate=date;creation = .chooser(date)} label:{Image(systemName:"plus.circle.fill")}
                        .buttonStyle(.plain).foregroundStyle(Color.accentColor).help("Dodaj na ten dzień")
                }
                if items.count>2{Button("+\(items.count-2)"){selectedDate=date}.font(.caption2).buttonStyle(.plain).help("Pokaż wszystkie sprawy tego dnia")}
            }
            ForEach(Array(items.prefix(2))){row in
                Button{selectedDate=date;open(row)}label:{calendarEntry(row,compact:true)}.buttonStyle(.plain)
            }
            Spacer(minLength:0)
        }.padding(7).frame(maxWidth:.infinity,minHeight:132,maxHeight:132,alignment:.topLeading)
          .background{
              RoundedRectangle(cornerRadius:6).fill(c.isDate(date,inSameDayAs:selectedDate) ? Color.accentColor.opacity(0.12):Color.secondary.opacity(0.04))
                  .onTapGesture(count:2){selectedDate=date;creation = .chooser(date)}
                  .onTapGesture{selectedDate=date}
          }
          .onHover {inside in if inside {hoveredDay=date} else if hoveredDay == date {hoveredDay=nil}}
          .contextMenu {createMenu(date)}
          .accessibilityElement(children:.contain).accessibilityLabel(CalendarDates.title(date,format:"d MMMM yyyy"))
    }
    /// Rodzaje nowych wpisów — jak „Co chcesz dodać?” (`EventTypeSelector`) w CRM.
    @ViewBuilder private func createMenu(_ date:Date) -> some View {
        if canCreateEvents {
            Button("Nowy event biznesowy…",systemImage:"building.2") {selectedDate=date;start(.business,on:date)}
            Button("Nowy event indywidualny…",systemImage:"person") {selectedDate=date;start(.individual,on:date)}
        }
        Button("Nowe spotkanie…",systemImage:"calendar.badge.plus") {selectedDate=date;start(.meeting,on:date)}
        if canSeeInquiries {
            Button("Nowe zapytanie…",systemImage:"phone.arrow.down.left") {selectedDate=date;start(.inquiry,on:date)}
        }
    }
    @ViewBuilder private func creationSheet(_ item:CalendarCreation) -> some View {
        switch item {
        case .chooser(let date):
            CalendarCreateChooser(date:date,canCreateEvents:canCreateEvents,canCreateInquiries:canSeeInquiries) { kind in start(kind,on:date) }
                .warehouseSheetStyle(workspace)
        case .event(let date,let clientType):
            EventCreateSheet(store:workspace.events,initialDate:date,initialClientType:clientType).warehouseSheetStyle(workspace)
        case .meeting(let request):
            MeetingEditorSheet(store:workspace.meetings,request:request).warehouseSheetStyle(workspace)
        case .inquiry(let date):
            // Jak w kalendarzu CRM: zapytanie z terminem tego dnia; po zapisie lejek (i kalendarz) pobiera zmiany.
            NewInquirySheet(initialDate:date) { created in
                created.announce(workspace)
                Task {await workspace.inquiries.sync(force:true)}
            }.warehouseSheetStyle(workspace)
        }
    }
    /// Wybrany rodzaj na dzień z kalendarza: wydarzenie (kreator z terminem tego dnia), spotkanie (9:00–10:00 jak w CRM)
    /// albo zapytanie — formularz „Nowe zapytanie” z terminem tego dnia.
    private func start(_ kind:CalendarCreateKind,on date:Date) {
        let day=c.startOfDay(for:date)
        switch kind {
        case .business,.individual:
            creation = .event(day,kind.rawValue)
        case .meeting:
            let begin=c.date(bySettingHour:9,minute:0,second:0,of:day) ?? day
            creation = .meeting(MeetingEditorRequest(start:begin,end:begin.addingTimeInterval(3600)))
        case .inquiry:
            creation = .inquiry(day)
        }
    }
    private func calendarEntry(_ row:Row,compact:Bool) -> some View {
        let color=WorkspacePresentation.calendarColor(row)
        return VStack(alignment:.leading,spacing:compact ? 2:6){
            Text(row.title).font(compact ? .caption2.weight(.medium):.callout.weight(.semibold)).lineLimit(compact ? 2:3)
                .foregroundStyle(color).frame(maxWidth:.infinity,alignment:.leading)
            if !compact{
                Text(Labels.date(row["event_date"])).font(.caption).foregroundStyle(.secondary)
                if row["kind"] == "inquiry" && !row["inquiry_details"].isEmpty {Text(row["inquiry_details"]).font(.caption).foregroundStyle(.secondary).lineLimit(2)}
                if !row["location"].isEmpty{Text(row["location"]).font(.caption).foregroundStyle(.secondary).lineLimit(2)}
            }
        }.padding(compact ? 5:10).frame(maxWidth:.infinity,alignment:.leading)
          .background(color.opacity(0.08),in:RoundedRectangle(cornerRadius:5))
          .overlay(RoundedRectangle(cornerRadius:5).strokeBorder(color.opacity(0.5),style:StrokeStyle(lineWidth:1,dash:row["kind"]=="inquiry" ? [3,2]:[])))
    }
    private func revealTarget() {
        guard let target=nav.focusedID,let row=rows.first(where:{$0.id==target}),let date=CalendarDates.date(row["event_date"]) else {return}
        month=date;selectedDate=date;if row["kind"] == "meeting" {meeting=row}
    }
    private func move(_ offset:Int) {if let next=c.date(byAdding:.month,value:offset,to:month) {month=next}}
    private func open(_ row:Row) {
        switch row["kind"] {
        case "meeting":meeting=row
        case "inquiry":workspace.showInquiryWorkspace(row["source_id"])
        default:workspace.showEvent(row["source_id"].isEmpty ? row.id:row["source_id"])
        }
    }
}

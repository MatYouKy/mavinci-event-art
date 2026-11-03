import SwiftUI

@MainActor enum WorkspacePresentation {
    static func color(_ raw: String) -> Color? {
        let text=raw.trimmingCharacters(in:.whitespacesAndNewlines).replacingOccurrences(of:"#",with:"")
        let hex: String
        if text.count==3 {hex=text.map{String(repeating:String($0),count:2)}.joined()} else {hex=text}
        guard hex.count==6 || hex.count==8,let value=UInt64(hex,radix:16) else{return nil}
        let rgb=hex.count==8 ? value>>8:value
        return Color(.sRGB,red:Double((rgb>>16)&255)/255,green:Double((rgb>>8)&255)/255,blue:Double(rgb&255)/255,opacity:hex.count==8 ? Double(value&255)/255:1)
    }
    static func calendarColor(_ row:Row) -> Color {
        for raw in [row["category_color"],row.fields["category"]?.object["color"]?.text ?? "",row["color"]] {
            if let c=color(raw){return c}
        }
        if row["kind"] == "meeting" {return .secondary}
        return color("#d3bb73")!
    }
    static func isArchived(_ row:Row,module:Module,now:Date=Date()) -> Bool {
        if row.fields["is_hidden"]?.flag == true || row.fields["archived_at"]?.text.isEmpty == false {return true}
        let today=CalendarDates.calendar.startOfDay(for:now)
        if module == .events {
            if ["completed","cancelled","settled","archived"].contains(row["status"]){return true}
            let end=CalendarDates.date(row["event_end_date"]) ?? CalendarDates.date(row["event_date"])
            return end.map{$0<today} ?? false
        }
        if module == .offers {
            if ["rejected","expired","cancelled","archived"].contains(row["status"]){return true}
            let event=row.fields["event"]?.object ?? [:]
            if ["completed","cancelled","settled","archived"].contains(event["status"]?.text ?? ""){return true}
            if let end=CalendarDates.date(event["event_end_date"]?.text ?? "") ?? CalendarDates.date(event["event_date"]?.text ?? ""),end<today{return true}
            if row["status"] != "accepted",let limit=CalendarDates.date(row["valid_until"]),limit<today{return true}
        }
        if module == .tenders {
            if ["won","lost","ignored","cancelled","archived"].contains(row["status"]){return true}
            return CalendarDates.date(row["submission_deadline"]).map{$0<=now} ?? false
        }
        return false
    }
    static func remaining(_ raw:String,now:Date=Date()) -> String {
        guard let deadline=CalendarDates.date(raw) else{return "Bez terminu"}
        let seconds=deadline.timeIntervalSince(now)
        if seconds<=0{return "Termin minął"}
        let minutes=max(1,Int(ceil(seconds/60))),days=minutes/1440,hours=(minutes%1440)/60
        if days>0{return "\(days) dni \(hours) godz."}
        if hours>0{return "\(hours) godz. \(minutes%60) min"}
        return "\(minutes) min"
    }
    static func taskColumn(_ row:Row) -> String {
        let raw=row["board_column"].isEmpty ? row["status"]:row["board_column"]
        if raw=="done"{return "completed"}
        return Labels.taskStages.contains(raw) ? raw:"other"
    }
    static func priorityColor(_ code:String) -> Color {
        switch code {case "urgent":return .red;case "high":return .orange;case "medium":return .blue;default:return .secondary}
    }
}

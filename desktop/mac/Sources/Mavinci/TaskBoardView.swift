import SwiftUI

@MainActor struct TaskBoardView:View {
    @EnvironmentObject var state:Workspace
    @State private var search=""
    @State private var selectedID:String?
    @State private var modalID:String?
    @State private var editor:Row?
    @State private var editingTask=false
    @State private var showCompleted=true
    private var rows:[Row] {
        state.rows(.tasks).filter{search.isEmpty || [$0.title,$0["description"]].joined(separator:" ").localizedStandardContains(search)}.sorted {
            let a=Labels.priorities.firstIndex(of:$0["priority"]) ?? 0,b=Labels.priorities.firstIndex(of:$1["priority"]) ?? 0
            if a != b{return a>b}
            if $0["due_date"] != $1["due_date"] {return !$0["due_date"].isEmpty && ($1["due_date"].isEmpty || $0["due_date"]<$1["due_date"])}
            return $0.title.localizedStandardCompare($1.title) == .orderedAscending
        }
    }
    private var selected:Row?{state.rows(.tasks).first{$0.id==selectedID}}
    private var columns:[String]{
        var result=Labels.taskStages.filter{showCompleted || $0 != "completed"}
        if rows.contains(where:{WorkspacePresentation.taskColumn($0)=="other"}){result.append("other")}
        return result
    }
    var body:some View {
        GeometryReader { available in
            let wide=available.size.width>=1230
            let side=wide && selected != nil
            let sideWidth:CGFloat=360
            let boardWidth=max(1,available.size.width-(side ? sideWidth+1:0))
            VStack(spacing:0) {
                HStack {
                    Text("\(rows.count) zadań").foregroundStyle(.secondary)
                    Toggle("Pokaż zakończone",isOn:$showCompleted).toggleStyle(.checkbox)
                    Spacer()
                    Button("Nowe zadanie",systemImage:"plus"){editor=nil;editingTask=true}.keyboardShortcut("n").disabled(!state.canWrite || !state.allowed("task_create"))
                }.padding(.horizontal,16).frame(height:46).background(.bar)
                if let error=state.moduleErrors["tasks"]{Text(error).font(.callout).foregroundStyle(.orange).padding(10)}
                GeometryReader { content in
                    HStack(alignment:.top,spacing:0) {
                        ScrollView(.horizontal) {
                            HStack(alignment:.top,spacing:14) {
                                ForEach(columns,id:\.self) {column in
                                    TaskBoardColumn(column:column,rows:rows.filter{WorkspacePresentation.taskColumn($0)==column},selectedID:selectedID,canMove:state.canWrite,
                                        open:{row in selectedID=row.id;if !wide{modalID=row.id}},
                                        edit:{row in editor=row;editingTask=true},move:{row,target in move(row,to:target)})
                                        .frame(width:max(240,(boardWidth-28-CGFloat(max(columns.count-1,0))*14)/CGFloat(columns.count)),height:content.size.height-24)
                                }
                            }.padding(12)
                        }.frame(width:boardWidth,height:content.size.height)
                        if side,let selected {
                            Divider()
                            RecordInspector(row:selected,module:.tasks,editTask:{editor=selected;editingTask=true})
                                .frame(width:sideWidth,height:content.size.height)
                        }
                    }.frame(width:content.size.width,height:content.size.height,alignment:.topLeading)
                }
            }.frame(width:available.size.width,height:available.size.height,alignment:.topLeading)
            .onChange(of:state.focusToken){_,_ in reveal(wide:wide)}
            .onAppear{reveal(wide:wide)}
            .onChange(of:wide){_,isWide in if !isWide,let selectedID{modalID=selectedID}else if isWide{modalID=nil}}
        }.onReceive(NotificationCenter.default.publisher(for:.moveKanbanTask)){note in
            guard let id=note.userInfo?["id"] as? String,let column=note.userInfo?["column"] as? String,let row=state.rows(.tasks).first(where:{$0.id==id})else{return}
            move(row,to:column)
        }.navigationTitle("Moje zadania").searchable(text:$search,prompt:"Szukaj zadania")
        .sheet(isPresented:Binding(get:{modalID != nil},set:{if !$0{modalID=nil}})) {
            if let row=state.rows(.tasks).first(where:{$0.id==modalID}) {
                VStack(spacing:0){HStack{Text("Szczegóły zadania").font(.headline);Spacer();Button("Zamknij"){modalID=nil}.keyboardShortcut(.cancelAction)}.padding();RecordInspector(row:row,module:.tasks,editTask:{editor=row;editingTask=true})}.frame(width:610,height:650)
                    .sheet(isPresented:$editingTask){TaskEditor(row:editor)}
            }
        }
        .sheet(isPresented:Binding(get:{editingTask && modalID==nil},set:{editingTask=$0})){TaskEditor(row:editor)}
    }
    private func reveal(wide:Bool) {
        guard let id=state.focusedID,state.rows(.tasks).contains(where:{$0.id==id})else{return}
        search="";showCompleted=true;selectedID=id;if !wide{modalID=id}
    }
    private func move(_ row:Row,to column:String) {
        guard Labels.taskStages.contains(column),WorkspacePresentation.taskColumn(row) != column else{return}
        var body:[String:JSONValue]=["board_column":.string(column),"status":.string(column)]
        if column != "in_progress"{body["currently_working_by"] = .null}
        Task{await state.perform("task_update",row:row,payload:body)}
    }
}
struct TaskBoardColumn:View {
    let column:String
    let rows:[Row]
    let selectedID:String?
    let canMove:Bool
    let open:(Row)->Void
    let edit:(Row)->Void
    let move:(Row,String)->Void
    @State private var targeted=false
    private var color:Color{switch column{case "todo":return .yellow;case "in_progress":return .blue;case "review":return .purple;case "completed":return .green;default:return .secondary}}
    var body:some View {
        VStack(spacing:0) {
            HStack{Circle().fill(color).frame(width:8,height:8);Text(column=="other" ? "Pozostałe":Labels.text(column)).font(.headline);Spacer();Text("\(rows.count)").foregroundStyle(.secondary).monospacedDigit()}.padding(14)
            ScrollView {
                LazyVStack(spacing:10) {
                    ForEach(rows) {row in
                        Button{open(row)}label:{
                            VStack(alignment:.leading,spacing:10) {
                                Text(row.title).font(.callout.weight(.semibold)).lineLimit(4).frame(maxWidth:.infinity,alignment:.leading)
                                if !row["description"].isEmpty{Text(row["description"]).font(.caption).foregroundStyle(.secondary).lineLimit(2)}
                                HStack{
                                    Text(Labels.text(row["priority"])).font(.caption2.weight(.medium)).foregroundStyle(WorkspacePresentation.priorityColor(row["priority"]))
                                    Spacer()
                                    if !row["due_date"].isEmpty{Label(Labels.date(row["due_date"]),systemImage:"clock").font(.caption2).foregroundStyle(.secondary)}
                                }
                            }.padding(12).background(selectedID==row.id ? Color.accentColor.opacity(0.16):Color(nsColor:.controlBackgroundColor),in:RoundedRectangle(cornerRadius:8))
                                .overlay(RoundedRectangle(cornerRadius:8).strokeBorder(selectedID==row.id ? Color.accentColor.opacity(0.45):Color.secondary.opacity(0.13),lineWidth:1))
                        }.buttonStyle(.plain).draggable("mavinci-task:\(row.id)")
                        .contextMenu {
                            Button("Szczegóły"){open(row)}
                            Button("Edytuj"){edit(row)}.disabled(!canMove)
                            Menu("Przenieś do") {ForEach(Labels.taskStages,id:\.self){target in Button(Labels.text(target)){move(row,target)}.disabled(target==column || !canMove)}}
                        }
                    }
                    if rows.isEmpty{Text("Brak zadań").font(.caption).foregroundStyle(.tertiary).frame(maxWidth:.infinity).padding(22)}
                }.padding(.horizontal,10).padding(.bottom,12)
            }.frame(maxWidth:.infinity,maxHeight:.infinity)
        }.background(color.opacity(targeted ? 0.12:0.045),in:RoundedRectangle(cornerRadius:10))
        .dropDestination(for:String.self){items,_ in
            guard canMove,Labels.taskStages.contains(column),let value=items.first,value.hasPrefix("mavinci-task:")else{return false}
            let id=String(value.dropFirst("mavinci-task:".count))
            NotificationCenter.default.post(name:.moveKanbanTask,object:nil,userInfo:["id":id,"column":column]);return true
        }isTargeted:{targeted=$0 && canMove}
    }
}
extension Notification.Name{static let moveKanbanTask=Notification.Name("pl.mavinci.kanban.move")}

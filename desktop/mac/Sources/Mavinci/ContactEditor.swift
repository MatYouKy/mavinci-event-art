import SwiftUI

struct ContactEditor:View {
    let contactID:String
    @EnvironmentObject var workspace:Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var original:Row?
    @State private var values:[String:String]=[:]
    @State private var errors:[String:String]=[:]
    @State private var error:String?
    @State private var loading=true
    @State private var saving=false
    @FocusState private var focused:String?
    private let fields:[(String,String)]=[("first_name","Imię"),("last_name","Nazwisko"),("email","E-mail"),("phone","Telefon"),("mobile","Telefon komórkowy"),("position","Stanowisko"),("address","Adres"),("city","Miejscowość"),("postal_code","Kod pocztowy"),("country","Kraj"),("notes","Notatki")]
    var body:some View {
        VStack(alignment:.leading,spacing:14) {
            Text("Edytuj kontakt CRM").font(.title2.bold())
            Text("Zapis dotyczy kartoteki CRM. Prywatna książka adresowa telefonu i Maca nie jest odczytywana ani zmieniana.").font(.caption).foregroundStyle(.secondary)
            if loading {ProgressView().frame(maxWidth:.infinity,maxHeight:.infinity)}
            else {
                Form {
                    ForEach(fields,id:\.0) {key,label in
                        VStack(alignment:.leading,spacing:4) {
                            if key=="notes" {TextField(label,text:binding(key),axis:.vertical).lineLimit(3...6).focused($focused,equals:key)}
                            else {TextField(label,text:binding(key)).focused($focused,equals:key)}
                            if let issue=errors[key] {Text(issue).font(.caption).foregroundStyle(.red)}
                        }
                    }
                }.formStyle(.grouped).disabled(saving || original==nil)
            }
            if let error {Text(error).font(.callout).foregroundStyle(.red).textSelection(.enabled)}
            HStack {
                Button("Anuluj") {dismiss()}.keyboardShortcut(.cancelAction).disabled(saving)
                Spacer()
                Button(saving ? "Zapisywanie…":"Zapisz kontakt") {save()}.keyboardShortcut(.defaultAction)
                    .disabled(loading || saving || original==nil || !workspace.canWrite || !workspace.allowed("contact_update"))
            }
        }.padding(24).frame(width:590,height:680)
        .task {
            workspace.editing=true
            let actor=workspace.employee
            do {
                let row=try await workspace.eventAPI()?.record(.contacts,id:contactID)
                guard actor==workspace.employee else{return}
                guard let row else{throw AppError.forbidden}
                original=row;for (key,_) in fields {values[key]=row[key]}
            } catch {self.error=friendlyError(error)}
            loading=false
        }.onDisappear{workspace.editing=false}.interactiveDismissDisabled(saving)
    }
    private func binding(_ key:String)->Binding<String>{Binding(get:{values[key] ?? ""},set:{values[key]=$0;errors.removeValue(forKey:key)})}
    private func save() {
        errors=[:];error=nil
        if (values["first_name"] ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && (values["last_name"] ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && (original?["full_name"].isEmpty != false) {errors["first_name"]="Wpisz imię lub nazwisko."}
        let email=(values["email"] ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
        if !email.isEmpty && email.range(of:"^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",options:.regularExpression)==nil{errors["email"]="Wpisz poprawny adres e-mail."}
        guard errors.isEmpty,let original else{focused=fields.first{errors[$0.0] != nil}?.0;return}
        let payload=Dictionary(uniqueKeysWithValues:fields.compactMap{key,_ -> (String,JSONValue)? in
            let text=(values[key] ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
            guard text != original[key].trimmingCharacters(in:.whitespacesAndNewlines) else{return nil}
            return (key,text.isEmpty ? .null:.string(text))
        })
        if payload.isEmpty{dismiss();return}
        saving=true
        Task {
            if await workspace.update(.contacts,row:original,values:payload){dismiss()}
            else{error=workspace.error ?? "Nie udało się zapisać kontaktu. Odśwież dane przed ponowną próbą."}
            saving=false
        }
    }
}

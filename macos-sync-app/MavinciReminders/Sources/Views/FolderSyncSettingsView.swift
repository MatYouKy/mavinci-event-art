import SwiftUI
import AppKit

@MainActor
struct FolderSyncSettingsView:View {
    @ObservedObject private var manager=FolderSyncManager.shared
    @State private var folder:URL?
    @State private var token=""
    @State private var error=""
    @State private var adding=false
    var body:some View {
        ScrollView {
            VStack(alignment:.leading,spacing:16) {
                Text("Katalog CRM").font(.headline)
                Text("W CRM otwórz dowolne wydarzenie → Pliki → Folder Mac / iCloud i wygeneruj klucz całego katalogu. Tutaj wybierz raz główny folder CRM, również na iCloud Drive. Aplikacja utworzy events/RRRR-MM-DD/Nazwa wydarzenia oraz podfoldery Umowy, Oferty, Pliki i Prywatne. Nowe wydarzenia pojawią się automatycznie.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Pliki z wybranego folderu i podfolderów będą wysyłane do CRM. Pliki z CRM pobierane są automatycznie. Bez propagowania usunięć; limit 50 MB na plik.")
                    .font(.caption)
                Text("Synchronizujemy tylko automatycznie powiązane foldery wydarzeń, nie luźne pliki w katalogu głównym. W CRM zespół widzi Pliki, a Umowy i Oferty wymagają osobnych uprawnień. Prywatne i inne podfoldery widzi tylko administrator. Nie udostępniaj całego katalogu przez iCloud — jego udostępnienia nie podlegają uprawnieniom CRM.")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button("Wybierz folder…") {
                        let panel=NSOpenPanel();panel.canChooseDirectories=true;panel.canChooseFiles=false;panel.allowsMultipleSelection=false
                        if panel.runModal() == .OK {folder=panel.url}
                    }
                    Text(folder?.path ?? "Nie wybrano folderu").font(.caption).lineLimit(2)
                }
                SecureField("Klucz katalogu z CRM (mvfs_…)",text:$token).textFieldStyle(.roundedBorder)
                Button(adding ? "Łączenie…" : "Połącz folder i włącz synchronizację") {
                    guard let folder else{return}
                    adding=true;error=""
                    Task {
                        do {try await manager.addFolder(folder,baseURL:CRMAPIClient.shared.baseURL,token:token.trimmingCharacters(in:.whitespacesAndNewlines));token="";self.folder=nil}
                        catch{self.error=error.localizedDescription}
                        adding=false
                    }
                }.disabled(folder==nil || token.isEmpty || adding || manager.isSyncing)
                if !error.isEmpty{Text(error).foregroundStyle(.red).font(.caption)}
                Divider()
                ForEach(manager.bindings){binding in
                    HStack {
                        VStack(alignment:.leading){
                            Text(binding.eventName).fontWeight(.medium)
                            Text(binding.displayPath).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button("Odłącz"){manager.disconnect(binding.id)}.disabled(manager.isSyncing)
                    }
                }
                Button("Synchronizuj pliki teraz") {
                    Task {do {try await manager.syncAll()} catch{self.error=error.localizedDescription}}
                }.disabled(manager.isSyncing || manager.bindings.isEmpty)
                if manager.isSyncing{ProgressView().controlSize(.small)}
                Text(manager.status).font(.caption).textSelection(.enabled)
                Text("Nazwa i data folderu zostają zachowane po pierwszym połączeniu, także po zmianie wydarzenia w CRM. Identyczne nazwy otrzymują (2), (3)… Nie przenoś powiązanych folderów ręcznie. Przed przejściem ze starego połączenia pojedynczego wydarzenia odłącz je; istniejących folderów nie łączymy automatycznie po nazwie.")
                    .font(.caption).foregroundStyle(.secondary)
                Text("Dokumenty generowane w CRM są w „Z CRM”. Nie wysyłamy ich z powrotem automatycznie. Aby przesłać własną poprawioną wersję, zapisz ją poza „Z CRM”. Konflikty są zachowywane w „Konflikty CRM”; usuń konflikt przez świadome wybranie wersji albo zmianę nazwy lokalnego pliku.")
                    .font(.caption).foregroundStyle(.secondary)
            }.padding().disabled(adding)
        }
    }
}

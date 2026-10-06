import Foundation
import AppKit
import Combine
import CryptoKit
import Security

struct FolderBinding: Codable, Identifiable {
    var id: String
    var eventId: String
    var eventName: String
    var baseURL: String
    var bookmark: Data
    var displayPath: String
    var eventPaths: [String:String]? // Stable ID → human-readable path; never identify an event by its name.
}
struct CatalogEvent: Decodable { var id:String; var name:String; var relative_path:String }
struct RootCatalog: Decodable { var scope:String; var events:[CatalogEvent] }
struct SyncedFile: Codable {
    var id: String
    var relative_path: String
    var sha256: String?
    var revision: Int
    var fingerprint: String
    var file_size: Int64
}
struct FileManifest: Codable {
    var event_id: String
    var event_name: String
    var files: [SyncedFile]
}
struct FileReceipt: Codable {
    var hash: String
    var fingerprint: String
    var revision: Int
}
private struct FolderConfiguration: Codable {
    var bindings: [FolderBinding] = []
    var receipts: [String: [String: FileReceipt]] = [:]
}
private enum FolderFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
private final class NoSyncRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Never forward a device token to a redirected host.
    }
}
private enum FolderTokens {
    static func query(_ id: String) -> [String: Any] {
        [kSecClass as String:kSecClassGenericPassword, kSecAttrService as String:"com.mavinci.file-sync", kSecAttrAccount as String:id]
    }
    static func get(_ id: String) -> String? {
        var q=query(id);q[kSecReturnData as String]=true;q[kSecMatchLimit as String]=kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary,&result)==errSecSuccess,let data=result as? Data else{return nil}
        return String(data:data,encoding:.utf8)
    }
    static func save(_ token: String, id: String) throws {
        let data=Data(token.utf8), q=query(id)
        var status=SecItemUpdate(q as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status==errSecItemNotFound {
            var add=q;add[kSecValueData as String]=data;add[kSecAttrAccessible as String]=kSecAttrAccessibleAfterFirstUnlock
            status=SecItemAdd(add as CFDictionary,nil)
        }
        guard status==errSecSuccess else { throw FolderFailure.message("Nie udało się zapisać klucza w Pęku kluczy.") }
    }
    static func remove(_ id: String) { SecItemDelete(query(id) as CFDictionary) }
}

@MainActor
final class FolderSyncManager: ObservableObject {
    static let shared=FolderSyncManager()
    @Published private(set) var bindings:[FolderBinding]=[]
    @Published private(set) var isSyncing=false
    @Published private(set) var status="Nie połączono folderów."
    private var config=FolderConfiguration()
    private let stateURL=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
        .appendingPathComponent("MavinciReminders/folder_sync.json")
    private let session=URLSession(configuration:.ephemeral,delegate:NoSyncRedirect(),delegateQueue:nil)
    private let maxSize=50*1024*1024

    private init() {
        if FileManager.default.fileExists(atPath:stateURL.path) {
            do { config=try JSONDecoder().decode(FolderConfiguration.self,from:Data(contentsOf:stateURL));bindings=config.bindings }
            catch { status="Nie można odczytać konfiguracji folderów. Nie uruchomiono synchronizacji." }
        }
    }
    private func persist() throws {
        try FileManager.default.createDirectory(at:stateURL.deletingLastPathComponent(),withIntermediateDirectories:true)
        try JSONEncoder().encode(config).write(to:stateURL,options:.atomic)
        bindings=config.bindings
    }
    private func origin(_ base: String) throws -> URL {
        guard let url=URL(string:base.trimmingCharacters(in:.whitespacesAndNewlines)),
              url.scheme=="https",url.host != nil,url.user==nil,url.password==nil,url.query==nil,
              url.fragment==nil,url.path.isEmpty || url.path=="/" else {
            throw FolderFailure.message("Podaj główny adres CRM zaczynający się od https://, bez dodatkowej ścieżki.")
        }
        var components=URLComponents(url:url,resolvingAgainstBaseURL:false)!
        components.host=components.host?.lowercased()
        components.path=""
        return components.url!
    }
    private func request(base: String, token: String, fileId: String?=nil, body: Data?=nil,
                         path: String?=nil, revision: Int=0, eventId:String?=nil) async throws -> Data {
        var parts=URLComponents(url:try origin(base).appendingPathComponent("bridge/mac-sync/files"),resolvingAgainstBaseURL:false)!
        var query:[URLQueryItem]=[]
        if let fileId { query.append(URLQueryItem(name:"fileId",value:fileId)) }
        if let eventId { query.append(URLQueryItem(name:"eventId",value:eventId)) }
        parts.queryItems=query.isEmpty ? nil : query
        var req=URLRequest(url:parts.url!)
        req.timeoutInterval=120
        req.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
        req.setValue("application/json",forHTTPHeaderField:"Accept")
        if let body,let path {
            req.httpMethod="POST";req.httpBody=body
            req.setValue("application/octet-stream",forHTTPHeaderField:"Content-Type")
            req.setValue(path.addingPercentEncoding(withAllowedCharacters:.alphanumerics),forHTTPHeaderField:"X-File-Path")
            req.setValue(String(revision),forHTTPHeaderField:"X-Expected-Revision")
            req.setValue(Self.hash(body),forHTTPHeaderField:"X-Content-SHA256")
        }
        let (data,response)=try await session.data(for:req)
        guard let http=response as? HTTPURLResponse,(200...299).contains(http.statusCode) else {
            let message=(try? JSONSerialization.jsonObject(with:data) as? [String:Any])?["error"] as? String
            throw FolderFailure.message(message ?? "Błąd połączenia z CRM. Sprawdź klucz synchronizacji.")
        }
        return data
    }
    func addFolder(_ url: URL, baseURL: String, token: String) async throws {
        guard !isSyncing else { throw FolderFailure.message("Poczekaj na koniec synchronizacji.") }
        isSyncing=true;defer{isSyncing=false}
        let base=try origin(baseURL).absoluteString
        let data=try await request(base:base,token:token)
        let catalog=try? JSONDecoder().decode(RootCatalog.self,from:data)
        let manifest:FileManifest?
        if catalog==nil {manifest=try JSONDecoder().decode(FileManifest.self,from:data)} else {manifest=nil}
        let eventId=manifest?.event_id ?? "root"
        let eventName=manifest?.event_name ?? "Katalog CRM — wszystkie wydarzenia"
        let root=url.standardizedFileURL.resolvingSymlinksInPath()
        guard !config.bindings.contains(where:{
            let other=$0.displayPath
            return root.path==other || root.path.hasPrefix(other+"/") || other.hasPrefix(root.path+"/") ||
                ($0.baseURL==base && ($0.eventId==eventId || $0.eventId=="root" || eventId=="root"))
        }) else { throw FolderFailure.message("Ten folder lub wydarzenie jest już połączone. Nie łącz nakładających się folderów.") }
        let access=url.startAccessingSecurityScopedResource()
        defer{if access{url.stopAccessingSecurityScopedResource()}}
        let bookmark=try url.bookmarkData(options:.withSecurityScope,includingResourceValuesForKeys:nil,relativeTo:nil)
        let binding=FolderBinding(id:UUID().uuidString,eventId:eventId,eventName:eventName,
            baseURL:base,bookmark:bookmark,displayPath:root.path)
        try FolderTokens.save(token,id:binding.id)
        config.bindings.append(binding)
        do {try persist()} catch {config.bindings.removeAll{$0.id==binding.id};FolderTokens.remove(binding.id);throw error}
        status="Połączono: \(eventName). Struktura folderów powstanie podczas synchronizacji."
    }
    func disconnect(_ id: String) {
        guard !isSyncing else{return}
        let previous=config
        config.bindings.removeAll{$0.id==id}
        for key in Array(config.receipts.keys) where key==id || key.hasPrefix(id+":") {config.receipts.removeValue(forKey:key)}
        do {try persist();FolderTokens.remove(id);status="Odłączono lokalnie. Pliki pozostają. Klucz możesz unieważnić w CRM."}
        catch {config=previous;status="Nie udało się zapisać odłączenia."}
    }
    private func receipt(_ binding:FolderBinding,_ file:SyncedFile,hash:String) throws {
        config.receipts[binding.id,default:[:]][file.relative_path.lowercased()] =
            FileReceipt(hash:hash,fingerprint:file.fingerprint,revision:file.revision)
        try persist()
    }
    nonisolated static func hash(_ data:Data)->String {SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined()}

    func syncAll() async throws {
        guard !isSyncing,!bindings.isEmpty else{return}
        isSyncing=true;defer{isSyncing=false}
        var errors:[String]=[]
        for binding in bindings {
            do {try await sync(binding)} catch {errors.append("\(binding.eventName): \(error.localizedDescription)")}
        }
        status=errors.isEmpty ? "Foldery zsynchronizowane: \(Date().formatted())." : errors.prefix(8).joined(separator:"\n")
        if !errors.isEmpty {throw FolderFailure.message(status)}
    }
    private func sync(_ binding:FolderBinding) async throws {
        guard let token=FolderTokens.get(binding.id) else {throw FolderFailure.message("Brak klucza folderu w Pęku kluczy.")}
        var stale=false
        let root=try URL(resolvingBookmarkData:binding.bookmark,options:[.withSecurityScope,.withoutUI],relativeTo:nil,bookmarkDataIsStale:&stale)
        let access=root.startAccessingSecurityScopedResource()
        // The existing direct-download app is not sandboxed: its selected bookmark
        // can be readable without granting an additional security scope.
        guard access || (FileManager.default.isReadableFile(atPath:root.path) && FileManager.default.isWritableFile(atPath:root.path)) else {
            throw FolderFailure.message("Brak dostępu do folderu. Wybierz go ponownie.")
        }
        defer{if access{root.stopAccessingSecurityScopedResource()}}
        if stale,let index=config.bindings.firstIndex(where:{$0.id==binding.id}) {
            config.bindings[index].bookmark=try root.bookmarkData(options:.withSecurityScope,includingResourceValuesForKeys:nil,relativeTo:nil)
            try persist()
        }
        if binding.eventId=="root" {
            let catalog=try JSONDecoder().decode(RootCatalog.self,from:await request(base:binding.baseURL,token:token))
            guard catalog.scope=="root" else {throw FolderFailure.message("Klucz nie obejmuje katalogu CRM.")}
            var errors:[String]=[]
            var seen=Set<String>()
            for event in catalog.events {
                do {
                    guard UUID(uuidString:event.id) != nil,seen.insert(event.id).inserted else {
                        throw FolderFailure.message("Nieprawidłowe lub powtórzone wydarzenie w katalogu.")
                    }
                    let eventRoot=try prepareEventFolder(binding,root:root,event:event)
                    var child=binding
                    child.id=binding.id+":"+event.id;child.eventId=event.id;child.eventName=event.name
                    try await syncEvent(child,root:eventRoot,token:token)
                } catch {errors.append("\(event.name): \(error.localizedDescription)")}
            }
            if !errors.isEmpty {throw FolderFailure.message(errors.prefix(10).joined(separator:"\n"))}
            return
        }
        try await syncEvent(binding,root:root,token:token)
    }
    private func prepareEventFolder(_ binding:FolderBinding,root:URL,event:CatalogEvent) throws -> URL {
        guard let index=config.bindings.firstIndex(where:{$0.id==binding.id}) else {throw FolderFailure.message("Odłączone połączenie.")}
        let identity=Data(Self.hash(Data((binding.baseURL+"|"+event.id).utf8)).utf8)
        if let path=config.bindings[index].eventPaths?[event.id] {
            let folder=try Self.safeURL(root,path)
            let marker=folder.appendingPathComponent(".mavinci-event")
            guard (try? marker.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink) != true,
                  (try? Data(contentsOf:marker))==identity else {
                throw FolderFailure.message("Folder „\(path)” przeniesiono lub zmieniono jego powiązanie. Przywróć folder; nie połączę plików po samej nazwie.")
            }
            return folder
        }
        guard event.relative_path.hasPrefix("events/") else {throw FolderFailure.message("Nieprawidłowa ścieżka wydarzenia.")}
        var path=event.relative_path
        var suffix=2
        while FileManager.default.fileExists(atPath:try Self.safeURL(root,path).path) ||
            (config.bindings[index].eventPaths ?? [:]).values.contains(where:{$0.lowercased()==path.lowercased()}) {
            path=event.relative_path+" (\(suffix))";suffix+=1
        }
        let folder=try Self.safeURL(root,path)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        // Never overwrite an existing marker or import an arbitrary pre-existing directory.
        try identity.write(to:folder.appendingPathComponent(".mavinci-event"),options:.withoutOverwriting)
        for category in ["Umowy","Oferty","Pliki","Prywatne"] {
            try FileManager.default.createDirectory(at:try Self.safeURL(folder,category),withIntermediateDirectories:true)
        }
        let previous=config
        if config.bindings[index].eventPaths==nil {config.bindings[index].eventPaths=[:]}
        config.bindings[index].eventPaths?[event.id]=path
        do {try persist()} catch {config=previous;throw error}
        return folder
    }
    private func syncEvent(_ binding:FolderBinding,root:URL,token:String) async throws {
        let manifest=try JSONDecoder().decode(FileManifest.self,from:await request(base:binding.baseURL,token:token,eventId:binding.eventId))
        guard manifest.event_id==binding.eventId else {throw FolderFailure.message("Klucz wskazuje inne wydarzenie. Synchronizacja zatrzymana.")}
        var remote:[String:SyncedFile]=[:]
        for file in manifest.files {
            let key=file.relative_path.precomposedStringWithCanonicalMapping.lowercased()
            guard remote[key]==nil else {throw FolderFailure.message("CRM zwrócił kolidujące nazwy plików.")}
            remote[key]=file
        }
        let local=try await Task.detached {try Self.localFiles(root)}.value
        var errors:[String]=[]
        var handled=Set<String>()
        for path in local {
            let key=path.precomposedStringWithCanonicalMapping.lowercased()
            guard handled.insert(key).inserted else {errors.append("Kolidujące nazwy: \(path)");continue}
            do {
                let url=try Self.safeURL(root,path)
                let bytes=try await Task.detached {try Self.readStable(url)}.value
                guard let bytes else {handled.insert(key);continue} // Still being saved/downloaded; retry next cycle.
                let hash=Self.hash(bytes)
                let current=remote[key],previous=config.receipts[binding.id]?[key]
                if let current,hash==current.sha256 {try receipt(binding,current,hash:hash);continue}
                if let current {
                    if hash==previous?.hash {handled.remove(key);continue} // Only CRM changed: download below.
                    guard let previous,previous.revision==current.revision else {
                        try await preserveConflict(binding,root:root,file:current,token:token)
                        errors.append("Konflikt: \(path). Zachowano lokalny plik i kopię CRM w „Konflikty CRM”.")
                        continue
                    }
                }
                let saved=try JSONDecoder().decode(SyncedFile.self,from:await request(base:binding.baseURL,token:token,
                    body:bytes,path:path,revision:current?.revision ?? 0,eventId:binding.eventId))
                try receipt(binding,saved,hash:hash)
            } catch {errors.append("\(path): \(error.localizedDescription)")}
        }
        for file in manifest.files {
            let key=file.relative_path.lowercased()
            if handled.contains(key){continue}
            do {
                guard file.file_size>0,file.file_size<=maxSize else {throw FolderFailure.message("Plik przekracza 50 MB lub jest pusty.")}
                let target=try Self.safeURL(root,file.relative_path)
                let previous=config.receipts[binding.id]?[key]
                if FileManager.default.fileExists(atPath:target.path) {
                    guard let bytes=try await Task.detached(operation:{try Self.readStable(target)}).value else{continue}
                    let localHash=Self.hash(bytes)
                    if file.sha256==localHash || (previous?.hash==localHash && previous?.fingerprint==file.fingerprint) {
                        try receipt(binding,file,hash:localHash);continue
                    }
                    if previous?.hash != localHash {
                        try await preserveConflict(binding,root:root,file:file,token:token)
                        errors.append("Nie nadpisano lokalnych zmian: \(file.relative_path)");continue
                    }
                }
                let data=try await download(binding,file:file,token:token)
                let expected=previous?.hash
                try await Task.detached {try Self.writeSafely(data,root:root,path:file.relative_path,expected:expected)}.value
                try receipt(binding,file,hash:Self.hash(data))
            } catch {errors.append("\(file.relative_path): \(error.localizedDescription)")}
        }
        if !errors.isEmpty {throw FolderFailure.message(errors.prefix(10).joined(separator:"\n"))}
    }
    private func download(_ binding:FolderBinding,file:SyncedFile,token:String) async throws -> Data {
        guard file.file_size<=maxSize else{throw FolderFailure.message("Limit pliku wynosi 50 MB.")}
        let info=try JSONSerialization.jsonObject(with:await request(base:binding.baseURL,token:token,fileId:file.id,eventId:binding.eventId)) as? [String:String]
        guard let value=info?["url"],let url=URL(string:value),url.scheme=="https" else{throw CRMAPIError.invalidResponse}
        // The short-lived storage URL receives NO device token.
        let (data,response)=try await URLSession.shared.data(from:url)
        guard let http=response as? HTTPURLResponse,http.statusCode==200,data.count<=maxSize,!data.isEmpty else{throw CRMAPIError.invalidResponse}
        if let expected=file.sha256,Self.hash(data) != expected {throw FolderFailure.message("Plik zmienił się podczas pobierania. Ponowię synchronizację.")}
        return data
    }
    private func preserveConflict(_ binding:FolderBinding,root:URL,file:SyncedFile,token:String) async throws {
        let marker=Self.hash(Data(file.fingerprint.utf8)).prefix(16)
        let name=(file.relative_path as NSString).lastPathComponent
        let path="Konflikty CRM/\(file.id.replacingOccurrences(of:":",with:"_"))/\(marker)/\(name)"
        let target=try Self.safeURL(root,path)
        if FileManager.default.fileExists(atPath:target.path){return}
        let data=try await download(binding,file:file,token:token)
        try await Task.detached {try Self.writeSafely(data,root:root,path:path,expected:nil)}.value
    }
    nonisolated private static func safeURL(_ root:URL,_ path:String) throws -> URL {
        let pieces=path.split(separator:"/",omittingEmptySubsequences:false)
        guard !pieces.isEmpty,!pieces.contains(where:{$0.isEmpty || $0=="." || $0==".." || $0.hasPrefix(".") || $0.contains("\\") || $0.contains(":") || $0.contains("\0")}) else {
            throw FolderFailure.message("Niebezpieczna ścieżka pliku.")
        }
        let base=root.standardizedFileURL.resolvingSymlinksInPath()
        var result=base
        for piece in pieces {
            result.appendPathComponent(String(piece))
            if (try? result.resourceValues(forKeys:[.isSymbolicLinkKey]).isSymbolicLink)==true {
                throw FolderFailure.message("Dowiązania symboliczne nie są synchronizowane.")
            }
        }
        guard result.resolvingSymlinksInPath().path.hasPrefix(base.path+"/") else {throw FolderFailure.message("Plik poza wybranym folderem.")}
        return result
    }
    nonisolated private static func localFiles(_ root:URL) throws -> [String] {
        var failure:Error?
        guard let enumerator=FileManager.default.enumerator(at:root,includingPropertiesForKeys:[.isRegularFileKey,.isSymbolicLinkKey,.isDirectoryKey],
            options:[.skipsHiddenFiles,.skipsPackageDescendants],errorHandler:{_,error in failure=error;return false}) else {
            throw FolderFailure.message("Nie można odczytać folderu.")
        }
        var paths:[String]=[]
        for case let url as URL in enumerator {
            let values=try url.resourceValues(forKeys:[.isRegularFileKey,.isSymbolicLinkKey,.isDirectoryKey])
            let path=String(url.path.dropFirst(root.path.count+1)).precomposedStringWithCanonicalMapping
            if values.isSymbolicLink==true || path.lowercased()=="z crm" || path.lowercased()=="konflikty crm" {enumerator.skipDescendants();continue}
            if values.isRegularFile==true {paths.append(path)}
        }
        if let failure{throw failure}
        return paths.sorted()
    }
    nonisolated private static func readStable(_ url:URL) throws -> Data? {
        let keys:Set<URLResourceKey>=[.fileSizeKey,.contentModificationDateKey,.isUbiquitousItemKey,.ubiquitousItemDownloadingStatusKey]
        let before=try url.resourceValues(forKeys:keys)
        if before.isUbiquitousItem==true && before.ubiquitousItemDownloadingStatus != .current {
            try FileManager.default.startDownloadingUbiquitousItem(at:url);return nil
        }
        guard (before.fileSize ?? 0)>0,(before.fileSize ?? 0)<=50*1024*1024 else {throw FolderFailure.message("Pusty plik lub rozmiar ponad 50 MB.")}
        if let date=before.contentModificationDate,Date().timeIntervalSince(date)<3{return nil}
        var result:Result<Data,Error>?
        var coordinationError:NSError?
        NSFileCoordinator(filePresenter:nil).coordinate(readingItemAt:url,options:[],error:&coordinationError){coordinated in
            result=Result{try Data(contentsOf:coordinated)}
        }
        if let coordinationError{throw coordinationError}
        guard let result else{throw FolderFailure.message("Nie można odczytać pliku.")}
        let data=try result.get()
        let after=try url.resourceValues(forKeys:keys)
        guard before.fileSize==after.fileSize,before.contentModificationDate==after.contentModificationDate else{return nil}
        return data
    }
    nonisolated private static func writeSafely(_ data:Data,root:URL,path:String,expected:String?) throws {
        let target=try safeURL(root,path)
        try FileManager.default.createDirectory(at:target.deletingLastPathComponent(),withIntermediateDirectories:true)
        var failure:Error?,coordinationError:NSError?
        NSFileCoordinator(filePresenter:nil).coordinate(writingItemAt:target,options:.forReplacing,error:&coordinationError){coordinated in
            do {
                _ = try safeURL(root,path)
                if FileManager.default.fileExists(atPath:coordinated.path) {
                    let actual=Self.hash(try Data(contentsOf:coordinated))
                    if actual==Self.hash(data){return}
                    guard let expected,actual==expected else {throw FolderFailure.message("Plik zmieniono w trakcie synchronizacji. Nie został nadpisany.")}
                    try data.write(to:coordinated,options:.atomic)
                } else {try data.write(to:coordinated,options:.withoutOverwriting)}
            } catch {failure=error}
        }
        if let coordinationError{throw coordinationError}
        if let failure{throw failure}
    }
}

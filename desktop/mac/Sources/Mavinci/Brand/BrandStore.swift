import AppKit

/// Ikona w Docku z brandbooka: przy starcie z zapamiętanej marki (bez czekania), po zalogowaniu — aktualny brandbook z CRM.
/// Marka jest publiczna (sygnet leży w publicznym magazynie logo), więc kopia nie jest szyfrowana i nie jest usuwana przy wylogowaniu.
@MainActor enum BrandStore {
    static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/Desktop/v1/brand", isDirectory: true)
    }
    private static var infoFile: URL { folder.appendingPathComponent("brand.json") }
    private static var sygnetFile: URL { folder.appendingPathComponent("sygnet.png") }

    /// Ostatnio pobrana marka → ikona aplikacji (Dock, ⌘Tab, okno „O programie”).
    static func applyCached() {
        guard let data = try? Data(contentsOf: infoFile), let brand = try? JSONDecoder().decode(BrandInfo.self, from: data),
              let sygnet = NSImage(contentsOf: sygnetFile) else { return }
        NSApp.applicationIconImage = BrandIcon.image(sygnet: sygnet, brand: brand)
    }

    /// Aktualny brandbook z CRM; po zmianie sygnetu lub kolorów — nowa ikona i zapis dla skryptu budowania.
    static func refresh(_ api: NativeAPI?) async {
        guard let api, let data = try? await api.get("/brand"), let brand = try? JSONDecoder().decode(BrandInfo.self, from: data),
              let address = brand.sygnet, let url = URL(string: address) else { return }
        let saved = (try? Data(contentsOf: infoFile)).flatMap { try? JSONDecoder().decode(BrandInfo.self, from: $0) }
        if saved == brand, FileManager.default.fileExists(atPath: sygnetFile.path) { return }
        guard let download = try? await URLSession.shared.data(from: url),
              (download.1 as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false,
              let sygnet = NSImage(data: download.0) else { return }
        let png = download.0
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try? png.write(to: sygnetFile, options: .atomic)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try? encoder.encode(brand).write(to: infoFile, options: .atomic)
        NSApp.applicationIconImage = BrandIcon.image(sygnet: sygnet, brand: brand)
    }
}

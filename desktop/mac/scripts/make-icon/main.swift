import AppKit

/*
 * Ikona pakietu (AppIcon.iconset) z brandbooka: `make-icon <brand.json> <katalog.iconset>`.
 * brand.json — marka zapisana przez aplikację po zalogowaniu (aktualny brandbook) albo kopia w Resources/Brand.
 * Sygnet: sygnet.png obok brand.json (zapisany przez aplikację), a gdy go brak — pobierany z adresu w brand.json.
 */
let arguments = CommandLine.arguments
guard arguments.count == 3 else { FileHandle.standardError.write("Użycie: make-icon <brand.json> <katalog.iconset>\n".data(using: .utf8)!); exit(2) }
let infoURL = URL(fileURLWithPath: arguments[1])
let output = URL(fileURLWithPath: arguments[2], isDirectory: true)
guard let infoData = try? Data(contentsOf: infoURL), let brand = try? JSONDecoder().decode(BrandInfo.self, from: infoData) else {
    FileHandle.standardError.write("Nie można odczytać marki: \(infoURL.path)\n".data(using: .utf8)!); exit(1)
}
let local = infoURL.deletingLastPathComponent().appendingPathComponent("sygnet.png")
var sygnetData = try? Data(contentsOf: local)
if sygnetData == nil, let address = brand.sygnet, let url = URL(string: address) { sygnetData = try? Data(contentsOf: url) }
guard let data = sygnetData, let sygnet = NSImage(data: data) else {
    FileHandle.standardError.write("Nie można pobrać sygnetu z brandbooka.\n".data(using: .utf8)!); exit(1)
}
do {
    try? FileManager.default.removeItem(at: output)
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let sizes: [(String, Int)] = [
        ("icon_16x16", 16), ("icon_16x16@2x", 32), ("icon_32x32", 32), ("icon_32x32@2x", 64),
        ("icon_128x128", 128), ("icon_128x128@2x", 256), ("icon_256x256", 256), ("icon_256x256@2x", 512),
        ("icon_512x512", 512), ("icon_512x512@2x", 1024),
    ]
    for (name, pixels) in sizes {
        guard let png = BrandIcon.png(sygnet: sygnet, brand: brand, pixels: pixels) else { throw CocoaError(.fileWriteUnknown) }
        try png.write(to: output.appendingPathComponent("\(name).png"))
    }
} catch {
    FileHandle.standardError.write("Nie udało się zapisać ikony: \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
print("Ikona z brandbooka: \(brand.company ?? "marka") → \(output.lastPathComponent)")

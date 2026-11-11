import SwiftUI
import AppKit

/// Kadrowanie zdjęcia pracownika jak `EmployeeAvatar` w CRM (`avatar_metadata.desktop`): przesunięcie w % rozmiaru, skala,
/// dopasowanie „cover” / „contain”.
struct AvatarCrop: Codable, Hashable {
    var x: Double
    var y: Double
    var scale: Double
    var fit: String?
}

/// Zdjęcia pracowników: pamięć i kopia w `Caches/Mavinci/avatars` — awatar pobiera się raz, potem pokazuje od razu.
@MainActor final class AvatarCache {
    static let shared = AvatarCache()
    private var memory: [String: NSImage] = [:]
    private var pending: [String: Task<NSImage?, Never>] = [:]
    private let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("Mavinci/avatars", isDirectory: true)

    func cached(_ url: String?) -> NSImage? { url.flatMap { memory[$0] } }

    func image(for url: String?) async -> NSImage? {
        guard let url, !url.isEmpty, let remote = URL(string: url) else { return nil }
        if let hit = memory[url] { return hit }
        if let running = pending[url] { return await running.value }
        let file = folder.appendingPathComponent(MailMirror.fileName(url))
        let task = Task<NSImage?, Never> {
            let data: Data? = await Task.detached(priority: .utility) { () -> Data? in
                if let local = try? Data(contentsOf: file) { return local }
                guard let result = try? await URLSession.shared.data(from: remote),
                      (result.1 as? HTTPURLResponse)?.statusCode == 200, !result.0.isEmpty else { return nil }
                try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? result.0.write(to: file, options: .atomic)
                return result.0
            }.value
            return data.flatMap { NSImage(data: $0) }
        }
        pending[url] = task
        let image = await task.value
        pending[url] = nil
        if let image { memory[url] = image }
        return image
    }

    /// Wylogowanie: zdjęcia innych pracowników nie zostają na dysku.
    func clear() {
        memory = [:]; pending = [:]
        try? FileManager.default.removeItem(at: folder)
    }
}

/// Okrągły awatar pracownika (zdjęcie z CRM albo pierwsza litera imienia).
@MainActor struct EmployeeAvatarView: View {
    let name: String
    let url: String?
    let crop: AvatarCrop?
    let size: CGFloat
    @Environment(\.crmTheme) private var theme
    @State private var image: NSImage?

    init(name: String, url: String?, crop: AvatarCrop?, size: CGFloat) {
        self.name = name; self.url = url; self.crop = crop; self.size = size
        _image = State(initialValue: AvatarCache.shared.cached(url))
    }

    var body: some View {
        ZStack {
            Circle().fill(theme.card)
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .aspectRatio(contentMode: crop?.fit == "contain" ? .fit : .fill)
                    .frame(width: size, height: size)
                    .scaleEffect(crop?.scale ?? 1)
                    .offset(x: CGFloat(crop?.x ?? 0) / 100 * size, y: CGFloat(crop?.y ?? 0) / 100 * size)
            } else {
                Text(name.first.map { String($0).uppercased() } ?? "?")
                    .font(.system(size: size / 2.8, weight: .semibold))
                    .foregroundStyle(theme.text.opacity(0.55))
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(theme.card, lineWidth: 2))
        .help(name)
        .task(id: url) {
            if image == nil || url != nil { image = await AvatarCache.shared.image(for: url) ?? image }
        }
    }
}

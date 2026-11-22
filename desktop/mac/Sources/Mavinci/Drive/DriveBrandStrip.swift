import AppKit
import SwiftUI

// MARK: Materiały → marka → „Logotypy i księga znaku”: logotypy, fonty i kolory z księgi znaku (1:1 z `DriveBrandStrip.tsx`)
//
// Jedno źródło — Ustawienia → Moje firmy → Księga znaku (`/bridge/native/v1/drive?op=list&node=brand:<firma>`), bez kopiowania
// plików: zmiana w księdze znaku od razu widać tutaj, w CRM, w Finderze („Z księgi znaku”) i w telefonie.

@MainActor struct DriveBrandStrip: View {
    @ObservedObject var drive: DriveStore
    let companyID: String
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var preview: URL?

    private var node: String { "brand:" + companyID }
    private var listing: DriveListing? { drive.listings[node] }
    private var logos: [DriveFile] { (listing?.files ?? []).filter(\.isImage) }
    private var fonts: [DriveFile] { (listing?.files ?? []).filter { !$0.isImage } }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Z księgi znaku", systemImage: "paintpalette").font(.callout.weight(.semibold)).foregroundStyle(theme.accent)
                    Text("Logotypy, fonty i kolory z Ustawienia → Moje firmy → Księga znaku — zawsze aktualne, bez kopii.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button { state.openCRM("/crm/settings/my-companies/\(companyID)/brandbook") } label: {
                    Label("Edytuj księgę znaku", systemImage: "arrow.up.forward.square")
                }
                .buttonStyle(.borderless)
            }
            if let listing {
                if listing.files.isEmpty && listing.colors.isEmpty {
                    Text("Księga znaku tej marki jest pusta — dodaj logotypy, kolory i fonty w Ustawieniach → Moje firmy.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else if let error = drive.listErrors[node] {
                Text(error).font(.caption).foregroundStyle(.red)
            } else {
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text("Wczytuję księgę znaku…").font(.caption).foregroundStyle(.secondary)
                }
            }
            if !logos.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        ForEach(logos) { file in logoTile(file) }
                    }
                }
            }
            if !fonts.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(fonts) { file in
                            Button { Task { await drive.downloadToDownloads(file) } } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "textformat").foregroundStyle(theme.accent)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(file.name).font(.caption).lineLimit(1)
                                        Text(file.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Image(systemName: "arrow.down.circle").foregroundStyle(.secondary)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help("Pobierz: \(file.name)")
                        }
                    }
                }
            }
            if let colors = listing?.colors, !colors.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(colors.enumerated()), id: \.offset) { _, color in
                            Button { copy(color.hex) } label: {
                                HStack(spacing: 6) {
                                    RoundedRectangle(cornerRadius: 5).fill(CrmTheme.hex(color.hex) ?? Color.clear).frame(width: 26, height: 26)
                                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color.primary.opacity(0.15)))
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(color.hex.uppercased()).font(.caption.monospaced())
                                        Text([color.label, color.role].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption2).foregroundStyle(.secondary)
                                    }
                                    Image(systemName: "doc.on.doc").font(.caption2).foregroundStyle(.tertiary)
                                }
                                .padding(6)
                                .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .help("Kopiuj \(color.hex)")
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.03)))
        .quickLookPreview($preview)
        .task(id: companyID) { await drive.loadListing(node, quiet: true) }
    }

    private func logoTile(_ file: DriveFile) -> some View {
        VStack(spacing: 4) {
            ZStack {
                DriveCheckerboard()
                DriveFileThumb(file: file, side: 120, fit: true)
            }
            .frame(width: 120, height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            Text(file.name).font(.caption2).lineLimit(2).multilineTextAlignment(.center).frame(width: 130)
        }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { Task { preview = await drive.previewFile(file) } }
        .contextMenu {
            Button("Podgląd") { Task { preview = await drive.previewFile(file) } }
            Button("Pobierz") { Task { await drive.downloadToDownloads(file) } }
        }
        .onDrag { drive.dragProvider(file) }
        .help(file.detail)
    }

    private func copy(_ hex: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(hex, forType: .string)
        state.succeed("Skopiowano kolor \(hex)")
    }
}

/// Szachownica pod logotypem z przezroczystym tłem.
struct DriveCheckerboard: View {
    var body: some View {
        Canvas { context, size in
            let side: CGFloat = 8
            let rows = Int((size.height / side).rounded(.up)), columns = Int((size.width / side).rounded(.up))
            for row in 0..<max(rows, 0) {
                for column in 0..<max(columns, 0) where (row + column) % 2 == 0 {
                    context.fill(Path(CGRect(x: CGFloat(column) * side, y: CGFloat(row) * side, width: side, height: side)), with: .color(Color.primary.opacity(0.08)))
                }
            }
        }
    }
}

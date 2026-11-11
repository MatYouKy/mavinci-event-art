import SwiftUI

/// Pozycja menu CRM (`/bridge/native/v1/navigation`, `src/lib/CRM/navigation/registry.server.ts`) — ta sama lista, kolejność
/// i uprawnienia co pasek boczny w przeglądarce. Pozycja bez ekranu natywnego otwiera tymczasowo stronę CRM w przeglądarce.
struct NavItem: Codable, Identifiable, Hashable {
    let key: String
    let name: String
    let href: String
    let iconKey: String
    let children: [NavItem]?
    var id: String { href }
    var path: String { String(href.split(separator: "?", maxSplits: 1).first ?? "") }
    var symbol: String {
        switch iconKey {
        case "dashboard": return "rectangle.3.group"
        case "calendar": return "calendar"
        case "meetings": return "person.2"
        case "events": return "sparkles"
        case "mavinciLive": return "play.tv"
        case "messages": return "envelope"
        case "campaigns": return "megaphone"
        case "inquiries": return "tray"
        case "tasks": return "checklist"
        case "employees": return "person.3"
        case "salespeople": return "person.crop.circle.badge.checkmark"
        case "offers": return "doc.text"
        case "fileText": return "doc.plaintext"
        case "fileType": return "doc.richtext"
        case "bookOpen": return "book"
        case "contacts": return "person.crop.rectangle.stack"
        case "contracts": return "signature"
        case "equipment", "box", "package": return "shippingbox"
        case "layers": return "square.stack.3d.up"
        case "cable": return "cable.connector"
        case "packageOpen": return "shippingbox.and.arrow.backward"
        case "plug": return "powerplug"
        case "folderTree": return "folder"
        case "fleet": return "car"
        case "page": return "globe"
        case "invoices": return "banknote"
        case "locations": return "mappin.and.ellipse"
        case "time": return "clock"
        case "databases": return "cylinder.split.1x2"
        case "tenders": return "briefcase"
        default: return "circle"
        }
    }
    /// Ekran natywny dla adresu CRM; `nil` — strona jeszcze tylko w przeglądarce.
    var module: Module? {
        switch path {
        case "/crm": return .day
        case "/crm/calendar": return .calendar
        case "/crm/events": return .events
        case "/crm/inquiries": return .inquiries
        case "/crm/tasks/mine": return .tasks
        case "/crm/contacts": return .contacts
        case "/crm/offers": return href.contains("tab=") && !href.contains("tab=offers") ? nil : .offers
        case "/crm/tenders": return .tenders
        default: return nil
        }
    }
    var flattened: [NavItem] { [self] + (children ?? []).flatMap(\.flattened) }
}

/// Strona CRM, której ekranu natywnego jeszcze nie ma — tymczasowo otwiera ją w przeglądarce.
struct CrmWebPlaceholder: View {
    let item: NavItem
    @EnvironmentObject private var state: Workspace
    var body: some View {
        ContentUnavailableView {
            Label(item.name, systemImage: item.symbol)
        } description: {
            Text("Ten ekran CRM powstaje w aplikacji. Do tego czasu otwórz go w przeglądarce — zalogujesz się tym samym kontem.")
        } actions: {
            Button("Otwórz w przeglądarce") { state.openCRM(item.href) }.buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle(item.name)
    }
}

struct CrmSidebar: View {
    @EnvironmentObject private var state: Workspace
    var body: some View {
        List(selection: Binding(get: { state.sidebarHref }, set: { href in if let href { state.openHref(href) } })) {
            ForEach(state.navigation) { item in
                if let children = item.children, !children.isEmpty {
                    DisclosureGroup {
                        ForEach(children) { child in row(child).tag(child.href) }
                    } label: { row(item) }
                } else {
                    row(item).tag(item.href)
                }
            }
        }
    }
    private func row(_ item: NavItem) -> some View {
        HStack {
            Label(item.name, systemImage: item.symbol)
            Spacer()
            if item.module == nil && (item.children ?? []).isEmpty { Image(systemName: "arrow.up.forward.square").font(.caption).foregroundStyle(.tertiary).help("Otwiera się w przeglądarce") }
            if item.module == .inquiries, state.openInquiries > 0 { Text("\(state.openInquiries)").foregroundStyle(.secondary).monospacedDigit() }
        }
    }
}

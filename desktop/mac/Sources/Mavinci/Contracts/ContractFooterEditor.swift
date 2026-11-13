import AppKit
import SwiftUI

// MARK: Edytor stopki szablonu umowy na Macu — dane firmy, logo i jego rozmiar, wariant stopki i podgląd jak w PDF.
// „Zastosuj” zmienia stopkę tego szablonu (zapis razem z treścią, ⌘S); szablony stopek (`footer_templates`, jak
// „Zapisz szablon stopki” w CRM) można zapisać jako nowe, zaktualizować albo usunąć.

@MainActor struct ContractFooterEditorSheet: View {
    @ObservedObject var store: ContractsStore
    @ObservedObject var controller: ContractEditorController
    @Environment(\.dismiss) private var dismiss
    @State private var footer: ContractPageLayout.Footer
    @State private var logoScale: Double
    @State private var variant: String
    @State private var templateID: String?
    @State private var name: String
    @State private var confirmDelete = false
    @State private var working = false

    init(store: ContractsStore, controller: ContractEditorController) {
        _store = ObservedObject(wrappedValue: store)
        _controller = ObservedObject(wrappedValue: controller)
        let layout = controller.pageLayout
        _footer = State(initialValue: layout.footerContent)
        _logoScale = State(initialValue: layout.footerLogoScale)
        _variant = State(initialValue: layout.selectedFooter)
        _templateID = State(initialValue: layout.selectedFooterTemplateId)
        _name = State(initialValue: controller.footerTemplates.first { $0.id == layout.selectedFooterTemplateId }?.name ?? "")
    }

    private var template: ContractTemplateDocumentPayload.FooterTemplate? {
        controller.footerTemplates.first { $0.id == templateID }
    }

    /// Dane w edytorze są takie jak w wybranym szablonie stopki (wtedy szablon umowy zapamiętuje, z którego pochodzą).
    private var matchesTemplate: Bool {
        guard let template else { return false }
        return template.companyName == footer.companyName && template.tagline == footer.tagline && template.website == footer.website
            && template.email == footer.email && template.phone == footer.phone && template.logoUrl == footer.logoUrl
            && Int(template.logoScale) == Int(logoScale)
    }

    private var preview: ContractPageLayout {
        var layout = controller.pageLayout
        layout.footerContent = footer
        layout.footerLogoScale = logoScale
        layout.selectedFooter = variant
        return layout
    }

    private var logos: [ContractTemplateDocumentPayload.BrandLogo] { controller.payload.brandLogos ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Stopka szablonu umowy").font(.title3.weight(.semibold))
                Spacer()
                Menu {
                    Button("Dane z szablonu umowy") { load(nil) }
                    if !controller.footerTemplates.isEmpty { Divider() }
                    ForEach(controller.footerTemplates, id: \.id) { item in
                        Button(item.isDefault == true ? "\(item.name) (domyślny)" : item.name) { load(item) }
                    }
                } label: {
                    Label(template?.name ?? "Szablon stopki", systemImage: "rectangle.stack")
                }
                .fixedSize()
                .help("Wczytaj dane z zapisanego szablonu stopki")
            }

            Form {
                Picker("Wariant", selection: $variant) {
                    Text("Pełna (z logo)").tag("default")
                    Text("Minimalna").tag("minimal")
                    Text("Bez stopki").tag("none")
                }
                .pickerStyle(.segmented)
                TextField("Nazwa firmy", text: $footer.companyName)
                TextField("Hasło", text: $footer.tagline, prompt: Text("np. Sztuka tworzenia eventów"))
                TextField("Strona www", text: $footer.website)
                TextField("E-mail", text: $footer.email)
                TextField("Telefon", text: $footer.phone)
                Picker("Logo", selection: $footer.logoUrl) {
                    Text("Jak w nagłówku").tag("")
                    Text("Event Rulers (domyślne)").tag(ContractPageLayout.defaultLogo)
                    ForEach(logos, id: \.self) { logo in
                        Text("\(logo.companyName) — \(logo.label)").tag(logo.url)
                    }
                    if !footer.logoUrl.isEmpty, footer.logoUrl != ContractPageLayout.defaultLogo, !logos.contains(where: { $0.url == footer.logoUrl }) {
                        Text("Własne logo").tag(footer.logoUrl)
                    }
                }
                .disabled(variant != "default")
                LabeledContent("Rozmiar logo") {
                    HStack {
                        Slider(value: $logoScale, in: 20...150)
                        Text("\(Int(logoScale.rounded())) %").monospacedDigit().frame(width: 44, alignment: .trailing)
                    }
                }
                .disabled(variant != "default")
            }
            .formStyle(.grouped)
            .frame(height: 360)

            Text("Podgląd").font(.caption).foregroundStyle(.secondary)
            ContractFooterPreview(settings: preview, fontFamily: controller.documentFont)
                .frame(width: ContractPage.width)
                .clipShape(RoundedRectangle(cornerRadius: 4))
                .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.primary.opacity(0.12)))

            HStack(spacing: 8) {
                TextField("Nazwa szablonu stopki", text: $name).frame(width: 200)
                Button("Zapisz jako nowy szablon") { Task { await save(asNew: true) } }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || working)
                if let template {
                    Button("Zaktualizuj „\(template.name)”") { Task { await save(asNew: false) } }
                        .disabled(working)
                    Button("Usuń", role: .destructive) { confirmDelete = true }
                        .disabled(working)
                }
            }
            .controlSize(.small)

            HStack {
                Text("Zmiana stopki zapisze się w szablonie umowy razem z treścią (⌘S).")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Anuluj") { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Button("Zastosuj") {
                    apply(templateID: matchesTemplate ? templateID : nil)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(20)
        .frame(width: ContractPage.width + 40)
        .confirmationDialog("Usunąć szablon stopki „\(template?.name ?? "")”?", isPresented: $confirmDelete) {
            Button("Usuń szablon stopki", role: .destructive) { Task { await remove() } }
            Button("Anuluj", role: .cancel) {}
        } message: {
            Text("Szablony umów, które go używają, zachowają swoje dane stopki.")
        }
    }

    private func load(_ item: ContractTemplateDocumentPayload.FooterTemplate?) {
        guard let item else {
            templateID = nil
            name = ""
            footer = controller.pageLayout.footerContent
            logoScale = controller.pageLayout.footerLogoScale
            return
        }
        templateID = item.id
        name = item.name
        footer = ContractPageLayout.Footer(companyName: item.companyName, tagline: item.tagline, website: item.website,
                                           email: item.email, phone: item.phone, logoUrl: item.logoUrl)
        logoScale = item.logoScale
    }

    private func apply(templateID id: String?) {
        controller.applyFooter(footer, logoScale: logoScale.rounded(), variant: variant, templateID: id)
    }

    private func save(asNew: Bool) async {
        working = true
        defer { working = false }
        let title = asNew ? name.trimmingCharacters(in: .whitespaces) : (template?.name ?? name)
        guard let result = await store.saveFooterTemplate(id: asNew ? nil : templateID, name: title, footer: footer, logoScale: logoScale.rounded()) else { return }
        controller.replaceFooterTemplates(result.list)
        templateID = result.id
        apply(templateID: result.id)
        dismiss()
    }

    private func remove() async {
        guard let id = templateID else { return }
        working = true
        defer { working = false }
        guard let list = await store.deleteFooterTemplate(id) else { return }
        controller.replaceFooterTemplates(list)
        templateID = nil
        name = ""
    }
}

/// Podgląd stopki jak na kartce (`ContractSheetFooterView`).
struct ContractFooterPreview: NSViewRepresentable {
    let settings: ContractPageLayout
    let fontFamily: String

    final class Coordinator {
        var observer: NSObjectProtocol?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> ContractSheetFooterView {
        let view = ContractSheetFooterView()
        context.coordinator.observer = NotificationCenter.default.addObserver(forName: ContractImageStore.loaded, object: nil, queue: .main) { [weak view] _ in
            MainActor.assumeIsolated { view?.needsDisplay = true }
        }
        return view
    }

    func updateNSView(_ view: ContractSheetFooterView, context: Context) {
        view.settings = settings
        view.fontFamily = fontFamily
        view.needsDisplay = true
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: ContractSheetFooterView, context: Context) -> CGSize? {
        nsView.settings = settings
        nsView.fontFamily = fontFamily
        return CGSize(width: ContractPage.width, height: max(40, nsView.preferredHeight + 10))
    }

    static func dismantleNSView(_ view: ContractSheetFooterView, coordinator: Coordinator) {
        if let observer = coordinator.observer { NotificationCenter.default.removeObserver(observer) }
    }
}

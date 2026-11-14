import SwiftUI

// MARK: Dodatki pozycji w ofercie (`ProductAddonsEditor` w oknach pozycji i propozycji): nazwa, sposób naliczania, jednostka,
// sposób wyliczania ilości, limit w pakiecie, ilość, cena, wybór opcji, zakres i podsumowanie płatnej ilości.

@MainActor struct OfferAddonRows: View {
    @Binding var addons: [ProductAddonItem]

    var body: some View {
        ForEach(addons.indices, id: \.self) { index in addonRow(index) }
    }

    private func addonRow(_ index: Int) -> some View {
        let addon = addons.indices.contains(index) ? addons[index] : ProductAddonItem.blank()
        func binding<T>(_ key: WritableKeyPath<ProductAddonItem, T>) -> Binding<T> {
            Binding(get: { addons.indices.contains(index) ? addons[index][keyPath: key] : addon[keyPath: key] },
                    set: { value in if addons.indices.contains(index) { addons[index][keyPath: key] = value } })
        }
        let automatic = addon.kind != "optional" && (addon.quantity_source ?? "manual") != "manual"
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("", text: binding(\.name), prompt: Text("Nazwa dodatku")).textFieldStyle(.roundedBorder)
                Button(role: .destructive) { addons.remove(at: index) } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).help("Usuń dodatek")
            }
            HStack(alignment: .top, spacing: 10) {
                ProductField(label: "Sposób naliczania") {
                    Picker("", selection: Binding(get: { addon.kind }, set: { kind in
                        guard addons.indices.contains(index) else { return }
                        addons[index].kind = kind
                        addons[index].enabled = false
                        if kind == "optional" { addons[index].quantity_source = "manual" }
                    })) {
                        ForEach(ProductAddonItem.kinds, id: \.key) { kind in Text(kind.label).tag(kind.key) }
                    }
                    .labelsHidden().fixedSize()
                }
                ProductField(label: "Jednostka") {
                    TextField("", text: binding(\.unit)).textFieldStyle(.roundedBorder).frame(width: 80)
                }
                if addon.kind != "optional" {
                    ProductField(label: "Sposób wyliczania ilości") {
                        Picker("", selection: Binding(get: { addon.quantity_source ?? "manual" }, set: { value in
                            if addons.indices.contains(index) { addons[index].quantity_source = value }
                        })) {
                            ForEach(ProductText.quantitySources, id: \.key) { source in Text(source.label).tag(source.key) }
                        }
                        .labelsHidden().fixedSize()
                    }
                }
            }
            HStack(alignment: .top, spacing: 10) {
                if addon.kind == "over_limit" {
                    ProductField(label: "W cenie pakietu") {
                        ProductNumberField(value: Binding(get: { addon.included_quantity }, set: { value in
                            if addons.indices.contains(index) { addons[index].included_quantity = value ?? 0 }
                        })).frame(width: 100)
                    }
                }
                if addon.kind != "optional" {
                    ProductField(label: addon.kind == "over_limit" ? "Łączna potrzebna ilość" : "Ilość") {
                        ProductNumberField(value: Binding(get: { addon.quantity }, set: { value in
                            if addons.indices.contains(index) { addons[index].quantity = value ?? 0 }
                        })).frame(width: 100).disabled(automatic)
                    }
                }
                ProductField(label: addon.kind == "optional" ? "Cena dodatku netto (zł)" : "Cena za dodatkową jednostkę netto (zł)") {
                    ProductNumberField(value: Binding(get: { addon.unit_price }, set: { value in
                        if addons.indices.contains(index) { addons[index].unit_price = value ?? 0 }
                    }), prompt: addon.price_on_request == true ? "Do indywidualnej wyceny" : "").frame(width: 140)
                }
                if addon.kind == "optional" {
                    Toggle("Dodaj do oferty", isOn: binding(\.enabled)).toggleStyle(.checkbox).padding(.top, 18)
                }
            }
            if addon.price_on_request == true && addon.unit_price <= 0 {
                Text(addon.payableQuantity > 0 ? "Wpisz uzgodnioną cenę, aby zapisać ofertę. Ta opcja nie jest bezpłatna." : "Opcja do indywidualnej wyceny. Cenę uzupełnisz po jej wybraniu.")
                    .font(.caption).foregroundStyle(addon.payableQuantity > 0 ? .red : .secondary)
            }
            if let role = addon.staff_role, !role.isEmpty, addon.payableQuantity > 0 {
                Text("Obsada pakietu: \(role) × \(OfferText.number(addon.payableQuantity)). Uzupełnij koszt i czas pracy w „Sprzęt i obsada pakietu” (CRM).")
                    .font(.caption).foregroundStyle(.secondary)
            }
            ProductField(label: "Zakres / warunki widoczne w kalkulacji") {
                ProductTextArea(text: Binding(get: { addon.description }, set: { value in
                    if addons.indices.contains(index) { addons[index].description = String(value.prefix(500)) }
                }), lines: 2...4)
            }
            if !(addon.price_on_request == true && addon.unit_price <= 0) {
                Text((addon.kind == "over_limit" ? "W pakiecie: \(OfferText.number(addon.included_quantity)). Płatne ponad limit: " : "Płatna ilość: ")
                     + "\(OfferText.number(addon.payableQuantity)) × \(OfferText.number(addon.unit_price)) zł = \(OfferText.number((addon.payableQuantity * addon.unit_price * 100).rounded() / 100)) zł netto")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 8))
    }
}

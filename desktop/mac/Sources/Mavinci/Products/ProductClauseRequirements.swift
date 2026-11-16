import SwiftUI

// MARK: Wymagania z parametrami w klauzulach produktu (`contractRequirements.ts`) — zasilanie, internet, miejsce,
// dojazd, montaż i zaplecze. Umowa łączy je z wymaganiami innych usług w jeden zapis na typ (mocniejsze pokrywa słabsze,
// osobne obwody liczone oddzielnie). Pola formularza opisuje serwer (`clauseMeta.requirementTypes`), zdanie do umowy
// liczy serwer przy zapisie.

/// Parametry wymagania: typ i wartości (liczby, pola wyboru, wartości z listy).
struct ClauseRequirement: Codable, Hashable {
    var type: String
    var numbers: [String: Double] = [:]
    var flags: [String: Bool] = [:]
    var texts: [String: String] = [:]

    init(type: String) { self.type = type }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    init(from decoder: Decoder) throws {
        let object = try [String: JSONValue](from: decoder)
        guard case .string(let type)? = object["type"] else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Brak typu wymagania"))
        }
        self.type = type
        for (key, value) in object where key != "type" {
            switch value {
            case .number(let number): numbers[key] = number
            case .bool(let flag): flags[key] = flag
            case .string(let text): texts[key] = text
            default: break
            }
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(type, forKey: Key(stringValue: "type"))
        for (key, value) in numbers { try container.encode(value, forKey: Key(stringValue: key)) }
        for (key, value) in flags { try container.encode(value, forKey: Key(stringValue: key)) }
        for (key, value) in texts { try container.encode(value, forKey: Key(stringValue: key)) }
    }

    /// Do zapisu (`clausesSave`): obiekt z typem i ustawionymi wartościami.
    var json: JSONValue {
        var object: [String: JSONValue] = ["type": .string(type)]
        numbers.forEach { object[$0.key] = .number($0.value) }
        flags.filter { $0.value }.forEach { object[$0.key] = .bool(true) }
        texts.filter { !$0.value.isEmpty }.forEach { object[$0.key] = .string($0.value) }
        return .object(object)
    }
}

extension ProductResources {
    struct RequirementOption: Codable, Hashable {
        var value: String
        var label: String
    }
    /// Pole parametru: `number` (z jednostką), `bool` (pole wyboru) albo `choice` (lista; `numeric` — wartość liczbowa).
    struct RequirementField: Codable, Hashable {
        var key: String
        var label: String
        var kind: String
        var suffix: String?
        var options: [RequirementOption]?
        var numeric: Bool?
    }
    struct RequirementType: Codable, Hashable {
        var type: String
        var label: String
        var category: String
        var topic: String
        var fields: [RequirementField]
        var defaults: ClauseRequirement
    }
}

/// Formularz parametrów wymagania zbudowany z opisu pól z serwera.
struct ClauseRequirementForm: View {
    let definition: ProductResources.RequirementType
    @Binding var requirement: ClauseRequirement

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10, alignment: .top), GridItem(.flexible(), spacing: 10, alignment: .top)],
                      alignment: .leading, spacing: 8) {
                ForEach(definition.fields.filter { $0.kind != "bool" }, id: \.key) { field in
                    ProductField(label: field.label) { control(field) }
                }
            }
            ForEach(definition.fields.filter { $0.kind == "bool" }, id: \.key) { field in
                Toggle(field.label, isOn: Binding(get: { requirement.flags[field.key] == true },
                                                  set: { requirement.flags[field.key] = $0 ? true : nil }))
                    .toggleStyle(.checkbox)
            }
        }
    }

    @ViewBuilder private func control(_ field: ProductResources.RequirementField) -> some View {
        if field.kind == "choice" {
            Picker("", selection: Binding(get: { choice(field) }, set: { setChoice(field, $0) })) {
                ForEach(field.options ?? [], id: \.value) { option in Text(option.label).tag(option.value) }
            }
            .labelsHidden()
        } else {
            ProductNumberField(value: Binding(get: { requirement.numbers[field.key] },
                                              set: { requirement.numbers[field.key] = $0.flatMap { $0 > 0 ? $0 : nil } }),
                               prompt: "—", nullable: true, suffix: field.suffix)
        }
    }

    private func choice(_ field: ProductResources.RequirementField) -> String {
        if field.numeric == true, let number = requirement.numbers[field.key] {
            return number.rounded() == number ? String(Int(number)) : String(number)
        }
        return requirement.texts[field.key] ?? ""
    }

    private func setChoice(_ field: ProductResources.RequirementField, _ value: String) {
        if field.numeric == true {
            requirement.numbers[field.key] = Double(value)
        } else {
            requirement.texts[field.key] = value.isEmpty ? nil : value
        }
    }
}

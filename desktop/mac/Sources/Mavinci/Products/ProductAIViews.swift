import SwiftUI

// MARK: Karta produktu, część C2b — propozycje treści z AI (`assist-inquiry`): „Zaproponuj treść z AI” w prezentacji karty
// (`draft_product_offer_content`) i „Opis AI” w wariancie lub elemencie (`draft_variant_copy`). Propozycja wypełnia formularz,
// ale niczego nie zapisuje — zapis jak zwykle przyciskiem sekcji.

/// Robocza treść karty produktu: lead, opis rozszerzony i korzyści.
struct ProductOfferAIDraft: Codable, Equatable {
    var shortDescription: String
    var description: String
    var benefits: [String]
    var imageAlt: String
}

/// Krótki opis (do 95 znaków) i opis (do 205) wariantu lub elementu.
struct ProductVariantAIDraft: Codable, Equatable {
    var shortDescription: String
    var description: String
}

extension ProductsStore {
    /// Propozycja AI z bieżącej (także niezapisanej) treści edytora prezentacji.
    func draftOfferCopy(_ productID: String, current: [String: JSONValue]) async -> ProductOfferAIDraft? {
        guard let api, let workspace else { return nil }
        guard workspace.canWrite else {
            workspace.error = "Propozycja AI wymaga połączenia z serwerem CRM."
            return nil
        }
        do {
            let body: [String: JSONValue] = ["op": .string("aiOffer"), "id": .string(productID), "current": .object(current)]
            let data = try await workspace.withPending("Przygotowywanie propozycji AI…") { try await api.post("/products", body, timeout: 120) }
            return try JSONDecoder().decode(ProductOfferAIDraft.self, from: data)
        } catch {
            workspace.error = failureText(error, "Nie udało się przygotować propozycji AI")
            return nil
        }
    }

    /// Opisy wariantu według wytycznych — błąd wraca do okna „Opis AI”.
    func draftVariantCopy(_ productID: String, variant: ProductExtras.Variant, instructions: String) async throws -> ProductVariantAIDraft {
        guard let api, workspace?.canWrite == true else { throw NativeFailure(status: 0, message: "Opis AI wymaga połączenia z serwerem CRM.", fieldErrors: [:]) }
        let body: [String: JSONValue] = [
            "op": .string("aiVariant"), "id": .string(productID), "instructions": .string(instructions),
            "variant": .object([
                "name": .string(variant.name), "short_description": .string(variant.shortDescription),
                "description": .string(variant.description), "benefits": .array(variant.benefits.map { JSONValue.string($0) }),
                "service_duration_hours": variant.serviceDurationHours.map { JSONValue.number($0) } ?? .null,
            ]),
        ]
        let data = try await api.post("/products", body, timeout: 120)
        return try JSONDecoder().decode(ProductVariantAIDraft.self, from: data)
    }
}

/// „Robocza propozycja AI” pod przyciskiem w edytorze prezentacji (jak w CRM): podgląd, „Odrzuć” i „Zastosuj do formularza”.
struct ProductOfferAIDraftBox: View {
    let draft: ProductOfferAIDraft
    let onDiscard: () -> Void
    let onApply: () -> Void
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Robocza propozycja AI", systemImage: "sparkles").font(.callout.weight(.semibold))
                    Text("Sprawdź treść. Zastosowanie wypełni formularz, ale nie zapisze produktu.").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Odrzuć", action: onDiscard)
                Button("Zastosuj do formularza", action: onApply).buttonStyle(.borderedProminent)
            }
            .controlSize(.small)
            Text(draft.shortDescription).font(.callout.weight(.medium)).textSelection(.enabled)
            Text(draft.description).font(.callout).foregroundStyle(.secondary).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if !draft.benefits.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(draft.benefits.enumerated()), id: \.offset) { _, benefit in
                        Label(benefit, systemImage: "checkmark").font(.callout)
                    }
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(theme.accent.opacity(0.35)))
    }
}

/// „Opis AI — nazwa wariantu”: wytyczne, generowanie i poprawki propozycji przed wstawieniem do formularza wariantu.
@MainActor struct ProductVariantAISheet: View {
    @ObservedObject var store: ProductsStore
    let productID: String
    let variant: ProductExtras.Variant
    @Binding var instructions: String
    let onInsert: (ProductVariantAIDraft) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.crmTheme) private var theme
    @State private var draft: ProductVariantAIDraft?
    @State private var busy = false
    @State private var problem: String?
    @State private var request: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Opis AI — \(variant.name.isEmpty ? "wariant" : variant.name)").font(.title3.weight(.semibold))
                Spacer()
            }
            Text("Krótki opis: maks. 95 znaków. Opis wariantu: maks. 205 znaków ze spacjami. Te limity odpowiadają karcie porównania wariantów w wydruku.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            ProductField(label: "Twoje wytyczne", help: "\(instructions.count)/2000") {
                ProductTextArea(text: Binding(get: { instructions }, set: { instructions = String($0.prefix(2000)) }),
                                prompt: "Np. podkreśl elegancki charakter oprawy i kameralne przyjęcia. Pisz konkretnie, bez superlatywów.", lines: 4...6)
                    .disabled(busy)
            }
            if let problem { Text(problem).font(.callout).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true) }
            HStack(spacing: 8) {
                Button { generate() } label: {
                    Label(busy ? "Generuję…" : draft == nil ? "Wygeneruj opisy" : "Wygeneruj ponownie", systemImage: "sparkles")
                }
                .disabled(busy || instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if busy { ProgressView().controlSize(.small) }
            }
            if let current = draft {
                VStack(alignment: .leading, spacing: 10) {
                    ProductField(label: "Krótki opis", help: "\(current.shortDescription.count)/95") {
                        TextField("", text: Binding(get: { draft?.shortDescription ?? "" }, set: { draft?.shortDescription = String($0.prefix(95)) }))
                            .textFieldStyle(.roundedBorder)
                    }
                    ProductField(label: "Opis wariantu", help: "\(current.description.count)/205") {
                        ProductTextArea(text: Binding(get: { draft?.description ?? "" }, set: { draft?.description = String($0.prefix(205)) }), lines: 3...5)
                    }
                    Text("Sprawdź treść przed wstawieniem. Opisy zapiszą się po zapisaniu wariantu.").font(.caption).foregroundStyle(.secondary)
                }
                .padding(12)
                .background(theme.card, in: RoundedRectangle(cornerRadius: 8))
                .disabled(busy)
            }
            HStack {
                Spacer()
                Button("Zamknij") { close() }.keyboardShortcut(.cancelAction)
                Button("Wstaw do wariantu") {
                    if let draft { onInsert(draft) }
                    close()
                }
                .keyboardShortcut(.defaultAction).buttonStyle(.borderedProminent)
                .disabled(busy || draft.map { $0.shortDescription.trimmingCharacters(in: .whitespaces).isEmpty
                    || $0.description.trimmingCharacters(in: .whitespaces).isEmpty } ?? true)
            }
        }
        .padding(18)
        .frame(width: 560)
        .background(theme.page)
        .onDisappear { request?.cancel() }
    }

    private func generate() {
        guard !busy else { return }
        busy = true
        problem = nil
        request = Task {
            do {
                let result = try await store.draftVariantCopy(productID, variant: variant, instructions: instructions)
                if Task.isCancelled { return }
                draft = result
            } catch {
                if !Task.isCancelled { problem = store.failureText(error, "Nie udało się wygenerować opisów. Spróbuj ponownie.") }
            }
            busy = false
        }
    }

    private func close() {
        request?.cancel()
        dismiss()
    }
}

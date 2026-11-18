import SwiftUI

// MARK: Zaproszenie do portalu sprzedawcy — co dostaje sprzedawca i osobista wiadomość. E-mail buduje serwer CRM
// (`src/lib/seller/accessEmail.server.ts`, wysyłka `/bridge/seller/invite`): link do ustawienia hasła, adres logowania i login,
// „Jak zacząć” (przewodnik i instrukcja portalu, marki), kontakt do opiekuna (bez opiekuna — zapraszający pracownik) i wiadomość.
// Używane w kroku „Zaproszenie” kreatora (`NewSellerWizard.swift`) i przy ponownym wysłaniu z „Gotowości do pracy”.

/// Lista tego, co znajdzie się w e-mailu z zaproszeniem.
struct SellerInviteContents: View {
    let email: String?
    /// Opiekun (gdy przypisany) albo zapraszający pracownik.
    let contactName: String?
    let managerAssigned: Bool
    let brands: [String]
    @Environment(\.crmTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Co otrzyma sprzedawca").font(.headline)
            Text("E-mail z MAVINCI na adres \(email ?? "z karty kontaktu"):").font(.callout).foregroundStyle(.secondary)
            item("key", "Link do ustawienia hasła", "Przycisk „Utwórz hasło i zacznij” — link jednorazowy, ważny przez ograniczony czas.")
            item("person.badge.key", "Adres logowania i login", "mavinci.pl/login · login: \(email ?? "adres e-mail kontaktu")")
            item("book", "Instrukcja „Jak zacząć”", "Przewodnik „Witaj w portalu MAVINCI” po pierwszym logowaniu i stała instrukcja: mavinci.pl/seller/help.")
            if !brands.isEmpty { item("tag", "Marki w portalu", brands.joined(separator: ", ")) }
            item("person.crop.circle", managerAssigned ? "Kontakt do opiekuna" : "Kontakt w MAVINCI",
                 (contactName?.isEmpty == false ? contactName! : "Ty") + (managerAssigned ? "" : " — do czasu przypisania opiekuna") + " · e-mail i telefon z karty pracownika")
            item("text.bubble", "Twoja wiadomość", "Jeśli ją wpiszesz — nad instrukcją, z Twoim podpisem.")
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
    }

    private func item(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbol).foregroundStyle(theme.accent).frame(width: 20)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.callout.weight(.medium))
                Text(detail).font(.caption).foregroundStyle(.secondary).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// Ponowne wysłanie dostępu do portalu („Gotowość do pracy” → wyślij zaproszenie): podgląd treści i osobista wiadomość.
@MainActor struct SellerInviteSheet: View {
    @ObservedObject var store: SellersStore
    let partnerID: String
    let sellerName: String
    let email: String?
    let managerName: String?
    let onSent: () -> Void
    @EnvironmentObject private var state: Workspace
    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var sending = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Wyślij dostęp do portalu").font(.title3.weight(.light))
                    Text(sellerName).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Anuluj") { dismiss() }.keyboardShortcut(.cancelAction)
            }
            SellerInviteContents(email: email, contactName: managerName ?? state.employee?.displayName, managerAssigned: managerName != nil, brands: [])
            VStack(alignment: .leading, spacing: 4) {
                TextField("Wiadomość od Ciebie (opcjonalnie) — np. przypomnienie o pierwszej ofercie", text: $message, axis: .vertical)
                    .lineLimit(3...6).textFieldStyle(.roundedBorder)
                Text("Jeśli sprzedawca ma już konto, link pozwoli mu ustawić nowe hasło. Marki z aktywnych warunków serwer dopisze do instrukcji.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                Button(sending ? "Wysyłanie…" : "Wyślij e-mail") { Task { await send() } }
                    .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
                    .disabled(sending || !state.canWrite)
            }
        }
        .padding(20)
        .frame(width: 560)
        .onChange(of: message) { _, value in if value.count > 2000 { message = String(value.prefix(2000)) } }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        if await store.resendInvite(partnerID, message: message) {
            dismiss()
            onSent()
        }
    }
}

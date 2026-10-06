import Foundation

struct ReminderListChoice: Identifiable, Equatable {
    let id: String
    let title: String
    let account: String
}

enum RemindersError: LocalizedError {
    case accessDenied, noLists, missingList(String), ambiguousList(String), readOnly, fetchFailed, busy
    var errorDescription: String? {
        switch self {
        case .accessDenied: return "macOS nie przyznał tej kopii aplikacji dostępu do Przypomnień. Uruchom docelową wersję z folderu Aplikacje i zezwól na dostęp."
        case .noLists: return "macOS nie zwrócił żadnej listy Przypomnień mimo przyznanego dostępu. Otwórz Przypomnienia i poczekaj na odczyt konta iCloud, następnie ponów odczyt w Ogólne → Zmień. Nie utworzono zastępczej listy."
        case .missingList(let name): return "Nie odnaleziono listy „\(name)” w Przypomnieniach. Wybierz istniejącą listę w Ogólne → Zmień. Zadania w CRM pozostały bez zmian."
        case .ambiguousList(let name): return "Istnieje kilka list „\(name)”. Wybierz właściwą listę i konto w Ogólne → Zmień."
        case .readOnly: return "Wybrana lista Przypomnień jest tylko do odczytu. Wybierz listę, do której możesz dodawać zadania."
        case .fetchFailed: return "macOS nie zwrócił zawartości listy Przypomnień. Nie potraktowano błędu jako pustej listy i nie utworzono kopii zadań. Ponów synchronizację."
        case .busy: return "Trwa odczyt lub synchronizacja Przypomnień. Poczekaj na zakończenie."
        }
    }
}

/// Pure selection logic: an empty result is not permission to create a duplicate list.
enum ReminderListResolver {
    static func resolve(_ lists: [ReminderListChoice], cachedID: String?, name: String) throws -> ReminderListChoice {
        if let cachedID, let match = lists.first(where: { $0.id == cachedID }) { return match }
        guard !lists.isEmpty else { throw RemindersError.noLists }
        let matches = lists.filter { $0.title == name }
        guard matches.count <= 1 else { throw RemindersError.ambiguousList(name) }
        guard let match = matches.first else { throw RemindersError.missingList(name) }
        return match
    }
}

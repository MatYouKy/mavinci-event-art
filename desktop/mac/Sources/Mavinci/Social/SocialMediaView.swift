import SwiftUI

// MARK: Marketing → „Social media” — 1:1 z `/crm/marketing/social`: nagłówek z marką, „Szablony i AI”, „Nowy post”, stan
// publikacji w Meta, widoki Kalendarz (miesiąc z przeciąganiem terminu, szkice bez terminu, wymagające uwagi), Do akceptacji
// (także błędy publikacji), Biblioteka, Komentarze i Statystyki (z raportem tygodniowym). Post otwiera się w kreatorze na całej
// szerokości ekranu (`SocialPostEditorView`).

@MainActor struct SocialMediaView: View {
    @ObservedObject var store: SocialStore
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var dropTarget: Date?

    private let weekdays = ["pon", "wt", "śr", "czw", "pt", "sob", "nd"]

    var body: some View {
        content
            .navigationTitle("Social media")
            .navigationSubtitle(store.home?.company.name ?? "")
            .task(id: state.employee?.id) { await store.load(quiet: store.home != nil) }
            .sheet(isPresented: $store.settingsShown) {
                SocialSettingsSheet(store: store).environmentObject(state).environment(\.crmTheme, theme)
            }
    }

    @ViewBuilder private var content: some View {
        if let id = store.openedPostID {
            SocialPostEditorView(store: store, postID: id)
        } else if let home = store.home {
            main(home)
        } else if let error = store.loadError {
            ContentUnavailableView {
                Label("Social media", systemImage: "photo.on.rectangle.angled")
            } description: { Text(error) } actions: {
                Button("Spróbuj ponownie") { Task { await store.load() } }
            }
        } else {
            ProgressView("Ładowanie...").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func main(_ home: SocialHome) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            header(home)
            tabs(home)
            if let meta = home.meta, home.access.publish || home.access.create { metaBanner(meta, company: home.company.id) }
            switch store.tab {
            case .calendar: calendar(home)
            case .review: review(home)
            case .library: SocialLibraryView(store: store)
            case .comments: ScrollView { SocialCommentsView(store: store, postID: nil).padding(12) }
                .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
            case .stats: SocialStatsView(store: store)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func header(_ home: SocialHome) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Label("Marketing", systemImage: "sparkles").font(.callout).foregroundStyle(theme.accent)
                Text("Social media").font(.title.weight(.light))
                Text("Grafiki z szablonu marki (księga znaku), kalendarz publikacji z akceptacją, biblioteka zdjęć z realizacji ze zgodą klienta, statystyki i raport tygodniowy.")
                    .font(.callout).foregroundStyle(.secondary).lineLimit(2)
            }
            .layoutPriority(1)
            Spacer(minLength: 16)
            if store.loading { ProgressView().controlSize(.small) }
            if home.companies.count > 1 {
                Picker("Marka", selection: Binding(get: { store.companyID ?? home.company.id }, set: { value in
                    Task { await store.selectCompany(value) }
                })) {
                    ForEach(home.companies) { company in Text(company.name).tag(company.id) }
                }
                .frame(width: 180)
            }
            Button { Task { await store.load() } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
            if home.access.approve {
                Button { store.settingsShown = true } label: { Label("Szablony i AI", systemImage: "slider.horizontal.3") }
            }
            if home.access.create {
                Button { Task { await store.createPost() } } label: { Label("Nowy post", systemImage: "plus") }.buttonStyle(.borderedProminent)
            }
        }
    }

    private func tabs(_ home: SocialHome) -> some View {
        HStack(spacing: 8) {
            ForEach(SocialTab.allCases) { tab in
                let count = tabCount(tab, home.counts)
                Button { store.tab = tab } label: {
                    HStack(spacing: 6) {
                        Image(systemName: tab.symbol)
                        Text(tab.label)
                        if count > 0 {
                            Text("\(count)").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1)
                                .background(Capsule().fill(theme.accent)).foregroundStyle(Color.black.opacity(0.8))
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(RoundedRectangle(cornerRadius: 8).fill(store.tab == tab ? theme.accent.opacity(0.18) : theme.card))
                    .foregroundStyle(store.tab == tab ? theme.accent : Color.primary)
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
    }

    private func tabCount(_ tab: SocialTab, _ counts: SocialCounts) -> Int {
        switch tab {
        case .calendar: return 0
        case .review: return counts.inReview + counts.changesRequested + (counts.failed ?? 0)
        case .library: return counts.proposals
        case .comments: return counts.unansweredComments ?? 0
        case .stats: return 0
        }
    }

    /// Stan konta Meta marki: strona, Instagram, gotowość kanałów i braki (konto ustawia się w ustawieniach marketingu marki).
    private func metaBanner(_ meta: SocialMetaStatus, company: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("Publikacja w Meta:").font(.callout).foregroundStyle(.secondary)
            Label(meta.pageName ?? "brak strony", systemImage: "f.square").font(.callout)
            Label(meta.instagramUsername.map { "@\($0)" } ?? "brak konta Instagram", systemImage: "camera").font(.callout)
            ForEach(SocialChannel.allCases) { channel in
                let ready = meta.channel(channel)?.ready == true
                Label(channel.label, systemImage: ready ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(ready ? Color.green : Color.orange)
                    .help(meta.channel(channel)?.problem ?? "Gotowe do publikacji")
            }
            Spacer(minLength: 8)
            if !meta.allReady {
                let problems = Array(Set(SocialChannel.allCases.compactMap { meta.channel($0)?.problem })).sorted()
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(problems.prefix(2), id: \.self) { Text($0).font(.caption2) }
                    if !meta.missingScopes.isEmpty { Text("Brakujące uprawnienia Meta: " + meta.missingScopes.joined(separator: ", ") + ".").font(.caption2).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: 460, alignment: .leading)
                .foregroundStyle(.orange)
            }
            Button { state.openCRM("/crm/settings/my-companies/\(company)/marketing") } label: { Label("Ustawienia Meta", systemImage: "arrow.up.right.square") }
                .buttonStyle(.link).font(.caption)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(theme.card))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(meta.allReady ? Color.clear : Color.orange.opacity(0.4)))
    }

    // MARK: Kalendarz
    private func calendar(_ home: SocialHome) -> some View {
        GeometryReader { geometry in
            let wide = geometry.size.width >= 1180
            HStack(alignment: .top, spacing: 14) {
                monthGrid(home, listsBelow: !wide)
                if wide { ScrollView { sideLists(home) }.frame(width: 300) }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    private func monthGrid(_ home: SocialHome, listsBelow: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }.help("Poprzedni miesiąc")
                Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }.help("Następny miesiąc")
                Button("Dziś") { store.month = SocialStore.firstOfMonth(Date()); Task { await store.load(quiet: true) } }
                Spacer()
                Text(store.month.formatted(.dateTime.month(.wide).year())).font(.title3.weight(.light))
            }
            ScrollView {
                let days = store.gridDays
                let columns = Array(repeating: GridItem(.flexible(minimum: 90), spacing: 4), count: 7)
                LazyVGrid(columns: columns, alignment: .leading, spacing: 4) {
                    ForEach(weekdays, id: \.self) { day in
                        Text(day.uppercased()).font(.caption2).foregroundStyle(.secondary).padding(.leading, 4)
                    }
                    ForEach(days, id: \.self) { day in dayCell(day, home: home) }
                }
                Text("Przeciągnij post na inny dzień, żeby zmienić termin (godzina zostaje; zaplanowaną publikację przenosi osoba z uprawnieniem „Publikacja”). Dwuklik na dniu — nowy post na ten dzień.")
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 6)
                if listsBelow { sideLists(home).padding(.top, 12) }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func dayCell(_ day: Date, home: SocialHome) -> some View {
        let calendar = Calendar.current
        let inMonth = calendar.isDate(day, equalTo: store.month, toGranularity: .month)
        let today = calendar.isDateInToday(day)
        let posts = store.posts(on: day)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Spacer()
                Text("\(calendar.component(.day, from: day))").font(.caption.weight(today ? .bold : .regular))
                    .foregroundStyle(today ? theme.accent : Color.secondary)
            }
            ForEach(posts) { post in chip(post, access: home.access) }
            Spacer(minLength: 0)
        }
        .padding(5)
        .frame(minHeight: 112, alignment: .top)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(inMonth ? 0.04 : 0.015)))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(dropTarget == day ? theme.accent : today ? theme.accent.opacity(0.6) : Color.clear, lineWidth: dropTarget == day ? 2 : 1))
        .opacity(inMonth ? 1 : 0.55)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) {
            guard home.access.create else { return }
            var parts = calendar.dateComponents([.year, .month, .day], from: day)
            parts.hour = 18
            Task { await store.createPost(scheduledAt: calendar.date(from: parts)) }
        }
        .dropDestination(for: String.self) { ids, _ in
            guard let id = ids.first, home.access.create else { return false }
            Task { await store.schedule(id, to: day) }
            return true
        } isTargeted: { inside in
            if inside { dropTarget = day } else if dropTarget == day { dropTarget = nil }
        }
    }

    /// Post w kalendarzu: klik — kreator, przeciągnięcie na inny dzień — nowy termin (zmienia tylko twórca treści).
    private func chip(_ post: SocialPostItem, access: SocialAccess) -> some View {
        HStack(spacing: 6) {
            SocialImageView(url: post.thumbnailUrl).frame(width: 26, height: 33).clipShape(RoundedRectangle(cornerRadius: 3))
            VStack(alignment: .leading, spacing: 2) {
                Text((post.scheduledDate.map(SocialDates.time) ?? "") + " " + post.displayTitle).font(.caption2).lineLimit(1)
                SocialStatusBadge(status: post.status)
            }
            Spacer(minLength: 0)
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.06)))
        .contentShape(Rectangle())
        .onTapGesture { store.openPost(post.id) }
        .help(post.publishError ?? post.displayTitle)
        .draggable(post.id) {
            Text(post.displayTitle).padding(6).background(RoundedRectangle(cornerRadius: 6).fill(theme.card))
        }
    }

    private func sideLists(_ home: SocialHome) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            listCard("Szkice bez terminu", posts: store.undatedPosts, empty: "Brak szkiców bez terminu.", access: home.access)
            listCard("Wymaga uwagi", posts: store.reviewPosts, empty: "Nic nie czeka.", access: home.access)
        }
    }

    private func listCard(_ title: String, posts: [SocialPostItem], empty: String, access: SocialAccess) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            if posts.isEmpty { Text(empty).font(.callout).foregroundStyle(.secondary) }
            ForEach(posts) { post in chip(post, access: access) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
    }

    private func shiftMonth(_ delta: Int) {
        store.month = Calendar.current.date(byAdding: .month, value: delta, to: store.month) ?? store.month
        Task { await store.load(quiet: true) }
    }

    // MARK: Do akceptacji
    private func review(_ home: SocialHome) -> some View {
        ScrollView {
            if store.reviewPosts.isEmpty {
                Text("Żaden post nie czeka na akceptację ani poprawę i nie ma błędów publikacji.").foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(40)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: 12)], alignment: .leading, spacing: 12) {
                ForEach(store.reviewPosts) { post in
                    Button { store.openPost(post.id) } label: {
                        HStack(alignment: .top, spacing: 12) {
                            SocialImageView(url: post.thumbnailUrl).frame(width: 96, height: 120).clipShape(RoundedRectangle(cornerRadius: 8))
                            VStack(alignment: .leading, spacing: 5) {
                                SocialStatusBadge(status: post.status)
                                Text(post.displayTitle).font(.headline).lineLimit(1)
                                Text(post.channels.map(\.label).joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                Text(post.captionPreview.isEmpty ? "Bez opisu" : post.captionPreview).font(.caption).lineLimit(2)
                                if post.status == .failed, let error = post.publishError { Text(error).font(.caption).foregroundStyle(.red).lineLimit(2) }
                                Text([post.authorName.map { "Autor: \($0)" }, post.scheduledAt.map { SocialDates.dateTime($0) }].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .background(RoundedRectangle(cornerRadius: 12).fill(theme.card))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

struct SocialStatusBadge: View {
    let status: SocialPostStatus
    var body: some View {
        Text(status.label).font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(Capsule().fill(status.color.opacity(0.15)))
            .overlay(Capsule().stroke(status.color.opacity(0.4), lineWidth: 1))
            .foregroundStyle(status.color)
    }
}

struct SocialConsentBadge: View {
    let consent: SocialConsentState
    var compact = false
    var body: some View {
        let color: Color = consent.allows ? .green : consent.status == "denied" ? .red : .orange
        let title: String = compact ? (consent.allows ? "Zgoda ✓" : consent.status == "denied" ? "Brak zgody" : "Zgoda ?") : "Zgoda: \(consent.label)"
        return Text(title).font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 1)
            .background(Capsule().fill(color.opacity(0.15)))
            .foregroundStyle(color)
            .help("Zgoda klienta: \(consent.label) (\(consent.sourceLabel))")
    }
}

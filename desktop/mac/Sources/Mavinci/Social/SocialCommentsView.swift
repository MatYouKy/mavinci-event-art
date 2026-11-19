import SwiftUI

// MARK: Komentarze Facebook i Instagram — 1:1 z `SocialComments` w CRM: skrzynka marki (zakładka „Komentarze”, filtr
// „Bez odpowiedzi” / „Wszystkie”) albo wątki jednego posta w kreatorze. Odpowiedź publikuje serwer jako strona / profil
// marki (twórca treści, uprawnienia Meta do komentarzy). „Odśwież” pobiera komentarze z Meta.

@MainActor struct SocialCommentsView: View {
    @ObservedObject var store: SocialStore
    /// `nil` — skrzynka marki.
    let postID: String?
    @EnvironmentObject private var state: Workspace
    @Environment(\.crmTheme) private var theme
    @State private var replyingTo: String?
    @State private var drafts: [String: String] = [:]

    private var reply: SocialCommentsReply? { store.comments(postID: postID) }
    private var loadKey: String { postID.map { "post-\($0)" } ?? "company-\(store.home?.company.id ?? "")-\(store.commentsFilter)" }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if let reply {
                if reply.threads.isEmpty {
                    let empty: String = postID != nil ? "Brak komentarzy pod tym postem."
                        : store.commentsFilter == "unanswered" ? "Wszystkie komentarze mają odpowiedź." : "Brak komentarzy pod opublikowanymi postami."
                    Text(empty).font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(24)
                }
                if postID == nil {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 420), spacing: 12, alignment: .top)], alignment: .leading, spacing: 12) {
                        ForEach(reply.threads) { thread in threadView(thread, reply: reply) }
                    }
                } else {
                    ForEach(reply.threads) { thread in threadView(thread, reply: reply) }
                }
            } else if let error = store.commentsError {
                Text(error).font(.callout).foregroundStyle(.red)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(20)
            }
        }
        .task(id: loadKey) { await store.loadComments(postID: postID) }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Label("Komentarze", systemImage: "bubble.left.and.bubble.right").font(.headline)
            if let reply, reply.unanswered > 0 {
                Text("\(reply.unanswered) bez odpowiedzi").font(.caption2.weight(.bold)).padding(.horizontal, 6).padding(.vertical, 1)
                    .background(Capsule().fill(theme.accent)).foregroundStyle(Color.black.opacity(0.8))
            }
            Spacer()
            if postID == nil {
                Picker("", selection: $store.commentsFilter) {
                    Text("Bez odpowiedzi").tag("unanswered")
                    Text("Wszystkie").tag("all")
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 240)
            }
            Button { Task { await store.refreshComments(postID: postID) } } label: { Label("Odśwież", systemImage: "arrow.clockwise") }
        }
    }

    private func threadView(_ thread: SocialCommentThread, reply: SocialCommentsReply) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if postID == nil, let post = thread.post {
                Button { store.openPost(post.id) } label: {
                    HStack(spacing: 6) {
                        SocialImageView(url: post.thumbnailUrl).frame(width: 24, height: 30).clipShape(RoundedRectangle(cornerRadius: 3))
                        Text(post.title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .buttonStyle(.plain)
            }
            commentLine(thread.root)
            ForEach(thread.replies) { item in
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "arrow.turn.down.right").font(.caption).foregroundStyle(.tertiary)
                    commentLine(item)
                }
                .padding(.leading, 12)
            }
            HStack(spacing: 8) {
                if !thread.isOwn && thread.answeredAt == nil {
                    Text("Bez odpowiedzi").font(.caption2).padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Capsule().fill(Color.orange.opacity(0.15))).foregroundStyle(.orange)
                }
                if let link = thread.permalink, let url = URL(string: link) {
                    Link(destination: url) { Label(thread.platform == "facebook" ? "Facebook" : "Instagram", systemImage: "arrow.up.right.square") }.font(.caption)
                }
                Spacer()
                if reply.canReply(to: thread) {
                    if replyingTo != thread.id {
                        Button { replyingTo = thread.id } label: { Label("Odpowiedz", systemImage: "arrowshape.turn.up.left") }
                    }
                } else if reply.canReply {
                    Text("Odpowiedzi wymagają uprawnień Meta do komentarzy (ustawienia marketingu marki).").font(.caption2).foregroundStyle(.secondary)
                }
            }
            if replyingTo == thread.id {
                let placeholder: String = thread.platform == "facebook" ? "Odpowiedź jako strona marki…" : "Odpowiedź jako profil marki…"
                TextField(placeholder, text: Binding(get: { drafts[thread.id] ?? "" }, set: { drafts[thread.id] = String($0.prefix(1000)) }), axis: .vertical)
                    .lineLimit(2...6).textFieldStyle(.roundedBorder)
                HStack {
                    Spacer()
                    Button("Anuluj") { replyingTo = nil }
                    Button {
                        let message = (drafts[thread.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !message.isEmpty else { return }
                        Task {
                            if await store.reply(to: thread, message: message, postID: postID) {
                                drafts[thread.id] = ""
                                replyingTo = nil
                            }
                        }
                    } label: { Label("Opublikuj odpowiedź", systemImage: "paperplane") }
                    .buttonStyle(.borderedProminent)
                    .disabled((drafts[thread.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.primary.opacity(0.05)))
    }

    private func commentLine(_ comment: SocialComment) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 6) {
                Image(systemName: comment.platform == "facebook" ? "f.square" : "camera").font(.caption).foregroundStyle(theme.accent)
                let author: String = comment.isOwn ? "\(comment.authorName) (marka)" : comment.authorName
                Text(author).font(.caption.weight(.semibold)).foregroundStyle(comment.isOwn ? theme.accent : Color.primary)
                Text(SocialDates.dateTime(comment.commentedAt)).font(.caption2).foregroundStyle(.secondary)
                if comment.likeCount > 0 { Label("\(comment.likeCount)", systemImage: "heart").font(.caption2).foregroundStyle(.secondary) }
                if let name = comment.repliedByName { Text("· z CRM: \(name)").font(.caption2).foregroundStyle(.secondary) }
            }
            Text(comment.message.isEmpty ? "—" : comment.message).font(.callout).textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

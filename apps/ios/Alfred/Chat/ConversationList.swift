import SwiftUI

/// List of conversations with search, previews, and swipe actions.
struct ConversationList: View {
    let conversations: [ConversationSummary]
    var onSelect: (ConversationSummary) -> Void
    var onDelete: (ConversationSummary) -> Void

    @State private var searchText = ""
    @Environment(\.dismiss) private var dismiss

    private var filteredConversations: [ConversationSummary] {
        if searchText.isEmpty {
            return conversations
        }
        return conversations.filter { conversation in
            conversation.title.localizedCaseInsensitiveContains(searchText) ||
            conversation.lastMessage.localizedCaseInsensitiveContains(searchText)
        }
    }

    var body: some View {
        NavigationView {
            Group {
                if conversations.isEmpty {
                    emptyState
                } else {
                    conversationsList
                }
            }
            .background(BatcaveTheme.primaryBg)
            .navigationTitle("Conversations")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(BatcaveTheme.accent)
                }
            }
            .searchable(text: $searchText, prompt: "Search conversations")
        }
    }

    // MARK: - Conversations List

    private var conversationsList: some View {
        List {
            ForEach(filteredConversations) { conversation in
                ConversationRow(conversation: conversation)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onSelect(conversation)
                    }
                    .listRowBackground(BatcaveTheme.secondaryBg)
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            onDelete(conversation)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                    .swipeActions(edge: .leading) {
                        Button {
                            // TODO: Implement archive
                        } label: {
                            Label("Archive", systemImage: "archivebox")
                        }
                        .tint(BatcaveTheme.info)
                    }
            }
        }
        .listStyle(PlainListStyle())
        .scrollContentBackground(.hidden)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 48))
                .foregroundColor(BatcaveTheme.textMuted)

            Text("No Conversations")
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textSecondary)

            Text("Start a new conversation with Alfred")
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Conversation Row

struct ConversationRow: View {
    let conversation: ConversationSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(conversation.title)
                    .font(AlfredFont.interMedium(16))
                    .foregroundColor(BatcaveTheme.textPrimary)
                    .lineLimit(1)

                Spacer()

                Text(formattedDate)
                    .font(AlfredFont.caption)
                    .foregroundColor(BatcaveTheme.textMuted)
            }

            Text(conversation.lastMessage)
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
                .lineLimit(2)

            HStack {
                Text("\(conversation.messageCount) messages")
                    .font(AlfredFont.caption)
                    .foregroundColor(BatcaveTheme.textMuted)
            }
        }
        .padding(.vertical, 4)
    }

    private var formattedDate: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: conversation.timestamp, relativeTo: Date())
    }
}

// MARK: - Preview

#if DEBUG
struct ConversationList_Previews: PreviewProvider {
    static var sampleConversations: [ConversationSummary] = [
        ConversationSummary(
            id: "1",
            title: "Swift Sorting",
            lastMessage: "You can use the sorted() method...",
            timestamp: Date().addingTimeInterval(-3600),
            messageCount: 5
        ),
        ConversationSummary(
            id: "2",
            title: "Docker Setup",
            lastMessage: "Here's the Dockerfile configuration...",
            timestamp: Date().addingTimeInterval(-86400),
            messageCount: 12
        ),
    ]

    static var previews: some View {
        ConversationList(
            conversations: sampleConversations,
            onSelect: { _ in },
            onDelete: { _ in }
        )
    }
}
#endif

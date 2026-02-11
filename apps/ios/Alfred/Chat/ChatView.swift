import SwiftUI

/// Full chat interface with message list, streaming display, and input bar.
struct ChatView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ChatViewModel()
    @State private var messageText = ""
    @State private var showConversationList = false

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Connection status banner
                if !appState.isConnected {
                    connectionBanner
                }

                // Messages list
                messagesList

                // Input bar
                MessageInput(
                    text: $messageText,
                    onSend: { text in
                        viewModel.sendMessage(text)
                    },
                    onAttachment: {
                        // TODO: Present camera/file picker
                    }
                )
            }
            .background(BatcaveTheme.primaryBg)
            .navigationTitle("Alfred")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { showConversationList = true }) {
                        Image(systemName: "list.bullet")
                            .foregroundColor(BatcaveTheme.textSecondary)
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.newSession() }) {
                        Image(systemName: "square.and.pencil")
                            .foregroundColor(BatcaveTheme.accent)
                    }
                }
            }
            .sheet(isPresented: $showConversationList) {
                ConversationList(
                    conversations: viewModel.conversations,
                    onSelect: { conversation in
                        viewModel.loadConversation(conversation)
                        showConversationList = false
                    },
                    onDelete: { conversation in
                        viewModel.deleteConversation(conversation)
                    }
                )
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    // MARK: - Messages List

    private var messagesList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 4) {
                    // Pull to load more
                    if viewModel.hasMoreHistory {
                        ProgressView()
                            .tint(BatcaveTheme.accent)
                            .padding()
                            .onAppear {
                                viewModel.loadMoreHistory()
                            }
                    }

                    ForEach(viewModel.messages) { message in
                        MessageBubble(message: message)
                            .id(message.id)
                    }
                }
                .padding(.vertical, 8)
            }
            .onChange(of: viewModel.messages.count) { _ in
                // Auto-scroll to bottom on new messages
                if let lastMessage = viewModel.messages.last {
                    withAnimation(.easeOut(duration: 0.3)) {
                        proxy.scrollTo(lastMessage.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    // MARK: - Connection Banner

    private var connectionBanner: some View {
        HStack {
            Image(systemName: "wifi.slash")
                .font(.system(size: 14))
            Text("Not connected to Gateway")
                .font(AlfredFont.caption)
            Spacer()
            Button("Connect") {
                appState.connect()
            }
            .font(AlfredFont.caption)
            .foregroundColor(BatcaveTheme.accent)
        }
        .foregroundColor(BatcaveTheme.warning)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(BatcaveTheme.warning.opacity(0.1))
    }
}

// MARK: - Chat View Model

@MainActor
final class ChatViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var conversations: [ConversationSummary] = []
    @Published var isLoading = false
    @Published var hasMoreHistory = false

    private let gatewayClient = GatewayClient.shared
    private let logger = AlfredLogger.chat

    private var currentSessionId: String = UUID().uuidString
    private var messageListenerTask: Task<Void, Never>?

    init() {
        startListening()
        loadConversations()
    }

    deinit {
        messageListenerTask?.cancel()
    }

    // MARK: - Send Message

    func sendMessage(_ text: String) {
        let userMessage = ChatMessage(
            role: .user,
            content: text,
            sessionId: currentSessionId,
            privacyLevel: .local
        )
        messages.append(userMessage)

        // Create placeholder for assistant response
        let assistantMessage = ChatMessage(
            id: UUID().uuidString,
            role: .assistant,
            content: "",
            sessionId: currentSessionId,
            isStreaming: true,
            privacyLevel: .unknown
        )
        messages.append(assistantMessage)

        // Send to Gateway
        Task {
            do {
                try await gatewayClient.sendChat(text, sessionId: currentSessionId)
                logger.info("Message sent: \(text.prefix(50))")
            } catch {
                logger.error("Failed to send message: \(error.localizedDescription)")
                // Update last message with error
                if let lastIndex = messages.indices.last {
                    messages[lastIndex].content = "Failed to send message. Please check your connection."
                    messages[lastIndex].isStreaming = false
                    messages[lastIndex].privacyLevel = .unknown
                }
            }
        }
    }

    // MARK: - Listen for Server Messages

    private func startListening() {
        messageListenerTask = Task {
            for await serverMessage in gatewayClient.messages {
                handleServerMessage(serverMessage)
            }
        }
    }

    private func handleServerMessage(_ message: ServerMessage) {
        guard let lastIndex = messages.indices.last,
              messages[lastIndex].role == .assistant,
              messages[lastIndex].isStreaming else {
            return
        }

        switch message.type {
        case .text:
            if let text = message.payload?.text {
                messages[lastIndex].content = text
            }

        case .delta:
            if let delta = message.payload?.delta {
                messages[lastIndex].content += delta
            }

        case .done:
            messages[lastIndex].isStreaming = false

        case .error:
            messages[lastIndex].content = message.payload?.error?.message ?? "An error occurred"
            messages[lastIndex].isStreaming = false

        case .thinking:
            // Could show thinking indicator
            break

        case .toolUse:
            // Could show tool use in progress
            break

        default:
            break
        }
    }

    // MARK: - Session Management

    func newSession() {
        currentSessionId = UUID().uuidString
        messages = []
        logger.info("New chat session: \(currentSessionId)")
    }

    func loadConversation(_ conversation: ConversationSummary) {
        currentSessionId = conversation.id
        messages = []
        isLoading = true

        // TODO: Load conversation messages from Gateway
        // Task {
        //     let loaded = try await gatewayClient.loadHistory(sessionId: conversation.id)
        //     messages = loaded
        //     isLoading = false
        // }

        isLoading = false
        logger.info("Loaded conversation: \(conversation.id)")
    }

    func deleteConversation(_ conversation: ConversationSummary) {
        conversations.removeAll { $0.id == conversation.id }

        // TODO: Delete conversation on Gateway
        logger.info("Deleted conversation: \(conversation.id)")
    }

    func loadMoreHistory() {
        // TODO: Implement pagination for message history
        // Load older messages and prepend to array
        hasMoreHistory = false
    }

    private func loadConversations() {
        // TODO: Fetch conversation list from Gateway
        // For now, start with empty list
        conversations = []
    }
}

// MARK: - Conversation Summary

struct ConversationSummary: Identifiable {
    let id: String
    let title: String
    let lastMessage: String
    let timestamp: Date
    let messageCount: Int
}

// MARK: - Preview

#if DEBUG
struct ChatView_Previews: PreviewProvider {
    static var previews: some View {
        ChatView()
            .environmentObject(AppState())
    }
}
#endif

import SwiftUI

/// Individual message bubble for chat display.
/// Supports user and assistant styling, markdown, code blocks, and privacy badges.
struct MessageBubble: View {
    let message: ChatMessage

    @State private var showTimestamp = false

    var body: some View {
        VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
            // Message content
            HStack(alignment: .bottom, spacing: 8) {
                if message.role == .user { Spacer(minLength: 60) }

                VStack(alignment: .leading, spacing: 8) {
                    // Render content with code blocks
                    ForEach(CodeBlockParser.parse(message.content)) { block in
                        if block.isCode {
                            CodeBlock(code: block.content, language: block.language)
                        } else {
                            markdownText(block.content)
                        }
                    }

                    // Streaming indicator
                    if message.isStreaming {
                        streamingIndicator
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(bubbleBackground)
                .cornerRadius(16, corners: bubbleCorners)

                if message.role != .user { Spacer(minLength: 60) }
            }

            // Bottom row: privacy badge + timestamp
            HStack(spacing: 6) {
                if message.role == .user { Spacer() }

                privacyBadge

                if showTimestamp {
                    Text(formattedTimestamp)
                        .font(AlfredFont.caption)
                        .foregroundColor(BatcaveTheme.textMuted)
                        .transition(.opacity)
                }

                if message.role != .user { Spacer() }
            }
            .padding(.horizontal, 8)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.2)) {
                showTimestamp.toggle()
            }
        }
    }

    // MARK: - Markdown Text

    private func markdownText(_ text: String) -> some View {
        Group {
            if let attributedString = try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
                Text(attributedString)
                    .font(AlfredFont.body)
                    .foregroundColor(message.role == .user ? .white : BatcaveTheme.textPrimary)
                    .textSelection(.enabled)
            } else {
                Text(text)
                    .font(AlfredFont.body)
                    .foregroundColor(message.role == .user ? .white : BatcaveTheme.textPrimary)
                    .textSelection(.enabled)
            }
        }
    }

    // MARK: - Bubble Styling

    private var bubbleBackground: Color {
        switch message.role {
        case .user:
            return BatcaveTheme.accent
        case .assistant:
            return BatcaveTheme.secondaryBg
        case .system:
            return BatcaveTheme.tertiaryBg
        }
    }

    private var bubbleCorners: UIRectCorner {
        switch message.role {
        case .user:
            return [.topLeft, .topRight, .bottomLeft]
        case .assistant, .system:
            return [.topLeft, .topRight, .bottomRight]
        }
    }

    // MARK: - Privacy Badge

    @ViewBuilder
    private var privacyBadge: some View {
        switch message.privacyLevel {
        case .local:
            Label("Local", systemImage: "lock.fill")
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.localOnly)
        case .cloud:
            Label("Cloud", systemImage: "cloud.fill")
                .font(AlfredFont.caption)
                .foregroundColor(BatcaveTheme.cloudCall)
        case .unknown:
            EmptyView()
        }
    }

    // MARK: - Streaming Indicator

    private var streamingIndicator: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(BatcaveTheme.textMuted)
                    .frame(width: 6, height: 6)
                    .opacity(0.5)
                    // TODO: Add staggered animation for typing indicator dots
            }
        }
    }

    // MARK: - Timestamp

    private var formattedTimestamp: String {
        let formatter = DateFormatter()
        let calendar = Calendar.current

        if calendar.isDateInToday(message.timestamp) {
            formatter.dateFormat = "h:mm a"
        } else if calendar.isDateInYesterday(message.timestamp) {
            formatter.dateFormat = "'Yesterday' h:mm a"
        } else {
            formatter.dateFormat = "MMM d, h:mm a"
        }

        return formatter.string(from: message.timestamp)
    }
}

// MARK: - Rounded Corners Helper

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat = .infinity
    var corners: UIRectCorner = .allCorners

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}

// MARK: - Preview

#if DEBUG
struct MessageBubble_Previews: PreviewProvider {
    static var previews: some View {
        ScrollView {
            VStack(spacing: 8) {
                MessageBubble(message: ChatMessage(
                    role: .user,
                    content: "How do I sort an array in Swift?",
                    privacyLevel: .local
                ))

                MessageBubble(message: ChatMessage(
                    role: .assistant,
                    content: "Here's how to sort an array:\n\n```swift\nlet sorted = array.sorted()\n```\n\nYou can also use a custom comparator.",
                    privacyLevel: .local
                ))

                MessageBubble(message: ChatMessage(
                    role: .assistant,
                    content: "Thinking...",
                    isStreaming: true
                ))
            }
        }
        .background(BatcaveTheme.primaryBg)
    }
}
#endif

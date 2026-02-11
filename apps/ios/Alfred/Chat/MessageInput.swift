import SwiftUI
import PhotosUI

/// Message input bar with dynamic height, attachments, and send button.
struct MessageInput: View {
    @Binding var text: String
    var onSend: (String) -> Void
    var onAttachment: (() -> Void)?

    @State private var textEditorHeight: CGFloat = 36
    @State private var showAttachmentOptions = false
    @FocusState private var isFocused: Bool

    @AppStorage("sendOnReturn") private var sendOnReturn: Bool = true

    private let minHeight: CGFloat = 36
    private let maxHeight: CGFloat = 120

    var body: some View {
        VStack(spacing: 0) {
            Divider()
                .background(BatcaveTheme.border)

            HStack(alignment: .bottom, spacing: 8) {
                // Attachment button
                attachmentButton

                // Text input
                textInput

                // Send button
                sendButton
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(BatcaveTheme.secondaryBg)
        }
    }

    // MARK: - Attachment Button

    private var attachmentButton: some View {
        Button(action: {
            showAttachmentOptions = true
        }) {
            Image(systemName: "plus.circle.fill")
                .font(.system(size: 24))
                .foregroundColor(BatcaveTheme.textMuted)
        }
        .confirmationDialog("Add Attachment", isPresented: $showAttachmentOptions) {
            Button("Camera") {
                onAttachment?()
            }
            Button("Photo Library") {
                onAttachment?()
            }
            Button("Files") {
                onAttachment?()
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: - Text Input

    private var textInput: some View {
        ZStack(alignment: .leading) {
            // Placeholder
            if text.isEmpty {
                Text("Message Alfred...")
                    .font(AlfredFont.body)
                    .foregroundColor(BatcaveTheme.textMuted)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }

            // Dynamic height TextEditor
            TextEditor(text: $text)
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textPrimary)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .frame(minHeight: minHeight, maxHeight: maxHeight)
                .fixedSize(horizontal: false, vertical: true)
                .focused($isFocused)
                .onSubmit {
                    if sendOnReturn && !text.isEmpty {
                        submitMessage()
                    }
                }
        }
        .background(BatcaveTheme.tertiaryBg)
        .cornerRadius(20)
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(isFocused ? BatcaveTheme.accent.opacity(0.5) : BatcaveTheme.border, lineWidth: 1)
        )
    }

    // MARK: - Send Button

    private var sendButton: some View {
        Button(action: submitMessage) {
            Image(systemName: "arrow.up.circle.fill")
                .font(.system(size: 30))
                .foregroundColor(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? BatcaveTheme.textMuted
                    : BatcaveTheme.accent)
        }
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    // MARK: - Submit

    private func submitMessage() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        onSend(trimmed)
        text = ""

        // Haptic feedback
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
    }
}

// MARK: - Preview

#if DEBUG
struct MessageInput_Previews: PreviewProvider {
    static var previews: some View {
        VStack {
            Spacer()
            MessageInput(text: .constant(""), onSend: { _ in })
        }
        .background(BatcaveTheme.primaryBg)
    }
}
#endif

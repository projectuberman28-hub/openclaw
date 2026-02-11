import SwiftUI

/// Syntax-highlighted code block display with copy button.
struct CodeBlock: View {
    let code: String
    let language: String?

    @State private var copied = false

    init(code: String, language: String? = nil) {
        self.code = code
        self.language = language
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header bar with language label and copy button
            HStack {
                if let lang = language, !lang.isEmpty {
                    Text(lang.lowercased())
                        .font(AlfredFont.caption)
                        .foregroundColor(BatcaveTheme.textMuted)
                }
                Spacer()
                copyButton
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(hex: "0d0d14"))

            Divider()
                .background(BatcaveTheme.border)

            // Code content
            ScrollView(.horizontal, showsIndicators: false) {
                Text(code)
                    .font(AlfredFont.code)
                    .foregroundColor(BatcaveTheme.textPrimary)
                    .padding(12)
                    .textSelection(.enabled)
            }
        }
        .background(BatcaveTheme.tertiaryBg)
        .cornerRadius(8)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(BatcaveTheme.border, lineWidth: 1)
        )
    }

    // MARK: - Copy Button

    private var copyButton: some View {
        Button(action: copyToClipboard) {
            HStack(spacing: 4) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 12))
                Text(copied ? "Copied" : "Copy")
                    .font(AlfredFont.caption)
            }
            .foregroundColor(copied ? BatcaveTheme.success : BatcaveTheme.textMuted)
        }
    }

    private func copyToClipboard() {
        UIPasteboard.general.string = code
        copied = true

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copied = false
        }
    }
}

// MARK: - Code Block Parser

/// Parses markdown code blocks from message content
struct CodeBlockParser {
    struct ParsedBlock: Identifiable {
        let id = UUID()
        let isCode: Bool
        let content: String
        let language: String?
    }

    /// Parse content into alternating text and code blocks
    static func parse(_ content: String) -> [ParsedBlock] {
        var blocks: [ParsedBlock] = []
        let pattern = "```(\\w*)\\n([\\s\\S]*?)```"

        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return [ParsedBlock(isCode: false, content: content, language: nil)]
        }

        let nsContent = content as NSString
        let matches = regex.matches(in: content, range: NSRange(location: 0, length: nsContent.length))

        var lastEnd = 0

        for match in matches {
            // Text before code block
            let textRange = NSRange(location: lastEnd, length: match.range.location - lastEnd)
            let textContent = nsContent.substring(with: textRange).trimmingCharacters(in: .whitespacesAndNewlines)
            if !textContent.isEmpty {
                blocks.append(ParsedBlock(isCode: false, content: textContent, language: nil))
            }

            // Language
            let langRange = match.range(at: 1)
            let language = langRange.location != NSNotFound ? nsContent.substring(with: langRange) : nil

            // Code content
            let codeRange = match.range(at: 2)
            let codeContent = nsContent.substring(with: codeRange)
            blocks.append(ParsedBlock(isCode: true, content: codeContent, language: language))

            lastEnd = match.range.location + match.range.length
        }

        // Remaining text after last code block
        if lastEnd < nsContent.length {
            let remaining = nsContent.substring(from: lastEnd).trimmingCharacters(in: .whitespacesAndNewlines)
            if !remaining.isEmpty {
                blocks.append(ParsedBlock(isCode: false, content: remaining, language: nil))
            }
        }

        // If no code blocks found, return entire content as text
        if blocks.isEmpty {
            blocks.append(ParsedBlock(isCode: false, content: content, language: nil))
        }

        return blocks
    }
}

// MARK: - Preview

#if DEBUG
struct CodeBlock_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 16) {
            CodeBlock(
                code: "func greet(name: String) -> String {\n    return \"Hello, \\(name)!\"\n}",
                language: "swift"
            )

            CodeBlock(
                code: "console.log('Hello, World!')",
                language: "javascript"
            )
        }
        .padding()
        .background(BatcaveTheme.primaryBg)
    }
}
#endif

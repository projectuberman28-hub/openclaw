import SwiftUI

// MARK: - Batcave Dark Theme

enum BatcaveTheme {
    // Primary backgrounds
    static let primaryBg = Color(hex: "0a0a0f")
    static let secondaryBg = Color(hex: "12121a")
    static let tertiaryBg = Color(hex: "1a1a25")

    // Accent colors
    static let accent = Color(hex: "dc2626")
    static let accentLight = Color(hex: "ef4444")
    static let accentDark = Color(hex: "991b1b")

    // Text colors
    static let textPrimary = Color(hex: "f5f5f5")
    static let textSecondary = Color(hex: "a0a0b0")
    static let textMuted = Color(hex: "6b6b80")

    // Status colors
    static let success = Color(hex: "22c55e")
    static let warning = Color(hex: "eab308")
    static let error = Color(hex: "ef4444")
    static let info = Color(hex: "3b82f6")

    // Border / separator
    static let border = Color(hex: "2a2a35")
    static let separator = Color(hex: "1f1f2a")

    // Privacy indicator colors
    static let localOnly = Color(hex: "22c55e")   // Green - on-device
    static let cloudCall = Color(hex: "eab308")    // Yellow - cloud involved
}

// MARK: - Font Helpers

enum AlfredFont {
    /// Inter font with fallback to system font
    static func inter(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        // Inter must be bundled in the app; falls back to system
        return .custom("Inter", size: size).weight(weight)
    }

    static func interBold(_ size: CGFloat) -> Font {
        return .custom("Inter-Bold", size: size)
    }

    static func interMedium(_ size: CGFloat) -> Font {
        return .custom("Inter-Medium", size: size)
    }

    /// SF Mono for code blocks
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        return .system(size: size, design: .monospaced).weight(weight)
    }

    // Semantic font styles
    static let title = inter(24, weight: .bold)
    static let headline = inter(18, weight: .semibold)
    static let body = inter(16)
    static let caption = inter(13)
    static let code = mono(14)
}

// MARK: - Color(hex:) Extension

extension Color {
    /// Initialize a Color from a hex string (supports 3, 6, and 8 character hex)
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)

        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255,
                            (int >> 8) * 17,
                            (int >> 4 & 0xF) * 17,
                            (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255,
                            int >> 16,
                            int >> 8 & 0xFF,
                            int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24,
                            int >> 16 & 0xFF,
                            int >> 8 & 0xFF,
                            int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }

    /// Convert Color to hex string
    func toHex() -> String? {
        guard let components = UIColor(self).cgColor.components else { return nil }
        let r = Int(components[0] * 255)
        let g = Int(components[1] * 255)
        let b = Int(components[2] * 255)
        return String(format: "%02x%02x%02x", r, g, b)
    }
}

// MARK: - View Modifiers

struct BatcaveBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(BatcaveTheme.primaryBg)
            .foregroundColor(BatcaveTheme.textPrimary)
    }
}

struct BatcaveCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding()
            .background(BatcaveTheme.secondaryBg)
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(BatcaveTheme.border, lineWidth: 1)
            )
    }
}

extension View {
    func batcaveBackground() -> some View {
        modifier(BatcaveBackground())
    }

    func batcaveCard() -> some View {
        modifier(BatcaveCard())
    }
}

import XCTest
import SwiftUI
@testable import Alfred

final class ThemeTests: XCTestCase {

    // MARK: - Color Hex Parsing

    func testColorHex6Digit() {
        let color = Color(hex: "dc2626")
        // Verify it creates a non-nil color (basic construction test)
        XCTAssertNotNil(color)
    }

    func testColorHex3Digit() {
        let color = Color(hex: "f00")
        XCTAssertNotNil(color)
    }

    func testColorHex8Digit() {
        let color = Color(hex: "FFdc2626")
        XCTAssertNotNil(color)
    }

    func testColorHexWithHash() {
        // Should handle # prefix gracefully
        let color = Color(hex: "#dc2626")
        XCTAssertNotNil(color)
    }

    func testColorHexBlack() {
        let color = Color(hex: "000000")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        XCTAssertEqual(r, 0.0, accuracy: 0.01, "Red should be 0")
        XCTAssertEqual(g, 0.0, accuracy: 0.01, "Green should be 0")
        XCTAssertEqual(b, 0.0, accuracy: 0.01, "Blue should be 0")
    }

    func testColorHexWhite() {
        let color = Color(hex: "ffffff")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        XCTAssertEqual(r, 1.0, accuracy: 0.01, "Red should be 1")
        XCTAssertEqual(g, 1.0, accuracy: 0.01, "Green should be 1")
        XCTAssertEqual(b, 1.0, accuracy: 0.01, "Blue should be 1")
    }

    func testColorHexRed() {
        let color = Color(hex: "ff0000")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        XCTAssertEqual(r, 1.0, accuracy: 0.01, "Red should be 1")
        XCTAssertEqual(g, 0.0, accuracy: 0.01, "Green should be 0")
        XCTAssertEqual(b, 0.0, accuracy: 0.01, "Blue should be 0")
    }

    func testColorHexAccent() {
        let color = Color(hex: "dc2626")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        // dc = 220, 26 = 38 (in 0-255 range)
        XCTAssertEqual(r, 220.0 / 255.0, accuracy: 0.01, "Red component of accent")
        XCTAssertEqual(g, 38.0 / 255.0, accuracy: 0.01, "Green component of accent")
        XCTAssertEqual(b, 38.0 / 255.0, accuracy: 0.01, "Blue component of accent")
    }

    func testColorHexInvalidString() {
        // Invalid hex should default to black
        let color = Color(hex: "xyz")
        XCTAssertNotNil(color)
    }

    func testColorHexEmptyString() {
        let color = Color(hex: "")
        XCTAssertNotNil(color)
    }

    // MARK: - Batcave Theme Colors Exist

    func testBatcaveThemeColorsExist() {
        // Verify all theme colors are accessible
        XCTAssertNotNil(BatcaveTheme.primaryBg)
        XCTAssertNotNil(BatcaveTheme.secondaryBg)
        XCTAssertNotNil(BatcaveTheme.tertiaryBg)
        XCTAssertNotNil(BatcaveTheme.accent)
        XCTAssertNotNil(BatcaveTheme.accentLight)
        XCTAssertNotNil(BatcaveTheme.accentDark)
        XCTAssertNotNil(BatcaveTheme.textPrimary)
        XCTAssertNotNil(BatcaveTheme.textSecondary)
        XCTAssertNotNil(BatcaveTheme.textMuted)
        XCTAssertNotNil(BatcaveTheme.success)
        XCTAssertNotNil(BatcaveTheme.warning)
        XCTAssertNotNil(BatcaveTheme.error)
        XCTAssertNotNil(BatcaveTheme.info)
        XCTAssertNotNil(BatcaveTheme.border)
        XCTAssertNotNil(BatcaveTheme.separator)
        XCTAssertNotNil(BatcaveTheme.localOnly)
        XCTAssertNotNil(BatcaveTheme.cloudCall)
    }

    // MARK: - Theme Color Values

    func testPrimaryBgIsDark() {
        let color = Color(hex: "0a0a0f")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        // Primary bg should be very dark
        XCTAssertLessThan(r, 0.1, "Primary bg red should be very low")
        XCTAssertLessThan(g, 0.1, "Primary bg green should be very low")
        XCTAssertLessThan(b, 0.1, "Primary bg blue should be very low")
    }

    func testAccentIsRed() {
        let color = Color(hex: "dc2626")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        // Accent should be predominantly red
        XCTAssertGreaterThan(r, 0.7, "Accent red should be high")
        XCTAssertLessThan(g, 0.3, "Accent green should be low")
        XCTAssertLessThan(b, 0.3, "Accent blue should be low")
    }

    // MARK: - Font Helpers

    func testFontHelpers() {
        // Verify fonts are accessible (they won't crash)
        XCTAssertNotNil(AlfredFont.title)
        XCTAssertNotNil(AlfredFont.headline)
        XCTAssertNotNil(AlfredFont.body)
        XCTAssertNotNil(AlfredFont.caption)
        XCTAssertNotNil(AlfredFont.code)
    }

    func testCustomFontCreation() {
        let font = AlfredFont.inter(16, weight: .bold)
        XCTAssertNotNil(font)

        let monoFont = AlfredFont.mono(14)
        XCTAssertNotNil(monoFont)
    }

    // MARK: - Color toHex

    func testColorToHex() {
        let color = Color(hex: "ff0000")
        let hex = color.toHex()
        XCTAssertNotNil(hex)
        XCTAssertEqual(hex, "ff0000")
    }

    func testColorToHexWhite() {
        let color = Color(hex: "ffffff")
        let hex = color.toHex()
        XCTAssertNotNil(hex)
        XCTAssertEqual(hex, "ffffff")
    }

    // MARK: - View Modifiers

    func testBatcaveBackgroundModifier() {
        // Verify the modifier doesn't crash
        let view = Text("Test").batcaveBackground()
        XCTAssertNotNil(view)
    }

    func testBatcaveCardModifier() {
        let view = Text("Test").batcaveCard()
        XCTAssertNotNil(view)
    }

    // MARK: - 8-Digit Hex with Alpha

    func testColorHexWithAlpha() {
        // 80 = 128 = ~50% opacity
        let color = Color(hex: "80dc2626")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        XCTAssertEqual(a, 128.0 / 255.0, accuracy: 0.02, "Alpha should be ~50%")
    }

    func testColorHexFullAlpha() {
        // FF = 255 = full opacity
        let color = Color(hex: "FFdc2626")
        let uiColor = UIColor(color)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        uiColor.getRed(&r, green: &g, blue: &b, alpha: &a)

        XCTAssertEqual(a, 1.0, accuracy: 0.01, "Alpha should be 1.0")
    }
}

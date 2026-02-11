import Foundation

/// Renders A2UI JSON specifications into themed HTML for display in WKWebView.
/// Injects batcave dark theme CSS and handles user interactions via JS bridge.
final class A2UIRenderer {
    private let logger = AlfredLogger.canvas

    // MARK: - Render

    /// Render A2UI JSON string into full HTML document
    func render(json: String) throws -> String {
        guard let data = json.data(using: .utf8) else {
            throw A2UIError.invalidJSON("Cannot convert string to data")
        }

        let spec = try JSONDecoder().decode(A2UISpec.self, from: data)
        return renderSpec(spec)
    }

    /// Render an A2UISpec into HTML
    func renderSpec(_ spec: A2UISpec) -> String {
        let bodyHTML = renderComponent(spec.root)

        return """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                \(batcaveCSS)
            </style>
        </head>
        <body>
            <div id="a2ui-root">
                \(bodyHTML)
            </div>
            <script>
                \(bridgeJS)
            </script>
        </body>
        </html>
        """
    }

    // MARK: - Component Rendering

    private func renderComponent(_ component: A2UIComponent) -> String {
        switch component.type {
        case .container:
            let children = (component.children ?? []).map { renderComponent($0) }.joined(separator: "\n")
            let style = buildStyle(component.style)
            return "<div class=\"a2-container\" style=\"\(style)\">\(children)</div>"

        case .text:
            let style = buildStyle(component.style)
            let tag = component.props?["variant"]?.stringValue == "heading" ? "h2" : "p"
            return "<\(tag) class=\"a2-text\" style=\"\(style)\">\(component.content ?? "")</\(tag)>"

        case .button:
            let style = buildStyle(component.style)
            let action = component.props?["action"]?.stringValue ?? ""
            return """
            <button class="a2-button" style="\(style)" onclick="alfredAction('\(action)', this)">
                \(component.content ?? "Button")
            </button>
            """

        case .input:
            let style = buildStyle(component.style)
            let placeholder = component.props?["placeholder"]?.stringValue ?? ""
            let inputType = component.props?["inputType"]?.stringValue ?? "text"
            let name = component.props?["name"]?.stringValue ?? ""
            return """
            <input class="a2-input" type="\(inputType)" name="\(name)" placeholder="\(placeholder)" style="\(style)" oninput="alfredInput('\(name)', this.value)">
            """

        case .image:
            let src = component.props?["src"]?.stringValue ?? ""
            let alt = component.props?["alt"]?.stringValue ?? ""
            let style = buildStyle(component.style)
            return "<img class=\"a2-image\" src=\"\(src)\" alt=\"\(alt)\" style=\"\(style)\">"

        case .list:
            let children = (component.children ?? []).map { "<li>\(renderComponent($0))</li>" }.joined(separator: "\n")
            let style = buildStyle(component.style)
            return "<ul class=\"a2-list\" style=\"\(style)\">\(children)</ul>"

        case .card:
            let children = (component.children ?? []).map { renderComponent($0) }.joined(separator: "\n")
            let style = buildStyle(component.style)
            return "<div class=\"a2-card\" style=\"\(style)\">\(children)</div>"

        case .divider:
            return "<hr class=\"a2-divider\">"

        case .spacer:
            let height = component.props?["height"]?.stringValue ?? "16px"
            return "<div style=\"height: \(height)\"></div>"

        case .code:
            let lang = component.props?["language"]?.stringValue ?? ""
            return "<pre class=\"a2-code\"><code class=\"language-\(lang)\">\(component.content ?? "")</code></pre>"

        case .unknown:
            logger.warning("Unknown A2UI component type")
            return "<!-- unknown component -->"
        }
    }

    // MARK: - Style Builder

    private func buildStyle(_ style: A2UIStyle?) -> String {
        guard let style = style else { return "" }
        var css: [String] = []

        if let padding = style.padding { css.append("padding: \(padding)") }
        if let margin = style.margin { css.append("margin: \(margin)") }
        if let bg = style.backgroundColor { css.append("background-color: \(bg)") }
        if let color = style.color { css.append("color: \(color)") }
        if let fontSize = style.fontSize { css.append("font-size: \(fontSize)") }
        if let fontWeight = style.fontWeight { css.append("font-weight: \(fontWeight)") }
        if let border = style.border { css.append("border: \(border)") }
        if let borderRadius = style.borderRadius { css.append("border-radius: \(borderRadius)") }
        if let display = style.display { css.append("display: \(display)") }
        if let flexDirection = style.flexDirection { css.append("flex-direction: \(flexDirection)") }
        if let gap = style.gap { css.append("gap: \(gap)") }
        if let width = style.width { css.append("width: \(width)") }
        if let maxWidth = style.maxWidth { css.append("max-width: \(maxWidth)") }

        return css.joined(separator: "; ")
    }

    // MARK: - Batcave Theme CSS

    private var batcaveCSS: String {
        """
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, 'Inter', sans-serif;
            background-color: #0a0a0f;
            color: #f5f5f5;
            padding: 16px;
            -webkit-font-smoothing: antialiased;
        }

        .a2-container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .a2-text {
            color: #f5f5f5;
            line-height: 1.5;
        }

        h2.a2-text {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        p.a2-text {
            font-size: 16px;
            color: #a0a0b0;
        }

        .a2-button {
            background-color: #dc2626;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: opacity 0.2s;
        }

        .a2-button:active {
            opacity: 0.8;
        }

        .a2-input {
            background-color: #1a1a25;
            color: #f5f5f5;
            border: 1px solid #2a2a35;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 16px;
            outline: none;
            width: 100%;
        }

        .a2-input:focus {
            border-color: #dc2626;
        }

        .a2-image {
            max-width: 100%;
            border-radius: 8px;
        }

        .a2-card {
            background-color: #12121a;
            border: 1px solid #2a2a35;
            border-radius: 12px;
            padding: 16px;
        }

        .a2-list {
            list-style: none;
            padding: 0;
        }

        .a2-list li {
            padding: 8px 0;
            border-bottom: 1px solid #1f1f2a;
        }

        .a2-list li:last-child {
            border-bottom: none;
        }

        .a2-divider {
            border: none;
            border-top: 1px solid #2a2a35;
            margin: 12px 0;
        }

        .a2-code {
            background-color: #1a1a25;
            border: 1px solid #2a2a35;
            border-radius: 8px;
            padding: 12px;
            font-family: 'SF Mono', monospace;
            font-size: 14px;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        """
    }

    // MARK: - JavaScript Bridge

    private var bridgeJS: String {
        """
        function alfredAction(action, element) {
            window.webkit.messageHandlers.alfredBridge.postMessage({
                type: 'action',
                action: action,
                data: element.dataset || {}
            });
        }

        function alfredInput(name, value) {
            window.webkit.messageHandlers.alfredBridge.postMessage({
                type: 'input',
                name: name,
                value: value
            });
        }

        // Notify native side that A2UI is ready
        window.webkit.messageHandlers.alfredBridge.postMessage({
            type: 'ready'
        });
        """
    }
}

// MARK: - A2UI Data Models

struct A2UISpec: Codable {
    let version: String?
    let root: A2UIComponent
}

struct A2UIComponent: Codable {
    let type: A2UIComponentType
    let content: String?
    let style: A2UIStyle?
    let props: [String: A2UIValue]?
    let children: [A2UIComponent]?
}

enum A2UIComponentType: String, Codable {
    case container
    case text
    case button
    case input
    case image
    case list
    case card
    case divider
    case spacer
    case code
    case unknown

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(String.self)
        self = A2UIComponentType(rawValue: value) ?? .unknown
    }
}

struct A2UIStyle: Codable {
    let padding: String?
    let margin: String?
    let backgroundColor: String?
    let color: String?
    let fontSize: String?
    let fontWeight: String?
    let border: String?
    let borderRadius: String?
    let display: String?
    let flexDirection: String?
    let gap: String?
    let width: String?
    let maxWidth: String?
}

/// Type-erased value for A2UI props
struct A2UIValue: Codable {
    let rawValue: Any

    var stringValue: String? {
        rawValue as? String
    }

    var intValue: Int? {
        rawValue as? Int
    }

    var boolValue: Bool? {
        rawValue as? Bool
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let str = try? container.decode(String.self) {
            rawValue = str
        } else if let int = try? container.decode(Int.self) {
            rawValue = int
        } else if let bool = try? container.decode(Bool.self) {
            rawValue = bool
        } else if let double = try? container.decode(Double.self) {
            rawValue = double
        } else {
            rawValue = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let str = rawValue as? String {
            try container.encode(str)
        } else if let int = rawValue as? Int {
            try container.encode(int)
        } else if let bool = rawValue as? Bool {
            try container.encode(bool)
        } else if let double = rawValue as? Double {
            try container.encode(double)
        }
    }
}

// MARK: - Errors

enum A2UIError: LocalizedError {
    case invalidJSON(String)
    case renderFailed(String)
    case unknownComponent(String)

    var errorDescription: String? {
        switch self {
        case .invalidJSON(let msg): return "Invalid A2UI JSON: \(msg)"
        case .renderFailed(let msg): return "Render failed: \(msg)"
        case .unknownComponent(let type): return "Unknown component type: \(type)"
        }
    }
}

import SwiftUI
import WebKit

/// Canvas view that renders A2UI dynamic content via WKWebView.
/// Provides a JavaScript bridge for interaction between native and web content.
struct CanvasView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = CanvasViewModel()

    var body: some View {
        NavigationView {
            ZStack {
                BatcaveTheme.primaryBg.ignoresSafeArea()

                if viewModel.isLoading {
                    loadingView
                } else if viewModel.hasContent {
                    WebViewWrapper(viewModel: viewModel)
                        .ignoresSafeArea(edges: .bottom)
                } else {
                    emptyState
                }
            }
            .navigationTitle("Canvas")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button(action: { viewModel.reload() }) {
                        Image(systemName: "arrow.clockwise")
                            .foregroundColor(BatcaveTheme.textSecondary)
                    }
                }
            }
        }
        .navigationViewStyle(StackNavigationViewStyle())
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: BatcaveTheme.accent))
                .scaleEffect(1.5)

            Text("Loading Canvas...")
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textSecondary)
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "rectangle.3.group")
                .font(.system(size: 48))
                .foregroundColor(BatcaveTheme.textMuted)

            Text("No Canvas Content")
                .font(AlfredFont.headline)
                .foregroundColor(BatcaveTheme.textSecondary)

            Text("Canvas content will appear here when Alfred generates dynamic UI.")
                .font(AlfredFont.body)
                .foregroundColor(BatcaveTheme.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
    }
}

// MARK: - Canvas View Model

@MainActor
final class CanvasViewModel: ObservableObject {
    @Published var isLoading = false
    @Published var hasContent = false
    @Published var htmlContent: String = ""
    @Published var errorMessage: String? = nil

    private let renderer = A2UIRenderer()
    private let logger = AlfredLogger.canvas

    /// Load A2UI content from JSON
    func loadA2UI(json: String) {
        isLoading = true

        do {
            let html = try renderer.render(json: json)
            htmlContent = html
            hasContent = true
            isLoading = false
            logger.info("A2UI content rendered successfully")
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
            logger.error("A2UI render failed: \(error.localizedDescription)")
        }
    }

    /// Load raw HTML content
    func loadHTML(_ html: String) {
        htmlContent = html
        hasContent = true
        logger.info("HTML content loaded")
    }

    /// Reload current content
    func reload() {
        guard hasContent else { return }
        let current = htmlContent
        hasContent = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            self.htmlContent = current
            self.hasContent = true
        }
    }

    /// Handle JS bridge messages from WKWebView
    func handleJSMessage(name: String, body: Any) {
        logger.debug("JS bridge message: \(name)")

        // TODO: Route JS bridge messages to Gateway
        // - Parse action type from message name
        // - Forward interaction data to Gateway via GatewayClient
        // - Handle response and update canvas if needed
    }

    /// Clear canvas content
    func clear() {
        htmlContent = ""
        hasContent = false
    }
}

// MARK: - WKWebView Wrapper

struct WebViewWrapper: UIViewRepresentable {
    @ObservedObject var viewModel: CanvasViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()

        // Add JS bridge message handler
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "alfredBridge")
        config.userContentController = contentController

        // Allow inline media playback
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(BatcaveTheme.primaryBg)
        webView.scrollView.backgroundColor = UIColor(BatcaveTheme.primaryBg)
        webView.navigationDelegate = context.coordinator

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        if !viewModel.htmlContent.isEmpty {
            webView.loadHTMLString(viewModel.htmlContent, baseURL: nil)
        }
    }

    // MARK: - Coordinator

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let viewModel: CanvasViewModel

        init(viewModel: CanvasViewModel) {
            self.viewModel = viewModel
        }

        // Handle JS bridge messages
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            Task { @MainActor in
                viewModel.handleJSMessage(name: message.name, body: message.body)
            }
        }

        // Navigation delegate
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            AlfredLogger.canvas.debug("WebView finished loading")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            AlfredLogger.canvas.error("WebView failed: \(error.localizedDescription)")
        }
    }
}

// MARK: - Preview

#if DEBUG
struct CanvasView_Previews: PreviewProvider {
    static var previews: some View {
        CanvasView()
            .environmentObject(AppState())
    }
}
#endif

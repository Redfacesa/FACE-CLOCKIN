import SwiftUI
import WebKit

struct StationView: View {
    var body: some View {
        WebShell(url: URL(string: "https://tryclockin.redfacesa.workers.dev")!)
            .ignoresSafeArea()
    }
}

struct WebShell: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

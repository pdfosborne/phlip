import SwiftUI

@main
struct PhlipApp: App {
    var body: some Scene {
        WindowGroup {
            PhlipWebView()
                .ignoresSafeArea()
        }
    }
}

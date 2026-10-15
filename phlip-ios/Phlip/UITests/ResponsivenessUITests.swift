import XCTest

final class ResponsivenessUITests: XCTestCase {
    /// Run on the designated iPhone 12. Simulator timings are only smoke data.
    func testColdLaunchToAgenda() {
        measure(metrics: [XCTApplicationLaunchMetric()]) {
            let app = XCUIApplication()
            app.launch()
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        }
    }
}

// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Demo",
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.29.0"),
    ],
    targets: [.target(name: "Demo")]
)

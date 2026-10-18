// swift-tools-version:5.9
import PackageDescription

// .package(url: "https://github.com/commented/out.git", from: "9.9.9"),
let package = Package(
    name: "Demo",
    dependencies: [
        .package(url: "https://github.com/apple/swift-nio.git", from: "2.29.0"),
        /* .package(url: "https://github.com/block/comment.git", from: "9.9.9"), */
        .package(
            url: "https://github.com/vapor/vapor.git",
            .upToNextMajor(from: "4.0.0")
        ),
        .package(url: "https://github.com/a/b.git", branch: "main"),
    ],
    targets: [.target(name: "Demo")]
)

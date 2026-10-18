// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "Forms",
    dependencies: [
        .package(url: "https://github.com/x/exact.git", exact: "1.2.3"),
        .package(url: "https://github.com/x/exactfn.git", .exact("1.2.4")),
        .package(url: "ssh://git@github.com/x/minor.git", .upToNextMinor(from: "1.3.0")),
        .package(url: "https://github.com/x/half.git", "1.0.0"..<"2.0.0"),
        .package(url: "https://github.com/x/closed.git", "1.0.0"..."2.0.0"),
        .package(url: "https://github.com/x/rev.git", revision: "abc123"),
        .package(url: "https://github.com/x/branchfn.git", .branch("dev")),
        .package(path: "../local"),
        .package(id: "scope.name", from: "1.0.0"),
        .package(url: "https://github.com/x/bare.git"),
    ]
)

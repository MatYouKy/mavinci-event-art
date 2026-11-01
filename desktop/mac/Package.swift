// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Mavinci",
    defaultLocalization: "pl",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "Mavinci", targets: ["Mavinci"])],
    targets: [.executableTarget(name: "Mavinci", path: "Sources/Mavinci")]
)

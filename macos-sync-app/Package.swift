// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MavinciReminders",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "MavinciReminders",
            path: "MavinciReminders/Sources",
            resources: [
                .copy("../Resources/Info.plist")
            ]
        )
    ]
)

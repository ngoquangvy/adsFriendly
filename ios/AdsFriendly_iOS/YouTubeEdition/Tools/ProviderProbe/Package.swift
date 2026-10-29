// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ProviderProbe",
    platforms: [.macOS(.v13)],
    dependencies: [.package(url: "https://github.com/alexeichhorn/YouTubeKit.git",
        revision: "89854c93207ad0d2b3d78d6f1aea24595ca66552")],
    targets: [.executableTarget(name: "ProviderProbe", dependencies: ["YouTubeKit"])]
)

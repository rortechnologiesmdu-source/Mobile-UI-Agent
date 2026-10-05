// Apps the agent may open on the iOS simulator. XCUITest can't list installed apps,
// so this is the simulator's built-in set (verified with `xcrun simctl listapps
// booted`). Sent to the backend as the run's "apps", so MAI-UI's "open <name>"
// resolves to one of these bundle IDs.
enum KnownApps {
    static let springboard = "com.apple.springboard"
    // Home-screen search; a separate process from SpringBoard.
    static let spotlight = "com.apple.Spotlight"

    static let all: [InstalledApp] = [
        InstalledApp(label: "Settings", package: "com.apple.Preferences"),
        InstalledApp(label: "Safari", package: "com.apple.mobilesafari"),
        InstalledApp(label: "Maps", package: "com.apple.Maps"),
        InstalledApp(label: "Contacts", package: "com.apple.MobileAddressBook"),
        InstalledApp(label: "Messages", package: "com.apple.MobileSMS"),
        InstalledApp(label: "Calendar", package: "com.apple.mobilecal"),
        InstalledApp(label: "Photos", package: "com.apple.mobileslideshow"),
        InstalledApp(label: "Files", package: "com.apple.DocumentsApp"),
        InstalledApp(label: "Reminders", package: "com.apple.reminders"),
        InstalledApp(label: "Health", package: "com.apple.Health"),
        InstalledApp(label: "News", package: "com.apple.news"),
        InstalledApp(label: "Shortcuts", package: "com.apple.shortcuts"),
        InstalledApp(label: "Wallet", package: "com.apple.Passbook"),
        InstalledApp(label: "Fitness", package: "com.apple.Fitness"),
        InstalledApp(label: "Passwords", package: "com.apple.Passwords"),
        InstalledApp(label: "Watch", package: "com.apple.Bridge"),
    ]
}

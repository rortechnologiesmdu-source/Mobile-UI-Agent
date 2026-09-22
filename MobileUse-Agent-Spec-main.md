# MobileUse — Two-Agent Mobile App Spec (v2)

## 1. Problem

There's no single app on a phone that can:
- Passively understand what's going on across your other apps (spending, messages, activity, files) without you manually opening each one, **and**
- Also take an instruction like "open Chrome and search cats" and actually go do it for you when you ask.

Today these need totally different technical approaches, and most existing tools only do one or the other. This app does both, side by side, and shows you everything in one summary screen.

## 2. Solution — Two Agents, One App

**MobileUse** is a single Android app (React Native + native Kotlin module) containing **two independent agents** that work completely differently under the hood, plus one shared dashboard that shows what both of them found.

```
                    📱 MobileUse App
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
     AGENT 1: Collector           AGENT 2: Operator
     (headless, background)      (on-demand, screen-visible)
            │                           │
     Standard permissions         Accessibility Tree +
     (SMS, Location, Files,       Screenshot + gestures
     Contacts, Activity,
     Notifications)
            │                           │
            └─────────────┬─────────────┘
                          ▼
                  Local Data Store
                          │
                          ▼
                 📊 Summary Dashboard
                  (shown in the app)
```

**Important distinction to design around from day one — these two agents are fundamentally different kinds of software:**

| | Agent 1 — Collector | Agent 2 — Operator |
|---|---|---|
| Runs | Continuously, in the background, on a schedule | Only when the user types a task in the app |
| Needs phone unlocked? | **No** | **Yes, always** — hard Android OS requirement |
| Needs screen visible? | **No** | **Yes, always** — the target app will visibly appear on screen while it's controlled |
| Mechanism | Standard Android permission APIs (content providers, listeners) | AccessibilityService + MediaProjection (screenshot) + gesture dispatch |
| Can it be silent/invisible? | **Yes** — this is genuinely headless | **No** — user will see it happen, by design and by OS restriction |
| Best analogy | A background sync service (like how Gmail syncs new mail) | Someone briefly grabbing your phone and tapping through an app for you |

This split isn't a compromise — it's the correct architecture. Trying to make Agent 2 "headless" runs into real Android security boundaries (covered in section 6). Agent 1 is where all genuinely silent, hourly, background collection belongs.

## 3. Agent 1 — The Collector (headless, background)

### 3.1 What it does
Runs continuously in the background (target: check-in roughly every 1 hour, Android-permitting — see section 6.3 for why "every 1 hour" is a target, not a guarantee). Passively reads data the user has explicitly granted permission for, with **no screen interaction, no unlocking required, no visible activity**.

### 3.2 Data sources (all standard Android permissions/APIs — no Accessibility needed for this agent)

| Source | Android mechanism | What we can get |
|---|---|---|
| **SMS** | `READ_SMS` permission + SMS content provider | Bank alerts, OTP messages (read-only, for context — not auto-submitted anywhere), delivery/order updates |
| **Location** | `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` | Periodic location snapshots |
| **Physical Activity** | `ACTIVITY_RECOGNITION` | Steps, activity type (walking/still/driving) from Android's Activity Recognition API |
| **Files** | Scoped storage / `MediaStore` API (or `MANAGE_EXTERNAL_STORAGE` for broader access — see caveat below) | Documents, downloads, screenshots, images |
| **Contacts** | `READ_CONTACTS` | Contact list for name-matching data from other sources (e.g. matching an SMS sender to a saved contact) |
| **Notifications** | `NotificationListenerService` (special permission, enabled manually in Settings, like Accessibility) | Live feed of notifications from other apps — this is actually one of the richest sources: payment confirmations, order updates, message previews, delivery alerts, all without opening those apps at all |

### 3.3 Important caveat — flag this to the user/team now, don't discover it later
`NotificationListenerService` behaves **exactly like the Accessibility permission problem already seen in the FamilyOS project**: it's a special permission granted once in Settings, and Android's automatic "permission auto-reset for unused apps" can silently revoke it if the app isn't opened for a while — requiring the user to manually re-enable it. Same is true for `MANAGE_EXTERNAL_STORAGE` (all-files access) on newer Android versions. Build a simple **"Health Check" screen** in the app from day one that checks all granted permissions on launch and clearly flags any that got silently revoked, prompting the user to re-enable — don't wait until data mysteriously stops flowing to discover this.

### 3.4 How it stays running in the background
- Implemented as an Android **Foreground Service** with a persistent low-priority notification ("MobileUse is monitoring your data") — this is the most reliable way to avoid Android killing it, and it's honest/transparent to the user about what's running.
- Use **WorkManager** for the periodic "collect + summarize" job (e.g. every 1 hour), since it's the Android-recommended, battery-optimization-aware way to schedule recurring background work — note Android may still batch/delay this depending on Doze mode and battery optimization settings, so exact hourly timing isn't 100% guaranteed (see 6.3).
- `NotificationListenerService` and SMS content observers can push data in **as it happens** (event-driven), independent of the hourly batch job — so notifications/SMS can actually be closer to real-time, while location/activity/files get checked on the hourly cycle.

### 3.5 Cloud AI's role for this agent
Raw data (SMS text, notification text, etc.) is periodically sent to the cloud LLM (Gemini free tier, consistent with the rest of the project) to:
- Categorize (e.g. "this SMS is a bank debit alert", "this notification is a Swiggy order update")
- Extract structured fields (amount, merchant, date) from unstructured text
- Produce the plain-English summary shown on the dashboard

## 4. Agent 2 — The Operator (on-demand, screen-visible)

This is the agent already fully specified in the earlier MobileUse spec — carried over unchanged, included here for completeness since it lives in the same app.

- Triggered only when the user types a goal into the app's agent UI (e.g. "Open Chrome and search cats")
- Observes via **screenshot (MediaProjection) + Accessibility Tree** combined
- Acts via **AccessibilityService** gesture dispatch (tap/type/swipe) and app-launch intents
- Sends each observation to the cloud LLM (Gemini, vision-capable), gets back a semantic action, resolves it (accessibility-node match first, vision bounding-box fallback second), executes it, loops until done
- **Always requires phone unlocked and runs visibly in the foreground** — the screen will show Chrome opening and being operated. This is expected behavior, not a bug.
- Same safety rules as before: hard step-count cap per task, full step-by-step logging, no handling of login/PIN/OTP/biometric screens in this version (assumes target apps are already logged in)

*(Full method list, action types, and resolution logic: see the original MobileUse-Agent-Spec.md — Agent 2 should be built exactly as previously specified.)*

## 5. Shared Dashboard

One summary screen in the app pulls from a single local data store that both agents write into.

```
╭─────────────────────────────────╮
│  MobileUse            ⚙️        │
│                                 │
│  📊 Today's Summary              │
│  • 3 bank debit alerts (₹4,250) │
│  • 12,400 steps                 │
│  • 2 Swiggy orders (from        │
│    notifications)               │
│  • 1 new PDF in Downloads       │
│                                 │
│  🤖 Ask the Agent                │
│  ┌─────────────────────────┐   │
│  │ What do you want me to  │   │
│  │ do?                     │   │
│  └─────────────────────────┘   │
│       [ ▶ Run Agent ]           │
│                                 │
│  ⚠️ Notification access was      │
│  turned off — tap to re-enable  │
╰─────────────────────────────────╯
```

- **Summary section** = Agent 1's output (continuously updated, categorized, in plain English)
- **"Ask the Agent" section** = Agent 2's trigger point (types a task, runs on-demand, screen will switch away and back)
- **Permission health banner** = surfaces any silently-revoked permission (see 3.3) so the user always knows Agent 1 is actually working

## 6. Known Android Constraints (build around these, don't fight them)

### 6.1 Agent 2 cannot be headless — ever
Confirmed hard OS boundary: Accessibility-based UI control requires the phone unlocked and the target app in the visible foreground. No legitimate way around this on a normal, non-rooted personal phone. Design the UI to set this expectation clearly (e.g. "Your screen will switch apps while I do this").

### 6.2 Agent 1's special permissions can be silently revoked
`NotificationListenerService`, `MANAGE_EXTERNAL_STORAGE`, and (on some OEM skins) even background location can be auto-disabled by Android/OEM battery-management features if the app sits unused. This is the same category of problem already seen with Accessibility in the FamilyOS project. The Health Check screen (3.3) is the mitigation — there's no way to prevent the revocation itself, only to detect and prompt for it quickly.

### 6.3 "Every 1 hour" is a target, not a guarantee
`WorkManager`'s minimum periodic interval is 15 minutes, and Android's Doze mode / battery optimization can delay execution further, especially on aggressive OEM battery managers (common on Xiaomi/Vivo/Realme/OnePlus phones in particular — worth checking which brand the test phone is, since some are notoriously aggressive about killing background work regardless of what the OS API promises). Build the collection logic to be resilient to "ran late" or "ran in a batch of several hours at once" rather than assuming precise timing.

### 6.4 SMS/Storage permission scrutiny (only matters if ever published)
`READ_SMS` and broad file access (`MANAGE_EXTERNAL_STORAGE`) are heavily restricted on the Google Play Store for public apps (only apps that are the default SMS handler, or meet narrow approved use-cases, can get SMS permission). **Not a blocker for this project** since it's a personal-use app installed directly via APK (sideloaded, not distributed through Play Store) — just flagging it now so it's not a surprise if this ever needs to go public later.

## 7. Tech Stack (same as before, extended)

| Layer | Choice |
|---|---|
| App shell / UI | React Native |
| Native Android capabilities | Kotlin native module — AccessibilityService, MediaProjection, NotificationListenerService, SMS/Contacts content providers, WorkManager, Foreground Service |
| Local data store | SQLite (via a React Native library) or Room (native side) — single local DB both agents write to |
| Cloud AI brain | Gemini API (free tier) — used by both agents: data categorization for Agent 1, screen-understanding + action decisions for Agent 2 |
| Background scheduling | Android WorkManager (periodic work) + Foreground Service (for NotificationListener/live feeds) |

## 8. Build Order (v0.1 — simple testing app)

1. **Agent 1 first, minimal**: get Notifications + SMS reading working, dump raw data into local DB, no AI processing yet — just prove data flows in without any screen interaction.
2. **Add Gemini categorization** to Agent 1's data — turn raw notification/SMS text into the plain-English summary shown on the dashboard.
3. **Build the dashboard screen** showing Agent 1's live summary + the Health Check permission banner.
4. **Build Agent 2** exactly as the original MobileUse spec describes (Chrome search test case, then Amazon-orders read test case).
5. **Wire Agent 2's trigger** into the same dashboard's "Ask the Agent" box.
6. **Test permission-revocation recovery**: manually disable Notification access in Settings mid-testing, confirm the Health Check banner catches it correctly.

If steps 1–4 all work independently, you have a working two-agent MobileUse v0.1 ready for real daily testing on your own phone.

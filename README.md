# Plan Studio (Rust / Tauri)

> **Status: Pre-Alpha** — early version (0.x): it works, but things may still change or break. Version 1.0 will be the first stable one.

School planner of the Studio family — timetable, homework, exams and deadlines. Works offline, no account.
The native shell is Rust ([Tauri 2](https://tauri.app)); the UI is plain HTML/JS in `ui/`, with the same chrome
and controls as the other Studio apps.

## Features (0.1.0)
- **Today**: today's lessons (the running period highlighted), homework due soon or overdue, next exams with a countdown
- **Timetable**: Monday–Friday or –Saturday, periods with start and end times (breaks show as gaps), click a period and
  pick a subject; arrow keys move, Delete clears; room per lesson
- **Homework**: quick entry; the due date is the next lesson of that subject; grouped into overdue, today, tomorrow,
  this week, later; tick off when done
- **Exams & dates**: exam, test, presentation, deadline, other — by month with a countdown
- **Subjects**: name, short name, color, teacher, usual room (common school subjects to start with, German or English)
- Next-7-days panel, undo/redo, print, **calendar export (.ics)** for Outlook / Google / Apple, backup and import (.plan)
- 4 app themes, settings dialog, customizable shortcuts, auto-hide bars, German/English

The plan is saved in the app's data folder (`plan.json`, the previous version as `plan.bak`); a `plan.json` next to the
program is used instead (portable, e.g. on a USB stick).

## Layout
```
ui/                 index.html, app.js; native.js, autohide.js, shortcuts.js (the same in every Studio app)
src-tauri/src/      main.rs — saving, import / export, dialogs, print; ics.rs — the calendar file
src-tauri/i18n/     en.json, de.json — all texts
```

## Build
Install Rust and Node, then `npx @tauri-apps/cli@2 icon app-icon.png` once and `npx @tauri-apps/cli@2 dev`.
Release builds for Windows / macOS / Linux come from GitHub Actions when you push a tag like `v0.1.0`.
The UI also runs in a normal browser (serve the repository root, open `/ui/index.html`); the plan is then kept in the browser.

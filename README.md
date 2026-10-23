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
- Next-7-days panel, undo/redo, print, **calendar export (.ics)** for Outlook / Google / Apple — dates, homework and, if you like, the timetable of the next weeks, backup and import (.plan)
- **Flexible timetables:** terms (half-years, quarters, blocks) with courses that apply only in some of them; elective
  areas whose subjects form a catalog to choose a slot from; shorter days (e.g. only mornings on Saturday); class sessions at
  changing times that show in the timetable and in Today; browse the timetable week by week
- **School year:** holidays and days off, alternating weeks (A/B, with holiday weeks left out of the count), single
  cancelled lessons, own times for a course inside its period, a name for the periods (e.g. "double period")
- **Elective areas:** chosen once or anew every week (each date on its own, "not taking part" too), offers with category,
  week type and the slots they are given in, a deadline and weekly rules ("at least 1 from Languages"); Today reminds you
  of open choices; whole catalogs can be pasted (one line per offer)
- **Grades:** grades per subject in your school's system (1–6 with tendencies, 0–15 points or percent), categories with
  weights (also per subject), grades that count more or less, weighted averages per subject and overall, filter by term,
  "Which grade do I need?" and "Enter grade" right from an exam
- **In your own calendar:** the plan's dates (and, if you like, homework and the timetable of the next weeks) in a
  calendar "Plan Studio" in your iCloud account (CalDAV, also on iPhone / iPad; Apple ID + app-specific password, kept on
  this computer only), and / or as a subscription for calendar apps on this computer (webcal://127.0.0.1…, no account) —
  both kept up to date after every change
- **Linked calendars:** paste the subscription address of a Google, Apple / iCloud or Outlook calendar (https:// or webcal://);
  its events show in Today and in the next 7 days, refresh every 30 minutes and stay available offline (read-only)
- 4 app themes, settings dialog, customizable shortcuts, auto-hide bars, German/English

The plan is saved in the app's data folder (`plan.json`, the previous version as `plan.bak`); a `plan.json` next to the
program is used instead (portable, e.g. on a USB stick).

## Layout
```
ui/                 index.html, app.js; native.js, autohide.js, shortcuts.js (the same in every Studio app)
src-tauri/src/      main.rs — saving, import / export, dialogs, print; ics.rs — the calendar file; ical.rs — reading linked calendars
src-tauri/i18n/     en.json, de.json — all texts
```

## Build
Install Rust and Node, then `npx @tauri-apps/cli@2 icon app-icon.png` once and `npx @tauri-apps/cli@2 dev`.
Release builds for Windows / macOS / Linux come from GitHub Actions when you push a tag like `v0.1.0`.
The UI also runs in a normal browser (serve the repository root, open `/ui/index.html`); the plan is then kept in the browser.

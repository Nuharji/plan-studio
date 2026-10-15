# Changelog

## 0.2.1 — 2026-10-15
- Linked calendars: Apple / iCloud calendars load now (they are sent compressed), and repeating events like "last Sunday
  in October" or "second Sunday in May" land on the right day (BYDAY positions, BYMONTH, BYMONTHDAY).

## 0.2.0 — 2026-10-15
- Link calendars from Google, Apple / iCloud, Outlook and others (Settings → Calendars, or Plan → Linked Calendars…): paste
  the calendar's subscription address (https:// or webcal://). Its events appear in a new "My calendars" card in Today and in
  the next-7-days panel, in the calendar's colour; repeating events, all-day events and time zones are handled.
- Calendars refresh at start, every 30 minutes and with F5; the last state stays available offline. Each calendar can be
  switched off, recoloured or removed. The links are secret, so they stay on this computer and are left out of backups.

## 0.1.1 — 2026-10-15
- App icon with a picture of what the app does, like Slides and Plan Studio; the window and taskbar icon is now the same picture.

## 0.1.0 — 2026-10-15
- First version: Today, Timetable, Homework, Exams & dates, Subjects; next-7-days panel; calendar export (.ics),
  backup / import, print; undo; German and English; the Studio chrome (themes, settings, shortcuts, auto-hide bars).
- Shared with all Studio apps (shared.rs / shared.js): theme and language follow the other apps and Studio Hub (also when you switch windows), and file dialogs open in the work folder chosen in Studio Hub.

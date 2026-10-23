# Changelog

## 0.7.4 — 2026-10-24
- Grades: tendencies can be switched off (Settings → Grades → "No tendencies"); then only whole grades and decimals like
  2.5 count, and "2−" is not taken as a grade.
- Room per weekday: subjects and offers of elective areas can have a different room on each weekday (e.g. Monday 209,
  Friday 106) — used wherever they take place that day, also when chosen anew each week. A room change for a single day
  still comes first.

## 0.7.3 — 2026-10-24
- Week types can follow the holidays instead of a pattern (Settings → School year → Alternating weeks): the school week
  right before and the one right after holidays get their own type (e.g. A), all other weeks another (B). Based on the
  holidays entered there; single weeks can still be changed by hand in the timetable.

## 0.7.2 — 2026-10-23
- Rooms per day: a lesson's room can change for a single day ("Room only on Mon, 26 Oct") — shown highlighted as a room
  change in the timetable and Today, and used in the calendar. The slot's own room is now "Room (every week)", with the
  subject's room as the default; a weekly elective choice shows the room of the chosen offer.
- Class sessions (e.g. workshops at changing times) have a room, shown in the timetable and Today.

## 0.7.1 — 2026-10-23
- Normal timetable slots offer only normal subjects; offers of elective areas appear only in elective slots.
- Blocked slots: Settings → Timetable has a grid of days × periods — click a slot to block it (no lessons there), e.g.
  Saturday afternoon. It replaces "Length of each day"; days shortened before are taken over.
- Courses with their own times move to the period they start in, and show in every further period they reach into
  ("↳ name", a click goes to the course).
- The catalog paste in Settings → Elective areas is gone (offers are added in Subjects).

## 0.7.0 — 2026-10-23
- New: grade tracker (view "Grades", Alt+6, Plan → New Grade Ctrl+G). Grades per subject in your school's system —
  1–6 with tendencies (2+ / 2−; how much they count is set in Settings → Grades), 0–15 points or percent. Categories with
  weights (e.g. written 50 %, oral 50 %), different per subject if needed; single grades can count ½×, 2× or 3×; an empty
  grade (exam not back yet) is kept but not counted. Weighted average per subject and overall, filter by term, and
  "Which grade do I need?" for the average you want. Exams, tests and presentations have "Enter grade".

## 0.6.0 — 2026-10-23
- Voluntary elective areas: an area can be "voluntary (choosing nothing is fine)" — in the slot panel or under Settings →
  Elective areas. Unchosen slots then stay quiet ("voluntary" instead of "choose …"), get no reminder in Today and are
  not listed as lessons.
- Your own week pattern: alternating weeks follow the pattern you type, e.g. A, B or A, A, B (Settings → School year;
  "This week is" picks the place in the pattern). Single weeks can be set by hand in the timetable (the week type next to
  the dates) without moving the weeks after them; "Back to the pattern" removes those changes.
- Fixed: the "New choice every week / Same for all weeks" switch changed the look of the app's other segmented buttons.

## 0.5.0 — 2026-10-23
- New: the plan in your own calendar (Settings → In my calendar), kept up to date after every change:
  - **iCloud calendar** — Plan Studio writes its entries into a calendar "Plan Studio" in your iCloud account, so they
    show in Apple Calendar on the Mac, iPhone and iPad. Sign in with your Apple ID and an app-specific password (kept on
    this computer only); only changed entries are uploaded, removed ones are deleted there too.
  - **Subscription on this computer** — without an account: Apple Calendar, Outlook or Thunderbird subscribe to
    webcal://127.0.0.1:…/plan.ics (with a secret in the address) and refresh by themselves while Plan Studio runs.
- What goes in (dates always; homework and the timetable of the next weeks if you like) is chosen on the same page and
  also applies to the calendar file.

## 0.4.2 — 2026-10-23
- Fixed: elective slots could not be chosen anew each week — the same choice showed in every week. Slots of an elective
  area are now chosen per week by default; a choice for all weeks only counts when it is set as one ("Same every week"),
  so an older choice no longer fills every week. Each slot has a switch "New choice every week / Same for all weeks"
  right in the panel (for areas chosen once, e.g. per quarter).

## 0.4.1 — 2026-10-16
- The calendar export can contain the timetable of the next 2–20 weeks (Settings → General → Calendar): every lesson with
  its time, room and teacher — holidays, alternating weeks, cancelled days and your elective choices included — so the
  timetable also shows on your phone.

## 0.4.0 — 2026-10-15
- Elective areas can be chosen anew every week (Settings → Elective areas): each date of a slot gets its own choice from
  the catalog, or "Not taking part / excused"; "Same every week" keeps a choice for offers with regular attendance.
- Offers get a category (e.g. Languages, Sports), can be limited to one week type and to the slots they are given in; the
  catalog of a slot shows only what is offered there, grouped by category.
- Per area: a deadline (e.g. 1 pm on the day) and a weekly rule ("at least 1 from Languages", optionally only in B weeks).
  Today shows open choices and missing rules in a new "Choices" card; the timetable shows them for the week.
- Paste a whole catalog at once: one line per offer ("name; category; room; teacher; week type"), also from a spreadsheet.
- School year (new settings page): terms, holidays and days off (no lessons), alternating weeks (A/B or any names; holiday
  weeks can be left out of the count; click the week badge in the timetable to correct it).
- Lessons: cancelled on a single day, own times inside the period (e.g. a shorter session), only in one week type. Periods can
  be named (e.g. "Double period").

## 0.3.0 — 2026-10-15
- Terms (Settings → Timetable → Terms): half-years, quarters or blocks with dates. A course in the timetable can apply in
  some terms only, and one slot can hold different courses for different terms (e.g. electives chosen anew each quarter).
- Elective areas: subjects get an area (e.g. "Electives", "Clubs"); subjects of one area form a catalog. A timetable slot
  can be an elective slot of that area ("choose …"); the catalog is offered first when you pick its course.
- Shorter days: each day can end after a given period (e.g. only mornings on Saturday); the rest is greyed out.
- Class sessions at changing times: the new date type "Class" with time and duration shows in the timetable of its week
  (in the periods it overlaps) and in Today's lessons; "Copy to next week" repeats it quickly.
- The timetable can be browsed week by week (calendar week, dates, current term).

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

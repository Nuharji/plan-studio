# Changelog

## 1.2.0 — 2026-10-27
- New: Learn (Alt+7, Plan → New card deck Ctrl+L) — flashcards and vocabulary in decks, each with a subject and, if you
  like, the exam it is for. Add cards with front and back (Enter moves on), edit them right in the list, paste a whole
  list (one card per line, split by a tab, " = ", " - ", ";" or ":") or save a deck as text.
- Three ways to practise: turn over (Space, then 1 / 2), type the answer (Enter checks; case, punctuation, parts in
  brackets, "to" before verbs and ä/ae, ß/ss don't matter, one typo in a longer word counts; "I was right" if it was)
  and pick one of four (1–4). Direction front → back, back → front or mixed.
- Leitner boxes: a card you knew comes back after 1, 2, 4, 8, 16 days, one you didn't goes back to box 1 and comes
  again in the same round. "Learn due cards" (at most 40 a round) or "Practise all" (leaves progress alone); at the
  end, practise the ones you missed. A round is one undo step.
- Due cards show in Today ("Cards to review"); the minutes practised count as learned for the subject (and the exam).
  An exam's details list its decks and make a new one for it.
- Let Claude make cards (needs Agent Studio): from the deck's topic, the exam's topics and notes, or your notes in the
  work folder; "Take N cards" on the card at the bottom right adds them (without duplicates).

## 1.1.0 — 2026-10-24
- New: Agent Studio card in Today (when Agent Studio is used on this computer): what needs you, what runs and what
  Claude did for you today, with a button to open Agent Studio.
- New: enter homework and dates in your own words ("Maths p. 34 by Thursday") in that card — Claude works out subject
  and date and sends entries back; "Enter" on the card at the bottom right takes them over (undo works as usual).
- New: Suggest a study plan — for the exams, tests and talks of the next 6 weeks, with topics from your notes in the
  work folder (Studio Hub's settings). Needs Agent Studio 0.8 or later.

## 1.0.1 — 2026-10-24
- New app icon: the tile now fades from dark at the top left to lighter at the bottom right, like the other Studio apps.

## 1.0.0 — 2026-10-24
- First stable version — no longer Pre-Alpha. Plans made with any earlier version (back to 0.1.0) open unchanged;
  backups and imports keep everything.
- What it does: Today, a timetable that can change (terms, alternating weeks by pattern or by the holidays, blocked slots,
  courses with their own times, rooms per day), homework, exams and dates, elective areas chosen per week, grades with
  weights, a study planner with timer, linked calendars, the plan in your own calendar (iCloud / subscription), and the
  plan shared by two computers through a sync folder — offline, without an account, in German and English.

## 0.9.0 — 2026-10-24
- Studio Sync: with a sync folder chosen in Studio Hub (e.g. in iCloud Drive, OneDrive, Dropbox or on a USB stick), the plan
  — timetable, homework, grades, electives, study plans — is kept there, so two computers share it. The first computer
  brings its plan there; on the second one the plan from the sync folder is used and its own earlier plan is kept as a copy.
- Changes made on the other computer are loaded when you come back to the window (or within 20 seconds). If both changed
  the plan at the same time, the other version is kept as plan-conflict-….json in the sync folder. Settings → General
  shows where your plan is.

## 0.8.0 — 2026-10-24
- New: study planner. Exams, tests and presentations get topics to tick off (with progress) and "Make study plan": the
  study time (set per type, or per exam) is spread over the days before it in sessions — at most so many minutes a day,
  other exams included — each after school (after the last lesson of the day). "Spread again" keeps what is done.
- "Study today" in Today, sessions in the next-7-days panel, and a study timer (25 / 5 minutes, adjustable): finished
  study phases count for the session and the subject, shown as "Learned this week" per subject.
- Study sessions can go into your calendar (subscription, iCloud, calendar file). Settings → Study.

## 0.7.7 — 2026-10-24
- Dates and homework in the narrow cards of Today and in the next-7-days panel are easier to read: the title on its own
  line (wrapping instead of being cut off), with "in 4 days" next to it, and type · subject · date small below. Nothing
  sticks out of the card any more.

## 0.7.6 — 2026-10-24
- Grades can be switched off per subject ("No grades in this subject" in the subject's details), e.g. for clubs or
  electives: the subject leaves the grade view, the overall average and the calculator; grades entered before are kept.

## 0.7.5 — 2026-10-24
- A course with its own times stretches over every period it reaches into (e.g. until 16:15 over two periods) as one
  block, when those periods are free that day; otherwise they show "↳ name".
- Fixed: a course with only its own end time (starting with its period) didn't show in the following periods.
- The gaps between periods in the timetable follow the length of the break (5 minutes thin, lunch wider, an evening gap
  wide).

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

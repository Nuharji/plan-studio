//! Linked calendars: a calendar's subscription address (iCalendar / .ics — Google "secret address in iCal format",
//! Apple iCloud public calendar link, Outlook "ICS" link, webcal://…) is downloaded here and read into simple events
//! for the UI. Repeating events (RRULE: daily, weekly with days, monthly, yearly; INTERVAL, COUNT, UNTIL), left-out
//! dates (EXDATE), moved occurrences (RECURRENCE-ID) and cancelled events are handled. Read only: nothing is sent.

use serde::Serialize;
use std::collections::HashSet;

/// One occurrence for the UI. `start` / `end`: "YYYY-MM-DD" for all-day events, else "YYYY-MM-DDTHH:MM:SS";
/// `utc`: the times are UTC (the UI shows them in local time), otherwise they are local already.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct ExtEvent {
    pub uid: String,
    pub title: String,
    pub start: String,
    pub end: String,
    pub all_day: bool,
    pub utc: bool,
    pub location: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Calendar {
    pub name: String,
    pub events: Vec<ExtEvent>,
}

/* ── dates as day numbers (days since 1970-01-01) ── */
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + if m <= 2 { 1 } else { 0 }, m, d)
}
/// 0 = Monday.
fn weekday(days: i64) -> i64 { (days + 3).rem_euclid(7) }
fn days_in_month(y: i64, m: i64) -> i64 { days_from_civil(if m == 12 { y + 1 } else { y }, if m == 12 { 1 } else { m + 1 }, 1) - days_from_civil(y, m, 1) }

/// A date or date-time value.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Dt { days: i64, secs: Option<i64>, utc: bool }

impl Dt {
    fn parse(v: &str) -> Option<Dt> {
        let v = v.trim();
        let num = |s: &str| s.parse::<i64>().ok();
        let (y, m, d) = (num(v.get(0..4)?)?, num(v.get(4..6)?)?, num(v.get(6..8)?)?);
        if !(1..=12).contains(&m) || !(1..=31).contains(&d) { return None; }
        let days = days_from_civil(y, m, d);
        match v.get(8..9) {
            Some("T") => {
                let (h, mi, s) = (num(v.get(9..11)?)?, num(v.get(11..13)?)?, num(v.get(13..15).unwrap_or("00")).unwrap_or(0));
                Some(Dt { days, secs: Some(h * 3600 + mi * 60 + s), utc: v.ends_with('Z') })
            }
            _ => Some(Dt { days, secs: None, utc: false }),
        }
    }
    fn add_secs(self, s: i64) -> Dt {
        match self.secs {
            Some(t) => { let total = t + s; Dt { days: self.days + total.div_euclid(86400), secs: Some(total.rem_euclid(86400)), utc: self.utc } }
            None => Dt { days: self.days + s.div_euclid(86400), ..self },
        }
    }
    fn fmt(self) -> String {
        let (y, m, d) = civil_from_days(self.days);
        match self.secs {
            Some(t) => format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}", t / 3600, t % 3600 / 60, t % 60),
            None => format!("{y:04}-{m:02}-{d:02}"),
        }
    }
    /// Seconds since 1970 (for comparing; floating times count as UTC — good enough to order them).
    fn key(self) -> i64 { self.days * 86400 + self.secs.unwrap_or(0) }
}

/// "P1D", "PT1H30M", "-PT15M" → seconds.
fn duration(v: &str) -> Option<i64> {
    let (neg, v) = match v.strip_prefix('-') { Some(r) => (true, r), None => (false, v.strip_prefix('+').unwrap_or(v)) };
    let v = v.strip_prefix('P')?;
    let (mut total, mut num, mut in_time) = (0i64, String::new(), false);
    for c in v.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (c, in_time) { ('W', _) => 604800, ('D', _) => 86400, ('H', true) => 3600, ('M', true) => 60, ('S', true) => 1, _ => return None };
            }
        }
    }
    Some(if neg { -total } else { total })
}

/// Text value with iCalendar escapes undone.
fn text(v: &str) -> String {
    let mut out = String::new();
    let mut it = v.chars();
    while let Some(c) = it.next() {
        if c == '\\' {
            match it.next() { Some('n') | Some('N') => out.push('\n'), Some(x) => out.push(x), None => {} }
        } else { out.push(c); }
    }
    out
}

#[derive(Default, Clone)]
struct Raw {
    uid: String,
    title: String,
    location: String,
    start: Option<Dt>,
    end: Option<Dt>,
    dur: Option<i64>,
    rrule: Option<String>,
    exdates: Vec<Dt>,
    recurrence_id: Option<Dt>,
    cancelled: bool,
}

/// Reads an iCalendar text into the occurrences between `from` and `to` (day numbers, inclusive).
pub fn parse(ics: &str, from: i64, to: i64) -> Calendar {
    // Unfold: a line starting with a space or tab continues the previous one.
    let mut lines: Vec<String> = Vec::new();
    for l in ics.replace("\r\n", "\n").replace('\r', "\n").split('\n') {
        if (l.starts_with(' ') || l.starts_with('\t')) && !lines.is_empty() { lines.last_mut().unwrap().push_str(&l[1..]); } else { lines.push(l.to_string()); }
    }
    let mut name = String::new();
    let mut raws: Vec<Raw> = Vec::new();
    let mut cur: Option<Raw> = None;
    let mut depth_other = 0; // inside VALARM etc. within an event
    for line in &lines {
        let Some((head, value)) = line.split_once(':') else { continue };
        let mut parts = head.split(';');
        let prop = parts.next().unwrap_or("").to_ascii_uppercase();
        let params: Vec<(String, String)> = parts.filter_map(|p| p.split_once('=').map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string()))).collect();
        match (prop.as_str(), value.trim()) {
            ("BEGIN", "VEVENT") => { cur = Some(Raw::default()); depth_other = 0; continue; }
            ("END", "VEVENT") => { if let Some(r) = cur.take() { raws.push(r); } continue; }
            ("BEGIN", _) if cur.is_some() => { depth_other += 1; continue; }
            ("END", _) if cur.is_some() => { depth_other -= 1; continue; }
            ("X-WR-CALNAME", v) if cur.is_none() => { name = text(v); continue; }
            _ => {}
        }
        let Some(r) = cur.as_mut() else { continue };
        if depth_other > 0 { continue; }
        let date_only = params.iter().any(|(k, v)| k == "VALUE" && v.eq_ignore_ascii_case("DATE"));
        let dt = |v: &str| Dt::parse(v).map(|d| if date_only { Dt { secs: None, utc: false, ..d } } else { d });
        match prop.as_str() {
            "UID" => r.uid = value.trim().to_string(),
            "SUMMARY" => r.title = text(value),
            "LOCATION" => r.location = text(value),
            "DTSTART" => r.start = dt(value),
            "DTEND" => r.end = dt(value),
            "DURATION" => r.dur = duration(value.trim()),
            "RRULE" => r.rrule = Some(value.trim().to_ascii_uppercase()),
            "EXDATE" => r.exdates.extend(value.split(',').filter_map(dt)),
            "RECURRENCE-ID" => r.recurrence_id = dt(value),
            "STATUS" => r.cancelled = value.trim().eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }
    // Occurrences moved or changed on their own replace the repeated ones.
    let moved: HashSet<(String, i64)> = raws.iter().filter_map(|r| r.recurrence_id.map(|d| (r.uid.clone(), d.key()))).collect();
    let mut events = Vec::new();
    for r in &raws {
        let Some(start) = r.start else { continue };
        if r.cancelled && r.recurrence_id.is_none() { continue; }
        let all_day = start.secs.is_none();
        let len = match (r.end, r.dur) {
            (Some(e), _) => e.key() - start.key(),
            (None, Some(d)) => d,
            (None, None) => if all_day { 86400 } else { 0 },
        }.max(0);
        let mut push = |s: Dt| {
            if s.days > to || s.add_secs(len).days < from { return; }
            if r.recurrence_id.is_none() && moved.contains(&(r.uid.clone(), s.key())) { return; }
            if r.exdates.iter().any(|x| x.days == s.days && (x.secs.is_none() || x.secs == s.secs)) { return; }
            if r.cancelled { return; }
            let e = s.add_secs(len);
            // All-day ends are exclusive in iCalendar; the UI gets the last day.
            let end = if all_day && len >= 86400 { e.add_secs(-86400) } else { e };
            events.push(ExtEvent { uid: r.uid.clone(), title: r.title.clone(), start: s.fmt(), end: end.fmt(), all_day, utc: s.utc, location: r.location.clone() });
        };
        match &r.rrule {
            None => push(start),
            Some(rule) => for s in occurrences(start, rule, to) { push(s) },
        }
    }
    events.sort_by(|a, b| a.start.cmp(&b.start).then(a.title.cmp(&b.title)));
    events.truncate(3000);
    Calendar { name, events }
}

/// Start times of a repeating event up to day `to` (RRULE: FREQ, INTERVAL, COUNT, UNTIL, BYDAY for weekly).
fn occurrences(start: Dt, rule: &str, to: i64) -> Vec<Dt> {
    let get = |k: &str| rule.split(';').find_map(|p| p.strip_prefix(k).and_then(|v| v.strip_prefix('=')));
    let interval = get("INTERVAL").and_then(|v| v.parse::<i64>().ok()).unwrap_or(1).max(1);
    let count = get("COUNT").and_then(|v| v.parse::<usize>().ok());
    let until = get("UNTIL").and_then(Dt::parse).map(|u| u.days);
    let last = until.map_or(to, |u| u.min(to));
    let days_of_week: Vec<i64> = get("BYDAY").map(|v| v.split(',').filter_map(|d| {
        // Weekly rules use plain days ("MO"); "1MO" style (monthly) is not used here.
        ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].iter().position(|x| d.ends_with(x)).map(|p| p as i64)
    }).collect()).unwrap_or_default();
    let (y0, m0, d0) = civil_from_days(start.days);
    let mut out = Vec::new();
    let mut n = 0usize;
    let mut take = |days: i64, out: &mut Vec<Dt>| -> bool {
        if days < start.days { return true; }
        if days > last || count.is_some_and(|c| n >= c) || out.len() > 5000 { return false; }
        n += 1;
        out.push(Dt { days, ..start });
        true
    };
    match get("FREQ").unwrap_or("") {
        "DAILY" => { let mut d = start.days; while take(d, &mut out) { d += interval; } }
        "WEEKLY" => {
            let days = if days_of_week.is_empty() { vec![weekday(start.days)] } else { let mut v = days_of_week.clone(); v.sort(); v };
            let mut week = start.days - weekday(start.days);
            'w: loop {
                for wd in &days { if !take(week + wd, &mut out) { break 'w; } }
                week += 7 * interval;
                if week > last + 7 { break; }
            }
        }
        "MONTHLY" => {
            let mut i = 0i64;
            loop {
                let mi = m0 - 1 + i * interval;
                let (y, m) = (y0 + mi.div_euclid(12), mi.rem_euclid(12) + 1);
                if days_from_civil(y, m, 1) > last { break; }
                // Months without that day (31st) are skipped, as the standard says.
                if d0 <= days_in_month(y, m) && !take(days_from_civil(y, m, d0), &mut out) { break; }
                i += 1;
            }
        }
        "YEARLY" => {
            let mut y = y0;
            loop {
                if days_from_civil(y, 1, 1) > last { break; }
                if d0 <= days_in_month(y, m0) && !take(days_from_civil(y, m0, d0), &mut out) { break; }
                y += interval;
            }
        }
        _ => out.push(start),
    }
    out
}

/// "2026-10-15" → day number.
pub fn day_of(iso: &str) -> Option<i64> {
    let p: Vec<i64> = iso.split('-').filter_map(|x| x.parse().ok()).collect();
    (p.len() == 3).then(|| days_from_civil(p[0], p[1], p[2]))
}

/// The address to download: webcal:// is https://; only web addresses are allowed.
pub fn normalize_url(url: &str) -> Result<String, String> {
    let u = url.trim();
    let lower = u.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("webcal://").or_else(|| lower.strip_prefix("webcals://")) {
        return Ok(format!("https://{}", &u[u.len() - rest.len()..]));
    }
    if lower.starts_with("https://") || lower.starts_with("http://") { return Ok(u.to_string()); }
    Err("not a web address".into())
}

/// Downloads a calendar and returns its occurrences between `from` and `to` ("YYYY-MM-DD").
#[tauri::command]
pub async fn calendar_fetch(url: String, from: String, to: String) -> Result<Calendar, String> {
    let url = normalize_url(&url)?;
    let (from, to) = (day_of(&from).ok_or("from")?, day_of(&to).ok_or("to")?);
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .user_agent("PlanStudio")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;
        let resp = client.get(&url).send().map_err(|e| e.to_string())?;
        let status = resp.status();
        if !status.is_success() { return Err(format!("HTTP {}", status.as_u16())); }
        let bytes = resp.bytes().map_err(|e| e.to_string())?;
        if bytes.len() > 20_000_000 { return Err("calendar too big".into()); }
        let text = String::from_utf8_lossy(&bytes);
        if !text.contains("BEGIN:VCALENDAR") { return Err("not a calendar (.ics)".into()); }
        Ok(parse(&text, from, to))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Familie\r\n\
BEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Oma Geburtstag\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261021\r\nRRULE:FREQ=YEARLY\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Fußball\\, Training\r\nLOCATION:Sportplatz\r\nDTSTART;TZID=Europe/Berlin:20261013T170000\r\nDTEND;TZID=Europe/Berlin:20261013T183000\r\n\
RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261031T000000Z\r\nEXDATE;TZID=Europe/Berlin:20261022T170000\r\n\
BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nSUMMARY:not the title\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:b\r\nRECURRENCE-ID;TZID=Europe/Berlin:20261020T170000\r\nSUMMARY:Fußball (später)\r\nDTSTART;TZID=Europe/Berlin:20261020T180000\r\nDURATION:PT1H\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Zahnarzt mit einem sehr langen Titel der über die Zeile hinaus\r\n geht\r\nDTSTART:20261016T073000Z\r\nDTEND:20261016T080000Z\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Abgesagt\r\nSTATUS:CANCELLED\r\nDTSTART:20261017T100000\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:e\r\nSUMMARY:Ferien\r\nDTSTART;VALUE=DATE:20261026\r\nDTEND;VALUE=DATE:20261031\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn reads_a_calendar() {
        let c = parse(SAMPLE, day_of("2026-10-15").unwrap(), day_of("2026-11-15").unwrap());
        assert_eq!(c.name, "Familie");
        let titles: Vec<(String, String)> = c.events.iter().map(|e| (e.start.clone(), e.title.clone())).collect();
        assert_eq!(titles, vec![
            ("2026-10-15T17:00:00".into(), "Fußball, Training".into()),
            ("2026-10-16T07:30:00".into(), "Zahnarzt mit einem sehr langen Titel der über die Zeile hinausgeht".into()),
            ("2026-10-20".into(), "Oma Geburtstag".into()),
            ("2026-10-20T18:00:00".into(), "Fußball (später)".into()),
            ("2026-10-26".into(), "Ferien".into()),
            ("2026-10-27T17:00:00".into(), "Fußball, Training".into()),
            ("2026-10-29T17:00:00".into(), "Fußball, Training".into()),
        ]);
        let ferien = c.events.iter().find(|e| e.title == "Ferien").unwrap();
        assert_eq!((ferien.end.as_str(), ferien.all_day), ("2026-10-30", true));
        let z = c.events.iter().find(|e| e.uid == "c").unwrap();
        assert!(z.utc && z.end == "2026-10-16T08:00:00");
        let moved = c.events.iter().find(|e| e.title == "Fußball (später)").unwrap();
        assert_eq!(moved.end, "2026-10-20T19:00:00");
        assert_eq!(c.events.iter().find(|e| e.uid == "b").unwrap().location, "Sportplatz");
    }

    #[test]
    fn repeats_and_helpers() {
        let s = Dt::parse("20260131T090000").unwrap();
        let m: Vec<String> = occurrences(s, "FREQ=MONTHLY;COUNT=4", day_of("2027-12-31").unwrap()).iter().map(|d| d.fmt()).collect();
        assert_eq!(m, vec!["2026-01-31T09:00:00", "2026-03-31T09:00:00", "2026-05-31T09:00:00", "2026-07-31T09:00:00"]);
        let d: Vec<String> = occurrences(Dt::parse("20261001").unwrap(), "FREQ=DAILY;INTERVAL=3", day_of("2026-10-10").unwrap()).iter().map(|d| d.fmt()).collect();
        assert_eq!(d, vec!["2026-10-01", "2026-10-04", "2026-10-07", "2026-10-10"]);
        let w = occurrences(Dt::parse("20261005").unwrap(), "FREQ=WEEKLY;INTERVAL=2", day_of("2026-11-05").unwrap());
        assert_eq!(w.iter().map(|d| d.fmt()).collect::<Vec<_>>(), vec!["2026-10-05", "2026-10-19", "2026-11-02"]);
        assert_eq!(duration("P1DT2H"), Some(93600));
        assert_eq!(duration("-PT15M"), Some(-900));
        assert_eq!(weekday(day_of("2026-10-15").unwrap()), 3, "a Thursday");
        assert_eq!(civil_from_days(day_of("2024-02-29").unwrap()), (2024, 2, 29));
        assert_eq!(normalize_url("webcal://p01-caldav.icloud.com/published/2/X").unwrap(), "https://p01-caldav.icloud.com/published/2/X");
        assert!(normalize_url("file:///etc/passwd").is_err());
    }

    /// `PLAN_ICS_URL=https://… cargo test live_feed -- --ignored --nocapture` downloads a real calendar.
    #[test]
    #[ignore]
    fn live_feed() {
        let url = std::env::var("PLAN_ICS_URL").expect("PLAN_ICS_URL");
        let c = tauri::async_runtime::block_on(calendar_fetch(url, "2026-10-01".into(), "2027-01-31".into())).unwrap();
        println!("{}: {} events", c.name, c.events.len());
        for e in c.events.iter().take(8) { println!("  {} {}", e.start, e.title); }
        assert!(!c.events.is_empty());
    }
}

//! iCalendar export (RFC 5545) of a plan: exams, tests, presentations and deadlines — and optionally homework — as
//! events that calendar apps (Outlook, Google, Apple, Thunderbird) import. Dates without a time become all-day events;
//! times are local ("floating"), like the plan itself.

use serde_json::Value;

/// Text escaped for a property value (backslash, comma, semicolon, line breaks).
fn esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace(';', "\\;").replace(',', "\\,").replace("\r\n", "\\n").replace('\n', "\\n")
}

/// A content line folded at 75 octets (continuation lines start with a space), ended by CRLF.
fn fold(line: &str) -> String {
    let mut out = String::new();
    let mut len = 0;
    for ch in line.chars() {
        let n = ch.len_utf8();
        if len + n > 75 {
            out.push_str("\r\n ");
            len = 1;
        }
        out.push(ch);
        len += n;
    }
    out + "\r\n"
}

/// "2026-10-20" → "20261020"; None when it isn't a date.
fn ymd(s: &str) -> Option<String> {
    let p: Vec<&str> = s.split('-').collect();
    if p.len() != 3 || p[0].len() != 4 || !p.iter().all(|x| !x.is_empty() && x.chars().all(|c| c.is_ascii_digit())) { return None; }
    let (y, m, d): (i32, u32, u32) = (p[0].parse().ok()?, p[1].parse().ok()?, p[2].parse().ok()?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) { return None; }
    Some(format!("{y:04}{m:02}{d:02}"))
}

/// The day after a date (for all-day events, whose end is exclusive).
fn next_day(ymd: &str) -> String {
    let (y, m, d): (i32, u32, u32) = (ymd[..4].parse().unwrap(), ymd[4..6].parse().unwrap(), ymd[6..].parse().unwrap());
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m as usize - 1];
    let (y, m, d) = if d < days { (y, m, d + 1) } else if m < 12 { (y, m + 1, 1) } else { (y + 1, 1, 1) };
    format!("{y:04}{m:02}{d:02}")
}

/// "08:15" → "081500".
fn hm(s: &str) -> Option<String> {
    let (h, m) = s.split_once(':')?;
    let (h, m): (u32, u32) = (h.trim().parse().ok()?, m.trim().parse().ok()?);
    (h < 24 && m < 60).then(|| format!("{h:02}{m:02}00"))
}

/// The current time as a UTC stamp ("20261015T120000Z").
pub fn utc_stamp() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let (days, rem) = (secs / 86400, secs % 86400);
    // Civil date from days since 1970 (Howard Hinnant's algorithm).
    let z = days as i64 + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

const TYPES_DE: &[(&str, &str)] = &[("exam", "Klausur"), ("test", "Test"), ("talk", "Referat"), ("deadline", "Abgabe"), ("other", "Termin")];
const TYPES_EN: &[(&str, &str)] = &[("exam", "Exam"), ("test", "Test"), ("talk", "Presentation"), ("deadline", "Deadline"), ("other", "Event")];

/// The calendar: one VEVENT per dated event (and per open homework when `tasks`).
pub fn calendar(plan: &Value, lang: &str, tasks: bool, stamp: &str) -> String {
    let de = lang == "de";
    let subject = |id: &Value| -> String {
        plan["subjects"].as_array().and_then(|l| l.iter().find(|s| s["id"] == *id)).and_then(|s| s["name"].as_str()).unwrap_or("").to_string()
    };
    let mut out = String::from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Studio//Plan Studio//EN\r\nCALSCALE:GREGORIAN\r\n");
    out += &fold(&format!("X-WR-CALNAME:{}", if de { "Schule" } else { "School" }));
    let mut event = |uid: &str, date: &str, time: Option<&str>, minutes: u32, summary: &str, notes: &str| {
        let Some(d) = ymd(date) else { return };
        out += "BEGIN:VEVENT\r\n";
        out += &fold(&format!("UID:{}@plan-studio", esc(uid)));
        out += &format!("DTSTAMP:{stamp}\r\n");
        match time.and_then(hm) {
            Some(t) => { out += &format!("DTSTART:{d}T{t}\r\nDURATION:PT{minutes}M\r\n"); }
            None => { out += &format!("DTSTART;VALUE=DATE:{d}\r\nDTEND;VALUE=DATE:{}\r\n", next_day(&d)); }
        }
        out += &fold(&format!("SUMMARY:{}", esc(summary)));
        if !notes.trim().is_empty() { out += &fold(&format!("DESCRIPTION:{}", esc(notes.trim()))); }
        out += "END:VEVENT\r\n";
    };
    for e in plan["events"].as_array().into_iter().flatten() {
        let kind = e["type"].as_str().unwrap_or("other");
        let label = (if de { TYPES_DE } else { TYPES_EN }).iter().find(|t| t.0 == kind).map_or(kind, |t| t.1);
        let subj = subject(&e["subject"]);
        let title = e["title"].as_str().unwrap_or("");
        let summary = [label.to_string(), [subj.as_str(), title].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join(" – ")]
            .iter().filter(|s| !s.is_empty()).cloned().collect::<Vec<_>>().join(": ");
        event(e["id"].as_str().unwrap_or("e"), e["date"].as_str().unwrap_or(""), e["time"].as_str(), e["minutes"].as_u64().unwrap_or(90) as u32,
            &summary, e["notes"].as_str().unwrap_or(""));
    }
    if tasks {
        for t in plan["tasks"].as_array().into_iter().flatten().filter(|t| !t["done"].as_bool().unwrap_or(false)) {
            let subj = subject(&t["subject"]);
            let title = t["title"].as_str().unwrap_or("");
            let summary = format!("{}: {}", if de { "HA" } else { "Homework" }, if subj.is_empty() { title.to_string() } else { format!("{subj} – {title}") });
            event(t["id"].as_str().unwrap_or("t"), t["due"].as_str().unwrap_or(""), None, 0, &summary, t["notes"].as_str().unwrap_or(""));
        }
    }
    out + "END:VCALENDAR\r\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn calendar_file() {
        let plan = json!({
            "subjects": [{"id": "m", "name": "Mathe"}, {"id": "d", "name": "Deutsch"}],
            "events": [
                {"id": "e1", "type": "exam", "subject": "m", "title": "Analysis; Kapitel 3, 4", "date": "2026-12-31", "notes": "Taschenrechner\nmitbringen"},
                {"id": "e2", "type": "talk", "subject": "d", "title": "", "date": "2026-10-20", "time": "9:05", "minutes": 20},
                {"id": "e3", "type": "other", "title": "kaputt", "date": "20.10.2026"}
            ],
            "tasks": [{"id": "t1", "subject": "m", "title": "S. 34 Nr. 5", "due": "2026-02-28", "done": false},
                      {"id": "t2", "subject": "d", "title": "fertig", "due": "2026-03-01", "done": true}]
        });
        let c = calendar(&plan, "de", true, "20261015T120000Z");
        assert!(c.starts_with("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n") && c.ends_with("END:VCALENDAR\r\n"));
        assert!(c.contains("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n"), "{c}");
        assert!(c.contains("SUMMARY:Klausur: Mathe – Analysis\\; Kapitel 3\\, 4\r\n"), "{c}");
        assert!(c.contains("DESCRIPTION:Taschenrechner\\nmitbringen\r\n"));
        assert!(c.contains("DTSTART:20261020T090500\r\nDURATION:PT20M\r\n"));
        assert!(c.contains("SUMMARY:Referat: Deutsch\r\n"));
        assert!(!c.contains("kaputt"), "invalid dates are left out");
        assert!(c.contains("SUMMARY:HA: Mathe – S. 34 Nr. 5") && c.contains("DTEND;VALUE=DATE:20260301"));
        assert!(!c.contains("fertig"), "done homework is left out");
        assert_eq!(c.matches("BEGIN:VEVENT").count(), 3);
        assert!(c.lines().all(|l| l.len() <= 75), "lines are folded");
        assert_eq!(calendar(&plan, "en", false, "x").matches("BEGIN:VEVENT").count(), 2);
    }

    #[test]
    fn dates_and_stamp() {
        assert_eq!(next_day("20240228"), "20240229");
        assert_eq!(next_day("20230228"), "20230301");
        assert_eq!(next_day("20261231"), "20270101");
        assert_eq!(hm("7:45"), Some("074500".into()));
        assert_eq!(hm("25:00"), None);
        assert_eq!(ymd("2026-13-01"), None);
        let s = utc_stamp();
        assert!(s.len() == 16 && s.ends_with('Z') && s.starts_with("20"), "{s}");
        let long = fold(&"x".repeat(200));
        assert!(long.split("\r\n").all(|l| l.len() <= 75));
    }
}

//! What Plan Studio offers over MCP (mcp.rs): reading the plan, adding homework and dates. It uses the plan the app uses
//! (store.rs), and saves like the app: an open Plan Studio notices the change, and what changed meanwhile is kept as a
//! conflict copy. Only the app sets up a plan (or the sync folder), so without one the tools say so.

use crate::{mcp, store};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn run() { mcp::serve("plan-studio", env!("CARGO_PKG_VERSION"), &tools(), &call) }

const SECTIONS: [&str; 5] = ["subjects", "periods", "lessons", "tasks", "events"];
const EVENT_TYPES: [&str; 6] = ["exam", "test", "talk", "deadline", "class", "other"];

fn tools() -> Vec<Value> {
    let subject = json!({"type": "string", "description": "Name or short name of a subject of the plan"});
    let date = json!({"type": "string", "description": "YYYY-MM-DD"});
    vec![
        mcp::tool("plan_read", "Reads the plan: subjects, periods, lessons (timetable; day 0 is the first school day), tasks (homework) and events (exams, tests, deadlines …).",
            json!({"sections": {"type": "array", "items": {"type": "string", "enum": SECTIONS}, "description": "Default: all of them"}}), &[]),
        mcp::tool("plan_add_task", "Adds homework to the plan.", json!({"title": {"type": "string"}, "subject": subject, "due": date, "notes": {"type": "string"}}), &["title"]),
        mcp::tool("plan_add_event", "Adds a date to the plan (exam, test, talk, deadline, class or other).", json!({"title": {"type": "string"}, "type": {"type": "string", "enum": EVENT_TYPES},
            "date": date, "time": {"type": "string", "description": "HH:MM"}, "subject": subject, "notes": {"type": "string"}}), &["title", "date"]),
    ]
}

/// The app's data folder (what Tauri calls app_data_dir).
fn local_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let base = if cfg!(any(windows, target_os = "macos")) { mcp::config_dir() }
        else { std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).or_else(|| home.map(|h| h.join(".local").join("share"))) };
    base.map(|b| b.join("com.planstudio.app"))
}

fn plan_file() -> Result<PathBuf, String> {
    let portable = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("plan.json")));
    let sync = mcp::studio_dir().and_then(|d| crate::shared::read_from(&d.join("shared.json")).get("syncFolder").and_then(Value::as_str).map(PathBuf::from)).filter(|d| d.is_dir());
    Ok(store::place(portable, sync, &local_dir().ok_or("no data folder")?).path)
}

fn load(p: &Path) -> Result<Value, String> {
    let text = std::fs::read_to_string(p).map_err(|_| format!("no plan at {}: open Plan Studio once first", p.display()))?;
    let plan: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))?;
    if ["subjects", "lessons", "tasks", "events", "periods"].iter().all(|k| plan[k].is_array()) { Ok(plan) } else { Err(format!("{}: not a plan", p.display())) }
}

fn uid() -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    format!("m{:x}{:x}", t & 0xff_ffff, N.fetch_add(1, Ordering::Relaxed))
}

/// The id of a subject, by name or short name.
fn subject_id(plan: &Value, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() { return Ok(String::new()); }
    let list = plan["subjects"].as_array().map_or(&[][..], |l| &l[..]);
    let same = |s: &Value, k: &str| s[k].as_str().is_some_and(|x| x.eq_ignore_ascii_case(name));
    list.iter().find(|s| same(s, "name") || same(s, "short")).and_then(|s| s["id"].as_str()).map(str::to_string).ok_or_else(|| {
        format!("no subject {name}; there are: {}", list.iter().filter_map(|s| s["name"].as_str()).collect::<Vec<_>>().join(", "))
    })
}

fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b[4] == b'-' && b[7] == b'-' && b.iter().enumerate().all(|(i, c)| i == 4 || i == 7 || c.is_ascii_digit())
        && matches!(s[5..7].parse::<u32>(), Ok(1..=12)) && matches!(s[8..10].parse::<u32>(), Ok(1..=31))
}

fn valid_time(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 5 && b[2] == b':' && matches!(s[..2].parse::<u32>(), Ok(0..=23)) && matches!(s[3..].parse::<u32>(), Ok(0..=59))
}

fn read(p: &Path, args: &Value) -> Result<Value, String> {
    let plan = load(p)?;
    let mut out = serde_json::Map::new();
    let asked: Vec<&str> = args.get("sections").and_then(Value::as_array).map(|l| l.iter().filter_map(Value::as_str).collect()).unwrap_or_else(|| SECTIONS.to_vec());
    for k in asked {
        if !SECTIONS.contains(&k) { return Err(format!("no section {k}")); }
        out.insert(k.into(), plan[k].clone());
    }
    Ok(Value::Object(out))
}

/// Adds an entry to a list of the plan and saves it; the stamp is taken before reading, so a change in between is kept.
fn add(p: &Path, list: &str, make: impl FnOnce(&Value) -> Result<Value, String>) -> Result<Value, String> {
    let stamp = store::stamp(p);
    let mut plan = load(p)?;
    let entry = make(&plan)?;
    plan[list].as_array_mut().ok_or("not a plan")?.push(entry.clone());
    let text = serde_json::to_string(&plan).map_err(|e| e.to_string())?;
    store::save_checked(p, &text, Some(stamp))?;
    Ok(entry)
}

fn add_task(p: &Path, args: &Value) -> Result<Value, String> {
    let (title, due) = (mcp::text(args, "title")?, mcp::opt_text(args, "due"));
    if !due.is_empty() && !valid_date(&due) { return Err(format!("due: expected YYYY-MM-DD, not {due}")); }
    add(p, "tasks", |plan| Ok(json!({"id": uid(), "title": title.trim(), "subject": subject_id(plan, &mcp::opt_text(args, "subject"))?, "due": due, "done": false, "notes": mcp::opt_text(args, "notes")})))
}

fn add_event(p: &Path, args: &Value) -> Result<Value, String> {
    let (title, date, time) = (mcp::text(args, "title")?, mcp::text(args, "date")?, mcp::opt_text(args, "time"));
    let kind = Some(mcp::opt_text(args, "type")).filter(|k| !k.is_empty()).unwrap_or_else(|| "other".into());
    if !EVENT_TYPES.contains(&kind.as_str()) { return Err(format!("type: expected one of {}", EVENT_TYPES.join(", "))); }
    if !valid_date(&date) { return Err(format!("date: expected YYYY-MM-DD, not {date}")); }
    if !time.is_empty() && !valid_time(&time) { return Err(format!("time: expected HH:MM, not {time}")); }
    add(p, "events", |plan| Ok(json!({"id": uid(), "type": kind, "subject": subject_id(plan, &mcp::opt_text(args, "subject"))?, "title": title.trim(), "date": date, "time": time, "notes": mcp::opt_text(args, "notes")})))
}

fn call(name: &str, args: &Value) -> Result<Value, String> {
    let p = plan_file()?;
    match name {
        "plan_read" => read(&p, args),
        "plan_add_task" => add_task(&p, args),
        "plan_add_event" => add_event(&p, args),
        _ => Err(format!("unknown tool: {name}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn homework_and_dates() {
        let d = std::env::temp_dir().join(format!("plan-mcp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let p = d.join("plan.json");
        assert!(read(&p, &json!({})).unwrap_err().contains("open Plan Studio"), "only the app sets up a plan");
        assert!(!p.exists());
        // Fields of the app that the tools don't know stay.
        fs::write(&p, json!({"version": 1, "days": 5, "periods": [], "lessons": [], "tasks": [], "events": [], "decks": [{"name": "Vokabeln"}],
            "subjects": [{"id": "s1", "name": "Mathematik", "short": "Ma"}]}).to_string()).unwrap();

        let t = add_task(&p, &json!({"title": "S. 34", "subject": "ma", "due": "2026-11-05"})).unwrap();
        assert_eq!((t["subject"].as_str(), t["done"].as_bool()), (Some("s1"), Some(false)));
        let e = add_event(&p, &json!({"title": "Klausur", "type": "exam", "date": "2026-11-20", "time": "08:00", "subject": "Mathematik"})).unwrap();
        assert_eq!(e["type"], "exam");
        assert_eq!(add_event(&p, &json!({"title": "Sonst", "date": "2026-11-21"})).unwrap()["type"], "other");

        let r = read(&p, &json!({"sections": ["tasks", "events"]})).unwrap();
        assert_eq!(r["tasks"][0]["title"], "S. 34");
        assert_eq!(r["events"].as_array().unwrap().len(), 2);
        assert!(r.get("subjects").is_none());
        assert!(read(&p, &json!({"sections": ["decks"]})).is_err());
        assert_eq!(load(&p).unwrap()["decks"][0]["name"], "Vokabeln");

        assert!(add_task(&p, &json!({"title": "X", "subject": "Latein"})).unwrap_err().contains("Mathematik"));
        assert!(add_task(&p, &json!({"title": "X", "due": "morgen"})).is_err());
        assert!(add_event(&p, &json!({"title": "X", "date": "2026-13-01"})).is_err());
        assert!(add_event(&p, &json!({"title": "X", "date": "2026-11-01", "time": "25:00"})).is_err());
        assert!(add_event(&p, &json!({"title": "X", "date": "2026-11-01", "type": "party"})).is_err());
        assert_eq!(load(&p).unwrap()["tasks"].as_array().unwrap().len(), 1, "what failed left nothing behind");
        let _ = fs::remove_dir_all(d);
    }
}

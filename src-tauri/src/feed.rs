//! Calendar subscription on this computer: a tiny web server on 127.0.0.1 hands out the plan as a calendar
//! (webcal://127.0.0.1:<port>/<secret>/plan.ics). Apple Calendar, Outlook or Thunderbird on this computer subscribe to
//! it and refresh it by themselves — no account needed. It only answers this computer (not the network), the address
//! contains a random secret, and it serves only while Plan Studio runs (calendar apps keep the last state meanwhile).
//! The UI sends the current calendar text after every change (feed_update).

use serde::{Deserialize, Serialize};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Manager, State};

/// The ports tried, in order (the first free one is kept, so the address normally stays the same).
const PORTS: [u16; 6] = [47863, 47864, 47865, 47866, 47867, 47868];

#[derive(Default)]
pub struct Feed {
    ics: Arc<Mutex<String>>,
    url: Mutex<Option<String>>,
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    secret: String,
}

fn saved_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("calendar-feed.json"))
}

/// A random-looking secret for the address, kept so the subscription keeps working after a restart.
fn secret(app: &AppHandle) -> String {
    let path = saved_path(app);
    if let Some(s) = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str::<Saved>(&t).ok()) {
        if s.secret.len() >= 16 { return s.secret; }
    }
    // RandomState is seeded from the operating system's random source: two of them give 128 random bits.
    use std::hash::BuildHasher;
    let r = || std::collections::hash_map::RandomState::new().hash_one(std::process::id());
    let s = format!("{:016x}{:016x}", r(), r());
    if let Some(p) = path { let _ = std::fs::write(p, serde_json::to_string(&Saved { secret: s.clone() }).unwrap_or_default()); }
    s
}

/// Answers one request: the calendar for GET/HEAD of the secret path, 404 for everything else.
pub fn answer(request_line: &str, secret: &str, ics: &str) -> Vec<u8> {
    let mut parts = request_line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    let path = path.split('?').next().unwrap_or("");
    if (method == "GET" || method == "HEAD") && path == format!("/{secret}/plan.ics") {
        let head = format!("HTTP/1.1 200 OK\r\nContent-Type: text/calendar; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n", ics.len());
        let mut out = head.into_bytes();
        if method == "GET" { out.extend_from_slice(ics.as_bytes()); }
        return out;
    }
    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
}

fn serve(mut stream: TcpStream, secret: &str, ics: &Arc<Mutex<String>>) {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
    let mut reader = BufReader::new(match stream.try_clone() { Ok(s) => s, Err(_) => return });
    let mut line = String::new();
    if reader.read_line(&mut line).is_err() { return; }
    // Read the rest of the header (not needed).
    let mut h = String::new();
    while reader.read_line(&mut h).map(|n| n > 2).unwrap_or(false) { h.clear(); }
    let body = ics.lock().unwrap().clone();
    let _ = stream.write_all(&answer(line.trim(), secret, &body));
}

/// Starts the server (once) and returns the subscription address.
#[tauri::command]
pub fn feed_start(app: AppHandle, feed: State<Feed>) -> Result<String, String> {
    if let Some(u) = feed.url.lock().unwrap().clone() { return Ok(u); }
    let secret = secret(&app);
    let listener = PORTS.iter().find_map(|p| TcpListener::bind(("127.0.0.1", *p)).ok()).ok_or("no free port")?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let ics = feed.ics.clone();
    let s = secret.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (s, ics) = (s.clone(), ics.clone());
            std::thread::spawn(move || serve(stream, &s, &ics));
        }
    });
    let url = format!("webcal://127.0.0.1:{port}/{secret}/plan.ics");
    *feed.url.lock().unwrap() = Some(url.clone());
    Ok(url)
}

/// The calendar the subscription hands out (the UI sends it after every change).
#[tauri::command]
pub fn feed_update(feed: State<Feed>, plan: serde_json::Value, lang: String, tasks: bool) {
    *feed.ics.lock().unwrap() = crate::ics::calendar(&plan, &lang, tasks, &crate::ics::utc_stamp());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_only_the_secret_address() {
        let ok = String::from_utf8(answer("GET /abc123/plan.ics HTTP/1.1", "abc123", "BEGIN:VCALENDAR")).unwrap();
        assert!(ok.starts_with("HTTP/1.1 200 OK\r\n") && ok.contains("text/calendar") && ok.ends_with("\r\n\r\nBEGIN:VCALENDAR"), "{ok}");
        let head = String::from_utf8(answer("HEAD /abc123/plan.ics?x=1 HTTP/1.1", "abc123", "BEGIN")).unwrap();
        assert!(head.contains("Content-Length: 5") && head.ends_with("\r\n\r\n"));
        for bad in ["GET /plan.ics HTTP/1.1", "GET /wrong/plan.ics HTTP/1.1", "POST /abc123/plan.ics HTTP/1.1", ""] {
            assert!(String::from_utf8(answer(bad, "abc123", "x")).unwrap().starts_with("HTTP/1.1 404"), "{bad}");
        }
    }
}

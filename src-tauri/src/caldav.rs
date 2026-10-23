//! Plan Studio's entries in your iCloud calendar (CalDAV): the app writes them into a calendar "Plan Studio" in your
//! iCloud account, so they show in Apple Calendar on the Mac, iPhone and iPad. You sign in with your Apple ID and an
//! app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords); both are kept on this
//! computer only (app data folder). Only changed entries are uploaded, removed ones are deleted there too.

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
    path::PathBuf,
};
use tauri::{AppHandle, Manager, State};

const ROOT: &str = "https://caldav.icloud.com/";
pub const CAL_NAME: &str = "Plan Studio";

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Account {
    pub user: String,
    pub pass: String,
    /// The calendar's address.
    pub calendar: String,
    /// UID → content hash of what is in the calendar now.
    #[serde(default)]
    pub synced: BTreeMap<String, u64>,
    #[serde(default)]
    pub last_sync: u64,
}

/// One sync at a time.
#[derive(Default)]
pub struct Sync(std::sync::atomic::AtomicBool);

fn store(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("icloud.json"))
}
fn load(app: &AppHandle) -> Option<Account> {
    serde_json::from_str(&std::fs::read_to_string(store(app).ok()?).ok()?).ok()
}
fn save(app: &AppHandle, a: &Account) -> Result<(), String> {
    let p = store(app)?;
    std::fs::write(&p, serde_json::to_string(a).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    // Readable by you only.
    #[cfg(unix)]
    { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)); }
    Ok(())
}

/* ----- A little XML: the texts of elements with a local name, whatever their namespace prefix ----- */

fn elements<'a>(xml: &'a str, local: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find('<') {
        rest = &rest[i + 1..];
        let end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..end];
        if tag.starts_with('/') || tag.starts_with('?') || tag.starts_with('!') { continue; }
        let name = tag.split([' ', '\t', '\r', '\n', '/']).next().unwrap_or("");
        let lname = name.rsplit(':').next().unwrap_or("");
        if lname != local { continue; }
        if tag.ends_with('/') { out.push(""); continue; }
        let body = &rest[(end + 1).min(rest.len())..];
        let close = format!("</{name}>");
        if let Some(j) = body.find(&close) { out.push(&body[..j]); rest = &body[j..]; }
    }
    out
}
fn first<'a>(xml: &'a str, local: &str) -> Option<&'a str> { elements(xml, local).into_iter().next() }
fn text(s: &str) -> String {
    s.trim().replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
}

/// An address relative to the one it came from.
pub fn join(base: &str, href: &str) -> String {
    let href = href.trim();
    if href.starts_with("http://") || href.starts_with("https://") { return href.to_string(); }
    let origin_end = base.find("://").map(|i| i + 3).and_then(|i| base[i..].find('/').map(|j| i + j)).unwrap_or(base.len());
    if href.starts_with('/') { return format!("{}{href}", &base[..origin_end]); }
    let dir = &base[..base.rfind('/').map(|i| i + 1).unwrap_or(base.len())];
    format!("{dir}{href}")
}

/// Content of an entry without its time stamp (which changes every time) — what decides whether it is uploaded.
pub fn content_hash(vevent: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    for l in vevent.lines().filter(|l| !l.starts_with("DTSTAMP")) { l.hash(&mut h); }
    h.finish()
}

/// The file name of an entry in the calendar collection.
pub fn file_of(uid: &str) -> String {
    let safe: String = uid.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    format!("{safe}.ics")
}

/* ----- HTTP ----- */

pub struct Client {
    http: reqwest::blocking::Client,
    user: String,
    pass: String,
}

impl Client {
    pub fn new(user: &str, pass: &str) -> Result<Client, String> {
        let http = reqwest::blocking::Client::builder()
            .redirect(reqwest::redirect::Policy::none())   // followed by hand, keeping the sign-in on the new server
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Plan Studio")
            .build().map_err(|e| e.to_string())?;
        Ok(Client { http, user: user.to_string(), pass: pass.to_string() })
    }

    /// One request; redirects are followed (up to 5). Returns (status, final address, body).
    pub fn send(&self, method: &str, url: &str, depth: Option<&str>, body: Option<(&str, String)>) -> Result<(u16, String, String), String> {
        let mut url = url.to_string();
        for _ in 0..5 {
            let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
            let mut req = self.http.request(m, &url).basic_auth(&self.user, Some(&self.pass));
            if let Some(d) = depth { req = req.header("Depth", d); }
            if let Some((ct, b)) = &body { req = req.header("Content-Type", *ct).body(b.clone()); }
            let res = req.send().map_err(|e| e.to_string())?;
            let status = res.status().as_u16();
            if (300..400).contains(&status) {
                if let Some(loc) = res.headers().get("location").and_then(|v| v.to_str().ok()) { url = join(&url, loc); continue; }
            }
            let text = res.text().unwrap_or_default();
            return Ok((status, url, text));
        }
        Err("too many redirects".into())
    }

    fn propfind(&self, url: &str, depth: &str, props: &str) -> Result<(String, String), String> {
        let body = format!(r#"<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop>{props}</d:prop></d:propfind>"#);
        let (status, at, text) = self.send("PROPFIND", url, Some(depth), Some(("application/xml; charset=utf-8", body)))?;
        match status {
            207 | 200 => Ok((at, text)),
            401 | 403 => Err("signin".into()),
            s => Err(format!("HTTP {s}")),
        }
    }
}

/// Finds (or makes) the calendar "Plan Studio" in the account below `root`; returns its address.
pub fn connect(c: &Client, root: &str) -> Result<String, String> {
    let (at, xml) = c.propfind(root, "0", "<d:current-user-principal/>")?;
    let principal = first(&xml, "current-user-principal").and_then(|p| first(p, "href")).map(text).ok_or("no principal")?;
    let principal = join(&at, &principal);
    let (at, xml) = c.propfind(&principal, "0", "<c:calendar-home-set/>")?;
    let home = first(&xml, "calendar-home-set").and_then(|p| first(p, "href")).map(text).ok_or("no calendar home")?;
    let home = join(&at, &home);
    let (at, xml) = c.propfind(&home, "1", "<d:displayname/><d:resourcetype/>")?;
    for r in elements(&xml, "response") {
        let is_cal = first(r, "resourcetype").is_some_and(|t| !elements(t, "calendar").is_empty());
        let name = first(r, "displayname").map(text).unwrap_or_default();
        if is_cal && name == CAL_NAME {
            if let Some(h) = first(r, "href") { return Ok(join(&at, &text(h))); }
        }
    }
    let url = join(&home, "plan-studio/");
    let body = format!(r#"<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>{CAL_NAME}</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>"#);
    let (status, _, _) = c.send("MKCALENDAR", &url, None, Some(("application/xml; charset=utf-8", body)))?;
    match status {
        200..=299 | 405 => Ok(url),   // 405: it is there already (made by an earlier try)
        401 | 403 => Err("signin".into()),
        s => Err(format!("HTTP {s}")),
    }
}

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct SyncResult {
    pub uploaded: usize,
    pub deleted: usize,
    pub total: usize,
}

/// Brings the calendar up to date: uploads new and changed entries, deletes removed ones.
pub fn sync(c: &Client, account: &mut Account, header: &str, events: &[(String, String)]) -> Result<SyncResult, String> {
    let mut res = SyncResult { total: events.len(), ..Default::default() };
    let mut now: BTreeMap<String, u64> = BTreeMap::new();
    for (uid, ev) in events {
        let h = content_hash(ev);
        now.insert(uid.clone(), h);
        if account.synced.get(uid) == Some(&h) { continue; }
        let body = format!("{header}{ev}END:VCALENDAR\r\n");
        let (status, _, _) = c.send("PUT", &join(&account.calendar, &file_of(uid)), None, Some(("text/calendar; charset=utf-8", body)))?;
        match status {
            200..=299 => { account.synced.insert(uid.clone(), h); res.uploaded += 1; }
            401 | 403 => return Err("signin".into()),
            s => return Err(format!("HTTP {s}")),
        }
    }
    let gone: Vec<String> = account.synced.keys().filter(|k| !now.contains_key(*k)).cloned().collect();
    for uid in gone {
        let (status, _, _) = c.send("DELETE", &join(&account.calendar, &file_of(&uid)), None, None)?;
        match status {
            200..=299 | 404 | 410 => { account.synced.remove(&uid); res.deleted += 1; }
            401 | 403 => return Err("signin".into()),
            s => return Err(format!("HTTP {s}")),
        }
    }
    Ok(res)
}

#[derive(Serialize)]
pub struct Status {
    pub connected: bool,
    pub user: String,
    pub last_sync: u64,
}

#[tauri::command]
pub fn icloud_status(app: AppHandle) -> Status {
    match load(&app) {
        Some(a) => Status { connected: !a.calendar.is_empty(), user: a.user, last_sync: a.last_sync },
        None => Status { connected: false, user: String::new(), last_sync: 0 },
    }
}

/// Signs in, finds or makes the calendar "Plan Studio" and keeps the account on this computer.
#[tauri::command]
pub async fn icloud_connect(app: AppHandle, user: String, pass: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (user, pass) = (user.trim().to_string(), pass.trim().replace(' ', ""));
        let c = Client::new(&user, &pass)?;
        let calendar = connect(&c, ROOT)?;
        save(&app, &Account { user, pass, calendar, ..Default::default() })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn icloud_sync(app: AppHandle, state: State<'_, Sync>, plan: serde_json::Value, lang: String, tasks: bool) -> Result<SyncResult, String> {
    use std::sync::atomic::Ordering;
    if state.0.swap(true, Ordering::SeqCst) { return Err("busy".into()); }
    let res = sync_now(&app, plan, lang, tasks).await;
    state.0.store(false, Ordering::SeqCst);
    res
}

async fn sync_now(app: &AppHandle, plan: serde_json::Value, lang: String, tasks: bool) -> Result<SyncResult, String> {
    let mut account = load(app).ok_or("not connected")?;
    let (account, res) = tauri::async_runtime::spawn_blocking(move || {
        let c = Client::new(&account.user, &account.pass)?;
        let events = crate::ics::events(&plan, &lang, tasks, &crate::ics::utc_stamp());
        let res = sync(&c, &mut account, &crate::ics::header(&lang), &events);
        // What got through is remembered even when something failed on the way.
        account.last_sync = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        Ok::<_, String>((account, res))
    }).await.map_err(|e| e.to_string())??;
    save(app, &account)?;
    res
}

/// Forgets the account on this computer (the calendar stays in iCloud; delete it there if you like).
#[tauri::command]
pub fn icloud_disconnect(app: AppHandle) -> Result<(), String> {
    let p = store(&app)?;
    if p.exists() { std::fs::remove_file(p).map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::sync::Mutex;

    #[test]
    fn little_xml_and_addresses() {
        let xml = r#"<?xml version="1.0"?><multistatus xmlns="DAV:"><response><href>/1234/principal/</href><propstat><prop>
            <current-user-principal><href xmlns="DAV:">/1234/principal/</href></current-user-principal></prop></propstat></response></multistatus>"#;
        assert_eq!(first(first(xml, "current-user-principal").unwrap(), "href").map(text).as_deref(), Some("/1234/principal/"));
        let prefixed = r#"<D:multistatus xmlns:D="DAV:"><D:response><D:href>/a/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar xmlns:C="urn:ietf:params:xml:ns:caldav"/></D:resourcetype><D:displayname>Plan &amp; Studio</D:displayname></D:prop></D:propstat></D:response></D:multistatus>"#;
        let r = elements(prefixed, "response");
        assert_eq!(r.len(), 1);
        assert_eq!(elements(first(r[0], "resourcetype").unwrap(), "calendar").len(), 1);
        assert_eq!(text(first(r[0], "displayname").unwrap()), "Plan & Studio");
        assert_eq!(join("https://caldav.icloud.com/", "/1234/principal/"), "https://caldav.icloud.com/1234/principal/");
        assert_eq!(join("https://p1.icloud.com/1/calendars/", "plan-studio/"), "https://p1.icloud.com/1/calendars/plan-studio/");
        assert_eq!(join("https://a/b", "https://p2/x/"), "https://p2/x/");
        assert_eq!(file_of("e1-x@plan-studio"), "e1-x_plan-studio.ics");
        assert_eq!(content_hash("BEGIN:VEVENT\nDTSTAMP:1\nSUMMARY:x"), content_hash("BEGIN:VEVENT\nDTSTAMP:2\nSUMMARY:x"));
        assert_ne!(content_hash("SUMMARY:x"), content_hash("SUMMARY:y"));
    }

    /// A tiny CalDAV server that behaves like iCloud: the first host redirects to the user's partition, which has
    /// the principal, the calendar home and makes calendars; PUT / DELETE are recorded.
    fn fake_server(log: std::sync::Arc<Mutex<Vec<String>>>) -> String {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://127.0.0.1:{}", l.local_addr().unwrap().port());
        let b = base.clone();
        std::thread::spawn(move || {
            let mut made = false;
            for s in l.incoming().flatten() {
                let mut r = BufReader::new(s.try_clone().unwrap());
                let mut line = String::new(); r.read_line(&mut line).unwrap();
                let (mut len, mut auth) = (0usize, false);
                loop {
                    let mut h = String::new(); r.read_line(&mut h).unwrap();
                    if h.trim().is_empty() { break; }
                    let hl = h.to_lowercase();
                    if let Some(v) = hl.strip_prefix("content-length:") { len = v.trim().parse().unwrap(); }
                    // user:secret
                    if hl.starts_with("authorization: basic dxnlcjpzzwnyzxq=") { auth = true; }
                }
                let mut body = vec![0; len]; r.read_exact(&mut body).unwrap();
                let mut p = line.split_whitespace();
                let (m, path) = (p.next().unwrap().to_string(), p.next().unwrap().to_string());
                log.lock().unwrap().push(format!("{m} {path}"));
                let ms = |x: &str| (207, format!(r#"<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">{x}</d:multistatus>"#));
                let (code, text, loc): (u16, String, Option<String>) = if !auth { (401, String::new(), None) } else {
                    match (m.as_str(), path.as_str()) {
                        ("PROPFIND", "/") => (301, String::new(), Some(format!("{b}/p07/"))),
                        ("PROPFIND", "/p07/") => { let (c, t) = ms("<d:response><d:href>/p07/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/p07/42/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>"); (c, t, None) }
                        ("PROPFIND", "/p07/42/principal/") => { let (c, t) = ms(&format!("<d:response><d:href>/p07/42/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>{b}/p07/42/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>")); (c, t, None) }
                        ("PROPFIND", "/p07/42/calendars/") => {
                            let mine = if made { "<d:response><d:href>/p07/42/calendars/plan-studio/</d:href><d:propstat><d:prop><d:displayname>Plan Studio</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop></d:propstat></d:response>" } else { "" };
                            let (c, t) = ms(&format!("<d:response><d:href>/p07/42/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Privat</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop></d:propstat></d:response>{mine}")); (c, t, None)
                        }
                        ("MKCALENDAR", "/p07/42/calendars/plan-studio/") => { made = true; (201, String::new(), None) }
                        ("PUT", _) | ("DELETE", _) if path.starts_with("/p07/42/calendars/plan-studio/") => (if m == "PUT" { 201 } else { 204 }, String::new(), None),
                        _ => (404, String::new(), None),
                    }
                };
                let mut w = s;
                let loc = loc.map(|l| format!("Location: {l}\r\n")).unwrap_or_default();
                let _ = write!(w, "HTTP/1.1 {code} X\r\n{loc}Content-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
            }
        });
        format!("{base}/")
    }

    #[test]
    fn connects_syncs_and_deletes_like_icloud() {
        let log = std::sync::Arc::new(Mutex::new(Vec::new()));
        let root = fake_server(log.clone());
        assert_eq!(connect(&Client::new("user", "wrong").unwrap(), &root), Err("signin".into()));
        let c = Client::new("user", "secret").unwrap();
        let cal = connect(&c, &root).unwrap();
        assert!(cal.ends_with("/p07/42/calendars/plan-studio/"), "{cal}");
        assert!(log.lock().unwrap().iter().any(|l| l == "MKCALENDAR /p07/42/calendars/plan-studio/"));
        // A second connect finds the calendar instead of making it again.
        log.lock().unwrap().clear();
        assert_eq!(connect(&c, &root).unwrap(), cal);
        assert!(!log.lock().unwrap().iter().any(|l| l.starts_with("MKCALENDAR")));

        let plan = serde_json::json!({"events": [{"id": "e1", "type": "exam", "title": "Mathe", "date": "2026-11-03"},
            {"id": "e2", "type": "test", "title": "Bio", "date": "2026-11-05", "time": "08:00"}], "tasks": []});
        let mut acc = Account { user: "user".into(), pass: "secret".into(), calendar: cal.clone(), ..Default::default() };
        let header = crate::ics::header("de");
        let ev = crate::ics::events(&plan, "de", false, "20261023T120000Z");
        log.lock().unwrap().clear();
        assert_eq!(sync(&c, &mut acc, &header, &ev).unwrap(), SyncResult { uploaded: 2, deleted: 0, total: 2 });
        assert_eq!(log.lock().unwrap().iter().filter(|l| l.starts_with("PUT")).count(), 2);
        // Nothing changed (only the time stamp): nothing is uploaded.
        let again = crate::ics::events(&plan, "de", false, "20261024T090000Z");
        assert_eq!(sync(&c, &mut acc, &header, &again).unwrap(), SyncResult { uploaded: 0, deleted: 0, total: 2 });
        // One changed, one removed.
        let plan2 = serde_json::json!({"events": [{"id": "e1", "type": "exam", "title": "Mathe – Kapitel 4", "date": "2026-11-03"}], "tasks": []});
        log.lock().unwrap().clear();
        let r = sync(&c, &mut acc, &header, &crate::ics::events(&plan2, "de", false, "x")).unwrap();
        assert_eq!(r, SyncResult { uploaded: 1, deleted: 1, total: 1 });
        let l = log.lock().unwrap().clone();
        assert!(l.contains(&"PUT /p07/42/calendars/plan-studio/e1_plan-studio.ics".to_string()) && l.contains(&"DELETE /p07/42/calendars/plan-studio/e2_plan-studio.ics".to_string()), "{l:?}");
        assert_eq!(acc.synced.len(), 1);
    }
}

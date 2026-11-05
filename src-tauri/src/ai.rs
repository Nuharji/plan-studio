//! Plan Studio's own AI for school: Claude (Claude Code, `claude -p`, with the person's own sign-in) turns homework in
//! your own words into entries, makes a study plan, flashcards, a study sheet, a quiz or explains a file. Claude may only
//! read here — the files of the school folder and nothing else — and has no internet; what comes back is taken over
//! by the app itself (entries, cards, a new Markdown file). No key or password is stored.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

static RUNNING: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

fn command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

fn home() -> PathBuf { std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default() }

fn on_path(name: &str) -> Option<PathBuf> {
    let found = if cfg!(windows) {
        command("where").arg(name).output().ok()
    } else {
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        command(sh).args(["-lc", &format!("command -v {name}")]).output().ok()
    }?;
    String::from_utf8_lossy(&found.stdout).lines().map(str::trim).map(PathBuf::from).find(|p| p.is_file())
}

/// Where `claude` is: the path set in the settings, else the usual places (installer, npm, Homebrew, the Claude
/// desktop app's own copy), else what the login shell finds. The same search as in Agent Studio.
pub fn find_claude(own: &str) -> Option<PathBuf> {
    if !own.trim().is_empty() { return Some(PathBuf::from(own.trim())).filter(|p| p.is_file()); }
    let home = home();
    let mut c: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        c.push(home.join(".local").join("bin").join("claude.exe"));
        if let Some(a) = std::env::var_os("APPDATA") { c.push(PathBuf::from(a).join("npm").join("claude.cmd")); }
    } else {
        c.extend([home.join(".local/bin/claude"), home.join(".claude/local/claude"), "/opt/homebrew/bin/claude".into(), "/usr/local/bin/claude".into(),
            home.join(".npm-global/bin/claude"), home.join(".bun/bin/claude")]);
    }
    if let Some(p) = c.into_iter().find(|p| p.is_file()) { return Some(p); }
    #[cfg(target_os = "macos")]
    if let Some(p) = desktop_copy(&home.join("Library/Application Support/Claude/claude-code")) { return Some(p); }
    on_path("claude")
}

#[cfg(target_os = "macos")]
fn desktop_copy(dir: &Path) -> Option<PathBuf> {
    let ver = |s: &str| s.split('.').map(|x| x.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    let mut vs: Vec<PathBuf> = std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    vs.sort_by_key(|p| ver(&p.file_name().unwrap_or_default().to_string_lossy()));
    vs.iter().rev().find_map(|v| std::fs::read_dir(v).ok()?.flatten().map(|e| e.path().join("claude.app/Contents/MacOS/claude")).find(|p| p.is_file()))
}

/// Removes what a surrounding Claude Code session put into the environment, so the run uses its own sign-in.
fn clean_env(c: &mut Command) {
    for (k, _) in std::env::vars_os() {
        let k = k.to_string_lossy();
        if k == "CLAUDECODE" || k.starts_with("CLAUDE_CODE_") || k.starts_with("CLAUDE_AGENT_SDK") || k == "CLAUDE_PID" || k == "CLAUDE_EFFORT" {
            c.env_remove(k.as_ref());
        }
    }
}

/// What Claude is told in every request: a school helper that only reads and answers in the asked format.
pub fn system_prompt(de: bool) -> String {
    if de {
        "Du hilfst einer Schülerin oder einem Schüler in Plan Studio (Schulplaner) — ohne Fenster, niemand kann dir während der Antwort antworten. \
Du darfst nur Dateien lesen (die Dateien und Ordner, die genannt werden), nichts ändern und nicht ins Internet. \
Plan Studio übernimmt deine Antwort selbst (Einträge, Karteikarten, eine neue Datei). Halte dich genau an das verlangte Format, \
erkläre altersgerecht und richtig, und antworte auf Deutsch.".into()
    } else {
        "You help a student in Plan Studio (a school planner) — without a window, nobody can answer you while you answer. \
You may only read files (the files and folders named), change nothing and not use the internet. \
Plan Studio takes over your answer itself (entries, flashcards, a new file). Keep exactly to the format asked for, \
explain clearly and correctly for a student, and answer in English.".into()
    }
}

/// The arguments of `claude` for one request (the prompt goes to its input).
pub fn args(de: bool, extra_dirs: &[String], model: &str) -> Vec<String> {
    let settings = json!({"permissions": {"allow": ["Read", "Glob", "Grep", "LS"], "deny": ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"], "additionalDirectories": extra_dirs}});
    let mut a: Vec<String> = ["-p", "--output-format", "json", "--permission-mode", "dontAsk", "--setting-sources", ""].map(String::from).to_vec();
    a.extend(["--settings".into(), settings.to_string(), "--append-system-prompt".into(), system_prompt(de)]);
    if !model.trim().is_empty() { a.extend(["--model".into(), model.trim().into()]); }
    a
}

/// Claude's answer from its JSON output: (text, is it an error).
pub fn result_of(out: &str) -> (String, bool) {
    // The JSON result is the last line that parses (some versions print warnings before it).
    for line in out.lines().rev() {
        if let Ok(j) = serde_json::from_str::<Value>(line.trim()) {
            if j.get("type").and_then(Value::as_str) == Some("result") || j.get("result").is_some() {
                let text = j.get("result").and_then(Value::as_str).unwrap_or("").trim().to_string();
                let err = j.get("is_error").and_then(Value::as_bool).unwrap_or(false) || j.get("subtype").and_then(Value::as_str).is_some_and(|s| s.starts_with("error"));
                return (text, err);
            }
        }
    }
    (out.trim().chars().take(2000).collect(), true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    path: Option<String>,
    version: String,
    logged_in: bool,
    who: String,
}

/// Whether Claude Code is there and someone is signed in.
#[tauri::command]
pub async fn ai_status(own: String) -> Status {
    let Some(p) = find_claude(&own) else { return Status { path: None, version: String::new(), logged_in: false, who: String::new() } };
    let run = |args: &[&str]| {
        let mut c = command(&p);
        c.args(args);
        clean_env(&mut c);
        c.output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default()
    };
    let version = run(&["--version"]);
    let st: Value = serde_json::from_str(&run(&["auth", "status"])).unwrap_or(Value::Null);
    let who = ["email", "account", "orgName"].iter().find_map(|k| st.get(*k).and_then(Value::as_str)).unwrap_or("").to_string();
    Status { path: Some(p.to_string_lossy().into_owned()), version, logged_in: st.get("loggedIn").and_then(Value::as_bool).unwrap_or(false), who }
}

/// Signs in to Claude (`claude auth login` opens the browser); the end comes as "ai-login-done".
#[tauri::command]
pub fn ai_login(app: AppHandle, own: String) -> Result<(), String> {
    let p = find_claude(&own).ok_or("Claude Code not found")?;
    let mut c = command(&p);
    c.args(["auth", "login"]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    clean_env(&mut c);
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        let _ = app.emit("ai-login-done", ok);
    });
    Ok(())
}

/// Asks Claude; the answer comes as an "ai-done" event {id, ok, text}. `dir` is where Claude starts (the school
/// folder or a file's folder), `files` are named in the prompt by the UI and their folders are allowed to read.
#[tauri::command]
pub fn ai_ask(app: AppHandle, id: String, prompt: String, dir: String, files: Vec<String>, own: String, model: String, lang: String) -> Result<(), String> {
    let p = find_claude(&own).ok_or("Claude Code not found")?;
    let cwd = if !dir.trim().is_empty() && Path::new(&dir).is_dir() { PathBuf::from(&dir) } else {
        let d = app.path().app_data_dir().map_err(|e| e.to_string())?.join("ai");
        std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
        d
    };
    let mut extra: Vec<String> = Vec::new();
    for f in &files {
        if let Some(parent) = Path::new(f).parent() {
            let s = parent.to_string_lossy().into_owned();
            if !parent.starts_with(&cwd) && !extra.contains(&s) { extra.push(s); }
        }
    }
    let mut c = command(&p);
    c.args(args(lang == "de", &extra, &model)).current_dir(&cwd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    clean_env(&mut c);
    let mut child = c.spawn().map_err(|e| e.to_string())?;
    if let Some(mut i) = child.stdin.take() { let _ = i.write_all(prompt.as_bytes()); }
    RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).insert(id.clone(), child.id());
    std::thread::spawn(move || {
        let out = child.wait_with_output();
        let stopped = RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).remove(&id).is_none();
        let ev = match out {
            _ if stopped => json!({"id": id, "ok": false, "stopped": true, "text": ""}),
            Ok(o) => {
                let (text, err) = result_of(&String::from_utf8_lossy(&o.stdout));
                let err = err || (!o.status.success() && text.is_empty());
                let text = if err && text.is_empty() { String::from_utf8_lossy(&o.stderr).trim().chars().take(1500).collect() } else { text };
                json!({"id": id, "ok": !err, "text": text})
            }
            Err(e) => json!({"id": id, "ok": false, "text": e.to_string()}),
        };
        let _ = app.emit("ai-done", ev);
    });
    Ok(())
}

/// Stops a request.
#[tauri::command]
pub fn ai_stop(id: String) -> bool {
    let Some(pid) = RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).remove(&id) else { return false };
    let _ = if cfg!(windows) { command("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).output() } else { command("kill").arg(pid.to_string()).output() };
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claude_may_only_read() {
        let a = args(true, &["/x/Mathe".into()], "sonnet");
        assert_eq!(&a[..5], &["-p", "--output-format", "json", "--permission-mode", "dontAsk"]);
        assert_eq!(a[a.iter().position(|x| x == "--setting-sources").unwrap() + 1], "");
        let s: Value = serde_json::from_str(&a[a.iter().position(|x| x == "--settings").unwrap() + 1]).unwrap();
        assert_eq!(s["permissions"]["allow"], json!(["Read", "Glob", "Grep", "LS"]));
        assert!(s["permissions"]["deny"].as_array().unwrap().iter().any(|x| x == "Write") && s["permissions"]["deny"].as_array().unwrap().iter().any(|x| x == "WebFetch"));
        assert_eq!(s["permissions"]["additionalDirectories"], json!(["/x/Mathe"]));
        assert!(a.windows(2).any(|w| w == ["--model", "sonnet"]));
        assert!(a[a.iter().position(|x| x == "--append-system-prompt").unwrap() + 1].contains("nur Dateien lesen"));
        assert!(!args(false, &[], "").contains(&"--model".to_string()));
    }

    #[test]
    fn reads_the_answer() {
        assert_eq!(result_of(r#"{"type":"result","subtype":"success","is_error":false,"result":" Fertig. "}"#), ("Fertig.".into(), false));
        assert_eq!(result_of("warning: x\n{\"type\":\"result\",\"subtype\":\"error_max_turns\",\"result\":\"\"}\n"), ("".into(), true));
        assert_eq!(result_of("not json"), ("not json".into(), true));
    }
}

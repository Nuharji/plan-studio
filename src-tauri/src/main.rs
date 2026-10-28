// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod caldav;
mod feed;
mod agentlink;
mod shared;
mod store;
mod ical;
mod ics;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

/// A plan file handed to the UI (import / "Open with").
#[derive(Serialize, Clone)]
struct PlanFile {
    path: String,
    name: String,
    content: String,
}

/// Files requested before the UI was ready (command-line args, macOS "Open with").
struct Pending {
    ready: bool,
    paths: Vec<PathBuf>,
}

fn load(path: &Path) -> Result<PlanFile, String> {
    let bytes = fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let content = String::from_utf8_lossy(bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&bytes)).into_owned();
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(PlanFile { path: path.to_string_lossy().into_owned(), name, content })
}

/// The app's texts in English and German (i18n/*.json, built into the program).
#[tauri::command]
fn texts() -> serde_json::Value {
    let parse = |s: &str| serde_json::from_str::<serde_json::Value>(s).unwrap_or_default();
    serde_json::json!({"en": parse(include_str!("../i18n/en.json")), "de": parse(include_str!("../i18n/de.json"))})
}

/// Where the plan lives (store.rs): a portable copy next to the program, else the sync folder of Studio Hub, else the
/// app's data folder (Windows: %APPDATA%\com.planstudio.app, macOS: ~/Library/Application Support/com.planstudio.app).
/// The place is decided when the plan is loaded and kept until the app is closed: a sync folder chosen meanwhile in
/// Studio Hub counts from the next start (then the plan is brought there safely, see store::prepare_sync).
static PLACE: Mutex<Option<store::Place>> = Mutex::new(None);
fn plan_place(app: &AppHandle) -> Result<store::Place, String> {
    if let Some(p) = PLACE.lock().unwrap().clone() { return Ok(p); }
    find_place(app)
}
fn find_place(app: &AppHandle) -> Result<store::Place, String> {
    let portable = std::env::current_exe().ok().and_then(|e| e.parent().map(|d| d.join("plan.json")));
    let local = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&local).map_err(|e| e.to_string())?;
    Ok(store::place(portable, shared::sync_dir(app), &local))
}

#[derive(Serialize)]
struct Loaded {
    content: Option<String>,
    stamp: u64,
    /// "portable", "sync" or "local", and the folder.
    place: &'static str,
    folder: String,
    /// What happened when the sync folder was used the first time ("moved", "taken|<copy>").
    note: Option<String>,
}

/// The saved plan (JSON text; None the first time), with where it is and its last change.
#[tauri::command]
fn plan_load(app: AppHandle) -> Result<Loaded, String> {
    let pl = plan_place(&app)?;
    *PLACE.lock().unwrap() = Some(pl.clone());
    let note = if pl.kind == "sync" { store::prepare_sync(&pl.path, &app.path().app_data_dir().map_err(|e| e.to_string())?)? } else { None };
    let content = if pl.path.exists() { Some(fs::read_to_string(&pl.path).map_err(|e| format!("{}: {e}", pl.path.display()))?) } else { None };
    let folder = pl.path.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Loaded { content, stamp: store::stamp(&pl.path), place: pl.kind, folder, note })
}

/// The last change of the plan file (to notice changes made on another computer).
#[tauri::command]
fn plan_stamp(app: AppHandle) -> u64 {
    plan_place(&app).map(|p| store::stamp(&p.path)).unwrap_or(0)
}

/// Saves the plan safely: written to a temporary file first, the previous version is kept as plan.bak.
pub fn save_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if path.exists() { let _ = fs::copy(path, path.with_extension("bak")); }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

#[derive(Serialize)]
struct Saved {
    stamp: u64,
    /// The other computer's version, kept as this file next to the plan.
    conflict: Option<String>,
}

#[tauri::command]
fn plan_save(app: AppHandle, content: String, stamp: Option<u64>) -> Result<Saved, String> {
    let (stamp, conflict) = store::save_checked(&plan_place(&app)?.path, &content, stamp)?;
    Ok(Saved { stamp, conflict })
}

/// Saves text after a save dialog (backup .plan, calendar .ics); returns the path (None = cancelled).
#[tauri::command]
async fn export_file(app: AppHandle, suggested_name: String, filter_name: String, ext: String, content: String) -> Result<Option<String>, String> {
    let Some(f) = crate::shared::file_dialog(&app).set_file_name(&suggested_name).add_filter(&filter_name, &[ext.as_str()]).blocking_save_file() else {
        return Ok(None);
    };
    let target = f.into_path().map_err(|e| e.to_string())?;
    fs::write(&target, content).map_err(|e| format!("{}: {e}", target.display()))?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

/// Picks a plan file to import (None = cancelled).
#[tauri::command]
async fn import_file(app: AppHandle) -> Result<Option<PlanFile>, String> {
    let Some(f) = crate::shared::file_dialog(&app).add_filter("Plan Studio", &["plan", "json"]).blocking_pick_file() else { return Ok(None) };
    load(&f.into_path().map_err(|e| e.to_string())?).map(Some)
}

/// The dates as an iCalendar file (calendar apps import it).
#[tauri::command]
fn plan_ics(plan: serde_json::Value, lang: String, tasks: bool) -> String {
    ics::calendar(&plan, &lang, tasks, &ics::utc_stamp())
}

#[tauri::command]
async fn confirm(app: AppHandle, title: String, message: String, ok_label: String, cancel_label: String) -> bool {
    app.dialog().message(message).title(title).kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(ok_label, cancel_label)).blocking_show()
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    // webcal:// only for the calendar subscription of this computer (feed.rs).
    let ok = ["https://", "http://", "mailto:"].iter().any(|p| url.starts_with(p)) || url.starts_with("webcal://127.0.0.1:");
    if !ok { return Err(format!("Refusing to open {url}")); }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn print_page(window: WebviewWindow) -> Result<(), String> {
    window.print().map_err(|e| e.to_string())
}

#[tauri::command]
fn initial_files(state: State<Mutex<Pending>>) -> Vec<PlanFile> {
    let mut pending = state.lock().unwrap();
    pending.ready = true;
    pending.paths.drain(..).filter_map(|p| load(&p).ok()).collect()
}

/// One entry of a native context menu; an entry without `id` is a separator.
#[derive(Deserialize)]
struct MenuEntry {
    id: Option<String>,
    label: Option<String>,
    enabled: Option<bool>,
    checked: Option<bool>,
    accel: Option<String>,
}

/// Shows a native (OS) context menu at the mouse position. The chosen item's id
/// reaches the UI as a "context-menu" event (see `on_menu_event` in `main`).
#[tauri::command]
fn context_menu(app: AppHandle, window: tauri::Window, items: Vec<MenuEntry>) -> Result<(), String> {
    use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
    let mut menu = MenuBuilder::new(&app);
    for entry in items {
        let Some(id) = entry.id else {
            menu = menu.separator();
            continue;
        };
        let label = entry.label.unwrap_or_default();
        let enabled = entry.enabled.unwrap_or(true);
        if let Some(checked) = entry.checked {
            let item = CheckMenuItemBuilder::with_id(id, label).enabled(enabled).checked(checked).build(&app).map_err(|e| e.to_string())?;
            menu = menu.item(&item);
            continue;
        }
        let plain = || MenuItemBuilder::with_id(id.clone(), label.clone()).enabled(enabled);
        // The shortcut is only shown as a hint; leave it out if the OS can't display it.
        let item = match entry.accel.as_deref() {
            Some(a) => plain().accelerator(a).build(&app).or_else(|_| plain().build(&app)),
            None => plain().build(&app),
        }
        .map_err(|e| e.to_string())?;
        menu = menu.item(&item);
    }
    let menu = menu.build().map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// A system notification (study reminder); the text is cut to a sensible length.
#[tauri::command]
fn notify(app: AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    let (title, body) = notice_text(&title, &body);
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

fn notice_text(title: &str, body: &str) -> (String, String) {
    (title.trim().chars().take(80).collect(), body.trim().chars().take(240).collect())
}

#[tauri::command]
fn clipboard_read(app: AppHandle) -> String {
    app.clipboard().read_text().unwrap_or_default()
}

#[tauri::command]
fn clipboard_write(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

fn main() {
    let args: Vec<PathBuf> = std::env::args_os().skip(1).map(PathBuf::from).filter(|p| p.is_file()).collect();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .on_menu_event(|app, event| {
            let _ = app.emit("context-menu", event.id().as_ref());
        })
        .manage(Mutex::new(Pending { ready: false, paths: args }))
        .manage(feed::Feed::default())
        .manage(caldav::Sync::default())
        .invoke_handler(tauri::generate_handler![
            shared::shared_get,
            shared::shared_set,
            agentlink::agent_send,
            agentlink::agent_poll,
            agentlink::agent_ack,
            agentlink::agent_open,
            agentlink::agent_open_file,
            texts,
            plan_load,
            plan_save,
            plan_stamp,
            export_file,
            import_file,
            plan_ics,
            ical::calendar_fetch,
            feed::feed_start,
            feed::feed_update,
            caldav::icloud_status,
            caldav::icloud_connect,
            caldav::icloud_sync,
            caldav::icloud_disconnect,
            confirm,
            open_url,
            print_page,
            initial_files,
            context_menu,
            clipboard_read,
            clipboard_write,
            notify
        ])
        .build(tauri::generate_context!())
        .expect("error while building Plan Studio");

    app.run(|_app, _event| {
        // macOS delivers "Open with" / double-clicked files as an event instead of argv.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths: Vec<PathBuf> = urls.into_iter().filter_map(|u| u.to_file_path().ok()).collect();
            let state = _app.state::<Mutex<Pending>>();
            let mut pending = state.lock().unwrap();
            if pending.ready {
                let files: Vec<PlanFile> = paths.iter().filter_map(|p| load(p).ok()).collect();
                let _ = _app.emit("open-files", files);
            } else {
                pending.paths.extend(paths);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn texts_parse_and_match() {
        let t = texts();
        let (en, de) = (t["en"].as_object().unwrap(), t["de"].as_object().unwrap());
        assert!(en.len() > 80);
        assert!(en.keys().all(|k| de.contains_key(k)), "every English text has a German one");
        assert!(de.keys().all(|k| en.contains_key(k)), "every German text has an English one");
    }

    #[test]
    fn notice_text_is_trimmed_and_cut() {
        let (t, b) = notice_text("  12 Karteikarten fällig ", &"ä".repeat(300));
        assert_eq!(t, "12 Karteikarten fällig");
        assert_eq!(b.chars().count(), 240);
    }

    #[test]
    fn atomic_save_keeps_backup() {
        let dir = std::env::temp_dir().join("plan-studio-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("plan.json");
        save_atomic(&p, "{\"v\":1}").unwrap();
        save_atomic(&p, "{\"v\":2}").unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"v\":2}");
        assert_eq!(fs::read_to_string(dir.join("plan.bak")).unwrap(), "{\"v\":1}");
        assert!(!dir.join("plan.json.tmp").exists());
    }
}

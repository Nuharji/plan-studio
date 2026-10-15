// Hide the console window in release builds on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod shared;
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

/// Where the plan lives: the app's data folder (Windows: %APPDATA%\com.planstudio.app, macOS: ~/Library/Application
/// Support/com.planstudio.app). A portable copy (plan.json next to the program) wins, so a USB stick keeps its plan.
fn plan_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)) {
        let portable = dir.join("plan.json");
        if portable.exists() { return Ok(portable); }
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("plan.json"))
}

/// The saved plan (JSON text), or None the first time.
#[tauri::command]
fn plan_load(app: AppHandle) -> Result<Option<String>, String> {
    let p = plan_path(&app)?;
    if !p.exists() { return Ok(None); }
    fs::read_to_string(&p).map(Some).map_err(|e| format!("{}: {e}", p.display()))
}

/// Saves the plan safely: written to a temporary file first, the previous version is kept as plan.bak.
pub fn save_atomic(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("{}: {e}", tmp.display()))?;
    if path.exists() { let _ = fs::copy(path, path.with_extension("bak")); }
    fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

#[tauri::command]
fn plan_save(app: AppHandle, content: String) -> Result<(), String> {
    save_atomic(&plan_path(&app)?, &content)
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
    if !["https://", "http://", "mailto:"].iter().any(|p| url.starts_with(p)) { return Err(format!("Refusing to open {url}")); }
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
        .on_menu_event(|app, event| {
            let _ = app.emit("context-menu", event.id().as_ref());
        })
        .manage(Mutex::new(Pending { ready: false, paths: args }))
        .invoke_handler(tauri::generate_handler![
            shared::shared_get,
            shared::shared_set,
            texts,
            plan_load,
            plan_save,
            export_file,
            import_file,
            plan_ics,
            ical::calendar_fetch,
            confirm,
            open_url,
            print_page,
            initial_files,
            context_menu,
            clipboard_read,
            clipboard_write
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

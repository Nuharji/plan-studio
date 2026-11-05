//! The file management of Plan Studio: one school folder (chosen in the app) with folders per subject or as you like.
//! Browse, search, new folder, rename, move, copy files in, into the system's trash and back, open. Every path must lie
//! inside the school folder, and nothing is overwritten (a name that is taken gets " (2)" and so on).

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    /// The path inside the school folder, with "/" (also on Windows) — the key for tags in the plan.
    pub rel: String,
    pub is_dir: bool,
    pub size: u64,
    /// Milliseconds since 1970.
    pub modified: u64,
    pub ext: String,
    /// For a folder: how many entries it has (hidden ones not counted).
    pub count: usize,
}

/// A path without "." / ".." parts (the file need not exist).
fn clean(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::ParentDir => { out.pop(); }
            Component::CurDir => {}
            c => out.push(c.as_os_str()),
        }
    }
    out
}

/// `path` as a path inside `root`, or an error.
pub fn inside(root: &str, path: &str) -> Result<PathBuf, String> {
    let r = clean(Path::new(root.trim()));
    if root.trim().is_empty() || !r.is_absolute() { return Err("No school folder chosen".into()); }
    let p = clean(Path::new(path));
    let p = if p.is_absolute() { p } else { clean(&r.join(path)) };
    if p.starts_with(&r) { Ok(p) } else { Err(format!("Not in the school folder: {path}")) }
}

fn rel_of(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).map(|x| x.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/")).unwrap_or_default()
}

const HIDDEN: [&str; 4] = ["Thumbs.db", "desktop.ini", "$RECYCLE.BIN", "node_modules"];
fn hidden(name: &str) -> bool { name.starts_with('.') || name.starts_with("~$") || HIDDEN.contains(&name) }

fn millis(m: &std::fs::Metadata) -> u64 {
    m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn entry(root: &Path, p: &Path) -> Option<Entry> {
    let m = std::fs::metadata(p).ok()?;
    let name = p.file_name()?.to_string_lossy().into_owned();
    let is_dir = m.is_dir();
    let count = if is_dir { std::fs::read_dir(p).map(|d| d.flatten().filter(|e| !hidden(&e.file_name().to_string_lossy())).count()).unwrap_or(0) } else { 0 };
    let ext = if is_dir { String::new() } else { p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default() };
    Some(Entry { path: p.to_string_lossy().into_owned(), rel: rel_of(root, p), name, is_dir, size: if is_dir { 0 } else { m.len() }, modified: millis(&m), ext, count })
}

/// Folders first, then by name (case does not count).
fn sort(v: &mut [Entry]) { v.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))); }

pub fn list(root: &str, dir: &str) -> Result<Vec<Entry>, String> {
    let r = inside(root, root)?;
    let d = inside(root, if dir.is_empty() { root } else { dir })?;
    let mut out: Vec<Entry> = std::fs::read_dir(&d).map_err(|e| format!("{}: {e}", d.display()))?.flatten()
        .filter(|e| !hidden(&e.file_name().to_string_lossy()))
        .filter_map(|e| entry(&r, &e.path())).collect();
    sort(&mut out);
    Ok(out)
}

/// Files and folders whose name holds every word of `query` (case does not count), at most `max`.
pub fn search(root: &str, query: &str, max: usize) -> Result<Vec<Entry>, String> {
    let r = inside(root, root)?;
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    let mut out = Vec::new();
    if words.is_empty() { return Ok(out); }
    let mut stack = vec![(r.clone(), 0usize)];
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if hidden(&name) { continue; }
            let p = e.path();
            let lower = name.to_lowercase();
            if words.iter().all(|w| lower.contains(w)) { if let Some(x) = entry(&r, &p) { out.push(x); } }
            if out.len() >= max { sort(&mut out); return Ok(out); }
            if depth < 10 && e.file_type().map(|t| t.is_dir()).unwrap_or(false) { stack.push((p, depth + 1)); }
        }
    }
    sort(&mut out);
    Ok(out)
}

/// A file or folder name the person typed, or an error.
fn valid_name(name: &str) -> Result<String, String> {
    let n = name.trim().trim_end_matches('.').to_string();
    if n.is_empty() || n == "." || n == ".." || n.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control()) {
        return Err(format!("Not a valid name: {name}"));
    }
    Ok(n)
}

/// `dir/name`, or `dir/name (2)` … when that is taken.
pub fn free_name(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() { return p; }
    let (stem, ext) = match name.rfind('.') { Some(i) if i > 0 => (&name[..i], &name[i..]), _ => (name, "") };
    (2..10_000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(p)
}

pub fn mkdir(root: &str, dir: &str, name: &str) -> Result<String, String> {
    let d = inside(root, if dir.is_empty() { root } else { dir })?;
    let p = free_name(&d, &valid_name(name)?);
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

/// Folders for these names that don't exist yet (e.g. one per subject); returns how many were made.
pub fn mkdirs(root: &str, names: &[String]) -> Result<usize, String> {
    let r = inside(root, root)?;
    let mut n = 0;
    for name in names {
        let Ok(name) = valid_name(name) else { continue };
        let p = r.join(&name);
        if !p.exists() { std::fs::create_dir_all(&p).map_err(|e| e.to_string())?; n += 1; }
    }
    Ok(n)
}

pub fn rename(root: &str, path: &str, name: &str) -> Result<String, String> {
    let p = inside(root, path)?;
    if p == inside(root, root)? { return Err("The school folder itself can't be renamed here".into()); }
    let name = valid_name(name)?;
    let parent = p.parent().ok_or("no folder")?;
    if p.file_name().map(|n| n.to_string_lossy() == name).unwrap_or(false) { return Ok(path.into()); }
    let to = parent.join(&name);
    // Only the case changes ("bio" → "Bio") on a file system that ignores case: rename directly.
    let same = to.exists() && p.file_name().map(|n| n.to_string_lossy().to_lowercase() == name.to_lowercase()).unwrap_or(false);
    let to = if same { to } else { free_name(parent, &name) };
    std::fs::rename(&p, &to).map_err(|e| e.to_string())?;
    Ok(to.to_string_lossy().into_owned())
}

fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() { return Ok(()); }
    if from.is_dir() { return Err(format!("{}: can't move a folder to another drive", from.display())); }
    std::fs::copy(from, to).map_err(|e| format!("{}: {e}", to.display()))?;
    std::fs::remove_file(from).map_err(|e| format!("{}: {e}", from.display()))
}

/// Moves files / folders into the folder `into` (all inside the school folder); returns the new paths.
pub fn move_into(root: &str, paths: &[String], into: &str) -> Result<Vec<String>, String> {
    let d = inside(root, if into.is_empty() { root } else { into })?;
    if !d.is_dir() { return Err(format!("Not a folder: {into}")); }
    let mut out = Vec::new();
    for path in paths {
        let p = inside(root, path)?;
        if d.starts_with(&p) { return Err("A folder can't go into itself".into()); }
        if p.parent() == Some(d.as_path()) { out.push(path.clone()); continue; }
        let to = free_name(&d, &p.file_name().ok_or("no name")?.to_string_lossy());
        move_file(&p, &to)?;
        out.push(to.to_string_lossy().into_owned());
    }
    Ok(out)
}

fn copy_all(from: &Path, to: &Path) -> Result<(), String> {
    if from.is_dir() {
        std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
        for e in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() { copy_all(&e.path(), &to.join(e.file_name()))?; }
        Ok(())
    } else {
        std::fs::copy(from, to).map(|_| ()).map_err(|e| format!("{}: {e}", from.display()))
    }
}

/// Copies files from anywhere (a download, a USB stick) into the folder `into`; the originals stay.
pub fn import(root: &str, paths: &[String], into: &str) -> Result<Vec<String>, String> {
    let d = inside(root, if into.is_empty() { root } else { into })?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for path in paths {
        let p = PathBuf::from(path);
        let Some(name) = p.file_name() else { continue };
        if d.starts_with(&p) { continue; }
        let to = free_name(&d, &name.to_string_lossy());
        copy_all(&p, &to)?;
        out.push(to.to_string_lossy().into_owned());
    }
    Ok(out)
}

/// Writes a new text file (e.g. a study sheet from Claude) — never over an existing one.
pub fn write_new(root: &str, dir: &str, name: &str, text: &str) -> Result<String, String> {
    let d = inside(root, if dir.is_empty() { root } else { dir })?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    let p = free_name(&d, &valid_name(name)?);
    std::fs::write(&p, text).map_err(|e| e.to_string())?;
    Ok(p.to_string_lossy().into_owned())
}

/// The start of a text file for the preview (at most 200 KB, as text).
pub fn read_text(root: &str, path: &str) -> Result<String, String> {
    use std::io::Read;
    let p = inside(root, path)?;
    let mut buf = Vec::new();
    std::fs::File::open(&p).map_err(|e| e.to_string())?.take(200_000).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

#[cfg(target_os = "macos")]
fn to_trash(p: &Path) -> Result<Option<String>, String> {
    use objc2::rc::Retained;
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()));
    let mut landed: Option<Retained<NSURL>> = None;
    NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, Some(&mut landed)).map_err(|e| e.localizedDescription().to_string())?;
    Ok(landed.and_then(|u| u.path()).map(|s| s.to_string()))
}

#[cfg(target_os = "macos")]
fn from_trash(original: &Path, landed: Option<String>) -> Result<(), String> {
    let landed = landed.ok_or("The trash didn't say where the file went.")?;
    move_file(Path::new(&landed), original)
}

#[cfg(not(target_os = "macos"))]
fn to_trash(p: &Path) -> Result<Option<String>, String> {
    trash::delete(p).map_err(|e| e.to_string())?;
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
fn from_trash(original: &Path, _landed: Option<String>) -> Result<(), String> {
    let (parent, name) = (original.parent().ok_or("no folder")?, original.file_name().ok_or("no name")?);
    let item = trash::os_limited::list().map_err(|e| e.to_string())?.into_iter()
        .filter(|i| i.name == name && i.original_parent == parent)
        .max_by_key(|i| i.time_deleted)
        .ok_or("The file is no longer in the trash.")?;
    trash::os_limited::restore_all([item]).map_err(|e| e.to_string())
}

// ---- Commands ----

#[tauri::command]
pub fn files_list(root: String, dir: String) -> Result<Vec<Entry>, String> { list(&root, &dir) }

#[tauri::command]
pub async fn files_search(root: String, query: String) -> Result<Vec<Entry>, String> {
    tauri::async_runtime::spawn_blocking(move || search(&root, &query, 300)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn files_mkdir(root: String, dir: String, name: String) -> Result<String, String> { mkdir(&root, &dir, &name) }

#[tauri::command]
pub fn files_mkdirs(root: String, names: Vec<String>) -> Result<usize, String> { mkdirs(&root, &names) }

#[tauri::command]
pub fn files_rename(root: String, path: String, name: String) -> Result<String, String> { rename(&root, &path, &name) }

#[tauri::command]
pub fn files_move(root: String, paths: Vec<String>, into: String) -> Result<Vec<String>, String> { move_into(&root, &paths, &into) }

#[tauri::command]
pub async fn files_import(root: String, paths: Vec<String>, into: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || import(&root, &paths, &into)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn files_write(root: String, dir: String, name: String, text: String) -> Result<String, String> { write_new(&root, &dir, &name, &text) }

#[tauri::command]
pub fn files_text(root: String, path: String) -> Result<String, String> { read_text(&root, &path) }

/// Into the system's trash. The answer is what `files_untrash` needs to bring it back.
#[tauri::command]
pub async fn files_trash(root: String, path: String) -> Result<Option<String>, String> {
    let p = inside(&root, &path)?;
    if p == inside(&root, &root)? { return Err("The school folder itself stays".into()); }
    tauri::async_runtime::spawn_blocking(move || to_trash(&p)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn files_untrash(root: String, path: String, landed: Option<String>) -> Result<(), String> {
    let p = inside(&root, &path)?;
    if p.exists() { return Err(format!("{path} exists again")); }
    tauri::async_runtime::spawn_blocking(move || from_trash(&p, landed)).await.map_err(|e| e.to_string())?
}

/// Opens a file with the program the system uses for it (PDF viewer, Word, a Studio app …).
#[tauri::command]
pub fn files_open(app: AppHandle, root: String, path: String) -> Result<(), String> {
    let p = inside(&root, &path)?;
    app.opener().open_path(p.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn files_reveal(app: AppHandle, root: String, path: String) -> Result<(), String> {
    let p = inside(&root, &path)?;
    app.opener().reveal_item_in_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn files_pick_folder(app: AppHandle) -> Option<String> {
    crate::shared::file_dialog(&app).blocking_pick_folder().and_then(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn files_pick(app: AppHandle) -> Vec<String> {
    crate::shared::file_dialog(&app).blocking_pick_files().unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("plan-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn paths_stay_in_the_school_folder() {
        assert!(inside("/s/Schule", "/s/Schule/Mathe/a.pdf").is_ok());
        assert!(inside("/s/Schule", "Mathe/a.pdf").unwrap().ends_with("Mathe/a.pdf"));
        assert!(inside("/s/Schule", "/s/Schule/../Privat/x").is_err());
        assert!(inside("/s/Schule", "/s/SchuleX/y").is_err());
        assert!(inside("", "/a").is_err() && inside("relative", "/a").is_err());
    }

    #[test]
    fn manages_files() {
        let d = tmp("manage");
        let root = d.to_string_lossy().into_owned();
        assert_eq!(mkdirs(&root, &["Mathe".into(), "Deutsch".into(), "Mathe".into(), "a/b".into()]).unwrap(), 2);
        std::fs::write(d.join("Blatt 1.pdf"), "x").unwrap();
        std::fs::write(d.join(".DS_Store"), "x").unwrap();
        let l = list(&root, "").unwrap();
        assert_eq!(l.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["Deutsch", "Mathe", "Blatt 1.pdf"], "folders first, hidden files left out");
        assert_eq!((l[2].ext.as_str(), l[2].rel.as_str(), l[2].size), ("pdf", "Blatt 1.pdf", 1));
        // Move into a folder; a name that is taken gets a number.
        std::fs::write(d.join("Mathe/Blatt 1.pdf"), "old").unwrap();
        let moved = move_into(&root, &[d.join("Blatt 1.pdf").to_string_lossy().into_owned()], &d.join("Mathe").to_string_lossy()).unwrap();
        assert!(moved[0].ends_with("Blatt 1 (2).pdf"));
        assert_eq!(std::fs::read_to_string(d.join("Mathe/Blatt 1.pdf")).unwrap(), "old", "nothing overwritten");
        assert!(move_into(&root, &[d.join("Mathe").to_string_lossy().into_owned()], &d.join("Mathe").to_string_lossy()).is_err(), "not into itself");
        // Rename (also only the case), new folder, write, search.
        let p = rename(&root, &moved[0], "Übung.pdf").unwrap();
        assert!(p.ends_with("Übung.pdf") && Path::new(&p).exists());
        assert!(rename(&root, &p, "a/b").is_err());
        assert!(rename(&root, &d.join("Deutsch").to_string_lossy(), "deutsch").unwrap().ends_with("deutsch"));
        let sub = mkdir(&root, &d.join("Mathe").to_string_lossy(), "Klausur").unwrap();
        let w = write_new(&root, &sub, "Lernzettel.md", "# Hi").unwrap();
        assert!(write_new(&root, &sub, "Lernzettel.md", "# 2").unwrap().ends_with("Lernzettel (2).md"));
        assert_eq!(read_text(&root, &w).unwrap(), "# Hi");
        let s = search(&root, "lern ZETTEL", 50).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].rel, "Mathe/Klausur/Lernzettel (2).md");
        assert!(search(&root, "  ", 50).unwrap().is_empty());
        // Copy in from outside: the original stays.
        let out = tmp("outside");
        std::fs::write(out.join("Foto.jpg"), "img").unwrap();
        let got = import(&root, &[out.join("Foto.jpg").to_string_lossy().into_owned()], "").unwrap();
        assert!(Path::new(&got[0]).exists() && out.join("Foto.jpg").exists());
        let _ = std::fs::remove_dir_all(out);
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn free_names() {
        let d = tmp("free");
        assert_eq!(free_name(&d, "a.txt"), d.join("a.txt"));
        std::fs::write(d.join("a.txt"), "").unwrap();
        std::fs::write(d.join("a (2).txt"), "").unwrap();
        assert_eq!(free_name(&d, "a.txt"), d.join("a (3).txt"));
        std::fs::create_dir(d.join("Ordner")).unwrap();
        assert_eq!(free_name(&d, "Ordner"), d.join("Ordner (2)"));
        assert_eq!(free_name(&d, ".env"), d.join(".env"));
        let _ = std::fs::remove_dir_all(d);
    }
}

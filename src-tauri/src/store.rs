//! Where the plan is kept, and keeping it safe when two computers share it.
//!
//! Order: a portable copy next to the program (plan.json, e.g. on a USB stick) → the sync folder chosen in Studio Hub
//! (<sync folder>/Plan Studio/plan.json — in iCloud Drive, OneDrive, Dropbox …, so two computers share the plan) →
//! the app's data folder. The cloud service copies the file; Plan Studio only makes sure nothing gets lost:
//! - the first time with a sync folder, the plan of this computer goes there — or, when the sync folder already has a
//!   plan (from the other computer), that one is used and the plan of this computer is kept as a copy;
//! - a save checks that the file is still the one that was loaded: when the other computer changed it meanwhile, its
//!   version is kept as plan-conflict-<time>.json next to it before this one is written.

use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Place {
    pub path: PathBuf,
    /// "portable", "sync" or "local".
    pub kind: &'static str,
}

pub fn place(portable: Option<PathBuf>, sync_dir: Option<PathBuf>, local_dir: &Path) -> Place {
    if let Some(p) = portable.filter(|p| p.exists()) { return Place { path: p, kind: "portable" }; }
    if let Some(d) = sync_dir { return Place { path: d.join("Plan Studio").join("plan.json"), kind: "sync" }; }
    Place { path: local_dir.join("plan.json"), kind: "local" }
}

/// Last change of a file in milliseconds (0 when it is missing).
pub fn stamp(p: &Path) -> u64 {
    fs::metadata(p).and_then(|m| m.modified()).ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Prepares the sync folder (once per folder; a note in the local folder remembers it). Returns what happened:
/// "moved" (this computer's plan went to the sync folder) or "taken|<copy>" (the sync folder's plan is used, this
/// computer's plan was kept as <copy>), or None.
pub fn prepare_sync(sync_file: &Path, local_dir: &Path) -> Result<Option<String>, String> {
    let marker = local_dir.join("synced-to.txt");
    let target = sync_file.to_string_lossy().to_string();
    if fs::read_to_string(&marker).map(|m| m.trim() == target).unwrap_or(false) { return Ok(None); }
    let local = local_dir.join("plan.json");
    let mut note = None;
    if !sync_file.exists() {
        if local.exists() {
            if let Some(d) = sync_file.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())?; }
            fs::copy(&local, sync_file).map_err(|e| format!("{}: {e}", sync_file.display()))?;
            note = Some("moved".to_string());
        }
    } else if local.exists() && fs::read(&local).ok() != fs::read(sync_file).ok() {
        let copy = local_dir.join(format!("plan-before-sync-{}.json", crate::ics::utc_stamp()));
        fs::copy(&local, &copy).map_err(|e| e.to_string())?;
        note = Some(format!("taken|{}", copy.display()));
    }
    fs::create_dir_all(local_dir).map_err(|e| e.to_string())?;
    fs::write(&marker, &target).map_err(|e| e.to_string())?;
    Ok(note)
}

/// Saves `content`; when the file changed since it was loaded (`expected` is the stamp then), the version on disk is
/// kept as a conflict copy first. Returns the new stamp and the copy's file name.
pub fn save_checked(path: &Path, content: &str, expected: Option<u64>) -> Result<(u64, Option<String>), String> {
    if let Some(d) = path.parent() { fs::create_dir_all(d).map_err(|e| e.to_string())?; }
    let mut conflict = None;
    if let Some(e) = expected.filter(|e| *e > 0) {
        if path.exists() && stamp(path) != e && fs::read_to_string(path).map(|t| t != content).unwrap_or(false) {
            let name = format!("plan-conflict-{}.json", crate::ics::utc_stamp());
            fs::copy(path, path.with_file_name(&name)).map_err(|e| e.to_string())?;
            conflict = Some(name);
        }
    }
    crate::save_atomic(path, content)?;
    Ok((stamp(path), conflict))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("plan-store-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn places_in_order() {
        let d = dir("place");
        let portable = d.join("plan.json");
        assert_eq!(place(Some(portable.clone()), Some(d.join("sync")), &d.join("local")).kind, "sync", "no portable copy");
        fs::write(&portable, "{}").unwrap();
        assert_eq!(place(Some(portable.clone()), Some(d.join("sync")), &d.join("local")), Place { path: portable, kind: "portable" });
        assert_eq!(place(None, None, &d).path, d.join("plan.json"));
        assert_eq!(place(None, Some(d.join("iCloud")), &d).path, d.join("iCloud").join("Plan Studio").join("plan.json"));
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn first_computer_moves_second_takes_over() {
        let d = dir("sync");
        let (a, b, cloud) = (d.join("a"), d.join("b"), d.join("cloud").join("Plan Studio").join("plan.json"));
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("plan.json"), "A").unwrap();
        fs::write(b.join("plan.json"), "B").unwrap();
        // Computer A turns sync on first: its plan goes to the cloud folder.
        assert_eq!(prepare_sync(&cloud, &a).unwrap().as_deref(), Some("moved"));
        assert_eq!(fs::read_to_string(&cloud).unwrap(), "A");
        assert_eq!(prepare_sync(&cloud, &a).unwrap(), None, "only once");
        // Computer B: the cloud plan is used, B's own plan is kept.
        let note = prepare_sync(&cloud, &b).unwrap().unwrap();
        let copy = note.strip_prefix("taken|").unwrap();
        assert_eq!(fs::read_to_string(copy).unwrap(), "B");
        assert_eq!(fs::read_to_string(&cloud).unwrap(), "A");
        let _ = fs::remove_dir_all(d);
    }

    #[test]
    fn save_keeps_the_other_computers_change() {
        let d = dir("save");
        let p = d.join("plan.json");
        let (s1, c) = save_checked(&p, "one", None).unwrap();
        assert!(c.is_none() && s1 > 0);
        // Unchanged since loading: no conflict.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let (s2, c) = save_checked(&p, "two", Some(s1)).unwrap();
        assert!(c.is_none());
        // The other computer writes meanwhile …
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(&p, "other computer").unwrap();
        let (_, c) = save_checked(&p, "three", Some(s2)).unwrap();
        let name = c.expect("conflict copy");
        assert_eq!(fs::read_to_string(d.join(name)).unwrap(), "other computer");
        assert_eq!(fs::read_to_string(&p).unwrap(), "three");
        let _ = fs::remove_dir_all(d);
    }
}

// Korie for Windows, Mac and Linux: a window with the Korie web client from
// the Korie server on the network. It finds the server by itself (UDP
// broadcast, like the TV app): one answers, it opens it; several, it asks which
// and remembers; none, it asks for the address.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const DISCOVERY_PORT: u16 = 7361;

// On every page (also a game's web player): Esc goes back to Korie when the
// page isn't Korie's own, and Ctrl+Shift+S opens the server choice.
const PAGE_SCRIPT: &str = r##"
(() => {
  const home = (navigator.userAgent.includes("Windows") ? "http://tauri.localhost" : "tauri://localhost") + "/index.html";
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === "S" || e.key === "s")) { location.href = home + "#forget"; return; }
    if (e.key === "Escape" && !document.querySelector("#root") && history.length > 1) { e.preventDefault(); history.back(); }
  }, true);
})();
"##;

#[derive(serde::Serialize, Clone)]
struct Server {
    id: String,
    name: String,
    url: String,
}

fn saved_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("server.json"))
}

fn load_saved(app: &tauri::AppHandle) -> (String, String) {
    let Some(p) = saved_path(app) else { return (String::new(), String::new()) };
    let Ok(text) = std::fs::read_to_string(p) else { return (String::new(), String::new()) };
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    (v["url"].as_str().unwrap_or("").to_string(), v["id"].as_str().unwrap_or("").to_string())
}

fn save(app: &tauri::AppHandle, url: &str, id: &str) {
    if let Some(p) = saved_path(app) {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = std::fs::write(p, serde_json::json!({ "url": url, "id": id }).to_string());
    }
}

/// GET <base>/api/hello with a plain socket: Some(server id) when a Korie server answers.
fn hello(base: &str) -> Option<String> {
    let rest = base.strip_prefix("http://")?;
    let hostport = rest.split('/').next()?;
    let addr = if hostport.contains(':') { hostport.to_string() } else { format!("{hostport}:80") };
    let sock = addr.to_socket_addrs().ok()?.next()?;
    let mut s = TcpStream::connect_timeout(&sock, Duration::from_millis(2500)).ok()?;
    s.set_read_timeout(Some(Duration::from_millis(2500))).ok()?;
    write!(s, "GET /api/hello HTTP/1.0\r\nHost: {hostport}\r\n\r\n").ok()?;
    let mut buf = String::new();
    s.read_to_string(&mut buf).ok()?;
    let body = buf.split("\r\n\r\n").nth(1)?;
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    if v["korie"].as_bool() != Some(true) {
        return None;
    }
    Some(v["id"].as_str().unwrap_or("").to_string())
}

fn discover() -> Vec<Server> {
    let mut out: Vec<Server> = Vec::new();
    let Ok(sock) = UdpSocket::bind("0.0.0.0:0") else { return out };
    let _ = sock.set_broadcast(true);
    let _ = sock.set_read_timeout(Some(Duration::from_millis(300)));
    let end = Instant::now() + Duration::from_millis(1500);
    let mut sent = 0;
    let mut buf = [0u8; 2048];
    while Instant::now() < end {
        if sent < 3 {
            let _ = sock.send_to(b"KORIE_DISCOVER", ("255.255.255.255", DISCOVERY_PORT));
            sent += 1;
        }
        if let Ok((n, from)) = sock.recv_from(&mut buf) {
            let Ok(v) = serde_json::from_slice::<serde_json::Value>(&buf[..n]) else { continue };
            if v["korie"].as_bool() != Some(true) {
                continue;
            }
            let id = v["id"].as_str().unwrap_or("").to_string();
            if out.iter().any(|s| s.id == id) {
                continue;
            }
            out.push(Server {
                id,
                name: v["name"].as_str().unwrap_or("Korie").to_string(),
                url: format!("http://{}:{}", from.ip(), v["port"].as_u64().unwrap_or(8100)),
            });
        }
    }
    out
}

/// What the start page should do: open a server, or show the found ones.
#[tauri::command]
async fn start(app: tauri::AppHandle, forget: bool) -> serde_json::Value {
    if forget {
        save(&app, "", "");
    }
    let (url, id) = load_saved(&app);
    if !url.is_empty() && hello(&url).is_some() {
        return serde_json::json!({ "open": url });
    }
    let found = tauri::async_runtime::spawn_blocking(discover).await.unwrap_or_default();
    if !id.is_empty() {
        if let Some(s) = found.iter().find(|s| s.id == id) {
            save(&app, &s.url, &s.id);
            return serde_json::json!({ "open": s.url });
        }
    }
    if found.len() == 1 && id.is_empty() {
        save(&app, &found[0].url, &found[0].id);
        return serde_json::json!({ "open": found[0].url });
    }
    serde_json::json!({ "servers": found })
}

#[tauri::command]
async fn look() -> Vec<Server> {
    tauri::async_runtime::spawn_blocking(discover).await.unwrap_or_default()
}

/// Checks an address the person typed (or picked) and remembers it.
#[tauri::command]
async fn connect(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let mut u = url.trim().trim_end_matches('/').to_string();
    if !u.starts_with("http://") {
        u = format!("http://{u}");
    }
    if !u["http://".len()..].contains(':') {
        u.push_str(":8100");
    }
    let u2 = u.clone();
    match tauri::async_runtime::spawn_blocking(move || hello(&u2)).await.ok().flatten() {
        Some(id) => {
            save(&app, &u, &id);
            Ok(u)
        }
        None => Err("No Korie server answered at that address.".into()),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![start, look, connect])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Korie")
                .inner_size(1600.0, 900.0)
                .min_inner_size(640.0, 400.0)
                .background_color(tauri::window::Color(10, 20, 32, 255))
                .user_agent(&format!("Mozilla/5.0 (Korie desktop) KorieDesktop/{}", env!("CARGO_PKG_VERSION")))
                .initialization_script(PAGE_SCRIPT)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Korie couldn't start");
}

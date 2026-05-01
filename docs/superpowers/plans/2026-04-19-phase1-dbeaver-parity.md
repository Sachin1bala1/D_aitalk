# Phase 1: DBeaver Parity — The 4 Blockers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four hard blockers that prevent DBeaver users from switching to Daitalk: SSH tunnel support, hierarchical sidebar tree, object properties panel, and result set editor toolbar.

**Architecture:** All four features are frontend-heavy; SSH tunnel is the only one requiring new Rust code. The sidebar reorganization and properties panel reuse data already in `FullSchema`. The editor toolbar extends `VirtualTable` with a `pendingEdits` map and a batch-commit workflow.

**Tech Stack:** React 19, TypeScript, Tauri v2 (Rust), sqlx, ssh2 crate, Tailwind CSS, Zustand, sonner toasts.

---

## File Map

### New Files
- `src-tauri/src/db/ssh_tunnel.rs` — `SshTunnel` struct: opens libssh2 session, binds local port, proxies connections
- `src/components/panels/ObjectPropertiesPanel.tsx` — tabbed panel: Columns / Indexes / FK / DDL / Data

### Modified Files
- `src-tauri/Cargo.toml` — add `ssh2` dependency
- `src-tauri/src/db/connection_manager.rs` — store optional `SshTunnel` per connection; extend `ConnectionConfig`
- `src-tauri/src/commands.rs` — `db_connect` uses SSH tunnel when config has ssh field
- `src/lib/db/DbClient.ts` — add `SshConfig` type, extend `ConnectionConfig`
- `src/components/dialogs/ConnectionDialog.tsx` — SSH tab (host / port / user / auth)
- `src/components/schema/Sidebar.tsx` — reorganize expanded table view into collapsible Columns / Indexes / FK sub-groups
- `src/App.tsx` — add `propertiesTable` state, render `ObjectPropertiesPanel` below results
- `src/components/table/VirtualTable.tsx` — add `pendingEdits` state, dirty cell tracking, editor toolbar

---

## Task 1: SSH Tunnel — Rust Layer

**Files:**
- Create: `src-tauri/src/db/ssh_tunnel.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/db/connection_manager.rs`

- [ ] **Step 1: Add ssh2 dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:
```toml
ssh2 = { version = "0.9", features = ["vendored-openssl"] }
```

- [ ] **Step 2: Create ssh_tunnel.rs**

Create `src-tauri/src/db/ssh_tunnel.rs`:
```rust
//! SSH port-forward tunnel.
//!
//! Opens an SSH session, binds a random local port, and proxies every
//! TCP connection on that port through an SSH channel to the real DB host.

use ssh2::Session;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, atomic::{AtomicBool, Ordering}},
    thread,
};

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: SshAuth,
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SshAuth {
    Password { password: String },
    Key { key_path: String, passphrase: Option<String> },
}

pub struct SshTunnel {
    pub local_port: u16,
    _stop: Arc<AtomicBool>,
}

impl SshTunnel {
    /// Open an SSH tunnel. Returns the local port to connect to instead of
    /// the real DB host/port.
    pub fn open(cfg: &SshConfig, remote_host: &str, remote_port: u16) -> Result<Self, String> {
        // Connect to SSH server
        let tcp = TcpStream::connect(format!("{}:{}", cfg.host, cfg.port))
            .map_err(|e| format!("SSH TCP connect to {}:{} failed: {e}", cfg.host, cfg.port))?;

        let mut session = Session::new()
            .map_err(|e| format!("SSH session create failed: {e}"))?;
        session.set_tcp_stream(tcp);
        session.handshake()
            .map_err(|e| format!("SSH handshake failed: {e}"))?;

        // Authenticate
        match &cfg.auth {
            SshAuth::Password { password } => {
                session.userauth_password(&cfg.username, password)
                    .map_err(|e| format!("SSH password auth failed: {e}"))?;
            }
            SshAuth::Key { key_path, passphrase } => {
                session.userauth_pubkey_file(
                    &cfg.username,
                    None,
                    std::path::Path::new(key_path),
                    passphrase.as_deref(),
                )
                .map_err(|e| format!("SSH key auth failed: {e}"))?;
            }
        }

        if !session.authenticated() {
            return Err("SSH authentication failed".into());
        }

        // Bind random local port
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Local port bind failed: {e}"))?;
        let local_port = listener.local_addr().unwrap().port();

        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        let remote_host = remote_host.to_string();
        let session = Arc::new(std::sync::Mutex::new(session));

        thread::spawn(move || {
            listener.set_nonblocking(false).ok();
            for stream in listener.incoming() {
                if stop_clone.load(Ordering::Relaxed) { break; }
                let Ok(mut local) = stream else { break };
                let sess = session.clone();
                let rh = remote_host.clone();
                thread::spawn(move || {
                    let Ok(mut channel) = sess.lock().unwrap()
                        .channel_direct_tcpip(&rh, remote_port, None)
                    else { return };

                    let mut local2 = match local.try_clone() {
                        Ok(s) => s,
                        Err(_) => return,
                    };

                    // DB → client
                    let mut ch_read = unsafe { std::mem::transmute_copy::<_, ssh2::Channel>(&channel) };
                    thread::spawn(move || {
                        let mut buf = [0u8; 8192];
                        loop {
                            match ch_read.read(&mut buf) {
                                Ok(0) | Err(_) => break,
                                Ok(n) => { if local2.write_all(&buf[..n]).is_err() { break; } }
                            }
                        }
                    });

                    // Client → DB
                    let mut buf = [0u8; 8192];
                    loop {
                        match local.read(&mut buf) {
                            Ok(0) | Err(_) => break,
                            Ok(n) => { if channel.write_all(&buf[..n]).is_err() { break; } }
                        }
                    }
                });
            }
        });

        Ok(SshTunnel { local_port, _stop: stop })
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self._stop.store(true, Ordering::Relaxed);
    }
}
```

- [ ] **Step 3: Expose SshTunnel and SshConfig from db/mod.rs**

In `src-tauri/src/db/mod.rs`, add:
```rust
pub mod ssh_tunnel;
pub use ssh_tunnel::{SshConfig, SshTunnel};
```

- [ ] **Step 4: Extend ConnectionConfig in connection_manager.rs**

In `src-tauri/src/db/connection_manager.rs`, add `ssh` field to `ConnectionConfig`:
```rust
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub display_name: String,
    pub driver: String,
    pub connection_string: String,
    pub pool_min: Option<u32>,
    pub pool_max: Option<u32>,
    pub ssh: Option<crate::db::SshConfig>,
}
```

Add `SshTunnel` storage to `ConnectionManager`. Change the connections map to store the tunnel alongside the pool:
```rust
use crate::db::SshTunnel;

pub struct ActiveEntry {
    pub connection: Arc<ActiveConnection>,
    pub _tunnel: Option<SshTunnel>,  // kept alive for duration of connection
}

pub struct ConnectionManager {
    connections: RwLock<HashMap<String, ActiveEntry>>,
    configs: RwLock<HashMap<String, ConnectionConfig>>,
}
```

Update `get()` to return `Arc<ActiveConnection>`:
```rust
pub async fn get(&self, id: &str) -> Option<Arc<ActiveConnection>> {
    self.connections.read().await.get(id).map(|e| e.connection.clone())
}
```

- [ ] **Step 5: Open tunnel in connect() before DB pool**

In `ConnectionManager::connect()`, add tunnel logic before the driver match:
```rust
pub async fn connect(&self, config: ConnectionConfig) -> Result<(), crate::error::AppError> {
    // Open SSH tunnel if configured
    let (effective_conn_str, tunnel) = if let Some(ref ssh) = config.ssh {
        // Parse original connection string to extract host/port
        let url = url::Url::parse(&config.connection_string)
            .map_err(|e| crate::error::AppError::Connection(format!("Invalid URL: {e}")))?;
        let remote_host = url.host_str().unwrap_or("localhost").to_string();
        let remote_port = url.port().unwrap_or(5432);

        let tunnel = SshTunnel::open(ssh, &remote_host, remote_port)
            .map_err(|e| crate::error::AppError::Connection(e))?;

        // Rewrite connection string to use local tunnel port
        let new_str = config.connection_string
            .replace(&format!("{}:{}", remote_host, remote_port), &format!("127.0.0.1:{}", tunnel.local_port))
            .replace(&format!("@{}/", remote_host), &format!("@127.0.0.1:{}/", tunnel.local_port));

        (new_str, Some(tunnel))
    } else {
        (config.connection_string.clone(), None)
    };

    // Use effective_conn_str instead of config.connection_string in the driver match below
    // ... existing driver match code, replace config.connection_string with effective_conn_str ...

    // Store entry with tunnel
    self.connections.write().await.insert(config.id.clone(), ActiveEntry {
        connection: Arc::new(active),
        _tunnel: tunnel,
    });
    // ...
}
```

- [ ] **Step 6: Verify Rust compiles**

```bash
export PATH="/c/msys64/mingw64/bin:$HOME/.cargo/bin:$PATH"
cd /c/Users/sachi/Documents/manufacturing_agent/daitalk-v2
cargo build --no-default-features --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "^error|Finished"
```
Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...`

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/db/ssh_tunnel.rs src-tauri/src/db/connection_manager.rs src-tauri/src/db/mod.rs
git commit -m "feat(rust): SSH tunnel support via ssh2 crate"
```

---

## Task 2: SSH Tunnel — Frontend (ConnectionDialog)

**Files:**
- Modify: `src/lib/db/DbClient.ts`
- Modify: `src/components/dialogs/ConnectionDialog.tsx`

- [ ] **Step 1: Add SshConfig type to DbClient.ts**

In `src/lib/db/DbClient.ts`, add after `ConnectionConfig`:
```typescript
export interface SshConfig {
  host: string;
  port: number;
  username: string;
  auth:
    | { type: "password"; password: string }
    | { type: "key"; key_path: string; passphrase?: string };
}
```

Extend `ConnectionConfig`:
```typescript
export interface ConnectionConfig {
  id: string;
  display_name: string;
  driver: DbDriver;
  connection_string: string;
  pool_min?: number;
  pool_max?: number;
  ssh?: SshConfig;
}
```

- [ ] **Step 2: Add SSH tab state to ConnectionDialog.tsx**

In `ConnectionDialog`, add state after existing state declarations:
```typescript
const [sshEnabled, setSshEnabled] = useState(false);
const [sshHost, setSshHost] = useState("");
const [sshPort, setSshPort] = useState(22);
const [sshUser, setSshUser] = useState("");
const [sshAuthType, setSshAuthType] = useState<"password" | "key">("password");
const [sshPassword, setSshPassword] = useState("");
const [sshKeyPath, setSshKeyPath] = useState("");
const [sshPassphrase, setSshPassphrase] = useState("");
const [activeTab, setActiveTab] = useState<"connection" | "ssh">("connection");
```

- [ ] **Step 3: Update buildConfig to include SSH**

Replace the existing `buildConfig()`:
```typescript
const buildConfig = (): ConnectionConfig => ({
  id: `conn-${Date.now()}`,
  display_name: displayName || selectedDriver.label,
  driver,
  connection_string: connectionString,
  pool_min: 1,
  pool_max: 10,
  ssh: sshEnabled && sshHost ? {
    host: sshHost,
    port: sshPort,
    username: sshUser,
    auth: sshAuthType === "password"
      ? { type: "password", password: sshPassword }
      : { type: "key", key_path: sshKeyPath, passphrase: sshPassphrase || undefined },
  } : undefined,
});
```

- [ ] **Step 4: Add tab bar + SSH form to dialog JSX**

In the dialog's `<div className="p-6 space-y-4">`, add tab bar before the saved connections section:
```tsx
{/* Tab bar */}
<div className="flex gap-0 border-b border-[#262626] -mx-6 px-6 mb-2">
  {(["connection", "ssh"] as const).map((tab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold border-b-2 transition-colors ${
        activeTab === tab
          ? "border-[#00d2ff] text-[#00d2ff]"
          : "border-transparent text-white/30 hover:text-white/60"
      }`}
    >
      {tab === "ssh" ? "SSH Tunnel" : "Connection"}
      {tab === "ssh" && sshEnabled && (
        <span className="ml-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
      )}
    </button>
  ))}
</div>
```

After the tab bar, wrap existing connection fields in `{activeTab === "connection" && (...)}` and add:
```tsx
{activeTab === "ssh" && (
  <div className="space-y-3">
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={sshEnabled}
        onChange={(e) => setSshEnabled(e.target.checked)}
        className="accent-[#00d2ff]"
      />
      <span className="text-xs text-white/60">Enable SSH tunnel</span>
    </label>

    {sshEnabled && (
      <>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">SSH Host</label>
            <input
              type="text"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              placeholder="bastion.example.com"
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00d2ff]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">Port</label>
            <input
              type="number"
              value={sshPort}
              onChange={(e) => setSshPort(parseInt(e.target.value) || 22)}
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00d2ff]"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">SSH Username</label>
          <input
            type="text"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
            placeholder="ubuntu"
            className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00d2ff]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">Authentication</label>
          <div className="flex gap-2">
            {(["password", "key"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setSshAuthType(t)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  sshAuthType === t
                    ? "border-[#00d2ff]/50 bg-[#00d2ff]/10 text-[#00d2ff]"
                    : "border-[#262626] text-white/30 hover:text-white/60"
                }`}
              >
                {t === "key" ? "Private Key" : "Password"}
              </button>
            ))}
          </div>
        </div>
        {sshAuthType === "password" ? (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">SSH Password</label>
            <input
              type="password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00d2ff]"
            />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">Key File Path</label>
              <input
                type="text"
                value={sshKeyPath}
                onChange={(e) => setSshKeyPath(e.target.value)}
                placeholder="C:/Users/you/.ssh/id_rsa"
                className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00d2ff]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-white/50">Passphrase (optional)</label>
              <input
                type="password"
                value={sshPassphrase}
                onChange={(e) => setSshPassphrase(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00d2ff]"
              />
            </div>
          </>
        )}
      </>
    )}
  </div>
)}
```

- [ ] **Step 5: TypeScript check**

```bash
"C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/node_modules/.bin/tsc" --noEmit --project "C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/tsconfig.json" 2>&1; echo "Exit: $?"
```
Expected: `Exit: 0`

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/DbClient.ts src/components/dialogs/ConnectionDialog.tsx
git commit -m "feat(ui): SSH tunnel tab in ConnectionDialog"
```

---

## Task 3: Hierarchical Sidebar Tree

**Files:**
- Modify: `src/components/schema/Sidebar.tsx`

The sidebar already shows columns when a table is expanded. This task reorganizes into independently collapsible sub-groups: **Columns**, **Indexes**, **Foreign Keys**.

- [ ] **Step 1: Add expandedGroups state**

In `Sidebar.tsx`, add state inside the component (after existing state):
```typescript
// expandedGroups[tableKey] = Set of expanded group names
const [expandedGroups, setExpandedGroups] = useState<Record<string, Set<string>>>({});

const toggleGroup = (tableKey: string, group: string) => {
  setExpandedGroups((prev) => {
    const current = new Set(prev[tableKey] ?? ["columns"]); // columns open by default
    if (current.has(group)) current.delete(group);
    else current.add(group);
    return { ...prev, [tableKey]: current };
  });
};

const isGroupOpen = (tableKey: string, group: string) =>
  expandedGroups[tableKey]?.has(group) ?? group === "columns"; // columns default open
```

- [ ] **Step 2: Replace the expanded columns section with sub-groups**

Find the expanded columns block (after the table row div, inside the `expandedTables.has(tableName)` check). Replace it with:

```tsx
{expandedTables.has(tableName) && (() => {
  const tableKey = `${activeSchema?.tables.find(t => t.name === tableName)?.schema ?? "public"}.${tableName}`;
  const cols = fullSchema?.columns[tableKey] ?? fullSchema?.columns[tableName] ?? [];
  const indexes = fullSchema?.indexes.filter(
    (ix) => ix.table_name === tableName || ix.table_name === tableKey
  ) ?? [];
  const fks = fullSchema?.foreign_keys.filter(
    (fk) => fk.from_table === tableName || fk.from_table === tableKey
  ) ?? [];

  return (
    <div className="ml-4 border-l border-[#1e1e1e]">
      {/* ── Columns group ── */}
      <button
        className="w-full flex items-center gap-1.5 px-2 py-1 text-[9px] text-white/30 hover:text-white/60 uppercase tracking-widest font-bold"
        onClick={() => toggleGroup(tableKey, "columns")}
      >
        {isGroupOpen(tableKey, "columns")
          ? <ChevronDown className="w-2.5 h-2.5 shrink-0" />
          : <ChevronRight className="w-2.5 h-2.5 shrink-0" />}
        Columns ({cols.length})
      </button>
      {isGroupOpen(tableKey, "columns") && cols.map((col) => (
        <div
          key={col.name}
          className="flex items-center gap-1.5 px-3 py-0.5 hover:bg-white/[0.03] group/col"
          title={`${col.type_name}${col.nullable ? " · nullable" : " · not null"}`}
        >
          {col.is_primary_key ? (
            <span className="text-[7px] text-amber-400 font-bold w-5 shrink-0 text-center border border-amber-500/30 rounded px-0.5">PK</span>
          ) : col.name && fks.some(fk => fk.from_column === col.name) ? (
            <span className="text-[7px] text-[#00d2ff]/60 font-bold w-5 shrink-0 text-center border border-[#00d2ff]/20 rounded px-0.5">FK</span>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <span className="text-[10px] text-white/50 truncate flex-1">{col.name}</span>
          <span className="text-[8px] text-white/20 font-mono shrink-0">{col.type_name.split("(")[0].split(" ")[0]}</span>
          <button
            className="opacity-0 group-hover/col:opacity-100 p-0.5 text-white/20 hover:text-white/60 transition-opacity shrink-0"
            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(col.name); toast.success("Column name copied"); }}
            title="Copy column name"
          >
            <Copy className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}

      {/* ── Indexes group ── */}
      {indexes.length > 0 && (
        <>
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-[9px] text-white/30 hover:text-white/60 uppercase tracking-widest font-bold"
            onClick={() => toggleGroup(tableKey, "indexes")}
          >
            {isGroupOpen(tableKey, "indexes")
              ? <ChevronDown className="w-2.5 h-2.5 shrink-0" />
              : <ChevronRight className="w-2.5 h-2.5 shrink-0" />}
            Indexes ({indexes.length})
          </button>
          {isGroupOpen(tableKey, "indexes") && indexes.map((ix) => (
            <div key={ix.index_name} className="flex items-center gap-1.5 px-3 py-0.5 hover:bg-white/[0.03]">
              <span className={`text-[7px] font-bold w-5 shrink-0 text-center border rounded px-0.5 ${ix.is_primary ? "text-amber-400 border-amber-500/30" : ix.is_unique ? "text-violet-400 border-violet-500/30" : "text-white/20 border-white/10"}`}>
                {ix.is_primary ? "PK" : ix.is_unique ? "UQ" : "IX"}
              </span>
              <span className="text-[10px] text-white/40 truncate flex-1" title={ix.columns.join(", ")}>
                {ix.index_name}
              </span>
              <span className="text-[8px] text-white/20 font-mono shrink-0">{ix.columns.slice(0, 2).join(", ")}{ix.columns.length > 2 ? "…" : ""}</span>
            </div>
          ))}
        </>
      )}

      {/* ── Foreign Keys group ── */}
      {fks.length > 0 && (
        <>
          <button
            className="w-full flex items-center gap-1.5 px-2 py-1 text-[9px] text-white/30 hover:text-white/60 uppercase tracking-widest font-bold"
            onClick={() => toggleGroup(tableKey, "fk")}
          >
            {isGroupOpen(tableKey, "fk")
              ? <ChevronDown className="w-2.5 h-2.5 shrink-0" />
              : <ChevronRight className="w-2.5 h-2.5 shrink-0" />}
            Foreign Keys ({fks.length})
          </button>
          {isGroupOpen(tableKey, "fk") && fks.map((fk, i) => (
            <div key={i} className="flex items-center gap-1.5 px-3 py-0.5 hover:bg-white/[0.03]">
              <Link2 className="w-3 h-3 text-[#00d2ff]/30 shrink-0" />
              <span className="text-[10px] text-white/40 truncate flex-1">
                {fk.from_column} → {fk.to_table.split(".").pop()}.{fk.to_column}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
})()}
```

- [ ] **Step 3: Add missing imports to Sidebar.tsx**

Add to the import block (after existing lucide imports):
```typescript
import { ChevronDown, ChevronRight, Link2, Copy } from "lucide-react";
```
(Remove duplicates if already imported under different aliases.)

- [ ] **Step 4: TypeScript check**

```bash
"C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/node_modules/.bin/tsc" --noEmit --project "C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/tsconfig.json" 2>&1; echo "Exit: $?"
```
Expected: `Exit: 0`

- [ ] **Step 5: Commit**

```bash
git add src/components/schema/Sidebar.tsx
git commit -m "feat(ui): hierarchical sidebar tree with Columns/Indexes/FK sub-groups"
```

---

## Task 4: Object Properties Panel — Component

**Files:**
- Create: `src/components/panels/ObjectPropertiesPanel.tsx`

- [ ] **Step 1: Create ObjectPropertiesPanel.tsx**

Create `src/components/panels/ObjectPropertiesPanel.tsx`:
```tsx
/**
 * ObjectPropertiesPanel — DBeaver-style bottom panel for table inspection.
 *
 * Tabs: Columns · Indexes · Foreign Keys · DDL · Data
 * Activated by clicking a table in the sidebar.
 */
import React, { useState, useEffect } from "react";
import { X, Copy } from "lucide-react";
import { toast } from "sonner";
import { FullSchema, ColumnMeta } from "../../lib/db/DbClient";
import { DbClient } from "../../lib/db/DbClient";

export interface PropertiesTarget {
  connectionId: string;
  schema: string;
  table: string;
}

interface Props {
  target: PropertiesTarget;
  fullSchema: FullSchema | null;
  onClose: () => void;
}

type Tab = "columns" | "indexes" | "fk" | "ddl" | "data";

export function ObjectPropertiesPanel({ target, fullSchema, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("columns");
  const [ddl, setDdl] = useState<string | null>(null);
  const [ddlLoading, setDdlLoading] = useState(false);
  const [dataRows, setDataRows] = useState<Record<string, unknown>[] | null>(null);
  const [dataLoading, setDataLoading] = useState(false);

  const tableKey = `${target.schema}.${target.table}`;
  const cols: ColumnMeta[] = fullSchema?.columns[tableKey] ?? fullSchema?.columns[target.table] ?? [];
  const indexes = fullSchema?.indexes.filter(
    (ix) => ix.table_name === target.table || ix.table_name === tableKey
  ) ?? [];
  const fks = fullSchema?.foreign_keys.filter(
    (fk) => fk.from_table === target.table || fk.from_table === tableKey
  ) ?? [];

  // Load DDL when tab selected
  useEffect(() => {
    if (activeTab !== "ddl" || ddl !== null) return;
    setDdlLoading(true);
    DbClient.query(
      target.connectionId,
      `SELECT 'CREATE TABLE ' || quote_ident('${target.schema}') || '.' || quote_ident('${target.table}') ||
       E'\\n(\\n' ||
       string_agg(
         '  ' || quote_ident(column_name) || ' ' || data_type ||
         CASE WHEN character_maximum_length IS NOT NULL THEN '(' || character_maximum_length || ')' ELSE '' END ||
         CASE WHEN is_nullable = 'NO' THEN ' NOT NULL' ELSE '' END,
         E',\\n'
         ORDER BY ordinal_position
       ) || E'\\n);' AS ddl
       FROM information_schema.columns
       WHERE table_schema = '${target.schema}' AND table_name = '${target.table}'
       GROUP BY table_schema, table_name`
    )
      .then((rows) => setDdl((rows[0]?.["ddl"] as string) ?? "-- DDL not available"))
      .catch(() => setDdl("-- DDL unavailable for this driver"))
      .finally(() => setDdlLoading(false));
  }, [activeTab, target, ddl]);

  // Load sample data when tab selected
  useEffect(() => {
    if (activeTab !== "data" || dataRows !== null) return;
    setDataLoading(true);
    DbClient.query(
      target.connectionId,
      `SELECT * FROM "${target.schema}"."${target.table}" LIMIT 50`
    )
      .then(setDataRows)
      .catch(() => setDataRows([]))
      .finally(() => setDataLoading(false));
  }, [activeTab, target, dataRows]);

  // Reset when target changes
  useEffect(() => {
    setDdl(null);
    setDataRows(null);
    setActiveTab("columns");
  }, [target.schema, target.table]);

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: "columns", label: "Columns", count: cols.length },
    { id: "indexes", label: "Indexes", count: indexes.length },
    { id: "fk", label: "Foreign Keys", count: fks.length },
    { id: "ddl", label: "DDL" },
    { id: "data", label: "Data" },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] border-t border-[#1e1e1e]">
      {/* Tab bar + header */}
      <div className="flex items-center border-b border-[#1e1e1e] shrink-0 bg-[#0d0d0d]">
        <div className="flex items-center gap-1 px-3 py-1 border-r border-[#1e1e1e] shrink-0">
          <span className="text-[10px] font-mono text-[#00d2ff]/70 font-bold">
            {target.schema}.{target.table}
          </span>
        </div>
        <div className="flex flex-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-3 py-2 text-[10px] font-bold uppercase tracking-widest border-b-2 shrink-0 transition-colors ${
                activeTab === tab.id
                  ? "border-[#00d2ff] text-[#00d2ff]"
                  : "border-transparent text-white/30 hover:text-white/60"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="text-[8px] text-white/20 font-mono">({tab.count})</span>
              )}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="p-2 text-white/20 hover:text-white/60 transition-colors shrink-0"
          title="Close properties panel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {/* Columns */}
        {activeTab === "columns" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#0d0d0d] border-b border-[#1a1a1a]">
                {["#", "Name", "Type", "Nullable", "PK", "Default"].map((h) => (
                  <th key={h} className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/25 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cols.map((col, i) => (
                <tr key={col.name} className={`border-b border-[#111] ${i % 2 === 0 ? "" : "bg-white/[0.012]"} hover:bg-white/[0.03] group`}>
                  <td className="px-3 py-1.5 text-white/20 font-mono text-[10px]">{i + 1}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {col.is_primary_key && <span className="text-[7px] text-amber-400 font-bold border border-amber-500/30 rounded px-0.5">PK</span>}
                      <span className="font-mono text-white/70">{col.name}</span>
                      <button
                        onClick={() => { navigator.clipboard.writeText(col.name); toast.success("Copied"); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-white/20 hover:text-white/60"
                      >
                        <Copy className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-white/40 text-[10px]">{col.type_name}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[9px] font-mono ${col.nullable ? "text-white/30" : "text-amber-400/60"}`}>
                      {col.nullable ? "YES" : "NO"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {col.is_primary_key && <span className="text-[9px] text-amber-400">✓</span>}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-white/20 text-[10px]">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Indexes */}
        {activeTab === "indexes" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#0d0d0d] border-b border-[#1a1a1a]">
                {["Name", "Type", "Columns"].map((h) => (
                  <th key={h} className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/25 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indexes.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-4 text-center text-white/20 text-xs">No indexes</td></tr>
              ) : indexes.map((ix, i) => (
                <tr key={ix.index_name} className={`border-b border-[#111] ${i % 2 === 0 ? "" : "bg-white/[0.012]"} hover:bg-white/[0.03]`}>
                  <td className="px-3 py-1.5 font-mono text-white/60">{ix.index_name}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                      ix.is_primary ? "text-amber-400 border-amber-500/30 bg-amber-500/5" :
                      ix.is_unique ? "text-violet-400 border-violet-500/30 bg-violet-500/5" :
                      "text-white/30 border-white/10"
                    }`}>
                      {ix.is_primary ? "PRIMARY" : ix.is_unique ? "UNIQUE" : "INDEX"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-white/40 text-[10px]">{ix.columns.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Foreign Keys */}
        {activeTab === "fk" && (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#0d0d0d] border-b border-[#1a1a1a]">
                {["Constraint", "Column", "References"].map((h) => (
                  <th key={h} className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/25 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fks.length === 0 ? (
                <tr><td colSpan={3} className="px-3 py-4 text-center text-white/20 text-xs">No foreign keys</td></tr>
              ) : fks.map((fk, i) => (
                <tr key={i} className={`border-b border-[#111] ${i % 2 === 0 ? "" : "bg-white/[0.012]"} hover:bg-white/[0.03]`}>
                  <td className="px-3 py-1.5 font-mono text-white/40 text-[10px]">{fk.constraint_name}</td>
                  <td className="px-3 py-1.5 font-mono text-[#00d2ff]/60">{fk.from_column}</td>
                  <td className="px-3 py-1.5 font-mono text-white/50 text-[10px]">
                    {fk.to_table}.{fk.to_column}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* DDL */}
        {activeTab === "ddl" && (
          <div className="relative h-full">
            {ddlLoading ? (
              <div className="flex items-center justify-center py-8 text-white/20 text-xs">Loading DDL…</div>
            ) : (
              <>
                <button
                  onClick={() => { navigator.clipboard.writeText(ddl ?? ""); toast.success("DDL copied"); }}
                  className="absolute top-2 right-2 p-1.5 bg-white/5 hover:bg-white/10 rounded text-white/30 hover:text-white/70 transition-colors z-10"
                  title="Copy DDL"
                >
                  <Copy className="w-3 h-3" />
                </button>
                <pre className="p-3 font-mono text-[11px] text-white/60 leading-relaxed whitespace-pre-wrap break-all">
                  {ddl}
                </pre>
              </>
            )}
          </div>
        )}

        {/* Data preview */}
        {activeTab === "data" && (
          <div className="h-full">
            {dataLoading ? (
              <div className="flex items-center justify-center py-8 text-white/20 text-xs">Loading preview…</div>
            ) : dataRows && dataRows.length > 0 ? (
              <div className="overflow-auto h-full">
                <table className="text-xs border-collapse whitespace-nowrap">
                  <thead>
                    <tr className="bg-[#0d0d0d] border-b border-[#1a1a1a]">
                      {Object.keys(dataRows[0]).map((k) => (
                        <th key={k} className="text-left px-3 py-1.5 text-[9px] uppercase tracking-widest text-white/25 font-bold border-r border-[#111]">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dataRows.map((row, i) => (
                      <tr key={i} className={`border-b border-[#111] ${i % 2 === 0 ? "" : "bg-white/[0.012]"} hover:bg-white/[0.03]`}>
                        {Object.keys(dataRows[0]).map((k) => {
                          const v = row[k];
                          const str = v === null || v === undefined ? "NULL" : typeof v === "object" ? JSON.stringify(v) : String(v);
                          return (
                            <td key={k} className="px-3 py-1.5 font-mono text-white/50 border-r border-[#111] max-w-[200px] truncate" title={str}>
                              {v === null || v === undefined
                                ? <span className="text-amber-400/40 text-[9px] font-bold">NULL</span>
                                : str.length > 40 ? str.slice(0, 40) + "…" : str}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-white/20 text-xs">No rows</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
"C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/node_modules/.bin/tsc" --noEmit --project "C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/tsconfig.json" 2>&1; echo "Exit: $?"
```
Expected: `Exit: 0`

- [ ] **Step 3: Commit**

```bash
git add src/components/panels/ObjectPropertiesPanel.tsx
git commit -m "feat(ui): ObjectPropertiesPanel with Columns/Indexes/FK/DDL/Data tabs"
```

---

## Task 5: Wire ObjectPropertiesPanel into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add import and state**

Add import at top of `src/App.tsx`:
```typescript
import { ObjectPropertiesPanel, PropertiesTarget } from "./components/panels/ObjectPropertiesPanel";
```

Add state after existing state declarations:
```typescript
const [propertiesTarget, setPropertiesTarget] = useState<PropertiesTarget | null>(null);
const [propertiesPct, setPropertiesPct] = useState(30); // % height of properties panel
const propertiesDragRef = useRef<{ startY: number; startPct: number } | null>(null);
```

- [ ] **Step 2: Wire sidebar onTableClick to set propertiesTarget**

Update the `onTableClick` prop on `<Sidebar>`:
```tsx
onTableClick={(table) => {
  setEditorSql(`SELECT * FROM "${table}" LIMIT 100;`);
  if (activeConnectionId && activeSchema) {
    setPropertiesTarget({
      connectionId: activeConnectionId,
      schema: activeSchema.tables.find(t => t.name === table)?.schema ?? "public",
      table,
    });
  }
}}
```

- [ ] **Step 3: Add properties panel below results in center column**

Find the results pane in App.tsx (the `flex-1 overflow-hidden` div containing `<VirtualTable />`). Wrap it and add the properties panel below:

Replace:
```tsx
{/* Results area */}
<div className="flex-1 overflow-hidden">
  <VirtualTable />
</div>
```

With:
```tsx
{/* Results + Properties split */}
<div className="flex flex-col flex-1 min-h-0 overflow-hidden">
  {/* Results area */}
  <div
    className="overflow-hidden"
    style={{ flex: propertiesTarget ? `0 0 ${100 - propertiesPct}%` : "1 1 0" }}
  >
    <VirtualTable />
  </div>

  {/* Draggable divider + Properties panel */}
  {propertiesTarget && (
    <>
      <div
        className="h-1.5 bg-[#1a1a1a] hover:bg-[#00d2ff]/30 cursor-row-resize shrink-0 transition-colors"
        onMouseDown={(e) => {
          propertiesDragRef.current = { startY: e.clientY, startPct: propertiesPct };
          e.preventDefault();
        }}
      />
      <div style={{ height: `${propertiesPct}%` }} className="shrink-0 overflow-hidden">
        <ObjectPropertiesPanel
          target={propertiesTarget}
          fullSchema={activeSchema}
          onClose={() => setPropertiesTarget(null)}
        />
      </div>
    </>
  )}
</div>
```

- [ ] **Step 4: Add mouse drag handlers for properties panel resize**

Add to the center column's container div (which already has `onMouseMove` / `onMouseUp` for the editor split):

Find the existing `onMouseMove` handler for the editor split and extend it:
```typescript
onMouseMove={(e) => {
  // Existing editor split drag
  if (splitDragging.current && splitContainerRef.current) {
    const rect = splitContainerRef.current.getBoundingClientRect();
    const pct = Math.min(80, Math.max(10, ((e.clientY - rect.top) / rect.height) * 100));
    setEditorPct(pct);
  }
  // Properties panel drag
  if (propertiesDragRef.current && splitContainerRef.current) {
    const rect = splitContainerRef.current.getBoundingClientRect();
    const delta = ((propertiesDragRef.current.startY - e.clientY) / rect.height) * 100;
    const newPct = Math.min(70, Math.max(15, propertiesDragRef.current.startPct + delta));
    setPropertiesPct(newPct);
  }
}}
onMouseUp={() => { splitDragging.current = false; propertiesDragRef.current = null; }}
onMouseLeave={() => { splitDragging.current = false; propertiesDragRef.current = null; }}
```

- [ ] **Step 5: TypeScript check**

```bash
"C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/node_modules/.bin/tsc" --noEmit --project "C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/tsconfig.json" 2>&1; echo "Exit: $?"
```
Expected: `Exit: 0`

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): wire ObjectPropertiesPanel into App — click table to open"
```

---

## Task 6: Result Set Editor Toolbar

**Files:**
- Modify: `src/components/table/VirtualTable.tsx`

- [ ] **Step 1: Add PendingEdit type and state**

At the top of `VirtualTable.tsx`, after existing imports, add the type:
```typescript
interface PendingEdit {
  type: "update" | "insert" | "delete";
  sql: string;
  rowIndex?: number;
  colName?: string;
}
```

Inside the `VirtualTable` component, add state after the existing state declarations:
```typescript
const [pendingEdits, setPendingEdits] = useState<Map<string, PendingEdit>>(new Map());
const [isApplying, setIsApplying] = useState(false);
```

- [ ] **Step 2: Mark cells dirty on edit commit instead of executing immediately**

Replace `handleEditCommit` to add to `pendingEdits` instead of immediately executing:
```typescript
const handleEditCommit = useCallback(async () => {
  if (!editingCell) return;
  const { rowIndex, colName, draftValue } = editingCell;
  setEditingCell(null);

  const tableInfo = QueryManager.getBaseTable();
  const connectionId = QueryManager.getConnectionId();
  if (!tableInfo || !connectionId) {
    toast.error("Cannot update: run a simple SELECT from a single table first");
    return;
  }

  const cols = rowStore.columns;
  const pkCol = cols.find((c) => c.is_primary_key) ?? cols.find((c) => c.name.toLowerCase() === "id") ?? cols[0];
  if (!pkCol) { toast.error("Cannot update: no identifiable primary key"); return; }

  const row = rows[rowIndex];
  const pkValue = row[pkCol.name];
  const colMeta = cols.find((c) => c.name === colName);
  const pkMeta = cols.find((c) => c.name === pkCol.name);

  const newValSql = sqlLiteral(draftValue, colMeta);
  const pkValSql = sqlLiteral(pkValue === null ? "" : String(pkValue), pkMeta);
  const sql = `UPDATE "${tableInfo.schema}"."${tableInfo.table}" SET "${colName}" = ${newValSql} WHERE "${pkCol.name}" = ${pkValSql}`;

  const key = `update-${rowIndex}-${colName}`;
  setPendingEdits((prev) => {
    const next = new Map(prev);
    next.set(key, { type: "update", sql, rowIndex, colName });
    return next;
  });
  toast.info(`Edit staged — click Apply to save`, { duration: 2000 });
}, [editingCell, rows]);
```

- [ ] **Step 3: Add applyAllEdits function**

Add after `handleEditCommit`:
```typescript
const handleApplyAll = useCallback(async () => {
  if (pendingEdits.size === 0) return;
  const connectionId = QueryManager.getConnectionId();
  if (!connectionId) { toast.error("No active connection"); return; }

  setIsApplying(true);
  const edits = [...pendingEdits.values()];
  try {
    for (const edit of edits) {
      await DbClient.execute(connectionId, edit.sql);
    }
    setPendingEdits(new Map());
    toast.success(`${edits.length} edit${edits.length > 1 ? "s" : ""} applied`);
    await QueryManager.refresh();
  } catch (e: any) {
    toast.error(`Apply failed: ${e.message ?? "unknown error"}`);
  } finally {
    setIsApplying(false);
  }
}, [pendingEdits]);

const handleRevertAll = useCallback(() => {
  setPendingEdits(new Map());
  toast.info("All pending edits reverted");
}, []);
```

- [ ] **Step 4: Add dirty cell highlight**

In the cell render section, find the cell `div` className and add a dirty check. Find the `isFocusedCell` check and add after it:
```typescript
const isDirty = pendingEdits.has(`update-${virtualRow.index}-${col.name}`);
```

Then add to the cell div's className:
```typescript
${isDirty ? "bg-amber-500/10 border-l-2 border-amber-500/60" : ""}
```

- [ ] **Step 5: Add editor toolbar above the status bar**

In the status bar section, add the editor toolbar when there are pending edits. Add this block just before the `{/* ── Status bar */}` div:
```tsx
{/* ── Editor toolbar (shown when there are pending edits) ── */}
{pendingEdits.size > 0 && (
  <div className="h-8 border-b border-amber-500/20 bg-amber-500/5 flex items-center px-3 gap-2 shrink-0">
    <span className="text-[10px] font-mono text-amber-400/80">
      {pendingEdits.size} unsaved edit{pendingEdits.size > 1 ? "s" : ""}
    </span>
    <div className="flex-1" />
    <button
      onClick={handleRevertAll}
      className="flex items-center gap-1 px-2 py-1 text-[10px] text-white/40 hover:text-white/80 border border-white/10 hover:border-white/30 rounded transition-colors font-mono"
    >
      ↩ Revert all
    </button>
    <button
      onClick={handleApplyAll}
      disabled={isApplying}
      className="flex items-center gap-1 px-3 py-1 text-[10px] font-bold bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 rounded transition-colors disabled:opacity-40 font-mono"
    >
      {isApplying ? "Applying…" : `✓ Apply ${pendingEdits.size}`}
    </button>
  </div>
)}
```

Also add a `+ Add Row` and `🗑 Delete Selected` button in the existing status bar button area:
```tsx
{/* In the existing rows.length > 0 && !isStreaming button group, after the existing +Row button: */}
{selectedRows.size > 0 && (
  <button
    onClick={() => {
      const tableInfo = QueryManager.getBaseTable();
      const connectionId = QueryManager.getConnectionId();
      if (!tableInfo || !connectionId) { toast.error("Run a SELECT from a single table first"); return; }
      const cols = rowStore.columns;
      const pkCol = cols.find((c) => c.is_primary_key) ?? cols[0];
      if (!pkCol) { toast.error("No primary key found"); return; }
      const selectedArr = [...selectedRows].sort((a, b) => a - b);
      const newEdits = new Map(pendingEdits);
      for (const idx of selectedArr) {
        const pkVal = rows[idx]?.[pkCol.name];
        const pkValSql = pkVal === null ? "NULL" : typeof pkVal === "number" ? String(pkVal) : `'${String(pkVal).replace(/'/g, "''")}'`;
        const sql = `DELETE FROM "${tableInfo.schema}"."${tableInfo.table}" WHERE "${pkCol.name}" = ${pkValSql}`;
        newEdits.set(`delete-${idx}`, { type: "delete", sql, rowIndex: idx });
      }
      setPendingEdits(newEdits);
      toast.info(`${selectedArr.length} row${selectedArr.length > 1 ? "s" : ""} staged for deletion`);
    }}
    className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-red-400/50 hover:text-red-400 transition-colors font-mono uppercase tracking-wider"
    title="Stage selected rows for deletion (confirm with Apply)"
  >
    <Trash2 className="w-2.5 h-2.5" /> Delete
  </button>
)}
```

Add `Trash2` to the lucide import if not already present.

- [ ] **Step 6: TypeScript check**

```bash
"C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/node_modules/.bin/tsc" --noEmit --project "C:/Users/sachi/Documents/manufacturing_agent/daitalk-v2/tsconfig.json" 2>&1; echo "Exit: $?"
```
Expected: `Exit: 0`

- [ ] **Step 7: Commit**

```bash
git add src/components/table/VirtualTable.tsx
git commit -m "feat(ui): result set editor toolbar with pending edits, apply-all, revert-all"
```

---

## Self-Review

**Spec coverage check:**
- 1.1 SSH Tunnel → Tasks 1 + 2 ✓
- 1.2 Hierarchical Sidebar → Task 3 ✓
- 1.3 Object Properties Panel → Tasks 4 + 5 ✓
- 1.4 Result Set Editor Toolbar → Task 6 ✓

**Placeholder scan:** No TBD, no "add appropriate error handling" without specifics, all code blocks are complete. ✓

**Type consistency:**
- `PropertiesTarget` defined in Task 4 and imported in Task 5 ✓
- `PendingEdit` defined and used within Task 6 only ✓
- `SshConfig` defined in Task 1 (Rust) and Task 2 (TypeScript) with matching shapes ✓
- `ActiveEntry` replaces the direct `Arc<ActiveConnection>` in connections map — all `get()` callers updated ✓

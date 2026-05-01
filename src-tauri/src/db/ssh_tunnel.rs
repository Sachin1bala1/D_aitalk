//! SSH port-forward tunnel for database connections.
//!
//! Opens an SSH session, binds a random local TCP port, and proxies every
//! connection on that port through an SSH channel to the real DB host:port.
//! Each forwarded connection opens its own SSH session to avoid libssh2 thread-safety issues.

use ssh2::Session;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

use super::types::{SshAuth, SshConfig};

pub struct SshTunnel {
    pub local_port: u16,
    _stop: Arc<AtomicBool>,
}

fn make_session(cfg: &SshConfig) -> Result<Session, String> {
    let tcp = TcpStream::connect(format!("{}:{}", cfg.host, cfg.port))
        .map_err(|e| format!("SSH connect to {}:{} failed: {e}", cfg.host, cfg.port))?;

    let mut sess = Session::new()
        .map_err(|e| format!("SSH session init failed: {e}"))?;
    sess.set_tcp_stream(tcp);
    sess.handshake()
        .map_err(|e| format!("SSH handshake failed: {e}"))?;

    match &cfg.auth {
        SshAuth::Password { password } => {
            sess.userauth_password(&cfg.username, password)
                .map_err(|e| format!("SSH password auth failed: {e}"))?;
        }
        SshAuth::Key { key_path, passphrase } => {
            sess.userauth_pubkey_file(
                &cfg.username,
                None,
                Path::new(key_path),
                passphrase.as_deref(),
            )
            .map_err(|e| format!("SSH key auth failed: {e}"))?;
        }
    }

    if !sess.authenticated() {
        return Err("SSH authentication failed".into());
    }

    Ok(sess)
}

impl SshTunnel {
    /// Open a local port-forward to `remote_host:remote_port` via SSH.
    /// Returns the local port number that the DB pool should connect to.
    pub fn open(cfg: &SshConfig, remote_host: &str, remote_port: u16) -> Result<Self, String> {
        // Verify credentials once before accepting connections
        let _ = make_session(cfg)?;

        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Local port bind failed: {e}"))?;
        let local_port = listener.local_addr().unwrap().port();

        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = Arc::clone(&stop);
        let cfg_clone = cfg.clone();
        let remote_host = remote_host.to_string();

        thread::spawn(move || {
            for stream in listener.incoming() {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                let Ok(local) = stream else { break };
                let cfg = cfg_clone.clone();
                let rh = remote_host.clone();

                thread::spawn(move || {
                    proxy_one_connection(local, &cfg, &rh, remote_port);
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

fn proxy_one_connection(mut local: TcpStream, cfg: &SshConfig, remote_host: &str, remote_port: u16) {
    let Ok(sess) = make_session(cfg) else { return };
    sess.set_blocking(false);
    let Ok(mut ch) = sess.channel_direct_tcpip(remote_host, remote_port, None) else { return };

    // Use non-blocking reads on both sides to avoid thread-per-direction overhead.
    // Writes remain blocking to guarantee delivery.
    local.set_nonblocking(true).ok();

    let mut buf = [0u8; 8192];

    loop {
        let mut activity = false;

        // SSH channel → local TCP
        match ch.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                activity = true;
                local.set_nonblocking(false).ok();
                let r = local.write_all(&buf[..n]);
                local.set_nonblocking(true).ok();
                if r.is_err() {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // local TCP → SSH channel
        match local.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                activity = true;
                sess.set_blocking(true);
                let r = ch.write_all(&buf[..n]);
                sess.set_blocking(false);
                if r.is_err() {
                    break;
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        if !activity {
            thread::sleep(Duration::from_micros(500));
        }
    }
}

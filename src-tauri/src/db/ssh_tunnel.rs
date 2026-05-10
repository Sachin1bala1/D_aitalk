//! SSH port-forward tunnel using libssh2.
//!
//! Opens a local TCP listener on a random port and forwards all connections
//! through an SSH tunnel to `remote_host:remote_port`.
//!
//! Each accepted local TCP connection creates a completely fresh SSH session
//! (TCP connect + handshake + auth + channel_direct_tcpip).  This avoids the
//! libssh2 session-level thread-safety issue: libssh2 is not thread-safe at
//! the Session level, so sharing one Session across threads is UB.

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;

use ssh2::Session;

use super::types::{SshAuth, SshConfig};

pub struct SshTunnel {
    pub local_port: u16,
    shutdown_tx: std::sync::mpsc::Sender<()>,
    _listener_handle: std::thread::JoinHandle<()>,
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        // Signal the listener thread to stop
        let _ = self.shutdown_tx.send(());
        // Wake up the listener's blocking accept() by connecting to it
        let _ = TcpStream::connect(format!("127.0.0.1:{}", self.local_port));
    }
}

impl SshTunnel {
    pub fn open(config: &SshConfig, remote_host: &str, remote_port: u16) -> Result<Self, String> {
        // 1. Bind a random local port
        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Local bind failed: {}", e))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Local addr error: {}", e))?
            .port();

        let config = Arc::new(config.clone());
        let remote_host: Arc<str> = Arc::from(remote_host);

        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();

        // 2. Spawn a thread to accept connections and forward them
        let handle = std::thread::spawn(move || {
            for stream in listener.incoming() {
                // Check for shutdown signal before handling each connection
                if shutdown_rx.try_recv().is_ok() {
                    break;
                }
                let Ok(local_stream) = stream else { break };
                let config = Arc::clone(&config);
                let remote_host = Arc::clone(&remote_host);
                std::thread::spawn(move || {
                    forward_connection(local_stream, config, remote_host, remote_port);
                });
            }
        });

        Ok(SshTunnel { local_port, shutdown_tx, _listener_handle: handle })
    }
}

/// Write all bytes in `buf` to `channel`, retrying on WouldBlock.
///
/// `write_all` treats `WouldBlock` as a fatal error when the SSH channel is in
/// non-blocking mode.  This helper retries instead.
fn write_all_retry(channel: &mut ssh2::Channel, mut buf: &[u8]) -> io::Result<()> {
    while !buf.is_empty() {
        match channel.write(buf) {
            Ok(0) => return Err(io::Error::new(io::ErrorKind::WriteZero, "channel closed")),
            Ok(n) => buf = &buf[n..],
            Err(ref e) if e.kind() == io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Bidirectional forward: local TCP socket <-> SSH direct-tcpip channel.
///
/// Creates a fresh SSH session per connection so that libssh2 session state
/// is never shared between threads.
fn forward_connection(
    mut local: TcpStream,
    config: Arc<SshConfig>,
    remote_host: Arc<str>,
    remote_port: u16,
) {
    // 1. Connect TCP to SSH server
    let tcp = match TcpStream::connect(format!("{}:{}", config.host, config.port)) {
        Ok(t) => t,
        Err(_) => return,
    };

    // 2. Create SSH session
    let mut session = match Session::new() {
        Ok(s) => s,
        Err(_) => return,
    };
    session.set_tcp_stream(tcp);
    if session.handshake().is_err() {
        return;
    }

    // 3. Authenticate
    let authed = match &config.auth {
        SshAuth::Password { password } => {
            session.userauth_password(&config.username, password).is_ok()
        }
        SshAuth::Key { key_path, passphrase } => {
            let path = std::path::Path::new(key_path);
            session
                .userauth_pubkey_file(&config.username, None, path, passphrase.as_deref())
                .is_ok()
        }
    };
    if !authed || !session.authenticated() {
        return;
    }

    // 4. Open direct-tcpip channel
    let mut channel = match session.channel_direct_tcpip(&remote_host, remote_port, None) {
        Ok(c) => c,
        Err(_) => return,
    };

    // 5. Enable non-blocking mode and pump data bidirectionally
    session.set_blocking(false);
    let _ = local.set_nonblocking(true);

    let mut buf = [0u8; 4096];
    loop {
        let mut activity = false;

        // local -> channel
        match local.read(&mut buf) {
            Ok(0) => break, // local closed
            Ok(n) => {
                activity = true;
                if write_all_retry(&mut channel, &buf[..n]).is_err() {
                    break;
                }
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        // channel -> local
        match channel.read(&mut buf) {
            Ok(0) => break, // remote closed
            Ok(n) => {
                activity = true;
                if local.write_all(&buf[..n]).is_err() {
                    break;
                }
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => {}
            Err(_) => break,
        }

        if channel.eof() {
            break;
        }

        if !activity {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    // Drop handles cleanup; skip wait_close() in non-blocking mode as it can
    // block indefinitely.
    let _ = channel.close();
}

//! SSH port-forward tunnel — stub.
//! Real implementation deferred until libssh2 build toolchain is confirmed.

use super::types::{SshConfig};

pub struct SshTunnel {
    pub local_port: u16,
}

impl SshTunnel {
    pub fn open(_cfg: &SshConfig, _remote_host: &str, _remote_port: u16) -> Result<Self, String> {
        Err("SSH tunnel support is not yet available in this build".into())
    }
}

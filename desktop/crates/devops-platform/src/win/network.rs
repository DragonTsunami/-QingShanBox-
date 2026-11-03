use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

use devops_core::{
    DnsLookupResult, NetworkInterface, NetworkProbe, OpsError, OpsResult, PortCheckResult,
};
use sysinfo::Networks;

pub struct NetworkProbeImpl;

impl NetworkProbe for NetworkProbeImpl {
    fn interfaces(&self) -> OpsResult<Vec<NetworkInterface>> {
        let networks = Networks::new_with_refreshed_list();
        let mut result = Vec::new();

        for (name, data) in &networks {
            let mut ipv4 = Vec::new();
            let mut ipv6 = Vec::new();
            for network in data.ip_networks() {
                match network.addr {
                    IpAddr::V4(address) => ipv4.push(address.to_string()),
                    IpAddr::V6(address) => ipv6.push(address.to_string()),
                }
            }

            let is_loopback = ipv4.iter().all(|ip| ip.starts_with("127."))
                || name.to_ascii_lowercase().contains("loopback");
            if is_loopback {
                continue;
            }

            result.push(NetworkInterface {
                name: name.to_string(),
                mac: data.mac_address().to_string(),
                ipv4,
                ipv6,
                is_loopback,
                is_up: !data.ip_networks().is_empty(),
                total_received: data.total_received(),
                total_transmitted: data.total_transmitted(),
            });
        }

        result.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(result)
    }

    fn check_port(&self, host: &str, port: u16, timeout_ms: u64) -> OpsResult<PortCheckResult> {
        if host.trim().is_empty() {
            return Err(OpsError::InvalidInput("主机地址不能为空".into()));
        }
        if port == 0 {
            return Err(OpsError::InvalidInput("端口必须大于 0".into()));
        }

        let timeout = Duration::from_millis(timeout_ms.clamp(200, 10_000));
        let started = Instant::now();

        let addresses: Vec<_> = (host, port)
            .to_socket_addrs()
            .map_err(|error| OpsError::InvalidInput(format!("无法解析主机 {host}: {error}")))?
            .collect();

        let mut last_error = None;
        let mut open = false;
        for address in addresses {
            match TcpStream::connect_timeout(&address, timeout) {
                Ok(_) => {
                    open = true;
                    break;
                }
                Err(error) => last_error = Some(error),
            }
        }

        Ok(PortCheckResult {
            host: host.to_string(),
            port,
            open,
            latency_ms: started.elapsed().as_millis(),
            error: if open {
                None
            } else {
                Some(
                    last_error
                        .map(|error| error.to_string())
                        .unwrap_or_else(|| "没有可用地址".into()),
                )
            },
        })
    }

    fn resolve(&self, host: &str) -> OpsResult<DnsLookupResult> {
        if host.trim().is_empty() {
            return Err(OpsError::InvalidInput("主机地址不能为空".into()));
        }

        let started = Instant::now();
        match (host, 0u16).to_socket_addrs() {
            Ok(addresses) => {
                let mut resolved: Vec<String> =
                    addresses.map(|addr| addr.ip().to_string()).collect();
                resolved.sort();
                resolved.dedup();
                Ok(DnsLookupResult {
                    host: host.to_string(),
                    addresses: resolved,
                    latency_ms: started.elapsed().as_millis(),
                    error: None,
                })
            }
            Err(error) => Ok(DnsLookupResult {
                host: host.to_string(),
                addresses: Vec::new(),
                latency_ms: started.elapsed().as_millis(),
                error: Some(error.to_string()),
            }),
        }
    }
}

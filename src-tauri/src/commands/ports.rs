use std::net::{IpAddr, Ipv4Addr, TcpStream, UdpSocket};
use std::time::Duration;

#[tauri::command]
pub fn test_port_local(port: u16) -> bool {
    // Try to connect to the port on localhost
    let addr = format!("127.0.0.1:{}", port);
    TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_secs(2),
    )
    .is_ok()
}

#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    // Try to find the local IP by connecting to an external address
    // This doesn't actually send any data, just determines which interface would be used
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket.connect("8.8.8.8:80").map_err(|e| e.to_string())?;
    let local_addr = socket.local_addr().map_err(|e| e.to_string())?;

    match local_addr.ip() {
        IpAddr::V4(ip) => Ok(ip.to_string()),
        IpAddr::V6(_) => {
            // Fallback to localhost if only IPv6
            Ok(Ipv4Addr::new(127, 0, 0, 1).to_string())
        }
    }
}

#[tauri::command]
pub async fn get_public_ip() -> Result<String, String> {
    // Use ipify API to get public IP
    let response = reqwest::get("https://api.ipify.org")
        .await
        .map_err(|e| format!("Failed to fetch public IP: {}", e))?;

    let ip = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(ip.trim().to_string())
}

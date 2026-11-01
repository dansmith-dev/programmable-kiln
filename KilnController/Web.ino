// ---------- Web control ----------
// Joins your home WiFi (set in arduino_secrets.h) and serves the kiln over HTTP on port 80.

const unsigned long WIFI_CHECK_MS = 5000UL;

WiFiServer webServer(80);
bool wifiModulePresent = false;
bool wifiConnected = false;
unsigned long lastWifiCheckMs = 0;

// ---------- Called from the main sketch ----------

void WebSetup() {
  if (WiFi.status() == WL_NO_MODULE) {
    Serial.println("WiFi module not found, web control disabled");
    return;
  }
  wifiModulePresent = true;
  if (strlen(SECRET_SSID) == 0) {
    Serial.println("No WiFi network set in arduino_secrets.h, web control disabled");
    wifiModulePresent = false;
    return;
  }

  Serial.print("Joining WiFi ");
  Serial.println(SECRET_SSID);
  WiFi.begin(SECRET_SSID, SECRET_PASS);   // waits up to 10 seconds
  CheckWifi(millis());
}

void WebLoop() {
  if (!wifiModulePresent) return;
  unsigned long now = millis();

  if (now - lastWifiCheckMs >= WIFI_CHECK_MS) {
    lastWifiCheckMs = now;
    CheckWifi(now);
  }
  if (!wifiConnected) return;

  WiFiClient client = webServer.available();
  if (!client) return;
  // Answer every request with the placeholder page for now
  unsigned long start = millis();
  while (client.connected() && millis() - start < 200) {
    if (client.available()) client.read();
  }
  SendPlaceholder(client);
  client.stop();
}

// ---------- WiFi ----------

void CheckWifi(unsigned long now) {
  bool connected = WiFi.status() == WL_CONNECTED;
  if (connected) {
    IPAddress ip = WiFi.localIP();
    if (ip[0] == 0) connected = false;     // joined but no address from the router yet
  }

  if (connected && !wifiConnected) {
    wifiConnected = true;
    webServer.begin();
    Serial.print("Web control at http://");
    Serial.println(WiFi.localIP());
  } else if (!connected && wifiConnected) {
    wifiConnected = false;
    Serial.println("WiFi lost");
  }
}

// ---------- HTTP ----------

void SendPlaceholder(WiFiClient &c) {
  c.print("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n"
          "<!doctype html><meta name=\"viewport\" content=\"width=device-width\"><title>Kiln</title>"
          "<h1>Kiln</h1><p>Web control is on its way.</p>");
}

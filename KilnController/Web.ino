// ---------- Web control ----------
// Joins your home WiFi (set in arduino_secrets.h) and serves the kiln over HTTP on port 80.

const unsigned long WIFI_CHECK_MS = 5000UL;
const unsigned long REQUEST_TIMEOUT_MS = 2000UL;
const unsigned int MAX_BODY = 600;

WiFiServer webServer(80);
bool wifiModulePresent = false;
bool wifiConnected = false;
unsigned long lastWifiCheckMs = 0;
String ipText = "";

// The request being handled
String reqMethod = "";
String reqPath = "";
String reqBody = "";

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
  if (ReadRequest(client)) {
    HandleRequest(client);
  }
  client.stop();
}

String WebAddressText() {
  if (!wifiModulePresent) return "";
  if (!wifiConnected) return "WiFi offline";
  return "Web " + ipText;
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
    ipText = WiFi.localIP().toString();
    Serial.print("Web control at http://");
    Serial.println(ipText);
    RefreshRunPage();
  } else if (!connected && wifiConnected) {
    wifiConnected = false;
    ipText = "";
    Serial.println("WiFi lost");
    RefreshRunPage();
  }
}

// ---------- HTTP ----------

// Reads the request line, the headers we care about and the body into the req* globals
bool ReadRequest(WiFiClient &c) {
  reqMethod = "";
  reqPath = "";
  reqBody = "";

  unsigned long start = millis();
  String line = "";
  bool firstLine = true;
  bool headersDone = false;
  long contentLength = 0;

  while (!headersDone && millis() - start < REQUEST_TIMEOUT_MS) {
    if (!c.available()) {
      if (!c.connected()) return false;
      WDT.refresh();
      continue;
    }
    char ch = c.read();
    if (ch == '\r') continue;
    if (ch != '\n') {
      if (line.length() < 200) line += ch;
      continue;
    }

    if (firstLine) {
      int s1 = line.indexOf(' ');
      int s2 = line.indexOf(' ', s1 + 1);
      if (s1 < 0 || s2 < 0) return false;
      reqMethod = line.substring(0, s1);
      reqPath = line.substring(s1 + 1, s2);
      int q = reqPath.indexOf('?');
      if (q >= 0) reqPath = reqPath.substring(0, q);
      firstLine = false;
    } else if (line.length() == 0) {
      headersDone = true;
    } else {
      int colon = line.indexOf(':');
      if (colon > 0) {
        String name = line.substring(0, colon);
        name.toLowerCase();
        String value = line.substring(colon + 1);
        value.trim();
        if (name == "content-length") contentLength = value.toInt();
      }
    }
    line = "";
  }
  if (!headersDone) return false;

  if (contentLength < 0 || contentLength > (long)MAX_BODY) {
    SendError(c, 400, "Request too large");
    return false;
  }
  while ((long)reqBody.length() < contentLength && millis() - start < REQUEST_TIMEOUT_MS) {
    if (c.available()) {
      reqBody += (char)c.read();
    } else {
      if (!c.connected()) break;
      WDT.refresh();
    }
  }
  return (long)reqBody.length() == contentLength;
}

void HandleRequest(WiFiClient &c) {
  bool get = reqMethod == "GET";
  bool post = reqMethod == "POST";

  if (get && (reqPath == "/" || reqPath == "/index.html")) { SendPlaceholder(c); return; }

  if (!reqPath.startsWith("/api/")) { SendError(c, 404, "Not found"); return; }

  if (get && reqPath == "/api/status") {
    SendJson(c, 200, StatusJson());
  } else {
    SendError(c, 404, "Not found");
  }
}

const char *StatusText(int code) {
  switch (code) {
    case 200: return "OK";
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 409: return "Conflict";
    case 410: return "Gone";
    case 429: return "Too Many Requests";
    default:  return "Error";
  }
}

// length < 0 means no Content-Length; the body then ends when the connection closes
void SendHead(WiFiClient &c, int code, const char *type, long length, bool gzip) {
  String h = "HTTP/1.1 " + String(code) + " " + StatusText(code) + "\r\n";
  h += "Content-Type: ";
  h += type;
  h += "\r\n";
  if (length >= 0) h += "Content-Length: " + String(length) + "\r\n";
  if (gzip) h += "Content-Encoding: gzip\r\n";
  h += "Cache-Control: no-store\r\nConnection: close\r\n\r\n";
  c.print(h);
}

void SendJson(WiFiClient &c, int code, const String &json) {
  SendHead(c, code, "application/json", json.length(), false);
  c.print(json);
}

void SendError(WiFiClient &c, int code, const String &message) {
  SendJson(c, code, "{\"error\":\"" + message + "\"}");
}

void SendPlaceholder(WiFiClient &c) {
  c.print("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n"
          "<!doctype html><meta name=\"viewport\" content=\"width=device-width\"><title>Kiln</title>"
          "<h1>Kiln</h1><p>Web control is on its way.</p>");
}

String StatusJson() {
  unsigned long now = millis();
  long totalRemaining = 0;
  if (state == Running) {
    int next = completedStepCount;
    if (stepStarted) {
      totalRemaining = lastRemainingMs / 1000UL;
      next++;
    }
    for (int i = next; i < stepCount; i++) totalRemaining += steps[i].DurationMins * 60L;
  }

  String faultText = faultReason;
  faultText.replace("\"", "'");

  String json = "{\"state\":\"" + StateText() + "\"";
  json += ",\"temp\":" + String(lastTemp, 1);
  json += ",\"heater\":";
  json += heaterOn ? "true" : "false";
  json += ",\"fault\":\"" + faultText + "\"";
  json += ",\"step\":" + String(completedStepCount);
  json += ",\"stepCount\":" + String(stepCount);
  json += ",\"setpoint\":" + String(lastSetpoint, 1);
  json += ",\"stepRemaining\":" + String(state == Running ? lastRemainingMs / 1000UL : 0UL);
  json += ",\"totalRemaining\":" + String(totalRemaining);
  json += ",\"elapsed\":" + String(state == Running ? (now - firingStartMs) / 1000UL : 0UL);
  json += ",\"maxTemp\":" + String(MAX_SAFE_TEMP, 0);
  json += ",\"rssi\":" + String(WiFi.RSSI());
  json += "}";
  return json;
}

// ---------- Web control ----------
// Serves the web page and a small JSON API on port 80 over your home WiFi.
//
// Pairing: a browser asks for a code, the kiln shows a 6-digit code on the Run page,
// and once the code is typed into the browser it gets a token that it sends with every
// request (X-Kiln-Token header). Tokens are kept in EEPROM so paired browsers survive
// a power cut. Type FORGETWEB in the Serial Monitor to unpair every browser.

const unsigned long PAIR_CODE_MS = 3UL * 60UL * 1000UL;   // how long a code stays valid
const unsigned long PAIR_COOLDOWN_MS = 10UL * 1000UL;     // minimum gap between new codes
const int PAIR_MAX_ATTEMPTS = 5;                           // wrong guesses before the code is cancelled
const int MAX_WEB_DEVICES = 4;                             // oldest is replaced when a 5th pairs
const int TOKEN_BYTES = 16;
const int TOKEN_EEPROM_ADDR = 256;                         // the program uses bytes 0-121
const uint8_t TOKEN_MARKER = 0x5A;
const unsigned long WIFI_CHECK_MS = 5000UL;
const unsigned long HISTORY_INTERVAL_MS = 60UL * 1000UL;  // one sample a minute...
const int HISTORY_SIZE = 1440;                             // ...for 24 hours
const unsigned long REQUEST_TIMEOUT_MS = 2000UL;
const unsigned int MAX_BODY = 600;

WiFiServer webServer(80);
bool wifiModulePresent = false;
bool wifiConnected = false;
unsigned long lastWifiCheckMs = 0;
String ipText = "";

String pairCode = "";
unsigned long pairStartedMs = 0;
bool pairEverStarted = false;
int pairAttemptsLeft = 0;

uint8_t webTokens[MAX_WEB_DEVICES][TOKEN_BYTES];
uint8_t nextTokenSlot = 0;

int16_t historyTemp[HISTORY_SIZE];
int16_t historySetpoint[HISTORY_SIZE];   // -1 when not firing
int historyCount = 0;
int historyNext = 0;
unsigned long lastHistoryMs = 0;
bool historyStarted = false;

// The request being handled
String reqMethod = "";
String reqPath = "";
String reqToken = "";
String reqBody = "";

// ---------- Called from the main sketch ----------

void WebSetup() {
  LoadWebTokens();
  randomSeed(analogRead(A0) ^ ((long)analogRead(A1) << 10) ^ ((long)analogRead(A2) << 20) ^ micros());

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

  if (WebPairingActive() && now - pairStartedMs > PAIR_CODE_MS) {
    EndPairing();
  }

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

bool WebPairingActive() {
  return pairCode.length() > 0;
}

String WebPairingCode() {
  return pairCode;
}

String WebAddressText() {
  if (!wifiModulePresent) return "";
  if (!wifiConnected) return "WiFi offline";
  return "Web " + ipText;
}

void ForgetAllWebDevices() {
  memset(webTokens, 0, sizeof(webTokens));
  nextTokenSlot = 0;
  SaveWebTokens();
}

void ClearHistory() {
  historyCount = 0;
  historyNext = 0;
  historyStarted = false;   // take a sample straight away
}

void RecordHistory(float temp, unsigned long now) {
  if (historyStarted && now - lastHistoryMs < HISTORY_INTERVAL_MS) return;
  historyStarted = true;
  lastHistoryMs = now;
  historyTemp[historyNext] = (int16_t)lround(temp);
  historySetpoint[historyNext] = state == Running ? (int16_t)lround(lastSetpoint) : -1;
  historyNext = (historyNext + 1) % HISTORY_SIZE;
  if (historyCount < HISTORY_SIZE) historyCount++;
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

// ---------- Pairing ----------

void StartPairing(WiFiClient &c) {
  unsigned long now = millis();
  if (WebPairingActive()) {
    unsigned long left = (PAIR_CODE_MS - (now - pairStartedMs)) / 1000UL;
    SendJson(c, 200, "{\"seconds\":" + String(left) + "}");
    return;
  }
  if (pairEverStarted && now - pairStartedMs < PAIR_COOLDOWN_MS) {
    SendError(c, 429, "Please wait a few seconds and try again");
    return;
  }

  long n = (random(1000000L) + (long)(micros() % 1000000UL)) % 1000000L;
  String code = String(n);
  while (code.length() < 6) code = "0" + code;

  pairCode = code;
  pairStartedMs = now;
  pairEverStarted = true;
  pairAttemptsLeft = PAIR_MAX_ATTEMPTS;
  Serial.println("Web pairing code " + pairCode);

  // Make sure the code is on screen
  currentPage = "Run";
  SendScreen("page Run");
  RefreshRunPage();

  SendJson(c, 200, "{\"seconds\":" + String(PAIR_CODE_MS / 1000UL) + "}");
}

void EndPairing() {
  pairCode = "";
  RefreshRunPage();
}

void FinishPairing(WiFiClient &c) {
  String code = reqBody;
  code.trim();

  if (!WebPairingActive()) {
    SendError(c, 410, "No code is showing on the kiln. Ask for a new one.");
    return;
  }
  if (code != pairCode) {
    pairAttemptsLeft--;
    if (pairAttemptsLeft <= 0) {
      EndPairing();
      SendError(c, 403, "Too many wrong codes. Ask for a new one.");
    } else {
      SendJson(c, 403, "{\"error\":\"That code doesn't match\",\"left\":" + String(pairAttemptsLeft) + "}");
    }
    return;
  }

  uint8_t *slot = webTokens[nextTokenSlot];
  for (int i = 0; i < TOKEN_BYTES; i++) {
    slot[i] = (uint8_t)((random(256) ^ (micros() >> (i % 8))) & 0xFF);
  }
  slot[0] |= 1;   // never all zeros, which means an empty slot
  String token = TokenToHex(slot);
  nextTokenSlot = (nextTokenSlot + 1) % MAX_WEB_DEVICES;
  SaveWebTokens();
  EndPairing();
  Serial.println("Web browser paired");

  SendJson(c, 200, "{\"token\":\"" + token + "\"}");
}

// Index of the slot holding the request's token, or -1
int FindToken() {
  if (reqToken.length() != TOKEN_BYTES * 2) return -1;
  uint8_t wanted[TOKEN_BYTES];
  for (int i = 0; i < TOKEN_BYTES; i++) {
    int hi = HexValue(reqToken[i * 2]);
    int lo = HexValue(reqToken[i * 2 + 1]);
    if (hi < 0 || lo < 0) return -1;
    wanted[i] = (uint8_t)(hi * 16 + lo);
  }
  for (int s = 0; s < MAX_WEB_DEVICES; s++) {
    if (SlotEmpty(s)) continue;
    if (memcmp(webTokens[s], wanted, TOKEN_BYTES) == 0) return s;
  }
  return -1;
}

bool SlotEmpty(int s) {
  for (int i = 0; i < TOKEN_BYTES; i++) {
    if (webTokens[s][i] != 0) return false;
  }
  return true;
}

int HexValue(char ch) {
  if (ch >= '0' && ch <= '9') return ch - '0';
  if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
  if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
  return -1;
}

String TokenToHex(const uint8_t *bytes) {
  const char *digits = "0123456789abcdef";
  String out = "";
  for (int i = 0; i < TOKEN_BYTES; i++) {
    out += digits[bytes[i] >> 4];
    out += digits[bytes[i] & 0x0F];
  }
  return out;
}

void LoadWebTokens() {
  uint8_t marker = 0;
  EEPROM.get(TOKEN_EEPROM_ADDR, marker);
  if (marker != TOKEN_MARKER) {
    memset(webTokens, 0, sizeof(webTokens));
    nextTokenSlot = 0;
    return;
  }
  EEPROM.get(TOKEN_EEPROM_ADDR + 1, nextTokenSlot);
  if (nextTokenSlot >= MAX_WEB_DEVICES) nextTokenSlot = 0;
  for (int s = 0; s < MAX_WEB_DEVICES; s++) {
    for (int i = 0; i < TOKEN_BYTES; i++) {
      webTokens[s][i] = EEPROM.read(TOKEN_EEPROM_ADDR + 2 + s * TOKEN_BYTES + i);
    }
  }
}

void SaveWebTokens() {
  EEPROM.put(TOKEN_EEPROM_ADDR, TOKEN_MARKER);
  EEPROM.put(TOKEN_EEPROM_ADDR + 1, nextTokenSlot);
  for (int s = 0; s < MAX_WEB_DEVICES; s++) {
    for (int i = 0; i < TOKEN_BYTES; i++) {
      EEPROM.update(TOKEN_EEPROM_ADDR + 2 + s * TOKEN_BYTES + i, webTokens[s][i]);
    }
    WDT.refresh();             // EEPROM writes are slow, keep the watchdog happy
  }
}

// ---------- HTTP ----------

// Reads the request line, the headers we care about and the body into the req* globals
bool ReadRequest(WiFiClient &c) {
  reqMethod = "";
  reqPath = "";
  reqToken = "";
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
        else if (name == "x-kiln-token") reqToken = value;
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
  if (post && reqPath == "/api/pair/start") { StartPairing(c); return; }
  if (post && reqPath == "/api/pair") { FinishPairing(c); return; }

  if (!reqPath.startsWith("/api/")) { SendError(c, 404, "Not found"); return; }

  int slot = FindToken();
  if (slot < 0) { SendError(c, 401, "Not paired"); return; }

  if (get && reqPath == "/api/status") {
    SendJson(c, 200, StatusJson());
  } else if (get && reqPath == "/api/program") {
    SendJson(c, 200, ProgramJson());
  } else if (post && reqPath == "/api/program") {
    if (state == Running) SendError(c, 409, "Stop the firing before changing the program");
    else if (!ReplaceProgram(reqBody)) SendError(c, 400, "The program has an invalid step");
    else SendJson(c, 200, ProgramJson());
  } else if (get && reqPath == "/api/history") {
    SendHistory(c);
  } else if (post && reqPath == "/api/start") {
    if (state == Fault) SendError(c, 409, "Clear the fault with Stop first");
    else if (stepCount == 0) SendError(c, 409, "There's no program to run");
    else {
      StartFiring();
      SendJson(c, 200, StatusJson());
    }
  } else if (post && reqPath == "/api/stop") {
    StopFiring();
    SendJson(c, 200, StatusJson());
  } else if (post && reqPath == "/api/unpair") {
    memset(webTokens[slot], 0, TOKEN_BYTES);
    SaveWebTokens();
    SendJson(c, 200, "{}");
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
  json += ",\"maxSteps\":" + String(MAX_STEPS);
  json += ",\"programVersion\":" + String(programVersion);
  json += ",\"rssi\":" + String(WiFi.RSSI());
  json += "}";
  return json;
}

String ProgramJson() {
  String json = "{\"version\":" + String(programVersion) + ",\"steps\":[";
  for (int i = 0; i < stepCount; i++) {
    if (i > 0) json += ",";
    json += "[" + String((int)steps[i].StepType) + "," + String(steps[i].TargetTemp) + ","
          + String(steps[i].DurationMins) + "]";
  }
  json += "]}";
  return json;
}

// {"interval":60,"age":12,"temp":[...],"set":[...]} oldest first; "age" is seconds since the newest sample
void SendHistory(WiFiClient &c) {
  SendHead(c, 200, "application/json", -1, false);
  unsigned long age = historyStarted ? (millis() - lastHistoryMs) / 1000UL : 0;
  String chunk = "{\"interval\":" + String(HISTORY_INTERVAL_MS / 1000UL) + ",\"age\":" + String(age) + ",\"temp\":[";
  int first = (historyNext - historyCount + HISTORY_SIZE) % HISTORY_SIZE;

  for (int pass = 0; pass < 2; pass++) {
    int16_t *values = pass == 0 ? historyTemp : historySetpoint;
    if (pass == 1) chunk += "],\"set\":[";
    for (int k = 0; k < historyCount; k++) {
      if (k > 0) chunk += ",";
      chunk += String(values[(first + k) % HISTORY_SIZE]);
      if (chunk.length() > 900) {
        c.print(chunk);
        chunk = "";
        WDT.refresh();
      }
    }
  }
  chunk += "]}";
  c.print(chunk);
}

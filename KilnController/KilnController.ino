#include <Adafruit_MAX31855.h>

const int SSR_PIN = 3;

float setpoint = 0;            // degrees C, 0 keeps the heater off
unsigned long lastCheck = 0;
String usbBuffer = "";

Adafruit_MAX31855 thermocouple(13, 10, 12);

// SET,600 to hold 600C, OFF to switch off
void HandleCommand(const String &cmd) {
  if (cmd.startsWith("SET,")) setpoint = cmd.substring(4).toFloat();
  else if (cmd == "OFF") setpoint = 0;
  Serial.print("Setpoint ");
  Serial.println(setpoint);
}

// Reads newline-terminated commands from the Serial Monitor
void ReadCommands(Stream &port, String &buffer) {
  while (port.available()) {
    char c = port.read();
    if (c == '\n' || c == '\r') {
      buffer.trim();
      if (buffer.length() > 0) HandleCommand(buffer);
      buffer = "";
    } else if (buffer.length() < 40) {
      buffer += c;
    }
  }
}

void setup() {
  pinMode(SSR_PIN, OUTPUT);
  digitalWrite(SSR_PIN, LOW);
  Serial.begin(9600);
  thermocouple.begin();
}

void loop() {
  ReadCommands(Serial, usbBuffer);

  unsigned long now = millis();
  if (now - lastCheck < 1000) {
    return;
  }
  lastCheck = now;

  float currentTemp = thermocouple.readCelsius();
  if (isnan(currentTemp)) {
    digitalWrite(SSR_PIN, LOW);
    Serial.println("Thermocouple fault");
    return;
  }

  bool heat = currentTemp < setpoint;
  digitalWrite(SSR_PIN, heat ? HIGH : LOW);

  Serial.print("Temp ");
  Serial.print(currentTemp);
  Serial.print("  target ");
  Serial.print(setpoint);
  Serial.println(heat ? "  heater ON" : "  heater off");
}

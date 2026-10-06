#include <Adafruit_MAX31855.h>

unsigned long lastCheck = 0;

Adafruit_MAX31855 thermocouple(13, 10, 12);

void setup() {
  Serial.begin(9600);
  thermocouple.begin();
}

void loop() {
  unsigned long now = millis();
  if (now - lastCheck < 1000) {
    return;
  }
  lastCheck = now;

  float currentTemp = thermocouple.readCelsius();
  if (isnan(currentTemp)) {
    Serial.println("Thermocouple fault");
    return;
  }
  Serial.print("Temp ");
  Serial.println(currentTemp);
}

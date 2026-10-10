#include <Adafruit_MAX31855.h>
#include <EEPROM.h>
#include <WDT.h>

enum Type : uint8_t {
  Ramp = 0,
  Hold = 1
};

enum State {
  Idle,
  Running,
  Finished,
  Fault
};

// What the user programs. This is what gets saved to EEPROM.
struct Step {
  Type StepType;
  uint16_t TargetTemp;     // degrees C
  uint16_t DurationMins;
};

// Safety limits: adjust to suit your kiln
const float MAX_SAFE_TEMP = 1300.0;                       // never heat above this
const int MAX_BAD_READINGS = 3;                           // bad readings in a row before faulting
const unsigned long NO_RISE_MS = 10UL * 60UL * 1000UL;    // heater on this long...
const float NO_RISE_MIN = 5.0;                            // ...must raise the temp at least this much
const unsigned long OFF_RISE_MS = 10UL * 60UL * 1000UL;   // heater off this long...
const float OFF_RISE_MAX = 30.0;                          // ...must not rise more than this
const unsigned long MAX_FIRING_MS = 24UL * 60UL * 60UL * 1000UL;

const int SSR_PIN = 3;
const int MAX_STEPS = 20;
const uint8_t SAVE_MARKER = 0xA5;

// The program
Step steps[MAX_STEPS];
int stepCount = 0;

// Firing state
State state = Idle;
String faultReason = "";
int completedStepCount = 0;
bool stepStarted = false;
unsigned long stepStartMs = 0;
float stepStartTemp = 0;
unsigned long firingStartMs = 0;
float lastSetpoint = 0;
unsigned long lastRemainingMs = 0;

// Sensor and heater state
unsigned long lastCheck = 0;
int badReadings = 0;
float lastTemp = 0;
bool heaterOn = false;
unsigned long heaterChangedMs = 0;
float heaterChangedTemp = 0;

String usbBuffer = "";

Adafruit_MAX31855 thermocouple(13, 10, 12);

// ---------- Saving ----------

void SaveSteps() {
  int addr = 0;
  EEPROM.put(addr, SAVE_MARKER);
  addr += sizeof(SAVE_MARKER);
  EEPROM.put(addr, (uint8_t)stepCount);
  addr += sizeof(uint8_t);
  for (int i = 0; i < stepCount; i++) {
    EEPROM.put(addr, steps[i]);
    addr += sizeof(Step);
    WDT.refresh();             // EEPROM writes are slow, keep the watchdog happy
  }
}

void LoadSteps() {
  uint8_t marker = 0;
  uint8_t count = 0;
  EEPROM.get(0, marker);
  EEPROM.get(1, count);
  stepCount = 0;
  if (marker != SAVE_MARKER || count > MAX_STEPS) {
    return;                    // nothing saved yet
  }

  int addr = 2;
  for (int i = 0; i < count; i++) {
    Step s;
    EEPROM.get(addr, s);
    addr += sizeof(Step);
    if (s.StepType > Hold || s.TargetTemp > MAX_SAFE_TEMP || s.DurationMins == 0) {
      break;                   // corrupt entry, keep the steps before it
    }
    steps[stepCount] = s;
    stepCount++;
  }
}

// ---------- Editing the program ----------

// args is "type,temp,mins", e.g. "0,600,120"
void SaveEditedStep(const String &args) {
  int c1 = args.indexOf(',');
  int c2 = args.indexOf(',', c1 + 1);
  if (c1 < 0 || c2 < 0) return;

  long type = args.substring(0, c1).toInt();
  long temp = args.substring(c1 + 1, c2).toInt();
  long mins = args.substring(c2 + 1).toInt();
  if (temp < 0 || temp > MAX_SAFE_TEMP || mins <= 0 || mins > 65535) {
    return;                    // out of range, ignore
  }

  Step s = {type == 1 ? Hold : Ramp, (uint16_t)temp, (uint16_t)mins};
  if (stepCount >= MAX_STEPS) return;
  steps[stepCount] = s;
  stepCount++;
  SaveSteps();
}

// ---------- Firing ----------

// Switches the heater, remembering when and at what temperature it last changed
void SetHeater(bool on, float currentTemp, unsigned long now) {
  if (on != heaterOn) {
    heaterOn = on;
    heaterChangedMs = now;
    heaterChangedTemp = currentTemp;
  }
  digitalWrite(SSR_PIN, on ? HIGH : LOW);
}

// Heater off and stays off until Stop is pressed
void TripFault(const String &reason) {
  digitalWrite(SSR_PIN, LOW);
  heaterOn = false;
  if (state != Fault) {
    state = Fault;
    faultReason = reason;
    Serial.print("FAULT: ");
    Serial.println(reason);
  }
}

void StartFiring() {
  if (state == Running || state == Fault || stepCount == 0) {
    return;
  }
  completedStepCount = 0;
  stepStarted = false;
  firingStartMs = millis();
  heaterOn = false;
  heaterChangedMs = millis();
  heaterChangedTemp = lastTemp;
  state = Running;
  Serial.println("Firing started");
}

void StopFiring() {
  digitalWrite(SSR_PIN, LOW);
  heaterOn = false;
  heaterChangedMs = millis();
  heaterChangedTemp = lastTemp;
  state = Idle;
  faultReason = "";
  Serial.println("Stopped");
}

// Where the target should be right now for this step
float CurrentSetpoint(const Step &step, unsigned long elapsedMs) {
  unsigned long durationMs = step.DurationMins * 60000UL;
  if (step.StepType == Hold || elapsedMs >= durationMs) {
    return step.TargetTemp;
  }
  float progress = (float)elapsedMs / durationMs;
  return stepStartTemp + (step.TargetTemp - stepStartTemp) * progress;
}

// ---------- Commands ----------

void HandleCommand(const String &cmd) {
  if (cmd == "START") StartFiring();
  else if (cmd == "STOP") StopFiring();
  else if (cmd.startsWith("SAVE,")) SaveEditedStep(cmd.substring(5));
  else if (cmd == "CLEAR") {       // from the Serial Monitor: remove every step
    stepCount = 0;
    SaveSteps();
  }
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

// ---------- Main ----------

void setup() {
  pinMode(SSR_PIN, OUTPUT);
  digitalWrite(SSR_PIN, LOW);
  Serial.begin(9600);
  thermocouple.begin();

  LoadSteps();
  Serial.print(stepCount);
  Serial.println(" steps loaded");

  WDT.begin(5000);             // reset the board if loop() stops for 5 seconds
}

void loop() {
  WDT.refresh();
  ReadCommands(Serial, usbBuffer);

  unsigned long now = millis();
  if (now - lastCheck < 1000) {
    return;
  }
  lastCheck = now;

  // Read the temperature, tolerating the odd glitch
  float currentTemp = thermocouple.readCelsius();
  if (isnan(currentTemp)) {
    SetHeater(false, lastTemp, now);
    badReadings++;
    if (badReadings >= MAX_BAD_READINGS) {
      TripFault("Thermocouple fault");
    }
    return;
  }
  badReadings = 0;
  lastTemp = currentTemp;

  // Checks that apply whatever state we're in
  if (currentTemp > MAX_SAFE_TEMP) {
    TripFault("Over temperature");
  }
  if (!heaterOn && now - heaterChangedMs >= OFF_RISE_MS) {
    if (currentTemp - heaterChangedTemp > OFF_RISE_MAX) {
      TripFault("Rising while off");      // relay probably stuck on
    }
    heaterChangedMs = now;
    heaterChangedTemp = currentTemp;
  }

  if (state == Running) {
    RunFiring(currentTemp, now);
  } else {
    digitalWrite(SSR_PIN, LOW);
  }
}

void RunFiring(float currentTemp, unsigned long now) {
  if (now - firingStartMs > MAX_FIRING_MS) {
    TripFault("Firing too long");
    return;
  }

  if (completedStepCount >= stepCount) {
    SetHeater(false, currentTemp, now);
    state = Finished;
    Serial.println("Firing finished");
    return;
  }

  const Step &currentStep = steps[completedStepCount];
  if (!stepStarted) {
    stepStarted = true;
    stepStartMs = now;
    stepStartTemp = currentTemp;
  }

  unsigned long elapsedMs = now - stepStartMs;
  unsigned long durationMs = currentStep.DurationMins * 60000UL;
  lastSetpoint = CurrentSetpoint(currentStep, elapsedMs);
  lastRemainingMs = elapsedMs < durationMs ? durationMs - elapsedMs : 0;

  Serial.print("Step "); Serial.print(completedStepCount + 1);
  Serial.print("  target "); Serial.print(lastSetpoint);
  Serial.print("  actual "); Serial.print(currentTemp);
  Serial.println(heaterOn ? "  heater ON" : "  heater off");

  SetHeater(lastSetpoint > currentTemp, currentTemp, now);

  // Heater on solidly but the kiln isn't warming up
  if (heaterOn && now - heaterChangedMs >= NO_RISE_MS) {
    if (currentTemp - heaterChangedTemp < NO_RISE_MIN) {
      TripFault("No temperature rise");
      return;
    }
    heaterChangedMs = now;
    heaterChangedTemp = currentTemp;
  }

  if (elapsedMs >= durationMs) {
    completedStepCount++;
    stepStarted = false;
  }
}

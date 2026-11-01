#include <Adafruit_MAX31855.h>
#include <EEPROM.h>
#include <WDT.h>
#include <WiFiS3.h>
#include "arduino_secrets.h"

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
const int ROWS = 4;                        // step rows shown on the Program page
const uint16_t SELECTED_COLOUR = 50712;    // light grey
const uint16_t NORMAL_COLOUR = 65535;      // white
const uint8_t SAVE_MARKER = 0xA5;

// The program
Step steps[MAX_STEPS];
int stepCount = 0;

// Program page state
int selected = -1;        // index of the selected step, -1 for none
int scrollOffset = 0;     // index of the step shown in the top row
int editingIndex = -1;    // step being edited, -1 when adding a new one
bool fillEditPending = false;   // fill the Edit page once, not after each keypad entry
String currentPage = "Run";

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
String screenBuffer = "";

Adafruit_MAX31855 thermocouple(13, 10, 12);

// ---------- Screen ----------

void SendScreen(const String &command) {
  Serial1.print(command);
  Serial1.write(0xFF);
  Serial1.write(0xFF);
  Serial1.write(0xFF);
}

void SetScreenText(const String &component, const String &text) {
  SendScreen(component + ".txt=\"" + text + "\"");
}

String StepText(int i) {
  const Step &s = steps[i];
  return String(i + 1) + " " + (s.StepType == Hold ? "Hold " : "Ramp ")
       + String(s.TargetTemp) + "C " + String(s.DurationMins) + "m";
}

String StateText() {
  switch (state) {
    case Running:  return "Running";
    case Finished: return "Finished";
    case Fault:    return "Fault";
    default:       return "Idle";
  }
}

void RefreshRunPage() {
  if (currentPage != "Run") return;

  SetScreenText("tTemp", String(lastTemp, 0));
  SetScreenText("tStatus", StateText());

  if (state == Fault) {
    SetScreenText("tStep", faultReason);
    SetScreenText("tTime", "Press Stop to reset");
    SetScreenText("tTarget", "");
  } else if (state == Running && completedStepCount < stepCount) {
    SetScreenText("tStep", "Step " + String(completedStepCount + 1) + "/" + String(stepCount)
                  + ": " + StepText(completedStepCount).substring(2));
    SetScreenText("tTime", "Remaining " + String(lastRemainingMs / 60000UL) + "m");
    SetScreenText("tTarget", "Target " + String(lastSetpoint, 0));
  } else {
    SetScreenText("tStep", String(stepCount) + " steps programmed");
    SetScreenText("tTime", "");
    SetScreenText("tTarget", "");
  }
}

void RefreshProgramPage() {
  if (currentPage != "Program") return;

  for (int r = 0; r < ROWS; r++) {
    int i = scrollOffset + r;
    String row = "tRow" + String(r);
    SetScreenText(row, i < stepCount ? StepText(i) : "");
    SendScreen(row + ".bco=" + String(i == selected ? SELECTED_COLOUR : NORMAL_COLOUR));
  }
}

void FillEditPage() {
  Step s = {Ramp, 100, 60};    // defaults for a new step
  if (editingIndex >= 0 && editingIndex < stepCount) {
    s = steps[editingIndex];
  }
  SendScreen("bt0.val=" + String(s.StepType == Hold ? 1 : 0));
  SetScreenText("bt0", s.StepType == Hold ? "Hold" : "Ramp");
  SendScreen("nTemp.val=" + String(s.TargetTemp));
  SendScreen("nMins.val=" + String(s.DurationMins));
}

void RefreshPage() {
  if (currentPage == "Run") RefreshRunPage();
  else if (currentPage == "Program") RefreshProgramPage();
  else if (currentPage == "Edit" && fillEditPending) {
    FillEditPage();
    fillEditPending = false;
  }
}

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

void KeepSelectionVisible() {
  if (selected >= 0 && selected < scrollOffset) scrollOffset = selected;
  if (selected >= scrollOffset + ROWS) scrollOffset = selected - ROWS + 1;
  int maxOffset = max(0, stepCount - ROWS);
  if (scrollOffset > maxOffset) scrollOffset = maxOffset;
}

void DeleteSelected() {
  if (selected < 0 || selected >= stepCount) return;
  for (int i = selected; i < stepCount - 1; i++) {
    steps[i] = steps[i + 1];
  }
  stepCount--;
  if (selected >= stepCount) selected = stepCount - 1;
  SaveSteps();
}

void MoveSelected(int direction) {
  int other = selected + direction;
  if (selected < 0 || other < 0 || other >= stepCount) return;
  Step temp = steps[selected];
  steps[selected] = steps[other];
  steps[other] = temp;
  selected = other;
  SaveSteps();
}

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
  if (editingIndex < 0) {
    if (stepCount >= MAX_STEPS) return;
    steps[stepCount] = s;
    selected = stepCount;
    stepCount++;
  } else if (editingIndex < stepCount) {
    steps[editingIndex] = s;
  }
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
    RefreshRunPage();
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
  RefreshRunPage();
}

void StopFiring() {
  digitalWrite(SSR_PIN, LOW);
  heaterOn = false;
  heaterChangedMs = millis();
  heaterChangedTemp = lastTemp;
  state = Idle;
  faultReason = "";
  Serial.println("Stopped");
  RefreshRunPage();
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
  else if (cmd.startsWith("PAGE,")) {
    currentPage = cmd.substring(5);
    RefreshPage();
    return;
  }
  else if (cmd.startsWith("SEL,")) {
    int i = scrollOffset + cmd.substring(4).toInt();
    if (i >= 0 && i < stepCount) selected = i;
  }
  else if (cmd == "SCROLLUP") {
    if (scrollOffset > 0) scrollOffset--;
  }
  else if (cmd == "SCROLLDN") {
    if (scrollOffset + ROWS < stepCount) scrollOffset++;
  }
  else if (state == Running) {
    return;                    // no changes to the program mid-firing
  }
  else if (cmd == "ADD") {
    if (stepCount < MAX_STEPS) {
      editingIndex = -1;
      fillEditPending = true;
      SendScreen("page Edit");
    }
    return;
  }
  else if (cmd == "EDIT") {
    if (selected >= 0 && selected < stepCount) {
      editingIndex = selected;
      fillEditPending = true;
      SendScreen("page Edit");
    }
    return;
  }
  else if (cmd == "DEL") DeleteSelected();
  else if (cmd == "MOVEUP") MoveSelected(-1);
  else if (cmd == "MOVEDN") MoveSelected(1);
  else if (cmd.startsWith("SAVE,")) SaveEditedStep(cmd.substring(5));

  KeepSelectionVisible();
  RefreshProgramPage();
}

// Reads newline-terminated commands from the screen or the Serial Monitor
void ReadCommands(Stream &port, String &buffer) {
  while (port.available()) {
    char c = port.read();
    if (c == '\n' || c == '\r') {
      buffer.trim();
      if (buffer.length() > 0) HandleCommand(buffer);
      buffer = "";
    } else if (c < 32 || c > 126) {
      buffer = "";             // ignore the screen's start-up and error bytes
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
  Serial1.begin(9600);
  thermocouple.begin();

  LoadSteps();
  Serial.print(stepCount);
  Serial.println(" steps loaded");

  WebSetup();                  // joins WiFi, can take up to 10 seconds so it runs before the watchdog starts

  WDT.begin(5000);             // reset the board if loop() stops for 5 seconds
  RefreshRunPage();
}

void loop() {
  WDT.refresh();
  ReadCommands(Serial, usbBuffer);
  ReadCommands(Serial1, screenBuffer);
  WebLoop();

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

  RefreshRunPage();
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

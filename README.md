# Programmable Kiln

A controller for an electric kiln: an Arduino UNO R4 switches the elements through a
solid-state relay, reads the temperature from a K-type thermocouple, and runs ramp/hold
firing programs set up on a Nextion touch screen.

## Hardware

| Part | Connection |
| --- | --- |
| Arduino UNO R4 | |
| MAX31855 thermocouple board | CLK → D13, CS → D10, DO → D12 |
| K-type thermocouple | MAX31855 + / − |
| Solid-state relay (heater) | D3 → SSR input |
| Nextion display | Serial1 (D0/D1), 9600 baud |

> **Mains voltage.** The kiln elements run from mains through the SSR. Get the wiring
> checked by someone qualified, and fit a contactor or thermal fuse that cuts power
> independently of the Arduino.

## Repository layout

| Path | What it is |
| --- | --- |
| `KilnController/` | Arduino sketch (open `KilnController.ino` in the Arduino IDE) |
| `nextion/` | Nextion Editor project (`Kiln.HMI`), fonts and the compiled `Kiln.tft` |

## Building

1. Install the Arduino IDE with the **Arduino UNO R4 Boards** package and the
   **Adafruit MAX31855** library.
2. Open `KilnController/KilnController.ino` and upload it.
3. Copy `nextion/Kiln.tft` to a microSD card and power the screen up with the card in to
   load it. To change the screens, open `nextion/Kiln.HMI` in Nextion Editor.

## Firing programs

A program is up to 20 steps, saved in EEPROM so it survives a power cut.

- **Ramp** moves the target temperature in a straight line from where the step started
  to the step's temperature over its duration.
- **Hold** keeps the target at the step's temperature for its duration.

The heater is switched on whenever the kiln is below the current target.

## Safety checks

The heater is turned off and the kiln goes into **Fault** until Stop is pressed if:

| Check | Limit |
| --- | --- |
| Over temperature | above 1300 °C |
| Thermocouple errors | 3 bad readings in a row |
| No temperature rise | heater on for 10 minutes and less than 5 °C rise |
| Rising while off | heater off for 10 minutes and more than 30 °C rise (stuck relay) |
| Firing too long | over 24 hours |

A 5-second watchdog resets the board, with the heater off, if the code ever hangs.
Limits are constants at the top of `KilnController.ino`.

## Screen commands

The Nextion pages send newline-terminated commands over Serial1. The same commands can be
typed into the Serial Monitor for testing.

| Command | Meaning |
| --- | --- |
| `START` / `STOP` | Start the program / stop and clear a fault |
| `PAGE,<name>` | The screen changed to page `Run`, `Program` or `Edit` |
| `SEL,<row>` | Select a step row on the Program page |
| `SCROLLUP` / `SCROLLDN` | Scroll the step list |
| `ADD` / `EDIT` | Open the Edit page for a new or the selected step |
| `SAVE,<type>,<temp>,<mins>` | Save the step from the Edit page (type 0 ramp, 1 hold) |
| `DEL` / `MOVEUP` / `MOVEDN` | Delete or move the selected step |

The program can't be changed while a firing is running.

// robot.ino - Mega 2560
// Serial: 9600 baud, one line per message, ending in '\n'
//
// Laptop -> Arduino:
//   S:idle (white) | S:listening | S:thinking | S:speaking
//   A:<reason>   (posture, hands, eye_contact, too_fast, too_quiet, filler)
//   L:<text>     (max 16 chars, shown on LCD row 1)
//   H:1 / H:0    (ignored: no arm servo)
// Arduino -> Laptop:
//   P:1          (once per arrival, from the button on pin 2)

#include <LiquidCrystal.h>

// ---------- Pins ----------
const int RED_PIN    = 5;
const int GREEN_PIN  = 6;
const int BLUE_PIN   = 7;
const int BUZZER_PIN = 8;
const int BUTTON_PIN = 2;   // optional; harmless if nothing is connected

LiquidCrystal lcd(22, 23, 24, 25, 26, 27);   // RS, E, D4, D5, D6, D7

// ---------- Settings ----------
const bool COMMON_ANODE  = false;   // true if the LED's common leg goes to 5V
const bool ACTIVE_BUZZER = false;   // true if the buzzer beeps on a steady HIGH
const unsigned long ALERT_MS    = 1500;
const unsigned long BEEP_MS     = 200;
const unsigned long FLASH_MS    = 250;
const unsigned long BUTTON_COOLDOWN_MS = 5000;

const int IDLE_WHITE = 255;   // idle LED brightness, 0-255; lower if too bright

// ---------- State ----------
enum State { IDLE, LISTENING, THINKING, SPEAKING };
State state = IDLE;

String inLine = "";
int fillerCount = 0;

bool alertActive = false;
bool flashOn = false;
unsigned long alertUntil = 0;
unsigned long nextFlash = 0;

bool beepOn = false;
unsigned long beepUntil = 0;

bool lastButton = HIGH;
unsigned long lastArrival = 0;

// ---------- Helpers ----------
void setColor(int r, int g, int b) {
  if (COMMON_ANODE) { r = 255 - r; g = 255 - g; b = 255 - b; }
  analogWrite(RED_PIN, r);
  analogWrite(GREEN_PIN, g);
  analogWrite(BLUE_PIN, b);
}

void lcdRow(int row, String text) {
  if (text.length() > 16) text = text.substring(0, 16);
  while (text.length() < 16) text += ' ';
  lcd.setCursor(0, row);
  lcd.print(text);
}

const char* stateName() {
  switch (state) {
    case LISTENING: return "listening";
    case THINKING:  return "thinking";
    case SPEAKING:  return "speaking";
    default:        return "idle";
  }
}

void drawStatus() {
  char buf[20];
  snprintf(buf, sizeof(buf), "%-10s F:%-3d", stateName(), fillerCount);
  lcdRow(1, String(buf));
}

void applyState() {
  switch (state) {
    case IDLE:      setColor(IDLE_WHITE, IDLE_WHITE, IDLE_WHITE); break;   // white
    case LISTENING: setColor(0, 0, 255);   break;   // blue
    case THINKING:  setColor(255, 140, 0); break;   // yellow
    case SPEAKING:  setColor(0, 255, 0);   break;   // green
  }
  drawStatus();
}

void beepStart() {
  beepOn = true;
  beepUntil = millis() + BEEP_MS;
  if (ACTIVE_BUZZER) digitalWrite(BUZZER_PIN, HIGH);
  else tone(BUZZER_PIN, 2000);
}

void beepStop() {
  beepOn = false;
  if (ACTIVE_BUZZER) digitalWrite(BUZZER_PIN, LOW);
  else noTone(BUZZER_PIN);
}

void startAlert(String reason) {
  alertActive = true;
  alertUntil = millis() + ALERT_MS;
  flashOn = true;
  nextFlash = millis() + FLASH_MS;
  setColor(255, 0, 0);
  beepStart();
  if (reason == "filler") fillerCount++;
  lcdRow(1, "! " + reason);
}

void endAlert() {
  alertActive = false;
  applyState();
}

// ---------- Serial handling ----------
void handleLine(String line) {
  if (line.length() < 2 || line[1] != ':') return;
  char type = line[0];
  String val = line.substring(2);
  val.trim();

  if (type == 'S') {
    if      (val == "idle")      state = IDLE;
    else if (val == "listening") state = LISTENING;
    else if (val == "thinking")  state = THINKING;
    else if (val == "speaking")  state = SPEAKING;
    else return;
    if (val == "idle") fillerCount = 0;
    if (!alertActive) applyState();   // an alert in progress finishes first
  }
  else if (type == 'A') {
    startAlert(val);
  }
  else if (type == 'L') {
    lcdRow(0, val);
  }
  // 'H' (arm servo) is ignored: no servo
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      inLine.trim();
      if (inLine.length() > 0) handleLine(inLine);
      inLine = "";
    } else if (c != '\r') {
      if (inLine.length() < 40) inLine += c;
    }
  }
}

// ---------- Setup / loop ----------
void setup() {
  Serial.begin(9600);
  pinMode(RED_PIN, OUTPUT);
  pinMode(GREEN_PIN, OUTPUT);
  pinMode(BLUE_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  lcd.begin(16, 2);
  lcdRow(0, "Robot ready");
  applyState();
  Serial.println("robot ready");
}

void loop() {
  readSerial();
  unsigned long now = millis();

  // Stop the beep without blocking
  if (beepOn && now >= beepUntil) beepStop();

  // Alert: flash red, then restore the current state
  if (alertActive) {
    if (now >= nextFlash) {
      flashOn = !flashOn;
      if (flashOn) setColor(255, 0, 0);
      else         setColor(0, 0, 0);
      nextFlash = now + FLASH_MS;
    }
    if (now >= alertUntil) endAlert();
  }

  // Button: send P:1 once per press (stands in for the PIR)
  bool button = digitalRead(BUTTON_PIN);
  if (button == LOW && lastButton == HIGH &&
      (lastArrival == 0 || now - lastArrival > BUTTON_COOLDOWN_MS)) {
    Serial.println("P:1");
    lastArrival = now;
  }
  lastButton = button;
}
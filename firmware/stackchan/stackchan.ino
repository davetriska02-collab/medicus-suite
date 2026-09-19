// Medicus Suite — StackChan presence firmware v1.0.0
// Target: M5Stack StackChan (CoreS3, ESP32-S3), Arduino / PlatformIO.
//
// Joins practice Wi-Fi, serves:
//   GET  /           tiny status + Test face buttons (no Suite required)
//   GET  /health     { version, uptimeMs, cmd, camera, mic }
//   POST /cmd        { "cmd": "idle"|"calm"|"alert"|"wait"|"done"|"celebrate"|"listen" }
//   GET  /cmd?cmd=   same, for a browser bar
//
// INFORMATION GOVERNANCE — consulting room
//   Camera is OFF and never initialised. The camera driver is never started.
//   Microphones are OFF and never initialised. The mic driver is never started.
//   Tape over the camera lens anyway. Fail-closed: unknown cmd → idle.
//   There is no code path that opens the mic or camera. Do not add one
//   without a signed IG review.
//
// Wire format (Suite → robot): severity enum + opaque event code only.
// Never parse or display patient names / NHS numbers / free text.

#include <math.h>
#include <M5Unified.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ESP32Servo.h>
#include <Adafruit_NeoPixel.h>

#include "secrets.h"

#ifndef STACKCHAN_CAMERA_ENABLED
#define STACKCHAN_CAMERA_ENABLED 0
#endif
#ifndef STACKCHAN_MIC_ENABLED
#define STACKCHAN_MIC_ENABLED 0
#endif
#ifndef STACKCHAN_MQTT_ENABLED
#define STACKCHAN_MQTT_ENABLED 0
#endif

#if STACKCHAN_CAMERA_ENABLED
#error "Camera must stay off for consulting-room IG. Do not compile with STACKCHAN_CAMERA_ENABLED=1."
#endif
#if STACKCHAN_MIC_ENABLED
#error "Mics must stay muted for consulting-room IG. Do not compile with STACKCHAN_MIC_ENABLED=1."
#endif

static const char *FW_VERSION = "1.0.0";

// StackChan servo board on CoreS3 Port A (G1 pan / G2 tilt) is the common
// kawaii-kit wiring. Override with build flags if your loom differs.
#ifndef SERVO_PIN_PAN
#define SERVO_PIN_PAN 1
#endif
#ifndef SERVO_PIN_TILT
#define SERVO_PIN_TILT 2
#endif
#ifndef LED_PIN
#define LED_PIN 9
#endif
#ifndef LED_COUNT
#define LED_COUNT 12
#endif

#ifndef SERVO_PAN_CENTER
#define SERVO_PAN_CENTER 90
#endif
#ifndef SERVO_TILT_CENTER
#define SERVO_TILT_CENTER 90
#endif

WebServer server(STACKCHAN_HTTP_PORT);
Adafruit_NeoPixel leds(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
Servo servoPan;
Servo servoTilt;

String currentCmd = "idle";
uint32_t lastCmdAt = 0;
bool servosOk = false;
bool ledsOk = false;
uint32_t animPhase = 0;

enum FaceKind { FACE_IDLE, FACE_CALM, FACE_ALERT, FACE_WAIT, FACE_DONE, FACE_CELEBRATE, FACE_LISTEN };

FaceKind faceFromCmd(const String &cmd) {
  if (cmd == "calm") return FACE_CALM;
  if (cmd == "alert") return FACE_ALERT;
  if (cmd == "wait") return FACE_WAIT;
  if (cmd == "done") return FACE_DONE;
  if (cmd == "celebrate") return FACE_CELEBRATE;
  if (cmd == "listen") return FACE_LISTEN;
  return FACE_IDLE;
}

String sanitizeCmd(String raw) {
  raw.toLowerCase();
  raw.trim();
  if (raw == "idle" || raw == "calm" || raw == "alert" || raw == "wait" ||
      raw == "done" || raw == "celebrate" || raw == "listen") {
    return raw;
  }
  return "idle";
}

bool tokenOk() {
  const String expected = String(STACKCHAN_TOKEN);
  if (expected.length() == 0) return true;
  if (server.hasHeader("X-StackChan-Token") && server.header("X-StackChan-Token") == expected) {
    return true;
  }
  if (server.hasArg("token") && server.arg("token") == expected) return true;
  return false;
}

void rejectAuth() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(401, "application/json", "{\"ok\":false,\"error\":\"unauthorized\"}");
}

void addCors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type, X-StackChan-Token");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

// ── Face (M5GFX — no M5Stack-Avatar dependency, compiles on a stock CoreS3) ─

uint16_t rgb565(uint8_t r, uint8_t g, uint8_t b) {
  return M5.Display.color565(r, g, b);
}

void fillLeds(uint8_t r, uint8_t g, uint8_t b) {
  if (!ledsOk) return;
  for (int i = 0; i < LED_COUNT; i++) leds.setPixelColor(i, leds.Color(r, g, b));
  leds.show();
}

void pulseLeds(uint8_t r, uint8_t g, uint8_t b, uint32_t now) {
  if (!ledsOk) return;
  uint8_t wave = (uint8_t)((sin((now % 2000) / 2000.0 * 6.28318) + 1.0) * 90.0 + 20.0);
  fillLeds((uint16_t)r * wave / 200, (uint16_t)g * wave / 200, (uint16_t)b * wave / 200);
}

void rainbowLeds(uint32_t now) {
  if (!ledsOk) return;
  for (int i = 0; i < LED_COUNT; i++) {
    uint16_t hue = (now / 8 + i * (65535 / LED_COUNT)) & 0xFFFF;
    leds.setPixelColor(i, leds.ColorHSV(hue, 255, 140));
  }
  leds.show();
}

void servoWriteSafe(int pan, int tilt) {
  if (!servosOk) return;
  pan = constrain(pan, 20, 160);
  tilt = constrain(tilt, 40, 140);
  servoPan.write(pan);
  servoTilt.write(tilt);
}

void applyMotion(FaceKind face, bool justChanged, uint32_t now) {
  if (!servosOk) return;
  const int cP = SERVO_PAN_CENTER;
  const int cT = SERVO_TILT_CENTER;
  if (face == FACE_IDLE) {
    servoWriteSafe(cP, cT);
    return;
  }
  if (face == FACE_CALM || face == FACE_DONE) {
    if (justChanged) {
      servoWriteSafe(cP, cT - 18);
    } else if (now - lastCmdAt > 400) {
      servoWriteSafe(cP, cT);
    }
    return;
  }
  if (face == FACE_ALERT) {
    int shake = ((now / 90) % 2) ? -14 : 14;
    servoWriteSafe(cP + shake, cT);
    return;
  }
  if (face == FACE_WAIT) {
    int look = ((now / 900) % 2) ? -22 : 22;
    servoWriteSafe(cP + look, cT + 8);
    return;
  }
  if (face == FACE_LISTEN) {
    servoWriteSafe(cP, cT - 22);
    return;
  }
  if (face == FACE_CELEBRATE) {
    int nod = ((now / 220) % 2) ? -24 : 12;
    int wag = ((now / 160) % 2) ? -16 : 16;
    servoWriteSafe(cP + wag, cT + nod);
  }
}

void drawEyes(int cx, int cy, int gap, int r, uint16_t eye, uint16_t pupil, int lookX, int lookY, bool wide) {
  int rr = wide ? r + 4 : r;
  M5.Display.fillCircle(cx - gap, cy, rr, eye);
  M5.Display.fillCircle(cx + gap, cy, rr, eye);
  M5.Display.fillCircle(cx - gap + lookX, cy + lookY, rr / 2, pupil);
  M5.Display.fillCircle(cx + gap + lookX, cy + lookY, rr / 2, pupil);
  M5.Display.fillCircle(cx - gap + lookX - 3, cy + lookY - 3, 3, rgb565(255, 255, 255));
  M5.Display.fillCircle(cx + gap + lookX - 3, cy + lookY - 3, 3, rgb565(255, 255, 255));
}

void drawFace(FaceKind face, uint32_t now) {
  uint16_t bg, cheek, mouth, eye, pupil;
  int lookX = 0, lookY = 0;
  bool wide = false;
  String caption = currentCmd;

  switch (face) {
    case FACE_CALM:
      bg = rgb565(18, 48, 36);
      cheek = rgb565(80, 180, 120);
      mouth = rgb565(40, 200, 120);
      eye = rgb565(240, 248, 240);
      pupil = rgb565(20, 50, 30);
      break;
    case FACE_ALERT:
      bg = rgb565(56, 12, 16);
      cheek = rgb565(200, 40, 50);
      mouth = rgb565(240, 80, 80);
      eye = rgb565(255, 240, 240);
      pupil = rgb565(80, 10, 16);
      wide = true;
      lookX = ((now / 90) % 2) ? -3 : 3;
      break;
    case FACE_WAIT:
      bg = rgb565(48, 32, 8);
      cheek = rgb565(210, 150, 40);
      mouth = rgb565(230, 170, 50);
      eye = rgb565(255, 248, 230);
      pupil = rgb565(70, 40, 10);
      lookX = ((now / 900) % 2) ? -10 : 10;
      break;
    case FACE_DONE:
      bg = rgb565(16, 44, 32);
      cheek = rgb565(90, 200, 130);
      mouth = rgb565(50, 220, 130);
      eye = rgb565(240, 255, 240);
      pupil = rgb565(16, 48, 28);
      lookY = 2;
      break;
    case FACE_CELEBRATE:
      bg = rgb565(36, 16, 52);
      cheek = rgb565(255, 120, 180);
      mouth = rgb565(255, 210, 80);
      eye = rgb565(255, 250, 255);
      pupil = rgb565(50, 20, 70);
      lookY = -2;
      break;
    case FACE_LISTEN:
      bg = rgb565(12, 28, 56);
      cheek = rgb565(80, 140, 220);
      mouth = rgb565(120, 180, 255);
      eye = rgb565(236, 244, 255);
      pupil = rgb565(16, 32, 70);
      lookY = -4;
      break;
    default:
      bg = rgb565(16, 22, 34);
      cheek = rgb565(70, 90, 110);
      mouth = rgb565(140, 160, 180);
      eye = rgb565(230, 236, 244);
      pupil = rgb565(24, 32, 48);
      lookY = 3;
      break;
  }

  M5.Display.fillScreen(bg);

  const int w = M5.Display.width();
  const int h = M5.Display.height();
  const int cx = w / 2;
  const int cy = h / 2 - 8;

  // Head plate
  M5.Display.fillRoundRect(18, 18, w - 36, h - 44, 28, rgb565(8, 10, 16));
  M5.Display.drawRoundRect(18, 18, w - 36, h - 44, 28, cheek);

  drawEyes(cx, cy - 18, 42, 22, eye, pupil, lookX, lookY, wide);

  // Cheeks
  M5.Display.fillCircle(cx - 70, cy + 22, 10, cheek);
  M5.Display.fillCircle(cx + 70, cy + 22, 10, cheek);

  // Mouth
  if (face == FACE_ALERT) {
    M5.Display.fillRoundRect(cx - 22, cy + 38, 44, 8, 3, mouth);
  } else if (face == FACE_LISTEN) {
    M5.Display.fillCircle(cx, cy + 44, 10, mouth);
    M5.Display.fillCircle(cx, cy + 44, 5, bg);
  } else if (face == FACE_WAIT) {
    M5.Display.fillCircle(cx + lookX, cy + 42, 6, mouth);
  } else if (face == FACE_IDLE) {
    M5.Display.fillRoundRect(cx - 16, cy + 40, 32, 6, 3, mouth);
  } else {
    // smile
    M5.Display.fillCircle(cx, cy + 36, 22, mouth);
    M5.Display.fillCircle(cx, cy + 28, 22, rgb565(8, 10, 16));
  }

  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(cheek, bg);
  M5.Display.setTextSize(1);
  M5.Display.drawString(caption, cx, h - 14);
}

void paintForCmd(const String &cmd, bool justChanged) {
  const uint32_t now = millis();
  const FaceKind face = faceFromCmd(cmd);
  drawFace(face, now);
  applyMotion(face, justChanged, now);
  if (face == FACE_ALERT) fillLeds(180, 8, 12);
  else if (face == FACE_WAIT) pulseLeds(200, 120, 10, now);
  else if (face == FACE_CALM || face == FACE_DONE) fillLeds(10, 140, 60);
  else if (face == FACE_LISTEN) pulseLeds(20, 80, 200, now);
  else if (face == FACE_CELEBRATE) rainbowLeds(now);
  else fillLeds(12, 16, 22);
}

void applyCmd(const String &raw, bool fromHttp) {
  const String cmd = sanitizeCmd(raw);
  const bool changed = cmd != currentCmd;
  currentCmd = cmd;
  lastCmdAt = millis();
  paintForCmd(cmd, changed);
  if (fromHttp) {
    Serial.printf("[StackChan] cmd=%s\n", cmd.c_str());
  }
}

String extractJsonCmd(const String &body) {
  int key = body.indexOf("\"cmd\"");
  if (key < 0) key = body.indexOf("\"command\"");
  if (key < 0) return "";
  int colon = body.indexOf(':', key);
  if (colon < 0) return "";
  int q1 = body.indexOf('"', colon + 1);
  if (q1 < 0) return "";
  int q2 = body.indexOf('"', q1 + 1);
  if (q2 < 0) return "";
  return body.substring(q1 + 1, q2);
}

void handleOptions() {
  addCors();
  server.send(204);
}

void handleHealth() {
  if (!tokenOk()) {
    rejectAuth();
    return;
  }
  addCors();
  char buf[256];
  snprintf(
    buf,
    sizeof(buf),
    "{\"ok\":true,\"version\":\"%s\",\"uptimeMs\":%lu,\"cmd\":\"%s\",\"camera\":false,\"mic\":false,\"mqtt\":%s}",
    FW_VERSION,
    (unsigned long)millis(),
    currentCmd.c_str(),
    STACKCHAN_MQTT_ENABLED ? "true" : "false"
  );
  server.send(200, "application/json", buf);
}

String readRequestBody() {
  if (server.hasArg("plain")) return server.arg("plain");
  for (int i = 0; i < server.args(); i++) {
    const String name = server.argName(i);
    if (name.length() == 0 || name == "plain") return server.arg(i);
  }
  return "";
}

void handleCmd() {
  if (!tokenOk()) {
    rejectAuth();
    return;
  }
  addCors();
  String raw = server.hasArg("cmd") ? server.arg("cmd") : "";
  if (raw.length() == 0) raw = extractJsonCmd(readRequestBody());
  applyCmd(raw, true);
  char buf[160];
  snprintf(buf, sizeof(buf), "{\"ok\":true,\"cmd\":\"%s\",\"camera\":false,\"mic\":false}", currentCmd.c_str());
  server.send(200, "application/json", buf);
}

void handleRoot() {
  if (!tokenOk()) {
    rejectAuth();
    return;
  }
  addCors();
  String html = F(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>StackChan — Medicus</title>"
    "<style>body{font-family:system-ui,sans-serif;background:#0b1424;color:#e8eef7;margin:24px}"
    "button{margin:4px;padding:10px 14px;border:0;border-radius:8px;font:600 14px system-ui;cursor:pointer}"
    ".idle{background:#334155;color:#fff}.calm,.done{background:#16a34a;color:#fff}"
    ".alert{background:#dc2626;color:#fff}.wait{background:#b45309;color:#fff}"
    ".celebrate{background:#7c3aed;color:#fff}.listen{background:#2563eb;color:#fff}"
    "code,pre{color:#93c5fd} .ig{color:#fbbf24;max-width:36rem}</style>"
    "<h1>StackChan</h1><p>Medicus Suite desk presence. Camera OFF. Mic OFF.</p>"
    "<p class=ig>Tape over the camera lens. Firmware never opens camera or mics.</p>"
    "<p>Current: <code id=cur></code></p>"
    "<p>"
    "<button class=idle data-c=idle>idle</button>"
    "<button class=calm data-c=calm>calm</button>"
    "<button class=alert data-c=alert>alert</button>"
    "<button class=wait data-c=wait>wait</button>"
    "<button class=done data-c=done>done</button>"
    "<button class=celebrate data-c=celebrate>celebrate</button>"
    "<button class=listen data-c=listen>listen</button>"
    "</p><pre id=out></pre>"
    "<script>"
    "const q=new URLSearchParams(location.search);const tok=q.get('token')||'';"
    "async function health(){const r=await fetch('/health'+(tok?'?token='+encodeURIComponent(tok):''));"
    "const j=await r.json();cur.textContent=j.cmd+'  v'+j.version+'  cam='+j.camera+' mic='+j.mic;}"
    "document.querySelectorAll('button[data-c]').forEach(b=>b.onclick=async()=>{"
    "const r=await fetch('/cmd',{method:'POST',headers:{'Content-Type':'application/json',"
    "'X-StackChan-Token':tok},body:JSON.stringify({v:1,cmd:b.dataset.c,event:'options.test',severity:'none'})});"
    "out.textContent=await r.text();health();});health();"
    "</script>"
  );
  server.send(200, "text/html", html);
}

#if STACKCHAN_MQTT_ENABLED
#include <PubSubClient.h>
#ifndef MQTT_HOST
#define MQTT_HOST ""
#endif
#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif
#ifndef MQTT_TOPIC
#define MQTT_TOPIC "medicus/stackchan/cmd"
#endif
WiFiClient mqttNet;
PubSubClient mqtt(mqttNet);

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String raw;
  for (unsigned int i = 0; i < length; i++) raw += (char)payload[i];
  String cmd = extractJsonCmd(raw);
  if (cmd.length() == 0) cmd = raw;
  applyCmd(cmd, true);
}

void mqttTick() {
  if (String(MQTT_HOST).length() == 0) return;
  if (!mqtt.connected()) {
    mqtt.setServer(MQTT_HOST, MQTT_PORT);
    mqtt.setCallback(mqttCallback);
    mqtt.connect(STACKCHAN_HOSTNAME);
    mqtt.subscribe(MQTT_TOPIC);
  }
  mqtt.loop();
}
#endif

void drawBoot(const char *line) {
  M5.Display.fillScreen(rgb565(8, 12, 22));
  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(rgb565(200, 220, 255), rgb565(8, 12, 22));
  M5.Display.setTextSize(2);
  M5.Display.drawString("Medicus", M5.Display.width() / 2, M5.Display.height() / 2 - 24);
  M5.Display.setTextSize(1);
  M5.Display.drawString("StackChan presence", M5.Display.width() / 2, M5.Display.height() / 2);
  M5.Display.setTextColor(rgb565(251, 191, 36), rgb565(8, 12, 22));
  M5.Display.drawString(line, M5.Display.width() / 2, M5.Display.height() / 2 + 28);
  M5.Display.setTextColor(rgb565(148, 163, 184), rgb565(8, 12, 22));
  M5.Display.drawString("camera OFF  mic OFF", M5.Display.width() / 2, M5.Display.height() / 2 + 48);
}

void setup() {
  auto cfg = M5.config();
  // Hard disable: never start the camera or mic drivers.
  // Do not start the camera or mic drivers anywhere in this sketch.
  cfg.internal_mic = false;
  cfg.internal_spk = false;
  M5.begin(cfg);

  M5.Display.setRotation(1);
  M5.Display.setBrightness(180);
  Serial.begin(115200);
  Serial.println();
  Serial.println("[StackChan] Medicus presence " + String(FW_VERSION));
  Serial.println("[StackChan] CAMERA=OFF MIC=OFF (compile-time + runtime)");

  drawBoot("joining Wi-Fi…");

  leds.begin();
  leds.setBrightness(48);
  leds.clear();
  leds.show();
  ledsOk = true;

  servoPan.setPeriodHertz(50);
  servoTilt.setPeriodHertz(50);
  servoPan.attach(SERVO_PIN_PAN, 500, 2400);
  servoTilt.attach(SERVO_PIN_TILT, 500, 2400);
  servosOk = true;
  servoWriteSafe(SERVO_PAN_CENTER, SERVO_TILT_CENTER);

  if (String(WIFI_SSID) == "YOUR_SSID") {
    drawBoot("edit secrets.h — no Wi-Fi");
    Serial.println("[StackChan] WIFI_SSID is still YOUR_SSID. Copy secrets.h.example → secrets.h");
  } else {
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(STACKCHAN_HOSTNAME);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) {
      delay(250);
      M5.update();
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[StackChan] Wi-Fi %s  http://%s/\n", WiFi.localIP().toString().c_str(), WiFi.localIP().toString().c_str());
    MDNS.begin(STACKCHAN_HOSTNAME);
    drawBoot(WiFi.localIP().toString().c_str());
    delay(800);
  } else {
    Serial.println("[StackChan] Wi-Fi failed — HTTP will not listen on LAN");
    drawBoot("Wi-Fi failed");
    delay(1200);
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/health", HTTP_GET, handleHealth);
  server.on("/cmd", HTTP_OPTIONS, handleOptions);
  server.on("/cmd", HTTP_GET, handleCmd);
  server.on("/cmd", HTTP_POST, handleCmd);
  server.onNotFound([]() {
    addCors();
    applyCmd("idle", true);
    server.send(404, "application/json", "{\"ok\":false,\"cmd\":\"idle\",\"error\":\"unknown\"}");
  });
  server.begin();

  applyCmd("idle", false);
}

void loop() {
  M5.update();
  server.handleClient();
#if STACKCHAN_MQTT_ENABLED
  mqttTick();
#endif
  // Keep wait / alert / celebrate motion alive without a new POST.
  const uint32_t now = millis();
  static uint32_t lastPaint = 0;
  if (now - lastPaint > 80) {
    lastPaint = now;
    const FaceKind face = faceFromCmd(currentCmd);
    if (face == FACE_ALERT || face == FACE_WAIT || face == FACE_CELEBRATE || face == FACE_LISTEN) {
      paintForCmd(currentCmd, false);
    }
  }
  delay(2);
}

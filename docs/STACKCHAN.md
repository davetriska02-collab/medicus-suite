# StackChan ↔ Medicus Suite — desk presence

Flash this tonight. Prove a face change from Suite without anyone on a call.

**Firmware:** `firmware/stackchan/` (ESP32-S3 / M5Stack CoreS3 kawaii kit)  
**Suite:** Options → **StackChan** (default **off**)  
**Shortlist / Emile pitch:** [`docs/medicus-avatar-shortlist.md`](medicus-avatar-shortlist.md)

---

## What it does

Suite POSTs a tiny JSON command to the robot on the practice LAN:

```json
{ "v": 1, "cmd": "alert", "event": "sentinel-severity", "severity": "red", "ts": 1710000000000 }
```

| `cmd` | Face / LEDs / motion (v1) |
|---|---|
| `idle` | Neutral, dim, centred |
| `calm` | Smile, green, one nod |
| `alert` | Wide eyes, red, shake |
| `wait` | Side-glance, amber pulse |
| `done` | Smile, green |
| `celebrate` | Grin, rainbow, nod |
| `listen` | Attentive, blue, lean in |

Unknown `cmd` → **idle**. The robot never opens the camera or the mics.

**Nothing clinical leaves the browser except those four fields.** No patient name, NHS number, chip label, drug, or free text.

---

## Information governance (do this first)

The StackChan kit has a **camera and two mics**. That is the wrong default for a consulting room.

1. **Tape over the camera lens** before you power it on a desk patients can see.
2. Shipped firmware **never calls** `Camera.begin()` or `Mic.begin()`. Compile flags `STACKCHAN_CAMERA_ENABLED` and `STACKCHAN_MIC_ENABLED` are `0`. Turning either on **fails the compile**.
3. `GET /health` reports `"camera": false, "mic": false`.
4. First placement: **reception / back office**. Consulting room only after a practice IG look.
5. Speaker is left off in `M5.config()` (`internal_spk = false`). The unit is a face, not a microphone.

See the shortlist notes on cameras in GP rooms.

---

## Tonight: unbox → face

### 0. What you need

- StackChan (CoreS3 + servo board) and USB-C cable
- Practice Wi-Fi name + password (2.4 GHz — ESP32 will not join 5 GHz-only SSIDs)
- This repo (or the unpacked Suite zip — `firmware/stackchan/` is in the tree)
- Arduino IDE **or** [PlatformIO](https://platformio.org/)
- Chrome / Edge with Medicus Suite loaded unpacked

### 1. Secrets (never commit)

```bash
cd firmware/stackchan
cp secrets.h.example secrets.h
```

Edit `secrets.h`:

```c
#define WIFI_SSID "PracticeStaff"
#define WIFI_PASS "…"
#define STACKCHAN_TOKEN ""          // set a shared string later if you want
#define STACKCHAN_HOSTNAME "stackchan"
```

`secrets.h` is gitignored.

### 2. Libraries + board

**Arduino IDE**

1. Boards Manager → install **M5Stack** (or espressif32) and pick **M5Stack CoreS3**.
2. Library Manager: **M5Unified**, **ESP32Servo**, **Adafruit NeoPixel**.
3. Open `firmware/stackchan/stackchan.ino`.
4. Upload.

**PlatformIO**

```bash
cd firmware/stackchan
pio run -e m5stack-cores3 -t upload
pio device monitor   # optional — prints the IP
```

Servo pins default to CoreS3 Port A (`G1` pan / `G2` tilt), LEDs on `G9` × 12. Override with `-DSERVO_PIN_PAN=…` if your loom differs. A wrong LED pin just means no halo — the face still works.

### 3. Prove the robot without Suite

On boot the face shows **camera OFF / mic OFF**, then the LAN IP (or `Wi-Fi failed`).

From the same Wi-Fi, in a browser:

```
http://<ip>/
```

Click **alert**. The face should go red.  
`http://<ip>/health` should look like:

```json
{ "ok": true, "version": "1.0.0", "uptimeMs": 12345, "cmd": "alert", "camera": false, "mic": false, "mqtt": false }
```

`http://stackchan.local/` works if mDNS is allowed on the LAN.

If Wi-Fi failed: serial 115200 will say so. 5 GHz-only SSIDs and client isolation (guest Wi-Fi) are the usual culprits. The PC and the robot must see each other.

### 4. Point Suite at it

1. Reload the unpacked extension (manifest `3.262.0` or later).
2. Options → **StackChan**.
3. Base URL: `http://192.168.x.x` (no trailing path).
4. Token: only if you set `STACKCHAN_TOKEN`.
5. Click **Save robot settings**. Allow the LAN origin when Chrome/Edge asks.
6. **Test face** → click each expression. The robot should match.
7. **Ping /health** — camera and mic must read `false`.

Leave **Enable StackChan bridge** off until Test face works. Test face does not require the live toggle.

### 5. Turn on a real Suite event

Tick **Enable StackChan bridge**. Keep **Sentinel chip severity** on.

Open a Medicus patient whose Monitoring chips include an overdue / red chip. The robot should go **alert**. A patient with only in-date chips → **calm**. Navigate off the record → **idle**.

Request Monitor (if you already use it): a new medical request → **alert**; admin / replies → **listen**.  
Companion role change: clinic **idle**, reception **listen**, triage **wait**, nursing **calm**.

Quiet / clinic mode: if "Respect quiet" is on, auto events do not move the robot. Test face still does.

---

## Event map (v1 — real Suite surfaces)

| Source | Hook | Command |
|---|---|---|
| Sentinel snapshot | `content-scripts/sentinel.js` publishes statuses only after `publishSnapshot` / invalidate | red → `alert`, amber → `wait`, green → `calm`, none / nav-away → `idle` |
| Request Monitor | `service-worker.js` `freshByBucket` keys after a poll (not the first poll) | `medNew` → `alert`, other fresh → `listen` |
| Companion HUD | `setRole()` in `task-actions-panel.js` | role enum as above |
| Options Test face | `POST /cmd` via the service worker | the button you clicked |

Same command is not re-POSTed within 4 seconds (Test face is exempt). Fetch timeout is 1.5 s. Failures are swallowed — Medicus UI never waits on the robot.

---

## Protocol

`POST /cmd`  
Headers: `Content-Type: application/json`, optional `X-StackChan-Token`.

Also accepted: `GET /cmd?cmd=alert` (and `?token=`).

`GET /health` — version, uptime, current cmd, camera/mic flags.

CORS is open so a laptop browser can hit the device. The Suite path is the service worker (needs the optional host permission you grant in Options).

MQTT is compile-optional (`pio run -e m5stack-cores3-mqtt`) and **off** in v1. Suite does not need a broker.

---

## Security / LAN

- Default off in Suite.
- Optional shared token.
- `optional_host_permissions` — Chrome asks per origin when you save a URL. We do not ship a blanket LAN permission.
- Rejects `javascript:` / credential-in-URL base URLs.
- Do not put this endpoint on the public internet.

---

## Files

| Path | Role |
|---|---|
| `firmware/stackchan/stackchan.ino` | Device sketch |
| `firmware/stackchan/secrets.h.example` | Wi-Fi template |
| `firmware/stackchan/platformio.ini` | PIO env + camera/mic compile guards |
| `shared/stackchan-bridge.js` | Event → command + payload (no PHI) |
| `shared/io/stackchan-io.js` | Backup/restore |
| `options/options.html` | Settings + Test face |
| `service-worker.js` | Fire-and-forget POST |
| `test-stackchan-bridge.js` | Mapping + PHI + firmware source guards |

---

## If it doesn't move

1. Same VLAN? Guest Wi-Fi often blocks device-to-device.
2. Options → Ping /health. Timeout = URL, permission, or the box is asleep.
3. Serial: `[StackChan] cmd=alert` means the HTTP landed.
4. Face works from `http://<ip>/` but not Suite → grant the LAN permission again and reload the extension.
5. Sentinel does nothing → bridge toggle still off, or quiet mode is on, or the snapshot has no chips yet (wait for Monitoring to evaluate).

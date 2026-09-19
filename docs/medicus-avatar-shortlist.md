# Medicus Suite — bodily avatar / physical-presence shortlist

**For:** Dave Triska / Medicus  
**Context:** WhatsApp with Emile Axelrad, 12 Sep 2026 — a cheap, distributable desk presence for UK primary-care practices that can react to Suite software hooks.  
**Researched:** 12 Sep 2026 (Europe/London). Prices are live-cited, VAT-inclusive unless noted. Do not treat USD figures as a UK retail list price.

## Brief (what this list is for)

Emile prefers a **humanoid** form factor for the consulting room. Dave wants something **cheap and distributable** that still has **personality**. Static is fine (figurine / lamp / screen-face / simple animatronic). It must **react** — LED, sound, screen, simple motion — via USB, serial, MQTT, HTTP/webhook, or a cheap smart base. Pure dumb plastic is out unless paired with a smart base.

**Out of scope:** Pollen Robotics microduck (~$399) — learning toy only. Also skipped: Loona Petbot (~£432 on keyirobot.com/en-gb) and Anki/DDL Vector 2.0 (~£190 + paid membership) — too expensive / subscription-tied for practice rollout.

**Primary-care constraint:** anything with a **camera or always-on mic** (StackChan, CoreS3, Echo Show, EMO) needs information-governance review before a consulting room. Reception desks are easier. Camera-less options are marked.

---

## The shortlist

### 1. M5Stack StackChan — M5Stack (UK: The Pi Hut)

| | |
|---|---|
| **Price** | **£95** (StackChan only) or **£120** (with remote). Incl. VAT. [The Pi Hut](https://thepihut.com/products/stackchan-kawaii-co-created-open-source-ai-desktop-robot), 12 Sep 2026. UK-only lithium shipping. |
| **Form factor** | **Simple motion + screen.** ~54×70×62 mm humanoid desk robot. 2.0" 320×240 animated face, two feedback servos (pan 360° / tilt 90°), 12 RGB LEDs, 1 W speaker, dual mics, NFC, IR, USB-C. |
| **Suite hook** | First-class. ESP32-S3 + Wi-Fi. Flash custom firmware (Arduino / PlatformIO / UiFlow2 / ESP-IDF). Drive expressions, LEDs, servos, and audio from **MQTT or a tiny HTTP listener** that Suite (or a practice-side Home Assistant) POSTs to. Official StackChan firmware + community [M5Stack-Avatar](https://github.com/stack-chan/m5stack-avatar) already do faces. |
| **Pros (GP room)** | Closest off-the-shelf match to Emile’s humanoid preference. Personality without looking like a toddler toy. Open hardware, UK stock, no cloud subscription. Quiet enough for a consulting desk if you keep the speaker low. |
| **Cons** | Built-in **camera + mics** — cover the camera / disable in firmware for consulting rooms. £95 is the high end of “cheap distributable”. Battery shipping limits bulk from The Pi Hut. Kawaii aesthetic may not land with every partner. |
| **Distributable?** | **4 / 5** — one SKU, UK stock, USB-C power, firmware-flashable once then cloned. |

---

### 2. Pimoroni Stellar Unicorn (Pico 2 W) — Pimoroni (UK: The Pi Hut)

| | |
|---|---|
| **Price** | **£39** incl. VAT. [The Pi Hut](https://thepihut.com/products/pico-2-w-unicorn), 12 Sep 2026 (11 in stock at fetch). Wider 53×11 **Galactic Unicorn** is **£58.50** ([The Pi Hut](https://thepihut.com/products/pico-2-w-smart-led-matrix-galactic-unicorn-53-x-11-583-pixels)). |
| **Form factor** | **Screen (LED matrix), static.** 16×16 RGB “squircle” face on metal legs, ~108×108 mm, onboard speaker, light sensor, buttons. No limbs. Reads as a glowing pixel-art character, not a toy robot. |
| **Suite hook** | Pico 2 W on board. MicroPython HTTP or MQTT client; Suite POSTs “idle / alert / wait / done” and it draws a face + chirps. No cloud. |
| **Pros (GP room)** | Camera-less. Cheap. Immediate visual personality. UK-made / UK-stocked. Sits on a reception desk without looking like a child’s toy. Easy to brand with a Medicus pixel face. |
| **Cons** | Not bodily / humanoid. Bright LEDs can glare in a dim consulting room (dim in firmware). Micro-USB, not USB-C. |
| **Distributable?** | **5 / 5** — cheapest “has a face” UK SKU that Suite can own end-to-end. |

---

### 3. M5Stack CoreS3 + Avatar firmware — M5Stack (UK: The Pi Hut)

| | |
|---|---|
| **Price** | **£57.60** incl. VAT (CoreS3 + DinBase). [The Pi Hut](https://thepihut.com/products/m5stack-cores3-esp32s3-lot-development-kit), 12 Sep 2026. Lighter **CoreS3 SE** is **£37.40** on the same page if you can live without some sensors. |
| **Form factor** | **Screen-face, static.** 54×54×16 mm cube with a 2.0" touch IPS face. Sit it in a 3D-printed torso/hood to become a desk figurine. Speaker + dual mics + camera onboard. |
| **Suite hook** | Same ESP32-S3 stack as StackChan. Drop in [M5Stack-Avatar](https://github.com/stack-chan/m5stack-avatar) (expressions, lip-sync) and add an MQTT/HTTP command topic. DinBase can wall- or screw-mount. |
| **Pros (GP room)** | Half the price of StackChan, same face software, more “serious cube” than kawaii robot. Easy to drop into a printed Medicus body later. |
| **Cons** | No motion until you add servos. Camera/mics — treat as StackChan for IG. Looks like a dev kit until you case it. |
| **Distributable?** | **4 / 5** — one UK SKU; add a printed hood for personality. |

---

### 4. Energize Lab Eilik — Energize Lab

| | |
|---|---|
| **Price** | **£139.99** on Amazon UK (ASIN [B09XGQMSMB](https://www.amazon.co.uk/dp/B09XGQMSMB)), cited via [PriceSpy](https://pricespy.co.uk/product.php?p=15849448) and [toysreviewed.co.uk](https://toysreviewed.co.uk/product/energize-lab-eilik-robot/) as of research 12 Sep 2026. UK review of 16 May 2026 also had Amazon UK at £139.99 ([AIToys.co.uk](https://www.aitoys.co.uk/reviews/eilik-robot-companion-review)). RobotShop UK listed silver at **£143.84** (in-stock in search results; product page bot-walled). |
| **Form factor** | **Simple motion + OLED face.** ~13 cm seated humanoid, four servos, 128×64 OLED, 3 W speaker, USB-C. Strong idle personality (touch head/belly/back). Works offline — no Wi-Fi required. |
| **Suite hook** | **Weak official IO.** Ships sealed; no documented vendor API. Community reverse-engineered **USB** SDK: [PyEilik](https://github.com/aklto/PyEilik) / [eiliksdk.com](https://eiliksdk.com) can drive servos + screen from a practice PC. That is unofficial and can break on firmware. Robot Studio on energizelab.com is visual programming, not a webhook. |
| **Pros (GP room)** | Best off-the-shelf *personality* under £150. Camera-less. Quiet, desk-stable, not a floor rover. Patients will clock it as a character. |
| **Cons** | Almost no first-party hook — the opposite of what Suite needs unless you accept a USB sidecar and an unofficial protocol. £140 is a lot per room for a toy that Suite cannot reliably own. |
| **Distributable?** | **2 / 5** — easy to buy, hard to *control*. Fine as a one-off demo of “bodily personality”; poor as a Suite endpoint. |

---

### 5. Waveshare ESP32-S3 1.28" round LCD — Waveshare (UK: The Pi Hut / Amazon UK)

| | |
|---|---|
| **Price** | **£15.40** board-only, incl. VAT, in stock (3 at fetch). [The Pi Hut](https://thepihut.com/products/esp32-s3-development-board-with-1-28-ips-round-lcd), 12 Sep 2026. Touch variant **£21.20** ([The Pi Hut](https://thepihut.com/products/esp32-s3-development-board-with-1-28-round-touch-lcd)). Amazon UK touch board **£28.99** ([Amazon.co.uk](https://www.amazon.co.uk/Waveshare-ESP32-S3-Development-Accelerometer-Gyroscope/dp/B0CM68M8LR)). |
| **Form factor** | **Screen-face, static.** 240×240 round IPS “eye” (~32 mm display). Drop it into a 3D-printed head / lamp / figurine and it *is* the face. IMU on board. Camera-less. |
| **Suite hook** | ESP32-S3 + Wi-Fi. Arduino / MicroPython HTTP or MQTT. LVGL or a simple sprite face. USB-C for power and flash. |
| **Pros (GP room)** | Cheapest real *face*. Tiny, quiet, no camera. You own the firmware. Easy to brand. |
| **Cons** | Bare PCB until you case it — not a product you drop on a GP’s desk as-is. Needs a one-time firmware + print. |
| **Distributable?** | **4 / 5** once you have a printed body and a flashed image; **2 / 5** as a raw board. |

---

### 6. WLED “smart base” — Adafruit Mini Sparkle Motion + NeoPixel + printed / shop figurine

| | |
|---|---|
| **Price** | Controller **£18.20** incl. VAT ([The Pi Hut — Mini Sparkle Motion](https://thepihut.com/products/mini-sparkle-motion-wled-friendly-esp32-neopixel-led-driver), 12 Sep 2026). 16-LED NeoPixel ring **£9.60** ([The Pi Hut](https://thepihut.com/products/adafruit-neopixel-ring-16-x-5050-rgb-led-with-integrated-drivers)). Electronics **~£28** before a body. Pair with any cheap desk figurine or a printed torso. |
| **Form factor** | **Static figurine + LED.** The personality is in the glow (cheeks, eyes, halo). Body can be Medicus-branded plastic. |
| **Suite hook** | Best cheap hook in the list. Flash [WLED](https://kno.wled.ge/). Suite (or HA) POSTs JSON to `http://<ip>/json/state` ([WLED JSON API](https://kno.wled.ge/interfaces/json-api/)) or publishes MQTT ([WLED MQTT](https://kno.wled.ge/interfaces/mqtt/)). Native [Home Assistant WLED integration](https://www.home-assistant.io/integrations/wled). Map Suite events → colour / effect / brightness. |
| **Pros (GP room)** | Camera-less. Under £30 electronics. Any aesthetic you print. Battle-tested API. Quiet. |
| **Cons** | No face unless you add an OLED. Looks like a glowing statue, not a colleague, unless the print is good. One-time assembly. |
| **Distributable?** | **4 / 5** after a small assembly jig; **3 / 5** if every practice is expected to solder. Use the pre-soldered terminal-block Mini Sparkle Motion at **£19.20** to avoid soldering. |

---

### 7. IKEA FADO + TP-Link Tapo L530E — IKEA / TP-Link

| | |
|---|---|
| **Price** | FADO globe lamp **£19** ([IKEA UK](https://www.ikea.com/gb/en/p/fado-table-lamp-white-10096375/), 12 Sep 2026; bulb sold separately). Tapo L530E E27 colour bulb **£7.99** ([Tapo UK store](https://uk.store.tapo.com/products/smarthome-tapo-l530e), listed sold-out at fetch) / **£7.99** ([Amazon UK B08GKYYK7X](https://www.amazon.co.uk/TP-Link-Tapo-Required-Colour-Changeable-L530E/dp/B08GKYYK7X)). **~£27** per desk. |
| **Form factor** | **Static lamp.** 25 cm white glass orb. No face, no limbs — a glowing “presence” that patients already understand as furniture. IKEA reviewers routinely run colour smart bulbs in it. |
| **Suite hook** | Tapo cloud app, or local via Home Assistant **TP-Link Smart Home** (enable *Third-party compatibility* in the Tapo app). Suite → HA webhook / MQTT → set RGB. No hub. Note: 2026 L530 firmware 1.4.2 briefly broke HA until third-party compat was toggled ([HA core #167990](https://github.com/home-assistant/core/issues/167990)). |
| **Pros (GP room)** | Cheapest *and* most reception-safe. No camera, no mic, no toy stigma. IKEA is everywhere in the UK. Glass orb looks intentional in a waiting room. |
| **Cons** | Almost no personality — Emile will not call this a humanoid. Glass is fragile (IKEA reviews: smashes if knocked). Colour-only IO. Tapo account + firmware churn. |
| **Distributable?** | **5 / 5** — two high-street SKUs, no soldering, practice staff can assemble. |

*Character-lamp alternative:* IKEA **SOLBO** owl, **£15** ([IKEA UK](https://www.ikea.com/gb/en/p/solbo-table-lamp-white-owl-30325696/)). Bodily, cute, child-safe. Built-in LED (spare bulb is an IKEA part and often unobtainable per reviews) so Suite can only do **on/off** via a smart plug — weaker than FADO+Tapo.

---

### 8. Amazon Echo Show 5 (3rd gen) — Amazon

| | |
|---|---|
| **Price** | **£89.99** [Argos](https://www.argos.co.uk/product/7698848) and [John Lewis](https://www.johnlewis.com/amazon-echo-show-5-3rd-gen-smart-speaker-with-5-5-inch-screen-alexa-voice-recognition-control/p110556129); Amazon UK charcoal listing **£92.24** / white **£89.99** ([amazon.co.uk/echo-show-5-3rd-gen](https://www.amazon.co.uk/echo-show-5-3rd-gen/dp/B09B2SS2G1)), 12 Sep 2026. |
| **Form factor** | **Screen, static.** 5.5" 960×480 desk display + speaker. Can show a full-bleed Medicus face / clock / queue state if you can get content onto it. |
| **Suite hook** | Alexa Routines, smart-home skills, and (awkwardly) a kiosk URL if you live with Amazon’s constraints. Not a first-class webhook device. Needs an Amazon account per device or a managed org. |
| **Pros (GP room)** | Ubiquitous UK stock, staff already know Alexa, large readable face, speaker for call-and-wait. |
| **Cons** | **2 MP camera + mics** with remote live view / Home Monitoring ([Amazon](https://www.amazon.co.uk/echo-show-5-3rd-gen/dp/B09B2R18PG), [Home Monitoring help](https://www.amazon.com/gp/help/customer/display.html?nodeId=G3ZTXBS783ML96QB)). Wrong default for a consulting room unless shutter closed, mics off, *and* IG signed off. Cloud lock-in. Weak programmable personality. Not bodily. |
| **Distributable?** | **3 / 5** — easy to buy, hard to *own* as a Suite endpoint, IG headache. |

---

### 9. LivingAI EMO — LivingAI

| | |
|---|---|
| **Price** | Official store **$279** (~ two-week dispatch), [living.ai/product/emo](https://living.ai/product/emo/), 12 Sep 2026. EMO White **$289**. EMO Go Home **$369**. No reliable UK retail list price found. LivingAI ships internationally; UK buyers should confirm **GBP + VAT + shipping at checkout** (one EU buyer reported $279 + ~$20 shipping; do not treat that as a UK landed quote). |
| **Form factor** | **Simple motion + personality.** Small walking desk pet, LED eyes, headphones/skateboard aesthetic. Bundle includes a mesh “smart light”. |
| **Suite hook** | Closed. App + vendor cloud. The bundled smart light is EMO-controlled, not Suite-controlled. No documented MQTT/webhook. Treat as a consumer toy. |
| **Pros (GP room)** | Real character; patients will talk to it. |
| **Cons** | Import friction, no Suite hook, walks off the desk, camera/sensors, not humanoid, more expensive than StackChan once VAT lands. Same class of problem as the excluded microduck. |
| **Distributable?** | **1 / 5** — do not roll this out to practices. |

---

## “Build it” path — ESP32 + printed torso + LEDs, well under £50

This is the volume play if Dave wants a **Medicus-owned character** rather than a third-party toy.

**BOM from UK stock (The Pi Hut, 12 Sep 2026), camera-less:**

| Part | Price | Source |
|---|---|---|
| Waveshare ESP32-S3 dev board | £9.60 | [The Pi Hut](https://thepihut.com/products/esp32-s3-microcontroller-development-board-1) |
| 0.96" SSD1306 OLED (128×64) | £7.70 | [The Pi Hut](https://thepihut.com/products/0-96inch-oled-display-module) |
| TowerPro SG90 servo (head nod) | £4 | [The Pi Hut servos](https://thepihut.com/collections/servos) |
| Adafruit 16-LED NeoPixel ring | £9.60 | [The Pi Hut](https://thepihut.com/products/adafruit-neopixel-ring-16-x-5050-rgb-led-with-integrated-drivers) |
| **Electronics** | **~£31** | |
| 3D-printed torso / hood | ~£3–8 filament | in-house or a UK print bureau |

**Even cheaper face-only:** Waveshare 1.28" round LCD board at **£15.40** is the whole head — skip the separate OLED.

**Even cheaper glow-only:** Mini Sparkle Motion **£18.20** + ring **£9.60** = **£27.80**, WLED firmware, no compile step after the first image.

**Firmware pattern for Suite:** ESP32 joins practice Wi-Fi → MQTT topics `medicus/<site>/<desk>/cmd` and `/state` (or a single HTTP POST `/event`). Payloads: `idle | greeting | wait | alert | done`. Map to face sprite + LED colour + optional 15° nod. No cloud. Clone the flash image for every unit.

**QBIT** ([github.com/TechVic-1/QBIT](https://github.com/TechVic-1/QBIT)) is a ready-made open-source version of this idea (ESP32-C3 + 128×64 OLED + buzzer + MQTT / Home Assistant discovery). Same parts budget; you inherit their dashboard and poke protocol.

---

## How Suite should talk to any of these

Prefer, in order:

1. **HTTP JSON** on the LAN (WLED `/json/state`, custom ESP32 `/event`) — Suite already speaks webhooks.
2. **MQTT** via a practice-side broker or a small Home Assistant box — one integration, many desks.
3. **USB serial** only as a last resort (Eilik / a tethered Pico) — messy in a GP room.
4. **Vendor clouds** (Alexa, Tapo, LivingAI) — avoid for clinical spaces.

Do **not** put cameras or open mics in consulting rooms without IG. Reception / back office is the right first placement.

---

## Top 3 for Dave

1. **M5Stack StackChan (£95, The Pi Hut)** — the only UK-stock humanoid that Suite can actually own (Wi-Fi, MQTT/HTTP, face, LEDs, nod). Matches Emile’s form-factor ask for a consulting-room prototype; cover the camera.
2. **Pimoroni Stellar Unicorn (£39, The Pi Hut)** — cheapest camera-less “has a face” you can drop on every reception desk this month, fully programmable, no cloud.
3. **IKEA FADO + Tapo L530E (~£27)** — the volume ambient presence: high-street, no toy stigma, colour = Suite state. Pair it with a printed/WLED character later if personality is missing.

**If you want one Medicus-branded body instead of buying characters:** take the **£31 ESP32 + OLED + servo + ring** path (or the **£15.40** round-LCD head), print a small torso, and ship a flashed image. That is how you get “cheap, distributable, with personality” without Eilik’s closed USB or EMO’s import tax.

---

## Quick compare

| # | Option | UK price (cited 12 Sep 2026) | Form | Hook | Camera? | Dist. |
|---|---|---|---|---|---|---|
| 1 | StackChan | £95 Pi Hut | motion + screen | MQTT/HTTP | yes | 4 |
| 2 | Stellar Unicorn | £39 Pi Hut | LED face | MQTT/HTTP | no | 5 |
| 3 | CoreS3 + Avatar | £57.60 Pi Hut | screen cube | MQTT/HTTP | yes | 4 |
| 4 | Eilik | £139.99 Amazon UK | motion + OLED | unofficial USB | no | 2 |
| 5 | Waveshare round LCD | £15.40 Pi Hut | screen eye | MQTT/HTTP | no | 4* |
| 6 | WLED Sparkle + ring | ~£28 Pi Hut | LED figurine | WLED JSON/MQTT | no | 4 |
| 7 | FADO + Tapo L530E | £19 + £7.99 | lamp | HA / Tapo | no | 5 |
| 8 | Echo Show 5 | £89.99 Argos | screen | Alexa | yes | 3 |
| 9 | LivingAI EMO | $279 official | walking pet | closed | sensors | 1 |

\*After a printed body and a flashed image.

---

*Sources checked 12 Sep 2026. Re-check live prices before a bulk order — Amazon and Tapo move weekly.*

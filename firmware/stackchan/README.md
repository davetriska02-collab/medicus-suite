# StackChan firmware (Medicus presence)

Flash notes, IG (camera/mic off), Suite wiring, and tonight's test plan:

**[`docs/STACKCHAN.md`](../../docs/STACKCHAN.md)**

```bash
cp secrets.h.example secrets.h   # then edit SSID / password
pio run -e m5stack-cores3 -t upload
```

Or open `stackchan.ino` in Arduino IDE (board: M5Stack CoreS3).

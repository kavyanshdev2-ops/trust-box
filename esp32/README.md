# ESP32 firmware

The firmware uses the Arduino framework, Wi-Fi, MQTT, TLS (configurable), and configurable sensor adapters. The default firmware sensor adapter is explicitly simulated; no physical sensor or pin assumptions are made.

## Required hardware details before production flashing

Confirm the exact ESP32 board/module, sensor models, wiring or I2C addresses, required sensor ranges, and the Mosquitto broker host/port and CA certificate. Then implement `readConfiguredSensors()` in `firmware/firmware.ino` and set `SIMULATED_SENSOR_MODE` to `0`. No GPIO values are assumed.

## Credentials and flashing

1. Register a device from the authenticated monitoring dashboard.
2. Save the returned MQTT password; it is displayed once.
3. Configure the Mosquitto password file and ACL for that device as documented in the root README.
4. Copy `firmware/secrets.example.h` to `firmware/secrets.h` and fill in Wi-Fi, device, MQTT, and broker CA settings. Do not commit `secrets.h`.
5. Install ArduinoJson 7 and PubSubClient in Arduino IDE's Library Manager.
6. Select the confirmed ESP32 board and port; select 115200 baud and flash `firmware.ino`.
7. Leave `MQTT_TLS` enabled for production. Local plaintext MQTT is suitable only on an isolated development network.

The device publishes `devices/{device_id}/telemetry` and retained online/offline state to `devices/{device_id}/status`. Its MQTT Last Will is the retained offline payload. Time is synchronized by NTP before telemetry is sent.

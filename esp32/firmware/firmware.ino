#include <Arduino.h>
#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <time.h>

#include "secrets.h"

#if MQTT_TLS
#include <WiFiClientSecure.h>
WiFiClientSecure networkClient;
#else
WiFiClient networkClient;
#endif

PubSubClient mqtt(networkClient);
constexpr unsigned long RECONNECT_DELAY_MS = 3000;
unsigned long lastReconnectAttempt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastTelemetryAt = 0;
String telemetryTopic;
String statusTopic;

struct SensorReadings {
  bool hasTemperature = false;
  float temperature = 0;
  bool hasHumidity = false;
  float humidity = 0;
  bool hasShock = false;
  float shock = 0;
};

SensorReadings readConfiguredSensors() {
  SensorReadings readings;
#if SIMULATED_SENSOR_MODE
  readings.hasTemperature = true;
  readings.temperature = 22.0f + static_cast<float>(esp_random() % 600) / 100.0f;
  readings.hasHumidity = true;
  readings.humidity = 45.0f + static_cast<float>(esp_random() % 2000) / 100.0f;
  readings.hasShock = true;
  readings.shock = static_cast<float>(esp_random() % 25) / 100.0f;
#else
  // Implement this adapter using the confirmed sensor model and GPIO/I2C wiring.
#endif
  return readings;
}

String makeStatusPayload(const char* status) {
  JsonDocument document;
  document["device_id"] = DEVICE_ID;
  document["status"] = status;
  time_t now = time(nullptr);
  if (now > 1'700'000'000) {
    struct tm utc;
    gmtime_r(&now, &utc);
    char timestamp[25];
    strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
    document["timestamp"] = timestamp;
  }
  String payload;
  serializeJson(document, payload);
  return payload;
}

bool connectMqtt() {
  const String willPayload = makeStatusPayload("offline");
  if (!mqtt.connect(DEVICE_ID, MQTT_USERNAME, MQTT_PASSWORD, statusTopic.c_str(), 1, true, willPayload.c_str())) {
    return false;
  }
  mqtt.publish(statusTopic.c_str(), makeStatusPayload("online").c_str(), true);
  return true;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < RECONNECT_DELAY_MS) return;
  lastWifiAttempt = millis();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

bool publishTelemetry() {
  const SensorReadings readings = readConfiguredSensors();
  if (!readings.hasTemperature && !readings.hasHumidity && !readings.hasShock) return false;

  JsonDocument document;
  document["device_id"] = DEVICE_ID;
  document["status"] = "online";
  document["simulated"] = SIMULATED_SENSOR_MODE == 1;
  time_t now = time(nullptr);
  if (now <= 1'700'000'000) return false;
  struct tm utc;
  gmtime_r(&now, &utc);
  char timestamp[25];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
  document["timestamp"] = timestamp;
  JsonObject sensors = document["sensors"].to<JsonObject>();
  if (readings.hasTemperature) sensors["temperature"] = readings.temperature;
  if (readings.hasHumidity) sensors["humidity"] = readings.humidity;
  if (readings.hasShock) sensors["shock"] = readings.shock;

  String payload;
  serializeJson(document, payload);
  return mqtt.publish(telemetryTopic.c_str(), payload.c_str(), false);
}

void setup() {
  Serial.begin(115200);
  telemetryTopic = String("devices/") + DEVICE_ID + "/telemetry";
  statusTopic = String("devices/") + DEVICE_ID + "/status";
#if MQTT_TLS
  networkClient.setCACert(MQTT_ROOT_CA);
#endif
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setKeepAlive(30);
  mqtt.setBufferSize(1024);
  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

void loop() {
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) {
    delay(100);
    return;
  }
  if (!mqtt.connected() && millis() - lastReconnectAttempt >= RECONNECT_DELAY_MS) {
    lastReconnectAttempt = millis();
    if (!connectMqtt()) Serial.printf("MQTT connection failed, state=%d\n", mqtt.state());
  }
  mqtt.loop();
  if (mqtt.connected() && millis() - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = millis();
    if (!publishTelemetry()) Serial.println("Telemetry not published; check sensor adapter and time sync.");
  }
  delay(10);
}

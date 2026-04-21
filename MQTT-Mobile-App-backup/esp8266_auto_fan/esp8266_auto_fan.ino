#include <ESP8266WiFi.h>
#include <NTPClient.h>
#include <PubSubClient.h>
#include <WiFiClientSecure.h>
#include <WiFiUdp.h>

const char* WIFI_SSID = "";
const char* WIFI_PASSWORD = "";

const char* MQTT_HOST = "";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USERNAME = "";
const char* MQTT_PASSWORD = "";

const long UTC_OFFSET_SECONDS = 19800;
const unsigned long LOGIC_INTERVAL_MS = 5000UL;
const uint8_t RELAY_PIN = D1;
const bool RELAY_ACTIVE_LOW = true;

const char* MQTT_TOPIC_MODE = "fan/mode";
const char* MQTT_TOPIC_STATE = "fan/state";
const char* MQTT_TOPIC_STATUS = "fan/status";
const char* MQTT_TOPIC_TELEMETRY = "fan/telemetry";

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", UTC_OFFSET_SECONDS, 60000);
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);

unsigned long lastLogicRunMillis = 0;
unsigned long lastChangeMillis = 0;
int prevState = 0;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  Serial.print("MQTT message ignored on topic: ");
  Serial.println(topic);
}

void connectMqtt() {
  while (!mqttClient.connected()) {
    String clientId = "NodeMCU-Fan-" + String(ESP.getChipId(), HEX);

    Serial.print("Connecting to MQTT broker...");
    bool connected = mqttClient.connect(
      clientId.c_str(),
      MQTT_USERNAME,
      MQTT_PASSWORD,
      MQTT_TOPIC_STATUS,
      1,
      true,
      "offline"
    );

    if (connected) {
      Serial.println("connected");
      mqttClient.publish(MQTT_TOPIC_STATUS, "online", true);
      mqttClient.publish(MQTT_TOPIC_MODE, "AUTO", true);
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqttClient.state());
      Serial.println(" retrying in 5 seconds");
      delay(5000);
    }
  }
}

int evaluateDecisionTree(
  int hour,
  int dayOfWeek,
  int previousState,
  unsigned long timeSinceLastChangeMinutes
) {
  int fanState = 0;

  if (previousState == 0) {
    if (hour <= 9) {
      fanState = 0;
    } else {
      if (hour <= 20) {
        if (hour <= 13) {
          fanState = 0;
        } else {
          fanState = 1;
        }
      } else {
        fanState = 0;
      }
    }
  } else {
    if (hour <= 4) {
      if (timeSinceLastChangeMinutes <= 65) {
        if (dayOfWeek <= 2) {
          fanState = 1;
        } else {
          fanState = 0;
        }
      } else {
        fanState = 0;
      }
    } else {
      if (hour <= 22) {
        fanState = 1;
      } else {
        if (timeSinceLastChangeMinutes <= 62) {
          fanState = 1;
        } else {
          fanState = 0;
        }
      }
    }
  }

  return fanState;
}

void writeRelay(int fanState) {
  const int relayLevel = RELAY_ACTIVE_LOW ? (fanState == 1 ? LOW : HIGH) : (fanState == 1 ? HIGH : LOW);
  digitalWrite(RELAY_PIN, relayLevel);
}

void applyFanState(int fanState) {
  if (fanState != prevState) {
    lastChangeMillis = millis();
  }

  writeRelay(fanState);
  prevState = fanState;
}

void publishTelemetry(
  int hour,
  int dayOfWeek,
  int previousState,
  unsigned long timeSinceLastChangeMinutes,
  int fanState
) {
  if (!mqttClient.connected()) {
    return;
  }

  char telemetryPayload[180];
  snprintf(
    telemetryPayload,
    sizeof(telemetryPayload),
    "{\"mode\":\"AUTO\",\"hour\":%d,\"day_of_week\":%d,\"prev_state\":%d,\"time_since_last_change\":%lu,\"fanState\":%d}",
    hour,
    dayOfWeek,
    previousState,
    timeSinceLastChangeMinutes,
    fanState
  );

  mqttClient.publish(MQTT_TOPIC_MODE, "AUTO", true);
  mqttClient.publish(MQTT_TOPIC_STATUS, "online", true);
  mqttClient.publish(MQTT_TOPIC_STATE, fanState == 1 ? "ON" : "OFF", true);
  mqttClient.publish(MQTT_TOPIC_TELEMETRY, telemetryPayload, true);
}

void runAutoControl() {
  if (!timeClient.update()) {
    timeClient.forceUpdate();
  }

  const int hour = timeClient.getHours();
  const int dayOfWeek = timeClient.getDay();
  const int previousState = prevState;
  const unsigned long timeSinceLastChangeMinutes = (millis() - lastChangeMillis) / 60000UL;
  const int fanState = evaluateDecisionTree(
    hour,
    dayOfWeek,
    previousState,
    timeSinceLastChangeMinutes
  );

  applyFanState(fanState);
  publishTelemetry(hour, dayOfWeek, previousState, timeSinceLastChangeMinutes, fanState);

  Serial.print("hour: ");
  Serial.print(hour);
  Serial.print(" | day_of_week: ");
  Serial.print(dayOfWeek);
  Serial.print(" | prev_state: ");
  Serial.print(previousState);
  Serial.print(" | time_since_last_change: ");
  Serial.print(timeSinceLastChangeMinutes);
  Serial.print(" min | fanState: ");
  Serial.println(fanState);
}

void setup() {
  Serial.begin(115200);
  delay(100);

  pinMode(RELAY_PIN, OUTPUT);
  writeRelay(0);
  prevState = 0;
  lastChangeMillis = millis();

  connectWiFi();

  secureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(256);

  timeClient.begin();
  timeClient.forceUpdate();

  connectMqtt();
  publishTelemetry(timeClient.getHours(), timeClient.getDay(), prevState, 0, prevState);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (!mqttClient.connected()) {
    connectMqtt();
  }

  mqttClient.loop();
  timeClient.update();

  const unsigned long currentMillis = millis();
  if (currentMillis - lastLogicRunMillis >= LOGIC_INTERVAL_MS) {
    lastLogicRunMillis = currentMillis;
    runAutoControl();
  }
}

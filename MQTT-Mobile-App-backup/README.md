# Smart Fan MQTT App

This project now has two connected parts:

- An Expo React Native MQTT dashboard in [App.js](/e:/WSN/MQTT-Mobile-App/App.js)
- An ESP8266 NodeMCU sketch in [esp8266_auto_fan.ino](/e:/WSN/MQTT-Mobile-App/esp8266_auto_fan/esp8266_auto_fan.ino)

The NodeMCU controls the relay in full `AUTO` mode using embedded decision-tree logic. The mobile app does not send manual fan commands anymore. It subscribes to live MQTT telemetry and shows the current fan state, mode, and decision inputs.

## MQTT Topics

- `fan/mode`
- `fan/state`
- `fan/status`
- `fan/telemetry`

The ESP8266 publishes telemetry like:

```json
{
  "mode": "AUTO",
  "hour": 16,
  "day_of_week": 1,
  "prev_state": 0,
  "time_since_last_change": 27,
  "fanState": 1
}
```

## Mobile App Setup

Create a `.env` file in `MQTT-Mobile-App`:

```env
EXPO_PUBLIC_HIVEMQ_BROKER_URL=your-cluster.s1.eu.hivemq.cloud
EXPO_PUBLIC_HIVEMQ_PORT=8884
EXPO_PUBLIC_HIVEMQ_USERNAME=your-hivemq-username
EXPO_PUBLIC_HIVEMQ_PASSWORD=your-hivemq-password
```

Run the app:

```powershell
npm install
npx expo start --clear
```

## ESP8266 Setup

Open [esp8266_auto_fan.ino](/e:/WSN/MQTT-Mobile-App/esp8266_auto_fan/esp8266_auto_fan.ino) in Arduino IDE and install:

- `ESP8266 Boards`
- `NTPClient`
- `PubSubClient`

Set these values at the top of the sketch before upload:

- `WIFI_SSID`
- `WIFI_PASSWORD`
- `MQTT_HOST`
- `MQTT_USERNAME`
- `MQTT_PASSWORD`

Important defaults in the sketch:

- MQTT uses port `8883` for the ESP8266 TLS connection
- WebSocket MQTT in the Expo app uses port `8884`
- Relay control pin is `D1`
- `time_since_last_change` is tracked in minutes from `millis()`
- Decision logic runs every `5` seconds
- NTP time uses `UTC_OFFSET_SECONDS = 19800`

## Behavior

- ESP8266 connects to WiFi
- ESP8266 fetches time with `NTPClient`
- ESP8266 evaluates the embedded decision tree every 5 seconds
- Relay turns ON when `fanState = 1`
- Relay turns OFF when `fanState = 0`
- Serial Monitor prints `hour`, `day_of_week`, `prev_state`, `time_since_last_change`, and `fanState`
- MQTT app subscribes to telemetry and shows live AUTO-mode state

## Test Without Hardware

You can test the full app without a NodeMCU by running the simulator in [simulate_esp8266.js](/e:/WSN/simulate_esp8266.js).

From `e:\WSN`:

```powershell
npm run simulate:esp8266
```

The simulator:

- loads HiveMQ credentials from `MQTT-Mobile-App/.env` if present
- runs the same decision-tree logic every 5 seconds
- publishes the same MQTT topics as the ESP8266 sketch
- lets the Expo app behave as if real hardware is online

If you only want to test the logic without MQTT, run:

```powershell
$env:SIMULATOR_DRY_RUN='true'
npm run simulate:esp8266
```

That prints the decision inputs and `fanState` every 5 seconds without connecting to HiveMQ.

## Notes

- The sketch uses `secureClient.setInsecure()` so it can connect to HiveMQ Cloud without loading a CA certificate.
- If your relay module is active HIGH instead of active LOW, change `RELAY_ACTIVE_LOW` to `false`.
- If your local timezone is not IST, adjust `UTC_OFFSET_SECONDS`.

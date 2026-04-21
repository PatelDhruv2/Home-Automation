const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const LOGIC_INTERVAL_MS = 5000;
const DEFAULT_TIMEZONE_OFFSET_SECONDS = 19800;
const DEVICE_TOPICS = {
  mode: 'fan/mode',
  state: 'fan/state',
  status: 'fan/status',
  telemetry: 'fan/telemetry',
};

function loadEnvFile() {
  const envPath = path.join(__dirname, 'MQTT-Mobile-App', '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function normalizeBrokerHost(value) {
  return (value || '')
    .trim()
    .replace(/^mqtts?:\/\//i, '')
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function getNumberEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getOptionalNumberEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function getSimulatedClock(offsetSeconds) {
  const shifted = new Date(Date.now() + offsetSeconds * 1000);
  return {
    hour: shifted.getUTCHours(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function evaluateDecisionTree(hour, dayOfWeek, previousState, timeSinceLastChangeMinutes) {
  let fanState = 0;

  if (previousState === 0) {
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

loadEnvFile();

const rawBrokerUrl = process.env.EXPO_PUBLIC_HIVEMQ_BROKER_URL || process.env.HIVEMQ_BROKER_URL || '';
const brokerHost = normalizeBrokerHost(rawBrokerUrl);
const brokerPort = getNumberEnv('SIMULATOR_MQTT_PORT', 8883);
const brokerUsername = process.env.EXPO_PUBLIC_HIVEMQ_USERNAME || process.env.HIVEMQ_USERNAME || '';
const brokerPassword = process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD || process.env.HIVEMQ_PASSWORD || '';
const timezoneOffsetSeconds = getNumberEnv(
  'SIMULATOR_UTC_OFFSET_SECONDS',
  DEFAULT_TIMEZONE_OFFSET_SECONDS
);
const dryRun = ['1', 'true', 'yes'].includes((process.env.SIMULATOR_DRY_RUN || '').toLowerCase());
const forcedHour = getOptionalNumberEnv('SIMULATOR_FORCE_HOUR');
const forcedDayOfWeek = getOptionalNumberEnv('SIMULATOR_FORCE_DAY');
const forcedPrevState = getOptionalNumberEnv('SIMULATOR_FORCE_PREV_STATE');
const forcedMinutesSinceChange = getOptionalNumberEnv('SIMULATOR_FORCE_MINUTES_SINCE_CHANGE');

let client = null;
let prevState = forcedPrevState === 1 ? 1 : 0;
let lastChangeTimestamp = Date.now();

function publishMessage(topic, payload, retained = true) {
  if (!client || !client.connected) {
    return;
  }

  client.publish(topic, payload, { qos: 1, retain: retained });
}

function publishStatus(status) {
  if (dryRun) {
    return;
  }

  publishMessage(DEVICE_TOPICS.status, status);
}

function runSimulationStep() {
  const simulatedClock = getSimulatedClock(timezoneOffsetSeconds);
  const hour = forcedHour !== null ? forcedHour : simulatedClock.hour;
  const dayOfWeek = forcedDayOfWeek !== null ? forcedDayOfWeek : simulatedClock.dayOfWeek;
  const previousState = forcedPrevState !== null ? forcedPrevState : prevState;
  const timeSinceLastChangeMinutes =
    forcedMinutesSinceChange !== null
      ? forcedMinutesSinceChange
      : Math.floor((Date.now() - lastChangeTimestamp) / 60000);
  const fanState = evaluateDecisionTree(
    hour,
    dayOfWeek,
    previousState,
    timeSinceLastChangeMinutes
  );

  if (forcedMinutesSinceChange === null && fanState !== prevState) {
    lastChangeTimestamp = Date.now();
  }
  prevState = fanState;

  const telemetryPayload = JSON.stringify({
    mode: 'AUTO',
    hour,
    day_of_week: dayOfWeek,
    prev_state: previousState,
    time_since_last_change: timeSinceLastChangeMinutes,
    fanState,
  });

  console.log(
    `[SIM] hour=${hour} day_of_week=${dayOfWeek} prev_state=${previousState} time_since_last_change=${timeSinceLastChangeMinutes} fanState=${fanState}`
  );

  if (!dryRun) {
    publishMessage(DEVICE_TOPICS.mode, 'AUTO');
    publishMessage(DEVICE_TOPICS.state, fanState === 1 ? 'ON' : 'OFF');
    publishMessage(DEVICE_TOPICS.status, 'online');
    publishMessage(DEVICE_TOPICS.telemetry, telemetryPayload);
  }
}

function startLoop() {
  if (
    forcedHour !== null ||
    forcedDayOfWeek !== null ||
    forcedPrevState !== null ||
    forcedMinutesSinceChange !== null
  ) {
    console.log(
      `[SIM] Force mode enabled: hour=${forcedHour ?? 'clock'} day=${forcedDayOfWeek ?? 'clock'} prev_state=${forcedPrevState ?? 'dynamic'} time_since_last_change=${forcedMinutesSinceChange ?? 'dynamic'}`
    );
  }

  runSimulationStep();
  setInterval(runSimulationStep, LOGIC_INTERVAL_MS);
}

if (dryRun) {
  console.log('[SIM] Starting in dry-run mode. No MQTT messages will be published.');
  startLoop();
  return;
}

if (!brokerHost || !brokerUsername || !brokerPassword) {
  console.error(
    '[SIM] Missing HiveMQ credentials. Add MQTT-Mobile-App/.env or set EXPO_PUBLIC_HIVEMQ_* env vars.'
  );
  console.error('[SIM] To test logic without MQTT, run with SIMULATOR_DRY_RUN=true.');
  process.exit(1);
}

const brokerUrl = `mqtts://${brokerHost}:${brokerPort}`;
client = mqtt.connect(brokerUrl, {
  username: brokerUsername,
  password: brokerPassword,
  reconnectPeriod: 5000,
  clean: true,
  clientId: `sim_esp8266_${Math.random().toString(16).slice(2, 10)}`,
});

client.on('connect', () => {
  console.log(`[SIM] Connected to ${brokerUrl}`);
  publishStatus('online');
  startLoop();
});

client.on('reconnect', () => {
  console.log('[SIM] Reconnecting to MQTT broker...');
});

client.on('error', (error) => {
  console.error(`[SIM] MQTT error: ${error.message}`);
});

client.on('close', () => {
  console.log('[SIM] MQTT connection closed.');
});

process.on('SIGINT', () => {
  console.log('\n[SIM] Shutting down simulator...');
  publishStatus('offline');
  if (client) {
    client.end(true, () => process.exit(0));
  } else {
    process.exit(0);
  }
});

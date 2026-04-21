const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mqtt = require('mqtt');

const MQTT_PATH = '/mqtt';

// ✅ TWO SEPARATE TOPICS
const DEVICE_TOPICS = {
  ON: 'fan/on',
  OFF: 'fan/off',
};

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) continue;

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
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

function getBrokerPort(value) {
  const parsedPort = Number.parseInt(value, 10);
  return Number.isNaN(parsedPort) ? 8884 : parsedPort;
}

// ✅ DECISION LOGIC (UNCHANGED)
function evaluateFanState(hour, dayOfWeek, prevState, timeSinceLastChangeMinutes) {
  let fanState = 0;

  if (prevState === 0) {
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

// ✅ TRANSITION-BASED PUBLISH (2 TOPICS)
function publishFanAction(prevState, fanState) {
  if (prevState === 0 && fanState === 1) {
    client.publish(DEVICE_TOPICS.ON, '1', { qos: 1 });
    console.log('[PUB] fan/on');
  } 
  else if (prevState === 1 && fanState === 0) {
    client.publish(DEVICE_TOPICS.OFF, '1', { qos: 1 });
    console.log('[PUB] fan/off');
  } 
  else {
    console.log('[SKIP] No transition');
  }
}

// CLI helpers
function createPrompt() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function askQuestion(rl, questionText) {
  return new Promise((resolve) => rl.question(questionText, resolve));
}

function parseInputNumber(rawValue, label, minValue, maxValue) {
  const trimmed = rawValue.trim();

  if (trimmed.toLowerCase() === 'exit') {
    return { exit: true };
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (Number.isNaN(parsed) || parsed < minValue || parsed > maxValue) {
    throw new Error(`${label} must be between ${minValue} and ${maxValue}`);
  }

  return { value: parsed };
}

// Load env
loadEnvFile();

const RAW_BROKER_URL = process.env.EXPO_PUBLIC_HIVEMQ_BROKER_URL || '';
const RAW_PORT = process.env.EXPO_PUBLIC_HIVEMQ_PORT || '8884';
const MQTT_USERNAME = process.env.EXPO_PUBLIC_HIVEMQ_USERNAME || '';
const MQTT_PASSWORD = process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD || '';

const MQTT_HOST = normalizeBrokerHost(RAW_BROKER_URL);
const MQTT_PORT = getBrokerPort(RAW_PORT);

if (!MQTT_HOST || !MQTT_USERNAME || !MQTT_PASSWORD) {
  console.error('Missing MQTT credentials in .env');
  process.exit(1);
}

const brokerUrl = `wss://${MQTT_HOST}:${MQTT_PORT}${MQTT_PATH}`;

const client = mqtt.connect(brokerUrl, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  reconnectPeriod: 5000,
  clean: true,
  protocolVersion: 4,
  clientId: `fan_logic_${Math.random().toString(16).slice(2, 10)}`,
});

const rl = createPrompt();

async function promptAndEvaluate() {
  while (true) {
    try {
      console.log('\nEnter values (type "exit" to quit):');

      const hourInput = parseInputNumber(
        await askQuestion(rl, 'hour (0-23): '),
        'hour',
        0,
        23
      );
      if (hourInput.exit) break;

      const dayInput = parseInputNumber(
        await askQuestion(rl, 'day_of_week (0-6): '),
        'day_of_week',
        0,
        6
      );
      if (dayInput.exit) break;

      const prevStateInput = parseInputNumber(
        await askQuestion(rl, 'prev_state (0 or 1): '),
        'prev_state',
        0,
        1
      );
      if (prevStateInput.exit) break;

      const timeInput = parseInputNumber(
        await askQuestion(rl, 'time_since_last_change (minutes): '),
        'time_since_last_change',
        0,
        10000
      );
      if (timeInput.exit) break;

      const hour = hourInput.value;
      const dayOfWeek = dayInput.value;
      const prevState = prevStateInput.value;
      const timeSinceLastChangeMinutes = timeInput.value;

      const fanState = evaluateFanState(
        hour,
        dayOfWeek,
        prevState,
        timeSinceLastChangeMinutes
      );

      console.log(`[LOGIC] prev=${prevState} → new=${fanState}`);

      publishFanAction(prevState, fanState);

    } catch (err) {
      console.error('[INPUT ERROR]', err.message);
    }
  }

  rl.close();
  client.end();
}

client.on('connect', async () => {
  console.log(`Connected to MQTT broker: ${brokerUrl}`);
  await promptAndEvaluate();
});

client.on('reconnect', () => {
  console.log('Reconnecting...');
});

client.on('error', (err) => {
  console.error('MQTT Error:', err.message);
});

process.on('SIGINT', () => {
  rl.close();
  client.end();
  process.exit(0);
});

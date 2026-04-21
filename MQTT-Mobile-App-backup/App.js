import React, { useEffect, useRef, useState } from 'react';
import {
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// Paho's browser client expects localStorage. React Native does not provide it,
// so we create a tiny in-memory version for this demo app.
if (typeof global.localStorage === 'undefined' || global.localStorage === null) {
  const data = {};

  const storage = {
    setItem(key, value) {
      const stringValue = String(value);
      data[key] = stringValue;
      this[key] = stringValue;
    },
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    removeItem(key) {
      delete data[key];
      delete this[key];
    },
    clear() {
      Object.keys(data).forEach((key) => {
        delete data[key];
        delete this[key];
      });
    },
    key(index) {
      return Object.keys(data)[index] ?? null;
    },
  };

  Object.defineProperty(storage, 'length', {
    get() {
      return Object.keys(data).length;
    },
  });

  global.localStorage = storage;
}

const Paho = require('paho-mqtt');

const RAW_BROKER_URL = process.env.EXPO_PUBLIC_HIVEMQ_BROKER_URL || '';
const RAW_PORT = process.env.EXPO_PUBLIC_HIVEMQ_PORT || '8884';
const MQTT_USERNAME = process.env.EXPO_PUBLIC_HIVEMQ_USERNAME || '';
const MQTT_PASSWORD = process.env.EXPO_PUBLIC_HIVEMQ_PASSWORD || '';

const MQTT_PATH = '/mqtt';
const FAN_COMMANDS = {
  on: {
    label: 'Turn Fan On',
    payload: 'ON',
    topic: 'fan/on',
  },
  off: {
    label: 'Turn Fan Off',
    payload: 'OFF',
    topic: 'fan/off',
  },
};

function normalizeBrokerHost(value) {
  return value
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

const MQTT_HOST = normalizeBrokerHost(RAW_BROKER_URL);
const MQTT_PORT = getBrokerPort(RAW_PORT);

export default function App() {
  const clientRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('Waiting to connect...');
  const [fanState, setFanState] = useState('Unknown');
  const [lastCommand, setLastCommand] = useState('No command sent yet.');

  useEffect(() => {
    let isMounted = true;

    if (!MQTT_HOST || !MQTT_USERNAME || !MQTT_PASSWORD) {
      const message =
        'Missing one or more HiveMQ environment variables. Check your .env file.';
      console.log(message);
      setStatus(message);
      return undefined;
    }

    const clientId = `rn_${Math.random().toString(16).slice(2, 10)}`;
    const mqttClient = new Paho.Client(MQTT_HOST, MQTT_PORT, MQTT_PATH, clientId);
    clientRef.current = mqttClient;

    mqttClient.onConnectionLost = (responseObject) => {
      if (responseObject.errorCode !== 0) {
        console.log('MQTT connection lost:', responseObject.errorMessage);
      } else {
        console.log('MQTT client disconnected cleanly.');
      }

      if (isMounted) {
        setIsConnected(false);
        setFanState('Unknown');
        setStatus('Connection lost. Check the console logs.');
      }
    };

    mqttClient.onMessageDelivered = (message) => {
      console.log(
        `MQTT message published successfully to ${message.destinationName}: ${message.payloadString}`
      );

      if (isMounted) {
        setStatus(`Published successfully to ${message.destinationName}`);
      }
    };

    console.log(
      `Attempting MQTT connection to ${MQTT_HOST}:${MQTT_PORT}${MQTT_PATH}`
    );
    setStatus('Connecting to HiveMQ Cloud...');

    mqttClient.connect({
      useSSL: true,
      userName: MQTT_USERNAME,
      password: MQTT_PASSWORD,
      mqttVersion: 4,
      mqttVersionExplicit: true,
      cleanSession: true,
      reconnect: true,
      timeout: 10,
      onSuccess: () => {
        console.log('MQTT connection successful.');

        if (isMounted) {
          setIsConnected(true);
          setStatus('Connected to HiveMQ Cloud.');
        }
      },
      onFailure: (error) => {
        console.log(
          `MQTT connection failed: ${error.errorMessage || 'Unknown error'}`
        );

        if (isMounted) {
          setIsConnected(false);
          setStatus(
            `Connection failed: ${error.errorMessage || 'Unknown error'}`
          );
        }
      },
    });

    return () => {
      isMounted = false;

      if (clientRef.current && clientRef.current.isConnected()) {
        clientRef.current.disconnect();
        console.log('MQTT client disconnected during app cleanup.');
      }
    };
  }, []);

  const publishFanCommand = (commandKey) => {
    const mqttClient = clientRef.current;
    const command = FAN_COMMANDS[commandKey];

    if (!command) {
      setStatus('Unknown command. Check the app configuration.');
      return;
    }

    if (!mqttClient || !mqttClient.isConnected()) {
      console.log('Publish skipped because the MQTT client is not connected yet.');
      setStatus('Not connected yet. Wait for the success log, then try again.');
      return;
    }

    try {
      const message = new Paho.Message(command.payload);
      message.destinationName = command.topic;
      message.qos = 1;
      message.retained = false;

      mqttClient.send(message);
      console.log(`Publish request sent to ${command.topic}: ${command.payload}`);
      setFanState(command.payload === 'ON' ? 'ON' : 'OFF');
      setLastCommand(`${command.payload} command sent to ${command.topic}`);
      setStatus(`Publishing ${command.payload} command...`);
    } catch (error) {
      console.log(`MQTT publish failed: ${error.message || String(error)}`);
      setStatus('Publish failed. Check the console logs.');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <Text style={styles.title}>Smart Fan Control</Text>
        <Text style={styles.subtitle}>
          Control your fan through HiveMQ Cloud from this Expo app
        </Text>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <Text style={styles.label}>Connection</Text>
            <View
              style={[
                styles.connectionBadge,
                isConnected ? styles.connectionOnline : styles.connectionOffline,
              ]}
            >
              <Text style={styles.connectionBadgeText}>
                {isConnected ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>

          <Text style={styles.label}>Broker</Text>
          <Text style={styles.value}>
            {MQTT_HOST}:{MQTT_PORT}
          </Text>

          <Text style={styles.label}>Current Fan State</Text>
          <Text style={styles.value}>{fanState}</Text>

          <Text style={styles.label}>Last Command</Text>
          <Text style={styles.value}>{lastCommand}</Text>

          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{status}</Text>
        </View>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!isConnected}
            onPress={() => publishFanCommand('on')}
            style={[
              styles.button,
              styles.buttonSpacing,
              !isConnected ? styles.buttonDisabled : styles.buttonOn,
            ]}
          >
            <Text style={styles.buttonText}>{FAN_COMMANDS.on.label}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            disabled={!isConnected}
            onPress={() => publishFanCommand('off')}
            style={[
              styles.button,
              !isConnected ? styles.buttonDisabled : styles.buttonOff,
            ]}
          >
            <Text style={styles.buttonText}>{FAN_COMMANDS.off.label}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.note}>
          The controls become active after the MQTT connection succeeds.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f6fb',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    color: '#102542',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#5c6f82',
    fontSize: 15,
    marginBottom: 28,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#d7e0ea',
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 22,
    padding: 20,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    color: '#738496',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 4,
    marginTop: 12,
    textTransform: 'uppercase',
  },
  value: {
    color: '#102542',
    fontSize: 15,
    lineHeight: 22,
  },
  connectionBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  connectionOnline: {
    backgroundColor: '#d1fae5',
  },
  connectionOffline: {
    backgroundColor: '#fee2e2',
  },
  connectionBadgeText: {
    color: '#102542',
    fontSize: 12,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    flex: 1,
    paddingVertical: 16,
  },
  buttonSpacing: {
    marginRight: 12,
  },
  buttonOn: {
    backgroundColor: '#0f766e',
  },
  buttonOff: {
    backgroundColor: '#b91c1c',
  },
  buttonDisabled: {
    backgroundColor: '#9fb8b4',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  note: {
    color: '#5c6f82',
    fontSize: 13,
    lineHeight: 20,
    marginTop: 14,
    textAlign: 'center',
  },
});
// metro.config.js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Metro on 8081. For phone: use the LAN URL from the terminal or run from repo root: npm run start:mobile:tunnel
config.server = {
  ...config.server,
  port: 8081,
};

module.exports = config;



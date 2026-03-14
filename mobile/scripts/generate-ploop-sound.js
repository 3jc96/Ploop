#!/usr/bin/env node
/**
 * Generates a minimal "ploop" WAV sound (short low tone with decay).
 * Run: node scripts/generate-ploop-sound.js
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 22050;
const DURATION = 0.15; // seconds
const FREQ = 180; // Hz - low "plop" tone
const NUM_SAMPLES = Math.floor(SAMPLE_RATE * DURATION);

const samples = [];
for (let i = 0; i < NUM_SAMPLES; i++) {
  const t = i / SAMPLE_RATE;
  const decay = Math.exp(-t * 15); // quick decay
  const sample = Math.sin(2 * Math.PI * FREQ * t) * decay * 0.4;
  const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  samples.push(int16);
}

const dataSize = samples.length * 2;
const fileSize = 36 + dataSize;

const buf = Buffer.alloc(44 + dataSize);
let offset = 0;

function writeStr(s) {
  buf.write(s, offset);
  offset += s.length;
}
function writeU32(n) {
  buf.writeUInt32LE(n, offset);
  offset += 4;
}
function writeU16(n) {
  buf.writeUInt16LE(n, offset);
  offset += 2;
}

writeStr('RIFF');
writeU32(fileSize);
writeStr('WAVE');
writeStr('fmt ');
writeU32(16);
writeU16(1); // PCM
writeU16(1); // mono
writeU32(SAMPLE_RATE);
writeU32(SAMPLE_RATE * 2); // byte rate
writeU16(2); // block align
writeU16(16); // bits per sample
writeStr('data');
writeU32(dataSize);

for (const s of samples) {
  buf.writeInt16LE(s, offset);
  offset += 2;
}

const outPath = path.join(__dirname, '..', 'assets', 'ploop.wav');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, buf);
console.log('Generated', outPath);

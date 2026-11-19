#!/usr/bin/env node
// End-to-end network check: boots an ESP32-C3 HTTP client firmware in the
// browser runtime (under Node), wires its Wi-Fi straight to the server's
// EthernetNatSession, and waits for a real HTTP 200 from example.com.
//
//   node tools/verify-network.mjs [--firmware FILE] [--timeout SECONDS]
//                                 [--allow-private] [--verbose]
//
// Needs internet access from this machine. Exits 0 when every stage passes.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CYCLES_PER_MS = 160_000;
const BATCH = 50_000;

const { values: options } = parseArgs({
  options: {
    firmware: {
      type: "string",
      default: path.join(root, "tools", "network-test-firmware", "network-test.bin"),
    },
    timeout: { type: "string", default: "30" },
    "allow-private": {
      type: "boolean",
      default: process.env.EMULATOR_NETWORK_ALLOW_PRIVATE === "1",
    },
    verbose: { type: "boolean", default: false },
  },
});

const STAGES = [
  ["Wi-Fi associated", /wifi:connected with /],
  ["DHCP lease", /sta ip: (\d+\.\d+\.\d+\.\d+)/],
  ["DNS lookup", /DNS lookup succeeded/],
  ["TCP connect", /\.\.\. connected/],
  ["HTTP 200", /HTTP\/1\.[01] 200/],
];
const FAILURES = [
  /DNS lookup failed[^\n]*/,
  /socket connect failed[^\n]*/,
];

const load = (file) => import(pathToFileURL(path.join(root, file)));
const runtime = await load("public/wasm/pkg/esp_emu.js");
const wasm = await runtime.default({
  module_or_path: await readFile(path.join(root, "public/wasm/pkg/esp_emu_bg.wasm")),
});
const { AiPassportBoard } = await load("public/wasm/ai-passport-board.js");
const network = await load("public/wasm/network.js");
const { EthernetNatSession } = await load("network-bridge.mjs");

const emulator = new runtime.WasmEmulator("esp32c3");
emulator.load_default_rom();
emulator.set_boot_from_rom(true);
emulator.set_wifi_config(network.EMULATOR_WIFI_SSID, network.EMULATOR_WIFI_PASSWORD);
emulator.load_firmware(new Uint8Array(await readFile(options.firmware)));

const blocked = [];
const quiet = () => {};
const session = new EthernetNatSession({
  allowPrivate: options["allow-private"],
  debugEnabled: true,
  sendFrame: (frame) => emulator.wifi_rx_push(new Uint8Array(frame)),
  emitEvent: (event) => {
    if (event.event === "connection-blocked" && !event.target.startsWith("255.")) {
      blocked.push(event.target);
    }
  },
  logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
});
const board = new AiPassportBoard(wasm, { emulator });
board.releaseButtons();

const passed = new Map();
const failures = [];
let uart = "";
const limit = Number(options.timeout) * 1000 * CYCLES_PER_MS;
const started = performance.now();

function scan(text) {
  for (const [name, pattern] of STAGES) {
    const match = !passed.has(name) && text.match(pattern);
    if (match) {
      const at = (emulator.cycles() / CYCLES_PER_MS / 1000).toFixed(1);
      passed.set(name, match[1] ? `${at}s (${match[1]})` : `${at}s`);
    }
  }
  for (const pattern of FAILURES) {
    const match = text.match(pattern);
    if (match) failures.push(match[0].trim());
  }
}

while (emulator.cycles() < limit && passed.size < STAGES.length) {
  uart += emulator.run_batch(BATCH);
  board.drain({ flushFrame: false });
  for (const frame of network.unpackEthernetFrames(emulator.wifi_tx_drain())) {
    session.receive(frame);
  }
  const end = uart.lastIndexOf("\n");
  if (end >= 0) {
    const lines = uart.slice(0, end + 1);
    if (options.verbose) process.stdout.write(lines);
    scan(lines);
    uart = uart.slice(end + 1);
  }
  // Hold virtual time to the wall clock, as the browser worker does, so the
  // firmware's socket timeouts see real network latency.
  const ahead = emulator.cycles() / CYCLES_PER_MS - (performance.now() - started);
  await new Promise((resolve) =>
    ahead > 2 ? setTimeout(resolve, Math.min(ahead, 5)) : setImmediate(resolve));
}
scan(uart);
session.close();

for (const [name] of STAGES) {
  const at = passed.get(name);
  process.stdout.write(`${at ? "ok  " : "FAIL"} ${name}${at ? `  ${at}` : ""}\n`);
}
const ok = passed.size === STAGES.length;
if (!ok) {
  for (const failure of new Set(failures)) process.stdout.write(`     firmware: ${failure}\n`);
  for (const target of new Set(blocked)) {
    process.stdout.write(`     bridge blocked ${target}\n`);
  }
  if (blocked.some((target) => target.startsWith("198.18.") || target.startsWith("198.19."))) {
    process.stdout.write(
      "     198.18.0.0/15 is a fake-IP proxy range; rerun with --allow-private\n",
    );
  }
}
process.stdout.write(`${ok ? "Network verified" : "Network check failed"} ` +
  `(${((performance.now() - started) / 1000).toFixed(1)}s)\n`);
process.exit(ok ? 0 : 1);

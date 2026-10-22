const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");

const uiRoot = path.resolve(__dirname, "..");
const viteEntry = path.join(uiRoot, "node_modules", "vite", "bin", "vite.js");
const electronBinary = require("electron");
let viteProcess;
let electronProcess;
let stopping = false;

async function waitForVite() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:5173");
      if (response.ok) return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Vite did not start on http://127.0.0.1:5173 within 20 seconds.");
}

function chooseFreePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Could not determine a free DevTools port."));
        return;
      }
      listener.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function stopChild(child) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  }
  child.kill("SIGTERM");
  return Promise.resolve();
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all([stopChild(electronProcess), stopChild(viteProcess)]);
  process.exit(code);
}

async function main() {
  viteProcess = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: uiRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  viteProcess.once("error", (error) => {
    console.error("Failed to start Vite:", error);
    void shutdown(1);
  });
  await waitForVite();
  const devToolsPort = await chooseFreePort();

  electronProcess = spawn(electronBinary, [".", `--remote-debugging-port=${devToolsPort}`], {
    cwd: uiRoot,
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: "http://localhost:5173",
    },
    stdio: "inherit",
    windowsHide: false,
  });
  electronProcess.once("error", (error) => {
    console.error("Failed to start Electron:", error);
    void shutdown(1);
  });
  electronProcess.once("exit", (code) => {
    void shutdown(code ?? 1);
  });
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
main().catch((error) => {
  console.error(error);
  void shutdown(1);
});

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const net = require("node:net");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..", "..");
const developmentUrl = process.env.ELECTRON_RENDERER_URL;
const preloadPath = path.join(__dirname, "preload.cjs");
let serverProcess;
let serverPort;
let serverToken;
let quitting = false;

function chooseFreePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string") {
        listener.close();
        reject(new Error("Could not determine a free loopback port."));
        return;
      }
      listener.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function terminateServerTreeSync() {
  const pid = serverProcess?.pid;
  if (!pid || process.platform !== "win32") return;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  serverProcess = undefined;
}

function stopServer() {
  if (!serverProcess?.pid) return Promise.resolve();
  const pid = serverProcess.pid;
  serverProcess = undefined;
  if (process.platform !== "win32") return Promise.resolve();
  return new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", (error) => {
      console.error("Failed to stop the server process tree:", error);
      resolve();
    });
    killer.once("exit", (code) => {
      if (code !== 0) console.error(`taskkill exited with code ${code}.`);
      resolve();
    });
  });
}

function startServer() {
  const environment = {
    ...process.env,
    ARCHIVETUNE_PORT: String(serverPort),
    ARCHIVETUNE_TOKEN: serverToken,
  };
  if (process.env.ARCHIVETUNE_YTDLP) {
    environment.ARCHIVETUNE_YTDLP = process.env.ARCHIVETUNE_YTDLP;
  }

  serverProcess = spawn("gradlew.bat", ["-p", "desktop/server", "run"], {
    cwd: repositoryRoot,
    env: environment,
    shell: true,
    windowsHide: true,
    stdio: "ignore",
  });
  serverProcess.once("error", (error) => {
    console.error("Failed to launch desktop server:", error);
  });
  serverProcess.once("exit", (code, signal) => {
    if (!quitting) {
      console.error(`Desktop server exited unexpectedly (code=${code}, signal=${signal}).`);
    }
  });
}

function openExternalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      void shell.openExternal(url.toString());
    }
  } catch (error) {
    console.error("Refusing to open an invalid external URL:", error);
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#111312",
    show: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (developmentUrl && url.startsWith(developmentUrl)) return;
    event.preventDefault();
    openExternalUrl(url);
  });

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, "dist", "index.html"));
  }
}

ipcMain.handle("get-config", () => ({
  baseUrl: `http://127.0.0.1:${serverPort}`,
  token: serverToken,
}));

app.whenReady().then(async () => {
  try {
    serverPort = await chooseFreePort();
    serverToken = randomBytes(24).toString("hex");
    startServer();
    createWindow();
  } catch (error) {
    console.error("Could not initialize ArchiveTune Desktop:", error);
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void stopServer().finally(() => app.exit(0));
});

process.on("exit", terminateServerTreeSync);

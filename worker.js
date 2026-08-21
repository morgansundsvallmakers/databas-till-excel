const PYODIDE_BASE = "./runtime/pyodide/";

let pyodide = null;
let exporter = null;
let currentInput = "/tmp/input.db";
let currentOutput = "/tmp/output.xlsx";

function send(type, payload = {}) {
  postMessage({ type, ...payload });
}

async function fetchBinary(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Kunde inte hämta ${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function init() {
  try {
    send("log", { message: "Laddar lokal Pyodide-runtime…" });
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    const indexURL = new URL(PYODIDE_BASE, self.location.href).href;
    pyodide = await loadPyodide({ indexURL });

    send("log", { message: "Laddar lokala Python-paket…" });
    pyodide.FS.mkdirTree("/lib/site-packages");
    const packageArchive = await fetchBinary("./runtime/python-packages.zip");
    pyodide.unpackArchive(packageArchive, "zip", { extractDir: "/lib/site-packages" });
    pyodide.runPython('import sys\nsys.path.insert(0, "/lib/site-packages")');

    const exporterSource = await fetch("./exporter.py", { cache: "no-store" }).then(r => {
      if (!r.ok) throw new Error(`Kunde inte läsa exporter.py: ${r.status}`);
      return r.text();
    });
    pyodide.FS.writeFile("/lib/exporter.py", exporterSource, { encoding: "utf8" });
    pyodide.runPython('sys.path.insert(0, "/lib")');
    exporter = pyodide.pyimport("exporter");

    pyodide.globals.set("progress_callback", (index, total, table, rows) => {
      const percent = total ? Math.min(97, Math.round((index / total) * 97)) : 0;
      send("progress", { index, total, table, rows, percent });
    });

    send("ready");
  } catch (error) {
    send("fatal", { message: String(error?.stack || error) });
  }
}

function cleanup() {
  for (const path of [currentInput, currentOutput]) {
    try { pyodide.FS.unlink(path); } catch (_) {}
  }
}

async function handleFile(buffer, name) {
  cleanup();
  const ext = "." + (name.split(".").pop() || "").toLowerCase();
  currentInput = `/tmp/input${ext}`;
  currentOutput = "/tmp/output.xlsx";
  pyodide.FS.writeFile(currentInput, new Uint8Array(buffer));

  try {
    const resultProxy = exporter.detect_database(currentInput, ext);
    const result = resultProxy.toJs({ dict_converter: Object.fromEntries });
    resultProxy.destroy();
    send("detected", { result });
  } catch (error) {
    send("detectError", { message: String(error?.stack || error) });
  }
}

async function convert(kind, outputName) {
  try {
    send("log", { message: "Startar lokal konvertering…" });
    const start = performance.now();

    const resultProxy = exporter.export_database(
      currentInput,
      currentOutput,
      kind,
      pyodide.globals.get("progress_callback")
    );
    const result = resultProxy.toJs({ dict_converter: Object.fromEntries });
    resultProxy.destroy();

    send("saving", { percent: 98 });
    const bytes = pyodide.FS.readFile(currentOutput);
    const elapsedMs = Math.round(performance.now() - start);
    const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    send("done", { result, outputName, elapsedMs, buffer: payload });
  } catch (error) {
    send("convertError", { message: String(error?.stack || error) });
  }
}

onmessage = async (event) => {
  const { type } = event.data;
  if (type === "file") {
    await handleFile(event.data.buffer, event.data.name);
  } else if (type === "convert") {
    await convert(event.data.kind, event.data.outputName);
  }
};

init();

const PYODIDE_VERSION = "314.0.3";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const ACCESS_PARSER_COMMIT = "7b733913a7a8076bfd289130a9f6113002059fe0";
const ACCESS_FILES = ["__init__.py", "access_parser.py", "parsing_primitives.py", "utils.py"];

let pyodide = null;
let exporter = null;
let currentInput = "/tmp/input.db";
let currentOutput = "/tmp/output.xlsx";

function send(type, payload = {}) {
  postMessage({ type, ...payload });
}

async function init() {
  try {
    send("log", { message: "Laddar Pyodide…" });
    importScripts(`${PYODIDE_BASE}pyodide.js`);
    pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

    send("log", { message: "Installerar Python-paket (openpyxl, construct, tabulate)…" });
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    await micropip.install(["openpyxl", "construct", "tabulate"]);
    micropip.destroy();

    send("log", { message: "Laddar access-parser (ren Python, pinnad version)…" });
    pyodide.FS.mkdirTree("/lib/access_parser");
    for (const file of ACCESS_FILES) {
      const url = `https://raw.githubusercontent.com/claroty/access_parser/${ACCESS_PARSER_COMMIT}/access_parser/${file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Kunde inte hämta ${file}: ${response.status}`);
      pyodide.FS.writeFile(`/lib/access_parser/${file}`, await response.text(), { encoding: "utf8" });
    }

    pyodide.runPython(`import sys\nsys.path.insert(0, "/lib")`);

    const exporterSource = await fetch("./exporter.py").then(r => {
      if (!r.ok) throw new Error(`Kunde inte läsa exporter.py: ${r.status}`);
      return r.text();
    });
    pyodide.FS.writeFile("/lib/exporter.py", exporterSource, { encoding: "utf8" });
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

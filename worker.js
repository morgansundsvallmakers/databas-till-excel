import { loadPyodide } from "./runtime/pyodide/pyodide.mjs";

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
  const paths = new Set([
    currentInput,
    currentOutput,
    "/tmp/input.zip",
    "/tmp/pex-backup.sqlite",
  ]);
  for (const path of paths) {
    try { pyodide.FS.unlink(path); } catch (_) {}
  }
}

function extractPexDatabaseFromZip() {
  const resultProxy = pyodide.runPython(`
import zipfile
from pathlib import PurePosixPath

archive_path = "/tmp/input.zip"
target_path = "/tmp/pex-backup.sqlite"
allowed_suffixes = {".sqlite", ".sqlite3", ".db3"}

with zipfile.ZipFile(archive_path, "r") as archive:
    candidates = [
        info for info in archive.infolist()
        if not info.is_dir()
        and PurePosixPath(info.filename).suffix.lower() in allowed_suffixes
    ]

    if not candidates:
        raise ValueError("PEX-backupen innehåller ingen SQLite-databas.")

    if len(candidates) > 1:
        names = ", ".join(info.filename for info in candidates)
        raise ValueError(
            "PEX-backupen innehåller flera SQLite-databaser. "
            "Kan inte välja automatiskt: " + names
        )

    selected = candidates[0]
    with archive.open(selected, "r") as source, open(target_path, "wb") as target:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            target.write(chunk)

    {
        "entry": selected.filename,
        "size": selected.file_size,
    }
`);

  const result = resultProxy.toJs({ dict_converter: Object.fromEntries });
  resultProxy.destroy();
  return result;
}

async function handleFile(buffer, name) {
  cleanup();
  currentOutput = "/tmp/output.xlsx";

  const ext = "." + (name.split(".").pop() || "").toLowerCase();
  let detectExt = ext;
  let source = "direct";
  let archiveEntry = null;

  try {
    if (ext === ".zip") {
      source = "pex_zip";
      currentInput = "/tmp/input.zip";
      pyodide.FS.writeFile(currentInput, new Uint8Array(buffer));

      send("log", { message: "PEX-backup identifierad. Söker efter SQLite-databas…" });
      const archive = extractPexDatabaseFromZip();
      archiveEntry = archive.entry;
      send("log", {
        message: `SQLite-databas hittad i backupen: ${archiveEntry} (${archive.size} byte).`
      });

      try { pyodide.FS.unlink("/tmp/input.zip"); } catch (_) {}
      currentInput = "/tmp/pex-backup.sqlite";
      detectExt = ".sqlite";
    } else {
      currentInput = `/tmp/input${ext}`;
      pyodide.FS.writeFile(currentInput, new Uint8Array(buffer));
    }

    const resultProxy = exporter.detect_database(currentInput, detectExt);
    const result = resultProxy.toJs({ dict_converter: Object.fromEntries });
    resultProxy.destroy();

    if (source === "pex_zip") {
      result.label = "PEX / SQLite";
      result.source = "pex_zip";
      result.archiveEntry = archiveEntry;
    } else {
      result.source = "direct";
    }

    send("detected", { result });
  } catch (error) {
    send("detectError", { message: String(error?.message || error?.stack || error) });
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

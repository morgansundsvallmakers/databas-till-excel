const els = {
  chooseButton: document.querySelector("#chooseButton"),
  fileInput: document.querySelector("#fileInput"),
  convertButton: document.querySelector("#convertButton"),
  resetButton: document.querySelector("#resetButton"),
  fileBadge: document.querySelector("#fileBadge"),
  fileName: document.querySelector("#fileName"),
  dbType: document.querySelector("#dbType"),
  fileInfo: document.querySelector("#fileInfo"),
  statusText: document.querySelector("#statusText"),
  percentText: document.querySelector("#percentText"),
  progressBar: document.querySelector("#progressBar"),
  detailText: document.querySelector("#detailText"),
  resultCard: document.querySelector("#resultCard"),
  resultSummary: document.querySelector("#resultSummary"),
  resultFile: document.querySelector("#resultFile"),
  resultDetail: document.querySelector("#resultDetail"),
  downloadButton: document.querySelector("#downloadButton"),
  logOutput: document.querySelector("#logOutput"),
  footerStatus: document.querySelector("#footerStatus"),
};

let worker;
let selectedFile = null;
let detected = null;
let excelBlobUrl = null;
let outputName = null;
let ready = false;

function log(message) {
  const stamp = new Date().toLocaleTimeString("sv-SE");
  els.logOutput.textContent += `[${stamp}] ${message}\n`;
}

function setProgress(percent, status, detail = "") {
  const p = Math.max(0, Math.min(100, percent));
  els.progressBar.style.width = `${p}%`;
  els.percentText.textContent = `${p}%`;
  if (status) els.statusText.textContent = status;
  els.detailText.textContent = detail;
}

function setFooter(state, text) {
  els.footerStatus.className =
    state === "error" ? "error-dot" :
    state === "working" ? "working-dot" : "ready-dot";
  els.footerStatus.textContent = `● ${text}`;
}

function resetResult() {
  els.resultCard.hidden = true;
  if (excelBlobUrl) URL.revokeObjectURL(excelBlobUrl);
  excelBlobUrl = null;
}

function resetSelection() {
  selectedFile = null;
  detected = null;
  outputName = null;
  resetResult();
  els.fileInput.value = "";
  els.fileBadge.textContent = "DB";
  els.fileName.textContent = "Ingen fil vald";
  els.dbType.textContent = "Databastyp: inte identifierad";
  els.fileInfo.textContent = "Välj .db3, .sqlite, .sqlite3, .mdb eller .accdb.";
  els.convertButton.disabled = true;
  els.resetButton.disabled = true;
  setProgress(0, ready ? "Redo" : "Initierar Python-miljön…");
}

function initWorker() {
  worker = new Worker("./worker.js");

  worker.onmessage = (event) => {
    const data = event.data;

    if (data.type === "log") {
      log(data.message);
      return;
    }

    if (data.type === "ready") {
      ready = true;
      log("Python-miljön är redo.");
      setProgress(0, "Redo");
      setFooter("ready", "Redo");
      els.chooseButton.disabled = false;
      return;
    }

    if (data.type === "fatal") {
      log(`FATALT: ${data.message}`);
      setProgress(0, "Kunde inte starta Python-miljön");
      setFooter("error", "Startfel");
      els.detailText.textContent = "Öppna teknisk logg för detaljer.";
      return;
    }

    if (data.type === "detected") {
      detected = data.result;
      els.fileBadge.textContent = detected.kind === "sqlite" ? "DB3" : "PEX";
      els.dbType.textContent = `Databastyp: ${detected.label} • lokal läsning`;
      els.fileInfo.textContent = `${detected.tables} tabeller hittades • Resultat: ${outputName}`;
      els.convertButton.disabled = false;
      els.resetButton.disabled = false;
      setProgress(0, "Redo att konvertera");
      setFooter("ready", "Redo");
      log(`Identifierad som ${detected.label}, ${detected.tables} tabeller.`);
      return;
    }

    if (data.type === "detectError") {
      detected = null;
      els.convertButton.disabled = true;
      setProgress(0, "Databasformatet kunde inte identifieras");
      setFooter("error", "Fel");
      els.detailText.textContent = "Öppna teknisk logg för detaljer.";
      log(`Identifieringsfel: ${data.message}`);
      return;
    }

    if (data.type === "progress") {
      setProgress(
        data.percent,
        `Exporterar tabell ${data.index} av ${data.total}`,
        `${data.table}${data.rows ? ` • ${Number(data.rows).toLocaleString("sv-SE")} rader` : ""}`
      );
      setFooter("working", "Arbetar");
      return;
    }

    if (data.type === "saving") {
      setProgress(98, "Skapar Excel-filen…", outputName);
      return;
    }

    if (data.type === "done") {
      const bytes = new Uint8Array(data.buffer);
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      });
      excelBlobUrl = URL.createObjectURL(blob);

      els.resultSummary.textContent =
        `${data.result.tables} tabeller exporterades från ${detected.label}.`;
      els.resultFile.textContent = `Excel-fil: ${data.outputName}`;
      els.resultDetail.textContent =
        `Sista tabell: ${data.result.last_table} • ${Number(data.result.last_rows).toLocaleString("sv-SE")} rader • Tid: ${(data.elapsedMs / 1000).toFixed(1)} s`;
      els.resultCard.hidden = false;

      setProgress(100, "Klart", "Excel-filen är skapad lokalt i webbläsaren.");
      setFooter("ready", "Klar");
      els.chooseButton.disabled = false;
      els.convertButton.disabled = false;
      els.resetButton.disabled = false;
      log(`Export klar: ${data.outputName}`);
      return;
    }

    if (data.type === "convertError") {
      els.chooseButton.disabled = false;
      els.convertButton.disabled = false;
      els.resetButton.disabled = false;
      setProgress(0, "Konverteringen misslyckades");
      setFooter("error", "Fel");
      els.detailText.textContent = "Öppna teknisk logg för detaljer.";
      log(`Konverteringsfel: ${data.message}`);
    }
  };

  worker.onerror = (error) => {
    log(`Worker-fel: ${error.message}`);
    setFooter("error", "Fel");
  };
}

els.chooseButton.disabled = true;
initWorker();

els.chooseButton.addEventListener("click", () => els.fileInput.click());

els.fileInput.addEventListener("change", async () => {
  const file = els.fileInput.files?.[0];
  if (!file || !ready) return;

  selectedFile = file;
  detected = null;
  resetResult();
  outputName = file.name.replace(/\.[^.]+$/, "") + ".xlsx";

  els.fileName.textContent = file.name;
  els.dbType.textContent = "Databastyp: identifierar…";
  els.fileInfo.textContent = `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  els.convertButton.disabled = true;
  els.resetButton.disabled = false;
  setProgress(0, "Läser filen lokalt…");
  setFooter("working", "Arbetar");

  log(`Vald fil: ${file.name} (${file.size} byte). Ingen uppladdning sker.`);
  const buffer = await file.arrayBuffer();
  worker.postMessage({ type: "file", name: file.name, buffer }, [buffer]);
});

els.convertButton.addEventListener("click", () => {
  if (!detected || !selectedFile) return;
  resetResult();
  els.chooseButton.disabled = true;
  els.convertButton.disabled = true;
  els.resetButton.disabled = true;
  setProgress(0, "Startar konvertering…");
  setFooter("working", "Arbetar");
  worker.postMessage({ type: "convert", kind: detected.kind, outputName });
});

els.resetButton.addEventListener("click", resetSelection);

els.downloadButton.addEventListener("click", () => {
  if (!excelBlobUrl || !outputName) return;
  const a = document.createElement("a");
  a.href = excelBlobUrl;
  a.download = outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
});

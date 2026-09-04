const $ = (id) => document.getElementById(id);
const drop = $("drop");
const fileInput = $("file");
const browse = $("browse");
const convertBtn = $("convert");
const fname = $("fname");
const msg = $("msg");
const bar = $("bar");
const barfill = $("barfill");
const out = $("out");
const resultEl = $("result").querySelector("code");
const statline = $("statline");
const copyBtn = $("copy");
const downloadBtn = $("download");

const PHASES = {
  "loading-runtime": ["Downloading the Python → WebAssembly runtime (Pyodide)…", 8],
  "loading-packages": ["Loading native WASM packages…", 28],
  "installing-markitdown": ["Fetching markitdown…", 45],
  "initializing": ["Starting markitdown…", 58],
  "ready": ["Ready. Drop a PDF and hit Convert.", 100],
  "converting": ["Converting…", null],
  "not-ready": ["Engine is still warming up — one moment…", null],
};

let pickedFile = null;
let workerOk = false;
let busy = false;

const worker = new Worker("worker.js", { type: "module" });

function setBar(pct) {
  if (pct === null) {
    barfill.style.width = "100%";
    bar.classList.add("indeterminate");
  } else {
    bar.classList.remove("indeterminate");
    barfill.style.width = pct + "%";
  }
  bar.hidden = false;
}

function say(text, pct) {
  msg.innerHTML = "";
  msg.append(text);
  if (pct !== undefined) setBar(pct);
}

function fail(text) {
  bar.hidden = true;
  msg.textContent = "";
  msg.append("⚠ " + text);
  msg.classList.add("error");
  busy = false;
  convertBtn.disabled = !pickedFile;
}

worker.onmessage = (e) => {
  const d = e.data;
  if (d.type === "status") {
    const p = PHASES[d.status];
    if (!p) return;
    if (d.status === "ready") { workerOk = true; bar.hidden = true; }
    if (d.status === "converting") { msg.classList.remove("error"); }
    say(p[0], p[1]);
  } else if (d.type === "result") {
    busy = false;
    convertBtn.disabled = !pickedFile;
    bar.classList.remove("indeterminate");
    barfill.style.width = "100%";
    const md = d.markdown ?? "";
    resultEl.textContent = md;
    statline.textContent = `${fmtBytes(md.length)} of Markdown · ${pickedFile.name}`;
    out.hidden = false;
    msg.textContent = "Done.";
    bar.hidden = true;
  } else if (d.type === "error") {
    fail(d.message);
  } else if (d.type === "fatal") {
    fail("Engine failed to start: " + d.message);
  }
};

worker.onerror = () => {
  fail("The conversion engine crashed unexpectedly. Reload the page to try again.");
};

function fmtBytes(n) {
  return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";
}

function pick(file) {
  if (!file) return;
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    fail("Please choose a PDF file.");
    return;
  }
  pickedFile = file;
  fname.hidden = false;
  fname.textContent = `${file.name} · ${fmtBytes(file.size)}`;
  convertBtn.disabled = false;
  msg.classList.remove("error");
  say(workerOk ? "Ready. Hit Convert." : "Engine is still starting up… you can convert once it is ready.", 100);
}

browse.onclick = () => fileInput.click();
fileInput.onchange = () => pick(fileInput.files[0]);

for (const evt of ["dragenter", "dragover"]) {
  drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add("over"); });
}
for (const evt of ["dragleave", "drop"]) {
  drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove("over"); });
}
drop.addEventListener("drop", (e) => pick(e.dataTransfer.files[0]));

convertBtn.onclick = async () => {
  if (!pickedFile || busy) return;
  if (!workerOk) { say("Engine is still warming up — try again in a second.", 100); return; }
  busy = true;
  convertBtn.disabled = true;
  out.hidden = true;
  say(PHASES["converting"][0], null);
  msg.classList.remove("error");
  const buf = await pickedFile.arrayBuffer();
  worker.postMessage({ type: "convert", buffer: buf }, [buf]);
};

copyBtn.onclick = async () => {
  const text = resultEl.textContent;
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "Copied ✓";
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    copyBtn.textContent = "Copied ✓";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
};

downloadBtn.onclick = () => {
  const text = resultEl.textContent;
  const blob = new Blob([text], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = pickedFile ? pickedFile.name.replace(/\.pdf$/i, "") + ".md" : "document.md";
  a.click();
  URL.revokeObjectURL(a.href);
};

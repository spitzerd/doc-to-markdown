/* Runs Microsoft markitdown (Python) inside Pyodide (CPython compiled to
   WebAssembly) so conversion happens entirely client-side. */

const PYODIDE_VERSION = "314.0.6";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_ESM = `${PYODIDE_CDN}pyodide.mjs`;

// Native / pure-Python packages that ship in the Pyodide lockfile and are
// pulled straight from the runtime with loadPackage (no PyPI round-trip).
const DISTRO_PACKAGES = [
  "micropip",
  "pillow",          // image + pdfplumber dependency
  "cryptography",    // pdfminer (encrypted PDFs) + others
  "lxml",            // python-pptx backend
  "numpy",           // pandas backend
  "pandas",          // xlsx / xls tables
  "python-dateutil", // pandas
  "pytz",            // pandas
  "tzdata",          // pandas
  "six",
  "xlrd",            // legacy .xls
  "requests",
  "urllib3",
  "idna",
  "certifi",
  "beautifulsoup4",
  "soupsieve",
  "typing-extensions",
  "charset-normalizer", // 3.4.x: 3.5.x ships a Rust pyemscripten wheel that aborts
];

// Wheels not in the Pyodide lockfile — pure-Python, installed from PyPI with
// micropip (deps=False; the dependency graph is resolved by hand so markitdown's
// `magika` — which needs onnxruntime, no WASM build — is never fetched).
const WHEELS = [
  "markitdown==0.1.7",
  "defusedxml",      // EPub
  "markdownify",     // HTML → Markdown
  "openpyxl",        // .xlsx
  "et-xmlfile",      // openpyxl dependency
  "python-pptx",     // .pptx (needs lxml + Pillow, both from the lockfile)
  "XlsxWriter",      // python-pptx dependency
  "mammoth",         // .docx
  "cobble",          // mammoth dependency
  "olefile",         // Outlook .msg
  "pdfplumber==0.11.6",     // last pdfplumber without the native pypdfium2 import chain
  "pdfminer.six==20250327", // pin matching pdfplumber 0.11.6
];

const PY_SETUP = `
import sys, types

# --- magika stub -------------------------------------------------------
# markitdown imports magika unconditionally, but magika needs onnxruntime,
# which has no WebAssembly build. The stub always reports "unknown", which
# makes markitdown fall back to extension/MIME detection (we pass the real
# file extension of whatever the user dropped).
_magika = types.ModuleType("magika")

class _PredictionOutput:
    label = "unknown"
    mime_type = "application/octet-stream"
    extensions = ()
    is_text = False
    is_binary = False
    score = 0.0

class _Prediction:
    output = _PredictionOutput()
    top = []

class _Result:
    status = "failed"
    prediction = _Prediction()
    version = "stub"

class Magika:
    def identify_stream(self, stream, **kw): return _Result()
    def identify_bytes(self, data, **kw): return _Result()
    def identify_path(self, path, **kw): return _Result()

_magika.Magika = Magika
_magika.MagikaException = type("MagikaException", (Exception,), {})
sys.modules["magika"] = _magika

# --- markitdown ---------------------------------------------------------
import io
from markitdown import MarkItDown, StreamInfo

_md = MarkItDown(enable_plugins=False)

def convert(data, extension):
    result = _md.convert_stream(
        io.BytesIO(data),
        stream_info=StreamInfo(filename="document" + extension, extension=extension),
    )
    return result.markdown if result.markdown is not None else ""
`;

let pyodide = null;
let ready = false;

function post(status, extra = {}) {
  self.postMessage({ type: "status", status, ...extra });
}

async function boot() {
  post("loading-runtime");
  const { loadPyodide } = await import(PYODIDE_ESM);
  pyodide = await loadPyodide({ indexURL: PYODIDE_CDN });

  post("loading-packages");
  await pyodide.loadPackage(DISTRO_PACKAGES);

  post("installing-markitdown");
  await pyodide.runPythonAsync(`
    import micropip
    await micropip.install(${JSON.stringify(WHEELS)}, deps=False)
  `);

  post("initializing");
  await pyodide.runPythonAsync(PY_SETUP);

  ready = true;
  post("ready");
}

self.onmessage = async (e) => {
  const { type, buffer, extension } = e.data;
  if (type !== "convert") return;
  if (!ready) {
    post("not-ready");
    return;
  }
  post("converting");
  try {
    const bytes = pyodide.toPy(new Uint8Array(buffer));
    pyodide.globals.set("__file_bytes__", bytes);
    pyodide.globals.set("__file_ext__", extension || "");
    await pyodide.runPythonAsync(`
      __md_result__ = convert(bytes(__file_bytes__), __file_ext__)
    `);
    const proxy = pyodide.globals.get("__md_result__");
    const markdown = typeof proxy === "string" ? proxy : proxy.toString();
    bytes.destroy?.();
    self.postMessage({ type: "result", markdown });
  } catch (err) {
    self.postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};

boot().catch((err) => {
  self.postMessage({ type: "fatal", message: String((err && err.message) || err) });
});

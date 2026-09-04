/* Runs Microsoft markitdown (Python) inside Pyodide (CPython compiled to
   WebAssembly) so conversion happens entirely client-side. */

const PYODIDE_VERSION = "314.0.6";
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PYODIDE_ESM = `${PYODIDE_CDN}pyodide.mjs`;

// Pure-Python wheels installed with micropip (deps:false — we resolve the
// graph by hand because markitdown's `magika` dependency needs onnxruntime,
// for which no WASM build exists; see the stub injected below).
const WHEELS = [
  "markitdown==0.1.7",
  "pdfplumber==0.11.6",     // last pdfplumber without the native pypdfium2 import chain
  "pdfminer.six==20250327", // pin matching pdfplumber 0.11.6
  "beautifulsoup4",
  "soupsieve",
  "typing_extensions",
  "charset-normalizer==3.4.9", // 3.5.x ships a Rust emscripten wheel that aborts under Pyodide
  "defusedxml",
  "markdownify",
  "requests",
  "urllib3",
  "idna",
  "certifi",
];

// Native Pyodide distro packages (compiled C → WASM, ship with the runtime).
const DISTRO_PACKAGES = ["micropip", "pillow", "cryptography"];

const PY_SETUP = `
import sys, types

# --- magika stub -------------------------------------------------------
# markitdown imports magika unconditionally, but magika needs onnxruntime,
# which has no WebAssembly build. The stub always reports "unknown", which
# makes markitdown fall back to extension/MIME detection (we pass ".pdf").
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
from markitdown import MarkItDown

_md = MarkItDown(enable_plugins=False)

def convert_pdf(data):
    result = _md.convert_stream(io.BytesIO(data), file_extension=".pdf")
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
  const { type, buffer } = e.data;
  if (type !== "convert") return;
  if (!ready) {
    post("not-ready");
    return;
  }
  post("converting");
  try {
    const bytes = pyodide.toPy(new Uint8Array(buffer));
    pyodide.globals.set("__pdf_bytes__", bytes);
    await pyodide.runPythonAsync(`
      __md_result__ = convert_pdf(bytes(__pdf_bytes__))
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

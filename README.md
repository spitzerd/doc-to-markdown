# PDF → Markdown (markitdown in the browser)

A single-page web app that converts PDF files to Markdown **entirely in your
browser** — no server, no uploads, your files never leave the device.

It runs [Microsoft **markitdown**](https://github.com/microsoft/markitdown)
(Python) inside [**Pyodide**](https://pyodide.org) — CPython compiled to
WebAssembly. PDF text and tables are extracted by markitdown's
`PDFConverter`, which uses `pdfplumber` / `pdfminer.six`.

Live site: deployed via GitHub Pages from this repository.

## How it works

| Piece | Role |
| --- | --- |
| `index.html` | UI: drag-and-drop, status, result with copy/download |
| `app.js` | Talks to the worker, manages UI state |
| `worker.js` | Loads Pyodide, installs markitdown wheels, runs conversions |

On first visit the browser downloads the Pyodide runtime (~25 MB, cached by
the browser/CDN for a year), then:

1. `pyodide.loadPackage(["micropip", "pillow", "cryptography"])` — the
   native WASM builds shipped with Pyodide.
2. `micropip.install([...], deps=False)` — markitdown 0.1.7 and its
   pure-Python dependencies straight from PyPI.
3. A **stub `magika` module** is injected before importing markitdown:
   magika needs `onnxruntime`, for which no WASM build exists. The stub
   always reports "unknown", so markitdown falls back to file-extension
   based format detection (we always pass `.pdf`).

### Deliberate version pins

- `charset-normalizer==3.4.9` — 3.5.x ships a Rust `pyemscripten` wheel that
  hard-aborts when imported under Pyodide.
- `pdfplumber==0.11.6` + `pdfminer.six==20250327` — the last pdfplumber
  series compatible with a pure-Python install (newer markitdown PDF support
  requires pdfplumber to be importable; 0.11.10 pulls native `pypdfium2`).
- `markitdown==0.1.7` with `deps=False` — so `magika` is never fetched.

## Run locally

```bash
python -m http.server 8080
# open http://localhost:8080
```

Any static server works; there is no build step.

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` publishes the repository root as a static
Pages site (Jekyll disabled via `.nojekyll`) on every push to `main`.

## Notes & limits

- First run downloads ~25 MB of runtime + wheels; afterwards everything is
  cached and conversion works offline too.
- A typical PDF converts in seconds; a 6.8 MB arXiv paper takes ~17 s in
  Chrome on desktop.
- Output quality equals desktop markitdown for PDFs (text, headings, and
  pipe tables; scanned/image-only PDFs have no extractable text).

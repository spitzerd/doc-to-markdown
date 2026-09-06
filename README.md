# Documents → Markdown (markitdown in the browser)

A single-page web app that converts a wide range of documents to Markdown
**entirely in your browser** — no server, no uploads, your files never leave
the device.

It runs [Microsoft **markitdown**](https://github.com/microsoft/markitdown)
(Python) inside [**Pyodide**](https://pyodide.org) — CPython compiled to
WebAssembly — and lets markitdown's own built-in converters do the work.

Live site: https://spitzerd.github.io/doc-to-markdown/

## Supported formats

Everything markitdown can handle fully offline inside the WASM sandbox:

| Category | Extensions | Backend |
| --- | --- | --- |
| PDF | `.pdf` | `pdfplumber` / `pdfminer.six` |
| Word | `.docx` | `mammoth` |
| PowerPoint | `.pptx` | `python-pptx` (+ `lxml`) |
| Excel | `.xlsx` | `openpyxl` (+ `pandas`) |
| Excel (legacy) | `.xls` | `xlrd` (+ `pandas`) |
| Outlook | `.msg` | `olefile` |
| EPub | `.epub` | `zipfile` + `defusedxml` + HTML |
| HTML | `.html`, `.htm` | `BeautifulSoup` / `markdownify` |
| Tabular / data | `.csv`, `.json`, `.ipynb` | built-in converters |
| Markup / text | `.xml`, `.txt`, `.md`, … | plain-text converter |
| Archives | `.zip` | iterates and converts each entry |

**Not supported in the browser** (they need native binaries or network calls
that don't exist in the sandbox): image OCR / EXIF (needs the `exiftool`
binary or an LLM key), audio/video transcription, and URL sources such as
YouTube, RSS and Wikipedia.

## How it works

| Piece | Role |
| --- | --- |
| `index.html` | UI: drag-and-drop, status, result with copy/download |
| `app.js` | Talks to the worker, manages UI state and the accepted-extension list |
| `worker.js` | Loads Pyodide, installs markitdown wheels, runs conversions |

On first visit the browser downloads the Pyodide runtime (cached by the
browser/CDN for a year), then:

1. `pyodide.loadPackage([...])` — native WASM builds and pure-Python packages
   that ship in Pyodide's own lockfile: `pillow`, `cryptography`, `lxml`,
   `pandas`, `numpy`, `xlrd`, `beautifulsoup4`, `charset-normalizer`, …
2. `micropip.install([...], deps=False)` — markitdown 0.1.7 plus the
   pure-Python wheels Pyodide does *not* ship (`defusedxml`, `markdownify`,
   `openpyxl`, `python-pptx`, `mammoth`, `olefile`, …) straight from PyPI.
3. A **stub `magika` module** is injected before importing markitdown:
   magika needs `onnxruntime`, for which no WASM build exists. The stub
   always reports "unknown", so markitdown falls back to extension / MIME
   based format detection — we pass the real extension of the dropped file.

The dropped file is read as bytes and handed to
`MarkItDown.convert_stream(..., stream_info=StreamInfo(filename=..., extension=...))`,
so the exact same routing markitdown uses on the desktop is exercised in the
browser.

### Deliberate version pins

- `charset-normalizer` is loaded from the Pyodide lockfile (3.4.x). Do **not**
  install 3.5.x — it ships a Rust `pyemscripten` wheel that hard-aborts when
  imported under Pyodide.
- `pdfplumber==0.11.6` + `pdfminer.six==20250327` — the last pdfplumber series
  compatible with a pure-Python install (0.11.10+ pulls native `pypdfium2`).
- `markitdown==0.1.7` with `deps=False` — so `magika` (and its `onnxruntime`
  requirement) is never fetched; the remaining graph is installed by hand.

## Run locally

```bash
python -m http.server 8080
# open http://localhost:8080
```

Any static server works; there is no build step. (Pyodide needs `SharedArrayBuffer`
-free loading here, so a plain static server with the default COOP/COEP-less
setup is sufficient.)

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` publishes the repository root as a static
Pages site (Jekyll disabled via `.nojekyll`) on every push to `main`.

## Notes & limits

- First run downloads the runtime plus the Office/Excel/Word wheels; afterwards
  everything is cached and conversion works offline too.
- Conversion speed is comparable to desktop markitdown; a typical PDF converts
  in seconds (a 6.8 MB arXiv paper takes ~17 s in Chrome on desktop).
- Output quality matches desktop markitdown for the supported formats. Scanned
  / image-only PDFs have no extractable text, and the same is true of the CLI.

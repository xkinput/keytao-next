# librime-wasm runtime assets

This directory contains the browser worker adapter used by the practice page. Put the compiled librime wasm runtime files in this directory before deployment, or set `LIBRIME_WASM_SOURCE_DIR` to another directory that contains them.

When the default runtime directory is missing `rime.js` or `rime.wasm`, `pnpm run prepare:librime-wasm` downloads `my-rime-dist.zip` from `LibreService/my_rime` and extracts only `rime.js`, `rime.wasm`, and `rime.data`. The downloaded archive is cached in `.cache/librime-wasm/`, and the extracted files are ignored by git.

Set `LIBRIME_WASM_AUTO_DOWNLOAD=0` or `LIBRIME_WASM_SKIP_DOWNLOAD=1` to disable that download. Set `LIBRIME_WASM_DOWNLOAD_URL` to use another compatible archive.

The default downloaded runtime comes from My RIME, which is AGPL-3.0-or-later. Public deployments need to satisfy that license's source distribution requirements, or use a separately built compatible librime wasm runtime with suitable licensing for the deployment.

Required files:

- `worker.js` provided by this project
- `rime.js`
- `rime.wasm`

Optional files:

- `rime.data`
- `schemas.json`
- prebuilt KeyTao schema packages and any other files loaded by `worker.js`

`pnpm run prepare:librime-wasm` copies these files into `public/librime-wasm` and writes `manifest.json` for the browser client.

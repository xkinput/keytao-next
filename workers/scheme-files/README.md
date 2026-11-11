# Scheme files Worker

`keytao.rea.ink` remains the API entry on Vercel with DNS-only DNS records.
All package uploads and downloads use `files.keytao.rea.ink`, the Worker's
custom domain. The Worker accesses the existing `keytao-scheme-packages` R2
bucket through the `BUCKET` binding. No S3 endpoint or S3 API credentials are
used. There are no CORS endpoints.

## Shared token contract

The shared implementation is `src/token.ts`. Vercel uses its payload encoder
and Node `createHmac`; the Worker uses WebCrypto HMAC-SHA256. A token is:

```text
base64url(UTF8(JSON.stringify(claims))).lowercaseHex(HMAC-SHA256(secret, encodedPayload))
```

Base64url has no padding. The signature covers the encoded payload exactly as
transmitted, not decoded or reserialized JSON. The secret is the raw UTF-8
`FILES_SIGNING_SECRET` value on both services; leading/trailing whitespace is
significant. Empty or whitespace-only secrets disable the service. Comparison
examines all 32 signature bytes without an early exit. Claims are:

| Method and path | Claims |
| --- | --- |
| `PUT /u/<token>` | `{op:"put", key, size, sha256, exp}` |
| `GET /d/<token>` | `{op:"get", key, filename, exp}` |
| `POST /internal/head/<token>` | `{op:"head", key, exp}` |
| `POST /internal/delete/<token>` | `{op:"delete", key, exp}` |

`exp` is an integer Unix timestamp in seconds and must be strictly later than
the current second. The API issues tokens valid for 600 seconds. Keys must
match `^scheme-packages/\d+/[0-9a-f-]{36}\.zip$`. Upload size is a positive
safe integer; SHA-256 is 64 lowercase hex characters. Download filenames are
strings and are escaped for `Content-Disposition`. Tokens are bearer
capabilities; avoid logging their URLs.

Uploads require `Content-Length` equal to the signed size, reject a missing
length or any `Transfer-Encoding`, and stream the original request body into
R2 with the declared `sha256` and ZIP content type. An existing key returns
409. In addition to the existence check, `onlyIf: {etagDoesNotMatch: "*"}`
prevents concurrent requests from overwriting a key. Successful writes return
201; a checksum rejected by R2 cannot produce a successful response.

Downloads stream R2's body with ZIP content type, object length and attachment
filename. Missing downloads or head objects return 404. Head returns JSON
`{size, sha256}`, using the stored R2 checksum; a missing checksum fails closed.
Delete returns 204, including when the key is absent. Invalid authorization
returns 403; unsupported paths or methods return 404. Responses use
`Cache-Control: private, no-store`.

## Deployment

Use an already available, authenticated Wrangler installation and an account
that owns the Cloudflare zone for `rea.ink` and the existing R2 bucket. Run:

```sh
cd workers/scheme-files
wrangler deploy
wrangler secret put FILES_SIGNING_SECRET
```

The secret command prompts for the value; do not put it in command arguments.
The Worker returns 503 between the initial deployment and setting the secret.
Set Vercel's `FILES_SIGNING_SECRET` to exactly the same value and
`FILES_BASE_URL=https://files.keytao.rea.ink` (the default), then redeploy the
Vercel application. Keep `keytao.rea.ink` on Vercel/DNS-only; the custom-domain
route in `wrangler.toml` configures only `files.keytao.rea.ink`. Neither the
R2 public endpoint nor S3 credentials are needed.

## Local checks and remaining verification

From the repository root, using the existing installed tools:

```sh
pnpm test:unit
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit -p workers/scheme-files/tsconfig.json
pnpm lint
```

The Worker's own TypeScript project uses the standard WebWorker library and a
minimal structural R2 binding interface, so it typechecks without installing
Wrangler or Cloudflare type packages. Unit tests mock R2 and fetch. They do
not verify the deployed binding, Cloudflare routing/TLS, platform handling of
request length, R2 checksum enforcement or atomic write conditions. After
deployment, verify these with a disposable package, including a bad checksum
and a repeated upload. No deployment or live R2 check is part of the local
verification.

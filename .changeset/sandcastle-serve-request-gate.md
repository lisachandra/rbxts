---
"@lisachandra/sandcastle": patch
---

Gate every `queue serve` request, and refuse a malformed percent-escape instead of dying

`startQueueServer` served the queue page and its two JSON endpoints on loopback with no request gate,
and one branch could throw out of the HTTP handler:

- `resolveStatic` called `decodeURIComponent` outside a `try`. `GET /%` throws `URIError`, the
  exception escaped the `createServer` callback, and the process died — reachable with no credentials
  from any page the developer visits, via a `no-cors` image request to `127.0.0.1:<port>`.
- `request.method` was never inspected, so `POST /api/queue` was answered as a GET with a `200`.
  `Origin` and `Host` were unchecked, so a cross-origin `fetch` could read private issue titles and
  batch notes, force uncached `gh` calls through `?refresh=1` (spending the token budget the cache
  exists to protect), and a DNS-rebinding page was same-origin with the API.
- `--host` accepted any non-empty string, so leaving loopback exposed the endpoints silently.

One gate now runs before routing and before the view cache is touched:

- A percent-escape that does not decode is a `400`; the server keeps running.
- A non-`GET` method is a `405` with `Allow: GET`.
- A present `Origin` must be this server's own (`http://<bound host>:<port>`), else `403`. A request
  with no `Origin` — a navigation, a `curl`, an image request — is still served, because browsers
  omit it for those.
- A `Host` that is not the bound address is a `403`. That is the rebinding defence; a default-port
  client may omit the port, but the host itself must match.
- No CORS header is ever sent, since one would undo the origin check.
- `queue serve --host <non-loopback>` now prints one warning naming the exposure instead of leaving
  it to be inferred from the flag.

The static containment check is unchanged and still refuses `..%2f`, `%2e%2e%5c`, `C:/…`, and
`//server/share`; the crash was the decoder, not the guard.

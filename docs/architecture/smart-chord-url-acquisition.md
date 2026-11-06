# Smart Chords URL acquisition contract

Status: contract for acquisition adapters converging on the existing TypeScript
parser. It does not grant permission to access a source or establish that live
source acquisition works. Android has one successful C1 paste/save/reopen proof,
but repeated acquisition remains blocked by native renderer startup. Experimental
capture is disabled by default.

## Shared boundary

Every URL acquisition adapter supplies the canonical CifraClub URL and a
bounded structural HTML projection to the existing authenticated endpoint:

```http
POST /api/v1/smart-chords/import/url
Authorization: Bearer <application session>
Content-Type: application/json
```

```json
{
  "url": "https://www.cifraclub.com.br/artista/musica/",
  "musical_html": "<h1 class=\"t1\">Título</h1><h2 class=\"t3\">Artista</h2><div id=\"cifra_tom\">Tom: G</div><div class=\"cifra_cnt\"><pre>G\nLetra</pre></div>"
}
```

`url` must be HTTPS on `cifraclub.com.br` or `www.cifraclub.com.br`, with the
canonical `/artist/song/` path and no credentials, nondefault port, query or fragment.
When `musical_html` is supplied, its maximum is 100,000 characters and unknown
request fields are rejected. The current global Express JSON body limit also
applies (default 100 KiB, including JSON overhead and UTF-8 encoding); the character
limit alone is not a promise that every Unicode payload of that length fits.
The authenticated endpoint calls
`parseCifraClubHtml(musical_html, url).draft` and returns a `SmartChordImportDraft`.
This path performs no source fetch and does not save a Smart Chord. If
`musical_html` is absent, the existing URL import behavior remains in place.

The TypeScript parser is the sole HTML-to-musical-draft interpreter. It owns
chord recognition, inline notation, normalization, warnings and the mapping to
`SmartChordImportDraft` (`title`, `artist_name`, `original_key`, `content`,
`warnings`, `source_type`, `original_text`, optional displayed key/capo and
`source_url`). Acquisition adapters must not add another musical parser or
persist their own draft model.

## Android acquisition adapter

The native WebView may provide rendered DOM only when source access is allowed.
The adapter validates the canonical URL before navigation, rejects a detected
challenge/CAPTCHA, and projects only the fields needed by the shared parser:

- `h1` title as `h1.t1`;
- the uniquely identified artist link text as `h2.t3`;
- explicit key as `#cifra_tom`;
- explicit capo, original key and version when present;
- raw musical text from one supported `pre` as `.cifra_cnt pre`.

The adapter escapes metadata and raw musical text when constructing this
projection. It preserves line breaks and spaces, and does not export
page scripts, cookies, unrelated markup or a broad HTML snapshot. Missing or
ambiguous metadata, multiple music blocks, unsupported nested elements,
challenge indicators and over-limit content fail closed. Source scripts may run
normally in the WebView; scripts are never included in the exported projection.
The Android adapter
submits the projection through the shared URL import endpoint; the backend
parser remains authoritative for interpreting it.

The acquisition callback is already independent of a native implementation:
`SmartChordImportNotifier.importUrl(url, capture: Future<String?> Function())`.
Non-null HTML is submitted by `SmartChordRepository.importCapturedUrlDraft`;
null means cancellation, and failures remain failures rather than metadata-only
success. UI-specific navigation stays inside the capture launcher. Session and
operation guards apply before submission and before preview. The adapter never
saves, normalizes chords, infers a key or transposes tablature.

Android startup recovery is limited to one fresh platform view after local
renderer readiness fails, before source navigation. The previous route must
finish disposal first and native release must be confirmed within two seconds.
The native bridge resolves only the controller's WebView in the current Flutter
engine through the plugin's public external API, removes its parent, stops loading
and calls destroy. Widget detachment alone is not assumed to destroy the WebView.
Native release success does not establish that Android's pending service/process
state was cleared. A ready renderer is not replaced during an operation. Cancellation, source
HTTP restrictions and failures after remote navigation are not retried.

## Web backend acquisition status

The legacy URL import request without `musical_html` remains metadata-only. A
separate guarded backend fetch/parser utility exists. M20-C3 obtained real musical
content through native Node HTTPS locally, using structural Cheerio projection
and the unchanged parser. Hosted acquisition has not been established and this
must not be described as a working Web import. The original web-tool page access
attempt returned HTTP403; that was not a native Node/Vercel observation. Fresh
local Node requests returned200, without identity changes or access-denial retries.
No alternate identity or challenge handling is authorized.
Backend fetch behavior still rejects non-200 responses, including403, without
redirects or retries. Source authorization has not been confirmed. Live backend
hosted acquisition remains **Unknown / Not yet verified** and blocked pending
authorized access and an end-to-end proof.

The SPA must call its existing API client, not fetch/read cross-origin source DOM
in a component: normal browser same-origin/CORS rules do not grant that access.
The extension point is the existing guarded backend acquisition utility feeding
the same parser. It must be explicitly enabled only after real acquisition is
proven. If that acquisition returns 403, return a blocked acquisition outcome;
do not substitute empty metadata for a successful full import, use a proxy, spoof
identity, or ask the user to bypass browser protections. No Web acquisition is
enabled by this contract.

The isolated C3 helper is `importCifraClubDirect(url).draft`: validated/pinned HTTPS
acquisition -> `projectCifraClubHtml` structural adapter -> authoritative existing
parser. The projector supports the current article/pre layout and the legacy
canonical layout, preserves raw musical spacing, omits hidden descendants and
never interprets chords. It is not wired into the normal URL route or UI.
See `docs/exec-plans/evidence/2026-10-28-m20-c3-backend-acquisition.json` for real
local checks, cloud-proof limitations, resource samples and headless assessment.

## iOS future adapter

An iOS `WKWebView` adapter is future work and has not been implemented or tested.
If added, it must produce the same bounded structural projection, call the same
authenticated endpoint and rely on the existing TypeScript parser. It must not
create a Swift musical parser, alternative import endpoint or persistence path.

WKWebView integration must keep a valid mounted view under application-owned
progress, inspect main-frame navigation responses and enforce the same allowed
URL/final-origin rules. Await musical DOM rather than treating didFinish as
musical readiness. evaluateJavaScript returns a platform value that must decode
to the same JSON projection; injected DOM projection code can be shared, while
navigation/lifecycle callbacks differ. A nonpersistent WKWebsiteDataStore can
isolate website data from application authentication; never inject LouvAIO tokens
or transfer website cookies. didFail/didFailProvisionalNavigation and
webViewWebContentProcessDidTerminate require bounded cancellation/recovery and
stale-result guards. These are future design requirements, not implemented or
validated iOS capabilities. No Android-specific controller belongs in that
adapter interface.

## Verification boundary

Synthetic route coverage proves the supplied-HTML contract and parser handoff;
it does not prove that any platform can access the live source. No source
permission has been confirmed. Rendered DOM acquisition and end-to-end
Android/Web/iOS equivalence remain **Unknown / Not yet verified** unless
supported by separate recorded evidence. A platform adapter must not be marked
functional based only on a synthetic projection or parser test.

`fixtures/smart-chords/url-acquisition-contract.json` is a shared synthetic
transport vector. The backend route test checks its complete expected draft and
absence of source fetch/persistence. The Flutter consumer test checks the same
draft and exact musical text through the existing save payload, including Bb,
slash chords and all six tablature rows. These tests cover the shared boundary;
they do not simulate or prove functioning Web/iOS acquisition.

Relevant platform references: [Android WebView process/memory lifecycle](https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory),
[WKWebView process termination callback](https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:)),
and [nonpersistent WKWebsiteDataStore](https://developer.apple.com/documentation/webkit/wkwebsitedatastore/nonpersistent()).

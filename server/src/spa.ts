// Which request paths the SPA's catch-all must NOT answer with index.html.
//
// Lives in its own module purely so it can be unit-tested: index.ts opens listening
// sockets at import time, so a test cannot import the fallback logic from there.

/**
 * Extensions a browser fetches as a subresource. Kept to a closed list rather than a
 * generic `/\.\w+$/`, so a legitimate SPA deep link that happens to contain a dot
 * (a slug, an id, an email) still renders the app instead of 404ing.
 */
const ASSET_EXT =
  /\.(?:js|mjs|cjs|css|map|json|webmanifest|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|wasm|txt|xml|pdf)$/i;

/**
 * True for a request that wants a build artefact rather than an application route.
 *
 * The catch-all must 404 these instead of falling through to index.html. After a
 * redeploy the asset filenames carry new content hashes, so a browser still holding the
 * previous index.html asks for a filename that no longer exists. Answering that with
 * index.html returns HTML under `content-type: text/html`; the browser then tries to
 * execute markup as JavaScript and renders a blank page with nothing useful in the
 * console. A 404 fails loudly and lets the client recover with a reload.
 */
export function isStaticAssetPath(pathname: string): boolean {
  return pathname.startsWith('/assets/') || ASSET_EXT.test(pathname);
}

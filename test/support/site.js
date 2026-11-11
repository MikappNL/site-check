// @ts-check
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkBuild } from "../../src/build.js";
import { parseConfig } from "../../src/config.js";

export const SITE = "https://example.nl";

/** @type {string[]} */
const folders = [];

/**
 * Builds a site from `files` in a fresh folder and checks it.
 * @param {Record<string, string>} files Relative path to content.
 * @param {Record<string, unknown>} [settings] Config settings besides site and dist.
 */
export async function checkFiles(files, settings = {}) {
    const dist = await mkdtemp(path.join(tmpdir(), "site-check-"));
    folders.push(dist);
    for (const [file, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(dist, file)), { recursive: true });
        await writeFile(path.join(dist, file), content);
    }
    return checkBuild(parseConfig({ site: SITE, dist, ...settings }));
}

export async function removeFolders() {
    await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
}

/**
 * A page that passes every check, with the parts a test changes.
 * @param {{ address?: string, title?: string, lang?: string, head?: string, body?: string, canonical?: boolean }} [parts]
 */
export function page({ address = "/", title = `Pagina ${address}`, lang = "nl", head = "", body = "<h1>Welkom</h1>", canonical = true } = {}) {
    return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="Een pagina om de controle mee te testen.">
${canonical ? `<link rel="canonical" href="${new URL(address, SITE).href}">` : ""}
<meta property="og:image" content="${SITE}/og.png">
${head}
</head>
<body>${body}</body>
</html>`;
}

/** @param {string[]} addresses */
export function sitemap(addresses) {
    const urls = addresses.map((address) => `<url><loc>${new URL(address, SITE).href}</loc></url>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

/**
 * A small site without problems: a home page, one more page, a 404 page, robots.txt, a sitemap and the share image.
 * @param {Record<string, string>} [changes] Files to add or replace.
 * @returns {Record<string, string>}
 */
export function goodSite(changes = {}) {
    return {
        "index.html": page({ address: "/", body: '<h1>Welkom</h1><a href="/over">Over ons</a>' }),
        "over/index.html": page({ address: "/over", body: '<h1>Over ons</h1><p id="team">Het team</p><a href="/">Home</a>' }),
        "404.html": page({ address: "/404", head: '<meta name="robots" content="noindex">', canonical: false }),
        "robots.txt": `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
        "sitemap.xml": sitemap(["/", "/over"]),
        "og.png": "image",
        ...changes,
    };
}

// @ts-check
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isNoindex, linksWithRel, metaContent, readDocument } from "./html.js";
import { Report } from "./report.js";
import { blocksEverything, sitemapsIn } from "./robots.js";
import { readSitemap } from "./sitemap.js";

/**
 * @typedef {import("./config.js").Config} Config
 * @typedef {import("./html.js").Document} Document
 */

/**
 * @typedef {object} Page
 * @property {string} address The path the page is served at: "/werk", or "/werk/" on a site with trailing slashes.
 * @property {string} url The full address: "https://mikapp.nl/werk".
 * @property {Document} document
 * @property {boolean} notFound A 404 page: the host shows it for addresses that do not exist.
 * @property {boolean} indexable A page search engines should find: in the sitemap, with a canonical link.
 */

/**
 * @typedef {object} Site
 * @property {Config} config
 * @property {Set<string>} files Every file in the build, relative and with forward slashes: "images/logo.svg".
 * @property {Map<string, Page>} pages By address.
 * @property {boolean} closed Every page has noindex: a preview, or a site that is not open yet.
 */

/**
 * @typedef {{ kind: "page", page: Page } | { kind: "file", file: string } | { kind: "other-form", page: Page } | { kind: "missing" }} Target
 * What an address on the site leads to. "other-form" is a page asked for with or without the trailing slash it does not
 * use, which the host answers with a redirect.
 */

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 155;

/**
 * Checks the built site in `config.dist`, the way search engines and visitors will meet it.
 * @param {Config} config
 */
export async function checkBuild(config) {
    const site = await readSite(config);
    const report = new Report();
    const pages = [...site.pages.values()];

    if (pages.length === 0) {
        report.error(config.dist, "has no HTML pages; build the site first, or point dist at the folder the build writes");
        return { report, pageCount: 0 };
    }

    if (site.closed) {
        report.warning("every page", "has noindex, so search engines will not show this site: fine for a preview, not for the handover");
    }

    for (const page of pages) checkPage(page, site, report);
    checkDuplicateTitles(pages, report);
    await checkManifests(site, report);
    await checkRobotsAndSitemap(site, report);

    if (!site.files.has("404.html")) {
        report.error("404.html", "is missing, so the host cannot answer an unknown address with a real 404 page");
    }
    return { report, pageCount: pages.length };
}

/**
 * @param {Config} config
 * @returns {Promise<Site>}
 */
async function readSite(config) {
    const files = (await readdir(config.dist, { recursive: true, withFileTypes: true }))
        .filter((entry) => entry.isFile())
        .map((entry) => path.relative(config.dist, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));

    /** @type {Map<string, Page>} */
    const pages = new Map();
    for (const file of files.filter((name) => name.endsWith(".html"))) {
        const address = pageAddress(file, config.trailingSlash);
        if (config.ignore.some((prefix) => address.startsWith(prefix))) continue;
        const document = readDocument(await readFile(path.join(config.dist, file), "utf8"));
        pages.set(address, { address, url: new URL(address, config.site).href, document, notFound: false, indexable: false });
    }

    // A site that is not open yet has noindex on every page. The pages with a canonical link are still checked as the
    // pages search engines will find once it opens.
    const closed = [...pages].every(([address, page]) => isNotFound(address) || isNoindex(page.document));
    for (const [address, page] of pages) {
        page.notFound = isNotFound(address);
        const opensLater = closed && linksWithRel(page.document, "canonical").length > 0;
        page.indexable = !page.notFound && (opensLater || !isNoindex(page.document));
    }
    return { config, files: new Set(files), pages, closed };
}

/**
 * The address a host serves a built file at.
 * @param {string} file Relative, with forward slashes.
 * @param {boolean} trailingSlash
 */
export function pageAddress(file, trailingSlash) {
    if (file === "index.html") return "/";
    if (file.endsWith("/index.html")) {
        const folder = `/${file.slice(0, -"/index.html".length)}`;
        return trailingSlash ? `${folder}/` : folder;
    }
    return `/${file.slice(0, -".html".length)}`;
}

/** @param {string} address */
function isNotFound(address) {
    return address === "/404" || address.endsWith("/404");
}

/**
 * @param {Page} page
 * @param {Site} site
 * @param {Report} report
 */
function checkPage(page, site, report) {
    const { document } = page;
    const where = page.address;

    if (!document.lang) report.error(where, 'has no <html lang="…">, so screen readers and search engines guess the language');

    if (document.titles.length !== 1) report.error(where, `needs exactly one <title>, has ${document.titles.length}`);
    else if (!document.titles[0]) report.error(where, "has an empty <title>");
    else if (document.titles[0].length > TITLE_MAX) {
        report.warning(where, `has a title of ${document.titles[0].length} characters; Google cuts it off after about ${TITLE_MAX}`);
    }

    const description = metaContent(document, "description")?.trim();
    if (!description) report.error(where, "has no meta description");
    else if (description.length > DESCRIPTION_MAX) {
        report.warning(where, `has a description of ${description.length} characters; Google cuts it off after about ${DESCRIPTION_MAX}`);
    }

    const h1Count = document.bodyTags.filter((tag) => tag.name === "h1").length;
    if (h1Count !== 1) report.error(where, `needs exactly one <h1>, has ${h1Count}`);

    if (page.indexable) checkIndexablePage(page, site, report);
    else if (!page.notFound) {
        const canonical = linksWithRel(document, "canonical")[0]?.attributes.get("href");
        if (canonical && !sameUrl(canonical, page.url)) {
            report.warning(where, `has noindex and a canonical link to ${canonical}, which tell search engines opposite things`);
        }
    }
    if (!page.notFound) checkLanguageLinks(page, site, report);

    for (const json of document.jsonLd) {
        try {
            JSON.parse(json);
        } catch {
            report.error(where, "has structured data (JSON-LD) that is not valid JSON");
        }
    }
    for (const id of document.duplicateIds) report.error(where, `has the id "${id}" more than once`);
    if (document.hasStreamingLeftovers) {
        report.error(where, "still has React's loading placeholders: part of the page did not render before the HTML was written");
    }
    if (document.mentionsLocalhost) report.error(where, "mentions localhost, which only works on the developer's computer");

    checkLinks(page, site, report);
    checkImages(page, report);
    checkAssets(page, site, report);
    checkThirdParties(page, site, report);
}

/**
 * @param {Page} page
 * @param {Site} site
 * @param {Report} report
 */
function checkIndexablePage(page, site, report) {
    const { document } = page;
    const where = page.address;

    const canonicals = linksWithRel(document, "canonical").map((link) => link.attributes.get("href") ?? "");
    if (canonicals.length !== 1) report.error(where, `needs exactly one canonical link, has ${canonicals.length}`);
    else if (!sameUrl(canonicals[0], page.url)) report.error(where, `has canonical ${canonicals[0]}, expected ${page.url}`);

    const ogUrl = metaContent(document, "og:url");
    if (ogUrl && !sameUrl(ogUrl, page.url)) report.error(where, `has og:url ${ogUrl}, expected ${page.url}`);

    const ogImage = metaContent(document, "og:image");
    if (!ogImage) report.error(where, "has no share image (og:image)");
    else if (!URL.canParse(ogImage)) report.error(where, `has share image ${ogImage}; it needs the full address, with https://`);
    else if (new URL(ogImage).origin === site.config.site && resolve(new URL(ogImage), site).kind === "missing") {
        report.error(where, `has share image ${ogImage}, which is not in the build`);
    }
}

/**
 * @param {Page} page
 * @param {Site} site
 * @param {Report} report
 */
function checkLanguageLinks(page, site, report) {
    const own = languageLinks(page.document);
    if (own.length === 0) return;
    const where = page.address;

    const self = own.find((link) => sameUrl(link.href, page.url));
    if (!self) report.error(where, "has language links (hreflang) that leave out the page itself");
    else if (page.document.lang && primaryLanguage(self.language) !== primaryLanguage(page.document.lang)) {
        report.error(where, `has <html lang="${page.document.lang}"> but calls itself "${self.language}" in its language links`);
    }
    if (!own.some((link) => link.language === "x-default")) report.error(where, "has language links (hreflang) without x-default");

    const expected = languageSet(own);
    for (const href of new Set(own.map((link) => link.href))) {
        const url = URL.parse(href);
        const target = url ? resolve(url, site) : undefined;
        if (!target) report.error(where, `has a language link to ${href}; it needs the full address, with https://`);
        else if (target.kind !== "page") report.error(where, `has a language link to ${href}, which is not a page`);
        else if (target.page === page) continue;
        else if (page.indexable && !target.page.indexable) {
            report.error(where, `has a language link to ${href}, which has noindex`);
        } else if (languageSet(languageLinks(target.page.document)) !== expected) {
            report.error(where, `has language links that ${target.page.address} does not return`);
        }
    }
}

/** @param {Document} document */
function languageLinks(document) {
    return linksWithRel(document, "alternate")
        .filter((link) => link.attributes.has("hreflang"))
        .map((link) => ({ language: (link.attributes.get("hreflang") ?? "").toLowerCase(), href: link.attributes.get("href") ?? "" }));
}

/**
 * Language links as one comparable value, so two pages can be checked for naming the same set.
 * @param {{ language: string, href: string }[]} links
 */
function languageSet(links) {
    return links
        .map((link) => `${link.language} ${URL.parse(link.href)?.href ?? link.href}`)
        .sort()
        .join("\n");
}

/** @param {string} language */
function primaryLanguage(language) {
    return language.toLowerCase().split("-")[0];
}

/**
 * @param {Page} page
 * @param {Site} site
 * @param {Report} report
 */
function checkLinks(page, site, report) {
    const where = page.address;
    for (const tag of page.document.bodyTags) {
        if (tag.name !== "a" || !tag.attributes.has("href")) continue;
        const href = tag.attributes.get("href") ?? "";

        if (tag.attributes.get("target") === "_blank") {
            const rel = (tag.attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
            if (!rel.includes("noopener") && !rel.includes("noreferrer")) {
                report.error(where, `opens ${href} in a new tab without rel="noopener"`);
            }
        }

        const url = URL.parse(href, page.url);
        if (!url) report.error(where, `has a link that is not a valid address: ${href}`);
        if (!url || url.origin !== site.config.site) continue;

        const target = resolve(url, site);
        if (target.kind === "missing") {
            report.error(where, `links to ${href}, which does not exist`);
        } else if (target.kind === "other-form") {
            report.warning(where, `links to ${href}; the page is ${target.page.address}, so the host has to redirect first`);
        } else if (target.kind === "page") {
            const id = fragment(url);
            if (id && !target.page.document.ids.has(id)) {
                report.error(where, `links to ${href}, but ${target.page.address} has no id "${id}"`);
            }
        }
    }
}

/**
 * The part after "#", left out when it needs no element: "#top" and a text fragment scroll by themselves.
 * @param {URL} url
 */
function fragment(url) {
    let id;
    try {
        id = decodeURIComponent(url.hash.slice(1));
    } catch {
        id = url.hash.slice(1);
    }
    return id === "top" || id.startsWith(":~:") ? "" : id;
}

/**
 * @param {Page} page
 * @param {Report} report
 */
function checkImages(page, report) {
    for (const tag of page.document.bodyTags) {
        if (tag.name === "img" && !tag.attributes.has("alt")) {
            report.error(page.address, `has an image without alt text: ${tag.attributes.get("src") ?? "(no src)"}`);
        }
    }
}

/**
 * Files the browser loads with the page: they must be in the build.
 * @param {Page} page
 * @param {Site} site
 * @param {Report} report
 */
function checkAssets(page, site, report) {
    for (const address of loadedAddresses(page.document)) {
        const url = URL.parse(address, page.url);
        if (url?.origin === site.config.site && resolve(url, site).kind === "missing") {
            report.error(page.address, `loads ${address}, which is not in the build`);
        }
    }
}

/**
 * Nothing may load from another site before the visitor agrees: Google Fonts or an Analytics tag in the HTML would.
 * @param {Page} page
 * @param {Site} site
 * @param {Report} report
 */
function checkThirdParties(page, site, report) {
    const origins = new Set();
    for (const address of loadedAddresses(page.document)) {
        const url = URL.parse(address, page.url);
        if (url && ["http:", "https:"].includes(url.protocol) && url.origin !== site.config.site) origins.add(url.origin);
    }
    for (const origin of origins) {
        report.error(page.address, `loads something from ${origin} before the visitor has agreed to it`);
    }
}

const LOADED_LINKS = ["stylesheet", "icon", "apple-touch-icon", "manifest", "preload", "modulepreload", "preconnect", "dns-prefetch"];
const MEDIA_TAGS = ["img", "source", "video", "audio", "track", "iframe", "embed"];

/**
 * Every address the browser fetches while it shows the page, before anyone clicks.
 * @param {Document} document
 */
function loadedAddresses(document) {
    /** @type {string[]} */
    const addresses = [];
    for (const link of document.links) {
        const rel = (link.attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
        if (rel.some((value) => LOADED_LINKS.includes(value))) addresses.push(link.attributes.get("href") ?? "");
    }
    for (const script of document.scripts) {
        const src = script.attributes.get("src");
        if (src) addresses.push(src);
    }
    for (const tag of document.bodyTags.filter((tag) => MEDIA_TAGS.includes(tag.name))) {
        for (const name of ["src", "poster"]) {
            const value = tag.attributes.get(name);
            if (value) addresses.push(value);
        }
        const srcset = tag.attributes.get("srcset");
        if (srcset) addresses.push(...srcset.split(",").map((candidate) => candidate.trim().split(/\s+/)[0]));
    }
    return addresses.filter((address) => address && !address.startsWith("data:"));
}

/**
 * @param {Page[]} pages
 * @param {Report} report
 */
function checkDuplicateTitles(pages, report) {
    /** @type {Map<string, string[]>} */
    const byTitle = new Map();
    for (const page of pages.filter((page) => page.indexable && page.document.titles.length === 1)) {
        const title = page.document.titles[0];
        byTitle.set(title, [...(byTitle.get(title) ?? []), page.address]);
    }
    for (const [title, addresses] of byTitle) {
        if (addresses.length > 1) report.error(addresses.join(", "), `share the title "${title}"; every page needs its own`);
    }
}

/**
 * The icons a web manifest names must exist, or a phone shows a blank square on the home screen.
 * @param {Site} site
 * @param {Report} report
 */
async function checkManifests(site, report) {
    const manifests = new Set();
    for (const page of site.pages.values()) {
        for (const link of linksWithRel(page.document, "manifest")) {
            const url = URL.parse(link.attributes.get("href") ?? "", page.url);
            const target = url && url.origin === site.config.site ? resolve(url, site) : undefined;
            if (target?.kind === "file") manifests.add(target.file);
        }
    }
    for (const file of manifests) {
        let icons;
        try {
            icons = JSON.parse(await readFile(path.join(site.config.dist, file), "utf8")).icons ?? [];
        } catch {
            report.error(file, "is not valid JSON");
            continue;
        }
        for (const icon of icons) {
            if (typeof icon?.src !== "string") {
                report.error(file, "names an icon without src");
                continue;
            }
            const url = URL.parse(icon.src, `${site.config.site}/${file}`);
            if (url?.origin === site.config.site && resolve(url, site).kind === "missing") {
                report.error(file, `names the icon ${icon.src}, which is not in the build`);
            }
        }
    }
}

/**
 * @param {Site} site
 * @param {Report} report
 */
async function checkRobotsAndSitemap(site, report) {
    const { config } = site;
    /** @type {string[]} */
    let sitemapFiles = [];

    if (!site.files.has("robots.txt")) {
        report.error("robots.txt", "is missing; search engines look for it first");
    } else {
        const robots = await readFile(path.join(config.dist, "robots.txt"), "utf8");
        if (blocksEverything(robots)) report.warning("robots.txt", "tells every search engine to stay away from the whole site");
        const named = sitemapsIn(robots);
        if (named.length === 0) report.warning("robots.txt", "has no Sitemap line, so search engines have to guess where it is");
        for (const address of named) {
            const url = URL.parse(address);
            const target = url?.origin === config.site ? resolve(url, site) : undefined;
            if (!target) report.error("robots.txt", `names the sitemap ${address}, which is not on ${config.site}`);
            else if (target.kind !== "file") report.error("robots.txt", `names the sitemap ${address}, which is not in the build`);
            else sitemapFiles.push(target.file);
        }
    }
    if (sitemapFiles.length === 0) sitemapFiles = ["sitemap.xml", "sitemap-index.xml"].filter((file) => site.files.has(file));
    if (sitemapFiles.length === 0) {
        report.error("sitemap.xml", "is missing, so search engines have to find every page by themselves");
        return;
    }

    /** @type {Set<string>} */
    const listed = new Set();
    while (sitemapFiles.length > 0) {
        const file = /** @type {string} */ (sitemapFiles.shift());
        const sitemap = readSitemap(await readFile(path.join(config.dist, file), "utf8"));
        for (const location of sitemap.locations) {
            const url = URL.parse(location);
            if (!url || url.origin !== config.site) {
                report.error(file, `lists ${location}, which is not on ${config.site}`);
                continue;
            }
            const target = resolve(url, site);
            if (sitemap.isIndex && target.kind === "file") sitemapFiles.push(target.file);
            else if (sitemap.isIndex) report.error(file, `lists the sitemap ${location}, which is not in the build`);
            else if (target.kind !== "page" || target.page.url !== url.href) {
                report.error(file, `lists ${location}, which is not a page with that exact address`);
            } else if (!target.page.indexable) {
                report.error(file, `lists ${location}, which has noindex`);
            } else listed.add(url.href);
        }
    }

    for (const page of site.pages.values()) {
        if (page.indexable && !listed.has(page.url)) report.error(page.address, "is missing from the sitemap");
    }
}

/**
 * @param {URL} url An address on the site.
 * @param {Site} site
 * @returns {Target}
 */
export function resolve(url, site) {
    let pathname;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return { kind: "missing" };
    }

    const page = site.pages.get(pathname);
    if (page) return { kind: "page", page };

    const file = pathname.slice(1);
    if (site.files.has(file)) return { kind: "file", file };
    if (site.files.has(`${file}index.html`) || site.files.has(`${file}/index.html`) || site.files.has(`${file}.html`)) {
        const otherForm = site.pages.get(pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`);
        if (otherForm) return { kind: "other-form", page: otherForm };
        // An HTML file outside the pages, such as one the config ignores.
        return { kind: "file", file };
    }
    return { kind: "missing" };
}

/**
 * @param {string} a
 * @param {string} b
 */
function sameUrl(a, b) {
    return URL.canParse(a) && URL.canParse(b) && new URL(a).href === new URL(b).href;
}

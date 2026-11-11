// @ts-check
// Just enough HTML reading for the checks, without a parser dependency. It reads finished, prerendered pages, so it
// only has to understand start tags and their attributes, in any order and with any kind of quotes: Vite, React
// Router and Astro each write them a little differently.

/**
 * @typedef {object} Tag
 * @property {string} name Lower-case tag name.
 * @property {Map<string, string>} attributes Lower-case attribute names; an attribute without a value maps to "".
 */

/**
 * @typedef {object} Document
 * @property {string | undefined} lang
 * @property {string[]} titles The text of every `<title>` in the head.
 * @property {Tag[]} metas
 * @property {Tag[]} links
 * @property {string[]} jsonLd The text of every `application/ld+json` script.
 * @property {Tag[]} bodyTags Every start tag in the body, outside scripts, styles, templates and comments.
 * @property {Tag[]} scripts Every `<script>` start tag, in the head and the body.
 * @property {Set<string>} ids
 * @property {string[]} duplicateIds
 * @property {boolean} hasStreamingLeftovers
 * @property {boolean} mentionsLocalhost
 */

const START_TAG = /<([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** @param {string} source */
function startTags(source) {
    /** @type {Tag[]} */
    const tags = [];
    for (const [, name, rest] of source.matchAll(START_TAG)) {
        const attributes = new Map();
        for (const [, key, double, single, bare] of rest.matchAll(ATTRIBUTE)) {
            attributes.set(key.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ""));
        }
        tags.push({ name: name.toLowerCase(), attributes });
    }
    return tags;
}

/** @param {string} text */
export function decodeEntities(text) {
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
        .replaceAll("&nbsp;", " ")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
}

/**
 * Reads what the checks need from one page. Scripts, styles, templates and comments are left out of the body, so text
 * such as "<h1" inside hydration data or an inline script never counts as markup.
 * @param {string} html
 * @returns {Document}
 */
export function readDocument(html) {
    const markup = html.replace(/<!--[\s\S]*?-->/g, "");
    const headEnd = markup.search(/<\/head>|<body[\s>]/i);
    const head = headEnd === -1 ? markup : markup.slice(0, headEnd);
    const body = headEnd === -1 ? "" : markup.slice(headEnd).replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, "");

    const allTags = startTags(markup);
    const headTags = startTags(head);
    const bodyTags = startTags(body);

    const ids = bodyTags.flatMap((tag) => tag.attributes.get("id") ?? []);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];

    return {
        lang: allTags.find((tag) => tag.name === "html")?.attributes.get("lang"),
        titles: [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)].map(([, text]) => decodeEntities(text).trim()),
        metas: headTags.filter((tag) => tag.name === "meta"),
        links: headTags.filter((tag) => tag.name === "link"),
        jsonLd: [...markup.matchAll(/<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map(
            ([, json]) => json,
        ),
        bodyTags,
        scripts: allTags.filter((tag) => tag.name === "script"),
        ids: new Set(ids),
        duplicateIds,
        // A prerender that suspended leaves React's streaming placeholders behind instead of the content.
        hasStreamingLeftovers: html.includes("<!--$?-->") || html.includes('<template id="B:'),
        mentionsLocalhost: /\/\/(localhost|127\.0\.0\.1)[:/]/.test(html),
    };
}

/**
 * The content of the first `<meta>` whose `name` or `property` is `key`.
 * @param {Document} document
 * @param {string} key
 */
export function metaContent(document, key) {
    const tag = document.metas.find((meta) => meta.attributes.get("name") === key || meta.attributes.get("property") === key);
    return tag?.attributes.get("content");
}

/**
 * Every `<link>` whose `rel` contains `rel`.
 * @param {Document} document
 * @param {string} rel
 */
export function linksWithRel(document, rel) {
    return document.links.filter((link) => (link.attributes.get("rel") ?? "").toLowerCase().split(/\s+/).includes(rel));
}

/** @param {Document} document */
export function isNoindex(document) {
    return document.metas.some(
        (meta) =>
            ["robots", "googlebot"].includes(meta.attributes.get("name")?.toLowerCase() ?? "") &&
            (meta.attributes.get("content") ?? "").toLowerCase().includes("noindex"),
    );
}

// @ts-check
import { readFile } from "node:fs/promises";

/**
 * @typedef {object} Redirect
 * @property {string} from An address on the site, such as "/contact".
 * @property {string} to Where it must lead, such as "/#contact".
 */

/**
 * @typedef {object} Config
 * @property {string} site The address the site goes online at, without a trailing slash: "https://mikapp.nl".
 * @property {string} dist The folder with the built site, relative to where site-check runs.
 * @property {boolean} trailingSlash Whether page addresses end in a slash ("/werk/") or not ("/werk").
 * @property {string[]} ignore Address prefixes of HTML files that are not pages, such as a host's form helper.
 * @property {Redirect[]} redirects Old addresses the host must send on with a permanent redirect.
 * @property {string[]} gone Old addresses that must answer 404 or 410.
 */

export const CONFIG_FILE = "site-check.config.json";

const KEYS = ["site", "dist", "trailingSlash", "ignore", "redirects", "gone"];

/**
 * Reads and checks the config file. The file is written by hand, so a mistake gets a clear message here instead of a
 * confusing one halfway through a check.
 * @param {string} file
 * @returns {Promise<Config>}
 */
export async function loadConfig(file) {
    let text;
    try {
        text = await readFile(file, "utf8");
    } catch {
        throw new Error(`${file} was not found. Create it with at least { "site": "https://example.nl" }.`);
    }
    try {
        return parseConfig(JSON.parse(text));
    } catch (error) {
        throw new Error(`${file}: ${error instanceof Error ? error.message : error}`);
    }
}

/**
 * @param {unknown} raw
 * @returns {Config}
 */
export function parseConfig(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("must be a JSON object");
    const values = /** @type {Record<string, unknown>} */ (raw);

    for (const key of Object.keys(values)) {
        if (!KEYS.includes(key)) throw new Error(`"${key}" is not a setting; use ${KEYS.join(", ")}`);
    }

    return {
        site: siteAddress(values.site),
        dist: optional(values.dist, "dist", isString, "dist must be a folder name"),
        trailingSlash: optional(values.trailingSlash, false, isBoolean, "trailingSlash must be true or false"),
        ignore: optional(values.ignore, [], isAddressList, 'ignore must be a list of addresses starting with "/"'),
        redirects: optional(values.redirects, [], isRedirectList, 'redirects must be a list of { "from": "/old", "to": "/new" }'),
        gone: optional(values.gone, [], isAddressList, 'gone must be a list of addresses starting with "/"'),
    };
}

/** @param {unknown} value */
function siteAddress(value) {
    if (typeof value !== "string") throw new Error('needs "site", the address the site goes online at');
    const url = URL.parse(value);
    if (!url || !["http:", "https:"].includes(url.protocol) || url.pathname.replace(/\/$/, "") || url.search || url.hash) {
        throw new Error(`site must be just the address of the home page, like "https://mikapp.nl", not "${value}"`);
    }
    return url.origin;
}

/**
 * @template T
 * @param {unknown} value
 * @param {T} fallback
 * @param {(value: unknown) => value is T} isValid
 * @param {string} message
 * @returns {T}
 */
function optional(value, fallback, isValid, message) {
    if (value === undefined) return fallback;
    if (!isValid(value)) throw new Error(message);
    return value;
}

/** @returns {value is string} */
function isString(/** @type {unknown} */ value) {
    return typeof value === "string" && value.length > 0;
}

/** @returns {value is boolean} */
function isBoolean(/** @type {unknown} */ value) {
    return typeof value === "boolean";
}

/** @returns {value is string[]} */
function isAddressList(/** @type {unknown} */ value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string" && item.startsWith("/"));
}

/** @returns {value is Redirect[]} */
function isRedirectList(/** @type {unknown} */ value) {
    return (
        Array.isArray(value) &&
        value.every((item) => typeof item?.from === "string" && item.from.startsWith("/") && typeof item.to === "string" && item.to.startsWith("/"))
    );
}

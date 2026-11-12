// @ts-check
import { isNoindex, linksWithRel, readDocument } from "./html.js";
import { Report } from "./report.js";
import { sitemapsIn } from "./robots.js";
import { readSitemap } from "./sitemap.js";

/**
 * @typedef {import("./config.js").Config} Config
 * @typedef {import("./html.js").Document} Document
 */

/**
 * @typedef {object} Answer
 * @property {number} status
 * @property {string | null} location The redirect target, made absolute.
 * @property {string} contentType
 * @property {string} robotsTag The X-Robots-Tag header, which a host can add to any page outside the HTML.
 * @property {string} text
 */

// A plain name, so the request says nothing about who runs the check.
const USER_AGENT = "site-check";
const PARALLEL_REQUESTS = 8;

/**
 * Checks what the host really answers: the build can be right while the host's redirects and rewrites are wrong, as a
 * catch-all rewrite to /index.html was on mikapp.nl until November 2026.
 * @param {Config} config
 * @param {{ fetch?: typeof globalThis.fetch }} [options] A fake fetch for tests.
 */
export async function checkLive(config, { fetch = globalThis.fetch } = {}) {
    const report = new Report();
    /** @type {Map<string, Promise<Answer>>} */
    const answers = new Map();

    /**
     * Each address is asked once, and redirects are not followed, so every check sees exactly what the host sends.
     * @param {string} address
     * @returns {Promise<Answer>}
     */
    function get(address) {
        const url = new URL(address, config.site).href;
        let answer = answers.get(url);
        if (!answer) {
            answer = fetch(url, { redirect: "manual", headers: { "user-agent": USER_AGENT } }).then(async (response) => ({
                status: response.status,
                location: response.headers.has("location") ? new URL(response.headers.get("location") ?? "", url).href : null,
                contentType: response.headers.get("content-type") ?? "",
                robotsTag: response.headers.get("x-robots-tag") ?? "",
                text: await response.text(),
            }));
            answers.set(url, answer);
        }
        return answer;
    }

    /**
     * Runs one check; an address that cannot be reached becomes a problem instead of stopping the rest.
     * @param {string} where
     * @param {() => Promise<void>} check
     * @param {"error" | "warning"} [level]
     * @returns {Promise<boolean>} Whether the host answered.
     */
    async function attempt(where, check, level = "error") {
        try {
            await check();
            return true;
        } catch (error) {
            // fetch hides the real reason (no such host, a certificate problem) in its cause.
            const reason = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
            report[level](where, `could not be reached: ${reason.trim()}`);
            return false;
        }
    }

    const reachable = await attempt("/", async () => {
        const home = await get("/");
        if (home.status !== 200) report.error("/", `answers ${describe(home)}, expected 200`);
    });
    if (!reachable) return { report, pageCount: 0 };

    /** @type {string[]} */
    let sitemaps = [];
    await attempt("/robots.txt", async () => {
        const robots = await get("/robots.txt");
        if (robots.status !== 200) report.error("/robots.txt", `answers ${describe(robots)}, expected 200`);
        else if (!robots.contentType.startsWith("text/plain")) {
            report.error("/robots.txt", `is sent as ${robots.contentType || "an unknown type"} instead of text/plain`);
        } else sitemaps = sitemapsIn(robots.text);
    });

    const pages = await listedPages(sitemaps.length > 0 ? sitemaps : [`${config.site}/sitemap.xml`]);
    /** @type {Map<string, string[]>} */
    const byTitle = new Map();
    let shown = 0;
    /** @type {{ address: string, source: string }[]} */
    const hidden = [];
    await forEachLimited(pages, PARALLEL_REQUESTS, (page) =>
        attempt(pathOf(page), async () => {
            const answer = await get(page);
            if (answer.status !== 200) {
                report.error(pathOf(page), `answers ${describe(answer)}; the sitemap should only list addresses that answer 200`);
                return;
            }
            shown++;
            const document = readDocument(answer.text);
            const source = noindexSource(document, answer);
            if (source) hidden.push({ address: pathOf(page), source });
            const canonical = linksWithRel(document, "canonical")[0]?.attributes.get("href");
            if (!canonical || URL.parse(canonical)?.href !== page) {
                report.error(pathOf(page), `has canonical ${canonical ?? "(none)"}, while the sitemap lists ${page}`);
            }
            const title = document.titles[0] ?? "";
            byTitle.set(title, [...(byTitle.get(title) ?? []), pathOf(page)]);
        }),
    );
    for (const [title, addresses] of byTitle) {
        if (addresses.length > 1) report.error(addresses.join(", "), `share the title "${title}"; every page needs its own`);
    }

    // The build only warns about noindex, because a preview has it on purpose. On the live site it keeps pages out of
    // search results, and noindex on every page is a preview setting that was not switched off on launch day.
    if (hidden.length > 1 && hidden.length === shown) {
        const sources = [...new Set(hidden.map((page) => page.source))].join(" and ");
        report.error("every page", `has noindex (${sources}), so search engines will not show this site`);
    } else {
        for (const { address, source } of hidden) {
            report.error(address, `has noindex (${source}), so search engines leave it out, although the sitemap lists it`);
        }
    }

    // People type and share addresses with and without the slash. A host may show the page or redirect to it, but a
    // rewrite rule can make one of the two forms show an empty page or the home page instead.
    const otherForms = pages.flatMap((page) => {
        const other = otherForm(new URL(page).pathname);
        return other ? [{ page: new URL(page).pathname, other }] : [];
    });
    await forEachLimited(otherForms, PARALLEL_REQUESTS, ({ page, other }) =>
        attempt(other, async () => {
            const answer = await get(other);
            const pageUrl = new URL(page, config.site).href;
            if (answer.status === 301 || answer.status === 308) {
                if (answer.location !== pageUrl) report.error(other, `redirects to ${answer.location}, expected ${page}`);
            } else if (answer.status === 404) {
                report.warning(other, "answers 404; people who type it this way land on the error page");
            } else if (answer.status !== 200) {
                report.error(other, `answers ${describe(answer)}; it should show ${page} or redirect there`);
            } else {
                const canonical = linksWithRel(readDocument(answer.text), "canonical")[0]?.attributes.get("href");
                if (!answer.text.trim()) report.error(other, `answers 200 with an empty page; it should show ${page} or redirect there`);
                else if (canonical && URL.parse(canonical)?.href !== pageUrl) {
                    report.error(other, `shows the page of ${canonical}, instead of ${page}`);
                }
            }
        }),
    );

    const unknown = `/site-check-${Date.now().toString(36)}`;
    await attempt(unknown, async () => {
        const answer = await get(unknown);
        if (answer.status !== 404) {
            report.error(
                "an unknown address",
                `answers ${describe(answer)} instead of 404: the host shows a page for addresses that do not exist (a catch-all rewrite?), and search engines index that page under every wrong link`,
            );
        }
    });

    for (const address of config.gone) {
        await attempt(address, async () => {
            const answer = await get(address);
            if (answer.status !== 404 && answer.status !== 410) report.error(address, `answers ${describe(answer)}, expected 404 or 410`);
        });
    }

    for (const { from, to } of config.redirects) {
        await attempt(from, async () => {
            const answer = await get(from);
            const expected = new URL(to, config.site);
            if (answer.status !== 301 && answer.status !== 308) {
                report.error(from, `answers ${describe(answer)}, expected a permanent redirect (301) to ${to}`);
            } else if (answer.location !== expected.href) {
                report.error(from, `redirects to ${answer.location}, expected ${expected.href}`);
            } else if (expected.hash) {
                const target = await get(expected.pathname);
                const id = decodeURIComponent(expected.hash.slice(1));
                if (target.status !== 200 || !readDocument(target.text).ids.has(id)) {
                    report.error(from, `redirects to ${to}, but ${expected.pathname} has no id "${id}"`);
                }
            }
        });
    }

    for (const variant of hostVariants(config.site)) {
        await attempt(
            variant,
            async () => {
                const answer = await get(variant);
                const lands = answer.location ? new URL(answer.location).origin : null;
                if ((answer.status !== 301 && answer.status !== 308) || lands !== config.site) {
                    report.error(variant, `answers ${describe(answer)}, expected a permanent redirect (301) to ${config.site}`);
                }
            },
            // Many sites never set up www, and a missing name is a choice rather than a fault.
            "warning",
        );
    }

    return { report, pageCount: pages.length };

    /**
     * The page addresses in the sitemaps, following a sitemap index.
     * @param {string[]} queue
     */
    async function listedPages(queue) {
        /** @type {string[]} */
        const found = [];
        while (queue.length > 0) {
            const address = /** @type {string} */ (queue.shift());
            await attempt(pathOf(address), async () => {
                const answer = await get(address);
                if (answer.status !== 200) {
                    report.error(pathOf(address), `answers ${describe(answer)}, expected the sitemap`);
                    return;
                }
                const sitemap = readSitemap(answer.text);
                for (const location of sitemap.locations) {
                    const url = URL.parse(location);
                    if (!url || url.origin !== config.site) report.error(pathOf(address), `lists ${location}, which is not on ${config.site}`);
                    else if (sitemap.isIndex) queue.push(url.href);
                    else found.push(url.href);
                }
            });
        }
        if (found.length === 0) report.error("sitemap", "lists no pages, so nothing else could be checked");
        return found;
    }

    /** @param {string} address */
    function pathOf(address) {
        const url = new URL(address, config.site);
        return url.origin === config.site ? url.pathname : url.href;
    }
}

/**
 * The same page address with the slash at the end added or taken away; none for the home page or a file.
 * @param {string} pathname
 */
export function otherForm(pathname) {
    if (pathname === "/" || /\.[a-z0-9]+$/i.test(pathname)) return undefined;
    return pathname.endsWith("/") ? pathname.slice(0, -1) : `${pathname}/`;
}

/**
 * Where a page tells search engines to leave it out, if it does. A host adds the header in its dashboard, outside the
 * build, so the message says which of the two to look at.
 * @param {Document} document
 * @param {Answer} answer
 */
function noindexSource(document, answer) {
    if (answer.robotsTag.toLowerCase().includes("noindex")) return "in the X-Robots-Tag header";
    if (isNoindex(document)) return "in a robots meta tag";
    return undefined;
}

/** @param {Answer} answer */
function describe(answer) {
    return answer.location ? `${answer.status} to ${answer.location}` : String(answer.status);
}

/**
 * The other ways people type the address, which should all lead to the site: without https, and with or without www.
 * @param {string} site
 */
export function hostVariants(site) {
    const url = new URL(site);
    const otherHost = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
    const variants = [`https://${otherHost}/`];
    if (url.protocol === "https:") variants.unshift(`http://${url.hostname}/`);
    return variants;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<unknown>} work
 */
async function forEachLimited(items, limit, work) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    });
    await Promise.all(workers);
}

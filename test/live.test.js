// @ts-check
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseConfig } from "../src/config.js";
import { checkLive, hostVariants, otherForm } from "../src/live.js";

const SITE = "https://example.nl";

/**
 * @typedef {{ status?: number, location?: string, type?: string, robotsTag?: string, body?: string }} Route
 */

/**
 * A host that answers from a table; every other address gets 404, as a well-set-up static host does.
 * @param {Record<string, Route | Error>} routes Full address to answer.
 * @param {(url: string) => Route | undefined} [fallback] What the host does with an address outside the table.
 * @returns {typeof fetch}
 */
function host(routes, fallback = () => undefined) {
    return async (input) => {
        const url = String(input);
        const route = routes[url] ?? fallback(url) ?? { status: 404, body: "Niet gevonden" };
        if (route instanceof Error) throw new TypeError("fetch failed", { cause: route });
        const headers = new Headers({ "content-type": route.type ?? "text/html; charset=utf-8" });
        if (route.location) headers.set("location", route.location);
        if (route.robotsTag) headers.set("x-robots-tag", route.robotsTag);
        return new Response(route.body ?? "", { status: route.status ?? 200, headers });
    };
}

/** @param {string} address */
function pageAt(address) {
    return { body: `<html lang="nl"><head><title>Pagina ${address}</title><link rel="canonical" href="${SITE}${address}"></head><body><h1 id="contact">Hoi</h1></body></html>` };
}

/**
 * A host without problems.
 * @type {Record<string, Route>}
 */
const goodRoutes = {
    [`${SITE}/`]: pageAt("/"),
    [`${SITE}/over`]: pageAt("/over"),
    // Hosts serve a folder's page with and without the slash; the canonical link says which address counts.
    [`${SITE}/over/`]: pageAt("/over"),
    [`${SITE}/robots.txt`]: { type: "text/plain", body: `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n` },
    [`${SITE}/sitemap.xml`]: { type: "application/xml", body: `<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/over</loc></url></urlset>` },
    [`${SITE}/contact`]: { status: 301, location: "/#contact" },
    "http://example.nl/": { status: 301, location: `${SITE}/` },
    "https://www.example.nl/": { status: 301, location: `${SITE}/` },
};

const config = parseConfig({ site: SITE, redirects: [{ from: "/contact", to: "/#contact" }], gone: ["/oud"] });

/** @param {import("../src/report.js").Report} report */
function lines(report) {
    return report.problems.map((problem) => `${problem.level} ${problem.where} ${problem.message}`);
}

test("a host that answers every address correctly passes", async () => {
    const { report, pageCount } = await checkLive(config, { fetch: host(goodRoutes) });
    assert.deepEqual(lines(report), []);
    assert.equal(pageCount, 2);
});

describe("finds", () => {
    test("a catch-all rewrite that shows the home page for any address", async () => {
        const { report } = await checkLive(config, { fetch: host(goodRoutes, () => pageAt("/")) });
        assert.match(lines(report).join("\n"), /error an unknown address answers 200 instead of 404/);
        assert.match(lines(report).join("\n"), /error \/oud answers 200, expected 404 or 410/);
    });

    test("a redirect that is temporary or goes elsewhere", async () => {
        const temporary = await checkLive(config, { fetch: host({ ...goodRoutes, [`${SITE}/contact`]: { status: 302, location: "/#contact" } }) });
        assert.match(lines(temporary.report).join("\n"), /error \/contact answers 302 to https:\/\/example\.nl\/#contact, expected a permanent redirect/);

        const elsewhere = await checkLive(config, { fetch: host({ ...goodRoutes, [`${SITE}/contact`]: { status: 301, location: "/" } }) });
        assert.match(lines(elsewhere.report).join("\n"), /error \/contact redirects to https:\/\/example\.nl\/, expected https:\/\/example\.nl\/#contact/);
    });

    test("a redirect to a part of the page that is gone", async () => {
        const routes = { ...goodRoutes, [`${SITE}/`]: { body: pageAt("/").body.replace('id="contact"', "") } };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.match(lines(report).join("\n"), /error \/contact redirects to \/#contact, but \/ has no id "contact"/);
    });

    test("a sitemap address that redirects, or whose canonical differs", async () => {
        const routes = {
            ...goodRoutes,
            [`${SITE}/over`]: { status: 301, location: `${SITE}/over/` },
            [`${SITE}/`]: { body: pageAt("/").body.replace(`href="${SITE}/"`, `href="${SITE}/home"`) },
        };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.match(lines(report).join("\n"), /error \/over answers 301 to https:\/\/example\.nl\/over\/; the sitemap should only list addresses that answer 200/);
        assert.match(lines(report).join("\n"), /error \/ has canonical https:\/\/example\.nl\/home, while the sitemap lists https:\/\/example\.nl\//);
    });

    test("a site that still has noindex on every page, as a preview has", async () => {
        const noindex = (/** @type {string} */ address) => ({
            body: pageAt(address).body.replace("</head>", '<meta name="robots" content="noindex, follow"></head>'),
        });
        const routes = { ...goodRoutes, [`${SITE}/`]: noindex("/"), [`${SITE}/over`]: noindex("/over") };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.deepEqual(lines(report), [
            "error every page has noindex (in a robots meta tag), so search engines will not show this site",
        ]);
    });

    test("a page the host sends with noindex in the X-Robots-Tag header", async () => {
        const routes = { ...goodRoutes, [`${SITE}/over`]: { ...pageAt("/over"), robotsTag: "noindex" } };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.deepEqual(lines(report), [
            "error /over has noindex (in the X-Robots-Tag header), so search engines leave it out, although the sitemap lists it",
        ]);
    });

    test("a robots.txt the host sends as a web page", async () => {
        const routes = { ...goodRoutes, [`${SITE}/robots.txt`]: pageAt("/") };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.match(lines(report).join("\n"), /error \/robots\.txt is sent as text\/html/);
    });

    test("an address without www or https that does not lead to the site", async () => {
        const routes = { ...goodRoutes, "http://example.nl/": pageAt("/") };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.match(lines(report).join("\n"), /error http:\/\/example\.nl\/ answers 200, expected a permanent redirect \(301\) to https:\/\/example\.nl/);
    });
});

describe("the other form of a page address, with or without the slash", () => {
    test("may redirect to the page", async () => {
        const routes = { ...goodRoutes, [`${SITE}/over/`]: { status: 301, location: `${SITE}/over` } };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.deepEqual(lines(report), []);
    });

    test("may not show an empty page, as a broken rewrite on Render did", async () => {
        const routes = { ...goodRoutes, [`${SITE}/over/`]: { body: "" } };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.deepEqual(lines(report), ["error /over/ answers 200 with an empty page; it should show /over or redirect there"]);
    });

    test("may not show another page", async () => {
        const routes = { ...goodRoutes, [`${SITE}/over/`]: pageAt("/") };
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.deepEqual(lines(report), ["error /over/ shows the page of https://example.nl/, instead of /over"]);
    });

    test("gets a warning when it is not found", async () => {
        const routes = { ...goodRoutes };
        delete routes[`${SITE}/over/`];
        const { report } = await checkLive(config, { fetch: host(routes) });
        assert.deepEqual(lines(report), ["warning /over/ answers 404; people who type it this way land on the error page"]);
    });
});

test("a www address that does not exist is only a warning", async () => {
    const routes = { ...goodRoutes, "https://www.example.nl/": new Error("getaddrinfo ENOTFOUND www.example.nl") };
    const { report } = await checkLive(config, { fetch: host(routes) });
    assert.deepEqual(lines(report), ["warning https://www.example.nl/ could not be reached: getaddrinfo ENOTFOUND www.example.nl"]);
});

test("stops at once when the site cannot be reached", async () => {
    const { report } = await checkLive(config, { fetch: host({ [`${SITE}/`]: new Error("certificate has expired") }) });
    assert.deepEqual(lines(report), ["error / could not be reached: certificate has expired"]);
});

test("tries a page address with and without the slash, but not the home page or a file", () => {
    assert.equal(otherForm("/over"), "/over/");
    assert.equal(otherForm("/werk/oud/"), "/werk/oud");
    assert.equal(otherForm("/"), undefined);
    assert.equal(otherForm("/voorwaarden.pdf"), undefined);
});

test("tries the address with and without www, and without https", () => {
    assert.deepEqual(hostVariants("https://mikapp.nl"), ["http://mikapp.nl/", "https://www.mikapp.nl/"]);
    assert.deepEqual(hostVariants("https://www.atelierschmitz.nl"), ["http://www.atelierschmitz.nl/", "https://atelierschmitz.nl/"]);
});

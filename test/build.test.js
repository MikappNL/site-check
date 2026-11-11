// @ts-check
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { pageAddress } from "../src/build.js";
import { checkFiles, goodSite, page, removeFolders, sitemap, SITE } from "./support/site.js";

after(removeFolders);

/**
 * Every problem as one line, so a test can look for the one it expects.
 * @param {import("../src/report.js").Report} report
 */
function lines(report) {
    return report.problems.map((problem) => `${problem.level} ${problem.where} ${problem.message}`);
}

/**
 * @param {import("../src/report.js").Report} report
 * @param {RegExp} expected
 */
function assertProblem(report, expected) {
    assert.ok(
        lines(report).some((line) => expected.test(line)),
        `expected a problem matching ${expected}, got:\n${lines(report).join("\n") || "(none)"}`,
    );
}

test("a site that follows every rule passes", async () => {
    const { report, pageCount } = await checkFiles(goodSite());
    assert.deepEqual(lines(report), []);
    assert.equal(pageCount, 3);
});

describe("page addresses", () => {
    test("follow the host's way of serving folders", () => {
        assert.equal(pageAddress("index.html", false), "/");
        assert.equal(pageAddress("werk/index.html", false), "/werk");
        assert.equal(pageAddress("werk/index.html", true), "/werk/");
        assert.equal(pageAddress("404.html", true), "/404");
    });

    test("with trailing slashes, canonical links and the sitemap must use them", async () => {
        const files = goodSite({
            "index.html": page({ address: "/", body: '<h1>Welkom</h1><a href="/over/">Over ons</a>' }),
            "over/index.html": page({ address: "/over/", body: "<h1>Over ons</h1>" }),
            "sitemap.xml": sitemap(["/", "/over/"]),
        });
        assert.deepEqual(lines((await checkFiles(files, { trailingSlash: true })).report), []);
    });
});

describe("every page", () => {
    test("needs one <h1>, also when another sits in a script or template", async () => {
        const { report } = await checkFiles(
            goodSite({ "over/index.html": page({ address: "/over", body: '<script>"<h1>"</script><template><h1>Later</h1></template>' }) }),
        );
        assertProblem(report, /error \/over needs exactly one <h1>, has 0/);
    });

    test("needs a language, a title and a description", async () => {
        const html = page({ address: "/over" }).replace(' lang="nl"', "").replace(/<title>.*<\/title>/, "").replace(/<meta name="description"[^>]*>/, "");
        const { report } = await checkFiles(goodSite({ "over/index.html": html }));
        assertProblem(report, /error \/over has no <html lang/);
        assertProblem(report, /error \/over needs exactly one <title>, has 0/);
        assertProblem(report, /error \/over has no meta description/);
    });

    test("does not count an SVG title as the page title", async () => {
        const { report } = await checkFiles(
            goodSite({ "over/index.html": page({ address: "/over", body: "<h1>Over ons</h1><svg><title>Logo</title></svg>" }) }),
        );
        assert.deepEqual(lines(report), []);
    });

    test("gets a warning for a title Google cuts off", async () => {
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", title: "x".repeat(61) }) }));
        assertProblem(report, /warning \/over has a title of 61 characters/);
        assert.equal(report.errorCount, 0);
    });

    test("needs its own title", async () => {
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", title: "Pagina /" }) }));
        assertProblem(report, /error \/, \/over share the title "Pagina \/"/);
    });

    test("needs structured data that is valid JSON", async () => {
        const head = '<script type="application/ld+json">{"@type": "Organization",}</script>';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", head }) }));
        assertProblem(report, /error \/over has structured data \(JSON-LD\) that is not valid JSON/);
    });

    test("may not have React's loading placeholders or localhost in it", async () => {
        const body = '<h1>Over ons</h1><!--$?--><template id="B:0"></template><a href="http://localhost:5173/">dev</a>';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", body }) }));
        assertProblem(report, /error \/over still has React's loading placeholders/);
        assertProblem(report, /error \/over mentions localhost/);
    });

    test("may use an id only once", async () => {
        const body = '<h1 id="kop">Over ons</h1><p id="kop">Tekst</p>';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", body }) }));
        assertProblem(report, /error \/over has the id "kop" more than once/);
    });
});

describe("pages search engines may show", () => {
    test("need a canonical link to themselves", async () => {
        const html = page({ address: "/over" }).replace(`${SITE}/over`, `${SITE}/elders`);
        const { report } = await checkFiles(goodSite({ "over/index.html": html }));
        assertProblem(report, /error \/over has canonical https:\/\/example\.nl\/elders, expected https:\/\/example\.nl\/over/);
    });

    test("need a share image that exists", async () => {
        const html = page({ address: "/over" }).replace(`${SITE}/og.png`, `${SITE}/weg.png`);
        const { report } = await checkFiles(goodSite({ "over/index.html": html }));
        assertProblem(report, /error \/over has share image https:\/\/example\.nl\/weg\.png, which is not in the build/);
    });

    test("must all be in the sitemap, and the sitemap lists nothing else", async () => {
        const { report } = await checkFiles(goodSite({ "sitemap.xml": sitemap(["/", "/oud", "/404"]) }));
        assertProblem(report, /error \/over is missing from the sitemap/);
        assertProblem(report, /error sitemap\.xml lists https:\/\/example\.nl\/oud, which is not a page/);
        assertProblem(report, /error sitemap\.xml lists https:\/\/example\.nl\/404, which has noindex/);
    });

    test("can sit in a sitemap index, as Astro writes it", async () => {
        const index = `<sitemapindex><sitemap><loc>${SITE}/sitemap-0.xml</loc></sitemap></sitemapindex>`;
        const files = goodSite({
            "robots.txt": `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap-index.xml\n`,
            "sitemap-index.xml": index,
            "sitemap-0.xml": sitemap(["/", "/over"]),
        });
        delete files["sitemap.xml"];
        assert.deepEqual(lines((await checkFiles(files)).report), []);
    });
});

describe("language links", () => {
    const nl = '<link rel="alternate" hreflang="nl" href="https://example.nl/over"><link rel="alternate" hreflang="en" href="https://example.nl/en/about"><link rel="alternate" hreflang="x-default" href="https://example.nl/over">';

    test("pass when both languages name each other", async () => {
        const files = goodSite({
            "over/index.html": page({ address: "/over", head: nl }),
            "en/about/index.html": page({ address: "/en/about", lang: "en", head: nl }),
            "sitemap.xml": sitemap(["/", "/over", "/en/about"]),
        });
        assert.deepEqual(lines((await checkFiles(files)).report), []);
    });

    test("must be returned by the other language", async () => {
        const files = goodSite({
            "over/index.html": page({ address: "/over", head: nl }),
            "en/about/index.html": page({ address: "/en/about", lang: "en" }),
            "sitemap.xml": sitemap(["/", "/over", "/en/about"]),
        });
        assertProblem((await checkFiles(files)).report, /error \/over has language links that \/en\/about does not return/);
    });

    test("must name the page itself, in its own language, and x-default", async () => {
        const head = '<link rel="alternate" hreflang="en" href="https://example.nl/over">';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", head }) }));
        assertProblem(report, /error \/over has <html lang="nl"> but calls itself "en"/);
        assertProblem(report, /error \/over has language links \(hreflang\) without x-default/);
    });
});

describe("links", () => {
    test("must lead to a page or file in the build", async () => {
        const body = '<h1>Over ons</h1><a href="/werk">Werk</a><a href="prijzen.pdf">Prijzen</a><a href="https://elders.nl/">Elders</a><a href="mailto:hallo@example.nl">Mail</a>';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", body }) }));
        assertProblem(report, /error \/over links to \/werk, which does not exist/);
        assertProblem(report, /error \/over links to prijzen\.pdf, which does not exist/);
        assert.equal(report.problems.length, 2);
    });

    test("must point to an id that exists", async () => {
        const body = '<h1>Welkom</h1><a href="/over#team">Team</a><a href="/over#prijzen">Prijzen</a><a href="#top">Naar boven</a>';
        const { report } = await checkFiles(goodSite({ "index.html": page({ address: "/", body }) }));
        assertProblem(report, /error \/ links to \/over#prijzen, but \/over has no id "prijzen"/);
        assert.equal(report.problems.length, 1);
    });

    test("get a warning when the host has to add or remove a slash first", async () => {
        const body = '<h1>Welkom</h1><a href="/over/">Over ons</a>';
        const { report } = await checkFiles(goodSite({ "index.html": page({ address: "/", body }) }));
        assertProblem(report, /warning \/ links to \/over\/; the page is \/over/);
    });

    test("that open a new tab need rel=noopener", async () => {
        const body = '<h1>Welkom</h1><a href="https://elders.nl/" target="_blank">Elders</a><a href="https://ander.nl/" target="_blank" rel="noopener noreferrer">Ander</a>';
        const { report } = await checkFiles(goodSite({ "index.html": page({ address: "/", body }) }));
        assertProblem(report, /error \/ opens https:\/\/elders\.nl\/ in a new tab without rel="noopener"/);
        assert.equal(report.problems.length, 1);
    });
});

describe("images and files", () => {
    test("images need alt text, which may be empty for decoration", async () => {
        const body = '<h1>Over ons</h1><img src="/og.png"><img src="/og.png" alt="">';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", body }) }));
        assertProblem(report, /error \/over has an image without alt text: \/og\.png/);
        assert.equal(report.problems.length, 1);
    });

    test("everything the page loads must be in the build", async () => {
        const head = '<link rel="stylesheet" href="/assets/stijl.css"><script type="module" src="/assets/app.js"></script>';
        const body = '<h1>Over ons</h1><img alt="" srcset="/og.png 1x, /foto@2x.png 2x">';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", head, body }) }));
        assertProblem(report, /error \/over loads \/assets\/stijl\.css, which is not in the build/);
        assertProblem(report, /error \/over loads \/assets\/app\.js, which is not in the build/);
        assertProblem(report, /error \/over loads \/foto@2x\.png, which is not in the build/);
        assert.equal(report.problems.length, 3);
    });

    test("nothing loads from another site before the visitor agrees", async () => {
        const head = '<link rel="preconnect" href="https://fonts.gstatic.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">';
        const body = '<h1>Over ons</h1><script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>';
        const { report } = await checkFiles(goodSite({ "over/index.html": page({ address: "/over", head, body }) }));
        assertProblem(report, /error \/over loads something from https:\/\/fonts\.gstatic\.com before the visitor has agreed/);
        assertProblem(report, /error \/over loads something from https:\/\/fonts\.googleapis\.com/);
        assertProblem(report, /error \/over loads something from https:\/\/www\.googletagmanager\.com/);
    });

    test("the icons a web manifest names must exist", async () => {
        const head = '<link rel="manifest" href="/site.webmanifest">';
        const manifest = JSON.stringify({ icons: [{ src: "/og.png" }, { src: "icon-512.png" }] });
        const { report } = await checkFiles(goodSite({ "index.html": page({ address: "/", head }), "site.webmanifest": manifest }));
        assertProblem(report, /error site\.webmanifest names the icon icon-512\.png, which is not in the build/);
        assert.equal(report.problems.length, 1);
    });
});

describe("the site as a whole", () => {
    test("needs a 404 page, robots.txt and a sitemap", async () => {
        const files = goodSite();
        delete files["404.html"];
        delete files["robots.txt"];
        delete files["sitemap.xml"];
        const { report } = await checkFiles(files);
        assertProblem(report, /error 404\.html is missing/);
        assertProblem(report, /error robots\.txt is missing/);
        assertProblem(report, /error sitemap\.xml is missing/);
    });

    test("gets a warning when robots.txt shuts out every search engine", async () => {
        const { report } = await checkFiles(goodSite({ "robots.txt": `User-agent: *\nDisallow: /\nSitemap: ${SITE}/sitemap.xml\n` }));
        assertProblem(report, /warning robots\.txt tells every search engine to stay away/);
    });

    test("with noindex on every page is a preview: one warning, and the pages are still checked", async () => {
        const noindex = '<meta name="robots" content="noindex, follow">';
        const { report } = await checkFiles(
            goodSite({
                "index.html": page({ address: "/", head: noindex, body: '<h1>Welkom</h1><a href="/over">Over ons</a>' }),
                "over/index.html": page({ address: "/over", head: noindex, body: "<h1>Over ons</h1>" }),
                "sitemap.xml": sitemap(["/"]),
            }),
        );
        assertProblem(report, /warning every page has noindex/);
        assertProblem(report, /error \/over is missing from the sitemap/);
        assert.equal(report.problems.length, 2);
    });

    test("leaves out the HTML files the config ignores", async () => {
        const files = goodSite({ "__forms.html": "<form></form>" });
        assert.deepEqual(lines((await checkFiles(files, { ignore: ["/__"] })).report), []);
    });
});

// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { blocksEverything, sitemapsIn } from "../src/robots.js";
import { readSitemap } from "../src/sitemap.js";

test("finds the sitemaps robots.txt names", () => {
    assert.deepEqual(sitemapsIn("User-agent: *\nAllow: /\n\nSitemap: https://mikapp.nl/sitemap.xml\n"), ["https://mikapp.nl/sitemap.xml"]);
});

test("sees when every crawler is shut out", () => {
    assert.equal(blocksEverything("User-agent: *\nDisallow: /\n"), true);
    assert.equal(blocksEverything("User-agent: GPTBot\nUser-agent: *\nDisallow: /\n"), true);
});

test("does not mind a partial or bot-specific block", () => {
    assert.equal(blocksEverything("User-agent: *\nDisallow: /__\n"), false);
    assert.equal(blocksEverything("User-agent: *\nAllow: /\n\nUser-agent: BadBot\nDisallow: /\n"), false);
    assert.equal(blocksEverything("# Disallow: /\nUser-agent: *\nAllow: /\n"), false);
});

test("reads a sitemap and a sitemap index", () => {
    assert.deepEqual(readSitemap("<urlset><url><loc>https://mikapp.nl/?a=1&amp;b=2</loc></url></urlset>"), {
        isIndex: false,
        locations: ["https://mikapp.nl/?a=1&b=2"],
    });
    assert.equal(readSitemap("<sitemapindex><sitemap><loc>https://x.nl/sitemap-0.xml</loc></sitemap></sitemapindex>").isIndex, true);
});

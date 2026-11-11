// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";

test("needs only the site; the rest has defaults", () => {
    assert.deepEqual(parseConfig({ site: "https://mikapp.nl/" }), {
        site: "https://mikapp.nl",
        dist: "dist",
        trailingSlash: false,
        ignore: [],
        redirects: [],
        gone: [],
    });
});

test("refuses a site address with a path", () => {
    assert.throws(() => parseConfig({ site: "https://mikapp.nl/werk" }), /just the address of the home page/);
});

test("refuses a setting it does not know, so a typo does not go unnoticed", () => {
    assert.throws(() => parseConfig({ site: "https://mikapp.nl", trailingSlashes: true }), /"trailingSlashes" is not a setting/);
});

test("refuses redirects without a from and a to", () => {
    assert.throws(() => parseConfig({ site: "https://mikapp.nl", redirects: [{ from: "/contact" }] }), /redirects must be a list/);
});

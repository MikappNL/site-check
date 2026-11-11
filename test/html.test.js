// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, isNoindex, metaContent, readDocument } from "../src/html.js";

test("reads attributes in any order and with any kind of quotes", () => {
    const document = readDocument(`<html lang=nl><head>
<meta content='Tekst met "aanhalingstekens"' name="description">
<meta property=og:image content="https://example.nl/og.png">
</head><body><h1>Kop</h1></body></html>`);
    assert.equal(document.lang, "nl");
    assert.equal(metaContent(document, "description"), 'Tekst met "aanhalingstekens"');
    assert.equal(metaContent(document, "og:image"), "https://example.nl/og.png");
});

test("leaves scripts, styles, templates and comments out of the body", () => {
    const document = readDocument(`<html><head><title>Titel</title></head><body>
<h1 id="kop">Kop</h1>
<script>const markup = '<h1 id="kop">';</script>
<style>h1::after { content: "<h1>"; }</style>
<template><h1 id="later">Later</h1></template>
<!-- <h1>Oud</h1> -->
</body></html>`);
    assert.deepEqual(
        document.bodyTags.map((tag) => tag.name),
        ["body", "h1"],
    );
    assert.deepEqual(document.duplicateIds, []);
});

test("takes titles from the head only, so an SVG title does not count", () => {
    const document = readDocument("<html><head><title>Over &amp; uit</title></head><body><svg><title>Logo</title></svg></body></html>");
    assert.deepEqual(document.titles, ["Over & uit"]);
});

test("finds duplicate ids", () => {
    const document = readDocument('<html><head></head><body><p id="a"></p><p id="b"></p><p id="a"></p></body></html>');
    assert.deepEqual(document.duplicateIds, ["a"]);
});

test("knows a noindex page by its robots meta", () => {
    assert.equal(isNoindex(readDocument('<html><head><meta name="robots" content="noindex, follow"></head></html>')), true);
    assert.equal(isNoindex(readDocument('<html><head><meta name="robots" content="index, follow"></head></html>')), false);
});

test("decodes the entities a build writes", () => {
    assert.equal(decodeEntities("caf&#233; &#x2013; &lt;b&gt; &quot;ja&quot; &amp;nbsp;"), 'café – <b> "ja" &nbsp;');
});

// @ts-check
import { decodeEntities } from "./html.js";

/**
 * Reads a sitemap. A sitemap index lists other sitemaps (Astro writes one), a plain sitemap lists pages.
 * @param {string} xml
 * @returns {{ isIndex: boolean, locations: string[] }}
 */
export function readSitemap(xml) {
    return {
        isIndex: /<sitemapindex[\s>]/.test(xml),
        locations: [...xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/g)].map(([, location]) => decodeEntities(location)),
    };
}

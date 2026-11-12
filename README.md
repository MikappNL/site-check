# site-check

One delivery check for every Mikapp site. It reads what a visitor and a search engine get, not how the site was
built, so it works the same for Vite, React Router and Astro sites.

- `site-check build` checks the built site before it goes online. Run it after every build; it fails the build when a
  page is not fit to go online.
- `site-check live` checks what the host really answers. Run it when the site goes online and after every change in the
  host's dashboard (redirects, rewrites, domains): a build can be right while the host is wrong.

It has no runtime dependencies and needs Node 22.12 or newer.

## Add it to a site

```bash
npm install --save-dev github:MikappNL/site-check#v0.3.0
```

Put a `site-check.config.json` next to `package.json`:

```json
{
  "site": "https://mikapp.nl",
  "dist": "dist",
  "trailingSlash": false,
  "redirects": [{ "from": "/contact", "to": "/#contact" }],
  "gone": ["/persona/dirk-prins"]
}
```

| Setting | Meaning |
|---|---|
| `site` | The address the site goes online at. Required. |
| `dist` | The folder the build writes (default `dist`; React Router writes `build/client`). |
| `trailingSlash` | `true` when page addresses end in a slash (`/werk/`), as on Netlify and Astro sites. Default `false`. |
| `ignore` | Address prefixes of HTML files that are not pages, such as Netlify's form helper (`["/__"]`). |
| `redirects` | Old addresses the host must send on with a permanent redirect. Keep it the same as the host's dashboard. |
| `gone` | Old addresses that must answer 404 or 410. |

Then run it from `package.json`:

```json
{
  "scripts": {
    "build": "vite build && site-check build",
    "check:live": "site-check live"
  }
}
```

`site-check live https://example.nl` checks any site, also without a config file.

## What it checks

An **error** fails the command (exit code 1). A **warning** is worth a look but lets the build through.

### The build

Every page:

- has `<html lang>`, one `<title>`, a meta description and one `<h1>`, in the HTML itself. A title over 60 characters
  or a description over 155 is a warning: Google cuts it off.
- has valid JSON-LD, ids that occur once, no React loading placeholders and no `localhost`.
- links only to pages and files that exist, and to ids that exist (`/werk#prijzen`). A link that needs a redirect first
  (`/werk/` on a site without trailing slashes) is a warning.
- opens new tabs with `rel="noopener"`, gives every `<img>` an `alt` (empty is fine for decoration), and loads only
  files that are in the build.
- loads nothing from another site before the visitor agrees: no Google Fonts, Analytics tag or map in the HTML.

Pages search engines may show also have one canonical link to themselves, an `og:url` that agrees, and a share image
(`og:image`) with a full address that exists. Language links (`hreflang`) name the page itself and `x-default`, and the
other language returns the same set.

The site as a whole has a `404.html`, a `robots.txt` with a `Sitemap` line, and a sitemap that lists exactly the pages
search engines may show (a sitemap index is followed). Every page title is unique, and a web manifest names icons that
exist.

A site with `noindex` on every page is a preview: that is one warning, and the pages with a canonical link are checked
as the pages they will be.

### The live site

- The home page answers 200, and `robots.txt` answers 200 as text.
- Every page in the sitemap answers 200 without a redirect, with a canonical link to exactly that address and a title
  of its own.
- No page in the sitemap has noindex, in a robots meta tag or an X-Robots-Tag header. The build only warns about it,
  because a preview has it on purpose; on the live site it keeps the pages out of Google, so a preview setting that was
  left on at launch is an error here.
- The same address with the slash added or taken away (`/over/` for `/over`) shows that page or redirects to it. A 404
  there is a warning. A rewrite rule on Atelier Schmitz showed an empty page there until November 2026.
- An address that does not exist answers 404. A catch-all rewrite to `/index.html` answers 200 and shows the home page
  for every wrong link, which cost mikapp.nl its pages in Google until November 2026.
- Every `redirects` entry answers 301 or 308 to its target, and an id in the target (`/#contact`) exists. Every `gone`
  address answers 404 or 410.
- The address without https, and with or without www, sends people on to `site`. A name that does not exist is a
  warning.

## What no check can see

[`HANDOVER.md`](HANDOVER.md) lists what to do and look at by hand before and after a site goes online: the domain,
the old site's addresses, the forms, Search Console and the client's access.

## What stays in each site

Checks that only make sense for one site stay in that site's repo, next to `site-check build`: the language rule for
links on mikapp.nl, the form and the JavaScript budget on Microtreat, the claims, the house watch and the legal details
on Atelier Schmitz.

## Develop

```bash
npm test           # node:test
npm run typecheck  # tsc over the JSDoc types
```

The code is plain JavaScript with JSDoc types, checked by TypeScript. Node does not strip TypeScript types inside
`node_modules`, and that is where a site installs this package.

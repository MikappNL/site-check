# site-check: repository guide

## What this is

The one delivery check for every Mikapp site (mikapp.nl, client sites, Atelier Schmitz): `site-check build` reads the
built HTML, `site-check live` asks the real host. Each site installs it as a dev dependency from GitHub and pins a tag.
`README.md` lists every check; keep it in step with the code.

Mikapp is the one-person web studio of Mika Schmitz, built next to a full-time job. Keep every change small, finished
and easy to review.

## Rules

- **No runtime dependencies.** Every site installs this package, so it stays plain Node. TypeScript and `@types/node`
  are the only dev dependencies; ask Mika before adding any.
- **Plain JavaScript with JSDoc types**, checked by `tsc` (`// @ts-check` on top of every file). Node will not strip
  TypeScript types inside `node_modules`, where the sites install this.
- **Only checks that hold for every site.** A rule for one site stays in that site's repo. A check reads the output
  (HTML, robots.txt, sitemap, HTTP answers), never a framework's source or config.
- **An error means "not fit to go online"**, a warning means "worth a look". When a check is unsure, it is a warning.
- **Messages** are plain English sentences that follow the page address: `/werk` "needs exactly one <h1>, has 2". Say
  what is wrong and, where it helps, why it matters.
- **Tests first** with `node:test`: a new check gets a test with a small example site (`test/support/site.js`) or a fake
  host (`test/live.test.js`), and the example site in `goodSite()` keeps passing every check.
- **Releases**: a change that sites should get is a new tag (`v0.2.0`); sites update their pin on purpose.
- Code, comments, commits and docs in English; comments explain why. Pull request titles and descriptions in Dutch.
- Work on a short-lived branch and open a pull request. Never push to `main`.

## Commands

```bash
npm test                                   # all tests
npm run typecheck                          # tsc
node bin/site-check.js build --config <file>
node bin/site-check.js live https://mikapp.nl
```

In a cloud sandbox Node's `fetch` ignores the proxy unless you set `NODE_USE_ENV_PROXY=1` for `site-check live`.

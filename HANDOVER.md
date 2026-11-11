# Handover list

What `site-check` cannot see. Go through it for every site that goes online, and again when a site moves to a new
host or domain. Each line is something to do or to look at by hand; tick it in the pull request or the handover note.

## Before it goes online

- [ ] **The old site's addresses.** Take them from the old sitemap and from Search Console (Pages, and the top pages
  under Performance). Each one either gets a 301 to its new page (`redirects` in `site-check.config.json`, and the
  same rule in the host's dashboard) or answers 404 on purpose (`gone`).
- [ ] **The host's dashboard has no catch-all rewrite** (`/*` to `/index.html`). A prerendered site needs none, and one
  rule there cost mikapp.nl its pages in Google and gave Atelier Schmitz empty pages.
- [ ] **Nothing is waiting on the client:** `grep -rn "TODO(klant)" src` finds nothing that still shows, and the
  client has read and approved the texts.
- [ ] **The legal details** are on the site: name, address, KvK number and, where it applies, the VAT number
  (art. 3:15d BW), plus a privacy statement. A cookie question only when the site measures visitors.
- [ ] **Every way to get in touch works**, tried by hand: the form arrives where it should, the WhatsApp and phone
  links open the right number, the e-mail address is right.
- [ ] **On a phone (360px) and a desktop**, with the keyboard only (Tab through the page: focus stays visible), and
  with reduced motion switched on.
- [ ] **Lighthouse on mobile** once, for the home page and one content page.
- [ ] **The share preview:** paste the address in WhatsApp and check the image and title.

## After it goes online

- [ ] `npm run check:live` passes. Run it again after every change in the host's dashboard.
- [ ] **The domain:** the address with and without www, and with http, all end up on the site (`check:live` tries
  them). HTTPS works on every one.
- [ ] **Google Search Console:** add the domain (a DNS record), submit the sitemap and ask to index the home page. For
  a replaced site, check a week later that the old addresses drop out or point to their new page.
- [ ] **Google Business Profile:** the website link points to the new site.
- [ ] **Analytics**, if the site has it: in the browser's network tab, nothing goes to Google before the visitor says
  yes, and page views arrive after.
- [ ] **The client's access:** the domain and the hosting are in the client's name (unless Mikapp hosts a backend),
  and the client knows how to reach them. Passwords go through a password manager or a one-time link, never e-mail.
- [ ] **Ask about the portfolio and a review:** may the site appear on mikapp.nl, and would the client write a Google
  review once they are happy.

# gaosu2718.github.io

Personal academic homepage of Suyi (Stanley) Gao, served by GitHub Pages at
<https://gaosu2718.github.io/>.

Plain HTML and CSS with two small scripts: no build step, no framework, no external requests. The
look follows Pivot Cubes: the same paper-and-panel colours, the same six colour themes (Mint is the
default), and the same controls.

## Layout

```
index.html                    Home: profile, about, news, publications (short), demos, education, contact
research/index.html           Projects in detail, publications with abstracts and BibTeX, talks
teaching-service/index.html   Teaching, service and leadership
demos/index.html              One card per demo
demos/pivot-cubes/
  index.html                  The demo page: the game, playable in the page
  frame.css                   The site's own touches inside the game (phone layout, no scrollbar)
  play/                       The game itself, a copy of ~/cubes/game (sync.sh demo replaces it)
assets/
  css/style.css               All styling; colour tokens at the top
  js/site.js                  Display settings, header drop-down, abstract/BibTeX toggles and copy
  js/demo.js                  Demo pages: runs the game in a frame, sizes it, keeps its theme in step
  img/profile.jpg             Headshot
  fonts/name.woff             The font for 高苏熠 beside the photo (see below)
  fonts/name-font-LICENSE.txt Its license
  files/Suyi_Gao_CV.pdf       Public CV, built without the phone number
404.html                      Not-found page (GitHub Pages serves it for any missing path, so its links are /-absolute)
.nojekyll, robots.txt, sitemap.xml   Hosting details
```

## Page structure

Every page has the same **left bar**. It holds the profile, the page links, and the display settings
(theme: Auto, Light or Dark; colours), folded under a summary. It is a sticky side panel from 1000px
wide.

Below that width, a **top header** takes over. On tablets it shows the page links inline, and on
phones they sit behind a menu button, in a drop-down that also holds the display settings. The
profile then shows as a card on the home page only.

The bar and the header are repeated in each file. Only the `../` prefix of the links and the
`aria-current="page"` marker change. **A new page needs a link in every file, in all three lists:**
`.side-nav`, `.sh-nav` and `.pop-nav`. Add the page to `sitemap.xml` too.

The page background is plain. Earlier background options (Perlin terrain and a fractal pattern) are
archived outside this repository, in `~/homepage/archive/background/`, with notes on how to bring
them back.

## Common edits

- **News item:** add an `<li>` at the top of `<ul class="news">` in `index.html`.
- **Paper:** add it in two places.
  - In `research/index.html`, copy a `<li class="pub">` block in *Publications* and give its `id`s new
    suffixes (`pub-…`, `abs-…`, `bib-…`, `bibtex-…`). Put `<b class="me">Suyi Gao</b>` in the author list.
  - In `index.html`, add the short entry, without the abstract.
  - The `[n]` numbers are plain text, so renumber the papers if you insert one in the middle.
- **Project:** copy an `<article class="project">` in `research/index.html`, and add it to the
  "On this page" links at the top.
- **Teaching or service entry:** in `teaching-service/index.html`, add an `<li class="entry">` under its
  institution (`<div class="org">`), or copy a whole `org` block for a new place.
- **New demo:**
  1. Add a folder `demos/<name>/`, with the game in `play/` and an `index.html` copied from
     `demos/pivot-cubes/index.html`.
  2. Set the frame's `data-palettes` to the colour themes that game knows.
  3. Add a card for it in `demos/index.html`, and optionally one on the home page.
- **Profile link (Google Scholar, ORCID):** see the commented example under the buttons in the left
  bar.
- **Last updated:** in each page's footer, and `lastmod` in `sitemap.xml`.

## Colour themes

There are six themes: Mint (the default), Indigo, Ocean, Sunset, Grape and Slate. They are the same
six as in the game (`~/cubes/game/style.css` and `PALETTES` in `js/app.js`). Keep the two in step,
so that the theme picked on the site is also the one the game shows. A theme is one
`[data-palette]` block in `assets/css/style.css` plus one entry in `PALETTES` in `assets/js/site.js`.
The first entry is the default.

## The Chinese name

高苏熠 beside the photo is set in 寒蝉圆黑体 (Chill Round Gothic) Light. The font is cut down to
those three characters, so it looks the same on every device, and renamed as its license (SIL Open
Font License) asks of modified copies. To use another font or other characters, change `NAME_FONT`
or `NAME_ZH` in `~/homepage/sync.sh` and run `sync.sh font`. Also keep `unicode-range` in the
`@font-face` rule in `style.css` matching the characters.

## Generated files

The private sources live one level up, outside this repository, in `~/homepage/` (see the README
there). `sync.sh` regenerates the files here:

```bash
~/homepage/sync.sh        # all of the below
~/homepage/sync.sh cv     # assets/files/Suyi_Gao_CV.pdf from cv/Suyi_Gao_CV.tex, phone removed
~/homepage/sync.sh photo  # assets/img/profile.jpg from photo.jpg (square, metadata stripped)
~/homepage/sync.sh demo   # demos/pivot-cubes/play/ from ~/cubes/game
~/homepage/sync.sh font   # assets/fonts/name.woff from the font in ~/homepage/fonts/
```

## Preview locally

```bash
python3 -m http.server -d ~/homepage/site 8000   # then open http://localhost:8000/
```

Use the server rather than opening the files directly. Page links end in `/` (for example
`research/`), which only a web server turns into `research/index.html`. The game frame also needs
both pages on one origin to share the theme.

## Publish (first time)

```bash
cd ~/homepage/site
git init -b main
git add -A
git commit -m "Initial homepage"
gh repo create gaosu2718/gaosu2718.github.io --public --source=. --push
```

GitHub Pages publishes a repository named `<user>.github.io` from `main` automatically, usually within
a minute or two. If it doesn't, open *Settings → Pages* and set *Source: Deploy from a branch*,
*Branch: main / (root)*. After that, every `git push` updates the site.

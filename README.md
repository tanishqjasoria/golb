# my-blog

Personal blog + courses. Static [Astro](https://astro.build) site, zero client-side
JavaScript, terminal-on-ivory design.

## Commands

```bash
npm run dev       # dev server at localhost:4321
npm run build     # production build → dist/
npm run preview   # serve the production build locally
npm run check     # type-check .astro/.ts files
```

## Writing

**New post** — drop a markdown file in `src/content/posts/`:

```markdown
---
title: "my post title"
description: "One-line summary shown in listings and RSS."
date: 2026-07-06
draft: true        # remove (or set false) to publish
---

Content here. Code blocks get Shiki highlighting (lean, solidity, rust, ...).
```

The filename becomes the URL: `my-post.md` → `/posts/my-post/`.

**New course** — create `src/content/courses/<course-slug>/index.md` with
`title`, `description`, `status` (`in progress` | `complete`), and `started`
frontmatter. The body is the course landing page.

**New lesson** — add `src/content/courses/<course-slug>/lessons/<slug>.md` with
`title`, `description`, and `order` (controls sequence and prev/next links).

## Deploying (one-time setup)

1. Create the GitHub repo and push:
   ```bash
   gh repo create my-blog --public --source=. --push
   ```
2. In the [Cloudflare dashboard](https://dash.cloudflare.com): Workers & Pages →
   Create → Pages → connect the `my-blog` repo.
   Build command `npm run build`, output directory `dist`. Every push to `main`
   deploys automatically.
3. Domain: buy one via Cloudflare Registrar, attach it under the Pages project's
   Custom Domains tab, then update `site` in `astro.config.mjs` to match
   (it's what RSS links are generated from).

## TODO

- Replace the twitter link in `src/pages/index.astro` with the real handle
  (currently guesses `@tanishqjasoria`).

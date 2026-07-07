---
title: "hello, world"
description: "Why this blog exists, what it runs on, and what to expect from it."
date: 2026-07-06
---

Every systems programmer eventually caves and starts a blog. This is mine.

I spend my time in the guts of things: EVM implementations, Rust and Zig
codebases, fuzzers that run for weeks, and lately theorem provers. The posts
here will be war stories and field notes from that work — the kind of writeup
I wish had existed when I was stuck on the same problem.

## What to expect

Long-form technical posts, published when they're ready and not before.
Alongside the posts there's a [courses](/courses/formal-verification-lean4/)
section — structured, multi-week material that's too big for a single article.
The first one is a 10-week formal verification course built around Lean4 and a
production Solidity codebase.

Since this is a blog about verified software, here's a machine-checked fact to
close on:

```lean
theorem add_zero (n : Nat) : n + 0 = n := rfl
```

The site itself is static HTML — no JavaScript, no trackers, no cookies.
If you want new posts as they land, there's an [RSS feed](/rss.xml).

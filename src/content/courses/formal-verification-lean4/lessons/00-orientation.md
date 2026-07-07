---
title: "Orientation & setup"
description: "How the course works, and getting a Lean4 toolchain running before week 1."
order: 0
---

Before week 1 starts, get the toolchain working and understand the shape of
the next ten weeks. This lesson has no proofs in it — it's pure setup.

## How the course works

Each lesson maps to roughly one week of the syllabus. Lessons tell you **what
to read, what to build, and what "done" looks like** — the reading itself
lives in the free official books, not here. Expect 10–15 hours per week.
The exit criteria at each phase boundary are load-bearing: if you don't meet
them, repeat the week rather than moving on. Foundations debt compounds.

## Install Lean4

Lean is managed by `elan`, its version manager (like `rustup` for Rust):

```bash
curl https://elan.lean-lang.org/elan-init.sh -sSf | sh
elan --version
```

Then install VS Code with the official **lean4** extension. Open any `.lean`
file and the extension will download the pinned toolchain automatically.

## Set up your exercise repo

Create a Lake project where all your exercise solutions will live:

```bash
lake new lean-exercises math
cd lean-exercises && lake build
```

The `math` template wires in mathlib4, which weeks 3–5 need. The first
`lake build` downloads a mathlib cache — several GB, so run it on good wifi.

## Verify everything works

Create `Scratch.lean` and check that the infoview responds:

```lean
#eval 1 + 1          -- 2 appears in the infoview

theorem two_eq_two : 2 = 2 := rfl
```

If `#eval` shows `2` and the theorem gets a green checkmark, you're ready
for week 1: chapters 1–2 of
[Functional Programming in Lean](https://lean-lang.org/functional_programming_in_lean/).

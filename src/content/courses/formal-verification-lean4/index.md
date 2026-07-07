---
title: "Formal Verification in Lean4"
description: "A 10-week path from zero theorem proving to machine-checked properties of production Solidity, using Lean4 and Halmos on a real codebase."
status: "in progress"
started: 2026-06-04
---

Most formal verification material teaches you either pure math in a theorem
prover or how to press the buttons on a commercial tool. This course does
neither. It takes you from **zero Lean4** to **machine-checked properties of a
production Solidity library**, and then cross-checks those proofs against the
actual bytecode with a symbolic execution tool — so you know your model isn't
fantasy.

The target is real: [`SpendingLimitLib`](https://github.com/etherfi-protocol/cash-v3)
from the etherfi cash-v3 protocol — a 321-line spending-limit state machine
that's security-critical, small enough to fit in your head, and big enough to
teach real lessons.

## Who this is for

A solid Solidity or systems engineer who is **new to functional programming
and theorem proving**. Budget ~10–15 hours per week for 10 weeks (~125 hours
total). No math background required beyond comfort with induction.

## What you'll produce

1. A Lean4 model of `SpendingLimitLib` + its `TimeLib` dependency
2. Eight stated safety properties, at least five proven with **no `sorry`**
3. A Halmos symbolic test suite proving the *same properties* on the actual Solidity
4. A correspondence document mapping every Lean theorem to its Solidity origin and Halmos counterpart

## Structure

### Phase 1 — Foundations (weeks 1–5)

Learn to read and write Lean4 fluently. No cargo-culting tactics.

| Week | Focus |
|---|---|
| 1 | Functional Programming in Lean ch. 1–2: types, structures, recursion |
| 2 | FPiL ch. 3–4: inductive types, pattern matching, `List` / `Option` |
| 3 | Theorem Proving in Lean 4 ch. 2–3: propositions, proof terms — term-mode first, then tactics |
| 4 | TPiL ch. 4–5: quantifiers, tactic mode |
| 5 | TPiL ch. 7: induction on `Nat` and `List` |

**Exit criteria:** you can write `theorem foo : P → Q := by …` and explain
every tactic in plain English, do induction without looking it up, and read a
mathlib lemma signature cold. Do not move on before this holds — rushed
foundations are the most common failure mode.

### Phase 2 — Model and prove (weeks 6–8)

Translate the Solidity into pure Lean functions (`Nat` for amounts,
`Except SpendError` for reverts), state eight invariants *before* proving
anything, then prove them in order:

| # | Property |
|---|---|
| 1 | `spend` never exceeds the daily limit |
| 2 | `spend` never exceeds the monthly limit |
| 3 | Spent amounts increase monotonically between renewals |
| 4 | Renewal resets `spentToday` before spending |
| 5 | Renewal strictly advances the renewal timestamp |
| 6 | Pending limits don't activate before their delay |
| 7 | Every reachable state has `dailyLimit ≤ monthlyLimit` |
| 8 | `initialize` returns a safe state or an error |

Fair warning: modeling `block.timestamp` and "start of next day/month" math
is the hardest part — expect week 6 to be entirely about `TimeLib`, not the
proofs.

### Phase 3 — Cross-check with Halmos (weeks 9–10)

Lean proves the model is internally consistent. "The model matches the
Solidity" is a separate claim — a misread `unchecked` block would let buggy
Solidity pass while the proof stays "valid." So each theorem gets a mirror
symbolic test in [Halmos](https://github.com/a16z/halmos), run against the
real contract. Counterexamples mean the model is wrong: fix the model, not
the theorem. The discovery is the value.

## Toolchain

| Layer | Tool |
|---|---|
| Prover | Lean4 stable + mathlib4, pinned for the duration |
| Build | Lake |
| Symbolic execution | Halmos |
| Solidity | 0.8.28, Cancun EVM (Foundry) |

## Materials

- [Functional Programming in Lean](https://lean-lang.org/functional_programming_in_lean/)
- [Theorem Proving in Lean 4](https://lean-lang.org/theorem_proving_in_lean4/)
- [Mathematics in Lean](https://leanprover-community.github.io/mathematics_in_lean/) (optional)
- All code lives in [`lean-in`](https://github.com/tanishqjasoria/lean-in)

---
title: "Solidity, for someone who already knows the EVM"
description: "A dense single-sitting primer: how Solidity maps onto the machine you already understand — storage layout, dispatch, the 0.8.x timeline, canonical bug classes, proxies, and gas idioms."
date: 2026-07-12
---

A dense, single-sitting primer (~3 hours). Written assuming you know opcodes, gas, calldata,
storage as a 256-bit word-addressed K/V store, the message-call model, and `CREATE`/`CREATE2`.
It does **not** re-teach any of that. It teaches how Solidity-the-language maps onto the machine
you already understand, plus the semantics, idioms, standards, and bug classes that take
application devs years to internalize.

Current stable compiler when this was written: **0.8.35** (April 2026). Everything assumes
the 0.8.x line.

**Reading order:** straight through. Sections 1–5 build the mental model; 6–11 are language
mechanics; 12–17 are the modern/practical/security core (the highest-value part for you);
18 is a self-test — do it in the last 20 minutes for active recall.

---

## 1. The one-page mental model

A `.sol` file compiles to two bytecode blobs:

- **Creation (init) code** — runs once during the deploying transaction. It's your constructor
  logic plus a trailer that `RETURN`s the runtime code. Constructor args are ABI-encoded and
  appended after the init bytecode (not in calldata — that's why constructors read args from
  code, not `CALLDATALOAD`).
- **Runtime code** — what lives at the address afterwards. Every external call enters here.

Runtime code begins with a **function dispatcher**: load the first 4 bytes of calldata
(`CALLDATALOAD(0)` shifted right by 224 bits), compare against each external function's
**selector** (`bytes4(keccak256("transfer(address,uint256)"))`), and jump. No match → `receive`/
`fallback` logic → else revert. This is just a jump table you'd have hand-written in assembly.

**Memory model:** Solidity reserves a layout you should memorize:
- `0x00`–`0x3f`: scratch space (used for hashing, etc.)
- `0x40`: the **free memory pointer** — Solidity's bump allocator head. Allocating = read pointer,
  use it, advance it. There is no `free`; memory only grows within a call.
- `0x60`: the zero slot (permanent 32 bytes of zero, used as the data location for empty
  dynamic arrays).
- `0x80`: where the free pointer starts.

**Storage** is the 256-bit word K/V map you know. Solidity's whole "storage layout" system
(section 5) is just a deterministic scheme for assigning variables to slots. There is no magic —
you can always compute exactly which slot any variable lives in.

Keep this frame the whole way down: *every Solidity construct is sugar over slots, memory offsets,
calldata reads, and opcodes.* When a feature confuses you, ask "what does this compile to?"

---

## 2. Two compilation pipelines

There are two backends, and the difference occasionally matters for bugs and gas:

- **Legacy (`solc` default):** Solidity AST → EVM assembly directly.
- **IR pipeline (`--via-ir`):** Solidity → Yul (an intermediate language) → optimized → EVM.
  Produces better gas in many cases, enables some features, and has slightly different codegen.

Why you care: some historical bugs only manifested under one pipeline. Example: a high-severity
bug affecting clearing of storage/transient variables existed in **0.8.28–0.8.33 only with
`--via-ir`**, fixed in 0.8.34. When you read audit reports mentioning "via-ir," this is the axis
they mean.

---

## 3. Contract anatomy

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;        // version constraint, enforced at compile time

contract Vault {
    address public immutable owner;     // set once in constructor, baked into runtime code
    uint256 public constant FEE_BPS = 30; // compile-time literal, inlined at every use site
    uint256 public totalDeposits;       // slot 0 (first storage variable)

    constructor(address _owner) {
        owner = _owner;
    }
}
```

**`constant` vs `immutable` — both avoid an `SLOAD`, differently:**
- `constant`: value known at compile time, **inlined** as a `PUSH` everywhere it's used. No storage,
  no constructor.
- `immutable`: value set in the constructor, then **baked into the runtime bytecode** at deploy time
  (the compiler `CODECOPY`s it in). Reading it is a code read, not an `SLOAD`. You can't change it
  after deploy. Crucial gotcha: immutables are part of the *deployed* contract's code — a proxy's
  `delegatecall` runs the *implementation's* code, so an implementation's immutables are fixed at the
  implementation's deploy, identical for every proxy. (More in section 15.)

**Recommended file layout** (also the order auditors expect): pragma → imports → interfaces →
libraries → contract: type declarations → state variables → events → errors → modifiers →
constructor → receive/fallback → external → public → internal → private.

---

## 4. The type system

### Value types (copied by value)
- `bool`, `address`, `address payable` (the latter has `.transfer`/`.send`), `uintN`/`intN`
  for N in 8..256 step 8, `bytes1`..`bytes32` (fixed), `enum`, contract types, function types.
- **`address` is 20 bytes but occupies a full 32-byte slot** (left-padded). `addressVar.balance`,
  `.code`, `.codehash`, `.call`, `.delegatecall`, `.staticcall` are members.

### The truncation footgun (explicit conversions)
Solidity 0.8 has checked *arithmetic* but **conversions are not checked**:
```solidity
uint256 big = 257;
uint8 small = uint8(big);   // = 1, silently truncated, NO revert
int256 neg = -1;
uint256 huge = uint256(neg); // = 2**256 - 1, reinterpreted bits
```
Downcasting is a frequent real-world bug. OpenZeppelin's `SafeCast` exists precisely for this.

### Reference types (have a data location)
`bytes`, `string`, arrays (`T[]` dynamic, `T[k]` fixed), `struct`, `mapping`. Every reference-typed
variable is annotated with `storage`, `memory`, or `calldata` — see section 5.

### User-defined value types (UDVT)
```solidity
type Wad is uint256;                 // zero-cost newtype, no implicit mixing
Wad a = Wad.wrap(1e18);
uint256 raw = Wad.unwrap(a);
```
Use these like Rust newtypes to stop unit confusion (e.g., `Shares` vs `Assets`). No runtime cost.

### Enums
Backed by `uint8` (max 256 members). `type(MyEnum).min/.max` exist. Casting an out-of-range integer
into an enum **does** panic (code 0x21) — unlike numeric truncation.

### Function types
- `internal` function pointers = a code jump destination (an offset). Cheap, can't cross contract
  boundaries.
- `external` function pointers = a 24-byte value packing `address` (20) + `selector` (4). This is
  how callbacks across contracts are passed.

### Literals & units
`1 ether == 1e18`, `1 gwei == 1e9`, `1 days == 86400`, `1 weeks`, etc. Rational literals are
computed at arbitrary precision at compile time, then must fit the target type.

---

## 5. Data locations and storage layout (the part worth slowing down for)

### storage / memory / calldata
- **`storage`**: a *reference* to a slot in persistent storage. Assigning one storage reference to
  another is a **pointer copy**, not a data copy — a classic bug source.
- **`memory`**: a copy in the bump-allocated memory region. Mutable, lives for the call.
- **`calldata`**: a read-only view directly into the transaction's calldata. Cheapest for params you
  don't mutate; no copy. Prefer `calldata` over `memory` for external function array/bytes params.

```solidity
function f(uint256[] calldata input) external {
    uint256[] storage s = myArray;   // pointer to storage
    s[0] = input[0];                 // writes storage
    uint256[] memory m = input;      // COPIES calldata -> memory
}
```

Watch this:
```solidity
struct Point { uint256 x; uint256 y; }
Point[] points;
function bug() external {
    Point storage p = points[0];   // reference
    Point memory q = points[0];    // copy
    q.x = 5;                       // changes nothing on chain
    p.x = 5;                       // SSTORE
}
```

### Storage slot assignment rules (deterministic — you can compute every one)
1. State variables get slots **in declaration order**, starting at 0.
2. **Packing:** consecutive variables each ≤ 32 bytes share a slot if they fit, filling low-order
   bytes first. A variable that doesn't fit starts a new slot. `struct` and array data always start
   a new slot, and the variable after a struct/array also starts fresh.
   ```solidity
   uint128 a;  // slot 0, bytes [0..16)
   uint128 b;  // slot 0, bytes [16..32)  ← packed with a
   uint256 c;  // slot 1
   uint8 d;    // slot 2, byte 0
   ```
   Packing saves `SSTORE`s but a *partial* write to a packed slot still reads-modifies-writes the
   whole word. Group fields you write together.
3. **Mappings:** the mapping itself occupies a slot `p` (which holds nothing). Value for key `k`
   lives at `keccak256(h(k) . p)` where `.` is concatenation and `h` pads/encodes the key. Nested:
   recurse.
   ```
   slot(map[k]) = keccak256(abi.encode(k, p))
   ```
4. **Dynamic arrays:** slot `p` holds the **length**. Element `i` lives at
   `keccak256(p) + i * sizeOfElement`.
5. **`bytes`/`string`:** if length < 32, data and `length*2` are packed into slot `p` itself
   (low bit 0). If ≥ 32 bytes, slot `p` holds `length*2+1` and data starts at `keccak256(p)`.
6. **Inheritance:** base contract variables come **first**, in linearization order (most-base first),
   then the derived contract's. This ordering is why upgradeable contracts must never reorder or
   insert state variables (section 15).

**Transient storage** (0.8.28+) uses `TSTORE`/`TLOAD` (EIP-1153) and has its own *independent*
layout following the same rules. Declared `uint256 transient x;`. Cleared at end of transaction,
not call — perfect for reentrancy locks (cheaper than an `SSTORE` toggle). Only value types
supported so far.

**Custom storage layout** (0.8.29+): `contract C is A, B layout at 0x42 { ... }` relocates the whole
inheritance tree's storage to an arbitrary base slot. Built for EIP-7702 smart accounts to avoid
collisions. 0.8.35 added an `erc7201` builtin that computes the ERC-7201 namespaced base slot from a
namespace string.

---

## 6. Functions, visibility, modifiers

### Visibility
- `external`: callable only from outside (or `this.f()`). Args can be `calldata`.
- `public`: callable both ways; the compiler generates a dispatcher entry. For a `public` state
  variable, it auto-generates a getter of the same name.
- `internal`: this contract + derived. Becomes a `JUMP`, not a call.
- `private`: this contract only (but still readable on-chain — *nothing* is secret on a blockchain).

### State mutability
- `pure`: reads/writes no state (no `SLOAD`/`SSTORE`/env reads).
- `view`: reads but doesn't write. Calling a `view` externally uses `STATICCALL`.
- `payable`: may receive ether. **Non-payable functions reject ether** via a compiler-inserted
  `callvalue` check that reverts — so "payable is the absence of that check."

### Selectors
4-byte `keccak256` of the canonical signature (`"transfer(address,uint256)"` — types only, no
names, no spaces). Selector collisions are possible and have been weaponized (a proxy admin
function colliding with an implementation function — see transparent proxies, section 15).

### Modifiers
Pure code substitution. The `_;` marks where the function body is spliced in.
```solidity
modifier nonReentrant() {
    require(_lock == 1, "reentrant");
    _lock = 2;
    _;                 // body runs here
    _lock = 1;
}
```
Because modifiers **inline**, heavy modifiers bloat every function that uses them. Two `_;` would
run the body twice; zero `_;` means the body never runs (a real bug pattern). Modifiers can't easily
return values; prefer internal functions for shared logic with returns.

### Named return variables
```solidity
function split(uint256 x) public pure returns (uint256 a, uint256 b) {
    a = x / 2;       // pre-declared, default-initialized to 0
    b = x - a;       // implicit return of (a, b)
}
```
Mixing `return` with named returns is legal but a readability/aud­it trap — pick one style.

---

## 7. Inheritance, interfaces, libraries

### Inheritance & C3 linearization
Solidity uses **C3 linearization** (like Python) to order multiple bases. Declare bases
**most-base-first**: `contract C is A, B` means B can override A. `super.f()` walks the linearized
chain, not just the immediate parent — in diamond hierarchies this matters a lot.
- `virtual`: function may be overridden.
- `override`: function does override (must list all bases it overrides when ambiguous:
  `override(A, B)`).
- A function with no implementation makes the contract `abstract`.

Constructors run **base-first** regardless of declaration; pass base constructor args either in the
inheritance list or the derived constructor.

### Interfaces
All functions `external`, no implementation, no state, no constructor. Can declare `events`,
`errors`, and constants. Implicitly `virtual`. Used for typed external calls:
```solidity
IERC20(token).transfer(to, amt);  // encodes selector + args, does the CALL, checks return
```

### Libraries
Stateless reusable code. Two flavors:
- **Internal library functions** are **inlined** into the calling contract (a `JUMP`), no separate
  deployment. This is the common case (e.g., `SafeCast`, `Math`).
- **External/public library functions** are deployed once as a separate contract and called via
  `DELEGATECALL` (so they execute in the caller's storage context). Requires linking the library
  address at deploy. Used to share large code across many contracts.

`using Lib for Type;` attaches library functions as methods:
```solidity
using SafeERC20 for IERC20;
token.safeTransfer(to, amt);   // sugar for SafeERC20.safeTransfer(token, to, amt)
```
0.8 also allows `using {add, sub} for Wad;` and global `using ... for T global;`.

---

## 8. Errors and control flow

### Three failure primitives
- `require(cond, "msg")` or `require(cond, CustomError())` (custom-error form added in 0.8.26):
  validate inputs/conditions; refunds remaining gas; **`Error(string)`** ABI-encoded revert.
- `revert CustomError(args);` — the modern, gas-cheap, typed way to fail.
- `assert(cond)`: for invariants that should *never* be false. On failure emits **`Panic(uint256)`**
  with a code, and (historically) consumed all gas — now it reverts like the rest but signals
  "this is a bug, not a bad input."

### Custom errors (use these by default)
```solidity
error InsufficientBalance(uint256 available, uint256 required);
if (bal < amt) revert InsufficientBalance(bal, amt);
```
Cheaper than string reverts (4-byte selector + ABI-encoded args vs. a stored string) and carry
structured data. The selector is `bytes4(keccak256("InsufficientBalance(uint256,uint256)"))`.

### Panic codes (memorize the common ones — they show up in debugging)
| Code | Meaning |
|------|---------|
| 0x01 | `assert(false)` |
| 0x11 | arithmetic overflow/underflow (the checked-math revert) |
| 0x12 | division or modulo by zero |
| 0x21 | invalid value cast into an enum |
| 0x22 | accessed a malformed/incorrectly encoded storage byte array |
| 0x31 | `.pop()` on an empty array |
| 0x32 | array index out of bounds |
| 0x41 | out of memory / too much allocation |
| 0x51 | called a zero-initialized internal function pointer |

### try / catch (only for *external* calls and `new`)
```solidity
try IERC20(token).transfer(to, amt) returns (bool ok) {
    // success path
} catch Error(string memory reason) {        // revert("...") / require
} catch Panic(uint256 code) {                // assert / arithmetic / etc.
} catch (bytes memory lowLevelData) {        // custom errors land here (raw bytes)
}
```
Limitations: only wraps external calls/contract creation, **not** internal calls or arithmetic;
a custom error is **not** caught by `catch Error` — it falls into the low-level `catch (bytes)`.

---

## 9. Calls, money, and the dangerous surface

### The four call types from Solidity
- **High-level typed call** `IFoo(addr).bar(x)`: encodes selector+args, `CALL`, decodes return,
  **reverts on failure**, and reverts if `addr` has no code *when a return value is expected*.
- **`addr.call(data)`** → `(bool ok, bytes memory ret)`: raw `CALL`. **Does not revert on failure**
  and **does not check for code** — you must check `ok` yourself. Returns `true` for calls to EOAs
  / empty addresses (no code to fail).
- **`addr.delegatecall(data)`**: runs target's code in *this* contract's storage/`msg.sender`/
  `msg.value` context. The engine of proxies and a top source of catastrophic bugs.
- **`addr.staticcall(data)`**: like `call` but reverts if the callee attempts a state change.

```solidity
(bool ok, bytes memory ret) = target.call{value: 1 ether, gas: 50000}(
    abi.encodeWithSelector(IFoo.bar.selector, x)
);
if (!ok) revert CallFailed();
```

### receive / fallback dispatch
```solidity
receive() external payable { ... }   // called on plain ether send with empty calldata
fallback() external [payable] { ... } // called when no selector matches, or has calldata + no receive
```
Decision: empty calldata + `receive` exists → `receive`; else → `fallback`. If neither and ether
is sent → revert.

### transfer / send / call for sending ether — history matters
- `addr.transfer(x)`: forwards a fixed **2300 gas**, reverts on failure.
- `addr.send(x)`: forwards 2300 gas, returns `bool`.
- `addr.call{value:x}("")`: forwards all gas (or a set amount), returns `(bool, bytes)`.

The 2300-gas stipend was sized so the recipient could emit one event but not re-enter. **EIP-2929
(Berlin) raised `SLOAD`/`CALL` gas costs**, which broke contracts relying on 2300 gas being enough.
**Modern guidance: prefer `call` with an explicit reentrancy guard** rather than `transfer`/`send`,
because gas costs can change again with future forks. (The tradeoff: `call` reopens reentrancy, so
the guard is mandatory.)

### selfdestruct after EIP-6780 (Cancun)
`selfdestruct` no longer deletes code/storage *unless called in the same transaction the contract was
created in*. It now mostly just forcibly sends the balance. Don't design around the old "destroy and
redeploy at same address" behavior.

### The forced-ether invariant footgun
A contract's balance can **increase without any code running**: via `selfdestruct` of another
contract sending you funds, via a `coinbase` (block reward) payout, or via funds pre-sent to a
`CREATE2` address before deployment. Therefore **`address(this).balance` can exceed the sum your
accounting tracked**. Never write `require(address(this).balance == expected)` — that's a permanent
DoS waiting to happen. Track balances in your own state.

---

## 10. Events

Events are `LOG0`–`LOG4`. `indexed` params become **topics** (max 3 indexed for a non-anonymous
event; topic 0 is the event signature hash). Non-indexed params are ABI-encoded into the **data**
field.

```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
emit Transfer(msg.sender, to, value);
```

Key facts:
- **Indexing a dynamic type** (`string`, `bytes`, array) stores the **keccak256 hash** as the topic,
  not the value — you can filter by it but can't recover the original from logs.
- `anonymous` events omit the signature topic (frees a 4th indexable slot, can't be filtered by name).
- Events are **not readable by contracts** — they exist for off-chain consumers. Don't use them for
  on-chain state.

---

## 11. ABI encoding, hashing, signatures

### The `abi.*` family
- `abi.encode(...)`: standard, 32-byte-padded, the canonical encoding (what calls/returns use).
- `abi.encodePacked(...)`: tightly packed, no padding. **Collision hazard**:
  `encodePacked("a","bc") == encodePacked("ab","c")`. Never hash `encodePacked` with ≥2 dynamic
  args; use `abi.encode` for hashing structured data.
- `abi.encodeWithSelector(sel, args)`, `abi.encodeWithSignature("f(uint256)", args)`,
  `abi.encodeCall(IFoo.bar, (x, y))` — the last is **type-checked** against the function signature;
  prefer it.
- `abi.decode(bytes, (T1, T2))`.

### keccak256 / hashing
`keccak256(abi.encode(...))` is the workhorse. `sha256`, `ripemd160`, `ecrecover` are precompiles.

### ecrecover pitfalls
```solidity
address signer = ecrecover(hash, v, r, s);
```
- Returns **`address(0)` on failure** — if you don't reject `address(0)` you may treat a bad
  signature as a valid one for an uninitialized slot. **Always `require(signer != address(0))`.**
- **Signature malleability**: `(v, r, s)` and `(v', r, -s mod n)` are both valid for the same key.
  If you use the signature as a uniqueness key (replay protection), malleability breaks it. Restrict
  `s` to the lower half-order. Use OpenZeppelin `ECDSA` which handles both.

### EIP-712 typed structured data & permit (EIP-2612)
EIP-712 defines a domain separator (`name`, `version`, `chainId`, `verifyingContract`) plus a typed
struct hash, so wallets show human-readable signing prompts and signatures are bound to a specific
chain + contract (anti-replay). EIP-2612 `permit` lets a user approve an ERC-20 via signature
(gasless approval), avoiding the two-tx approve+transferFrom dance. You'll see this constantly in
DeFi.

---

## 12. The 0.8.x timeline (what changed and when)

The single most important shift: **0.8.0 made arithmetic checked by default.** Before, you needed
`SafeMath` everywhere; now `+ - * /` revert (Panic 0x11) on overflow/underflow. The escape hatch:

```solidity
unchecked {
    i++;             // skip overflow check where you've proven it's safe (e.g. loop counters)
}
```
Use `unchecked` deliberately for gas, only where overflow is impossible. It's a frequent audit focus.

Other milestones worth knowing:
- **0.8.4**: custom errors.
- **0.8.18**: `using {f} for T global;` and named import improvements.
- **0.8.24**: Cancun support — transient storage opcodes (`TSTORE`/`TLOAD`), `MCOPY`, blob basics.
- **0.8.26**: `require(cond, CustomError())` form; via-IR became the default in some toolchains.
- **0.8.28**: transient storage **state variables** (value types) at the language level.
- **0.8.29**: **custom storage layout** (`layout at`), experimental EOF, ethdebug.
- **0.8.34** (Feb 2026): bugfix for a high-severity IR-pipeline storage/transient clearing bug that
  affected 0.8.28–0.8.33 with `--via-ir`.
- **0.8.35** (Apr 2026): `erc7201` builtin (computes ERC-7201 namespaced base slot); experimental
  features gated behind `--experimental`.

Rule of thumb: pin an exact compiler version in production (`pragma solidity 0.8.35;`), not a range,
and read the changelog before bumping.

---

## 13. Security: the canonical bug classes (the highest-value section)

You'll spend the audit phase of your course living here. Each is a pattern, not a one-off.

### Reentrancy
External call hands control to an attacker before you update state. Classic:
```solidity
// VULNERABLE
function withdraw() external {
    uint256 bal = balances[msg.sender];
    (bool ok,) = msg.sender.call{value: bal}("");   // attacker re-enters here
    require(ok);
    balances[msg.sender] = 0;                        // too late
}
```
Defenses: **Checks-Effects-Interactions** (update state *before* the external call), and/or a
`nonReentrant` guard. **Read-only reentrancy** is the subtle modern variant: a `view` function
returns stale state mid-reentrancy, and a *different* protocol reading it as an oracle gets fooled —
the vulnerable contract itself never changes state. Cross-function and cross-contract reentrancy
generalize the same idea. Transient-storage locks (section 5) are the cheap modern guard.

### delegatecall + storage collision
`delegatecall` runs foreign code against *your* slots. If the callee's storage layout doesn't match
the caller's, writes land on the wrong variables. This is the root hazard of all proxies (section 15)
and of "delegatecall to arbitrary address" bugs (the Parity multisig freeze). Never `delegatecall`
untrusted code; always keep proxy/impl layouts aligned.

### Oracle / price manipulation
Reading `getReserves()` or a spot AMM price as a price oracle lets an attacker move the price with a
flash loan within one tx. Use TWAPs, Chainlink-style feeds with staleness/decimals checks, and never
trust a manipulable spot price for valuation.

### Signature replay
A valid signature reused on another chain, another contract, or twice on the same one. Defenses:
EIP-712 domain separator (binds chainId + contract), per-user **nonces**, and recording used
signature hashes. Watch malleability (section 11).

### ERC-20 integration quirks (a whole genre)
- **Missing return value**: USDT and others don't return a `bool` from `transfer`; a naive
  `require(token.transfer(...))` reverts against them. Use **`SafeERC20`** (`safeTransfer`,
  `safeTransferFrom`, `forceApprove`) which handles missing/false returns.
- **Fee-on-transfer / deflationary tokens**: the amount received ≠ amount sent. Measure
  balance-before/after if you support them.
- **Rebasing tokens**: balances change out from under you.
- **Approval race / non-zero-to-non-zero approve**: some tokens require setting allowance to 0 first.
- **Decimals vary** (6 for USDC, 18 for most): never hardcode `1e18`.

### ERC-4626 inflation / "donation" attack
First depositor mints 1 wei of shares, then *donates* assets directly to the vault to inflate share
price, so the next depositor's deposit rounds down to 0 shares — stolen. Defenses: virtual
shares/assets offset (OpenZeppelin's approach), or a dead first deposit. Know this one cold; it's
asked constantly.

### Rounding direction
Always round **in the protocol's favor**: round *down* when minting shares to a user, round *up* when
charging what they owe. A consistent wrong-direction rounding is drainable over many iterations.
`mulDiv` with explicit rounding (OpenZeppelin `Math`) is the tool.

### DoS patterns
- **Unbounded loops** over user-growable arrays → eventually exceeds block gas, function bricked.
  Prefer pull-over-push (let users withdraw individually) over iterating to pay everyone.
- **Reverting recipient**: pushing ether to an address that reverts blocks the whole batch. Pull
  payments fix this.
- **Forced-balance assertions** (section 9).

### Access control
- Missing/incorrect `onlyOwner` / role checks; unprotected `initialize` (section 15).
- `tx.origin` for auth is **always wrong** (phishing via an intermediary contract). Use `msg.sender`.
- Centralization risk: an owner that can rug. Auditors flag privileged functions even when "intended."

### MEV / front-running / slippage
Public mempool means your tx is visible before inclusion. Swaps need `minAmountOut`/`deadline`;
commit-reveal or private relays for sensitive ordering. Sandwich attacks target unprotected swaps.

### Uninitialized / default values
Storage defaults to zero. An uninitialized `address owner` is `address(0)`; an uninitialized struct
mapping returns an all-zero struct (not "not found"). Distinguish "absent" from "zero" explicitly.

---

## 14. Standards you must recognize on sight

- **ERC-20** — fungible tokens: `totalSupply`, `balanceOf`, `transfer`, `transferFrom`, `approve`,
  `allowance`, events `Transfer`/`Approval`. (Quirks in section 13.)
- **ERC-721** — NFTs: unique `tokenId`, `ownerOf`, `safeTransferFrom` (calls `onERC721Received` on
  contract recipients — a reentrancy surface), `approve`/`setApprovalForAll`.
- **ERC-1155** — multi-token (fungible + non-fungible in one contract), batch transfers, also has
  receiver hooks.
- **ERC-4626** — tokenized vault standard over ERC-20: `deposit`/`mint`/`withdraw`/`redeem`,
  `convertToShares`/`convertToAssets`, `totalAssets`. (Inflation attack in section 13.)
- **ERC-165** — interface detection: `supportsInterface(bytes4)`.
- **EIP-712 / EIP-2612 permit** — typed signatures, gasless approvals (section 11).
- **EIP-1967** — standard storage slots for proxies (impl/admin/beacon at fixed pseudo-random slots
  to avoid collision). **EIP-1167** — minimal proxy ("clone"), a tiny `delegatecall` stub for cheap
  mass deployment. **ERC-7201** — namespaced storage layout (`erc7201` builtin in 0.8.35).

---

## 15. Proxies and upgradeability

The proxy holds **storage + balance + address**; a separate **implementation** holds the **code**.
The proxy's `fallback` `delegatecall`s the implementation, so impl code mutates proxy storage.

### Two dominant patterns
- **Transparent proxy**: admin calls are routed to proxy-admin logic; everyone else's calls go to the
  implementation. Solves the **selector-collision** problem where an admin function and an impl
  function share a selector. Slightly more gas per call.
- **UUPS**: the upgrade logic lives in the *implementation* (an `upgradeTo` guarded by access control),
  proxy is leaner. Risk: if you deploy an implementation **without** the upgrade function, the proxy
  is bricked forever. Use OpenZeppelin's `UUPSUpgradeable` which guards against this.

### The rules that bite people
1. **No constructors in implementations** — constructors run in the impl's own context at impl
   deploy, so they never touch proxy storage. Use an `initialize()` function instead, guarded by an
   `initializer` modifier so it runs exactly once. **An unprotected initializer is an instant
   takeover** (the Wormhole / many post-mortems).
2. **`immutable`/`constant` in implementations** are fine for values identical across all proxies
   (they live in impl code), but **cannot** hold per-proxy state.
3. **Storage layout is append-only**: never reorder, change types of, or insert state variables
   between versions — the new code would read old data at the wrong slots. Add new variables only at
   the end. Use **storage gaps** (`uint256[50] __gap;`) in base contracts to reserve room, or
   ERC-7201 namespaced storage to sidestep the whole problem.
4. **Disable initializers in the impl's constructor** (`_disableInitializers()`) so nobody can
   initialize the implementation contract directly.

---

## 16. Gas idioms (how application devs write cheap code)

You know the opcode costs; here's how they surface in Solidity:
- **Pack storage** so related writes share a slot; order struct fields by size.
- **`calldata` over `memory`** for external read-only array/bytes params (skips a copy).
- **Custom errors over `require` strings** (no stored string).
- **Cache storage reads** in memory inside loops (`uint256 len = arr.length;` once).
- **`unchecked { ++i; }`** for loop counters that can't overflow; `++i` over `i++`.
- **`immutable`/`constant`** to turn `SLOAD`s into code reads / inlined pushes.
- **Short-circuit** ordering: cheap conditions first in `&&`/`||`.
- **Transient storage** for intra-tx flags (reentrancy guard) instead of `SSTORE` toggling.
- **Minimal proxies (EIP-1167)** for deploying many identical contracts cheaply.
- Read **Solady** and **OpenZeppelin** source to absorb the idioms — Solady is the assembly-heavy
  gas-extremist reference, OZ is the readable, safety-first reference.

Caveat: don't micro-optimize at the cost of readability/safety unless it's on a hot path. Most audit
findings are correctness, not gas.

---

## 17. Inline assembly / Yul taster

Solidity embeds **Yul** in `assembly { }` blocks. Since you think in opcodes, this is mostly a syntax
map:

```solidity
function getCodeSize(address a) external view returns (uint256 size) {
    assembly {
        size := extcodesize(a)        // opcode as a function
    }
}

// Reading a storage slot directly:
assembly {
    let v := sload(0)
    sstore(0, add(v, 1))
}

// The idiomatic free-memory-pointer dance:
assembly {
    let ptr := mload(0x40)            // load free mem pointer
    mstore(ptr, 0xabcd)              // write
    mstore(0x40, add(ptr, 0x20))     // bump pointer
}
```

Key points:
- Opcodes appear as functions: `add`, `mul`, `sload`, `sstore`, `mload`, `mstore`, `call`,
  `keccak256(ptr, len)`, `extcodesize`, `returndatacopy`, `revert(ptr, len)`, etc.
- `:=` is assignment; `let` declares locals (these are stack/`memory`, not your Solidity variables
  unless you name them).
- You can name Solidity variables in assembly to read/write them; for storage variables use
  `.slot` and `.offset` (`x.slot`, `x.offset`).
- Assembly **bypasses Solidity's safety** (no overflow checks, no type safety, no bounds checks).
  It's where the worst bugs and the best gas wins both live. Audit it twice.
- `memory-safe` annotation (`assembly ("memory-safe") { }`) promises you respect Solidity's memory
  model, letting the optimizer do more.

---

## 18. Worked examples (do these with pen and paper — this is where the hours go)

Reading about slots is forgettable; *computing* them once wires it in. Work each before reading the
solution. You have a captive few hours and no Solidity compiler — that's the ideal condition for this.

### 18.1 — Trace a full storage layout by hand
```solidity
contract Bank {
    address owner;            // (a)
    bool paused;              // (b)
    uint96 feeBps;            // (c)
    uint256 totalSupply;      // (d)
    mapping(address => uint256) balances;   // (e)
    uint128 lastUpdate;       // (f)
    uint128 epoch;            // (g)
    uint256[] history;        // (h)
}
```
Assign each variable its slot and byte offset. Then compute the slot holding `balances[A]` and the
slot holding `history[2]`.

<details>
<summary>Solution</summary>

- `owner` (20 bytes) → slot 0, bytes [0..20).
- `paused` (1) → slot 0, byte [20]. Fits (20+1 ≤ 32).
- `feeBps` (`uint96` = 12 bytes) → 20+1+12 = 33 > 32, **doesn't fit** → slot 1, bytes [0..12).
- `totalSupply` (32) → slot 2 (full word always starts fresh).
- `balances` (mapping) → occupies slot 3 (the slot itself stores nothing).
- `lastUpdate` (16) → slot 4, bytes [0..16).
- `epoch` (16) → slot 4, bytes [16..32). Packed with `lastUpdate`.
- `history` (dynamic array) → slot 5 holds the **length**.
- `balances[A]` = `keccak256(abi.encode(A, uint256(3)))`.
- `history[2]` = `keccak256(abi.encode(uint256(5))) + 2`  (i.e. `keccak256(slot5) + 2*1` since each
  element is one word).

Notice `feeBps` wasted the rest of slot 0. Reordering (`owner`, `feeBps`, `paused`) would pack all
three into slot 0 and save a slot. That's a real gas review comment.
</details>

### 18.2 — Compute a selector and an error selector
Without a compiler, compute conceptually (you can't run keccak in your head, but you can write the
exact preimage — that's the skill that matters):
- The 4-byte selector for `transferFrom(address from, address to, uint256 amount)`.
- The selector for `error InsufficientBalance(uint256 available, uint256 required)`.

<details>
<summary>Solution</summary>

- Selector = first 4 bytes of `keccak256("transferFrom(address,address,uint256)")`. **Names and
  spaces are stripped** — only the canonical type list. (It happens to be `0x23b872dd`, the well-known
  ERC-20 selector.)
- Error selector = first 4 bytes of `keccak256("InsufficientBalance(uint256,uint256)")`. A reverting
  custom error returns exactly this selector followed by the ABI-encoded args — which is why
  `catch (bytes memory data)` receives `selector ++ abi.encode(available, required)`.

The lesson: a selector is a *signature hash*, so two different functions can collide on 4 bytes, and a
malicious proxy admin function can be made to collide with an implementation function. Transparent
proxies exist to neutralize exactly that.
</details>

### 18.3 — Walk a reentrancy exploit end to end
Here is the vulnerable bank and the attacker. Trace the call stack and the value of
`balances[attacker]` at each step.
```solidity
contract Bank {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 bal = balances[msg.sender];
        (bool ok,) = msg.sender.call{value: bal}("");   // ← hands control to attacker
        require(ok);
        balances[msg.sender] = 0;                        // ← state cleared AFTER the call
    }
}

contract Attacker {
    Bank bank;
    constructor(Bank b) { bank = b; }
    function attack() external payable { bank.deposit{value: 1 ether}(); bank.withdraw(); }
    receive() external payable {
        if (address(bank).balance >= 1 ether) bank.withdraw();   // re-enter
    }
}
```
Question: if the bank holds 10 ether total and the attacker deposits 1, how much does the attacker
drain, and which exact line is the fix?

<details>
<summary>Solution</summary>

`attack()` deposits 1 → `balances[attacker] = 1e18`. Calls `withdraw()`: reads `bal = 1e18`, sends
1 ether to the attacker's `receive`. **`balances[attacker]` is still `1e18`** because the zeroing
line hasn't run. `receive` re-enters `withdraw()`, which again reads `1e18`, sends another ether,
re-enters... until the bank's balance is drained (all 10 ether), then the unwinding `require(ok)`s
pass and each frame finally sets `balances[attacker] = 0` (harmlessly, repeatedly).

The fix is **ordering**: move `balances[msg.sender] = 0;` *above* the external call
(Checks-Effects-Interactions). After that, the re-entrant `withdraw` reads `bal = 0` and sends
nothing. A `nonReentrant` guard is the belt-and-suspenders second layer. This is Ethernaut level 10
("Reentrancy") and the conceptual core of The DAO.
</details>

### 18.4 — Diagnose a delegatecall storage collision
```solidity
contract Proxy {
    address public implementation;   // slot 0
    address public admin;            // slot 1
    fallback() external payable {
        (bool ok,) = implementation.delegatecall(msg.data);
        require(ok);
    }
}
contract Logic {
    uint256 public counter;          // slot 0
    function increment() external { counter += 1; }
}
```
What variable does `increment()` actually corrupt when called through the proxy, and why?

<details>
<summary>Solution</summary>

`delegatecall` runs `Logic`'s code against **`Proxy`'s storage**. `Logic` thinks `counter` is slot 0,
but in the proxy slot 0 is `implementation`. So `counter += 1` does `SSTORE(0, sload(0)+1)` — it
**increments the implementation address**, pointing the proxy at a garbage (likely codeless) address
and bricking it. This is *the* reason real proxies (EIP-1967) put `implementation` and `admin` at
fixed *pseudo-random* slots (`keccak256("eip1967.proxy.implementation") - 1`) far away from any
slot the logic contract will ever use, and why upgradeable logic contracts must reserve the same
leading layout. It's also the shape of the Parity multisig freeze.
</details>

### 18.5 — Read a minimal but correct ERC-20 closely
Spend ten minutes reading this line by line and predicting which lines an auditor flags and which are
already safe. (This is a *correct* implementation; the exercise is to articulate *why* each line is
safe.)
```solidity
contract Token {
    string public name = "Example";
    string public symbol = "EXMPL";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance(uint256 have, uint256 want);
    error InsufficientAllowance(uint256 have, uint256 want);

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;          // checked add: reverts if it ever overflowed (won't here)
        balanceOf[to] += amount;        // invariant: sum(balanceOf) == totalSupply always holds
        emit Transfer(address(0), to, amount);   // mint convention: from = zero address
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        unchecked { balanceOf[msg.sender] = bal - amount; }   // safe: bal >= amount just checked
        balanceOf[to] += amount;        // can't overflow: total is bounded by totalSupply
        emit Transfer(msg.sender, to, amount);
        return true;                    // returns bool — unlike USDT, so SafeERC20 not strictly needed
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;   // note: overwrite, not increment — approval race exists
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < amount) revert InsufficientAllowance(allowed, amount);
        if (allowed != type(uint256).max) {        // infinite-approval gas optimization
            unchecked { allowance[from][msg.sender] = allowed - amount; }
        }
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance(bal, amount);
        unchecked { balanceOf[from] = bal - amount; }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
```
Questions to answer for yourself: (1) Why is each `unchecked` block actually safe? (2) Why does the
`allowed != type(uint256).max` branch exist? (3) What real-world hazard does `approve` overwriting
(rather than the contract enforcing zero-first) leave for integrators? (4) Why is `from = address(0)`
the mint convention and `to = address(0)` the burn convention, and does this contract let you
accidentally transfer to `address(0)`?

<details>
<summary>Solution</summary>

(1) Every `unchecked` subtraction is guarded by an explicit `<` check immediately above, so underflow
is impossible; the additions can't overflow because the total in circulation is bounded by
`totalSupply`, itself a checked `+=`. (2) Treating `type(uint256).max` as "infinite allowance" skips
the storage write on every `transferFrom`, saving an `SSTORE` — a near-universal optimization.
(3) The classic approve race: if you've approved 100 and want to change to 50, a spender watching the
mempool can spend the 100 *and* the 50. Mitigation is `increaseAllowance`/`decreaseAllowance` or
setting to 0 first. (4) Conventionally mint = transfer *from* zero, burn = transfer *to* zero, so
indexers can track supply changes from `Transfer` logs alone. This minimal contract does **not** block
`transfer(address(0), ...)`, so tokens can be accidentally burned — many production tokens add a
`require(to != address(0))`. That omission is a legitimate review finding.
</details>

### 18.6 — Predict the panic or revert
For each, state whether it reverts and with what (custom error, `Error(string)`, or `Panic(code)`):
```solidity
uint256 x = 5; uint256 y = 0; uint256 z = x / y;        // (a)
uint8 a = 255; a += 1;                                   // (b)
uint8 b = uint8(256);                                    // (c)
uint256[] memory arr = new uint256[](3); uint256 v = arr[3];   // (d)
MyEnum e = MyEnum(7);  // enum has 3 members            // (e)
require(false, "nope");                                  // (f)
revert MyError(42);                                      // (g)
```
<details>
<summary>Solution</summary>

(a) `Panic(0x12)` division by zero. (b) `Panic(0x11)` overflow (checked arithmetic). (c) **No
revert** — `uint8(256) == 0`, silent truncation (the conversion footgun; constant-expression
truncation may warn but won't revert at runtime). (d) `Panic(0x32)` index out of bounds.
(e) `Panic(0x21)` invalid enum cast. (f) `Error("nope")`. (g) the custom error `MyError`'s selector
++ `abi.encode(42)`. If you got (c) right, you've internalized the single most common silent bug in
Solidity.
</details>

---

## 19. Self-test (do this in the last 20 minutes)

Cover the answers. If you can answer all 15, you can read Solidity fluently.

1. What's the difference between `constant` and `immutable` in where the value physically lives?
2. Why does `uint8(uint256(257))` not revert, but casting `3` into a 2-member enum does?
3. Given `mapping(address => uint256) bal` at slot 5, what slot holds `bal[addr]`?
4. You write `Point storage p = arr[0]; p.x = 9;` vs `Point memory q = arr[0]; q.x = 9;` — which
   one persists?
5. Why is `addr.call{value:x}("")` preferred over `addr.transfer(x)` today, and what new risk does it
   introduce?
6. What does `ecrecover` return on a bad signature, and what bug does ignoring that cause?
7. Why must you never write `require(address(this).balance == expected)`?
8. What is read-only reentrancy, and why does CEI alone not prevent another protocol from being
   fooled by it?
9. What's the ERC-4626 inflation attack and one mitigation?
10. Why can't an upgradeable implementation use a constructor for setup, and what replaces it?
11. Why is reordering state variables fatal across a proxy upgrade?
12. When does `fallback` run vs `receive`?
13. Why is `abi.encodePacked` dangerous as input to `keccak256` with two dynamic args?
14. What panic code is overflow, and how do you opt out of the check?
15. What does `delegatecall` change about `msg.sender`, `msg.value`, and storage context vs `call`?

**Answers:** 1. `constant` is inlined into bytecode at each use; `immutable` is baked into runtime
code at deploy (a code read, not SLOAD). 2. Numeric truncation is unchecked; enum range cast panics
(0x21). 3. `keccak256(abi.encode(addr, uint256(5)))`. 4. Only `p` (storage reference); `q` is a memory
copy. 5. `transfer` forwards a fixed 2300 gas that EIP-2929 can make insufficient; `call` forwards
all gas but reopens reentrancy, so you need a guard. 6. `address(0)`; treating a bad sig as valid for
an uninitialized address slot. 7. Balance can be force-increased (selfdestruct, coinbase, pre-funded
CREATE2), permanently bricking the check. 8. A `view` returns mid-reentrancy stale state; CEI fixes
the vulnerable contract's *writes* but a third-party oracle reading the view still sees inconsistent
state. 9. First depositor donates assets to inflate share price so the next deposit rounds to 0 shares;
mitigate with virtual shares/assets offset or a dead first deposit. 10. Constructors run in the impl's
own context at impl deploy and never touch proxy storage; use a one-time guarded `initialize()`.
11. New code computes slots by declaration order; reordering makes it read old data at wrong slots.
12. `receive` on empty calldata when it exists; otherwise `fallback` (and `fallback` for unmatched
selectors with calldata). 13. `encodePacked("a","bc")==encodePacked("ab","c")` → hash collisions; use
`abi.encode`. 14. 0x11; `unchecked { }`. 15. `delegatecall` keeps the caller's `msg.sender`,
`msg.value`, and operates on the caller's storage while running the callee's code; `call` switches to
a fresh context with `msg.sender = the proxy/caller contract`.

---

### Where to go after landing
- **Foundry** (`forge`, `cast`, `anvil`) — your daily driver; learn invariant/fuzz testing first.
- **OpenZeppelin contracts** — read the source, it's the canonical safe reference.
- **Solady** — gas-extremist reference once you want the assembly-level idioms.
- **Ethernaut → Damn Vulnerable DeFi v4** — apply section 13 hands-on.
- Pin to **0.8.35**, read the changelog before any version bump.

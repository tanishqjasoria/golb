---
title: "Ethereum Snapshot Protocol (Verkle Trees)"
description: "A snap/2 protocol sketch for exchanging Verkle state snapshots between peers — suffix-tree ranges, verkle range proofs, and healing via execution witnesses."
date: 2023-10-01
---

> *Originally published [on HackMD](https://hackmd.io/y3rNmxHmRQKHK7QK71NFzA)
> in 2023, while working on Verkle sync design.*

This protocol will be based on the [snap](https://github.com/ethereum/devp2p/blob/master/caps/snap.md)
protocol that already exists and it will be used to facilitate the exchange of
state snapshot after and during verkle transition between peers. The protocol
is an optional extension for peers supporting the dynamic snapshot format.

This new version will be snap/2. Refer to
[the snap protocol spec](https://github.com/ethereum/devp2p/blob/master/caps/snap.md)
to read about the snap protocol.

## Structure of Verkle Tree

![Verkle tree structure: extension nodes identified by stem, each holding a 256-leaf suffix tree](/images/verkle-tree-structure.png)

In the Verkle tree structure, each extension node can be uniquely identified
by its stem (B_31). Remarkably, a suffix tree corresponding to a single
extension node encompasses a total of 256 leaves (B_32).

For Verkle Sync, our strategy involves serving the entire subtree as a single
entity.

Read more about the structure of Verkle Trees
[here](https://blog.ethereum.org/2021/12/02/verkle-tree-structure).

## Protocol Messages

### GetSuffixTreeRange (0x00)

`[reqID: P, rootHash: B_32, startingStem: B_32, limitStem: B_32, responseBytes: P]`

Requests an unknown number of suffix-trees from a given state (verkle) tree,
starting at the specified stem and capped by the maximum allowed response size
in bytes. The intended purpose of this message is to fetch a large number of
subsequent suffix-trees from a remote node and reconstruct a state subtree
locally.

- `reqID`: Request ID to match up responses with
- `rootHash`: state root of the state trie to serve
- `startingStem`: Stem of the first to retrieve
- `limitStem`: Stem after which to stop serving data
- `responseBytes`: Soft limit at which to stop returning data

Notes:

- Nodes **must** always respond to the query.
- If the node does **not** have the state for the requested state root, it
  **must** return an empty reply. It is the responsibility of the caller to
  query an state not older than 128 blocks.
- The responding node is allowed to return **less** data than requested (own
  QoS limits), but the node **must** return at least one subtree. If no
  subtrees exist between `startingStem` and `limitStem`, then the first
  (if any) subtree **after** `limitStem` must be provided.
- The responding node **must** Verkle prove the starting stem (even if it does
  not exist) and the last returned subtree (if any exists after the starting
  stem).

Rationale:

- The suffix-trees are used instead of individual leaves to reduce the size of
  verkle proof.

Caveats:

- When requesting suffix-trees from a starting stem, malicious nodes may skip
  ahead and return a gapped reply. Such a reply would cause sync to finish
  early with a lot of missing data. Proof of non-existence for the starting
  stem prevents this attack, completely covering the range from start to end.
- No special signaling is needed if there are no more suffix-trees after the
  last returned one, as the attached Verkle proof for the last suffix-trees
  will have all trie nodes right of the proven path zero.

### SuffixTreeRange (0x01)

`[reqID: P, suffixTrees: [[stem: B_32, suffixTree: [leaf_0: B_32, leaf_1: B_32, ... leaf_255: B_32]], ...], proof: [node_1: B, node_2, ...]]`

Returns a number of consecutive suffix-trees and the verkle proofs for the
entire range (boundary proofs). The left-side proof must be for the requested
origin stem (even if an associated suffix-tree does not exist) and the
right-side proof must be for the last returned suffix-tree.

- `reqID`: ID of the request this is a response for
- `suffixTrees`: List of consecutive suffix-trees from the trie
  - `stem`: stem of the sub tree
  - `suffixTree`: leaves in the corresponding sub tree as a array of byte[32]
- `proof`: verkle range proof (described below)

Notes:

- If the leaf_i does not exist then the node is supposed to send a null value.

## Verkle Range Proof

![Verkle range proof: only the root nodes of boundary subtrees (green) need proofs](/images/verkle-range-proof.png)

The green nodes here are the one that we need to generate the verkle proof
for the range.

The core concept here revolves around minimizing the size of proofs to the
greatest extent achievable. This goal is achieved by avoiding the inclusion of
proofs for every node within a *subtree*. Imagine these *subtrees* as compact
verkle trees nestled within the overarching verkle tree (highlighted by the
dotted triangles).

Rather than furnishing proofs for every single node within a subtree, the
approach involves solely providing the proof for the root node of said
subtree. This solitary proof effectively verifies the integrity of the entire
subtree, mirroring the principle where proofs aren't transmitted when the
complete tree is served as part of a range.

Notably, this technique draws parallels to the methodology employed in snap
sync, wherein boundary nodes are used to validate the data range.

## Healing

The situation at hand is similar to snap sync in the sense that the available
data is in constant flux due to the continuous arrival of new blocks. Ensuring
synchronization completion before the 128 block window (~25 minutes) elapses
becomes increasingly improbable. However, this is not a cause for concern, as
a self-healing mechanism is in place. While utilizing a merkle tree requires
supplementary data queries to peers for mending purposes, verkle trees negate
this requirement.

Verkle trees introduce a notable enhancement by incorporating supplementary
data within the block (known as ExecutionWitness), thereby facilitating
stateless block processing. This shift mandates the inclusion of all pertinent
data that was both accessed and modified during the block processing stage.
Consequently, this data can be used to mend the state of the verkle tree with
syncing. Post the initiation of sync, for each subsequent block, we can use
the execution witnesses to mend the tree whenever the pivot is altered,
corresponding to the state's movement by +128 blocks.

Whenever a pivot shift transpires, transitioning from 'x' to 'y', the
ExecutionWitnesses associated with the span between 'x' and 'y' can be used to
*heal* the downloaded ranges, synchronizing them with the verkle tree at block
'y'. Following this, the retrieval of ranges can commence from block 'y', and
the healing procedure can be iterated upon whenever a pivot transition is
called for.

Imagine initiating the process at block 'x' and successfully acquiring ranges
spanning from 0 to 'rangeX'. If the intent is to transition the pivot from 'x'
to 'y', a compilation of execution witnesses encompassing the span from 'x' to
'y' can be constructed. From this compilation, the values modified within the
range of 0 to 'rangeX' need to be retained. Applying these modifications
subsequently heals the tree representing the range from 0 to 'rangeX' at block
'y'.

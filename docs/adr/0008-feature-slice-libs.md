# Features are the unit of ownership: one lib per slice, consumer-owned ports

The hexagonal core (`libs/contracts` + `libs/domain`) is reorganized into five feature slices under `libs/features/` — conversations, runs, titling, feedback, models — one Nx lib per user-visible capability. Each slice owns its wire contracts (the zod schemas both runtimes validate against), the ports it consumes, and its behavior. `@crisp/contracts` and `@crisp/domain` are gone; shared entities live in the slice that owns their lifecycle (Message in conversations, Model in models, Feedback in feedback).

Two rules give the split its teeth:

- **Cross-slice, contracts only.** A slice may import another slice's `/contracts` entry (and `/testing` in tests), never its ports or services. Enforced twice: the Nx tag matrix (`scope:feature` may depend on `scope:feature`) at project level, and a `no-restricted-imports` rule at entry-point level — only the composition root in `apps/server` sees a slice's full interface.
- **Consumer-owned ports.** Every cross-slice behavior need is a port declared in the consuming slice, sized to exactly what it uses: runs declares `MessageStore` (two methods), titling declares `ConversationRenamer` (one) and `TitleModel`, feedback declares `FeedbackStore`. TypeScript's structural typing lets one adapter satisfy many ports with no wrapper classes: the SQLite repository serves four slices' ports, the ai gateway two.

The transport layer stays in `apps/server` (one route module per slice, `src/routes/`) — slices are Hono-free and testable end-to-end through fakes of their own ports.

Trade-off accepted deliberately: at ~1.3k LOC of core this is more ceremony than the code strictly needs — five package/tsconfig pairs where two existed, and near-duplicate port declarations (`TitleModel` is a narrower `ModelGateway`). Bought with it: every slice passes the deletion test cleanly (deleting `titling` removes auto-titling and nothing else), the dependency direction is compile-time-enforced rather than conventional, and a new feature has an unambiguous recipe — new slice, own contracts, own ports, wired at the composition root.

Rejected: a thin shared-kernel lib (recreates `@crisp/contracts` under a new name and slices stop owning their central entity); owner-owned importable ports (runs would see all seven repository methods to use two, and titling would depend on runs for its gateway type); slices exporting Hono routers (the owner-cookie contract and rate limiting would leak into every slice's surface).

Status: accepted

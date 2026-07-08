# LangSmith is the observability and analytics home

Conversation analytics (usage, cost, failures, user Feedback) live in LangSmith, not in a first-party store, because the team already operates LangSmith for Hugo — matching that stack beats building a parallel dashboard. Integration is a decorator on the `ModelGateway` port (the domain never learns tracing exists) plus the transcript-persist endpoint, which reconstructs BYO-Ollama runs post-hoc; no LangSmith credentials ever reach the browser. Trace shape: one flat `llm` run per Crisp Run whose LangSmith id *is* the Run's own id (Feedback joins with no mapping table), `thread_id` metadata = Conversation id (Threads view groups a Conversation), `usage_metadata` lifted from `RUN_FINISHED` for automatic cost. Everything is traced — remote, BYO, demo, stopped, and failed runs — because failure rate by model is the most valuable chart, not a billing artifact to exclude. Tracing is gated on `LANGSMITH_API_KEY`; absent, the decorator is never installed.

Trade-offs accepted deliberately: conversations with *local* models leave the machine (metadata and content go to a SaaS), and dashboards live in LangSmith's UI rather than in Crisp. First-party storage (a run ledger + in-app dashboard) was designed and rejected: more code, no stack alignment.

Status: accepted

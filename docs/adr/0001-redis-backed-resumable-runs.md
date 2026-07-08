# Redis Streams as the backing store for resumable Runs

A Run's live event stream is buffered in Redis Streams (behind the `RunStreamStore` port) so a client can reattach mid-generation — refresh the page while the model is answering and the stream resumes. An in-process buffer would deliver the same single-instance demo with zero infrastructure, and was the recommended default; Redis was deliberately chosen anyway to make resumability a first-class, multi-instance-ready concern rather than a demo trick. The accepted cost is a hard setup dependency (Redis via docker-compose), which the README must mitigate with a one-command setup.

Status: accepted

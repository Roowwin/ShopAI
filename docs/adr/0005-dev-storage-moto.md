# ADR 0005 - Dev storage: moto S3 emulation

Status: accepted

- MinIO images are no longer anonymously pullable here (Docker Hub withdrawn, quay login-gated, no ECR mirror) - probes documented in Phase 1 log.
- Dev stack uses motoserver/moto S3 emulation; the app-facing contract stays "S3-compatible API", so backend code and production (real MinIO/S3 on Linux) are unchanged.
- Dev caveats: moto is in-memory (bucket/objects vanish on restart; storage-init re-creates each up); no anonymous-policy emulation needed (unsigned reads allowed in server mode); pre-sign semantics validated for real in Phase 5.
- Dev-only image is :latest deliberately (pinning exception, documented); CI digests everything in Phase 10.
- Reversible: free quay.io account + Set-MinioPinned restores real MinIO in dev.
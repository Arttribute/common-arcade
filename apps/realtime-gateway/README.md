# Realtime gateway

Long-running WebSocket/WebTransport-facing data-plane seam. Phase 0 must measure
latency, fan-out, reconnect, backpressure, and cost before ECS/ALB topology is
committed. The gateway routes authenticated sessions; match workers remain
authoritative.

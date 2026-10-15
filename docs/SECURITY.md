# Security checklist

Each item is ticked only after it has been verified, with a note on how.

- [ ] TLS everywhere: MQTT 8883, HTTPS, WSS. No plaintext 1883 outside the Docker network.
- [ ] EMQX per-device credentials; ACL limits each device to `nabd/v1/+/{deviceId}/#`; least-privilege service accounts.
- [ ] Device secrets hashed in the database and shown once, at provisioning.
- [ ] Every input validated with zod at the edge; parameterised SQL only.
- [ ] Rate limits on auth, commands and webhooks; CSRF protection for cookie mutations; strict CSP.
- [ ] Secrets only from environment variables; `.env.example` shipped, `.env` never; gitleaks in CI.
- [ ] OTA signing private key never in the repo or CI logs.
- [ ] Demo isolation: anonymous users cannot command the real board or change rules.

# EMQX configuration

Phase 1 adds:

- `acl.conf`: a device may publish and subscribe only under `nabd/v1/+/{its own clientid}/#`.
- Built-in database authentication with one account per device (password stored hashed) and separate
  least-privilege service accounts for `ingest`, `api` and `simulator`.
- The TLS listener on 8883 with the certificate from `docs/DEPLOY.md`.

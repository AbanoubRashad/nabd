# The public demo backend (apps/demo, ADR 0008) as a Hugging Face Docker Space: free CPU, no card.
# The Space repo holds only this file and README.md; the build clones this GitHub repo. To pick up new
# commits, use "Factory rebuild" in the Space settings.
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable

WORKDIR /app
ARG REF=main
RUN git clone --depth 1 --branch "$REF" https://github.com/AbanoubRashad/nabd.git .
# devDependencies (TypeScript, Turbo) are needed to build; the root package (`.`) owns Turbo.
RUN NODE_ENV=development pnpm install --frozen-lockfile --filter . --filter "@nabd/demo..." \
  && pnpm turbo run build --filter="@nabd/demo..."

# Spaces run the container as user 1000 and route traffic to port 7860.
ENV NODE_ENV=production PORT=7860 WEB_ORIGIN=https://nabd-iot.vercel.app
EXPOSE 7860
USER 1000
CMD ["node", "apps/demo/dist/main.js"]

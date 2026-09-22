FROM ghcr.io/openclaw/openclaw:2026.9.4@sha256:cc596b846506a5f4cfcee111394a2725f375f01cca2ebb492a161fd1b747f101
ARG PLOW_REVISION
LABEL org.opencontainers.image.revision=$PLOW_REVISION co.plow.probe=/opt/plow/probe
USER root
RUN mkdir -p /opt/plow/skills /var/lib/plow && chown node:node /var/lib/plow
COPY boot /opt/plow/boot
COPY plugin /opt/plow/plugin
COPY prompt /opt/plow/prompt
COPY skills /opt/plow/skills
COPY build.ts /opt/plow/build.ts
COPY package.json package-lock.json tsconfig.json /opt/plow/

# The Agent Index usage reporter, fetched at build from the commit
# vendor/client.pin names and checked against the hash beside it. Fetched
# rather than committed because plow-pbc/agent-index-client owns that file;
# pinned to a sha rather than a branch because this runs inside an agent
# holding a live credential, and a moving reference would substitute unreviewed
# code under it. The checksum is the second half: a sha in a URL is only as
# good as the host serving it.
#
# Root-owned, outside the state volume the agent writes: a copy the agent could
# write is a copy a turn can replace.
COPY --chmod=0644 vendor/client.pin /opt/plow/agent-index-client.pin
RUN set -eu; \
    sha="$(sed -n 's/^sha=//p' /opt/plow/agent-index-client.pin)"; \
    want="$(sed -n 's/^sha256=//p' /opt/plow/agent-index-client.pin)"; \
    path="$(sed -n 's/^path=//p' /opt/plow/agent-index-client.pin)"; \
    curl -fsS --max-time 60 -o /opt/plow/agent-index-client.py \
      "https://raw.githubusercontent.com/plow-pbc/agent-index-client/${sha}/${path}"; \
    got="$(sha256sum /opt/plow/agent-index-client.py | cut -d' ' -f1)"; \
    [ "$got" = "$want" ] || { echo "agent-index client is $got, pin says $want" >&2; exit 1; }; \
    chmod 0644 /opt/plow/agent-index-client.py
RUN cd /opt/plow && npm ci --omit=dev --omit=peer --omit=optional --ignore-scripts && node /opt/plow/build.ts && chmod +x /opt/plow/probe
ENV OPENCLAW_STATE_DIR=/var/lib/plow OPENCLAW_CONFIG_PATH=/var/lib/plow/openclaw.json OPENCLAW_NO_RESPAWN=1 NODE_DISABLE_COMPILE_CACHE=1
# The inherited healthcheck loads config and can race the boot state lock.
HEALTHCHECK NONE
USER node
CMD ["node", "/opt/plow/boot/main.js"]

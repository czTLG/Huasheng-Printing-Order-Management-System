FROM node:22-bookworm-slim

RUN npm install -g @openai/codex @modelzen/feishu-codex-bridge@0.6.9
COPY bridge-patch/patch-stream-card.cjs /tmp/patch-stream-card.cjs
RUN node /tmp/patch-stream-card.cjs "$(npm root -g)/@modelzen/feishu-codex-bridge/dist/cli.js" \
    && rm /tmp/patch-stream-card.cjs

# Docker hosts without an IPv6 egress can still receive AAAA records for
# chatgpt.com. Prefer IPv4 so Codex does not stall on an unreachable route.
RUN printf 'precedence ::ffff:0:0/96  100\n' >> /etc/gai.conf \
    && mkdir -p /refs /workspace/store \
    && chown node:node /refs /workspace /workspace/store

USER node
WORKDIR /workspace

CMD ["feishu-codex-bridge", "run", "--bot", "stream-node"]

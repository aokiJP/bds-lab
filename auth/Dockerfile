# auth/Dockerfile: the sign-in service on your own server (README.md). Build from auth/ alone — nothing else of the lab goes in:
#   docker build -t bds-lab-auth auth/
# It speaks plain HTTP on PORT: put it behind TLS (a reverse proxy) at the root of its own https origin, PUBLIC_URL = that origin.
FROM node:22-alpine
WORKDIR /srv/auth
# (root owns the code, the service only reads it)
COPY handler.mjs node.mjs ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "node.mjs"]

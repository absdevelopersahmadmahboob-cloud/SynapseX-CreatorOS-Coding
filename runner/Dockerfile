FROM node:22-alpine

RUN corepack enable
WORKDIR /runner
COPY server.mjs ./server.mjs

USER node
EXPOSE 8787
CMD ["node", "server.mjs"]

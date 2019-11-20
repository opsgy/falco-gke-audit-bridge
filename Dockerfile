FROM node:10-alpine
WORKDIR /app

ADD ./package.json package-lock.json ./
RUN npm install --save-exact

ADD ./tsconfig.build.json ./tsconfig.json ./tslint.json ./README.md ./
ADD ./src ./src
RUN npm run lint && \
    npm test && \
    npm run build

FROM node:10-alpine
WORKDIR /app
EXPOSE 8080
CMD node index.js
ENV NODE_ENV=production

COPY --from=0 --chown=1001:0 /app/dist .
COPY --from=0 --chown=1001:0 /app/package.json /app/package-lock.json  ./
RUN npm install --save-exact --prod
USER 1001

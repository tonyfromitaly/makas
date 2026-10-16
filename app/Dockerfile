FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY core/package.json core/
COPY api/package.json api/
COPY app/package.json app/
RUN npm ci --workspace app
COPY core core
COPY app app
RUN npm run build -w app

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/app/dist /usr/share/nginx/html

# Build context = thư mục gốc repo
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/common/package.json packages/common/
COPY services/gateway/package.json services/gateway/
COPY services/user-service/package.json services/user-service/
COPY services/video-service/package.json services/video-service/
COPY services/streaming-service/package.json services/streaming-service/
COPY services/comment-service/package.json services/comment-service/
COPY services/payment-service/package.json services/payment-service/
COPY frontend/package.json frontend/
RUN npm ci --workspace=frontend --include-workspace-root=false --no-audit --no-fund
COPY frontend frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace=frontend

FROM nginx:1.29-alpine
# nginx tự thay ${GATEWAY_HOST}, ${NGINX_RESOLVER} trong template khi container khởi động
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
# Đổi khi deploy (vd Kubernetes: NGINX_RESOLVER=kube-dns.kube-system.svc.cluster.local)
ENV GATEWAY_HOST=gateway:8080 NGINX_RESOLVER=127.0.0.11
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80

# Dockerfile dùng chung cho mọi microservice (build context = thư mục gốc repo)
#   docker build -f docker/service.Dockerfile --build-arg SERVICE=user-service .
FROM node:24-alpine

ARG SERVICE
ARG APK_PACKAGES=""
RUN test -n "$SERVICE" || (echo "Thiếu --build-arg SERVICE" && false)
RUN if [ -n "$APK_PACKAGES" ]; then apk add --no-cache $APK_PACKAGES; fi

WORKDIR /app
ENV NODE_ENV=production

# Chỉ copy manifest trước để tận dụng cache layer khi code đổi mà dependency không đổi
COPY package.json package-lock.json ./
COPY packages/common/package.json packages/common/
COPY services/gateway/package.json services/gateway/
COPY services/user-service/package.json services/user-service/
COPY services/video-service/package.json services/video-service/
COPY services/streaming-service/package.json services/streaming-service/
COPY services/comment-service/package.json services/comment-service/
COPY services/payment-service/package.json services/payment-service/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=services/${SERVICE} --include-workspace-root=false --no-audit --no-fund

COPY packages/common packages/common
COPY services/${SERVICE} services/${SERVICE}

ENV SERVICE=${SERVICE}
# Thư mục storage thuộc user "node" để volume được tạo với quyền ghi đúng
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
WORKDIR /app/services/${SERVICE}
CMD ["node", "src/index.js"]

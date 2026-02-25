# Stage 1: Build frontend
FROM node:22-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Go binary
FROM golang:1.25-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/web/dist ./web/dist
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /yt-dlp-ui ./cmd/yt-dlp-ui

# Stage 3: Runtime with yt-dlp
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata python3 py3-pip ffmpeg \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp
RUN adduser -D -g '' appuser \
    && mkdir -p /downloads \
    && chown appuser:appuser /downloads
USER appuser
COPY --from=backend /yt-dlp-ui /yt-dlp-ui
ENV DOWNLOAD_DIR=/downloads PORT=8080
EXPOSE 8080
VOLUME ["/downloads"]
ENTRYPOINT ["/yt-dlp-ui"]

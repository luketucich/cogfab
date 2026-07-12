# Build the web app, build the server, ship one small image that serves both.

FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.26-alpine AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -o /cogfab-server ./cmd/server
RUN mkdir /data

# distroless: no shell, no package manager, runs as a non-root user.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /cogfab-server /cogfab-server
# Give the non-root user a writable /data for bare `docker run`. Production
# and GKE mount persistent storage over this directory.
COPY --from=server --chown=65532:65532 /data /data
COPY --from=web /src/web/dist /web/dist
COPY deploy/monitoring/collector.yaml /etc/cogfab/collector.yaml
ENV WEB_DIR=/web/dist
ENV DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["/cogfab-server"]

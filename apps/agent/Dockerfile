FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /status-agent .

FROM alpine:3.21
RUN adduser -D -H -u 10001 agent
USER agent
COPY --from=build /status-agent /usr/local/bin/status-agent
ENV AGENT_INTERVAL_MS=15000
ENTRYPOINT ["/usr/local/bin/status-agent"]

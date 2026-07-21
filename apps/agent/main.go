package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Config struct {
	APIURL   string
	Token    string
	Hostname string
	Version  string
	Interval time.Duration
}

type Check struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Type           string `json:"type"`
	Target         string `json:"target"`
	IntervalMs     int    `json:"intervalMs"`
	TimeoutMs      int    `json:"timeoutMs"`
	ExpectedStatus *int   `json:"expectedStatus"`
}

type ChecksResponse struct {
	Node   map[string]any `json:"node"`
	Checks []Check        `json:"checks"`
}

type Result struct {
	CheckID   string `json:"checkId"`
	Status    string `json:"status"`
	LatencyMs *int   `json:"latencyMs,omitempty"`
	Message   string `json:"message,omitempty"`
	CheckedAt string `json:"checkedAt"`
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func loadConfig() Config {
	intervalMs, _ := strconv.Atoi(env("AGENT_INTERVAL_MS", "15000"))
	host, _ := os.Hostname()
	return Config{
		APIURL:   strings.TrimRight(env("STATUS_API_URL", "http://localhost:3000"), "/"),
		Token:    env("NODE_TOKEN", ""),
		Hostname: env("AGENT_HOSTNAME", host),
		Version:  "1.1.0",
		Interval: time.Duration(intervalMs) * time.Millisecond,
	}
}

func main() {
	cfg := loadConfig()
	if cfg.Token == "" {
		log.Fatal("NODE_TOKEN is required")
	}

	log.Printf("status-agent %s → %s", cfg.Version, cfg.APIURL)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	lastRun := map[string]time.Time{}
	var mu sync.Mutex

	ticker := time.NewTicker(cfg.Interval)
	defer ticker.Stop()

	runCycle(ctx, cfg, lastRun, &mu)

	for {
		select {
		case <-ctx.Done():
			log.Println("shutting down")
			return
		case <-ticker.C:
			runCycle(ctx, cfg, lastRun, &mu)
		}
	}
}

func runCycle(ctx context.Context, cfg Config, lastRun map[string]time.Time, mu *sync.Mutex) {
	if err := heartbeat(ctx, cfg); err != nil {
		log.Printf("heartbeat error: %v", err)
	}

	checks, err := fetchChecks(ctx, cfg)
	if err != nil {
		log.Printf("fetch checks error: %v", err)
		return
	}
	if len(checks) == 0 {
		log.Println("no checks assigned")
		return
	}

	due := make([]Check, 0, len(checks))
	now := time.Now()
	mu.Lock()
	for _, c := range checks {
		interval := time.Duration(c.IntervalMs) * time.Millisecond
		if interval <= 0 {
			interval = 60 * time.Second
		}
		prev, ok := lastRun[c.ID]
		if !ok || now.Sub(prev) >= interval {
			due = append(due, c)
		}
	}
	mu.Unlock()

	if len(due) == 0 {
		return
	}

	results := make([]Result, 0, len(due))
	var resMu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for _, c := range due {
		wg.Add(1)
		sem <- struct{}{}
		go func(check Check) {
			defer wg.Done()
			defer func() { <-sem }()
			r := probe(check)
			resMu.Lock()
			results = append(results, r)
			resMu.Unlock()
			mu.Lock()
			lastRun[check.ID] = time.Now()
			mu.Unlock()
		}(c)
	}
	wg.Wait()

	if err := pushResults(ctx, cfg, results); err != nil {
		log.Printf("push results error: %v", err)
		return
	}
	log.Printf("pushed %d/%d results", len(results), len(checks))
}

func apiRequest(ctx context.Context, cfg Config, method, path string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, cfg.APIURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "status-agent/"+cfg.Version)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
	}
	return data, nil
}

func heartbeat(ctx context.Context, cfg Config) error {
	_, err := apiRequest(ctx, cfg, http.MethodPost, "/v1/agent/heartbeat", map[string]any{
		"hostname": cfg.Hostname,
		"version":  cfg.Version,
	})
	return err
}

func fetchChecks(ctx context.Context, cfg Config) ([]Check, error) {
	data, err := apiRequest(ctx, cfg, http.MethodGet, "/v1/agent/checks", nil)
	if err != nil {
		return nil, err
	}
	var out ChecksResponse
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, err
	}
	return out.Checks, nil
}

func pushResults(ctx context.Context, cfg Config, results []Result) error {
	_, err := apiRequest(ctx, cfg, http.MethodPost, "/v1/agent/results", map[string]any{
		"results": results,
	})
	return err
}

func probe(check Check) Result {
	timeout := time.Duration(check.TimeoutMs) * time.Millisecond
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	start := time.Now()
	checkedAt := start.UTC().Format(time.RFC3339)

	var status, message string
	switch strings.ToLower(check.Type) {
	case "tcp":
		status, message = probeTCP(check.Target, timeout)
	case "icmp":
		status, message = "degraded", "icmp requires privileges; use tcp/http"
	default:
		status, message = probeHTTP(check, timeout)
	}

	latency := int(time.Since(start).Milliseconds())
	return Result{
		CheckID:   check.ID,
		Status:    status,
		LatencyMs: &latency,
		Message:   message,
		CheckedAt: checkedAt,
	}
}

func probeHTTP(check Check, timeout time.Duration) (string, string) {
	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
	req, err := http.NewRequest(http.MethodGet, check.Target, nil)
	if err != nil {
		return "down", err.Error()
	}
	resp, err := client.Do(req)
	if err != nil {
		return "down", err.Error()
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))

	if check.ExpectedStatus != nil {
		if resp.StatusCode == *check.ExpectedStatus {
			return "up", fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		if resp.StatusCode >= 500 {
			return "down", fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return "degraded", fmt.Sprintf("HTTP %d (expected %d)", resp.StatusCode, *check.ExpectedStatus)
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 400 {
		return "up", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	if resp.StatusCode >= 500 {
		return "down", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return "degraded", fmt.Sprintf("HTTP %d", resp.StatusCode)
}

func probeTCP(target string, timeout time.Duration) (string, string) {
	d := net.Dialer{Timeout: timeout}
	conn, err := d.Dial("tcp", target)
	if err != nil {
		return "down", err.Error()
	}
	_ = conn.Close()
	return "up", "tcp ok"
}

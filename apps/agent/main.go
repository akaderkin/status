package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
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

type CheckConfig struct {
	Method              string            `json:"method"`
	Headers             map[string]string `json:"headers"`
	Body                string            `json:"body"`
	Keyword             string            `json:"keyword"`
	KeywordInvert       bool              `json:"keywordInvert"`
	AcceptedStatusCodes []int             `json:"acceptedStatusCodes"`
	IgnoreTLS           bool              `json:"ignoreTls"`
	MaxRedirects        *int              `json:"maxRedirects"`
	Retries             *int              `json:"retries"`
}

type Check struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Type           string       `json:"type"`
	Target         string       `json:"target"`
	IntervalMs     int          `json:"intervalMs"`
	TimeoutMs      int          `json:"timeoutMs"`
	ExpectedStatus *int         `json:"expectedStatus"`
	Config         *CheckConfig `json:"config"`
}

type ChecksResponse struct {
	Node   map[string]any `json:"node"`
	Checks []Check        `json:"checks"`
}

type Result struct {
	CheckID      string  `json:"checkId"`
	Status       string  `json:"status"`
	LatencyMs    *int    `json:"latencyMs,omitempty"`
	Message      string  `json:"message,omitempty"`
	CheckedAt    string  `json:"checkedAt"`
	SSLExpiresAt *string `json:"sslExpiresAt,omitempty"`
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
		Version:  "1.2.1",
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
	retries := 0
	if check.Config != nil && check.Config.Retries != nil {
		retries = *check.Config.Retries
	}

	start := time.Now()
	checkedAt := start.UTC().Format(time.RFC3339)

	var status, message string
	var sslExpires *string

	for attempt := 0; attempt <= retries; attempt++ {
		switch strings.ToLower(check.Type) {
		case "tcp":
			status, message = probeTCP(check.Target, timeout)
		case "icmp":
			status, message = probeICMP(check.Target, timeout)
		default:
			status, message, sslExpires = probeHTTP(check, timeout)
		}
		if status == "up" || attempt == retries {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	latency := int(time.Since(start).Milliseconds())
	return Result{
		CheckID:      check.ID,
		Status:       status,
		LatencyMs:    &latency,
		Message:      message,
		CheckedAt:    checkedAt,
		SSLExpiresAt: sslExpires,
	}
}

func probeHTTP(check Check, timeout time.Duration) (string, string, *string) {
	cfg := check.Config
	method := http.MethodGet
	maxRedirects := 5
	ignoreTLS := false
	var bodyReader io.Reader
	headers := map[string]string{}

	if cfg != nil {
		if cfg.Method != "" {
			method = strings.ToUpper(cfg.Method)
		}
		if cfg.MaxRedirects != nil {
			maxRedirects = *cfg.MaxRedirects
		}
		ignoreTLS = cfg.IgnoreTLS
		if cfg.Body != "" {
			bodyReader = strings.NewReader(cfg.Body)
		}
		headers = cfg.Headers
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: ignoreTLS}

	client := &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxRedirects {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	req, err := http.NewRequest(method, check.Target, bodyReader)
	if err != nil {
		return "down", err.Error(), nil
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "status-agent/1.2.1")
	}

	resp, err := client.Do(req)
	if err != nil {
		return "down", err.Error(), nil
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 512*1024))
	bodyStr := string(bodyBytes)

	var sslExpires *string
	if resp.TLS != nil && len(resp.TLS.PeerCertificates) > 0 {
		exp := resp.TLS.PeerCertificates[0].NotAfter.UTC().Format(time.RFC3339)
		sslExpires = &exp
		if time.Until(resp.TLS.PeerCertificates[0].NotAfter) < 14*24*time.Hour {
			// near expiry → may degrade after keyword/status checks
		}
	}

	accepted := map[int]bool{}
	if check.ExpectedStatus != nil {
		accepted[*check.ExpectedStatus] = true
	}
	if cfg != nil {
		for _, code := range cfg.AcceptedStatusCodes {
			accepted[code] = true
		}
	}

	statusOK := false
	msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
	if len(accepted) > 0 {
		statusOK = accepted[resp.StatusCode]
		if !statusOK {
			msg = fmt.Sprintf("HTTP %d (unexpected)", resp.StatusCode)
		}
	} else {
		statusOK = resp.StatusCode >= 200 && resp.StatusCode < 400
	}

	if cfg != nil && cfg.Keyword != "" {
		found := strings.Contains(bodyStr, cfg.Keyword)
		if cfg.KeywordInvert {
			found = !found
		}
		if !found {
			if resp.StatusCode >= 500 {
				return "down", msg + "; keyword mismatch", sslExpires
			}
			return "down", msg + "; keyword mismatch", sslExpires
		}
	}

	if !statusOK {
		if resp.StatusCode >= 500 {
			return "down", msg, sslExpires
		}
		return "degraded", msg, sslExpires
	}

	if sslExpires != nil {
		if t, err := time.Parse(time.RFC3339, *sslExpires); err == nil {
			if time.Until(t) < 14*24*time.Hour {
				return "degraded", msg + "; SSL expires soon", sslExpires
			}
		}
	}

	return "up", msg, sslExpires
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

func probeICMP(target string, timeout time.Duration) (string, string) {
	host := target
	if h, _, err := net.SplitHostPort(target); err == nil {
		host = h
	}
	host = strings.TrimPrefix(strings.TrimPrefix(host, "http://"), "https://")
	host = strings.Split(host, "/")[0]
	host = strings.TrimSpace(host)
	if host == "" {
		return "down", "empty icmp target"
	}

	secs := int(timeout.Seconds())
	if secs < 1 {
		secs = 1
	}
	if secs > 30 {
		secs = 30
	}
	ms := int(timeout.Milliseconds())
	if ms < 500 {
		ms = 500
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout+2*time.Second)
	defer cancel()

	// Try common ping flag variants (Linux / BusyBox / macOS)
	attempts := [][]string{
		{"-c", "1", "-W", strconv.Itoa(secs), host},       // Linux: -W seconds
		{"-c", "1", "-w", strconv.Itoa(secs), host},       // BusyBox / some Linux
		{"-c", "1", "-W", strconv.Itoa(ms), host},         // macOS: -W milliseconds
		{"-c", "1", host},
	}

	var lastOut []byte
	var lastErr error
	for _, args := range attempts {
		cmd := exec.CommandContext(ctx, "ping", args...)
		out, err := cmd.CombinedOutput()
		lastOut, lastErr = out, err
		if err == nil {
			rtt := parsePingRTT(string(out))
			msg := "icmp ok"
			if rtt != "" {
				msg = "icmp ok · " + rtt
			}
			return "up", msg
		}
		// Permission / missing binary → don't keep trying useless variants forever
		low := strings.ToLower(string(out) + " " + err.Error())
		if strings.Contains(low, "permission denied") || strings.Contains(low, "operation not permitted") {
			return "down", "icmp permission denied (agent needs root or CAP_NET_RAW)"
		}
		if strings.Contains(low, "executable file not found") {
			return "down", "ping binary not found on node"
		}
	}

	msg := strings.TrimSpace(string(lastOut))
	if msg == "" && lastErr != nil {
		msg = lastErr.Error()
	}
	if len(msg) > 240 {
		msg = msg[:240]
	}
	return "down", msg
}

func parsePingRTT(out string) string {
	// Linux: time=12.3 ms  | macOS: time=12.345 ms
	for _, line := range strings.Split(out, "\n") {
		if !strings.Contains(line, "time=") {
			continue
		}
		idx := strings.Index(line, "time=")
		rest := line[idx+5:]
		end := 0
		for end < len(rest) && (rest[end] == '.' || (rest[end] >= '0' && rest[end] <= '9')) {
			end++
		}
		if end == 0 {
			continue
		}
		unit := "ms"
		tail := strings.TrimSpace(rest[end:])
		if strings.HasPrefix(tail, "ms") {
			unit = "ms"
		}
		return rest[:end] + unit
	}
	return ""
}

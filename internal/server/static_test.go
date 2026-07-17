package server

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStaticHandlerServesCompressedImmutableAssets(t *testing.T) {
	root, assetPath, asset := staticFixture(t)
	handler := NewStaticHandler(root)
	req := httptest.NewRequest(http.MethodGet, "/assets/app-ABC123.js", nil)
	req.Header.Add("Accept-Encoding", "br")
	req.Header.Add("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Encoding"); got != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", got)
	}
	if got := response.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Errorf("Vary = %q, want Accept-Encoding", got)
	}
	if got := response.Header().Get("Cache-Control"); got != immutableCache {
		t.Errorf("Cache-Control = %q, want %q", got, immutableCache)
	}
	if got := response.Header().Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Errorf("Content-Type = %q, want JavaScript", got)
	}

	reader, err := gzip.NewReader(bytes.NewReader(response.Body.Bytes()))
	if err != nil {
		t.Fatalf("read compressed %s: %v", assetPath, err)
	}
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatalf("decompress %s: %v", assetPath, err)
	}
	if err := reader.Close(); err != nil {
		t.Fatalf("close gzip reader: %v", err)
	}
	if !bytes.Equal(decoded, asset) {
		t.Errorf("decoded asset = %q, want %q", decoded, asset)
	}
}

func TestStaticHandlerServesRawAssetWhenGzipIsDisabled(t *testing.T) {
	root, _, asset := staticFixture(t)
	handler := NewStaticHandler(root)
	req := httptest.NewRequest(http.MethodGet, "/assets/app-ABC123.js", nil)
	req.Header.Set("Accept-Encoding", "gzip;q=0, br")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want empty", got)
	}
	if got := response.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Errorf("Vary = %q, want Accept-Encoding", got)
	}
	if got := response.Header().Get("Cache-Control"); got != immutableCache {
		t.Errorf("Cache-Control = %q, want %q", got, immutableCache)
	}
	if !bytes.Equal(response.Body.Bytes(), asset) {
		t.Errorf("asset = %q, want %q", response.Body.Bytes(), asset)
	}
}

func TestStaticHandlerServesRawAssetForRangeRequests(t *testing.T) {
	root, _, asset := staticFixture(t)
	handler := NewStaticHandler(root)
	req := httptest.NewRequest(http.MethodGet, "/assets/app-ABC123.js", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("Range", "bytes=0-6")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusPartialContent)
	}
	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want empty", got)
	}
	if !bytes.Equal(response.Body.Bytes(), asset[:7]) {
		t.Errorf("asset range = %q, want %q", response.Body.Bytes(), asset[:7])
	}
}

func TestStaticHandlerServesAssetWithoutCompressedCompanion(t *testing.T) {
	root, assetPath, asset := staticFixture(t)
	if err := os.Remove(assetPath + ".gz"); err != nil {
		t.Fatalf("remove compressed asset: %v", err)
	}
	handler := NewStaticHandler(root)
	req := httptest.NewRequest(http.MethodGet, "/assets/app-ABC123.js", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q, want empty", got)
	}
	if got := response.Header().Get("Vary"); got != "" {
		t.Errorf("Vary = %q, want empty", got)
	}
	if got := response.Header().Get("Cache-Control"); got != immutableCache {
		t.Errorf("Cache-Control = %q, want %q", got, immutableCache)
	}
	if !bytes.Equal(response.Body.Bytes(), asset) {
		t.Errorf("asset = %q, want %q", response.Body.Bytes(), asset)
	}
}

func TestStaticHandlerPreservesHeadResponses(t *testing.T) {
	root, _, _ := staticFixture(t)
	handler := NewStaticHandler(root)
	req := httptest.NewRequest(http.MethodHead, "/assets/app-ABC123.js", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, req)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusOK)
	}
	if got := response.Header().Get("Content-Encoding"); got != "gzip" {
		t.Errorf("Content-Encoding = %q, want gzip", got)
	}
	if response.Body.Len() != 0 {
		t.Errorf("HEAD response body has %d bytes, want 0", response.Body.Len())
	}
}

func TestStaticHandlerRevalidatesEntryPointAndMissingAssets(t *testing.T) {
	root, _, _ := staticFixture(t)
	handler := NewStaticHandler(root)

	for _, test := range []struct {
		name       string
		path       string
		wantStatus int
	}{
		{name: "entry point", path: "/", wantStatus: http.StatusOK},
		{name: "missing asset", path: "/assets/missing.js", wantStatus: http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if got := response.Header().Get("Cache-Control"); got != revalidateCache {
				t.Errorf("Cache-Control = %q, want %q", got, revalidateCache)
			}
		})
	}
}

func TestStaticHandlerSupportsEntryPointRevalidation(t *testing.T) {
	root, _, _ := staticFixture(t)
	handler := NewStaticHandler(root)
	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/", nil))
	lastModified := first.Header().Get("Last-Modified")
	if lastModified == "" {
		t.Fatal("entry point response has no Last-Modified header")
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("If-Modified-Since", lastModified)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)

	if response.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusNotModified)
	}
	if got := response.Header().Get("Cache-Control"); got != revalidateCache {
		t.Errorf("Cache-Control = %q, want %q", got, revalidateCache)
	}
}

func TestAcceptsGzip(t *testing.T) {
	for _, test := range []struct {
		header string
		want   bool
	}{
		{header: "gzip", want: true},
		{header: "br, gzip;q=0.5", want: true},
		{header: "br, *;q=1", want: true},
		{header: "*;q=1, gzip;q=0", want: false},
		{header: "gzip;q=0", want: false},
		{header: "gzip;q=invalid", want: false},
		{header: "br", want: false},
		{header: "", want: false},
	} {
		t.Run(test.header, func(t *testing.T) {
			if got := acceptsGzip(test.header); got != test.want {
				t.Errorf("acceptsGzip(%q) = %t, want %t", test.header, got, test.want)
			}
		})
	}
}

func staticFixture(t *testing.T) (root string, assetPath string, asset []byte) {
	t.Helper()
	root = t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("<title>Cogfab</title>"), 0o600); err != nil {
		t.Fatalf("write index: %v", err)
	}
	assetsDir := filepath.Join(root, "assets")
	if err := os.Mkdir(assetsDir, 0o700); err != nil {
		t.Fatalf("create assets directory: %v", err)
	}
	assetPath = filepath.Join(assetsDir, "app-ABC123.js")
	asset = []byte("console.log('cogfab');")
	if err := os.WriteFile(assetPath, asset, 0o600); err != nil {
		t.Fatalf("write asset: %v", err)
	}

	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(asset); err != nil {
		t.Fatalf("compress asset: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close gzip writer: %v", err)
	}
	if err := os.WriteFile(assetPath+".gz", compressed.Bytes(), 0o600); err != nil {
		t.Fatalf("write compressed asset: %v", err)
	}
	return root, assetPath, asset
}

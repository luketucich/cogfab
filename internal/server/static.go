package server

import (
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	revalidateCache = "no-cache"
	immutableCache  = "public, max-age=31536000, immutable"
)

// NewStaticHandler serves the built web client with compression and caching
// suited to Vite's fingerprinted assets.
func NewStaticHandler(root string) http.Handler {
	files := http.FileServer(http.Dir(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", revalidateCache)

		assetPath, ok := requestedAssetPath(root, r.URL.Path)
		if !ok || (r.Method != http.MethodGet && r.Method != http.MethodHead) {
			files.ServeHTTP(w, r)
			return
		}
		if !regularFile(assetPath) {
			writeStaticNotFound(w, r)
			return
		}

		w.Header().Set("Cache-Control", immutableCache)
		compressedPath := assetPath + ".gz"
		if !regularFile(compressedPath) {
			files.ServeHTTP(w, r)
			return
		}

		w.Header().Add("Vary", "Accept-Encoding")
		acceptedEncodings := strings.Join(r.Header.Values("Accept-Encoding"), ",")
		if r.Header.Get("Range") != "" || !acceptsGzip(acceptedEncodings) {
			files.ServeHTTP(w, r)
			return
		}

		if contentType := mime.TypeByExtension(filepath.Ext(assetPath)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("Content-Encoding", "gzip")
		http.ServeFile(w, r, compressedPath)
	})
}

func requestedAssetPath(root, requestPath string) (string, bool) {
	cleanPath := path.Clean("/" + requestPath)
	if !strings.HasPrefix(cleanPath, "/assets/") {
		return "", false
	}

	assetPath := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(cleanPath, "/")))
	return assetPath, true
}

func regularFile(name string) bool {
	info, err := os.Stat(name)
	return err == nil && info.Mode().IsRegular()
}

func writeStaticNotFound(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusNotFound)
	if r.Method != http.MethodHead {
		_, _ = io.WriteString(w, "404 page not found\n")
	}
}

func acceptsGzip(header string) bool {
	wildcardAccepted := false
	for _, value := range strings.Split(header, ",") {
		parts := strings.Split(value, ";")
		encoding := strings.ToLower(strings.TrimSpace(parts[0]))
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, raw, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if !found || !strings.EqualFold(strings.TrimSpace(key), "q") {
				continue
			}
			parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
			if err != nil {
				quality = 0
			} else {
				quality = parsed
			}
		}

		switch encoding {
		case "gzip":
			return quality > 0
		case "*":
			wildcardAccepted = quality > 0
		}
	}
	return wildcardAccepted
}

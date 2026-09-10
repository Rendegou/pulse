package main

import (
	"io/fs"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestFrontendAssets 覆盖 Go 实际内嵌入口与缓存边界；无构建时验证明确 503，而非空白页。
// CI 必须先 npm run build，才会同时触达首页、哈希资源与未知地址分支。
func TestFrontendAssets(t *testing.T) {
	handler := frontendHandler()
	root := httptest.NewRecorder()
	handler.ServeHTTP(root, httptest.NewRequest("GET", "/", nil))
	if _, err := fs.Stat(staticFS, "static/dist/index.html"); err != nil {
		if root.Code != 503 || !strings.Contains(root.Body.String(), "npm ci") {
			t.Fatalf("missing-build response: %d %s", root.Code, root.Body.String())
		}
		return
	}
	if root.Code != 200 || !strings.Contains(root.Body.String(), `id="app"`) || root.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("invalid application entry: %d", root.Code)
	}
	files, err := fs.Glob(staticFS, "static/dist/assets/*.js")
	if err != nil || len(files) == 0 {
		t.Fatal("built entry has no JS bundle")
	}
	asset := httptest.NewRecorder()
	handler.ServeHTTP(asset, httptest.NewRequest("GET", strings.TrimPrefix(files[0], "static/dist"), nil))
	if asset.Code != 200 || !strings.Contains(asset.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset cache boundary: %d", asset.Code)
	}
	for _, path := range []string{"/assets/missing.js", "/api/missing", "/unknown"} {
		missing := httptest.NewRecorder()
		handler.ServeHTTP(missing, httptest.NewRequest("GET", path, nil))
		if missing.Code != 404 || strings.Contains(missing.Header().Get("Cache-Control"), "immutable") {
			t.Errorf("%s must be uncached 404: %d", path, missing.Code)
		}
	}
}

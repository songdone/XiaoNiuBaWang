package httpapi

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"

	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/store"
)

func apiQueryFixture(n int) []store.Game {
	games := make([]store.Game, n)
	for i := range games {
		games[i] = store.Game{ID: fmt.Sprintf("api-query-%03d", i+1), Title: fmt.Sprintf("Title %03d", n-i),
			Filename: fmt.Sprintf("game-%03d.nes", i+1), SHA256: fmt.Sprintf("%064x", i+1),
			Size: 16400, Format: "iNES", BlobKey: fmt.Sprintf("rom-%032x", i+1),
			CreatedAt: time.Date(2026, 11, 1, 0, 0, i, 0, time.UTC).Format(time.RFC3339Nano)}
	}
	return games
}

func TestPaginatedLibraryHTTPAndLegacy(t *testing.T) {
	var cfg Config
	a := startAPI(t, filepath.Join(t.TempDir(), "data"), fnos.Local, marker, func(c *Config) {
		cfg = *c
		if _, err := c.Store.CommitGames(t.Context(), fnos.User("dev-"+sum([]byte(marker))), apiQueryFixture(135)); err != nil {
			t.Fatal(err)
		}
	})
	auth := []string{fnos.DevUserHeader, marker}
	user := fnos.User("dev-" + sum([]byte(marker)))
	for _, path := range []string{"/api/library", "/api/games"} {
		for _, tc := range []struct {
			query                   string
			page, size, pages, rows int
			start, end              int
		}{
			{"paginated=1", 1, 20, 7, 20, 1, 20},
			{"paginated=1&page=7&pageSize=20&view=all&category=all&sort=added&search=", 7, 20, 7, 15, 121, 135},
			{"paginated=1&page=999&pageSize=20", 7, 20, 7, 15, 121, 135},
			{"paginated=1&page=3&pageSize=50", 3, 50, 3, 35, 101, 135},
			{"paginated=1&page=2&pageSize=100", 2, 100, 2, 35, 101, 135},
			{"paginated=1&pageSize=500", 1, 500, 1, 135, 1, 135},
			{"paginated=1&pageSize=37&page=4", 4, 37, 4, 24, 112, 135},
			{"paginated=1&pageSize=1&page=135", 135, 1, 135, 1, 135, 135},
			{"paginated=1&page=9223372036854775807", 7, 20, 7, 15, 121, 135},
		} {
			r := a.request("GET", path+"?"+tc.query, nil, auth...)
			expect(t, r, 200)
			p := decode[store.GamePage](t, r)
			if p.Total != 135 || p.Page != tc.page || p.PageSize != tc.size || p.TotalPages != tc.pages || p.RangeStart != tc.start || p.RangeEnd != tc.end || len(p.Games) != tc.rows || p.Stats != (store.GameStats{Total: 135}) {
				t.Fatalf("%s?%s: %+v", path, tc.query, p)
			}
			fields := decode[map[string]json.RawMessage](t, r)
			if len(fields) != 8 {
				t.Fatalf("unexpected response key count: %d", len(fields))
			}
			for _, g := range p.Games {
				if g.BlobKey != "" {
					t.Fatal("pagination exposed blob keys")
				}
			}
		}
		for _, query := range []string{"", "?page=1&pageSize=1&search=nothing", "?unknown=ignored", "?page=0&page=2"} {
			r := a.request("GET", path+query, nil, auth...)
			expect(t, r, 200)
			p := decode[store.GamePage](t, r)
			fields := decode[map[string]json.RawMessage](t, r)
			if len(p.Games) != 135 || p.Page != 0 {
				t.Fatal("legacy full list was paginated")
			}
			if path == "/api/library" && (len(fields) != 2 || p.Stats.Total != 135) || path == "/api/games" && len(fields) != 1 {
				t.Fatalf("legacy shape changed %s: %v", path, fields)
			}
		}
		r := a.request("HEAD", path+"?paginated=1", nil, auth...)
		expect(t, r, 200)
		if len(r.body) != 0 {
			t.Fatal("HEAD body must be empty")
		}
	}
	full, err := cfg.Library.List(t.Context(), user)
	if err != nil || len(full) != 135 {
		t.Fatalf("service legacy list: %d %v", len(full), err)
	}
	delegated, err := cfg.Library.Query(t.Context(), user, store.GameQuery{Page: 7})
	if err != nil || delegated.RangeStart != 121 || delegated.RangeEnd != 135 {
		t.Fatalf("service Query delegate: %+v %v", delegated, err)
	}
	if _, err := cfg.Store.DeleteGame(t.Context(), user, "api-query-001"); err != nil {
		t.Fatal(err)
	}
	r := a.request("GET", "/api/library?paginated=1&page=7", nil, auth...)
	expect(t, r, 200)
	p := decode[store.GamePage](t, r)
	if p.Total != 134 || p.RangeEnd != 134 || len(p.Games) != 14 {
		t.Fatalf("delete tail refresh: %+v", p)
	}
}

func TestPaginatedLibraryRejectsInvalidQueriesAfterAuthentication(t *testing.T) {
	a := startAPI(t, filepath.Join(t.TempDir(), "data"), fnos.Local, marker, nil)
	queries := []string{
		"paginated=", "paginated=0", "paginated=true", "paginated=01", "paginated=1&paginated=1",
		"paginated=1&unknown=x", "paginated=1&Page=1", "paginated=1&page=1&page=2",
		"paginated=1&pageSize=20&pageSize=20", "paginated=1&view=all&view=all",
		"paginated=1&category=all&category=game", "paginated=1&sort=added&sort=title",
		"paginated=1&search=a&search=b", "paginated=1&%70age=1&page=1",
		"paginated=1&search=%ZZ", "paginated=1&search=a;b", "paginated=1&page=1&broken=%",
		"paginated=%ZZ", "%70aginated=%ZZ", "paginated=1;bad=x",
	}
	for _, field := range []string{"page", "pageSize"} {
		for _, value := range []string{"", "0", "-1", "+1", "1.0", "1e2", " 1", "1 ", "NaN", "Inf", "９", "99999999999999999999999999999999"} {
			queries = append(queries, "paginated=1&"+field+"="+url.QueryEscape(value))
		}
	}
	for _, pair := range []string{"pageSize=501", "pageSize=all", "view=", "view=ALL", "view=bad", "category=", "category=bad", "sort=", "sort=bad", "sort=g.id%3BDROP%20TABLE%20games"} {
		queries = append(queries, "paginated=1&"+pair)
	}
	for i, query := range queries {
		t.Run(strconv.Itoa(i)+"-"+query, func(t *testing.T) {
			for _, path := range []string{"/api/library", "/api/games"} {
				expect(t, a.request("GET", path+"?"+query, nil, fnos.DevUserHeader, marker), 400)
				expect(t, a.request("GET", path+"?"+query, nil), 401)
			}
		})
	}
	for _, path := range []string{"/api/library", "/api/games"} {
		expect(t, a.request("GET", path+"?paginated=1", nil, fnos.DevUserHeader, "wrong"), 401)
		expect(t, a.request("GET", path+"?paginated=1", nil, fnos.DevUserHeader, marker, fnos.DevUserHeader, marker), 401)
		expect(t, a.request("GET", path+"?paginated=1", nil, fnos.DevUserHeader, marker, "Origin", "https://malicious.test"), 403)
	}
}

func TestPaginatedLibraryHTTPEmptyAndSmallBoundaries(t *testing.T) {
	for _, n := range []int{0, 1, 20, 21} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			a := startAPI(t, filepath.Join(t.TempDir(), "data"), fnos.Local, marker, func(c *Config) {
				if _, err := c.Store.CommitGames(t.Context(), fnos.User("dev-"+sum([]byte(marker))), apiQueryFixture(n)); err != nil {
					t.Fatal(err)
				}
			})
			r := a.request("GET", "/api/library?paginated=1&page=99", nil, fnos.DevUserHeader, marker)
			expect(t, r, 200)
			p := decode[store.GamePage](t, r)
			pages, start, end, rows := 1, 1, n, n
			if n == 0 {
				start = 0
			} else if n > 20 {
				pages, start, rows = 2, 21, 1
			}
			if p.Total != n || p.TotalPages != pages || p.Page != pages || p.RangeStart != start || p.RangeEnd != end || len(p.Games) != rows || p.Games == nil || p.Stats.Total != n {
				t.Fatalf("n=%d: %+v", n, p)
			}
		})
	}
}

func TestPaginatedLibraryGatewayIsolationFiltersAndCoverURLs(t *testing.T) {
	var st *store.Store
	games := apiQueryFixture(135)
	games[120].Title = "ÄRCade 100%_title"
	games[121].OriginalTitle = "äOriginal"
	games[122].Tags = []string{"äToken", "quote\"slash\\", "left", "right"}
	games[123].Description = "DescriptionOnly"
	games[120].CoverURL = "/bundled/covers/ä cover.webp"
	for i := range games {
		games[i].ID = fmt.Sprintf("bundled-query-%03d", i+1)
		if i < 15 {
			games[i].Category = "learning"
		}
	}
	a := startAPI(t, filepath.Join(t.TempDir(), "data"), fnos.Gateway, "", func(c *Config) {
		st = c.Store
		if err := st.SyncBundled(t.Context(), games); err != nil {
			t.Fatal(err)
		}
		for _, user := range []fnos.User{"uid-1001", "uid-1002"} {
			own := apiQueryFixture(1)
			own[0].ID = "imported-" + string(user)
			if _, err := st.CommitGames(t.Context(), user, own); err != nil {
				t.Fatal(err)
			}
		}
		for _, id := range []string{games[120].ID, "imported-uid-1001"} {
			if _, err := st.Favorite(t.Context(), "uid-1001", id, true); err != nil {
				t.Fatal(err)
			}
			if err := st.RestoreActivity(t.Context(), "uid-1001", id, "2026-11-22T12:00:00Z", 1); err != nil {
				t.Fatal(err)
			}
		}
	})
	pre := fnos.GatewayPrefix
	for _, uid := range []string{"1001", "1002", "1003"} {
		r := a.request("GET", pre+"/api/library?paginated=1&pageSize=500", nil, fnos.GatewayUIDHeader, uid)
		expect(t, r, 200)
		p := decode[store.GamePage](t, r)
		want := 136
		if uid == "1003" {
			want = 135
		}
		if p.Total != want || len(p.Games) != want || p.Stats.Total != want {
			t.Fatalf("gateway uid=%s: %+v", uid, p)
		}
		if uid != "1001" && (p.Stats.Favorites != 0 || p.Stats.Recent != 0) {
			t.Fatal("gateway activity crossed users")
		}
		for _, g := range p.Games {
			if g.Source == "imported" && g.ID != "imported-uid-"+uid {
				t.Fatal("gateway imported row crossed users")
			}
		}
	}
	stats := store.GameStats{Total: 136, Favorites: 2, Recent: 2}
	for _, tc := range []struct {
		query string
		total int
	}{
		{"category=learning", 15}, {"category=game", 121}, {"view=favorites", 2},
		{"view=recent&sort=title", 2}, {"view=favorites&category=learning", 0},
		{"search=" + url.QueryEscape("ärcade"), 1}, {"search=" + url.QueryEscape("ÄORIGINAL"), 1},
		{"search=" + url.QueryEscape("ÄTOKEN"), 1}, {"search=" + url.QueryEscape("%_"), 1},
		{"search=" + url.QueryEscape("left,right"), 0}, {"search=DescriptionOnly", 0},
	} {
		r := a.request("GET", pre+"/api/library?paginated=1&page=99&pageSize=1&"+tc.query, nil, fnos.GatewayUIDHeader, "1001")
		expect(t, r, 200)
		p := decode[store.GamePage](t, r)
		if p.Total != tc.total || p.Stats != stats || len(p.Games) > 1 {
			t.Fatalf("query=%s: %+v", tc.query, p)
		}
		if tc.query == "search="+url.QueryEscape("ärcade") && p.Games[0].CoverURL != pre+"/bundled/covers/%C3%A4%20cover.webp" {
			t.Fatalf("cover URL not passed through gameView: %s", p.Games[0].CoverURL)
		}
	}
	if err := st.SyncBundled(t.Context(), games[:19]); err != nil {
		t.Fatal(err)
	}
	r := a.request("GET", pre+"/api/library?paginated=1&page=7", nil, fnos.GatewayUIDHeader, "1001")
	expect(t, r, 200)
	p := decode[store.GamePage](t, r)
	if p.Total != 20 || p.Page != 1 || p.RangeStart != 1 || p.RangeEnd != 20 || !reflect.DeepEqual(p.Stats, store.GameStats{Total: 20, Favorites: 1, Recent: 1}) {
		t.Fatalf("removed catalog clamp/globals: %+v", p)
	}
	expect(t, a.request("GET", pre+"/api/library?paginated=1", nil), 401)
}

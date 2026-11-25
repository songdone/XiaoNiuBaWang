package store

import (
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"

	"xiaoniubawang/internal/fnos"
)

const queryUser fnos.User = "uid-1001"

func queryStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(t.Context(), filepath.Join(t.TempDir(), "data"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func queryFixture(n int) []Game {
	games := make([]Game, n)
	for i := range games {
		games[i] = Game{ID: fmt.Sprintf("query-%03d", i+1), Title: fmt.Sprintf("Title %03d", n-i),
			Filename: fmt.Sprintf("game-%03d.nes", i+1), SHA256: fmt.Sprintf("%064x", i+1),
			Size: 16400, Mapper: 0, Format: "iNES", BlobKey: fmt.Sprintf("rom-%032x", i+1),
			CreatedAt: time.Date(2026, 11, 1, 0, 0, i, 0, time.UTC).Format(timestampLayout)}
	}
	return games
}

func commitQueryFixture(t *testing.T, s *Store, user fnos.User, games []Game) {
	t.Helper()
	if _, err := s.CommitGames(t.Context(), user, games); err != nil {
		t.Fatal(err)
	}
}

func mustQuery(t *testing.T, s *Store, user fnos.User, q GameQuery) GamePage {
	t.Helper()
	page, err := s.QueryGames(t.Context(), user, q)
	if err != nil {
		t.Fatal(err)
	}
	return page
}

func queryIDs(games []Game) []string {
	ids := make([]string, len(games))
	for i, g := range games {
		ids[i] = g.ID
	}
	return ids
}

func TestQueryGamesBoundaries(t *testing.T) {
	for _, n := range []int{0, 1, 20, 21, 135} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			s := queryStore(t)
			commitQueryFixture(t, s, queryUser, queryFixture(n))
			for _, size := range []int{20, 50, 100, 37, 500, 1} {
				t.Run(fmt.Sprintf("size-%d", size), func(t *testing.T) {
					pages := 1
					if n > 0 {
						pages = (n-1)/size + 1
					}
					seen := make(map[string]bool)
					for requested := 1; requested <= pages+1; requested++ {
						p := mustQuery(t, s, queryUser, GameQuery{Page: requested, PageSize: size})
						page := min(requested, pages)
						start, end := 0, 0
						if n > 0 {
							start, end = (page-1)*size+1, min(page*size, n)
						}
						if p.Total != n || p.Stats != (GameStats{Total: n}) || p.Page != page || p.PageSize != size || p.TotalPages != pages || p.RangeStart != start || p.RangeEnd != end || len(p.Games) != end-start+boolInt(n > 0) || p.Games == nil {
							t.Fatalf("n=%d size=%d requested=%d: %+v", n, size, requested, p)
						}
						for j, g := range p.Games {
							if g.ID != fmt.Sprintf("query-%03d", n-(page-1)*size-j) {
								t.Fatalf("global added ordering: %+v", g)
							}
							if requested <= pages {
								if seen[g.ID] {
									t.Fatalf("duplicate page row %s", g.ID)
								}
								seen[g.ID] = true
							}
						}
					}
					if len(seen) != n {
						t.Fatalf("visited %d rows, want %d", len(seen), n)
					}
				})
			}
			p := mustQuery(t, s, queryUser, GameQuery{})
			if p.Page != 1 || p.PageSize != 20 {
				t.Fatalf("defaults: %+v", p)
			}
		})
	}
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func TestQueryGamesFiltersSearchAndGlobalStats(t *testing.T) {
	s := queryStore(t)
	games := queryFixture(135)
	for i := range games {
		if i%3 == 0 {
			games[i].Category = "learning"
		} else if i%3 == 1 {
			games[i].Keyboard = true
		}
	}
	games[120].Title = "ÄBC 100%_Real"
	games[121].OriginalTitle = "Original ÄRCADE"
	games[122].Filename = "Named ÄFILE.nes"
	games[123].Tags = []string{"Tag ÄTOKEN", "quote\"slash\\", "left", "right", "100%tag", "under_score"}
	games[124].Description = "DescriptionOnly ÄSECRET"
	commitQueryFixture(t, s, queryUser, games)
	for i, g := range games {
		if i%5 == 0 {
			if _, err := s.Favorite(t.Context(), queryUser, g.ID, true); err != nil {
				t.Fatal(err)
			}
		}
		if i%7 == 0 {
			if err := s.RestoreActivity(t.Context(), queryUser, g.ID, "2026-11-22T12:00:00Z", 2); err != nil {
				t.Fatal(err)
			}
		}
	}
	stats := GameStats{Total: 135, Favorites: 27, Recent: 20}
	for _, tc := range []struct {
		q     GameQuery
		total int
	}{
		{GameQuery{View: "favorites", PageSize: 1, Page: 99}, 27},
		{GameQuery{View: "recent", PageSize: 1, Page: 99}, 20},
		{GameQuery{Category: "learning", Page: 2}, 90},
		{GameQuery{Category: "game", Page: 2}, 45},
		{GameQuery{Category: "learning", View: "favorites", PageSize: 1}, 18},
		{GameQuery{Category: "game", View: "favorites", PageSize: 1}, 9},
		{GameQuery{Search: "no such game", Page: 1000}, 0},
	} {
		p := mustQuery(t, s, queryUser, tc.q)
		if p.Total != tc.total || p.Stats != stats || len(p.Games) > p.PageSize {
			t.Fatalf("query=%+v: %+v", tc.q, p)
		}
	}
	for _, tc := range []struct {
		search string
		ids    []string
	}{
		{"äbc", []string{games[120].ID}}, {"äRCADE", []string{games[121].ID}},
		{"äfile", []string{games[122].ID}}, {"ätoken", []string{games[123].ID}},
		{"100%_real", []string{games[120].ID}}, {"100%tag", []string{games[123].ID}},
		{"under_score", []string{games[123].ID}}, {"quote\"slash\\", []string{games[123].ID}},
		{"left,right", []string{}}, {"tags", []string{}}, {"DescriptionOnly", []string{}},
		{"äsecret", []string{}}, {"%", []string{games[123].ID, games[120].ID}},
		{"_", []string{games[123].ID, games[120].ID}}, {"' OR 1=1 --", []string{}},
	} {
		p := mustQuery(t, s, queryUser, GameQuery{Search: tc.search, PageSize: 1})
		if p.Total != len(tc.ids) || p.Stats != stats {
			t.Fatalf("search=%q: %+v", tc.search, p)
		}
		if len(tc.ids) > 0 && p.Games[0].ID != tc.ids[0] {
			t.Fatalf("search=%q ids=%v want=%v", tc.search, queryIDs(p.Games), tc.ids)
		}
	}
}

func TestQueryGamesGlobalOrdering(t *testing.T) {
	s := queryStore(t)
	games := queryFixture(135)
	for i := range games {
		games[i].CreatedAt = "2026-11-22T00:00:00Z"
	}
	titles := []string{"中", "阿", "Zebra", "alpha", "Alpha", "Äbc", "ábaco", "😀"}
	for i := range titles {
		games[i].Title = titles[i]
	}
	commitQueryFixture(t, s, queryUser, games)
	want := append([]Game(nil), games...)
	sort.Slice(want, func(i, j int) bool {
		a, b := titleSortKey(want[i].Title), titleSortKey(want[j].Title)
		if a == b {
			return want[i].ID < want[j].ID
		}
		return a < b
	})
	var got []Game
	for page := 1; page <= 7; page++ {
		got = append(got, mustQuery(t, s, queryUser, GameQuery{Page: page, Sort: "title"}).Games...)
	}
	if !reflect.DeepEqual(queryIDs(got), queryIDs(want)) {
		t.Fatalf("title global order: got=%v want=%v", queryIDs(got), queryIDs(want))
	}
	posA, posZ := -1, -1
	for i, g := range got {
		if g.Title == "阿" {
			posA = i
		} else if g.Title == "中" {
			posZ = i
		}
	}
	if posA < 0 || posZ < 0 || posA >= posZ {
		t.Fatalf("Chinese Pinyin ordering expected 阿 before 中: posA=%d posZ=%d", posA, posZ)
	}
	added := mustQuery(t, s, queryUser, GameQuery{PageSize: 500})
	if !reflect.DeepEqual(queryIDs(added.Games), queryIDs(games)) {
		t.Fatal("added ties do not use id")
	}
	for _, record := range []struct{ id, at string }{
		{games[100].ID, "2026-11-20T01:00:00Z"}, {games[101].ID, "2026-11-22T01:00:00Z"}, {games[102].ID, "2026-11-22T01:00:00Z"},
	} {
		if err := s.RestoreActivity(t.Context(), queryUser, record.id, record.at, 1); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.ExecContext(t.Context(), `INSERT INTO activity(owner,game_id,last_played_at) VALUES(?,?,'')`, queryUser, games[0].ID); err != nil {
		t.Fatal(err)
	}
	p := mustQuery(t, s, queryUser, GameQuery{Sort: "recent", PageSize: 500})
	wantIDs := []string{games[101].ID, games[102].ID, games[100].ID}
	for _, g := range games {
		if g.ID != games[101].ID && g.ID != games[102].ID && g.ID != games[100].ID {
			wantIDs = append(wantIDs, g.ID)
		}
	}
	if !reflect.DeepEqual(queryIDs(p.Games), wantIDs) || p.Stats.Recent != 3 {
		t.Fatal("recent sort must put both NULL and empty last with id ties")
	}
	p = mustQuery(t, s, queryUser, GameQuery{View: "recent", Sort: "title", PageSize: 500})
	if p.Total != 3 || !reflect.DeepEqual(queryIDs(p.Games), wantIDs[:3]) {
		t.Fatal("recent view must force recent order")
	}
}

func TestQueryGamesOwnerIsolationAndAvailabilityClamp(t *testing.T) {
	s := queryStore(t)
	other := fnos.User("uid-1002")
	builtins := queryFixture(21)
	for i := range builtins {
		builtins[i].ID = fmt.Sprintf("builtin-%03d", i+1)
	}
	if err := s.SyncBundled(t.Context(), builtins); err != nil {
		t.Fatal(err)
	}
	imported := queryFixture(1)
	commitQueryFixture(t, s, queryUser, imported)
	foreign := queryFixture(1)
	foreign[0].ID = "foreign"
	commitQueryFixture(t, s, other, foreign)
	for _, id := range []string{builtins[0].ID, imported[0].ID} {
		if _, err := s.Favorite(t.Context(), queryUser, id, true); err != nil {
			t.Fatal(err)
		}
		if err := s.RestoreActivity(t.Context(), queryUser, id, "2026-11-22T00:00:00Z", 1); err != nil {
			t.Fatal(err)
		}
	}
	for _, user := range []fnos.User{queryUser, other, "uid-1003"} {
		p := mustQuery(t, s, user, GameQuery{PageSize: 500})
		want := 22
		if user == "uid-1003" {
			want = 21
		}
		if p.Total != want || p.Stats.Total != want {
			t.Fatalf("same hashes must not merge: user=%s total=%d", user, p.Total)
		}
		if user == queryUser && (p.Stats.Favorites != 2 || p.Stats.Recent != 2) || user != queryUser && (p.Stats.Favorites != 0 || p.Stats.Recent != 0) {
			t.Fatalf("activity isolation: %s %+v", user, p.Stats)
		}
		for _, g := range p.Games {
			if user == queryUser && g.ID == "foreign" || user != queryUser && g.ID == imported[0].ID {
				t.Fatal("owned row leaked")
			}
		}
	}
	if _, err := s.DeleteGame(t.Context(), queryUser, imported[0].ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SyncBundled(t.Context(), builtins[1:]); err != nil {
		t.Fatal(err)
	}
	p := mustQuery(t, s, queryUser, GameQuery{Page: 2})
	if p.Total != 20 || p.Page != 1 || p.TotalPages != 1 || p.RangeStart != 1 || p.RangeEnd != 20 || p.Stats != (GameStats{Total: 20}) {
		t.Fatalf("delete/removed last-page clamp: %+v", p)
	}
	if err := s.SyncBundled(t.Context(), nil); err != nil {
		t.Fatal(err)
	}
	p = mustQuery(t, s, queryUser, GameQuery{Page: 999})
	if p.Total != 0 || p.Page != 1 || p.TotalPages != 1 || p.RangeStart != 0 || p.RangeEnd != 0 || p.Stats != (GameStats{}) {
		t.Fatalf("all unavailable: %+v", p)
	}
}

func TestQueryGamesValidatesAndDecodesOnlyPage(t *testing.T) {
	s := queryStore(t)
	commitQueryFixture(t, s, queryUser, queryFixture(21))
	for _, q := range []GameQuery{{Page: -1}, {PageSize: -1}, {PageSize: 501}, {View: "bad"}, {Category: "bad"}, {Sort: "bad"}, {Sort: "g.id; DROP TABLE games"}} {
		if _, err := s.QueryGames(t.Context(), queryUser, q); !errors.Is(err, ErrInvalid) {
			t.Fatalf("invalid %+v: %v", q, err)
		}
	}
	if _, err := s.QueryGames(t.Context(), "", GameQuery{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid user: %v", err)
	}
	// Valid JSON but incompatible GameExtras in an off-page row proves the
	// paginated path does not decode the complete library before slicing.
	if _, err := s.db.ExecContext(t.Context(), `UPDATE games SET extras='{"tags":42}' WHERE id='query-001'`); err != nil {
		t.Fatal(err)
	}
	p := mustQuery(t, s, queryUser, GameQuery{})
	if p.Total != 21 || len(p.Games) != 20 {
		t.Fatal("off-page row affected pagination")
	}
	if _, err := s.QueryGames(t.Context(), queryUser, GameQuery{Page: 2}); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("page scan did not reuse corruption validation: %v", err)
	}
	if _, err := s.db.ExecContext(t.Context(), `UPDATE games SET extras='{}' WHERE id='query-001'`); err != nil {
		t.Fatal(err)
	}
	if games, err := s.ListGames(t.Context(), queryUser); err != nil || len(games) != 21 {
		t.Fatalf("legacy full list: %d %v", len(games), err)
	}
}

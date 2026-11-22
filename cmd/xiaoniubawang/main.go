package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"xiaoniubawang/internal/extensions"
	"xiaoniubawang/internal/fnos"
	"xiaoniubawang/internal/httpapi"
	"xiaoniubawang/internal/library"
	"xiaoniubawang/internal/store"
)

var (
	version = "dev"
	buildID = "local"
)

type config struct {
	listen, socket, devUser, dataDir, webRoot, bundledRoot, supportRoot string
	approveSupport, supportDisabled                                     bool
}

func main() {
	c := config{}
	var showVersion bool
	flag.StringVar(&c.listen, "listen", "127.0.0.1:18763", "loopback-only address (requires --dev-user)")
	flag.StringVar(&c.socket, "socket", "", "private gateway Unix socket; exclusive with --listen and --dev-user")
	flag.StringVar(&c.devUser, "dev-user", "", "explicit local test marker; send it in "+fnos.DevUserHeader)
	flag.StringVar(&c.dataDir, "data-dir", "", "private app data directory; defaults to XNBW_DATA_DIR or $TRIM_PKGVAR/xiaoniubawang-data")
	flag.StringVar(&c.webRoot, "web-root", "", "optional packaged static web root")
	flag.StringVar(&c.bundledRoot, "bundled-root", "", "read-only packaged catalog; defaults to <web-root>/games when present")
	flag.StringVar(&c.supportRoot, "support-root", "", "optional directory of approved support images")
	flag.BoolVar(&c.approveSupport, "approve-support-assets", false, "explicitly enable approved support images")
	flag.BoolVar(&c.supportDisabled, "without-support-assets", false, "explicit source-only build without private support images")
	flag.BoolVar(&showVersion, "version", false, "print version and build identifier")
	flag.Parse()
	if showVersion {
		fmt.Printf("xiaoniubawang %s (%s)\n", version, buildID)
		return
	}
	if flag.NArg() != 0 {
		log.Fatal("unexpected arguments; use --help")
	}
	if c.socket != "" {
		flag.Visit(func(f *flag.Flag) {
			if f.Name == "listen" {
				log.Fatal("--socket and --listen are mutually exclusive")
			}
		})
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, c); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context, c config) error {
	mode := fnos.Local
	if c.socket != "" {
		mode = fnos.Gateway
		if os.Geteuid() == 0 {
			return errors.New("run gateway mode as the package user, not root")
		}
	}
	auth, err := fnos.NewAuth(mode, c.devUser)
	if err != nil {
		return err
	}
	if c.dataDir == "" {
		c.dataDir = os.Getenv("XNBW_DATA_DIR")
		if pkgvar := os.Getenv("TRIM_PKGVAR"); c.dataDir == "" && pkgvar != "" {
			c.dataDir = filepath.Join(pkgvar, "xiaoniubawang-data")
		}
		if c.dataDir == "" {
			return errors.New("--data-dir is required outside the package environment")
		}
	}
	if c.approveSupport && c.supportDisabled {
		return errors.New("approved support assets and explicit source-only disable are mutually exclusive")
	}
	if c.approveSupport && c.supportRoot == "" {
		return errors.New("--approve-support-assets requires --support-root")
	}
	if c.bundledRoot == "" && c.webRoot != "" {
		candidate := filepath.Join(c.webRoot, "games")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			c.bundledRoot = candidate
		}
	}
	// Packaged assets are publicly readable. Never configure a static or bundled
	// root over/inside the writable app data tree.
	if err := separated(c.dataDir, c.webRoot, c.bundledRoot, c.supportRoot); err != nil {
		return err
	}
	var listener net.Listener
	if mode == fnos.Gateway {
		var cleanup func()
		listener, cleanup, err = fnos.ListenGateway(c.socket)
		if err == nil {
			defer cleanup()
		}
	} else {
		listener, err = fnos.ListenLocal(c.listen)
	}
	if err != nil {
		return err
	}
	defer listener.Close()
	s, err := store.Open(ctx, c.dataDir)
	if err != nil {
		return fmt.Errorf("initialize metadata: %w", err)
	}
	defer s.Close()
	lib, err := library.New(ctx, s, c.bundledRoot)
	if err != nil {
		return fmt.Errorf("initialize library: %w", err)
	}
	defer lib.Close()
	ext := extensions.New(extensions.Config{Store: s, Library: lib, Auth: auth})
	defer ext.Close()
	h, err := httpapi.New(httpapi.Config{Store: s, Library: lib, Auth: auth, Version: version, BuildID: buildID,
		WebRoot: c.webRoot, SupportRoot: c.supportRoot, ApproveSupport: c.approveSupport, SupportDisabled: c.supportDisabled, Extension: ext.Handle})
	if err != nil {
		return err
	}
	defer h.Close()
	return serve(ctx, listener, h, mode)
}

func separated(data string, readers ...string) error {
	private, err := canonicalPath(data)
	if err != nil {
		return err
	}
	for _, reader := range readers {
		if reader == "" {
			continue
		}
		public, err := canonicalPath(reader)
		if err != nil {
			return err
		}
		if containsPath(public, private) || containsPath(private, public) {
			return errors.New("public asset roots and private data directory must not overlap")
		}
	}
	return nil
}

func canonicalPath(name string) (string, error) {
	name, err := filepath.Abs(name)
	if err != nil {
		return "", err
	}
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(name)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) || name == filepath.Dir(name) {
			return "", err
		}
		suffix = append(suffix, filepath.Base(name))
		name = filepath.Dir(name)
	}
}

func containsPath(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func serve(ctx context.Context, ln net.Listener, h http.Handler, mode fnos.Mode) error {
	srv := http.Server{Handler: h, ConnContext: fnos.ConnContext, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 2 * time.Minute, WriteTimeout: 3 * time.Minute, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	done := make(chan error, 1)
	go func() { done <- srv.Serve(ln) }()
	log.Printf("xiaoniubawang %s (%s) listening in %s mode", version, buildID, mode)
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdown); err != nil {
		_ = srv.Close()
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	if err := <-done; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

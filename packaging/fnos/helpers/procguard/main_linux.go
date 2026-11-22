//go:build linux

// SPDX-License-Identifier: GPL-3.0-or-later
// procguard is a short-lived lifecycle helper. It never owns a listener.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func identity(pid int, ticks, binary string) error {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return err
	}
	end := strings.LastIndex(string(data), ") ")
	if end < 0 {
		return errors.New("进程标识无效")
	}
	fields := strings.Fields(string(data[end+2:]))
	if len(fields) < 20 || fields[0] == "Z" || fields[0] == "X" || fields[0] == "x" || fields[19] != ticks {
		return errors.New("进程已结束或标识已变化")
	}
	exe, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		return err
	}
	expected, err := filepath.EvalSymlinks(binary)
	// During an upgrade Linux keeps the old executable inode alive and marks
	// its original path as deleted. The stored start tick and pidfd still pin
	// that exact application task, so it remains safe to stop.
	if err != nil || (exe != expected && exe != expected+" (deleted)") {
		return errors.New("进程程序与应用不符")
	}
	var stat unix.Stat_t
	if err := unix.Stat(fmt.Sprintf("/proc/%d", pid), &stat); err != nil {
		return err
	}
	if stat.Uid != uint32(os.Geteuid()) || stat.Uid == 0 {
		return errors.New("进程用户与应用专用用户不符")
	}
	return nil
}

func run(args []string) int {
	if len(args) == 2 && args[0] == "verify-support" {
		if os.Geteuid() == 0 {
			fmt.Fprintln(os.Stderr, "支持图片验证必须以应用专用用户运行")
			return 2
		}
		canonical, enabled, err := verifyPlatformSupport(args[1], uint32(os.Geteuid()))
		if err != nil {
			fmt.Fprintln(os.Stderr, "support_verification_failed", supportErrorCode(err))
			return 4
		}
		if !enabled {
			return 3
		}
		fmt.Fprintln(os.Stdout, canonical)
		return 0
	}
	if len(args) == 1 && args[0] == "probe" {
		fd, err := unix.PidfdOpen(os.Getpid(), 0)
		if err != nil || os.Geteuid() == 0 {
			fmt.Fprintln(os.Stderr, "无法使用安全进程句柄或当前用户不是应用专用用户")
			return 4
		}
		unix.Close(fd)
		return 0
	}
	if len(args) != 4 {
		fmt.Fprintln(os.Stderr, "用法：procguard <check|TERM|KILL> <pid> <启动时钟> <服务程序>；procguard verify-support <应用目录>")
		return 2
	}
	pid, err := strconv.Atoi(args[1])
	if err != nil || pid <= 1 || os.Geteuid() == 0 || !filepath.IsAbs(args[3]) {
		fmt.Fprintln(os.Stderr, "无效的进程标识或运行用户")
		return 2
	}
	if n, err := strconv.ParseUint(args[2], 10, 64); err != nil || n == 0 {
		return 2
	}
	// Acquire the stable kernel handle BEFORE inspecting /proc. Even if the PID
	// is recycled after inspection, a signal can only reach this handle's task.
	fd, err := unix.PidfdOpen(pid, 0)
	if errors.Is(err, unix.ESRCH) {
		return 3
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "无法取得安全进程句柄，未发送信号：", err)
		return 4
	}
	defer unix.Close(fd)
	if err := identity(pid, args[2], args[3]); err != nil {
		return 3
	}
	var signal unix.Signal
	switch args[0] {
	case "check":
		return 0
	case "TERM":
		signal = unix.SIGTERM
	case "KILL":
		signal = unix.SIGKILL
	default:
		return 2
	}
	if err := unix.PidfdSendSignal(fd, signal, nil, 0); err != nil && !errors.Is(err, unix.ESRCH) {
		fmt.Fprintln(os.Stderr, "无法通过安全进程句柄停止服务：", err)
		return 4
	}
	return 0
}

func main() { os.Exit(run(os.Args[1:])) }

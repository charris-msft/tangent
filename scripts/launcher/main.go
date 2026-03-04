package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

const repoDir = `D:\git\tangent\release`

func main() {
	entryPoint := filepath.Join(repoDir, "out", "main", "index.js")

	// Auto-build if no build exists
	if _, err := os.Stat(entryPoint); os.IsNotExist(err) {
		fmt.Println("No build found. Running npm run build...")
		build := exec.Command("npm", "run", "build")
		build.Dir = repoDir
		build.Stdout = os.Stdout
		build.Stderr = os.Stderr
		if err := build.Run(); err != nil {
			fmt.Fprintf(os.Stderr, "Build failed: %v\n", err)
			os.Exit(1)
		}
	}

	// Find electron binary — prefer patched version with Tangent icon
	electronExe := filepath.Join(repoDir, "node_modules", "electron", "dist", "electron.exe")
	patchedExe := electronExe[:len(electronExe)-4] + "-patched.exe"
	if _, err := os.Stat(patchedExe); err == nil {
		electronExe = patchedExe
	}

	// Launch Electron detached with no console window
	cmd := exec.Command(electronExe, ".")
	cmd.Dir = repoDir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start Tangent: %v\n", err)
		os.Exit(1)
	}
}

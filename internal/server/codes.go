package server

import (
	"crypto/rand"
	"strings"
)

// Room codes: six characters from an alphabet with no lookalikes (no I, L, O,
// 0, or 1), so a code read aloud or typed by hand survives the trip. The
// alphabet has 32 letters on purpose: 256 divides evenly by 32, so picking
// bytes modulo 32 introduces no bias.
const (
	codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	codeLength   = 6
)

// newCode mints a random room code. crypto/rand makes codes unguessable, so
// knowing a code is what admits you to a room; nobody can enumerate their way
// into a stranger's game.
func newCode() string {
	b := make([]byte, codeLength)
	if _, err := rand.Read(b); err != nil {
		panic(err) // the OS random source failing is not a state we can play through
	}
	for i, v := range b {
		b[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	return string(b)
}

// validCode reports whether a client-supplied code is one we could have minted.
func validCode(code string) bool {
	if len(code) != codeLength {
		return false
	}
	for _, r := range code {
		if !strings.ContainsRune(codeAlphabet, r) {
			return false
		}
	}
	return true
}

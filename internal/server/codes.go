package server

import (
	"crypto/rand"
	"strings"
)

// Room codes: six characters from an alphabet with no lookalikes (no I, L, O,
// 0, or 1), so a code read aloud or typed by hand survives the trip.
const (
	codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	codeLength   = 6
)

// newCode mints an unpredictable room code. Knowing the code grants room access,
// so crypto/rand prevents enumeration; rejection sampling keeps characters uniform.
func newCode() string {
	limit := byte(256 - 256%len(codeAlphabet))
	code := make([]byte, 0, codeLength)
	buf := make([]byte, 16)
	for len(code) < codeLength {
		if _, err := rand.Read(buf); err != nil {
			panic(err) // the OS random source failing is not a state we can play through
		}
		for _, v := range buf {
			if v < limit && len(code) < codeLength {
				code = append(code, codeAlphabet[int(v)%len(codeAlphabet)])
			}
		}
	}
	return string(code)
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

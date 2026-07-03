package server

import (
	"strings"
	"testing"
)

func TestNewCodeShape(t *testing.T) {
	code := newCode()
	if len(code) != codeLength {
		t.Fatalf("len = %d, want %d", len(code), codeLength)
	}
	for _, r := range code {
		if !strings.ContainsRune(codeAlphabet, r) {
			t.Fatalf("code %q contains %q, not in the alphabet", code, r)
		}
	}
	if !validCode(code) {
		t.Fatalf("a minted code must validate: %q", code)
	}
	if newCode() == code && newCode() == code {
		t.Fatal("three identical codes in a row: randomness is broken")
	}
}

func TestValidCodeRejectsWhatWeNeverMint(t *testing.T) {
	for _, bad := range []string{"", "ABC", "ABCDEFG", "ABC10D", "abcdef", "AAAAA!"} {
		if validCode(bad) {
			t.Errorf("validCode(%q) = true, want false", bad)
		}
	}
	if !validCode("AAAAAA") {
		t.Error("validCode(AAAAAA) = false, want true")
	}
}

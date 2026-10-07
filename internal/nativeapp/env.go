package nativeapp

import (
	"os"
	"strings"
)

func filteredEnvironment() []string {
	var env []string
	for _, value := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(value), "ELECTRON_RUN_AS_NODE=") {
			env = append(env, value)
		}
	}
	return env
}

#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-only

set -eu

mode="all"
fix=0

usage() {
	cat <<-EOF
	Usage: $0 [--staged] [--fix]

	Options:
	  --staged  Check only files staged for commit.
	  --fix     Format supported files in place. Currently only shell files use shfmt.
	EOF
}

while [ "$#" -gt 0 ]; do
	case "$1" in
	--staged)
		mode="staged"
		;;
	--fix)
		fix=1
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		usage >&2
		exit 2
		;;
	esac
	shift
done

need_cmd() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		return 1
	fi
}

tracked_files() {
	if [ "$mode" = "staged" ]; then
		git diff --cached --diff-filter=ACM --name-only
	else
		git ls-files
	fi
}

filter_existing() {
	while IFS= read -r file; do
		[ -n "$file" ] && [ -f "$file" ] && printf '%s\n' "$file"
	done
}

js_files() {
	tracked_files | grep -E '^htdocs/luci-static/resources/.*\.js$' | filter_existing
}

json_files() {
	tracked_files | grep -E '(^root/usr/share/luci/menu\.d/.*\.json$|^package(-lock)?\.json$|^\.github/.*\.ya?ml$)' | filter_existing
}

shell_files() {
	tracked_files | grep -E '^(\.github/.*\.sh|tools/.*\.sh|root/etc/init\.d/.*|root/etc/uci-defaults/.*)$' | filter_existing
}

check_diff() {
	echo "Checking whitespace..."
	if [ "$mode" = "staged" ]; then
		git diff --cached --check
	else
		git diff --check
	fi
}

check_js() {
	files="$(js_files || true)"
	[ -n "$files" ] || return 0

	echo "Checking JavaScript syntax..."
	need_cmd node
	printf '%s\n' "$files" | while IFS= read -r file; do
		node --check "$file" >/dev/null
	done
}

check_json_yaml() {
	files="$(json_files || true)"
	[ -n "$files" ] || return 0

	echo "Checking JSON/YAML syntax with ruby..."
	need_cmd ruby
	printf '%s\n' "$files" | while IFS= read -r file; do
		case "$file" in
		*.json)
			ruby -rjson -e 'JSON.parse(File.read(ARGV[0]))' "$file"
			;;
		*.yml | *.yaml)
			ruby -ryaml -e 'YAML.load_file(ARGV[0])' "$file" >/dev/null
			;;
		esac
	done
}

check_shell() {
	files="$(shell_files || true)"
	[ -n "$files" ] || return 0

	if [ "$fix" -eq 1 ]; then
		echo "Formatting shell files with shfmt..."
		need_cmd shfmt
		printf '%s\n' "$files" | xargs shfmt -w
		return 0
	fi

	echo "Checking shell syntax..."
	printf '%s\n' "$files" | while IFS= read -r file; do
		if head -n 1 "$file" | grep -q 'bash'; then
			bash -n "$file"
		else
			sh -n "$file"
		fi
	done
}

check_diff
check_js
check_json_yaml
check_shell

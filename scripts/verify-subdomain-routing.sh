#!/usr/bin/env bash
# Verifies that book./guest. subdomains serve the app directly (no pre-app
# 302 redirect to ops.) and that the legacy ops./portal route still works.
#
# Run AFTER disabling the "redirect to primary domain" setting in
# Project Settings → Domains for book.hotelexcella.in and guest.hotelexcella.in.
#
# Usage:  bash scripts/verify-subdomain-routing.sh
# Exit:   0 = all checks passed; 1 = at least one check failed.

set -u
fail=0

check() {
  local label="$1" url="$2" expect_status="$3" expect_body_grep="$4"
  echo "── $label"
  echo "   GET $url"
  local headers body status
  headers=$(curl -sI "$url")
  status=$(printf '%s\n' "$headers" | awk 'NR==1{print $2}')
  local location
  location=$(printf '%s\n' "$headers" | awk 'tolower($1)=="location:"{print $2}' | tr -d '\r')
  echo "   status=$status${location:+  location=$location}"

  if [[ "$status" != "$expect_status" ]]; then
    echo "   ❌ expected status $expect_status, got $status"
    fail=1
    return
  fi

  # No pre-app redirect off the requested host
  if [[ -n "$location" ]]; then
    local req_host new_host
    req_host=$(printf '%s' "$url" | awk -F/ '{print $3}')
    new_host=$(printf '%s' "$location" | awk -F/ '{print $3}')
    if [[ -n "$new_host" && "$new_host" != "$req_host" ]]; then
      echo "   ❌ pre-app cross-host redirect: $req_host → $new_host"
      fail=1
      return
    fi
  fi

  # Body sniff (SSR-rendered shell should contain the marker)
  body=$(curl -sL "$url")
  if ! printf '%s' "$body" | grep -qiE "$expect_body_grep"; then
    echo "   ❌ body did not match /$expect_body_grep/"
    fail=1
    return
  fi
  echo "   ✅ ok"
}

# book. → Booking Engine landing (/be)
check "book.hotelexcella.in serves Booking Engine" \
  "https://book.hotelexcella.in/" "200" "book now|booking|hotel excella"

# guest. → Guest Portal landing (/portal)
check "guest.hotelexcella.in serves Guest Portal" \
  "https://guest.hotelexcella.in/" "200" "booking|portal|hotel excella"

# ops. (legacy) still serves the PMS
check "ops.hotelexcella.in serves PMS" \
  "https://ops.hotelexcella.in/" "200" "hotel excella|login|<!doctype html>"

# Legacy guest portal token path on ops. must keep working
check "ops.hotelexcella.in/portal/ still resolves" \
  "https://ops.hotelexcella.in/portal/" "200" "booking|portal"

echo
if [[ $fail -eq 0 ]]; then
  echo "✅ All subdomain routing checks passed."
  exit 0
else
  echo "❌ One or more subdomain routing checks FAILED."
  echo "   If book./guest. are still 302→ops., disable 'redirect to primary'"
  echo "   for those domains in Project Settings → Domains."
  exit 1
fi

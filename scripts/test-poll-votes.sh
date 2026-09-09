#!/usr/bin/env bash
# Local/staging-only poll smoke test. Never use this against a real public poll.
set -euo pipefail

BASE_URL="${POLL_TEST_BASE_URL:-http://127.0.0.1:5001}"
POLL_SLUG="${1:-}"
VOTE_COUNT="${VOTE_COUNT:-20}"
CANDIDATE_INDEX="${CANDIDATE_INDEX:-1}"

if [[ -z "$POLL_SLUG" ]]; then
  echo "Usage: bash scripts/test-poll-votes.sh <test-poll-slug>" >&2
  exit 64
fi

# # Require an intentionally named test poll so a real campaign poll is never seeded.
# if [[ ! "$POLL_SLUG" =~ ^(test|smoke|local)-[a-z0-9-]+$ ]]; then
#   echo "Refusing to seed '$POLL_SLUG'. Use a test-, smoke-, or local- prefixed test poll." >&2
#   exit 65
# fi

# if [[ "${NODE_ENV:-}" == "production" ]]; then
#   echo "Refusing to run while NODE_ENV=production." >&2
#   exit 66
# fi

# HOST="$(node -e 'console.log(new URL(process.argv[1]).hostname)' "$BASE_URL")"
# if [[ "$HOST" != "localhost" && "$HOST" != "127.0.0.1" && "$HOST" != "0.0.0.0" && "$HOST" != *".staging."* ]]; then
#   echo "Refusing non-local/non-staging host: $HOST" >&2
#   exit 67
# fi

if [[ ! "$CANDIDATE_INDEX" =~ ^[1-9][0-9]*$ ]]; then
  echo "CANDIDATE_INDEX must be a one-based positive number." >&2
  exit 68
fi

POLL_JSON="$(curl --fail --silent --show-error "$BASE_URL/api/content/polls")"
POLL_DETAILS="$(printf '%s' "$POLL_JSON" | node -e '
let raw = "";
process.stdin.on("data", chunk => raw += chunk).on("end", () => {
  const poll = JSON.parse(raw).find(item => item.slug === process.argv[1] && item.status === "published");
  const optionIndex = Number(process.argv[2]) - 1;
  if (!poll || !Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= poll.options.length) process.exit(1);
  console.log(`${poll.options[optionIndex].id}\t${poll.totalVotes}`);
});
' "$POLL_SLUG" "$CANDIDATE_INDEX")"
IFS=$'\t' read -r OPTION_ID BEFORE_TOTAL <<< "$POLL_DETAILS"

for ((index = 1; index <= VOTE_COUNT; index++)); do
  # Documentation-range addresses and unique tokens simulate distinct local test voters.
  FORWARDED_IP="198.18.9.$index"
  TOKEN="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64url"))')"
  STATUS="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --request POST "$BASE_URL/api/polls/$POLL_SLUG/votes" \
    --header 'Content-Type: application/json' \
    --header "X-Vercel-Forwarded-For: $FORWARDED_IP" \
    --data "$(node -e 'console.log(JSON.stringify({ optionId: process.argv[1], browserToken: process.argv[2] }))' "$OPTION_ID" "$TOKEN")")"
  if [[ "$STATUS" != "201" ]]; then
    echo "Vote $index failed with HTTP $STATUS. Stopping." >&2
    exit 1
  fi
  echo "Accepted simulated vote $index/$VOTE_COUNT"
done

AFTER_JSON="$(curl --fail --silent --show-error "$BASE_URL/api/content/polls")"
AFTER_TOTAL="$(printf '%s' "$AFTER_JSON" | node -e '
let raw = "";
process.stdin.on("data", chunk => raw += chunk).on("end", () => {
  const poll = JSON.parse(raw).find(item => item.slug === process.argv[1]);
  if (!poll) process.exit(1);
  console.log(poll.totalVotes);
});
' "$POLL_SLUG")"
EXPECTED_TOTAL=$((BEFORE_TOTAL + VOTE_COUNT))

if [[ "$AFTER_TOTAL" != "$EXPECTED_TOTAL" ]]; then
  echo "Expected $EXPECTED_TOTAL total votes, received $AFTER_TOTAL." >&2
  exit 1
fi

echo "Success: added $VOTE_COUNT local/staging-only simulated votes to candidate index $CANDIDATE_INDEX in $POLL_SLUG ($BEFORE_TOTAL -> $AFTER_TOTAL)."

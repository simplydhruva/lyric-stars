// Update check against the project's GitHub releases page. Only reads the
// latest release's version and page link; never downloads or runs anything.

// "v1.2.3" or "1.2.3" -> [1, 2, 3]; prerelease and build suffixes are ignored.
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

export function isNewer(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function isValidRepo(repo) {
  return /^[\w.-]+\/[\w.-]+$/.test(String(repo || ''));
}

// Returns { available, version, url } or throws. fetchFn is injected for tests.
export async function checkForUpdate({ repo, currentVersion, fetchFn = fetch }) {
  if (!isValidRepo(repo)) return { available: false, disabled: true };
  const res = await fetchFn(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LyricStars-update-check' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return { available: false }; // no releases yet
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const data = await res.json();
  const url = String(data.html_url || '');
  // Only ever open the project's own release page.
  const safeUrl = url.startsWith(`https://github.com/${repo}/releases/`) ? url : `https://github.com/${repo}/releases/latest`;
  return { available: !data.draft && !data.prerelease && isNewer(data.tag_name, currentVersion), version: String(data.tag_name || '').replace(/^v/, ''), url: safeUrl };
}

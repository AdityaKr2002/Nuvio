import { Platform } from 'react-native';

export interface GithubReleaseInfo {
  tag_name: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
}

const GITHUB_LATEST_RELEASE_URL = 'https://api.github.com/repos/tapframe/NuvioStreaming/releases/latest';

export async function fetchLatestGithubRelease(): Promise<GithubReleaseInfo | null> {
  try {
    const res = await fetch(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        'Accept': 'application/vnd.github+json',
        // Identify app a bit; avoid user agent blocks
        'User-Agent': `Nuvio/${Platform.OS}`,
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      tag_name: json.tag_name,
      name: json.name,
      body: json.body,
      html_url: json.html_url,
      published_at: json.published_at,
    };
  } catch {
    return null;
  }
}

export function parseSemver(version: string): [number, number, number] | null {
  const m = version.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

export function isMajorOrMinorUpgrade(current: string, latest: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(latest);
  if (!a || !b) return false;
  // Major or minor bump when (b.major > a.major) or (same major and b.minor > a.minor)
  if (b[0] > a[0]) return true;
  if (b[0] === a[0] && b[1] > a[1]) return true;
  return false;
}

// Return true if latest > current for semver including patch
export function isAnyUpgrade(current: string, latest: string): boolean {
  const a = parseSemver(current);
  const b = parseSemver(latest);
  if (!a || !b) return false;
  if (b[0] !== a[0]) return b[0] > a[0];
  if (b[1] !== a[1]) return b[1] > a[1];
  return b[2] > a[2];
}



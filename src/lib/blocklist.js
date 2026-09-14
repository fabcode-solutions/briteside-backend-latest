// src/lib/blocklist.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SOURCE_URL = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';
const CACHE_FILE = path.join(__dirname, '.blocklist-cache.txt');
const REFRESH_INTERVAL_MS = Number(process.env.BLOCKLIST_REFRESH_INTERVAL_MS) || 24 * 60 * 60 * 1000;

let blockedDomains = new Set();
let lastLoaded = null;
let loadingPromise = null;

function parseHostsFile(text) {
  const domains = new Set();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutComment = line.split('#')[0].trim();
    if (!withoutComment) continue;

    const parts = withoutComment.split(/\s+/);
    if (parts.length < 2) continue;

    const ip = parts[0];
    if (ip !== '0.0.0.0' && ip !== '127.0.0.1') continue;

    for (let i = 1; i < parts.length; i++) {
      const domain = parts[i].toLowerCase();
      if (domain && domain !== 'localhost' && domain !== 'localhost.localdomain' && domain !== 'local') {
        domains.add(domain);
      }
    }
  }
  return domains;
}

async function fetchRemote() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Failed to fetch hosts file: HTTP ${res.status}`);
  return res.text();
}

export async function loadBlocklist({ forceRefresh = false } = {}) {
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    let text;
    try {
      text = await fetchRemote();
      fs.writeFileSync(CACHE_FILE, text, 'utf8');
    } catch (err) {
      console.error('[blocklist] remote fetch failed:', err.message);
      if (fs.existsSync(CACHE_FILE)) {
        console.warn('[blocklist] falling back to local cache');
        text = fs.readFileSync(CACHE_FILE, 'utf8');
      } else if (!forceRefresh && blockedDomains.size === 0) {
        throw err;
      } else {
        return;
      }
    }
    blockedDomains = parseHostsFile(text);
    lastLoaded = new Date();
    console.log(`[blocklist] loaded ${blockedDomains.size} domains at ${lastLoaded.toISOString()}`);
  })();

  try {
    await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export function isBlocked(hostname) {
  if (!hostname) return { blocked: false };
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');

  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (blockedDomains.has(candidate)) {
      return { blocked: true, matchedDomain: candidate };
    }
  }
  return { blocked: false };
}

export function getStats() {
  return { domainCount: blockedDomains.size, lastLoaded: lastLoaded?.toISOString() ?? null };
}

export function startAutoRefresh() {
  setInterval(() => {
    loadBlocklist({ forceRefresh: true }).catch((err) =>
      console.error('[blocklist] refresh failed:', err.message)
    );
  }, REFRESH_INTERVAL_MS);
}
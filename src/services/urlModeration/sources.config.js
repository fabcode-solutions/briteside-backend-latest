// Declarative blocklist source list — the sync worker fetches every entry here.
// `parser` selects how the raw text is turned into a list of domains (see parsers.js).
// `local: true` sources are read from disk (blocklist-url-data/) instead of fetched.
import { CATEGORY } from './types.js';

export const SOURCES = [
  {
    id: 'stevenblack-hosts',
    url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
    category: CATEGORY.MALWARE,
    parser: 'hosts',
    // Sanity floor — this list has run ~70-90k domains historically; a sync that
    // returns far fewer is treated as a corrupted/truncated download, not a real update.
    minDomains: 20000,
  },
  {
    id: 'blocklistproject-porn',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/porn.txt',
    category: CATEGORY.ADULT,
    parser: 'hosts',
    minDomains: 100000,
  },
  {
    id: 'blocklistproject-gambling',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/gambling.txt',
    category: CATEGORY.GAMBLING,
    parser: 'hosts',
    minDomains: 50000,
  },
  {
    id: 'blocklistproject-phishing',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/phishing.txt',
    category: CATEGORY.PHISHING,
    parser: 'hosts',
    minDomains: 20000,
  },
  {
    id: 'blocklistproject-scam',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/scam.txt',
    category: CATEGORY.SCAM,
    parser: 'hosts',
    minDomains: 1000,
  },
  {
    id: 'blocklistproject-fraud',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/fraud.txt',
    category: CATEGORY.SCAM,
    parser: 'hosts',
    minDomains: 50000,
  },
  {
    id: 'blocklistproject-piracy',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/piracy.txt',
    category: CATEGORY.PIRACY,
    parser: 'hosts',
    minDomains: 500,
  },
  {
    id: 'blocklistproject-drugs',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/drugs.txt',
    category: CATEGORY.DRUGS,
    parser: 'hosts',
    minDomains: 5000,
  },
  {
    id: 'blocklistproject-malware',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/malware.txt',
    category: CATEGORY.MALWARE,
    parser: 'hosts',
    minDomains: 200000,
  },
  {
    id: 'blocklistproject-ransomware',
    url: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/ransomware.txt',
    category: CATEGORY.MALWARE,
    parser: 'hosts',
    minDomains: 500,
  },
  {
    id: 'phishing-database',
    url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt',
    category: CATEGORY.PHISHING,
    parser: 'plainList',
    minDomains: 100000,
  },
  {
    id: 'urlhaus-filter',
    url: 'https://raw.githubusercontent.com/curbengh/urlhaus-filter/master/urlhaus-filter-domains.txt',
    category: CATEGORY.MALWARE,
    parser: 'plainList',
    minDomains: 10000,
  },
  // Curated, hand-maintained keyword lists — bare brand names (no TLD), matched
  // against exact hostname labels rather than full registrable domains. Edit the
  // files directly; the sync process picks up changes on the next cycle.
  {
    id: 'local-porn-keywords',
    file: 'blocklist-url-data/porn.js',
    category: CATEGORY.ADULT,
    parser: 'keywordList',
    local: true,
    minDomains: 10,
  },
];

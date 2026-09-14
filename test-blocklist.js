// test-blocklist.js
import { loadBlocklist, isBlocked, getStats } from './src/lib/blocklist.js';

await loadBlocklist();
console.log(getStats());

console.log(isBlocked('example.com'));
console.log(isBlocked('ad.doubleclick.net'));
console.log(isBlocked('foo.bar.doubleclick.net'));

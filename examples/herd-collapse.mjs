// Collapse a thundering herd of identical profile fetches into one DB call.
import { SingleFlight } from '../dist/esm/index.js';

const flight = new SingleFlight();
let dbCalls = 0;

async function getProfile(userId) {
  dbCalls++;
  await new Promise((r) => setTimeout(r, 50)); // simulate DB latency
  return { id: userId, name: 'Ada', plan: 'pro' };
}

// 50 concurrent requests for the same user → 1 DB call
const results = await Promise.all(
  Array.from({ length: 50 }, () => flight.run('profile:ada', () => getProfile('ada')))
);

console.log(`db calls: ${dbCalls}`); // 1
console.log(`all identical: ${results.every((r) => r === results[0])}`); // true
console.log(results[0]);

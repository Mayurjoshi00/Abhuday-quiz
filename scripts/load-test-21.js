#!/usr/bin/env node
const BASE = process.env.BASE_URL || 'http://localhost:3000';

const TEAMS = [
  ['TEAM01', 'hawk#9271'], ['TEAM02', 'upsd@5583'], ['TEAM03', 'gate!7734'],
  ['TEAM04', 'mind$4421'], ['TEAM05', 'demo%8812'], ['TEAM06', 'flux&3390'],
  ['TEAM07', 'labs*6617'], ['TEAM08', 'vine!2245'], ['TEAM09', 'will@7753'],
  ['TEAM10', 'elev#3381'], ['TEAM11', 'snow$9922'], ['TEAM12', 'creel%4490'],
  ['TEAM13', 'mike&8822'], ['TEAM14', 'bren*6617'], ['TEAM15', 'vecna!2245'],
  ['TEAM16', 'hopper@7753'], ['TEAM17', 'will#3381'], ['TEAM18', 'robin$9922'],
  ['TEAM19', 'jonathan%4490'], ['TEAM20', 'max&8822'], ['TEAM21', 'nancy*6617']
];

function stats(times) {
  const sorted = [...times].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: Math.round(sum / sorted.length),
    p50: pct(0.5),
    p95: pct(0.95)
  };
}

async function clearTeams() {
  await fetch(`${BASE}/api/admin/clear`, {
    method: 'POST',
    headers: { 'x-admin-token': 'admin_chmod777' }
  });
}

async function loginTeam([id, pass]) {
  const t0 = performance.now();
  const [loginRes, questionsRes] = await Promise.all([
    fetch(`${BASE}/api/team/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId: id, pass })
    }),
    fetch(`${BASE}/api/questions`)
  ]);
  const login = await loginRes.json();
  const questions = await questionsRes.json();
  const ms = Math.round(performance.now() - t0);
  return {
    id,
    ok: loginRes.ok && questionsRes.ok,
    ms,
    loginBytes: JSON.stringify(login).length,
    questionsCount: Array.isArray(questions) ? questions.length : 0,
    sessionToken: login.sessionToken
  };
}

async function saveAnswers(session) {
  const t0 = performance.now();
  const tasks = Array.from({ length: 5 }, (_, i) =>
    fetch(`${BASE}/api/quiz/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamId: session.id,
        sessionToken: session.sessionToken,
        qIndex: i,
        answer: 0
      })
    })
  );
  const results = await Promise.all(tasks);
  return {
    id: session.id,
    ok: results.every(r => r.ok),
    ms: Math.round(performance.now() - t0)
  };
}

async function run() {
  console.log(`\nLoad test → ${BASE} (21 teams)\n`);

  await clearTeams();

  const wallStart = performance.now();
  const logins = await Promise.all(TEAMS.map(loginTeam));
  const loginWall = Math.round(performance.now() - wallStart);

  const failed = logins.filter(r => !r.ok);
  const loginTimes = logins.map(r => r.ms);
  const loginStats = stats(loginTimes);

  console.log('── LOGIN + QUESTIONS (all 21 in parallel) ──');
  console.log(`  Wall time:  ${loginWall}ms`);
  console.log(`  Per-team:   avg ${loginStats.avg}ms | p50 ${loginStats.p50}ms | p95 ${loginStats.p95}ms | max ${loginStats.max}ms`);
  console.log(`  Failures:   ${failed.length}`);
  console.log(`  Avg login payload: ${Math.round(logins.reduce((s, r) => s + r.loginBytes, 0) / logins.length)} bytes`);

  const answerWallStart = performance.now();
  const answers = await Promise.all(
    logins.filter(r => r.ok).map(saveAnswers)
  );
  const answerWall = Math.round(performance.now() - answerWallStart);
  const answerTimes = answers.map(r => r.ms);
  const answerStats = stats(answerTimes);

  console.log('\n── ANSWER SAVES (5 per team, all parallel) ──');
  console.log(`  Wall time:  ${answerWall}ms`);
  console.log(`  Per-team:   avg ${answerStats.avg}ms | p50 ${answerStats.p50}ms | p95 ${answerStats.p95}ms | max ${answerStats.max}ms`);
  console.log(`  Failures:   ${answers.filter(r => !r.ok).length}`);

  const health = await fetch(`${BASE}/api/health`).then(r => r.json());
  console.log(`\n── SERVER ──`);
  console.log(`  Active teams: ${health.teams}`);
  console.log(`  Uptime:       ${Math.round(health.uptime)}s`);

  const pass = failed.length === 0 && loginStats.p95 < 2000 && loginWall < 5000;
  console.log(pass ? '\n✅ PASS — ready for 21-team event\n' : '\n❌ FAIL — review timings above\n');
  process.exit(pass ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

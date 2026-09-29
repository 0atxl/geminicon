import dotenv from "dotenv";

dotenv.config();

const GATEWAY_URL = (process.env.GEMINICON_URL || "http://127.0.0.1:8765").replace(/\/+$/, "");
const SERVICE_KEY = process.env.GEMINICON_SERVICE_KEY || "dev-service-key";
const USER_ID = process.env.GEMINICON_TEST_USER || "user_alice";

async function main() {
  console.log(`\n======================================================`);
  console.log(`Geminicon Relay Smoke Test (Chrome -> Gateway)`);
  console.log(`======================================================`);
  console.log(`Gateway:    ${GATEWAY_URL}`);
  console.log(`User ID:    ${USER_ID}`);
  console.log(`ServiceKey: ${SERVICE_KEY ? "configured" : "none"}`);

  // 1. Health check
  console.log(`\n[1/2] Checking Gateway Health...`);
  let healthRes: Response;
  try {
    healthRes = await fetch(`${GATEWAY_URL}/health`);
  } catch (err: any) {
    console.error(`❌ Gateway is not reachable at ${GATEWAY_URL}. Is it running? (${err.message})`);
    process.exit(1);
  }

  const health = await healthRes.json();
  console.log(`      Status: ${health.status}, Ready Workers: ${health.readyWorkers || 0}`);

  if (health.readyWorkers === 0) {
    console.log(`\n⚠️  No ready Chrome worker detected.`);
    console.log(`   To pair a real Chrome browser:`);
    console.log(`   1. Request a code:`);
    console.log(`      curl -X POST ${GATEWAY_URL}/v1/pairing/code -H "Authorization: Bearer ${SERVICE_KEY}" -H "Content-Type: application/json" -d '{"userId":"${USER_ID}"}'`);
    console.log(`   2. Open Chrome extension popup -> enter URL & code -> Click 'Pair Device'`);
    console.log(`   3. Re-run this test.`);
    process.exit(1);
  }

  // 2. Send a simple prompt and verify a non-empty completion
  console.log(`\n[2/2] Submitting relay test prompt via Chrome worker...`);
  const startTime = Date.now();

  const completionRes = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "X-Geminicon-User-ID": USER_ID,
    },
    body: JSON.stringify({
      model: "gemini-web",
      messages: [
        { role: "user", content: "Reply with exactly: relay test ok" },
      ],
    }),
  });

  const durationMs = Date.now() - startTime;

  if (!completionRes.ok) {
    const errBody = await completionRes.json().catch(() => ({}));
    console.error(`❌ Request failed (${completionRes.status}):`, errBody);
    process.exit(1);
  }

  const completion = await completionRes.json();
  const rawText = completion.choices?.[0]?.message?.content || "";

  console.log(`      Response received in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`      Content:  ${rawText.slice(0, 120)}`);

  if (!rawText.trim()) {
    console.error(`❌ Empty completion received.`);
    process.exit(1);
  }

  console.log(`\n======================================================`);
  console.log(`✅ Relay Smoke Test PASSED`);
  console.log(`======================================================\n`);
}

main().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});

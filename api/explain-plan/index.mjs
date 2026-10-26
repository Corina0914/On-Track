// On-Track AI coach: an AWS Lambda (Node.js 20+) behind a Function URL.
//
// The page still works out the numbers (grams, meal times) with its rules
// engine. It sends this function two plans built for the same workout - one
// for a sprinter and one for a miler - and Claude explains why they differ.
// The API key stays here on the server and is never sent to the browser.
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the Lambda environment
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const MAX_BODY_BYTES = 20_000;

const SYSTEM = `You are the On-Track AI coach, a sports-nutrition explainer for high school and college track and field athletes.

The app's rules engine has already built two food plans for the SAME workout and the SAME body weight: one for a sprinter and one for a miler. Your job is to explain, in plain language a student athlete understands, WHY the plans differ - especially what each athlete should eat after the practice.

Ground every explanation in the plans you are given. Do not invent different gram amounts or meal times; refer to the numbers in the plans. Explain the physiology simply:
- Sprinters rely mostly on the phosphocreatine and fast glycolytic systems in short, all-out efforts. They use less total muscle glycogen, but take more muscle damage from explosive work, so recovery leans on protein to repair and build fast-twitch muscle, with moderate carbs.
- Milers race at a mix of aerobic and anaerobic effort and train with more volume. They burn through much more glycogen, so recovery leans on refilling carbs quickly (especially within the first hour), with protein to repair.
- Training load, timing, and race-tomorrow status change both plans.

If the athlete's own events are given, end by telling them which pattern fits them (or how to blend both if they do events from each side, like a 400m runner or a multi-eventer).

Keep it encouraging and practical. This is general guidance, not medical advice; do not diagnose or give advice about medical conditions or supplements.`;

// Structured output so the page can lay the explanation out in sections.
const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence summing up the main difference." },
    sprinter: { type: "string", description: "2-4 sentences: why the sprinter's recovery plan looks the way it does." },
    miler: { type: "string", description: "2-4 sentences: why the miler's recovery plan looks the way it does." },
    keyDifferences: {
      type: "array",
      items: { type: "string" },
      description: "3-5 short bullet points comparing the two plans, citing their numbers.",
    },
    forYou: { type: "string", description: "1-3 sentences for this athlete based on their own events." },
  },
  required: ["headline", "sprinter", "miler", "keyDifferences", "forYou"],
  additionalProperties: false,
};

const reply = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  },
  body: JSON.stringify(body),
});

const fmtTime = (m) => {
  m = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

function describePlan(label, plan) {
  const lines = [
    `${label} plan: "${plan.approach[0]}" - ${plan.approach[1]}`,
    `Daily targets: ${plan.carbsG} g carbs, ${plan.proteinG} g protein.`,
    "Timeline:",
  ];
  for (const x of plan.entries.slice(0, 15)) {
    lines.push(x.workout
      ? `- ${fmtTime(x.time)} WORKOUT: ${x.title}`
      : `- ${fmtTime(x.time)} ${x.title} (${x.size || "regular"}): ~${x.carbsG} g carbs, ${x.proteinG} g protein`);
  }
  return lines.join("\n");
}

function buildPrompt(req) {
  const { workout: w, athlete, sprinterPlan, milerPlan } = req;
  return [
    `Same practice for both athletes: ${w.summary}.`,
    w.notes ? `Workout description from the athlete: "${w.notes}"` : "",
    `Both athletes: ${athlete.gender}, ${athlete.weightKg} kg.`,
    "",
    describePlan("SPRINTER", sprinterPlan),
    "",
    describePlan("MILER", milerPlan),
    "",
    `The athlete using the app competes in: ${athlete.events.join(", ")}.`,
    "Explain why the sprinter and the miler should eat differently after this same practice.",
  ].filter((l) => l !== "").join("\n");
}

function isValid(req) {
  const planOk = (p) => p && Array.isArray(p.approach) && Array.isArray(p.entries) &&
    Number.isFinite(p.carbsG) && Number.isFinite(p.proteinG);
  return req && req.workout && typeof req.workout.summary === "string" &&
    req.athlete && Array.isArray(req.athlete.events) &&
    planOk(req.sprinterPlan) && planOk(req.milerPlan);
}

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  if (method === "OPTIONS") return reply(204, {});
  if (method !== "POST") return reply(405, { error: "Use POST." });

  const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString() : event.body || "";
  if (raw.length > MAX_BODY_BYTES) return reply(413, { error: "Request too large." });
  let req;
  try {
    req = JSON.parse(raw);
  } catch {
    return reply(400, { error: "Invalid JSON." });
  }
  if (!isValid(req)) return reply(400, { error: "Missing workout, athlete, or plans." });
  req.workout.notes = String(req.workout.notes || "").slice(0, 500);

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      // If a request is ever declined, the API retries it on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(req) }],
    });

    if (response.stop_reason === "refusal") {
      return reply(422, { error: "The AI coach couldn't answer this one. Try changing the workout description." });
    }
    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return reply(502, { error: "The AI coach didn't return an explanation." });
    return reply(200, JSON.parse(text));
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return reply(429, { error: "The AI coach is busy. Try again in a minute." });
    }
    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}:`, error.message);
      return reply(502, { error: "The AI coach is unavailable right now." });
    }
    console.error(error);
    return reply(500, { error: "Something went wrong." });
  }
};
